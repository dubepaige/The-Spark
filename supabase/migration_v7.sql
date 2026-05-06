-- ===== MIGRATION v7 =====
-- Run this in the Supabase SQL Editor

create table if not exists public.suggestions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  name       text,
  message    text not null,
  created_at timestamptz default now()
);

alter table public.suggestions enable row level security;

-- Anyone can submit a suggestion (logged in or not)
drop policy if exists "Anyone can submit suggestions" on public.suggestions;
create policy "Anyone can submit suggestions"
  on public.suggestions for insert
  with check (true);

-- Only the owner can read their own suggestions (optional — keeps them private)
drop policy if exists "Owner can read suggestions" on public.suggestions;
create policy "Owner can read suggestions"
  on public.suggestions for select
  using (auth.uid() = user_id);
