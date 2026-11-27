import { admin, handle, json, requireUser } from "../_shared/utils.ts";
import { isShared, parseInput, rootDomain } from "../_shared/siteinfo.ts";
import { ctrAt, featureFactor, type Features } from "../_shared/keywords.ts";
import { bankDomainKeywords } from "../_shared/universe.ts";

// "Main Organic Competitors" for any site, FREE: no Serper or other paid call, it only reads the data bank
// (serp_positions, migration 010), which fills itself every time someone runs a check.
//
//   Common keywords = how many of the site's keywords the competitor also ranks for (top 20 of Google)
//   Com. level      = common keywords / the site's keywords (how much of the site's search space they share)
//   SE keywords     = how many keywords the data bank knows that competitor ranks for
//   Total           = how many different domains share at least one keyword
//   map             = the positioning map: per domain (the site + its 6 closest competitors) the keyword count and an
//                     estimated monthly organic traffic = sum over its keywords of  search volume x CTR(position) x SERP-feature
//                     factor. Same formula the rest of the app uses for traffic (volume = Search Console truth > saved > AI).
//
// The site's keywords are the ones the bank says it ranks for, plus the target keywords the app sends (so a new site
// that does not rank yet still finds the sites that fight for the same searches).
// Body: { url, country?: "gb", keywords?: string[] }

const DAYS = 120;
const MAX_KEYWORDS = 1500;
const MAX_TOP_POSITION = 20;
const RETURN = 20;

// big platforms are not competitors for a business site
const PLATFORMS = new Set(
  "wikipedia youtube reddit facebook instagram pinterest linkedin quora twitter x tiktok medium tripadvisor yelp trustpilot amazon ebay etsy google apple github bbc forbes".split(
    " ",
  ),
);
const isPlatform = (d: string) => PLATFORMS.has(d.split(".")[0]);

const norm = (k: string) => k.toLowerCase().replace(/\s+/g, " ").trim();
const cutoff = () => new Date(Date.now() - DAYS * 86_400_000).toISOString();

type Row = { keyword: string; domain: string; position: number };

/** PostgREST returns at most 1000 rows per request: read page by page. */
async function pages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  max = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data } = await build(from, from + 999);
    const part = data ?? [];
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}

Deno.serve(
  handle(async (req) => {
    await requireUser(req);
    const body = await req.json();
    const u = parseInput(body.url);
    const host = u.hostname.replace(/^www\./, "");
    const domain = isShared(host) ? host : rootDomain(host);
    const country = String(body.country ?? "gb").toLowerCase();
    const db = admin();

    // 1) the site's keywords: what the bank says it ranks for + the target keywords of this check
    const own = await pages<{ keyword: string }>((a, b) =>
      db
        .from("serp_positions")
        .select("keyword")
        .eq("domain", domain)
        .eq("country", country)
        .gte("last_seen", cutoff())
        .order("keyword")
        .range(a, b),
    );
    const target = new Set<string>(own.map((r) => r.keyword));
    for (const k of (body.keywords as string[]) ?? []) {
      const n = norm(String(k));
      if (n.length >= 2 && n.length <= 90) target.add(n);
    }
    const keywords = [...target].slice(0, MAX_KEYWORDS);
    if (!keywords.length)
      return json({ domain, country, total: 0, keywords: 0, competitors: [], map: [] });

    // 2) who else ranks for those keywords
    const byDomain = new Map<string, { kws: Set<string>; pos: number }>();
    for (let i = 0; i < keywords.length; i += 100) {
      const part = keywords.slice(i, i + 100);
      const rows = await pages<Row>((a, b) =>
        db
          .from("serp_positions")
          .select("keyword, domain, position")
          .eq("country", country)
          .in("keyword", part)
          .lte("position", MAX_TOP_POSITION)
          .gte("last_seen", cutoff())
          .order("keyword")
          .order("domain")
          .range(a, b),
      );
      for (const r of rows) {
        if (r.domain === domain || isPlatform(r.domain)) continue;
        const e = byDomain.get(r.domain) ?? { kws: new Set<string>(), pos: 0 };
        if (!e.kws.has(r.keyword)) {
          e.kws.add(r.keyword);
          e.pos += r.position;
        }
        byDomain.set(r.domain, e);
      }
    }

    const ranked = [...byDomain.entries()]
      .map(([d, e]) => ({
        domain: d,
        common: e.kws.size,
        avgPosition: Math.round((e.pos / e.kws.size) * 10) / 10,
      }))
      .sort((a, b) => b.common - a.common || a.avgPosition - b.avgPosition);
    const top = ranked.slice(0, RETURN);

    // 3) SE keywords of each shown competitor: how many keywords the bank knows it ranks for (exact count, no rows read)
    const counts = await Promise.all(
      top.map(async (c) => {
        const { count } = await db
          .from("serp_positions")
          .select("keyword", { count: "exact", head: true })
          .eq("domain", c.domain)
          .eq("country", country)
          .gte("last_seen", cutoff());
        return count ?? 0;
      }),
    );

    // 4) positioning map: keywords + estimated traffic for the site and its closest competitors
    const mapDomains = [domain, ...top.slice(0, 6).map((c) => c.domain)];
    const ownCount = await db
      .from("serp_positions")
      .select("keyword", { count: "exact", head: true })
      .eq("domain", domain)
      .eq("country", country)
      .gte("last_seen", cutoff())
      .then((r) => r.count ?? 0);
    const map = await Promise.all(
      mapDomains.map(async (d, i) => {
        const bank = await bankDomainKeywords(d, country, 1500);
        let traffic = 0;
        for (const r of bank.rows) {
          const ff = r.features ? featureFactor(r.features as Features) : 0.92;
          traffic += Math.max(0, r.volume) * ctrAt(r.position) * ff;
        }
        const known = bank.rows.length + bank.pending.length;
        const total = i === 0 ? ownCount : (counts[i - 1] ?? 0);
        return {
          domain: d,
          site: i === 0,
          keywords: Math.max(total, known),
          traffic: Math.round(traffic * 10) / 10,
          // share of this domain's keywords that had a search volume (the traffic estimate only counts those)
          coverage: known ? Math.round((bank.rows.length / known) * 100) : 0,
        };
      }),
    );

    return json({
      domain,
      country,
      map,
      total: ranked.length,
      keywords: keywords.length,
      competitors: top.map((c, i) => ({
        domain: c.domain,
        common: c.common,
        // share of the site's keywords they also rank for; at least 1 so a real overlap never shows as an empty bar
        level: Math.max(1, Math.round((c.common / keywords.length) * 100)),
        seKeywords: Math.max(counts[i], c.common),
        avgPosition: c.avgPosition,
      })),
    });
  }),
);