import { admin } from "./utils.ts";
import { recordFromSerp } from "./universe.ts";

// SEOPilot data bank (migration 006_data_bank.sql).
// Everything a search finds is saved in YOUR Supabase database and reused:
//   serp_cache            Google top results per keyword + country (3 days)   -> saves Serper credits, any domain's position can be read from it
//   keyword_bank          volume, autocomplete evidence, difficulty, intent   -> same keyword = same number, no new AI call (90 / 30 days)
//   keyword_rank_history  one row per keyword per day per site                -> real rank trend per keyword
//   site_snapshots        traffic / health / link counts per day              -> trend charts
//   backlink_links        every verified link with first seen / last seen / lost
// Every function here is best-effort: if the migration has not been run yet, they return empty results and the app works as before.

export const SERP_TTL_DAYS = 3;
export const VOLUME_TTL_DAYS = 90;
export const EVIDENCE_TTL_DAYS = 30;
export const KD_TTL_DAYS = 14;

const cutoff = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
export const normKw = (k: string) =>
  k.toLowerCase().replace(/\s+/g, " ").trim();
const today = () => new Date().toISOString().slice(0, 10);

async function chunked<T>(
  items: T[],
  size: number,
  fn: (part: T[]) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += size)
    await fn(items.slice(i, i + size));
}

// ---------------------------------------------------------------------------------------------------------
// 1. SERP cache
// ---------------------------------------------------------------------------------------------------------

// Keeps only what the rank checker and the feature detector read, in the same shape Serper returns, so cached and live
// results go through exactly the same code.
export function compactSerp(j: any) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const mark = (v: unknown) =>
    arr(v)
      .slice(0, 5)
      .map(() => ({}));
  return {
    organic: arr(j?.organic)
      .slice(0, 30)
      .map((o: any, i: number) => ({
        position: typeof o?.position === "number" ? o.position : i + 1,
        title: String(o?.title ?? "").slice(0, 160),
        link: String(o?.link ?? ""),
      })),
    ads: mark(j?.ads),
    shopping: mark(j?.shopping),
    videos: mark(j?.videos),
    images: mark(j?.images),
    places: mark(j?.places),
    topStories: mark(j?.topStories),
    peopleAlsoAsk: arr(j?.peopleAlsoAsk)
      .slice(0, 8)
      .map((p: any) => ({ question: String(p?.question ?? "").slice(0, 200) })),
    relatedSearches: arr(j?.relatedSearches)
      .slice(0, 10)
      .map((r: any) => ({ query: String(r?.query ?? "").slice(0, 120) })),
    answerBox: j?.answerBox ? {} : undefined,
    knowledgeGraph: j?.knowledgeGraph ? {} : undefined,
  };
}

export async function serpGet(
  keyword: string,
  gl: string,
  num: number,
): Promise<{ data: any; fetchedAt: string } | null> {
  try {
    const { data } = await admin()
      .from("serp_cache")
      .select("data, num, fetched_at")
      .eq("keyword", normKw(keyword))
      .eq("country", gl)
      .gte("fetched_at", cutoff(SERP_TTL_DAYS))
      .maybeSingle();
    if (!data || (data.num ?? 10) < num || !Array.isArray(data.data?.organic))
      return null;
    return { data: data.data, fetchedAt: data.fetched_at };
  } catch {
    return null;
  }
}

export async function serpPut(
  keyword: string,
  gl: string,
  num: number,
  j: any,
) {
  const compact = compactSerp(j);
  try {
    await admin()
      .from("serp_cache")
      .upsert(
        {
          keyword: normKw(keyword),
          country: gl,
          num,
          data: compact,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "keyword,country" },
      );
  } catch {
    /* cache is optional */
  }
  // permanent copy: every ranking domain and every related keyword is kept forever (migration 010), even after the 3-day cache is replaced
  await recordFromSerp(keyword, gl, compact);
}

// ---------------------------------------------------------------------------------------------------------
// 2. Keyword bank: volume (AI), autocomplete evidence, difficulty
// ---------------------------------------------------------------------------------------------------------

export type BankRow = {
  keyword: string;
  country: string;
  volume_ai: number | null;
  volume: number | null;
  vol_low: number | null;
  vol_high: number | null;
  ac: number | null;
  ac_rank: number | null;
  kd: number | null;
  intent: string | null;
  commercial: boolean | null;
  features: unknown;
  related: unknown;
  volume_checked_at: string | null;
  evidence_checked_at: string | null;
  kd_checked_at: string | null;
  seen_count: number;
  updated_at: string;
};

export async function bankRows(
  keywords: string[],
  country: string,
): Promise<Map<string, BankRow>> {
  const out = new Map<string, BankRow>();
  const list = [...new Set(keywords.map(normKw))].filter(Boolean);
  try {
    await chunked(list, 100, async (part) => {
      const { data } = await admin()
        .from("keyword_bank")
        .select("*")
        .eq("country", country)
        .in("keyword", part);
      for (const r of (data ?? []) as BankRow[]) out.set(r.keyword, r);
    });
  } catch {
    /* bank not created yet */
  }
  return out;
}

const fresh = (iso: string | null | undefined, days: number) =>
  !!iso && Date.parse(iso) >= Date.now() - days * 86_400_000;

/** Raw AI volumes already saved (younger than 90 days): key = "keyword|country". */
export async function bankVolumes(
  keywords: string[],
  countries: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = [...new Set(keywords.map(normKw))].filter(Boolean);
  try {
    for (const c of countries) {
      await chunked(list, 100, async (part) => {
        const { data } = await admin()
          .from("keyword_bank")
          .select("keyword, volume_ai, volume_checked_at")
          .eq("country", c)
          .in("keyword", part)
          .not("volume_ai", "is", null)
          .gte("volume_checked_at", cutoff(VOLUME_TTL_DAYS));
        for (const r of data ?? [])
          out.set(`${r.keyword}|${c}`, Number(r.volume_ai));
      });
    }
  } catch {
    /* bank not created yet */
  }
  return out;
}

export async function saveVolumes(
  items: { keyword: string; country: string; volume_ai: number }[],
) {
  if (!items.length) return;
  const now = new Date().toISOString();
  try {
    await chunked(items, 200, async (part) => {
      await admin()
        .from("keyword_bank")
        .upsert(
          part.map((x) => ({
            keyword: normKw(x.keyword),
            country: x.country,
            volume_ai: x.volume_ai,
            volume_checked_at: now,
            updated_at: now,
          })),
          { onConflict: "keyword,country" },
        );
    });
  } catch {
    /* optional */
  }
}

/** Autocomplete evidence (ac, acRank) saved in the last 30 days. */
export async function bankEvidence(
  keywords: string[],
  country: string,
): Promise<Map<string, { ac: number | null; acRank: number | null }>> {
  const out = new Map<string, { ac: number | null; acRank: number | null }>();
  const rows = await bankRows(keywords, country);
  for (const [k, r] of rows)
    if (fresh(r.evidence_checked_at, EVIDENCE_TTL_DAYS) && r.ac != null)
      out.set(k, { ac: r.ac, acRank: r.ac_rank });
  return out;
}

export async function saveEvidence(
  items: { keyword: string; ac: number | null; acRank: number | null }[],
  country: string,
) {
  const ok = items.filter((x) => x.ac != null);
  if (!ok.length) return;
  const now = new Date().toISOString();
  try {
    await chunked(ok, 200, async (part) => {
      await admin()
        .from("keyword_bank")
        .upsert(
          part.map((x) => ({
            keyword: normKw(x.keyword),
            country,
            ac: x.ac,
            ac_rank: x.acRank,
            evidence_checked_at: now,
            updated_at: now,
          })),
          { onConflict: "keyword,country" },
        );
    });
  } catch {
    /* optional */
  }
}

export type KeywordDetail = {
  keyword: string;
  volume: number;
  volumeLow: number;
  volumeHigh: number;
  kd: number | null;
  intent: string;
  commercial: boolean;
  features?: unknown;
  related?: unknown;
};

/** Final numbers of a keyword after all checks, so the Keyword Lab and the bank list can show them without any new work. */
export async function saveKeywordDetails(
  items: KeywordDetail[],
  country: string,
) {
  if (!items.length) return;
  const now = new Date().toISOString();
  try {
    await chunked(items, 200, async (part) => {
      await admin()
        .from("keyword_bank")
        .upsert(
          part.map((x) => ({
            keyword: normKw(x.keyword),
            country,
            volume: Math.round(x.volume),
            vol_low: Math.round(x.volumeLow),
            vol_high: Math.round(x.volumeHigh),
            kd: x.kd,
            intent: x.intent,
            commercial: x.commercial,
            features: x.features ?? null,
            related: x.related ?? null,
            kd_checked_at: now,
            updated_at: now,
          })),
          { onConflict: "keyword,country" },
        );
    });
  } catch {
    /* optional */
  }
}

/** Remember which keywords this user searched or tracked (the bank is shared, but each user only sees their own list). */
export async function noteLookups(
  userId: string,
  keywords: string[],
  country: string,
  host: string | null,
) {
  const list = [...new Set(keywords.map(normKw))].filter(Boolean).slice(0, 200);
  if (!list.length) return;
  try {
    const { data } = await admin()
      .from("keyword_lookups")
      .select("keyword, lookups")
      .eq("user_id", userId)
      .eq("country", country)
      .in("keyword", list);
    const had = new Map(
      (data ?? []).map((r: { keyword: string; lookups: number }) => [
        r.keyword,
        r.lookups,
      ]),
    );
    const now = new Date().toISOString();
    await admin()
      .from("keyword_lookups")
      .upsert(
        list.map((k) => ({
          user_id: userId,
          keyword: k,
          country,
          host,
          lookups: (had.get(k) ?? 0) + 1,
          last_at: now,
        })),
        { onConflict: "user_id,keyword,country" },
      );
  } catch {
    /* optional */
  }
}

// ---------------------------------------------------------------------------------------------------------
// 3. Rank history + site snapshots
// ---------------------------------------------------------------------------------------------------------

export async function recordRanks(
  userId: string,
  host: string,
  country: string,
  rows: {
    keyword: string;
    position: number | null;
    url: string | null;
    volume: number | null;
    kd: number | null;
  }[],
) {
  if (!rows.length) return;
  const day = today();
  try {
    await chunked(rows, 200, async (part) => {
      await admin()
        .from("keyword_rank_history")
        .upsert(
          part.map((r) => ({
            user_id: userId,
            host,
            country,
            keyword: normKw(r.keyword),
            position: r.position,
            url: r.url,
            volume: r.volume,
            kd: r.kd,
            checked_on: day,
          })),
          { onConflict: "user_id,host,country,keyword,checked_on" },
        );
    });
  } catch {
    /* migration not run yet */
  }
}

export type Trend = {
  prev: number | null;
  hasPrev: boolean;
  series: (number | null)[];
  firstSeen: string | null;
};

/** Earlier positions of each keyword (oldest first, up to `max` points), not counting today. */
export async function rankTrends(
  userId: string,
  host: string,
  country: string,
  keywords: string[],
  max = 10,
): Promise<Map<string, Trend>> {
  const out = new Map<string, Trend>();
  const list = [...new Set(keywords.map(normKw))].filter(Boolean);
  const day = today();
  try {
    const since = new Date(Date.now() - 180 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await chunked(list, 60, async (part) => {
      const { data } = await admin()
        .from("keyword_rank_history")
        .select("keyword, position, checked_on")
        .eq("user_id", userId)
        .eq("host", host)
        .eq("country", country)
        .in("keyword", part)
        .gte("checked_on", since)
        .lt("checked_on", day)
        .order("checked_on", { ascending: false })
        .limit(part.length * max);
      const by = new Map<
        string,
        { position: number | null; checked_on: string }[]
      >();
      for (const r of data ?? [])
        (by.get(r.keyword) ?? by.set(r.keyword, []).get(r.keyword)!).push(r);
      for (const [k, rows] of by) {
        const newest = rows.slice(0, max);
        out.set(k, {
          prev: newest[0]?.position ?? null,
          hasPrev: newest.length > 0,
          series: newest.map((r) => r.position).reverse(),
          firstSeen: rows[rows.length - 1]?.checked_on ?? null,
        });
      }
    });
  } catch {
    /* history not available */
  }
  return out;
}

export type Snapshot = Partial<{
  health: number | null;
  keywords_checked: number | null;
  keywords_ranking: number | null;
  top3: number | null;
  top10: number | null;
  avg_position: number | null;
  visits_low: number | null;
  visits_mid: number | null;
  visits_high: number | null;
  share_of_voice: number | null;
  linking_domains: number | null;
  verified_links: number | null;
  link_score: number | null;
}>;

/** One row per site, country and day. Backlink counts are stored with country = "all" because links do not belong to a country. */
export async function saveSnapshot(
  userId: string,
  host: string,
  country: string,
  snap: Snapshot,
) {
  try {
    await admin()
      .from("site_snapshots")
      .upsert(
        { user_id: userId, host, country, checked_on: today(), ...snap },
        { onConflict: "user_id,host,country,checked_on" },
      );
  } catch {
    /* migration not run yet */
  }
}

// ---------------------------------------------------------------------------------------------------------
// 4. Backlink bank
// ---------------------------------------------------------------------------------------------------------

export type LinkRow = {
  source_key: string;
  source_url: string;
  source_domain: string;
  anchor: string | null;
  rel: string | null;
  authority: number | null;
  target_url: string | null;
  placement: string | null;
};

/** Links already known for this site that have not been marked lost: they are checked again on every run. */
export async function savedLinks(targetRoot: string, limit = 60) {
  try {
    const { data } = await admin()
      .from("backlink_links")
      .select("source_key, source_url, source_domain, authority, last_seen")
      .eq("target_root", targetRoot)
      .is("lost_at", null)
      .order("authority", { ascending: false, nullsFirst: false })
      .limit(limit);
    return (data ?? []) as {
      source_key: string;
      source_url: string;
      source_domain: string;
      authority: number | null;
      last_seen: string;
    }[];
  } catch {
    return [];
  }
}

/** All known source urls (lost or not) for a site: used to tell NEW links from ones seen before. */
export async function knownLinkKeys(
  targetRoot: string,
): Promise<{ keys: Set<string>; lostKeys: Set<string>; total: number }> {
  const keys = new Set<string>(),
    lostKeys = new Set<string>();
  try {
    for (let from = 0; from < 5000; from += 1000) {
      const { data } = await admin()
        .from("backlink_links")
        .select("source_key, lost_at")
        .eq("target_root", targetRoot)
        .range(from, from + 999);
      for (const r of data ?? []) {
        keys.add(r.source_key);
        if (r.lost_at) lostKeys.add(r.source_key);
      }
      if (!data || data.length < 1000) break;
    }
  } catch {
    /* bank not created yet */
  }
  return { keys, lostKeys, total: keys.size };
}

/** Save the links found in this run. first_seen is never overwritten (it is left out of the update); a link that comes back loses its lost_at. */
export async function saveLinks(targetRoot: string, rows: LinkRow[]) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  try {
    await chunked(rows, 200, async (part) => {
      await admin()
        .from("backlink_links")
        .upsert(
          part.map((r) => ({
            target_root: targetRoot,
            source_key: r.source_key,
            source_url: r.source_url,
            source_domain: r.source_domain,
            anchor: r.anchor,
            rel: r.rel,
            authority: r.authority,
            target_url: r.target_url,
            placement: r.placement,
            last_seen: now,
            lost_at: null,
          })),
          { onConflict: "target_root,source_key" },
        );
    });
  } catch {
    /* optional */
  }
}

export async function markLinksLost(targetRoot: string, sourceKeys: string[]) {
  if (!sourceKeys.length) return;
  try {
    await chunked(sourceKeys, 100, async (part) => {
      await admin()
        .from("backlink_links")
        .update({ lost_at: new Date().toISOString() })
        .eq("target_root", targetRoot)
        .is("lost_at", null)
        .in("source_key", part);
    });
  } catch {
    /* optional */
  }
}
