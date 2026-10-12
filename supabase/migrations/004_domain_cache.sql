-- Cache of domain popularity (Tranco rank) used for Keyword Difficulty in Domain Research.
-- Written and read only by the edge functions (service role). RLS is on with no policies, so the browser can never touch it.
create table if not exists public.domain_cache (
  domain text primary key,
  tranco_rank int,                       -- null = checked and not in the Tranco top 1 million
  checked_at timestamptz not null default now()
);

create index if not exists domain_cache_checked on public.domain_cache (checked_at);

alter table public.domain_cache enable row level security;