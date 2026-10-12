import { admin } from "./utils.ts";
import { isShared, rootDomain } from "./siteinfo.ts";
import { isJunkPhrase } from "./keywords.ts";

// SEOPilot keyword universe (migration 010_keyword_universe.sql).
// What this file does, in plain words:
//   1. recordUniverse     every keyword the tool ever sees is kept forever (autocomplete, related, people-also-ask, site, Search Console)
//   2. recordSerpPositions every saved Google result is turned into "domain X ranked at position N for keyword K" and kept forever.
//                         This is the same idea Semrush and Ahrefs use: a growing keyword -> ranking-domains index.
//   3. recordGscTruth     real impressions from Search Console of connected sites = the only free source of TRUE search demand
//   4. loadCalibration    compares the AI volume with that truth and learns a correction factor, used for every other keyword
//   5. bankDomainKeywords every keyword the bank knows a domain ranks for (replaces the old guess "checked keywords x coverage")
//   6. boostStrengths     adds backlink counts and bank visibility to the domain strength used by Keyword Difficulty
// Everything is best-effort: if migration 010 has not been run, each function returns an empty result and the app works as before.

const norm = (k: string) => k.toLowerCase().replace(/\s+/g, " ").trim();
const cutoff = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

async function chunked<T>(
  items: T[],
  size: number,
  fn: (part: T[]) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += size)
    await fn(items.slice(i, i + size));
}

/** Root domain of a host. Free-hosting names (x.vercel.app, x.blogspot.com) stay whole because every subdomain is a different site. */
export function domainKey(host: string) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return isShared(h) ? h : rootDomain(h);
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------------------------------------
// 1. Keyword universe
// ---------------------------------------------------------------------------------------------------------

export type UniverseSource =
  "autocomplete" | "related" | "paa" | "site" | "gsc" | "lookup";
export type UniverseItem = {
  keyword: string;
  country: string;
  source: UniverseSource;
  seed?: string | null;
};

const usable = (k: string) =>
  k.length >= 2 &&
  k.length <= 90 &&
  k.split(" ").length <= 9 &&
  !/https?:|www\.|@/.test(k) &&
  !isJunkPhrase(k);

export async function recordUniverse(items: UniverseItem[]) {
  if (!items.length) return;
  const seen = new Map<string, UniverseItem>();
  for (const it of items) {
    const keyword = norm(it.keyword);
    if (!usable(keyword)) continue;
    const key = `${keyword}|${it.country}`;
    if (!seen.has(key)) seen.set(key, { ...it, keyword });
  }
  const list = [...seen.values()].slice(0, 600);
  if (!list.length) return;
  const now = new Date().toISOString();
  try {
    const byCountry = new Map<string, UniverseItem[]>();
    for (const it of list)
      (
        byCountry.get(it.country) ??
        byCountry.set(it.country, []).get(it.country)!
      ).push(it);
    for (const [country, rows] of byCountry) {
      await chunked(rows, 150, async (part) => {
        const { data } = await admin()
          .from("keyword_universe")
          .select("keyword, sources, times_seen, seed")
          .eq("country", country)
          .in(
            "keyword",
            part.map((x) => x.keyword),
          );
        const had = new Map(
          (data ?? []).map(
            (r: {
              keyword: string;
              sources: string[];
              times_seen: number;
              seed: string | null;
            }) => [r.keyword, r],
          ),
        );
        await admin()
          .from("keyword_universe")
          .upsert(
            part.map((x) => {
              const e = had.get(x.keyword);
              return {
                keyword: x.keyword,
                country,
                sources: [...new Set([...(e?.sources ?? []), x.source])],
                seed: e?.seed ?? x.seed ?? null,
                times_seen: (e?.times_seen ?? 0) + 1,
                last_seen: now,
              };
            }),
            { onConflict: "keyword,country" },
          );
      });
    }
  } catch {
    /* migration 010 not run yet */
  }
}

// ---------------------------------------------------------------------------------------------------------
// 2. SERP reverse index (domain -> keywords it ranks for)
// ---------------------------------------------------------------------------------------------------------

type CompactSerp = {
  organic?: { position?: number; title?: string; link?: string }[];
  relatedSearches?: { query?: string }[];
  peopleAlsoAsk?: { question?: string }[];
};

/** Called by serpPut for every fresh Google result. Keeps the best position per domain, the previous position and the best ever. */
export async function recordFromSerp(
  keyword: string,
  country: string,
  serp: CompactSerp,
) {
  const kw = norm(keyword);
  try {
    const best = new Map<
      string,
      { position: number; url: string; title: string }
    >();
    (serp.organic ?? []).forEach((o, idx) => {
      const h = hostOf(o.link ?? "");
      if (!h) return;
      const d = domainKey(h);
      const position = typeof o.position === "number" ? o.position : idx + 1;
      const e = best.get(d);
      if (!e || position < e.position)
        best.set(d, {
          position,
          url: o.link ?? "",
          title: String(o.title ?? "").slice(0, 160),
        });
    });
    const jobs: Promise<unknown>[] = [];
    if (best.size) {
      jobs.push(
        (async () => {
          const { data } = await admin()
            .from("serp_positions")
            .select("domain, position, best_position")
            .eq("keyword", kw)
            .eq("country", country);
          const had = new Map(
            (data ?? []).map(
              (r: {
                domain: string;
                position: number;
                best_position: number | null;
              }) => [r.domain, r],
            ),
          );
          const now = new Date().toISOString();
          await admin()
            .from("serp_positions")
            .upsert(
              [...best.entries()].map(([domain, v]) => {
                const e = had.get(domain);
                return {
                  keyword: kw,
                  country,
                  domain,
                  position: v.position,
                  url: v.url,
                  title: v.title,
                  prev_position: e?.position ?? null,
                  best_position: Math.min(v.position, e?.best_position ?? 999),
                  last_seen: now,
                };
              }),
              { onConflict: "keyword,country,domain" },
            );
        })(),
      );
    }
    const ideas: UniverseItem[] = [
      { keyword: kw, country, source: "lookup" },
      ...(serp.relatedSearches ?? []).map((r) => ({
        keyword: String(r?.query ?? ""),
        country,
        source: "related" as const,
        seed: kw,
      })),
      ...(serp.peopleAlsoAsk ?? []).map((p) => ({
        keyword: String(p?.question ?? ""),
        country,
        source: "paa" as const,
        seed: kw,
      })),
    ];
    jobs.push(recordUniverse(ideas));
    await Promise.all(jobs);
  } catch {
    /* optional */
  }
}

// ---------------------------------------------------------------------------------------------------------
// 3. Search Console truth
// ---------------------------------------------------------------------------------------------------------

// Search Console uses 3-letter country codes
const ISO3: Record<string, string> = {
  usa: "us",
  gbr: "gb",
  ind: "in",
  pak: "pk",
  can: "ca",
  aus: "au",
  deu: "de",
  fra: "fr",
  are: "ae",
  sau: "sa",
  nzl: "nz",
  irl: "ie",
  zaf: "za",
  nga: "ng",
  bra: "br",
  mex: "mx",
  esp: "es",
  ita: "it",
  nld: "nl",
  tur: "tr",
  idn: "id",
  phl: "ph",
  mys: "my",
  sgp: "sg",
  bgd: "bd",
  lka: "lk",
  npl: "np",
  egy: "eg",
  qat: "qa",
  kwt: "kw",
  omn: "om",
  bhr: "bh",
  jor: "jo",
  swe: "se",
  nor: "no",
  dnk: "dk",
  fin: "fi",
  pol: "pl",
  prt: "pt",
  bel: "be",
  che: "ch",
  aut: "at",
  rus: "ru",
  ukr: "ua",
  jpn: "jp",
  kor: "kr",
  hkg: "hk",
  tha: "th",
  vnm: "vn",
  ken: "ke",
  gha: "gh",
  tza: "tz",
};
export const iso2 = (c: string) => ISO3[c.toLowerCase()] ?? null;

// Share of searches in which a result at this average position was actually shown (page 1 almost always, later pages rarely).
const shown = (p: number) =>
  p <= 10 ? 0.9 : p <= 20 ? 0.35 : p <= 30 ? 0.1 : 0.03;

/** Monthly search demand implied by real impressions. Only trusted for positions 1-20 and at least 20 impressions. */
export function volumeFromGsc(
  impressions: number,
  position: number,
): number | null {
  if (impressions < 20 || position > 20) return null;
  return Math.max(10, Math.round(impressions / shown(position)));
}

export type GscRow = {
  query: string;
  country: string;
  impressions: number;
  clicks: number;
  position: number;
};

/** Saves the Search Console queries of a connected site, and turns them into true volumes in the keyword bank. */
export async function recordGscTruth(
  websiteId: string,
  rows: GscRow[],
  periodEnd: string,
) {
  const ok = rows.filter((r) => iso2(r.country) && usable(norm(r.query)));
  if (!ok.length) return 0;
  const now = new Date().toISOString();
  try {
    const cleaned = ok.map((r) => ({
      ...r,
      query: norm(r.query),
      cc: iso2(r.country)!,
    }));
    await chunked(cleaned, 300, async (part) => {
      await admin()
        .from("gsc_queries")
        .upsert(
          part.map((r) => ({
            website_id: websiteId,
            query: r.query,
            country: r.cc,
            impressions: Math.round(r.impressions),
            clicks: Math.round(r.clicks),
            position: Math.round(r.position * 10) / 10,
            period_end: periodEnd,
            updated_at: now,
          })),
          { onConflict: "website_id,query,country" },
        );
    });
    const truth = cleaned
      .map((r) => ({ ...r, vol: volumeFromGsc(r.impressions, r.position) }))
      .filter((r) => r.vol != null);
    await chunked(truth, 200, async (part) => {
      await admin()
        .from("keyword_bank")
        .upsert(
          part.map((r) => ({
            keyword: r.query,
            country: r.cc,
            volume_gsc: r.vol,
            volume_gsc_at: now,
            gsc_impressions: Math.round(r.impressions),
            gsc_position: Math.round(r.position * 10) / 10,
            updated_at: now,
          })),
          { onConflict: "keyword,country" },
        );
    });
    await recordUniverse(
      cleaned.map((r) => ({
        keyword: r.query,
        country: r.cc,
        source: "gsc" as const,
      })),
    );
    return truth.length;
  } catch {
    return 0; /* migration 010 not run yet */
  }
}

/** True volumes (from Search Console) already saved for these keywords: key = "keyword|country". */
export async function bankTruth(
  keywords: string[],
  countries: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const list = [...new Set(keywords.map(norm))].filter(Boolean);
  try {
    for (const c of countries) {
      await chunked(list, 100, async (part) => {
        const { data } = await admin()
          .from("keyword_bank")
          .select("keyword, volume_gsc")
          .eq("country", c)
          .in("keyword", part)
          .not("volume_gsc", "is", null);
        for (const r of data ?? [])
          out.set(`${r.keyword}|${c}`, Number(r.volume_gsc));
      });
    }
  } catch {
    /* column not created yet */
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// 4. Calibration: how far is the AI volume from the truth?
// ---------------------------------------------------------------------------------------------------------

export type Calibration = {
  factor: number;
  samples: number;
  p25: number | null;
  p75: number | null;
};
const NEUTRAL: Calibration = { factor: 1, samples: 0, p25: null, p75: null };
const MIN_SAMPLES = 15;
let memo: { at: number; value: Calibration } | null = null;

const quantile = (sorted: number[], q: number) =>
  sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(q * (sorted.length - 1))),
    )
  ];

/**
 * The AI tends to be too high or too low in a steady way. For every keyword that has BOTH an AI number and a true number from Search Console,
 * the ratio true / AI is taken; the median ratio (in log space, so one wild keyword cannot move it) becomes a correction applied to every AI volume.
 * Needs at least 15 such keywords, otherwise the factor stays 1 (no correction). Kept between 0.2 and 5, refreshed once a day.
 */
export async function loadCalibration(force = false): Promise<Calibration> {
  if (!force && memo && Date.now() - memo.at < 6 * 3_600_000) return memo.value;
  try {
    if (!force) {
      const { data } = await admin()
        .from("calibration")
        .select("value, updated_at")
        .eq("name", "volume")
        .maybeSingle();
      if (data && Date.parse(data.updated_at) > Date.now() - 24 * 3_600_000) {
        const v = data.value as Calibration;
        memo = {
          at: Date.now(),
          value: {
            factor: Number(v.factor) || 1,
            samples: Number(v.samples) || 0,
            p25: v.p25 ?? null,
            p75: v.p75 ?? null,
          },
        };
        return memo.value;
      }
    }
    const { data: rows } = await admin()
      .from("keyword_bank")
      .select("volume_ai, volume_gsc")
      .not("volume_gsc", "is", null)
      .not("volume_ai", "is", null)
      .gt("volume_ai", 0)
      .limit(3000);
    const logs = (rows ?? [])
      .map((r: { volume_ai: number; volume_gsc: number }) =>
        Math.log(r.volume_gsc / r.volume_ai),
      )
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let value: Calibration = NEUTRAL;
    if (logs.length >= MIN_SAMPLES) {
      const med = quantile(logs, 0.5);
      value = {
        factor:
          Math.round(Math.min(5, Math.max(0.2, Math.exp(med))) * 100) / 100,
        samples: logs.length,
        p25: Math.round(Math.exp(quantile(logs, 0.25)) * 100) / 100,
        p75: Math.round(Math.exp(quantile(logs, 0.75)) * 100) / 100,
      };
    } else value = { ...NEUTRAL, samples: logs.length };
    await admin()
      .from("calibration")
      .upsert(
        { name: "volume", value, updated_at: new Date().toISOString() },
        { onConflict: "name" },
      );
    memo = { at: Date.now(), value };
    return value;
  } catch {
    return NEUTRAL; /* migration 010 not run yet */
  }
}

// ---------------------------------------------------------------------------------------------------------
// 5. Everything the bank knows about the keywords a domain ranks for
// ---------------------------------------------------------------------------------------------------------

export type BankKeyword = {
  keyword: string;
  position: number;
  volume: number;
  truth: boolean;
};

/** Keywords where this domain was seen in a saved Google result (last 120 days), with the best volume the bank has for each. */
export async function bankDomainKeywords(
  domain: string,
  country: string,
  limit = 1500,
): Promise<{ rows: BankKeyword[]; unvolumed: number }> {
  try {
    const { data } = await admin()
      .from("serp_positions")
      .select("keyword, position")
      .eq("domain", domain)
      .eq("country", country)
      .gte("last_seen", cutoff(120))
      .order("position", { ascending: true })
      .limit(limit);
    const found = (data ?? []) as { keyword: string; position: number }[];
    if (!found.length) return { rows: [], unvolumed: 0 };
    const cal = await loadCalibration();
    const vols = new Map<
      string,
      { volume: number | null; ai: number | null; gsc: number | null }
    >();
    await chunked(
      found.map((r) => r.keyword),
      100,
      async (part) => {
        const { data: b } = await admin()
          .from("keyword_bank")
          .select("keyword, volume, volume_ai, volume_gsc")
          .eq("country", country)
          .in("keyword", part);
        for (const r of b ?? [])
          vols.set(r.keyword, {
            volume: r.volume,
            ai: r.volume_ai,
            gsc: r.volume_gsc,
          });
      },
    );
    const rows: BankKeyword[] = [];
    let unvolumed = 0;
    for (const f of found) {
      const v = vols.get(f.keyword);
      const volume =
        v?.gsc ??
        v?.volume ??
        (v?.ai != null ? Math.round(v.ai * cal.factor) : null);
      if (volume == null) {
        unvolumed++;
        continue;
      }
      rows.push({
        keyword: f.keyword,
        position: f.position,
        volume,
        truth: v?.gsc != null,
      });
    }
    return { rows, unvolumed };
  } catch {
    return { rows: [], unvolumed: 0 };
  }
}

// ---------------------------------------------------------------------------------------------------------
// 6. Stronger domain strength for Keyword Difficulty: backlinks + visibility from the bank
// ---------------------------------------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * Tranco rank only says how popular a domain is. Two more signals are mixed in when the bank has them:
 *   - referring domains from the verified backlink bank (at least 3 known, because a domain nobody scanned has 0 known, not 0 real)
 *   - in how many saved top-10 results the domain appears (at least 8, so a sample of two keywords cannot decide anything)
 * A signal can only RAISE the strength (a big brand with few scanned links stays big), and by a limited amount.
 */
export async function boostStrengths(
  out: Record<
    string,
    { rank: number | null; strength: number; source: string }
  >,
) {
  const domains = Object.keys(out).filter((d) => out[d].source !== "platform");
  if (!domains.length) return { links: 0, visible: 0 };
  let links = 0,
    visible = 0;
  try {
    const [lk, vis] = await Promise.all([
      admin().rpc("referring_domain_counts", { p_roots: domains }),
      admin().rpc("domain_visibility", { p_domains: domains }),
    ]);
    for (const r of (lk.data ?? []) as { target_root: string; n: number }[]) {
      const n = Number(r.n);
      if (n < 3 || !out[r.target_root]) continue;
      const linkStrength = clamp(Math.log10(n + 1) / 3.2, 0, 1); // 1,000 referring domains = about 0.94
      const e = out[r.target_root];
      const boosted = Math.max(
        e.strength,
        0.6 * e.strength + 0.4 * linkStrength,
      );
      if (boosted > e.strength) {
        e.strength = Math.round(boosted * 1000) / 1000;
        links++;
      }
    }
    for (const r of (vis.data ?? []) as { domain: string; n: number }[]) {
      const n = Number(r.n);
      if (n < 8 || !out[r.domain]) continue;
      const visStrength = clamp(Math.log10(n) / 2.5, 0, 0.9) * 0.7;
      const e = out[r.domain];
      if (visStrength > e.strength) {
        e.strength = Math.round(visStrength * 1000) / 1000;
        visible++;
      }
    }
  } catch {
    /* migration 010 not run yet */
  }
  return { links, visible };
}

// ---------------------------------------------------------------------------------------------------------
// 7. Numbers for the "Data bank" tab
// ---------------------------------------------------------------------------------------------------------

export async function bankStats() {
  try {
    const { data } = await admin().rpc("bank_stats");
    const cal = await loadCalibration();
    return { ...(data ?? {}), calibration: cal };
  } catch {
    return null;
  }
}
