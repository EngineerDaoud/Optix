-- SEOPilot: Daily / Weekly / Monthly history of your full checks (site health, keywords ranking, keyword movement).
-- Run once: npx supabase db push
-- grain = 'day' | 'week' (Monday start) | 'month'. One row per period: the LAST check of that period,
-- how many checks were made in it, and how many keywords were gained (+) or lost (-) compared with the period before.
-- Runs as the signed-in user, so row level security on research_runs still applies.

create or replace function public.check_rollup(p_host text, p_country text, p_grain text, p_from date)
returns table (period date, health int, ranked int, checks int, change int)
language plpgsql stable security invoker as $$
begin
  if p_grain not in ('day', 'week', 'month') then raise exception 'grain must be day, week or month'; end if;
  return query
  with runs as (
    select date_trunc(p_grain, r.created_at)::date as p, r.health as h, r.ranked as k, r.created_at as ts
    from public.research_runs r
    where r.host = p_host and r.country = p_country and r.created_at >= p_from::timestamptz
  ), per as (
    select distinct on (runs.p) runs.p, runs.h, runs.k from runs order by runs.p, runs.ts desc
  ), agg as (
    select runs.p, count(*)::int as c, (array_agg(runs.k order by runs.ts))[1] as first_k from runs group by runs.p
  )
  select per.p, per.h, per.k, agg.c,
    case
      when lag(per.k) over (order by per.p) is null and agg.c < 2 then null
      else (coalesce(per.k, 0) - coalesce(lag(per.k) over (order by per.p), agg.first_k, 0))::int
    end
  from per join agg on agg.p = per.p
  order by per.p;
end $$;

grant execute on function public.check_rollup(text, text, text, date) to authenticated;