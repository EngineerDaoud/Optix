-- SEOPilot 017: faster "which keywords does this domain already rank for" lookups.
-- The research search now attaches every keyword the data bank already knows for a site (serp_positions) to its keyword table.
-- That lookup filters by domain + country + last_seen, so this index keeps it fast when the bank has millions of rows.
-- Run once: npx supabase db push   (or paste this file in Supabase > SQL Editor > Run). Safe to run again.

create index if not exists serp_positions_domain_seen
  on public.serp_positions (domain, country, last_seen desc);