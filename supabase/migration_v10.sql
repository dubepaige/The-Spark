-- ===== MIGRATION v10 =====
-- Run this in the Supabase SQL Editor

create table if not exists public.follow_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz default now(),
  unique(requester_id, target_id)
);

alter table public.follow_requests enable row level security;

create policy "Requester can insert"
  on public.follow_requests for insert
  with check (auth.uid() = requester_id);

create policy "Requester and target can view"
  on public.follow_requests for select
  using (auth.uid() = target_id or auth.uid() = requester_id);

create policy "Requester and target can delete"
  on public.follow_requests for delete
  using (auth.uid() = target_id or auth.uid() = requester_id);
