-- ===== MIGRATION v5 =====
-- Run this entire block in the Supabase SQL Editor

-- 1. Private accounts
alter table public.profiles add column if not exists is_private boolean default false;

-- 2. Direct messages
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid references public.profiles(id) on delete cascade not null,
  receiver_id uuid references public.profiles(id) on delete cascade not null,
  content     text not null check (char_length(content) <= 500),
  read        boolean default false,
  created_at  timestamptz default now()
);

alter table public.messages enable row level security;

drop policy if exists "Users can see own messages"  on public.messages;
drop policy if exists "Users can send messages"     on public.messages;
drop policy if exists "Receivers can mark read"     on public.messages;

create policy "Users can see own messages"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Users can send messages"
  on public.messages for insert
  with check (auth.uid() = sender_id);

create policy "Receivers can mark read"
  on public.messages for update
  using (auth.uid() = receiver_id);
