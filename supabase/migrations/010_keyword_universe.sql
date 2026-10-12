-- SEOPilot 010: the keyword universe.
-- Goal: every keyword the tool ever sees (autocomplete, related searches, people-also-ask, keywords scraped from a site,
-- Search Console queries, titles of Google results) is kept FOREVER in your own database, together with every domain that
-- ranked for it. This is how Semrush / Ahrefs built their databases: a growing keyword -> ranking-domains index.
-- From this index the tool can answer "which keywords does domain X rank for" for any domain it has met, without new API calls.
--
-- Run once:  npx supabase db push
-- Everything is shared public web data, written and read only by the edge functions (RLS on, no policies).

-- 1. Keyword universe: one row per keyword + country, with where it came from and how often it was seen.
create table if not exists public.keyword_universe (
  keyword text not null,
  country text not null,
  sources text[] not null default '{}',   -- autocomplete | related | paa | site | gsc | serp_title | lookup
  seed text,                              -- the keyword or site that led to it
  times_seen int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (keyword, country)
);
create index if not exists keyword_universe_country_seen on public.keyword_universe (country, last_seen desc);
create index if not exists keyword_universe_search on public.keyword_universe using gin (to_tsvector('simple', keyword));
alter table public.keyword_universe enable row level security;

-- 2. SERP reverse index: for every saved Google result, every ranking domain with its position.
--    serp_cache is overwritten every few days; this table is not, so it only grows.
create table if not exists public.serp_positions (
  keyword text not null,
  country text not null,
  domain text not null,                   -- root domain (example.co.uk)
  position int not null,                  -- best position the domain had in the latest saved result
  url text,
  title text,
  prev_position int,                      -- position in the result saved before the latest one
  best_position int,                      -- best ever
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (keyword, country, domain)
);
create index if not exists serp_positions_domain on public.serp_positions (domain, country, position);
create index if not exists serp_positions_keyword on public.serp_positions (keyword, country, position);
alter table public.serp_positions enable row level security;

-- 3. Real numbers from Search Console of the sites people connected: the only free source of TRUE search demand.
--    Used to correct the AI volume estimate for every keyword (see calibration below).
alter table public.keyword_bank add column if not exists volume_gsc int;           -- search demand derived from real impressions
alter table public.keyword_bank add column if not exists volume_gsc_at timestamptz;
alter table public.keyword_bank add column if not exists gsc_impressions int;
alter table public.keyword_bank add column if not exists gsc_position numeric;

create table if not exists public.gsc_queries (
  website_id uuid not null references public.websites(id) on delete cascade,
  query text not null,
  country text not null,
  impressions int not null,
  clicks int not null,
  position numeric not null,
  period_end date not null,
  updated_at timestamptz not null default now(),
  primary key (website_id, query, country)
);
create index if not exists gsc_queries_site on public.gsc_queries (website_id, impressions desc);
alter table public.gsc_queries enable row level security;
drop policy if exists "own gsc queries" on public.gsc_queries;
create policy "own gsc queries" on public.gsc_queries for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));

-- 4. Calibration: how far is the AI volume from the truth? Recomputed from keyword_bank rows that have both numbers.
create table if not exists public.calibration (
  name text primary key,                  -- 'volume'
  value jsonb not null,                   -- { factor, samples, p25, p75 }
  updated_at timestamptz not null default now()
);
alter table public.calibration enable row level security;

-- 5. Handy counters for the "Data bank" tab (one cheap call instead of several counts).
create or replace function public.bank_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'universe',  (select count(*) from keyword_universe),
    'bank',      (select count(*) from keyword_bank),
    'with_volume', (select count(*) from keyword_bank where volume is not null),
    'with_gsc',  (select count(*) from keyword_bank where volume_gsc is not null),
    'serp_rows', (select count(*) from serp_positions),
    'domains',   (select count(distinct domain) from serp_positions),
    'serps',     (select count(*) from serp_cache),
    'links',     (select count(*) from backlink_links),
    'link_domains', (select count(distinct source_domain) from backlink_links)
  );
$$;
revoke all on function public.bank_stats() from public, anon, authenticated;
grant execute on function public.bank_stats() to service_role;

-- 6. Helpers used by the keyword difficulty and traffic maths (counts that PostgREST cannot group by itself).
-- How many different sites link to each of these domains (from the verified backlink bank, links not marked lost).
create or replace function public.referring_domain_counts(p_roots text[])
returns table (target_root text, n bigint)
language sql stable security definer set search_path = public as $$
  select target_root, count(distinct source_domain)
  from backlink_links
  where target_root = any(p_roots) and lost_at is null
  group by target_root;
$$;
revoke all on function public.referring_domain_counts(text[]) from public, anon, authenticated;
grant execute on function public.referring_domain_counts(text[]) to service_role;

-- In how many saved Google results does each domain appear in the top 10? (a visibility score built from your own bank)
create or replace function public.domain_visibility(p_domains text[])
returns table (domain text, n bigint)
language sql stable security definer set search_path = public as $$
  select domain, count(*)
  from serp_positions
  where domain = any(p_domains) and position <= 10
  group by domain;
$$;
revoke all on function public.domain_visibility(text[]) from public, anon, authenticated;
grant execute on function public.domain_visibility(text[]) to service_role;