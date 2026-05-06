-- ===== MIGRATION v8 =====
-- Run this in the Supabase SQL Editor

-- Add admin flag to profiles
alter table public.profiles add column if not exists is_admin boolean default false;

-- Grant paigedube admin access
update public.profiles set is_admin = true where username = 'paigedube';
