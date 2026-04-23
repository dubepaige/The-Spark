-- Run this in the Supabase SQL Editor

-- PROFILES (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  full_name text,
  avatar_letter text,
  email text,
  birthday date,
  created_at timestamptz default now()
);

-- If the table already exists, add columns (safe to run multiple times)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists birthday date;
alter table public.profiles add column if not exists full_name text;

-- Add feeling column to posts (run this in SQL editor if posts table already exists)
alter table public.posts add column if not exists feeling text;
alter table public.posts alter column content drop not null;

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- POSTS
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check (char_length(content) <= 280),
  video_url text,
  slap_count int default 0,
  created_at timestamptz default now()
);

alter table public.posts enable row level security;

create policy "Posts are viewable by everyone"
  on public.posts for select using (true);

create policy "Authenticated users can create posts"
  on public.posts for insert with check (auth.uid() = user_id);

create policy "Users can delete their own posts"
  on public.posts for delete using (auth.uid() = user_id);

-- SLAPS (likes)
create table if not exists public.slaps (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(post_id, user_id)
);

alter table public.slaps enable row level security;

create policy "Slaps are viewable by everyone"
  on public.slaps for select using (true);

create policy "Authenticated users can slap"
  on public.slaps for insert with check (auth.uid() = user_id);

create policy "Users can unslap"
  on public.slaps for delete using (auth.uid() = user_id);

-- COMMENTS
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null check (char_length(content) <= 200),
  created_at timestamptz default now()
);

alter table public.comments enable row level security;

create policy "Comments are viewable by everyone"
  on public.comments for select using (true);

create policy "Authenticated users can comment"
  on public.comments for insert with check (auth.uid() = user_id);

create policy "Users can delete their own comments"
  on public.comments for delete using (auth.uid() = user_id);

-- FUNCTION: auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  uname text;
begin
  uname := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  insert into public.profiles (id, username, full_name, avatar_letter, email, birthday)
  values (
    new.id,
    uname,
    new.raw_user_meta_data->>'full_name',
    upper(substring(uname, 1, 1)),
    new.email,
    (new.raw_user_meta_data->>'birthday')::date
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- FUNCTION: update slap_count on posts
create or replace function public.update_slap_count()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set slap_count = slap_count + 1 where id = new.post_id;
  elsif TG_OP = 'DELETE' then
    update public.posts set slap_count = slap_count - 1 where id = old.post_id;
  end if;
  return null;
end;
$$;

create or replace trigger on_slap_change
  after insert or delete on public.slaps
  for each row execute function public.update_slap_count();
