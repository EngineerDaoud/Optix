-- SEOPilot traffic history: every day of GA4 traffic (split by channel) is stored in YOUR database forever.
-- Run once: npx supabase db push

create table if not exists public.traffic_daily (
  website_id uuid not null references public.websites(id) on delete cascade,
  date date not null,
  channel text not null,               -- GA4 default channel group: Organic Search, Direct, Referral, Organic Social, Paid Search, Email ...
  sessions int not null default 0,
  users int not null default 0,
  new_users int not null default 0,
  pageviews int not null default 0,
  engaged_sessions int not null default 0,
  primary key (website_id, date, channel)
);
create index if not exists traffic_daily_site_date on public.traffic_daily (website_id, date);
alter table public.traffic_daily enable row level security;
drop policy if exists "own traffic read" on public.traffic_daily;
create policy "own traffic read" on public.traffic_daily for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));

alter table public.websites add column if not exists traffic_start date;          -- first day that had any visit
alter table public.websites add column if not exists traffic_backfilled_at timestamptz;

-- Daily / weekly / monthly totals. grain = 'day' | 'week' (Monday start) | 'month'.
-- Runs as the signed-in user, so row level security still applies.
create or replace function public.traffic_rollup(p_website uuid, p_grain text, p_from date, p_to date)
returns table (
  period date, sessions bigint, users bigint, new_users bigint, pageviews bigint,
  organic bigint, direct bigint, referral bigint, social bigint, paid bigint, email bigint, other bigint,
  gsc_clicks bigint, gsc_impressions bigint
)
language plpgsql stable security invoker as $$
begin
  if p_grain not in ('day', 'week', 'month') then raise exception 'grain must be day, week or month'; end if;
  return query
  with g as (
    select date_trunc(p_grain, t.date)::date as p,
      sum(t.sessions)::bigint s, sum(t.users)::bigint u, sum(t.new_users)::bigint nu, sum(t.pageviews)::bigint pv,
      (sum(t.sessions) filter (where t.channel = 'Organic Search'))::bigint o,
      (sum(t.sessions) filter (where t.channel = 'Direct'))::bigint d,
      (sum(t.sessions) filter (where t.channel = 'Referral'))::bigint r,
      (sum(t.sessions) filter (where t.channel = 'Organic Social'))::bigint so,
      (sum(t.sessions) filter (where t.channel like 'Paid%' or t.channel in ('Display', 'Cross-network', 'Affiliates')))::bigint pa,
      (sum(t.sessions) filter (where t.channel = 'Email'))::bigint em
    from public.traffic_daily t
    where t.website_id = p_website and t.date between p_from and p_to
    group by 1
  ), s as (
    select date_trunc(p_grain, m.date)::date as p,
      sum((m.data->>'clicks')::numeric)::bigint c, sum((m.data->>'impressions')::numeric)::bigint i
    from public.daily_metrics m
    where m.website_id = p_website and m.source = 'gsc' and m.date between p_from and p_to
    group by 1
  )
  select coalesce(g.p, s.p), coalesce(g.s, 0), coalesce(g.u, 0), coalesce(g.nu, 0), coalesce(g.pv, 0),
    coalesce(g.o, 0), coalesce(g.d, 0), coalesce(g.r, 0), coalesce(g.so, 0), coalesce(g.pa, 0), coalesce(g.em, 0),
    greatest(coalesce(g.s, 0) - coalesce(g.o, 0) - coalesce(g.d, 0) - coalesce(g.r, 0) - coalesce(g.so, 0) - coalesce(g.pa, 0) - coalesce(g.em, 0), 0),
    coalesce(s.c, 0), coalesce(s.i, 0)
  from g full join s on g.p = s.p
  order by 1;
end $$;