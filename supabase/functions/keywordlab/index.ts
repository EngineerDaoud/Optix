import {
  admin,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { isAdmin, takeQuota } from "../_shared/quota.ts";
import {
  bankDomainKeywords,
  bankStats,
  domainKey,
  loadCalibration,
} from "../_shared/universe.ts";
import {
  autocompleteInfo,
  ctrAt,
  domainStrengths,
  expandIdeas,
  keywordVolumes,
} from "../_shared/traffic.ts";
import {
  adjustVolume,
  classifyIntent,
  extractFeatures,
  isJunkPhrase,
  kdLabel,
  keywordDifficulty,
  volumeRange,
  type KeywordEvidence,
  type SerpDomain,
} from "../_shared/keywords.ts";
import {
  bankEvidence,
  bankRows,
  noteLookups,
  normKw,
  saveEvidence,
  saveKeywordDetails,
  serpGet,
  serpPut,
} from "../_shared/bank.ts";
import { rootDomain } from "../_shared/siteinfo.ts";
import { siteKey } from "../_shared/linkscan.ts";

// Keyword Lab: look up any keyword and get volume range, difficulty, intent and the top 10 Google results.
// Everything goes through the data bank (migration 006), so a keyword that was searched before costs nothing (Google results are kept 3 days,
// volume numbers 90 days, autocomplete checks 30 days), and every answer is saved for next time.
//   action "lookup" -> up to 5 keywords
//   action "bank"   -> the keywords YOU searched or tracked, with the numbers saved for them
//   action "gap"    -> link gap: sites that link to a competitor (from the link bank) but not to you

const PLATFORM_NAMES = new Set([
  "wikipedia",
  "youtube",
  "reddit",
  "facebook",
  "instagram",
  "pinterest",
  "linkedin",
  "quora",
  "twitter",
  "x",
  "tiktok",
  "medium",
  "tripadvisor",
  "yelp",
  "trustpilot",
  "amazon",
  "ebay",
  "etsy",
  "google",
  "apple",
  "github",
  "bbc",
  "forbes",
]);
const isPlatform = (root: string) => PLATFORM_NAMES.has(root.split(".")[0]);
const LANG_BY_COUNTRY: Record<string, string> = {
  de: "de",
  fr: "fr",
  es: "es",
  mx: "es",
  it: "it",
  nl: "nl",
  br: "pt",
  tr: "tr",
};

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

async function pool<T, R>(
  items: T[],
  size: number,
  worker: (x: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k]);
      }
    }),
  );
  return out;
}

async function serperSearch(q: string, gl: string, hl: string, num: number) {
  const key = Deno.env.get("SERPER_API_KEY");
  if (!key)
    throw new HttpError(
      400,
      "SERPER_API_KEY is not set in Supabase secrets, and this keyword is not saved in the data bank yet.",
    );
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl, hl, num }),
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403)
      throw new HttpError(
        400,
        "Serper rejected the API key. Check SERPER_API_KEY.",
      );
    if (r.status === 402 || r.status === 429)
      throw new HttpError(
        429,
        "Serper credits or rate limit reached. Try again later or top up credits.",
      );
    throw new HttpError(502, `Serper error ${r.status}`);
  }
  const j = await r.json();
  await serpPut(q, gl, num, j);
  return j;
}

type Serp = Record<string, any> & { _cached?: boolean; _fetchedAt?: string };

async function lookup(userId: string, body: any) {
  const c = String(body.country ?? "").toLowerCase();
  const gl = /^[a-z]{2}$/.test(c) ? c : "us";
  const hl = LANG_BY_COUNTRY[gl] ?? "en";
  const useCache = !body.fresh;
  const mine = body.host
    ? siteKey(
        String(body.host)
          .replace(/^https?:\/\//i, "")
          .split("/")[0]
          .toLowerCase()
          .replace(/^www\./, ""),
      )
    : null;

  const typed: string[] = (
    Array.isArray(body.keywords) ? body.keywords : []
  ).map((k: unknown) => normKw(String(k ?? "")));
  const list = [...new Set(typed)]
    .filter(
      (k) =>
        k.length >= 2 &&
        k.length <= 80 &&
        k.split(" ").length <= 8 &&
        !isJunkPhrase(k),
    )
    .slice(0, 5);
  if (!list.length)
    throw new HttpError(400, "Type 1 to 5 keywords, one per line.");

  // 1. Google results: the data bank first, then Serper for the ones not saved yet
  const serps = new Map<string, Serp>();
  const errors = new Map<string, string>();
  await pool(list, 3, async (kw) => {
    try {
      const hit = useCache ? await serpGet(kw, gl, 10) : null;
      serps.set(
        kw,
        hit
          ? { ...hit.data, _cached: true, _fetchedAt: hit.fetchedAt }
          : await serperSearch(kw, gl, hl, 10),
      );
    } catch (e) {
      errors.set(kw, (e as Error).message);
    }
  });
  const live = list.filter((k) => serps.has(k));

  // 2. volume (bank, then AI for the missing ones) and autocomplete evidence (bank, then Google autocomplete)
  const savedRows = await bankRows(list, gl); // read BEFORE the volumes are asked, so we know which numbers were already saved
  const {
    volumes,
    source: volSource,
    truth,
    calibration,
  } = await keywordVolumes(list, [gl]);
  const savedEv = await bankEvidence(list, gl);
  const freshEv: {
    keyword: string;
    ac: number | null;
    acRank: number | null;
  }[] = [];
  const evidence: Record<string, KeywordEvidence> = {};
  await pool(list, 4, async (kw) => {
    const s = serps.get(kw);
    const feat = s ? extractFeatures(s) : null;
    const hit = savedEv.get(kw);
    const e = hit ?? (await autocompleteInfo(kw, gl, hl));
    if (!hit) freshEv.push({ keyword: kw, ac: e.ac, acRank: e.acRank });
    evidence[kw] = {
      ac: e.ac,
      acRank: e.acRank,
      commercial: !!feat && (feat.ads > 0 || feat.shopping),
      ads: feat?.ads ?? 0,
    };
  });
  await saveEvidence(freshEv, gl);

  // 3. how strong are the sites that rank (Tranco, cached in domain_cache)
  const domainsSeen = new Set<string>();
  for (const s of serps.values())
    for (const o of (s.organic ?? []).slice(0, 10)) {
      const h = hostOf(o.link ?? "");
      if (h) domainsSeen.add(rootDomain(h));
    }
  const strengths = await domainStrengths(
    [...domainsSeen].slice(0, 60),
    isPlatform,
  ).catch(() => ({}) as Awaited<ReturnType<typeof domainStrengths>>);
  const strengthMap: Record<string, number | undefined> = {};
  for (const [d, v] of Object.entries(strengths)) strengthMap[d] = v.strength;

  // 4. put it together
  const results = list.map((kw) => {
    const s = serps.get(kw);
    const aiVol = volumes[kw]?.[gl] ?? 0;
    const ev = evidence[kw];
    const isTrue = truth.has(`${kw}|${gl}`);
    const volume = isTrue ? aiVol : adjustVolume(aiVol, ev);
    const range = isTrue
      ? {
          low: Math.max(10, Math.round(volume * 0.85)),
          high: Math.round(volume * 1.2),
          spread: 1.2,
        }
      : volumeRange(volume, ev);
    const feat = s ? extractFeatures(s) : null;
    const organic: { title?: string; link?: string; position?: number }[] = s
      ? (s.organic ?? []).slice(0, 10)
      : [];
    const kwWords = kw.match(/[a-z0-9]{3,}/g) ?? [];
    const domains: SerpDomain[] = [];
    let titleMatches = 0;
    let ownPosition: number | null = null;
    const top = organic.map((o, idx) => {
      const link = o.link ?? "";
      const host = hostOf(link);
      const pos = typeof o.position === "number" ? o.position : idx + 1;
      const root = host ? rootDomain(host) : "";
      let home = false;
      try {
        home = new URL(link).pathname.replace(/\/+$/, "") === "";
      } catch {
        /* keep false */
      }
      if (root) domains.push({ p: pos, d: root, home });
      const tl = (o.title ?? "").toLowerCase();
      if (kwWords.length && kwWords.every((w) => tl.includes(w)))
        titleMatches++;
      if (mine && root && siteKey(host) === mine && ownPosition === null)
        ownPosition = pos;
      const st = root ? strengthMap[root] : undefined;
      return {
        position: pos,
        title: o.title ?? "",
        url: link,
        domain: root,
        home,
        strength: st == null ? null : Math.round(st * 100),
      };
    });
    const kd = s
      ? keywordDifficulty({ domains, titleMatches }, strengthMap, feat)
      : { kd: null as number | null, label: "Unknown" };
    const related = s
      ? [
          ...(s.relatedSearches ?? []).map((r: any) => String(r.query)),
          ...(s.peopleAlsoAsk ?? []).map((p: any) => String(p.question)),
        ]
          .filter(Boolean)
          .slice(0, 14)
      : [];
    const savedBefore = savedRows.get(kw);
    return {
      keyword: kw,
      ok: !!s,
      error: errors.get(kw) ?? null,
      volume,
      volumeLow: range.low,
      volumeHigh: range.high,
      kd: kd.kd,
      kdLabel: kd.kd == null ? "Unknown" : kdLabel(kd.kd),
      intent: classifyIntent(
        kw,
        undefined,
        !!feat && (feat.ads > 0 || feat.shopping),
      ),
      commercial: !!feat && (feat.ads > 0 || feat.shopping),
      features: feat,
      top,
      related,
      ownPosition,
      from: {
        volume:
          volSource === "guess"
            ? "guess"
            : isTrue
              ? "search-console"
              : savedBefore?.volume_ai != null
                ? "saved"
                : "ai",
        serp: s?._cached ? "saved" : s ? "live" : null,
        serpAt: s?._fetchedAt ?? null,
      },
    };
  });

  await saveKeywordDetails(
    results
      .filter((r) => r.ok)
      .map((r) => ({
        keyword: r.keyword,
        volume: r.volume,
        volumeLow: r.volumeLow,
        volumeHigh: r.volumeHigh,
        kd: r.kd,
        intent: r.intent,
        commercial: r.commercial,
        features: r.features,
        related: r.related,
      })),
    gl,
  );
  await noteLookups(userId, live, gl, null);

  // 5. optional: related keyword ideas from Google autocomplete for the first keyword (volumes also go through the bank)
  let ideas: {
    keyword: string;
    volume: number;
    intent: string;
    popularity: number;
  }[] = [];
  if (body.ideas && live.length) {
    try {
      const raw = (
        await expandIdeas([live[0]], gl, hl, new Set(list), 9000)
      ).slice(0, 15);
      if (raw.length) {
        const { volumes: iv, truth: ivTruth } = await keywordVolumes(
          raw.map((x) => x.keyword),
          [gl],
        );
        ideas = raw
          .map((x) => {
            const ev: KeywordEvidence = {
              ac: null,
              acRank: x.hits >= 3 ? 0 : x.hits === 2 ? 2 : null,
              commercial: false,
            };
            return {
              keyword: x.keyword,
              volume: ivTruth.has(`${x.keyword}|${gl}`)
                ? (iv[x.keyword]?.[gl] ?? 0)
                : adjustVolume(iv[x.keyword]?.[gl] ?? 0, ev),
              intent: classifyIntent(x.keyword),
              popularity: x.hits,
            };
          })
          .sort((a, b) => b.volume - a.volume || b.popularity - a.popularity);
      }
    } catch {
      /* ideas are optional */
    }
  }
  return { country: gl, results, ideas, volumeSource: volSource, calibration };
}

async function bank(userId: string, body: any) {
  const q = normKw(String(body.q ?? ""));
  let query = admin()
    .from("keyword_lookups")
    .select("keyword, country, host, lookups, last_at")
    .eq("user_id", userId)
    .order("last_at", { ascending: false })
    .limit(1000);
  if (/^[a-z]{2}$/.test(String(body.country ?? "")))
    query = query.eq("country", String(body.country));
  if (q) query = query.ilike("keyword", `%${q.replace(/[%_]/g, "")}%`);
  const { data: mineRows, error } = await query;
  if (error)
    throw new HttpError(
      500,
      "The data bank tables are missing. Run supabase/migrations/006_data_bank.sql (npx supabase db push).",
    );
  const byCountry = new Map<string, string[]>();
  for (const r of mineRows ?? [])
    (
      byCountry.get(r.country) ?? byCountry.set(r.country, []).get(r.country)!
    ).push(r.keyword);
  const saved = new Map<string, any>();
  for (const [c, kws] of byCountry)
    for (const [k, row] of await bankRows(kws, c)) saved.set(`${k}|${c}`, row);
  const rows = (mineRows ?? []).map((r) => {
    const b = saved.get(`${r.keyword}|${r.country}`);
    return {
      keyword: r.keyword,
      country: r.country,
      host: r.host,
      lookups: r.lookups,
      lastAt: r.last_at,
      volume: b?.volume ?? b?.volume_ai ?? null,
      volumeLow: b?.vol_low ?? null,
      volumeHigh: b?.vol_high ?? null,
      kd: b?.kd ?? null,
      kdLabel: b?.kd == null ? null : kdLabel(b.kd),
      intent: b?.intent ?? null,
      commercial: !!b?.commercial,
      updatedAt: b?.updated_at ?? null,
    };
  });
  const count = async (table: string) => {
    const { count: n } = await admin()
      .from(table)
      .select("*", { count: "exact", head: true });
    return n ?? 0;
  };
  const [sharedKeywords, serpSaved] = await Promise.all([
    count("keyword_bank"),
    count("serp_cache"),
  ]);
  return { rows, stats: { mine: rows.length, sharedKeywords, serpSaved } };
}

async function gap(body: any) {
  const clean = (v: unknown) =>
    String(v ?? "")
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .toLowerCase()
      .replace(/^www\./, "");
  const me = siteKey(clean(body.host)),
    comp = siteKey(clean(body.competitor));
  if (!me.includes(".") || !comp.includes("."))
    throw new HttpError(400, "Give your site and a competitor domain.");
  const pull = async (root: string) => {
    const rows: any[] = [];
    for (let from = 0; from < 4000; from += 1000) {
      const { data, error } = await admin()
        .from("backlink_links")
        .select("source_domain, source_url, anchor, rel, authority, first_seen")
        .eq("target_root", root)
        .is("lost_at", null)
        .range(from, from + 999);
      if (error)
        throw new HttpError(
          500,
          "The data bank tables are missing. Run supabase/migrations/006_data_bank.sql (npx supabase db push).",
        );
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  const [theirs, mine] = await Promise.all([pull(comp), pull(me)]);
  const mineSet = new Set(mine.map((r) => r.source_domain));
  const byDomain = new Map<
    string,
    {
      domain: string;
      authority: number | null;
      rel: string | null;
      anchor: string | null;
      url: string;
      links: number;
    }
  >();
  for (const r of theirs) {
    if (
      mineSet.has(r.source_domain) ||
      r.source_domain === me ||
      r.source_domain === comp
    )
      continue;
    const e = byDomain.get(r.source_domain);
    if (!e)
      byDomain.set(r.source_domain, {
        domain: r.source_domain,
        authority: r.authority,
        rel: r.rel,
        anchor: r.anchor,
        url: r.source_url,
        links: 1,
      });
    else {
      e.links++;
      if ((r.authority ?? -1) > (e.authority ?? -1)) {
        e.authority = r.authority;
        e.url = r.source_url;
        e.anchor = r.anchor;
        e.rel = r.rel;
      }
    }
  }
  const gapList = [...byDomain.values()]
    .sort(
      (a, b) => (b.authority ?? -1) - (a.authority ?? -1) || b.links - a.links,
    )
    .slice(0, 150);
  return {
    me,
    competitor: comp,
    hasData: theirs.length > 0,
    competitorLinks: theirs.length,
    competitorDomains: new Set(theirs.map((r) => r.source_domain)).size,
    myDomains: mineSet.size,
    gapCount: byDomain.size,
    gap: gapList,
  };
}

// Data bank tab -------------------------------------------------------------------------------------------------
// "stats"    counts of everything saved (keyword universe, Google results, ranking domains, links) + the learned volume correction. Safe for every user.
// "domain"   every keyword the bank knows a domain ranks for (public Google results, no user data). Safe for every user.
// "universe" the whole keyword universe with sources, for download. It also holds which sites other users researched, so ADMIN_EMAILS only.
async function domainView(body: any) {
  const raw = String(body.domain ?? "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .replace(/^www\./, "");
  if (!raw.includes("."))
    throw new HttpError(400, "Type a domain like example.com");
  const c = String(body.country ?? "").toLowerCase();
  const gl = /^[a-z]{2}$/.test(c) ? c : "us";
  const d = domainKey(raw);
  const { rows, unvolumed } = await bankDomainKeywords(d, gl, 1500);
  const list = rows
    .map((r) => ({
      ...r,
      visits: Math.round(r.volume * ctrAt(r.position) * 0.92 * 10) / 10,
    }))
    .sort((a, b) => b.visits - a.visits);
  const total = Math.round(list.reduce((a, r) => a + r.visits, 0));
  return {
    domain: d,
    country: gl,
    keywords: list.length,
    unvolumed,
    visits: total,
    top3: list.filter((r) => r.position <= 3).length,
    top10: list.filter((r) => r.position <= 10).length,
    trueVolumes: list.filter((r) => r.truth).length,
    rows: list.slice(0, 500),
    note: list.length
      ? null
      : "The bank has not seen this domain in any saved Google result for this country yet. It learns from every keyword search and every site report.",
  };
}

async function universeView(user: { email?: string }, body: any) {
  if (!isAdmin(user))
    throw new HttpError(
      403,
      "Add your email to the ADMIN_EMAILS secret to open the full keyword universe.",
    );
  const q = normKw(String(body.q ?? "")).replace(/[%_]/g, "");
  const c = String(body.country ?? "").toLowerCase();
  const limit = Math.min(1000, Math.max(10, Number(body.limit) || 300));
  let query = admin()
    .from("keyword_universe")
    .select(
      "keyword, country, sources, seed, times_seen, first_seen, last_seen",
    )
    .order("last_seen", { ascending: false })
    .limit(limit);
  if (/^[a-z]{2}$/.test(c)) query = query.eq("country", c);
  if (q) query = query.ilike("keyword", `%${q}%`);
  if (/^[a-z]+$/.test(String(body.source ?? "")))
    query = query.contains("sources", [String(body.source)]);
  const { data, error } = await query;
  if (error)
    throw new HttpError(
      500,
      "The keyword universe table is missing. Run supabase/migrations/010_keyword_universe.sql (npx supabase db push).",
    );
  const by = new Map<string, string[]>();
  for (const r of data ?? [])
    (by.get(r.country) ?? by.set(r.country, []).get(r.country)!).push(
      r.keyword,
    );
  const saved = new Map<string, any>();
  for (const [cc, kws] of by)
    for (const [k, row] of await bankRows(kws, cc))
      saved.set(`${k}|${cc}`, row);
  return {
    rows: (data ?? []).map((r) => {
      const b = saved.get(`${r.keyword}|${r.country}`);
      return {
        keyword: r.keyword,
        country: r.country,
        sources: r.sources,
        seed: r.seed,
        seen: r.times_seen,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        volume: b?.volume_gsc ?? b?.volume ?? b?.volume_ai ?? null,
        trueVolume: b?.volume_gsc != null,
        kd: b?.kd ?? null,
        intent: b?.intent ?? null,
      };
    }),
  };
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const action = String(body.action ?? "lookup");
    if (action === "lookup") {
      await takeQuota(user, "keywords");
      return json(await lookup(user.id, body));
    }
    if (action === "bank") return json(await bank(user.id, body));
    if (action === "gap") return json(await gap(body));
    if (action === "stats") return json(await bankStats());
    if (action === "domain") return json(await domainView(body));
    if (action === "universe") return json(await universeView(user, body));
    if (action === "recalibrate") {
      if (!isAdmin(user)) throw new HttpError(403, "Admins only.");
      return json(await loadCalibration(true));
    }
    throw new HttpError(400, "Unknown action");
  }),
);
