-- Step 1: Add new columns (safe to run even if already done)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists birthday date;
alter table public.profiles add column if not exists full_name text;

-- Step 2: Update the trigger to include full_name
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  uname text;
begin
  uname := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  insert into public.profiles (id, username, full_name, avatar_letter, email, birthday)
  values (
    new.id,
    uname,
    new.raw_user_meta_data->>'full_name',
    upper(substring(uname, 1, 1)),
    new.email,
    (new.raw_user_meta_data->>'birthday')::date
  );
  return new;
end;
$$;

-- Step 3: Create Paige's auth account
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud
)
values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'paigedube27@gmail.com',
  crypt('Pass1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"paigedube","full_name":"Paige Dube","birthday":"2004-02-27"}',
  now(),
  now(),
  'authenticated',
  'authenticated'
)
on conflict (email) do nothing;

-- Step 4: Make sure the profile row exists (trigger fires on insert above,
--         but this is a fallback in case the user row already existed)
insert into public.profiles (id, username, full_name, avatar_letter, email, birthday)
select
  id,
  'paigedube',
  'Paige Dube',
  'P',
  'paigedube27@gmail.com',
  '2004-02-27'::date
from auth.users
where email = 'paigedube27@gmail.com'
on conflict (id) do update set
  username     = excluded.username,
  full_name    = excluded.full_name,
  avatar_letter = excluded.avatar_letter,
  email        = excluded.email,
  birthday     = excluded.birthday;
