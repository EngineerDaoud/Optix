-- Domain Research: saved reports (one row per run). Also used for the history and uptime charts.
create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  host text not null,
  country text not null,
  depth int not null default 10,
  health int,
  ranked int,
  keywords_checked int,
  response_ms int,
  http_status int,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists research_runs_lookup on public.research_runs (user_id, host, country, created_at desc);

alter table public.research_runs enable row level security;

drop policy if exists "own research runs" on public.research_runs;
create policy "own research runs" on public.research_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());