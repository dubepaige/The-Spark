-- ===== MIGRATION v2: media uploads, avatar, follows =====
-- Run this in the Supabase SQL Editor

-- 1. Add avatar_url to profiles
alter table public.profiles add column if not exists avatar_url text;

-- 2. Add media columns to posts (replace old video_url approach)
alter table public.posts add column if not exists media_url  text;
alter table public.posts add column if not exists media_type text; -- 'image' or 'video'

-- 3. FOLLOWS table
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at   timestamptz default now(),
  unique(follower_id, following_id)
);

alter table public.follows enable row level security;

create policy "Follows are viewable by everyone"
  on public.follows for select using (true);

create policy "Users can follow others"
  on public.follows for insert with check (auth.uid() = follower_id);

create policy "Users can unfollow"
  on public.follows for delete using (auth.uid() = follower_id);

-- 4. Storage buckets (run separately if these error — you can also create via dashboard)
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('post-media', 'post-media', true)
  on conflict (id) do nothing;

-- 5. Storage policies for avatars
create policy "Avatars are public"
  on storage.objects for select using (bucket_id = 'avatars');

create policy "Users can upload their avatar"
  on storage.objects for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their avatar"
  on storage.objects for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 6. Storage policies for post media
create policy "Post media is public"
  on storage.objects for select using (bucket_id = 'post-media');

create policy "Users can upload post media"
  on storage.objects for insert with check (
    bucket_id = 'post-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
