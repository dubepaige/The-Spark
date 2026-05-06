-- ===== MIGRATION v7b =====
-- Fix: allow logged-out users to submit suggestions
-- The RLS policy already permits it, but the anon role needs explicit table-level INSERT permission

grant insert on table public.suggestions to anon;
