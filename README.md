# SEOPilot

Website monitoring tool: add a site, run a speed + SEO audit, connect Google Search Console and
Analytics 4, get a dashboard, AI insights, tasks, and daily / weekly / 15-day / monthly PDF reports.

Stack: React + Vite + Tailwind (frontend), Supabase (Postgres, Auth, Edge Functions).

## Folder layout

```
seopilot/
  package.json  index.html  vite.config.ts  tsconfig.json  tailwind.config.js  postcss.config.js  .env.example
  src/
    main.tsx  App.tsx  index.css  vite-env.d.ts
    lib/        supabase.ts  format.ts
    context/    Auth.tsx  Site.tsx
    components/ Layout.tsx  ui.tsx
    pages/      Login  Welcome  Dashboard  Audit  Integrations  Reports  Tasks  Settings  (.tsx)
  supabase/
    config.toml  secrets.example.env
    migrations/001_init.sql
    functions/
      _shared/   utils.ts  google.ts  kpi.ts  ai.ts  sync.ts  report.ts
      google/index.ts  sync/index.ts  audit/index.ts  insights/index.ts  report/index.ts  scheduled/index.ts
```

## Setup (Windows, PowerShell)

1. **Supabase project**: create one at supabase.com. Copy the Project URL and the anon key
   (Project Settings > API) into `.env` (copy from `.env.example`).
2. **Database**:
   ```
   npm install
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```
3. **Google Cloud** (console.cloud.google.com), one project:
   - Enable APIs: *Google Search Console API*, *Google Analytics Data API*, *Google Analytics Admin API*, *PageSpeed Insights API*.
   - OAuth consent screen: External. Add scopes `webmasters.readonly` and `analytics.readonly`.
     While in Testing mode, add your own Google account (and clients' accounts) under Test users.
     To let anyone connect, submit the app for verification (this can take days to weeks).
   - Credentials > Create OAuth client ID > Web application. Authorized redirect URI:
     `https://YOUR-PROJECT-REF.supabase.co/functions/v1/google`
4. **Secrets**: copy `supabase/secrets.example.env` to `supabase/secrets.env`, fill it in, then:
   ```
   npx supabase secrets set --env-file supabase/secrets.env
   ```
5. **Deploy the edge functions**:
   ```
   npx supabase functions deploy google sync audit insights report scheduled overview crawl research backlinks keywordlab
   ```
6. **Run**: `npm run dev`, open http://localhost:5173, sign up, add a website.
7. **Nightly sync + scheduled reports** (optional): enable the `pg_cron` and `pg_net` extensions in
   Supabase (Database > Extensions), then run the commented `cron.schedule` block at the bottom of
   `001_init.sql` in the SQL editor with your project ref and `CRON_SECRET`.
   It runs hourly: syncs all sites at 02:00 UTC and sends any report that is due.

## Domain Research: keyword, traffic and competitor system

Works for any public site. Pick what the numbers should cover:

- **This country only**: one Google country (cheapest, cleanest).
- **Worldwide (top 6 markets)**: the home country plus 5 big markets, positions checked in each (about 25 extra Serper credits).
- **By content topic**: same data, opened on the topic view (keywords grouped by their main word: demand, rank and difficulty per topic).

What each run produces (all from free signals, and every guess is labelled as an estimate in the UI):

| Metric | How it is built |
| --- | --- |
| Position | Real Google result via Serper |
| Searches per month + likely range | AI estimate, corrected by Google autocomplete (count and rank) and ads / shopping boxes; more agreeing signals = narrower range |
| Keyword Difficulty 0-100 | Strength of the top-10 domains (Tranco rank, cached 30 days), home pages in the top 10, how many titles match the exact phrase, ads and shopping. No backlinks, so it runs lower than Ahrefs / Semrush on link-heavy SERPs |
| Visits per month | searches x click rate at the position x SERP-feature factor (ads, answer box, maps lower the click rate) |
| Growth potential | the same maths with every keyword moved to #3 and #1 |
| Intent | rules on the phrase (transactional, commercial, informational, navigational) |
| Opportunity 0-100 + action | traffic you could gain, ease, and demand; tags: Quick win, New content, Push up, Defend, Long shot |
| Share of voice | searches x click rate for every domain in the checked results |
| Changes | compared with the previous saved run of the same site and country: improved, dropped, newly ranking, lost, health and visits change |
| Keyword ideas | Google autocomplete a-z and question words, with estimated volume and intent |

Run `supabase/migrations/004_domain_cache.sql` (`npx supabase db push`) once for the domain cache. Without it everything still works, just slower.

## Data bank (your own keyword, rank and link database)

Run `supabase/migrations/006_data_bank.sql` once (`npx supabase db push`) and deploy the `research`, `backlinks` and new `keywordlab` functions.
From then on everything a search finds is saved in your Supabase database and reused. Without the migration the app works exactly as before.

| Saved data | Kept for | What it gives you |
| --- | --- | --- |
| Google top results per keyword + country (`serp_cache`) | 3 days | Repeat checks cost no Serper credits. Any site's position can be read from one saved result. "Re-run with fresh data" skips it. |
| Search volume per keyword + country (`keyword_bank`) | 90 days | The same keyword always shows the same number (before, the AI gave a slightly different number every run, which looked like fake changes), and no new AI call. |
| Autocomplete evidence, difficulty, intent | 30 / 14 days | Faster runs, and the Keyword Lab can show them instantly. |
| Position of every keyword, every day (`keyword_rank_history`) | forever | A real trend line per keyword (Trend column in the Keywords tab, Rank history in Keyword Lab). |
| Daily snapshot: health, ranking keywords, top 10, estimated visits, linking domains (`site_snapshots`) | forever | Trend charts. |
| Every verified backlink with first seen / last seen / lost (`backlink_links`) | forever | Links found on earlier runs are opened again, so removed links are noticed and the list keeps growing. "Lost" now means the page was opened and the link is gone (before, any link missing from a different search sample counted as lost). |

**Keyword Lab** (new page in the sidebar):

- **Explore keywords**: type up to 5 keywords and get the estimated volume with a likely range, difficulty, intent, SERP features, the top 10 results with the strength of each site, related searches and autocomplete ideas. Saved keywords answer instantly.
- **My keyword bank**: every keyword you searched or tracked, with the saved numbers, filter, sort and CSV export.
- **Rank history**: position trend per keyword and charts for estimated visits, ranking keywords, site health and backlink growth.
- **Link gap**: sites that link to a competitor but not to you (built from the link bank; check the competitor's backlinks once and they stay saved).

The Serper results and keyword numbers are public data and are shared between your users to save credits. Each user only sees the keywords they searched themselves (`keyword_lookups`), and the shared tables have no browser access.

## Notes

- Never commit or share `.env` and `supabase/secrets.env`: they hold real API keys. Rotate any key that has been shared.

- Google tokens are stored in `integration_secrets`, which has no RLS policies, so the browser can never read them.
- Sales and orders come from GA4 (`transactions`, `purchaseRevenue`). Make sure ecommerce purchase tracking is on for the store.
  GA4 numbers are usually a bit lower than Shopify's exact numbers.
- Search Console data lags 2 to 3 days, so the newest days can look empty.
- The dashboard tables (top queries / pages / channels) are stored per period (7, 15, 30 days) at sync time.
- Scheduled reports are emailed through Resend if `RESEND_API_KEY` is set. Without it they are still saved under Reports.
- Not built yet: Shopify, Microsoft Clarity, Semrush, ClickUp sync, WhatsApp/Slack delivery.

## Traffic history (daily / weekly / monthly, organic split)

Run `npx supabase db push` (adds `007_traffic_history.sql`), then `npx supabase functions deploy sync scheduled`.
Open **Traffic** in the sidebar and press **Load full history**: every day of Google Analytics traffic (split by channel, organic included)
is saved in `traffic_daily`, and Search Console clicks go back up to 16 months. After that the nightly sync refreshes the last 14 days automatically.

## Competitor traffic (any website, free)

Run `npx supabase db push` (adds `008_competitor_traffic.sql`) and `npx supabase functions deploy competitor scheduled`.
Open **Competitor traffic**, type any website and press Track website. The free Tranco rank of the last 30 days is saved at once and a new day is added every night
(the hourly `scheduled` job runs it at 03:00 UTC). Visits are a rough estimate built from the rank; websites outside the top 1 million cannot be estimated.

## Automatic Google Analytics (users never sign in with Google)

When a user adds a website, SEOPilot creates a GA4 property + web stream for it inside YOUR Analytics account and shows the tracking snippet on
**Integrations** (Automatic Analytics). The user pastes it before `</head>`; visits flow into that property and SEOPilot reads them back
(dashboard, Traffic page, nightly sync, reports). A plain Google "API key" cannot do this, it needs a free **service account**.

One-time setup:

1. Google Cloud (same project as before): enable **Google Analytics Admin API** and **Google Analytics Data API**.
2. IAM & Admin > Service Accounts > Create. Open it > Keys > Add key > JSON. A `.json` file downloads.
3. analytics.google.com > Admin > Account access management > add the service account's email (`...@...iam.gserviceaccount.com`) as **Editor**.
4. Turn the JSON file into one line of base64 (PowerShell) and put it in `supabase/secrets.env` as `GA_SERVICE_ACCOUNT=`:
   ```
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.json"))
   ```
   Optional: `GA_ACCOUNT_ID` (your Analytics account number), `GA_TIMEZONE`, `GA_CURRENCY`, `MANAGED_GA_PER_USER`.
5. ```
   npx supabase secrets set --env-file supabase/secrets.env
   npx supabase db push
   npx supabase functions deploy gaprovision google sync research backlinks keywordlab
   ```

Things to know:

- Data counts only from the day the snippet is installed. Realtime shows in about a minute; full-day numbers can take up to 48 hours.
- Google limits how many properties one Analytics account can hold (about 2,000 at the time of writing, check the current Analytics docs). Removing a website deletes its property (Google keeps it 35 days).
- The visitors of your users' websites are measured inside YOUR Analytics account. Say so in your privacy policy and terms, and check Google's Analytics terms for data collected on behalf of customers.
- Users can still connect their own Google (Search Console keywords and clicks). That is separate and keeps working next to automatic Analytics.

## Daily free limits (keeps Serper / AI credits alive)

`npx supabase db push` adds `009_daily_quota.sql`. New website reports, keyword lookups and backlink scans count against a per-user daily limit
(defaults 5 / 30 / 5, set with `QUOTA_RESEARCH_PER_DAY`, `QUOTA_KEYWORDS_PER_DAY`, `QUOTA_BACKLINKS_PER_DAY`; 0 = no limit).
Saved results (7-day report cache and the data bank) are answered first and never counted. Put your own email in `ADMIN_EMAILS` to be unlimited.

## Keyword universe and calibration (migration 010)

Run `npx supabase db push` once, then redeploy: `npx supabase functions deploy research keywordlab backlinks overview`.

| What | Where it is saved | What it does |
| --- | --- | --- |
| Every keyword ever seen (autocomplete, related searches, people-also-ask, keywords found on a site, Search Console queries) | `keyword_universe` | Kept forever with its source and how often it was seen. Download it from Keyword Lab > Data bank (ADMIN_EMAILS only). |
| Every domain that ranked for a saved Google result | `serp_positions` | Permanent reverse index (keyword -> domains). `serp_cache` is overwritten every few days, this table only grows. A domain's traffic now counts every keyword the bank knows for it instead of a scale-up guess. |
| Real Search Console queries of connected sites | `gsc_queries`, `keyword_bank.volume_gsc` | True search demand = impressions / share of searches where that position is shown. Overrides the AI volume for that keyword. |
| Volume correction | `calibration` | Median of true / AI over every keyword that has both numbers (needs 15). Applied to all other AI volumes. Refreshed daily. |
| Keyword Difficulty | `backlink_links`, `serp_positions` | Domain strength = Tranco, raised (never lowered) by referring domains from the link bank and by top-10 appearances in the bank. |

Set `ADMIN_EMAILS` (your login email) in `supabase/secrets.env` to open the full universe and to run recalibration.

Honest limits: Semrush and Ahrefs own crawlers and clickstream panels. Without them, numbers for sites you do not own stay estimates; they get better as the bank grows and as more sites with Search Console are connected. For your own sites, Search Console and GA4 numbers are real.