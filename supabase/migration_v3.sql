-- ===== MIGRATION v3 =====
-- Run this entire block in the Supabase SQL Editor

-- 1. Add college and industry columns to profiles
alter table public.profiles add column if not exists college  text;
alter table public.profiles add column if not exists industry text;
