-- ===== MIGRATION v11 =====
-- Run this in the Supabase SQL Editor

-- Close friends list
create table if not exists public.close_friends (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (owner_id, friend_id)
);

alter table public.close_friends enable row level security;

create policy "Owner manages their close friends list"
  on public.close_friends for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Friends can check if they're on someone's list (for feed filtering)
create policy "Friend can see they are on a list"
  on public.close_friends for select
  using (auth.uid() = friend_id);

-- Add close-friends privacy to posts
alter table public.posts add column if not exists is_close_friends boolean default false;

-- Blocks
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

create policy "Blocker manages their blocks"
  on public.blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- Blocked person can see they are blocked (needed for client-side filtering)
create policy "Blocked person can see block"
  on public.blocks for select
  using (auth.uid() = blocked_id);
