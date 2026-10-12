-- Free traffic tracker for ANY website (competitors). Uses the public Tranco rank (daily, free, no key) to build a rough estimate.
-- Run once: npx supabase db push

create table if not exists public.competitor_sites (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  host text not null,
  added_at timestamptz not null default now(),
  last_checked_at timestamptz,
  primary key (user_id, host)
);

create table if not exists public.competitor_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  host text not null,
  date date not null,
  tranco_rank int,                 -- null = not in the Tranco top 1 million that day
  est_monthly_visits bigint,       -- rough estimate, monthly equivalent, derived from the rank
  primary key (user_id, host, date)
);
create index if not exists competitor_daily_lookup on public.competitor_daily (user_id, host, date);

alter table public.competitor_sites enable row level security;
alter table public.competitor_daily enable row level security;
drop policy if exists "own competitor sites" on public.competitor_sites;
create policy "own competitor sites" on public.competitor_sites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own competitor daily read" on public.competitor_daily;
create policy "own competitor daily read" on public.competitor_daily for select using (user_id = auth.uid());