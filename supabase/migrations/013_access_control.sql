-- SEOPilot access control: 1 admin + a fixed list of users, and an activity log the admin can read.
-- Run once: npx supabase db push   (or paste this whole file in Supabase > SQL Editor > Run)

-- 1) Who is allowed in ----------------------------------------------------------------------------
create table if not exists public.allowed_users (
  email text primary key check (email = lower(email)),
  role  text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);
alter table public.allowed_users enable row level security;   -- no policies: only the functions below can read it

insert into public.allowed_users (email, role) values
  ('ai.solution.buisness@gmail.com', 'admin'),
  ('anas.hassan55.00@gmail.com',     'user'),
  ('abdulrehmanhashmi630@gmail.com', 'user'),
  ('mussa@sanomads.us',              'user'),
  ('fatima@sanomads.us',             'user'),
  ('alizaibkhan07@gmail.com',        'user')
on conflict (email) do update set role = excluded.role;

-- 2) Role helpers ---------------------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.allowed_users where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

revoke all on function public.my_role()  from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.my_role()  to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 3) Block everybody else from creating an account (works even if someone calls the API directly) -----
create or replace function public.enforce_allowed_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_users where email = lower(coalesce(new.email, ''))) then
    raise exception 'This email is not approved for access';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowed_email on auth.users;
create trigger enforce_allowed_email
  before insert on auth.users
  for each row execute function public.enforce_allowed_email();

-- 4) Activity log: every command a user runs (what, when, and what came back) ---------------------------
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  action      text not null,          -- edge function name, e.g. research, keywordlab, crawl
  request     text,                   -- what the user asked (secrets removed, cut at 4000 chars)
  response    text,                   -- what came back (cut at 20000 chars)
  ok          boolean not null default true,
  error       text,
  duration_ms int,
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_email_time on public.activity_log (email, created_at desc);
create index if not exists activity_log_time on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "users write own activity" on public.activity_log;
create policy "users write own activity" on public.activity_log for insert to authenticated
  with check (user_id = auth.uid() and email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "admin reads all activity" on public.activity_log;
create policy "admin reads all activity" on public.activity_log for select to authenticated
  using (public.is_admin());

-- 5) Admin summary: one row per person (email, last login, number of commands) --------------------------
create or replace function public.admin_user_summary()
returns table (email text, role text, last_login timestamptz, last_activity timestamptz, commands bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select a.email, a.role,
         (select u.last_sign_in_at from auth.users u where lower(u.email) = a.email limit 1),
         (select max(l.created_at) from public.activity_log l where l.email = a.email),
         (select count(*) from public.activity_log l where l.email = a.email)
  from public.allowed_users a
  order by 3 desc nulls last, a.email;
end;
$$;
revoke all on function public.admin_user_summary() from public, anon;
grant execute on function public.admin_user_summary() to authenticated;