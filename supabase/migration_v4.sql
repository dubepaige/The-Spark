-- ===== MIGRATION v4 =====
-- Run this entire block in the Supabase SQL Editor

-- 1. Suggestions / contact table
create table if not exists public.suggestions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  name       text,
  message    text not null check (char_length(message) <= 1000),
  created_at timestamptz default now()
);

alter table public.suggestions enable row level security;

-- Anyone (logged in or not) can submit
drop policy if exists "Anyone can submit suggestions" on public.suggestions;
create policy "Anyone can submit suggestions"
  on public.suggestions for insert with check (true);

-- Only the submitter can see their own (admins see all via dashboard)
drop policy if exists "Users can see own suggestions" on public.suggestions;
create policy "Users can see own suggestions"
  on public.suggestions for select using (auth.uid() = user_id);
