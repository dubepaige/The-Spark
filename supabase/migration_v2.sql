-- ===== MIGRATION v2 =====
-- Run this entire block in the Supabase SQL Editor

-- 1. Add avatar_url to profiles
alter table public.profiles add column if not exists avatar_url text;

-- 2. Add media columns to posts
alter table public.posts add column if not exists media_url  text;
alter table public.posts add column if not exists media_type text;

-- 3. Make content optional (feelings replace it as required field)
alter table public.posts alter column content drop not null;

-- 4. FOLLOWS table
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at   timestamptz default now(),
  unique(follower_id, following_id)
);

alter table public.follows enable row level security;

drop policy if exists "Follows are viewable by everyone" on public.follows;
drop policy if exists "Users can follow others"          on public.follows;
drop policy if exists "Users can unfollow"               on public.follows;

create policy "Follows are viewable by everyone"
  on public.follows for select using (true);
create policy "Users can follow others"
  on public.follows for insert with check (auth.uid() = follower_id);
create policy "Users can unfollow"
  on public.follows for delete using (auth.uid() = follower_id);

-- 5. Storage buckets
--    (If these error, create the buckets manually in Dashboard → Storage → New bucket)
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('post-media', 'post-media', true)
  on conflict (id) do nothing;

-- 6. Storage policies — drop old ones first to avoid conflicts
drop policy if exists "Avatars are public"            on storage.objects;
drop policy if exists "Users can upload their avatar" on storage.objects;
drop policy if exists "Users can update their avatar" on storage.objects;
drop policy if exists "Post media is public"          on storage.objects;
drop policy if exists "Users can upload post media"   on storage.objects;

-- Avatars: public read, auth write
create policy "Avatars are public"
  on storage.objects for select using (bucket_id = 'avatars');

create policy "Users can upload their avatar"
  on storage.objects for insert with check (
    bucket_id = 'avatars' and auth.role() = 'authenticated'
  );

create policy "Users can update their avatar"
  on storage.objects for update using (
    bucket_id = 'avatars' and auth.role() = 'authenticated'
  );

-- Post media: public read, auth write
create policy "Post media is public"
  on storage.objects for select using (bucket_id = 'post-media');

create policy "Users can upload post media"
  on storage.objects for insert with check (
    bucket_id = 'post-media' and auth.role() = 'authenticated'
  );
