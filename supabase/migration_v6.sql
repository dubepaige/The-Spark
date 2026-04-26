-- ===== MIGRATION v6 =====
-- Run this in the Supabase SQL Editor

-- Per-post privacy
alter table public.posts add column if not exists is_private boolean default false;
