-- SEOPilot: AI Visibility check results (saved so a page reload or a re-open costs no AI credits).
-- Run once: npx supabase db push   (or paste this into Supabase > SQL Editor)

create table if not exists public.ai_visibility_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  host text not null,
  score int not null default 0,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_visibility_runs_user_host
  on public.ai_visibility_runs (user_id, host, created_at desc);

alter table public.ai_visibility_runs enable row level security;

-- the browser may read only its own rows (the edge function writes with the service role)
drop policy if exists ai_visibility_runs_select_own on public.ai_visibility_runs;
create policy ai_visibility_runs_select_own on public.ai_visibility_runs
  for select using (auth.uid() = user_id);