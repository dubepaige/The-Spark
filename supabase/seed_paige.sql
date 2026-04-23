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

-- Step 3: Create Paige's auth account (only if not already there)
do $$
declare
  new_user_id uuid;
begin
  -- Check if user already exists
  select id into new_user_id from auth.users where email = 'paigedube27@gmail.com';

  if new_user_id is null then
    new_user_id := gen_random_uuid();

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
    ) values (
      new_user_id,
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
    );
  end if;

  -- Step 4: Upsert the profile row
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
    username      = 'paigedube',
    full_name     = 'Paige Dube',
    avatar_letter = 'P',
    email         = 'paigedube27@gmail.com',
    birthday      = '2004-02-27'::date;

end $$;
