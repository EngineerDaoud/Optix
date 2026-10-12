-- Backlink discovery: one saved result per run, so the dashboard can show the last result without spending Serper credits again.
create table if not exists public.backlink_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  host text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists backlink_runs_lookup on public.backlink_runs (user_id, host, created_at desc);
alter table public.backlink_runs enable row level security;
drop policy if exists "own backlink runs" on public.backlink_runs;
create policy "own backlink runs" on public.backlink_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());