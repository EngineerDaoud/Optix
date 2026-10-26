-- SEOPilot 015: admin usage view.
-- Per user: websites run, runs, keywords found, last run. Per website: every run with score, date and keywords.
-- Admin only (is_admin() is checked inside every function). Nothing here is readable by normal users.
-- Run once: npx supabase db push   (or paste this whole file in Supabase > SQL Editor > Run)

-- 1) One row per allowed user: totals for the user boxes ---------------------------------------------
create or replace function public.admin_user_usage()
returns table (
  email text, name text, role text,
  last_login timestamptz, last_activity timestamptz, commands bigint,
  websites bigint, runs bigint, keyword_checks bigint, unique_keywords bigint, last_run timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  with au as (
    select a.email as em, a.role as rl, u.id as uid, u.last_sign_in_at as ls,
           coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', '')) as nm
    from public.allowed_users a
    left join auth.users u on lower(u.email) = a.email
  ),
  rr as (
    select r.user_id as uid, count(*) as n_runs, count(distinct r.host) as n_sites,
           coalesce(sum(r.keywords_checked), 0) as kc, max(r.created_at) as last_at
    from public.research_runs r group by r.user_id
  ),
  kw as (
    select r.user_id as uid, count(distinct lower(k ->> 'keyword')) as n
    from public.research_runs r
    cross join lateral jsonb_array_elements(coalesce(r.result -> 'rankings', '[]'::jsonb)) k
    where k ->> 'error' is null
    group by r.user_id
  ),
  cm as (
    select l.email as em, count(*) as n, max(l.created_at) as last_at
    from public.activity_log l group by l.email
  )
  select au.em, coalesce(au.nm, ''), au.rl, au.ls, cm.last_at, coalesce(cm.n, 0),
         coalesce(rr.n_sites, 0), coalesce(rr.n_runs, 0), coalesce(rr.kc, 0)::bigint, coalesce(kw.n, 0), rr.last_at
  from au
  left join rr on rr.uid = au.uid
  left join kw on kw.uid = au.uid
  left join cm on cm.em = au.em
  order by au.ls desc nulls last, au.em;
end;
$$;
revoke all on function public.admin_user_usage() from public, anon;
grant execute on function public.admin_user_usage() to authenticated;

-- 2) All websites one user has run (one row per website) ---------------------------------------------
create or replace function public.admin_user_sites(p_email text)
returns table (
  host text, country text, runs bigint, first_run timestamptz, last_run timestamptz,
  health int, ranked int, keywords_checked int, keyword_checks bigint, unique_keywords bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  return query
  with agg as (
    select r.host as h, count(*) as n, min(r.created_at) as f, coalesce(sum(r.keywords_checked), 0) as kc
    from public.research_runs r where r.user_id = v_uid group by r.host
  ),
  lastr as (
    select distinct on (r.host) r.host as h, r.country as c, r.created_at as t, r.health as hl,
           r.ranked as rk, r.keywords_checked as kchk
    from public.research_runs r where r.user_id = v_uid
    order by r.host, r.created_at desc
  ),
  kw as (
    select r.host as h, count(distinct lower(k ->> 'keyword')) as n
    from public.research_runs r
    cross join lateral jsonb_array_elements(coalesce(r.result -> 'rankings', '[]'::jsonb)) k
    where r.user_id = v_uid and k ->> 'error' is null
    group by r.host
  )
  select agg.h, lastr.c, agg.n, agg.f, lastr.t, lastr.hl, lastr.rk, lastr.kchk, agg.kc::bigint, coalesce(kw.n, 0)
  from agg
  join lastr on lastr.h = agg.h
  left join kw on kw.h = agg.h
  order by lastr.t desc;
end;
$$;
revoke all on function public.admin_user_sites(text) from public, anon;
grant execute on function public.admin_user_sites(text) to authenticated;

-- 3) Every run of one website by one user (score, date, how many keywords) -----------------------------
create or replace function public.admin_site_runs(p_email text, p_host text)
returns table (
  id uuid, created_at timestamptz, country text, depth int,
  health int, ranked int, keywords_checked int, response_ms int, http_status int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  return query
  select r.id, r.created_at, r.country, r.depth, r.health, r.ranked, r.keywords_checked, r.response_ms, r.http_status
  from public.research_runs r
  where r.user_id = v_uid and r.host = p_host
  order by r.created_at desc
  limit 200;
end;
$$;
revoke all on function public.admin_site_runs(text, text) from public, anon;
grant execute on function public.admin_site_runs(text, text) to authenticated;

-- 4) The keywords found in one run (loaded only when the admin opens that run) ---------------------------
create or replace function public.admin_run_keywords(p_run_id uuid)
returns table (keyword text, rank_position int, url text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select k ->> 'keyword', nullif(k ->> 'position', '')::int, k ->> 'url'
  from public.research_runs r
  cross join lateral jsonb_array_elements(coalesce(r.result -> 'rankings', '[]'::jsonb)) k
  where r.id = p_run_id and k ->> 'error' is null
  order by nullif(k ->> 'position', '')::int nulls last, k ->> 'keyword';
end;
$$;
revoke all on function public.admin_run_keywords(uuid) from public, anon;
grant execute on function public.admin_run_keywords(uuid) to authenticated;