-- SEOPilot data bank: everything a search finds is stored in YOUR database and reused later.
-- Result: fewer Serper / AI calls, the same keyword always shows the same volume, and every site gets history (rank trend, traffic trend, link growth).
-- Tables that hold shared data (keyword_bank, serp_cache, backlink_links) are written and read only by the edge functions (service role).
-- RLS is on with no policies, so the browser can never touch them. Per-user tables have normal "own rows" policies.

-- 1. Keyword bank: one row per keyword + country. Shared by all users, so a keyword searched once is never paid for again.
create table if not exists public.keyword_bank (
  keyword text not null,
  country text not null,
  volume_ai int,                 -- raw AI estimate of monthly searches (kept so repeat runs give the same number)
  volume int,                    -- volume after the autocomplete / ads sanity check
  vol_low int,
  vol_high int,
  ac int,                        -- autocomplete: how many suggestions start with the phrase
  ac_rank int,                   -- autocomplete rank of the phrase (-1 = not suggested)
  kd int,                        -- keyword difficulty 0-100
  intent text,
  commercial boolean,
  features jsonb,                -- ads / shopping / PAA / answer box flags of the result page
  related jsonb,                 -- related searches + people also ask
  volume_checked_at timestamptz,
  evidence_checked_at timestamptz,
  kd_checked_at timestamptz,
  seen_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (keyword, country)
);
create index if not exists keyword_bank_country_vol on public.keyword_bank (country, volume desc);
create index if not exists keyword_bank_search on public.keyword_bank using gin (to_tsvector('simple', keyword));
alter table public.keyword_bank enable row level security;

-- 2. SERP cache: the compact Google top results for a keyword. Any site's position can be worked out from it, so one saved
--    result serves every user and every domain for a few days.
create table if not exists public.serp_cache (
  keyword text not null,
  country text not null,
  num int not null default 10,   -- how many organic results were requested
  data jsonb not null,           -- { organic:[{position,title,link}], ads:n, shopping:n, paa:[...], related:[...], flags:{...} }
  fetched_at timestamptz not null default now(),
  primary key (keyword, country)
);
create index if not exists serp_cache_fetched on public.serp_cache (fetched_at);
alter table public.serp_cache enable row level security;

-- 3. Rank history: one row per keyword per check, so each keyword gets a real trend line (not only "compared with the last run").
create table if not exists public.keyword_rank_history (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  host text not null,
  country text not null,
  keyword text not null,
  position int,                  -- null = not in the checked results
  url text,
  volume int,
  kd int,
  checked_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index if not exists krh_lookup on public.keyword_rank_history (user_id, host, country, keyword, checked_on desc);
-- one row per keyword per day: a second run on the same day replaces the first
create unique index if not exists krh_day on public.keyword_rank_history (user_id, host, country, keyword, checked_on);
alter table public.keyword_rank_history enable row level security;
drop policy if exists "own rank history" on public.keyword_rank_history;
create policy "own rank history" on public.keyword_rank_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Site snapshots: organic traffic estimate, health, ranking keywords and link counts over time (the trend charts).
create table if not exists public.site_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  host text not null,
  country text not null,
  health int,
  keywords_checked int,
  keywords_ranking int,
  top3 int,
  top10 int,
  avg_position numeric,
  visits_low int,
  visits_mid int,
  visits_high int,
  share_of_voice numeric,
  linking_domains int,
  verified_links int,
  link_score int,
  checked_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create unique index if not exists site_snapshots_day on public.site_snapshots (user_id, host, country, checked_on);
alter table public.site_snapshots enable row level security;
drop policy if exists "own snapshots" on public.site_snapshots;
create policy "own snapshots" on public.site_snapshots for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5. Backlink bank: every verified link ever found, with first seen / last seen / lost. Shared across users (it is public web data),
--    which also makes the "link gap" possible: sites that link to a competitor you have already checked, but not to you.
create table if not exists public.backlink_links (
  target_root text not null,     -- the site that is linked TO (root domain)
  source_key text not null,      -- normalised url of the page that holds the link (host + path, no www / utm), used to match runs
  source_url text not null,      -- the real url of that page, opened again on the next run to see if the link is still there
  source_domain text not null,
  anchor text,
  rel text,
  authority int,
  target_url text,
  placement text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  lost_at timestamptz,           -- set when a later run could not find the link any more; cleared if it comes back
  primary key (target_root, source_key)
);
create index if not exists backlink_links_domain on public.backlink_links (target_root, source_domain);
create index if not exists backlink_links_source on public.backlink_links (source_domain);
alter table public.backlink_links enable row level security;

-- 6. Keyword lookups: which keywords YOU searched or tracked. The bank itself is shared (saves credits), but each user only ever
--    sees their own list, so nobody can read what other users research.
create table if not exists public.keyword_lookups (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  keyword text not null,
  country text not null,
  host text,                     -- the site it was tracked for (null = typed into Keyword Lab)
  lookups int not null default 1,
  last_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, keyword, country)
);
create index if not exists keyword_lookups_user on public.keyword_lookups (user_id, last_at desc);
alter table public.keyword_lookups enable row level security;
drop policy if exists "own lookups" on public.keyword_lookups;
create policy "own lookups" on public.keyword_lookups for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Optional housekeeping (run by hand when you want): delete SERP snapshots older than 30 days.
-- delete from public.serp_cache where fetched_at < now() - interval '30 days';