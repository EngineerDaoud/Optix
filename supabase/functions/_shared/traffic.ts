import { admin, daysAgo } from "./utils.ts";
import { tokenFor } from "./google.ts";
import { get, rootDomain } from "./siteinfo.ts";
import {
  adjustVolume,
  ctrAt,
  featureFactor,
  niceNum,
  scopeCountries,
  strengthFromRank,
  volumeRange,
  type Features,
  type KeywordEvidence,
  type Scope,
} from "./keywords.ts";

export { ctrAt, scopeCountries };
export type { KeywordEvidence };
import { claude } from "./ai.ts";
import { bankVolumes, normKw, saveVolumes } from "./bank.ts";
import {
  bankTruth,
  boostStrengths,
  loadCalibration,
  recordGscTruth,
  recordUniverse,
  type BankKeyword,
} from "./universe.ts";

// Traffic for the Domain Research page.
//  - Sites YOU connected (Google Analytics 4 + Search Console): REAL numbers, read live from Google.
//  - Any other site: nobody can give real traffic for free (it is private data), so we only give a rough guess from the Tranco rank.

const DAYS = 30;
const fail = (j: any, fallback: string): never => {
  throw new Error(j?.error?.message ?? fallback);
};

async function post(url: string, token: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) fail(j, `Google error ${r.status}`);
  return j;
}

type GaRow = {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
};

async function ga4Report(
  token: string,
  property: string,
  dims: string[],
  metrics: string[],
  limit = 10,
  orderBy?: string,
) {
  const j = await post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
    token,
    {
      dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: "yesterday" }],
      dimensions: dims.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit: String(limit),
      ...(orderBy
        ? { orderBys: [{ metric: { metricName: orderBy }, desc: true }] }
        : {}),
    },
  );
  return (j.rows ?? []) as GaRow[];
}

async function gscQuery(
  token: string,
  site: string,
  dimensions: string[],
  rowLimit: number,
) {
  const j = await post(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    token,
    {
      startDate: daysAgo(DAYS),
      endDate: daysAgo(1),
      dimensions,
      rowLimit,
    },
  );
  return (j.rows ?? []) as {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
}

const num = (v: string | undefined) => Number(v ?? 0) || 0;

async function ga4Block(token: string, property: string) {
  const M = [
    "sessions",
    "totalUsers",
    "newUsers",
    "engagedSessions",
    "engagementRate",
  ];
  const [totals, channels, sources, countries, devices, daily] =
    await Promise.allSettled([
      ga4Report(token, property, [], M, 1),
      ga4Report(
        token,
        property,
        ["sessionDefaultChannelGroup"],
        ["sessions", "totalUsers"],
        10,
        "sessions",
      ),
      ga4Report(
        token,
        property,
        ["sessionSource"],
        ["sessions", "totalUsers"],
        10,
        "sessions",
      ),
      ga4Report(
        token,
        property,
        ["country"],
        ["sessions", "totalUsers"],
        10,
        "sessions",
      ),
      ga4Report(
        token,
        property,
        ["deviceCategory"],
        ["sessions", "totalUsers"],
        5,
        "sessions",
      ),
      ga4Report(token, property, ["date"], ["sessions"], 60),
    ]);
  if (totals.status === "rejected") throw totals.reason; // permission or property problem: tell the user
  const pick = (r: PromiseSettledResult<GaRow[]>) =>
    r.status === "fulfilled"
      ? r.value.map((x) => ({
          key: x.dimensionValues[0].value,
          sessions: num(x.metricValues[0].value),
          users: num(x.metricValues[1].value),
        }))
      : [];
  const t = totals.value[0]?.metricValues ?? [];
  return {
    totals: {
      sessions: num(t[0]?.value),
      users: num(t[1]?.value),
      newUsers: num(t[2]?.value),
      engagedSessions: num(t[3]?.value),
      engagementRate: num(t[4]?.value),
    },
    channels: pick(channels),
    sources: pick(sources),
    countries: pick(countries),
    devices: pick(devices),
    daily:
      daily.status === "fulfilled"
        ? daily.value
            .map((x) => ({
              date: x.dimensionValues[0].value.replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                "$1-$2-$3",
              ),
              sessions: num(x.metricValues[0].value),
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        : [],
  };
}

async function gscBlock(token: string, site: string) {
  const [total, queries, pages, countries, devices, daily] =
    await Promise.allSettled([
      gscQuery(token, site, [], 1),
      gscQuery(token, site, ["query"], 15),
      gscQuery(token, site, ["page"], 15),
      gscQuery(token, site, ["country"], 10),
      gscQuery(token, site, ["device"], 5),
      gscQuery(token, site, ["date"], 60),
    ]);
  if (total.status === "rejected") throw total.reason;
  const rows = (
    r: PromiseSettledResult<Awaited<ReturnType<typeof gscQuery>>>,
  ) =>
    r.status === "fulfilled"
      ? r.value.map((x) => ({
          key: x.keys[0],
          clicks: x.clicks,
          impressions: x.impressions,
          ctr: x.ctr,
          position: x.position,
        }))
      : [];
  const t = total.value[0];
  return {
    totals: {
      clicks: t?.clicks ?? 0,
      impressions: t?.impressions ?? 0,
      ctr: t?.ctr ?? 0,
      position: t?.position ?? 0,
    },
    queries: rows(queries),
    pages: rows(pages),
    countries: rows(countries),
    devices: rows(devices),
    daily: rows(daily)
      .map((x) => ({ date: x.key, clicks: x.clicks }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// Very rough: monthly visits is about 1.2e11 / Tranco rank, shown as a wide range. Tranco ranks links and browsing data, not visits,
// so treat this as an order of magnitude only.
function estimate(trancoRank: number | null) {
  if (!trancoRank) {
    return {
      trancoRank: null,
      low: null,
      high: null,
      note: "This site is not in the Tranco top 1 million, so it is probably a small site. No honest number can be given for free. Connect Google Analytics for real numbers if it is your site.",
    };
  }
  const mid = 1.2e11 / trancoRank;
  const round = (n: number) => {
    const p = 10 ** (Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  };
  return {
    trancoRank,
    low: round(mid * 0.3),
    high: round(mid * 3),
    note: "Rough guess from the Tranco rank only, and it can be far off. Tranco does not measure visitors. Where the traffic comes from cannot be known for sites you do not own.",
  };
}

// ---------------------------------------------------------------------------------------------------------
// SEO traffic estimate for ANY site (the same idea Semrush and Ahrefs use):
//   visits per keyword = monthly searches x click rate at the site's Google position
//   site organic visits = sum over its ranking keywords
// Positions are real (checked live in Google). Search volume is an AI estimate (free volume data does not exist).
// ---------------------------------------------------------------------------------------------------------

// rough size of each country's search market compared with the US, only used when the AI gives no numbers
const MARKET: Record<string, number> = {
  us: 1,
  gb: 0.22,
  ca: 0.12,
  au: 0.08,
  in: 0.6,
  pk: 0.1,
  de: 0.25,
  fr: 0.2,
  ae: 0.03,
  nz: 0.015,
  sa: 0.05,
  tr: 0.15,
  br: 0.25,
  mx: 0.12,
  es: 0.12,
  it: 0.12,
  nl: 0.05,
  za: 0.04,
  ng: 0.05,
};

export type VolumeResult = {
  volumes: Record<string, Record<string, number>>;
  source: "ai" | "guess";
  fromBank: number;
  truth: Set<string>;
  calibration: { factor: number; samples: number };
};

// Volumes in three layers, best first:
//   1. TRUE volume from Search Console impressions (keyword_bank.volume_gsc) when any connected site ever ranked for the keyword
//   2. the AI estimate, multiplied by a correction factor learned from layer 1 (only when 15+ keywords have both numbers)
//   3. a guess from phrase length when the AI is down (never saved)
// `truth` lists the "keyword|country" pairs that are layer 1, so the later sanity checks leave them alone.
export async function keywordVolumes(
  keywords: string[],
  countries: string[],
): Promise<VolumeResult> {
  const base = await keywordVolumesRaw(keywords, countries);
  const cal = await loadCalibration();
  const truthMap = await bankTruth(keywords, countries);
  const truth = new Set<string>();
  for (const k of keywords) {
    for (const c of countries) {
      const t = truthMap.get(`${normKw(k)}|${c}`);
      if (t != null) {
        base.volumes[k][c] = t;
        truth.add(`${k}|${c}`);
      } else if (cal.factor !== 1 && base.source === "ai")
        base.volumes[k][c] = Math.max(
          10,
          Math.round(base.volumes[k][c] * cal.factor),
        );
    }
  }
  return {
    ...base,
    truth,
    calibration: { factor: cal.factor, samples: cal.samples },
  };
}

async function keywordVolumesRaw(keywords: string[], countries: string[]) {
  const out: Record<string, Record<string, number>> = {};
  let source: "ai" | "guess" = "ai";
  // 1. numbers already saved in the keyword bank (migration 006) are reused: same keyword = same number, and no AI call is made for it
  const banked = await bankVolumes(keywords, countries);
  for (const k of keywords) {
    for (const c of countries) {
      const v = banked.get(`${normKw(k)}|${c}`);
      if (v != null) (out[k] ??= {})[c] = v;
    }
  }
  const missing = keywords.filter((k) =>
    countries.some((c) => out[k]?.[c] == null),
  );
  const missingCountries = countries.filter((c) =>
    missing.some((k) => out[k]?.[c] == null),
  );
  const fromBank =
    keywords.length * countries.length -
    missing.reduce(
      (a, k) => a + countries.filter((c) => out[k]?.[c] == null).length,
      0,
    );
  const fresh: { keyword: string; country: string; volume_ai: number }[] = [];
  if (!missing.length)
    return { volumes: fill(keywords, countries, out), source, fromBank };
  try {
    const system = `You estimate AVERAGE MONTHLY GOOGLE SEARCH VOLUME for search phrases in specific countries, like keyword tools do.
Return ONLY JSON, no markdown: {"volumes": {"<phrase>": {"<country code>": <whole number>}}}
Rules: give a number for every phrase and every country code asked. Use the typical order of magnitude (10, 20, 50, 100, 200, 500, 1000, 2000, 5000...). Be conservative: most 3 to 5 word phrases have under 1000 searches a month. Use 10 for very rare phrases. Do not explain.`;
    // batches: a long list in one answer gets cut off, so phrases are sent in groups that fit the answer size (3 groups at a time)
    const perBatch = Math.max(
      10,
      Math.floor(1500 / (14 + 8 * missingCountries.length)),
    );
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += perBatch)
      batches.push(missing.slice(i, i + perBatch));
    let got = 0;
    for (let b = 0; b < batches.length; b += 3) {
      await Promise.all(
        batches.slice(b, b + 3).map(async (phrases) => {
          try {
            const raw = await claude(
              system,
              JSON.stringify({ phrases, countries: missingCountries }),
              2500,
              { json: true },
            );
            const s = raw.replace(/```json|```/g, "").trim();
            const j = JSON.parse(
              s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1),
            );
            for (const k of phrases) {
              const row = j.volumes?.[k] ?? {};
              for (const c of missingCountries) {
                const v = Number(row[c]);
                if (out[k]?.[c] == null && Number.isFinite(v) && v >= 0) {
                  (out[k] ??= {})[c] = Math.round(v);
                  fresh.push({
                    keyword: k,
                    country: c,
                    volume_ai: Math.round(v),
                  });
                  got++;
                }
              }
            }
          } catch {
            /* this batch failed: its phrases fall back to the length-based guess below */
          }
        }),
      );
    }
    if (!got) throw new Error("no numbers");
  } catch {
    // the AI failed: the numbers already in the bank are still real, only the missing ones are guessed (and never saved)
    if (missing.length >= keywords.length / 2) source = "guess"; // most numbers are guesses: the confidence note says so
    for (const k of missing) {
      const words = k.split(" ").length;
      const base =
        words <= 2 ? 1500 : words === 3 ? 500 : words === 4 ? 200 : 80; // US-sized base guess from phrase length
      for (const c of countries)
        if (out[k]?.[c] == null)
          (out[k] ??= {})[c] = Math.max(
            10,
            Math.round(base * (MARKET[c] ?? 0.1)),
          );
    }
  }
  await saveVolumes(fresh); // only real AI numbers are saved, so a guess can never become permanent
  return { volumes: fill(keywords, countries, out), source, fromBank };
}

// fill any gap
function fill(
  keywords: string[],
  countries: string[],
  out: Record<string, Record<string, number>>,
) {
  for (const k of keywords) {
    out[k] ??= {};
    for (const c of countries)
      if (out[k][c] == null)
        out[k][c] = Math.max(10, Math.round(100 * (MARKET[c] ?? 0.1)));
  }
  return out;
}

// ---- sanity checks on the AI volume, using free Google signals --------------------------------------------
// The AI volume is the weakest part. Free signals keep it from drifting too far:
//  1. Google autocomplete: a phrase that Google itself completes many times is searched often; a phrase with no completions is rare.
//  2. Autocomplete RANK: if Google suggests the phrase when you type all but its last word, and ranks it first, it is popular.
//  3. Ads / shopping boxes on the result page: advertisers only bid on phrases people really search.
async function suggestions(
  q: string,
  gl: string,
  hl: string,
): Promise<string[] | null> {
  try {
    const r = await get(
      `https://suggestqueries.google.com/complete/search?client=firefox&gl=${gl}&hl=${hl}&q=${encodeURIComponent(q)}`,
      4000,
    );
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.[1]) ? (j[1] as string[]).map(String) : null;
  } catch {
    return null;
  }
}

export async function autocompleteCount(
  keyword: string,
  gl: string,
  hl: string,
): Promise<number | null> {
  const list = await suggestions(keyword, gl, hl);
  if (!list) return null;
  const kw = keyword.toLowerCase();
  return list.filter((s) => s.toLowerCase().startsWith(kw)).length;
}

export async function autocompleteInfo(
  keyword: string,
  gl: string,
  hl: string,
): Promise<{ ac: number | null; acRank: number | null }> {
  const kw = keyword.toLowerCase().trim();
  const words = kw.split(/\s+/);
  const [ac, list] = await Promise.all([
    autocompleteCount(keyword, gl, hl),
    words.length >= 2
      ? suggestions(words.slice(0, -1).join(" ") + " ", gl, hl)
      : Promise.resolve(null),
  ]);
  return {
    ac,
    acRank: list ? list.findIndex((s) => s.toLowerCase().startsWith(kw)) : null,
  }; // -1 = not suggested
}

async function limited<T>(
  items: T[],
  size: number,
  fn: (x: T) => Promise<void>,
) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// Free keyword ideas straight from Google autocomplete (a-z and question words), like the "Keyword ideas" report of paid tools.
export async function expandIdeas(
  seeds: string[],
  gl: string,
  hl: string,
  own: Set<string>,
  budgetMs = 14000,
  maxSeeds = 2,
  keep = 40,
) {
  const t0 = Date.now();
  const jobs: { q: string; seed: string }[] = [];
  for (const seed of seeds.slice(0, maxSeeds)) {
    for (const c of "abcdefghijklmnopqrstuvwxyz")
      jobs.push({ q: `${seed} ${c}`, seed });
    for (const p of ["how", "what", "best", "cheap"])
      jobs.push({ q: `${p} ${seed}`, seed });
    for (const p of ["vs", "for", "near me"])
      jobs.push({ q: `${seed} ${p}`, seed });
  }
  const found = new Map<string, { hits: number; best: number }>();
  await limited(jobs, 8, async (j) => {
    if (Date.now() - t0 > budgetMs) return;
    const list = await suggestions(j.q, gl, hl);
    (list ?? []).forEach((raw, idx) => {
      const k = raw.toLowerCase().replace(/\s+/g, " ").trim();
      if (
        !k ||
        k === j.seed ||
        own.has(k) ||
        k.length > 80 ||
        k.split(" ").length > 8
      )
        return;
      const e = found.get(k) ?? { hits: 0, best: 99 };
      e.hits++;
      e.best = Math.min(e.best, idx);
      found.set(k, e);
    });
  });
  const ranked = [...found.entries()]
    .map(([keyword, e]) => ({ keyword, hits: e.hits, best: e.best }))
    .sort((a, b) => b.hits - a.hits || a.best - b.best);
  // every idea found is kept forever in the keyword universe (the screen only shows the best 40)
  await recordUniverse(
    ranked
      .slice(0, 300)
      .map((x) => ({
        keyword: x.keyword,
        country: gl,
        source: "autocomplete" as const,
        seed: seeds[0] ?? null,
      })),
  );
  return ranked.slice(0, keep);
}

// ---- how strong is each ranking domain? (feeds Keyword Difficulty) -----------------------------------------
// Tranco rank per domain, cached 30 days in public.domain_cache (migration 004) so repeat runs are fast and polite.
// A domain whose rank could not be read is left out (treated as "unknown"), never counted as weak.
async function trancoRankOrUnknown(
  domain: string,
): Promise<number | null | undefined> {
  try {
    const r = await get(
      `https://tranco-list.eu/api/ranks/domain/${domain}`,
      8000,
    );
    if (!r.ok) return undefined; // rate limit or server problem: unknown, do not cache
    const j = await r.json();
    const rank = j.ranks?.[0]?.rank;
    return typeof rank === "number" ? rank : null;
  } catch {
    return undefined;
  }
}

export async function domainStrengths(
  domains: string[],
  isBigPlatform: (d: string) => boolean,
  maxLookups = 24,
  budgetMs = 18000,
) {
  const out: Record<
    string,
    { rank: number | null; strength: number; source: "platform" | "tranco" }
  > = {};
  const need: string[] = [];
  for (const d of new Set(domains)) {
    if (isBigPlatform(d))
      out[d] = { rank: null, strength: 0.95, source: "platform" };
    else need.push(d);
  }
  const ranks = new Map<string, number | null>();
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await admin()
      .from("domain_cache")
      .select("domain, tranco_rank")
      .in("domain", need)
      .gte("checked_at", since);
    for (const r of data ?? []) ranks.set(r.domain, r.tranco_rank);
  } catch {
    /* cache table not created yet: just look everything up */
  }
  const t0 = Date.now();
  const fresh: {
    domain: string;
    tranco_rank: number | null;
    checked_at: string;
  }[] = [];
  await limited(
    need.filter((d) => !ranks.has(d)).slice(0, maxLookups),
    3,
    async (d) => {
      if (Date.now() - t0 > budgetMs) return;
      const r = await trancoRankOrUnknown(d);
      if (r === undefined) return;
      ranks.set(d, r);
      fresh.push({
        domain: d,
        tranco_rank: r,
        checked_at: new Date().toISOString(),
      });
    },
  );
  if (fresh.length) {
    try {
      await admin()
        .from("domain_cache")
        .upsert(fresh, { onConflict: "domain" });
    } catch {
      /* optional */
    }
  }
  for (const d of need)
    if (ranks.has(d))
      out[d] = {
        rank: ranks.get(d) ?? null,
        strength: strengthFromRank(ranks.get(d)),
        source: "tranco",
      };
  await boostStrengths(out); // backlinks and visibility from the data bank can raise (never lower) the strength
  return out;
}

export type SeoEstimateInput = {
  gl: string;
  scope: Scope;
  rankings: {
    keyword: string;
    position: number | null;
    error?: string;
    features?: Features;
  }[];
  volumes: Record<string, Record<string, number>>;
  volumeSource: "ai" | "guess";
  evidence: Record<string, KeywordEvidence>;
  brand: { keyword: string; position: number | null } | null; // searches for the site's own name (the checked keywords skip these)
  urls: number; // pages the site has (crawled or found), used to scale from checked keywords to the whole site
  countryPositions: Record<string, Record<string, number | null>>; // extra countries: keyword -> position (null = not ranking)
  trancoRank: number | null;
  depth: number;
  truth?: Set<string>; // "keyword|country" pairs whose volume is TRUE (Search Console): never adjusted
  bank?: { rows: BankKeyword[]; unvolumed: number } | null; // every other keyword the data bank knows this site ranks for
  calibration?: { factor: number; samples: number } | null;
};

export function seoEstimate(i: SeoEstimateInput) {
  // volume used for keyword k in country c = AI volume, corrected by the evidence found for the main country
  const factor = (k: string) => {
    const ai = i.volumes[k]?.[i.gl] ?? 0;
    const ev = i.evidence[k];
    if (i.truth?.has(`${k}|${i.gl}`)) return 1; // a true number needs no sanity check
    if (!ev || ai <= 0) return 1;
    return adjustVolume(ai, ev) / ai;
  };
  const vol = (k: string, c: string) =>
    Math.round((i.volumes[k]?.[c] ?? 0) * factor(k));

  const checked = i.rankings.filter((r) => !r.error);
  const ffOf = new Map(
    checked.map((r) => [r.keyword, featureFactor(r.features)]),
  );
  const rows = checked.map((r) => {
    const volume = vol(r.keyword, i.gl);
    const ff = ffOf.get(r.keyword) ?? 1;
    const visits = r.position ? volume * ctrAt(r.position) * ff : 0;
    const range = volumeRange(volume, i.evidence[r.keyword]);
    const volumeAll = Object.keys(i.volumes[r.keyword] ?? { [i.gl]: 0 }).reduce(
      (a, c) => a + vol(r.keyword, c),
      0,
    );
    return {
      keyword: r.keyword,
      position: r.position,
      volume,
      volumeLow: range.low,
      volumeHigh: range.high,
      volumeAll,
      ff,
      visits: Math.round(visits * 10) / 10,
      brand: false,
    };
  });
  const measured = rows.reduce((a, r) => a + r.visits, 0);
  const ranking = rows.filter((r) => r.position !== null).length;

  // the checked keywords are only a sample: bigger sites rank for many more phrases, so scale up with the page count
  const coverage = Math.min(
    6,
    Math.max(1, Math.sqrt(i.urls / Math.max(checked.length, 5))),
  );

  // REAL keywords from the data bank (migration 010): every other keyword where this site was seen in a saved Google result.
  // They replace the same amount of the old "coverage" guess, so a site the bank knows well is no longer extrapolated at all.
  const checkedSet = new Set(checked.map((r) => r.keyword.toLowerCase()));
  const bankExtra = (i.bank?.rows ?? []).filter(
    (b) => !checkedSet.has(b.keyword),
  );
  const bankVisits = bankExtra.reduce(
    (a, b) => a + b.volume * ctrAt(b.position) * 0.92,
    0,
  ); // 0.92 = typical SERP-feature factor when unknown
  const implicitKeywords = Math.max(
    0,
    checked.length * coverage - checked.length,
  ); // keywords the old guess silently assumed
  const replaced =
    implicitKeywords > 0 ? Math.min(1, bankExtra.length / implicitKeywords) : 0;
  const remainingGuess = measured * (coverage - 1) * (1 - replaced);
  const nonBrandMid = measured + bankVisits + remainingGuess;
  const bankInfo = {
    keywords: bankExtra.length,
    visits: Math.round(bankVisits),
    unvolumed: i.bank?.unvolumed ?? 0,
    replacedGuess: Math.round(replaced * 100),
    trueVolumes: [...(i.truth ?? [])].length,
  };

  // countries: compare the same top 5 keywords in every country
  const k5 = [...rows]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5)
    .map((r) => r.keyword);
  const posHere = new Map(rows.map((r) => [r.keyword, r.position]));
  const sumFor = (c: string) =>
    k5.reduce((a, k) => {
      const pos =
        c === i.gl ? (posHere.get(k) ?? null) : i.countryPositions[c]?.[k];
      return pos ? a + vol(k, c) * ctrAt(pos) * (ffOf.get(k) ?? 1) : a;
    }, 0);
  const cs = [i.gl, ...Object.keys(i.countryPositions)].map((c) => ({
    country: c,
    raw: sumFor(c),
  }));
  const rawGl = cs[0].raw;
  const rawAll = cs.reduce((a, c) => a + c.raw, 0);
  const scaleRaw = rawGl > 0 ? rawAll / rawGl : 1; // other countries add to the total in the same proportion seen on the top 5 keywords
  const scale = Math.min(15, scaleRaw); // safety cap: a tiny home-country base must not blow the total up without limit
  const nonBrandTotal = nonBrandMid * scale;

  // brand searches (people typing the site's own name): counted once, in the main country only, and not scaled
  let brandVisits = 0;
  if (i.brand && i.brand.position) {
    const v = vol(i.brand.keyword, i.gl);
    brandVisits = v * ctrAt(i.brand.position);
    rows.push({
      keyword: `${i.brand.keyword} (brand)`,
      position: i.brand.position,
      volume: v,
      volumeLow: v,
      volumeHigh: v,
      volumeAll: v,
      ff: 1,
      visits: Math.round(brandVisits * 10) / 10,
      brand: true,
    });
  }

  const mid = nonBrandTotal + brandVisits;
  const countries = cs
    .map((c) => {
      const share = rawAll > 0 ? c.raw / rawAll : c.country === i.gl ? 1 : 0;
      const visits =
        share * nonBrandTotal + (c.country === i.gl ? brandVisits : 0);
      return {
        country: c.country,
        visits: Math.round(niceNum(visits)),
        share: mid > 0 ? visits / mid : 0,
      };
    })
    .sort((a, b) => b.visits - a.visits);

  // traffic potential: the same maths, but every checked keyword is moved to #3 (or #1)
  const potSum = (p: number) =>
    rows
      .filter((r) => !r.brand)
      .reduce((a, r) => a + r.volume * ctrAt(p) * r.ff, 0);
  const bankPot = (p: number) =>
    bankExtra.reduce((a, b) => a + b.volume * ctrAt(p) * 0.92, 0);
  const potTotal = (p: number) =>
    potSum(p) + bankPot(p) + potSum(p) * (coverage - 1) * (1 - replaced);
  const potential = {
    top3: niceNum(potTotal(3) * scale + brandVisits),
    top1: niceNum(potTotal(1) * scale + brandVisits),
  };

  // confidence: honest about how much this rests on guesses. It is never "High" because no real visit data is used.
  const reasons: string[] = [];
  let score = 0;
  if (i.volumeSource === "ai") score += 1;
  else reasons.push("search volumes were guessed from phrase length");
  if (ranking >= 5) score += 1;
  else if (ranking >= 2) {
    score += 0.5;
    reasons.push(`only ${ranking} keywords rank`);
  } else
    reasons.push(ranking ? "only 1 keyword ranks" : "no checked keyword ranks");
  if (checked.length >= 10) score += 0.5;
  else reasons.push("few keywords were checked");
  if (bankExtra.length >= 10) score += 0.5;
  else if (bankExtra.length === 0)
    reasons.push(
      "the data bank does not know other keywords of this site yet (it learns with every search)",
    );
  if ((i.truth?.size ?? 0) >= 3) score += 0.25;
  const checkedEv = checked.filter(
    (r) => i.evidence[r.keyword]?.ac != null,
  ).length;
  if (checkedEv >= checked.length * 0.6) score += 0.5;
  else reasons.push("autocomplete check was not available for most keywords");
  if (scaleRaw > 4)
    reasons.push(
      "most of the total comes from countries other than the main one",
    );
  let trancoFlag: string | null = null;
  if (i.trancoRank) {
    const t = 1.2e11 / i.trancoRank;
    if (mid > 0 && (mid * 3 < t * 0.1 || mid / 3 > t * 3)) {
      reasons.push("the Tranco rank points to a very different size");
      trancoFlag = "mismatch";
    } else score += 0.5;
  }
  const level = score >= 2.5 ? "Medium" : "Low";
  const f = level === "Low" ? 3 : 2;
  const floorTotal = measured * scale + brandVisits;
  const low = niceNum(Math.max(mid / f, Math.min(floorTotal, mid)));
  const high = niceNum(mid * f);
  const midR = niceNum(mid);

  return {
    organic: { low, mid: midR, high },
    allSources: { low: niceNum(midR / 0.55), high: niceNum(midR / 0.3) }, // if search is 30% to 55% of all visits
    potential,
    keywords: rows.sort((a, b) => b.visits - a.visits),
    keywordsChecked: checked.length,
    keywordsRanking: ranking,
    depth: i.depth,
    scope: i.scope,
    coverage: Math.round(coverage * 10) / 10,
    scale: Math.round(scale * 10) / 10,
    countries,
    countriesChecked: Object.keys(i.countryPositions).length,
    top5: k5,
    brand: i.brand
      ? {
          keyword: i.brand.keyword,
          position: i.brand.position,
          visits: Math.round(brandVisits),
        }
      : null,
    confidence: { level, reasons, trancoFlag },
    bank: bankInfo,
    calibration: i.calibration ?? null,
    volumeSource: i.volumeSource,
    gl: i.gl,
  };
}

export async function trafficFor(
  userId: string,
  host: string,
  trancoRank: number | null,
  shared: boolean,
  seo: ReturnType<typeof seoEstimate> | null = null,
) {
  const estimateOut = estimate(trancoRank);
  if (shared)
    return {
      mode: "none",
      estimate: null,
      seo: null,
      own: null,
      note: "This is a shared hosting address, so traffic cannot be told apart from other sites.",
    };

  const root = rootDomain(host.replace(/^www\./, ""));
  const { data: sites } = await admin()
    .from("websites")
    .select("id, url, name")
    .eq("user_id", userId);
  const mine = (sites ?? []).find((s) => {
    try {
      return (
        rootDomain(
          new URL(
            s.url.startsWith("http") ? s.url : `https://${s.url}`,
          ).hostname.replace(/^www\./, ""),
        ) === root
      );
    } catch {
      return false;
    }
  });
  if (!mine) return { mode: "estimate", estimate: estimateOut, seo, own: null };

  const { data: ints } = await admin()
    .from("integrations")
    .select("provider, config")
    .eq("website_id", mine.id);
  const siteUrl = ints?.find((i) => i.provider === "gsc")?.config?.siteUrl as
    string | undefined;
  const property = ints?.find((i) => i.provider === "ga4")?.config
    ?.propertyId as string | undefined;
  if (!siteUrl && !property) {
    return {
      mode: "estimate",
      estimate: estimateOut,
      seo,
      own: {
        connected: false,
        website: { id: mine.id, name: mine.name ?? mine.url },
        errors: [] as string[],
      },
    };
  }

  const errors: string[] = [];
  let gaToken = "";
  let gscToken = "";
  try {
    if (property) gaToken = await tokenFor(mine.id, "ga4");
    if (siteUrl) gscToken = await tokenFor(mine.id, "gsc");
  } catch (e) {
    return {
      mode: "estimate",
      estimate: estimateOut,
      seo,
      own: {
        connected: false,
        website: { id: mine.id, name: mine.name ?? mine.url },
        errors: [(e as Error).message],
      },
    };
  }
  const [ga, gsc] = await Promise.allSettled([
    property ? ga4Block(gaToken, property) : Promise.resolve(null),
    siteUrl ? gscBlock(gscToken, siteUrl) : Promise.resolve(null),
  ]);
  if (ga.status === "rejected")
    errors.push(`Google Analytics: ${(ga.reason as Error).message}`);
  if (gsc.status === "rejected")
    errors.push(`Search Console: ${(gsc.reason as Error).message}`);
  const own = {
    connected: true,
    days: DAYS,
    website: { id: mine.id, name: mine.name ?? mine.url },
    ga4: ga.status === "fulfilled" ? ga.value : null,
    gsc: gsc.status === "fulfilled" ? gsc.value : null,
    errors,
  };
  // keep the real Search Console queries forever: they are the only free source of TRUE search demand and teach the volume calibration
  if (siteUrl && gscToken && own.gsc) {
    try {
      const rows = await gscQuery(
        gscToken,
        siteUrl,
        ["query", "country"],
        1000,
      );
      await recordGscTruth(
        mine.id,
        rows.map((r) => ({
          query: r.keys[0],
          country: r.keys[1],
          impressions: r.impressions,
          clicks: r.clicks,
          position: r.position,
        })),
        daysAgo(1),
      );
    } catch {
      /* optional */
    }
  }
  const hasReal = !!(own.ga4 || own.gsc);
  return {
    mode: hasReal ? "own" : "estimate",
    estimate: hasReal ? null : estimateOut,
    seo,
    own,
  };
}
