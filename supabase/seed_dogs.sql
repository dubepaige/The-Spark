-- ============================================================
-- Seed: SparkPup bot account — cute dog posts to fill the feed
-- Run in Supabase SQL editor
-- ============================================================

do $$
declare
  pup_id uuid;
begin
  -- Check if already exists
  select id into pup_id from auth.users where email = 'sparkpup@thespark.app';

  if pup_id is null then
    pup_id := gen_random_uuid();

    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, role, aud
    ) values (
      pup_id,
      '00000000-0000-0000-0000-000000000000',
      'sparkpup@thespark.app',
      crypt('SparkPup2024!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"username":"sparkpup","full_name":"Spark Pup"}',
      now() - interval '30 days',
      now(),
      'authenticated',
      'authenticated'
    );
  end if;

  -- Upsert profile
  insert into public.profiles (
    id, username, full_name, avatar_letter,
    bio, college, industry, is_og, is_private
  )
  select
    pup_id,
    'sparkpup',
    'Spark Pup ⚡',
    'S',
    '🐾 your daily dose of dogs. woof.',
    null,
    'Professional Good Boy',
    true,
    false
  on conflict (id) do update set
    username    = excluded.username,
    full_name   = excluded.full_name,
    bio         = excluded.bio,
    industry    = excluded.industry,
    is_og       = excluded.is_og;

  -- Insert posts (skip if already exist for this user)
  insert into public.posts (id, user_id, content, feeling, media_url, media_type, is_private, is_close_friends, created_at)
  select * from (values
    (
      gen_random_uuid(), pup_id,
      'monday morning energy ☀️',
      'Hyper 🐶',
      'https://images.dog.ceo/breeds/retriever-golden/n02099601_3004.jpg',
      'image',
      false, false,
      now() - interval '1 day'
    ),
    (
      gen_random_uuid(), pup_id,
      'this is my serious face',
      'Focused 🎯',
      'https://images.dog.ceo/breeds/husky/n02110185_10047.jpg',
      'image',
      false, false,
      now() - interval '2 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'just vibing in the sun 🌞',
      'Chill 😎',
      'https://images.dog.ceo/breeds/samoyed/n02111889_7262.jpg',
      'image',
      false, false,
      now() - interval '3 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'found a new spot. not sharing.',
      'Sneaky 🕵️',
      'https://images.dog.ceo/breeds/corgi-cardigan/n02113186_1030.jpg',
      'image',
      false, false,
      now() - interval '4 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'it is I, the fluffiest',
      'Confident 💅',
      'https://images.dog.ceo/breeds/chow/n02112137_5321.jpg',
      'image',
      false, false,
      now() - interval '5 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'zoomies incoming. clear the area.',
      'Chaotic 🌀',
      'https://images.dog.ceo/breeds/labrador/n02099712_8862.jpg',
      'image',
      false, false,
      now() - interval '6 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'waiting for my walk like 👀',
      'Impatient ⏳',
      'https://images.dog.ceo/breeds/beagle/n02088364_15019.jpg',
      'image',
      false, false,
      now() - interval '7 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'beach day was a success 🌊',
      'Happy 🌊',
      'https://images.dog.ceo/breeds/retriever-chesapeake/n02099849_2476.jpg',
      'image',
      false, false,
      now() - interval '8 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'they said smile for the camera',
      'Silly 😜',
      'https://images.dog.ceo/breeds/poodle-standard/n02113799_2280.jpg',
      'image',
      false, false,
      now() - interval '9 days'
    ),
    (
      gen_random_uuid(), pup_id,
      'nap szn is officially open 🛏️',
      'Sleepy 😴',
      'https://images.dog.ceo/breeds/setter-english/n02100735_9779.jpg',
      'image',
      false, false,
      now() - interval '10 days'
    )
  ) as v(id, user_id, content, feeling, media_url, media_type, is_private, is_close_friends, created_at)
  where not exists (
    select 1 from public.posts where user_id = pup_id
  );

end $$;
