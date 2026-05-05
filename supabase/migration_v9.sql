-- ===== MIGRATION v9 =====
-- Run this in the Supabase SQL Editor

alter table public.profiles add column if not exists song_title       text;
alter table public.profiles add column if not exists song_artist      text;
alter table public.profiles add column if not exists song_artwork_url text;
alter table public.profiles add column if not exists song_preview_url text;
