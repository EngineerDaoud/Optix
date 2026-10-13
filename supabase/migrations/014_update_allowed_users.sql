-- Update the approved list (safe to run more than once).
-- Run: npx supabase db push   (or paste in Supabase > SQL Editor > Run)

-- remove the old alizaib email
delete from public.allowed_users where email = 'alizaibkhan07@gmail.com';

-- add the new emails
insert into public.allowed_users (email, role) values
  ('alizaibkhan2299@gmail.com', 'user'),
  ('laibauaf22@gmail.com',      'user'),
  ('zeeshan@sanomads.us',       'admin')
on conflict (email) do update set role = excluded.role;