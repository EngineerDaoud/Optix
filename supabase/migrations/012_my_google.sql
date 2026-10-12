-- One Google sign-in per SEOPilot user. Every website you analyze is matched against the
-- Analytics (GA4) and Search Console properties that Google account can already see.
-- RLS is on with NO policies: only edge functions (service role) can read these tables.

create table if not exists public.google_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  email text,
  updated_at timestamptz not null default now()
);

-- Remembers which GA4 property / Search Console site belongs to which host, so matching is fast next time.
create table if not exists public.google_site_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  host text not null,
  gsc_site text,
  ga_property text,
  ga_name text,
  checked_at timestamptz not null default now(),
  primary key (user_id, host)
);

alter table public.google_accounts enable row level security;
alter table public.google_site_map enable row level security;