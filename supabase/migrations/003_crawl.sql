-- Full-site crawler: one job per crawl, one row per URL (pages to analyse, internal links to check, external links to check).
create table if not exists public.crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  final_url text not null,
  host text not null,
  shared boolean not null default false,
  max_pages int not null default 300,
  render boolean not null default true,
  phase text not null default 'crawl',      -- crawl -> links -> done
  status text not null default 'running',   -- running | done
  skipped int not null default 0,           -- internal URLs found but over the limits
  rendered int not null default 0,          -- pages that needed JavaScript rendering
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crawl_pages (
  job_id uuid not null references public.crawl_jobs(id) on delete cascade,
  url text not null,
  kind text not null default 'page',        -- page | link (internal, status only) | ext (external, status only)
  state text not null default 'queued',     -- queued | working | done
  depth int not null default 0,
  status int,
  page jsonb,
  primary key (job_id, url)
);

create index if not exists crawl_pages_queue on public.crawl_pages (job_id, kind, state, depth);

alter table public.crawl_jobs enable row level security;
alter table public.crawl_pages enable row level security;

drop policy if exists "own crawl jobs" on public.crawl_jobs;
create policy "own crawl jobs" on public.crawl_jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- crawl_pages has no policies on purpose: only the edge functions (service role) read and write it.