-- SEOPilot schema. Run once (supabase db push, or paste in SQL editor).

create extension if not exists pgcrypto;

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gsc','ga4')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (website_id, provider)
);

-- Tokens live here. RLS is on with NO policies, so only edge functions (service role) can read them.
create table public.integration_secrets (
  website_id uuid not null references public.websites(id) on delete cascade,
  provider text not null,
  secret jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (website_id, provider)
);

create table public.daily_metrics (
  website_id uuid not null references public.websites(id) on delete cascade,
  date date not null,
  source text not null check (source in ('gsc','ga4')),
  data jsonb not null,
  primary key (website_id, date, source)
);

create table public.breakdowns (
  website_id uuid not null references public.websites(id) on delete cascade,
  kind text not null,               -- queries_30, pages_7, channels_15, devices_30 ...
  rows jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (website_id, kind)
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  scores jsonb,                     -- { mobile: {...}, desktop: {...} }
  vitals jsonb,
  issues jsonb not null default '[]',
  pages_crawled int not null default 0,
  psi_error text,
  created_at timestamptz not null default now()
);

create table public.insights (
  website_id uuid primary key references public.websites(id) on delete cascade,
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  range_from date not null,
  range_to date not null,
  summary text,
  html text not null,
  created_at timestamptz not null default now()
);

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null unique references public.websites(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  frequency text not null check (frequency in ('daily','weekly','fifteen','monthly')),
  hour_utc int not null default 5 check (hour_utc between 0 and 23),
  recipients text[] not null default '{}',
  sections text[] not null default '{seo,traffic,sales,speed,ai}',
  active boolean not null default true,
  last_run timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'todo' check (status in ('todo','doing','done')),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

-- Row level security
alter table public.websites enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.breakdowns enable row level security;
alter table public.audits enable row level security;
alter table public.insights enable row level security;
alter table public.reports enable row level security;
alter table public.report_schedules enable row level security;
alter table public.tasks enable row level security;

create policy "own websites" on public.websites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own integrations read" on public.integrations for select using (user_id = auth.uid());
create policy "own reports" on public.reports for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own schedules" on public.report_schedules for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own tasks" on public.tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own metrics read" on public.daily_metrics for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));
create policy "own breakdowns read" on public.breakdowns for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));
create policy "own audits read" on public.audits for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));
create policy "own insights read" on public.insights for select
  using (exists (select 1 from public.websites w where w.id = website_id and w.user_id = auth.uid()));

create index on public.daily_metrics (website_id, date);
create index on public.audits (website_id, created_at desc);
create index on public.reports (website_id, created_at desc);

-- Optional: hourly scheduler (needs pg_cron + pg_net enabled in Dashboard > Database > Extensions).
-- Replace PROJECT_REF and CRON_SECRET, then run once:
--
-- select cron.schedule('seopilot-hourly', '0 * * * *', $$
--   select net.http_post(
--     url := 'https://PROJECT_REF.supabase.co/functions/v1/scheduled',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"CRON_SECRET"}'::jsonb,
--     body := '{}'::jsonb
--   );
-- $$);
