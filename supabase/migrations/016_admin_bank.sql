-- SEOPilot 016: admin "data bank" overview.
-- How many keywords the database has collected so far, plus a per-country breakdown
-- (keywords seen, keywords with full data, saved Google results, sites tracked, ranking keywords, top 3 / top 10).
-- Admin only. Run once: npx supabase db push   (or paste this file in Supabase > SQL Editor > Run)

create or replace function public.admin_bank_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  with u as (
    select country, count(*) as n from public.keyword_universe group by country
  ),
  b as (
    select country, count(*) as n, count(*) filter (where volume is not null) as vol
    from public.keyword_bank group by country
  ),
  s as (
    select country, count(*) as n, count(distinct domain) as d from public.serp_positions group by country
  ),
  lr as (   -- the latest run of every user + website + country
    select distinct on (r.user_id, r.host, r.country) r.user_id, r.host, r.country, r.ranked, r.result
    from public.research_runs r
    order by r.user_id, r.host, r.country, r.created_at desc
  ),
  rk as (
    select lr.country,
           count(*) as sites,
           coalesce(sum(lr.ranked), 0) as ranking,
           coalesce(sum((select count(*) from jsonb_array_elements(coalesce(lr.result -> 'rankings', '[]'::jsonb)) k
                         where k ->> 'error' is null and nullif(k ->> 'position', '')::int <= 3)), 0) as top3,
           coalesce(sum((select count(*) from jsonb_array_elements(coalesce(lr.result -> 'rankings', '[]'::jsonb)) k
                         where k ->> 'error' is null and nullif(k ->> 'position', '')::int <= 10)), 0) as top10
    from lr group by lr.country
  ),
  c as (
    select country from u union select country from b union select country from s union select country from rk
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'universe',     (select count(*) from public.keyword_universe),
      'bank',         (select count(*) from public.keyword_bank),
      'with_volume',  (select count(*) from public.keyword_bank where volume is not null),
      'with_gsc',     (select count(*) from public.keyword_bank where volume_gsc is not null),
      'serps',        (select count(*) from public.serp_cache),
      'serp_rows',    (select count(*) from public.serp_positions),
      'domains',      (select count(distinct domain) from public.serp_positions),
      'links',        (select count(*) from public.backlink_links),
      'runs',         (select count(*) from public.research_runs)
    ),
    'countries', coalesce(jsonb_agg(jsonb_build_object(
      'country',  c.country,
      'universe', coalesce(u.n, 0),
      'bank',     coalesce(b.n, 0),
      'with_volume', coalesce(b.vol, 0),
      'serp_rows',   coalesce(s.n, 0),
      'domains',     coalesce(s.d, 0),
      'sites',    coalesce(rk.sites, 0),
      'ranking',  coalesce(rk.ranking, 0),
      'top3',     coalesce(rk.top3, 0),
      'top10',    coalesce(rk.top10, 0)
    ) order by coalesce(b.n, 0) desc, coalesce(u.n, 0) desc), '[]'::jsonb)
  ) into v
  from c
  left join u on u.country = c.country
  left join b on b.country = c.country
  left join s on s.country = c.country
  left join rk on rk.country = c.country;

  return v;
end;
$$;
revoke all on function public.admin_bank_overview() from public, anon;
grant execute on function public.admin_bank_overview() to authenticated;