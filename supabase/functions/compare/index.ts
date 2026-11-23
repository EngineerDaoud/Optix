import { handle, HttpError, json, requireUser } from "../_shared/utils.ts";
import {
  clean,
  detectTech,
  domainAge,
  get,
  homepage,
  meta,
  openPageRank,
  parseInput,
  psi,
  rootDomain,
  schemaTypes,
  tranco,
} from "../_shared/siteinfo.ts";
import { extractHeadings } from "../_shared/headings.ts";
import { linkHref } from "../_shared/htmlmeta.ts";

// Free "my site vs competitors" comparison. Every number is measured live from public sources (no paid API):
//   page fetch (speed, title, meta, headings, schema, images, links), robots.txt + sitemap.xml, Tranco rank,
//   Open PageRank (optional key), domain age (RDAP / web archive), PageSpeed Insights (free Google API).
// Up to 1 site of yours + 4 competitors, all measured in parallel, so the answer comes back in one go.

const settle = async <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  try {
    return await Promise.race([
      p,
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
};

async function sitemapCount(origin: string, robots: string) {
  const found = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const first = found[0] ?? `${origin}/sitemap.xml`;
  const count = async (url: string, depth = 0): Promise<number> => {
    const r = await get(url, 8000);
    if (!r.ok) return 0;
    const x = (await r.text()).slice(0, 3_000_000);
    const locs = [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(x) && depth < 1) {
      const subs = locs.slice(0, 6);
      const parts = await Promise.all(
        subs.map((s) => count(s, depth + 1).catch(() => 0)),
      );
      // index lists many sitemaps: scale the sample of the first 6 up to all of them
      const sum = parts.reduce((a, b) => a + b, 0);
      return Math.round(sum * (locs.length / Math.max(1, subs.length)));
    }
    return locs.length;
  };
  try {
    return await count(first);
  } catch {
    return 0;
  }
}

async function measure(raw: string, withSpeed: boolean) {
  const u = parseInput(raw);
  const host = u.hostname.replace(/^www\./, "");
  const root = rootDomain(host);
  const origin = `${u.protocol}//${u.host}`;
  const t0 = Date.now();

  const pageP = settle(homepage(u), 15000);
  const robotsP = settle(
    get(`${origin}/robots.txt`, 7000).then((r) => (r.ok ? r.text() : "")),
    8000,
  );
  const [page, robots, rank, opr, age] = await Promise.all([
    pageP,
    robotsP,
    settle(tranco(root), 9000),
    settle(openPageRank(root), 9000),
    settle(domainAge(root), 10000),
  ]);
  const ttfbMs = Date.now() - t0;
  const html = page?.html ?? "";
  const speed = withSpeed ? await settle(psi(u.toString(), "mobile"), 70000) : null;
  const sitemap = await settle(sitemapCount(origin, robots ?? ""), 15000);

  const title = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "");
  const desc = meta(html, "description");
  const hd = extractHeadings(html);
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const words = clean(body).split(" ").filter((w) => w.length > 1).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt\s*=\s*["'][^"']+["']/i.test(i)).length;
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map(
    (m) => m[1],
  );
  const internal = links.filter(
    (h) => h.startsWith("/") || h.includes(host),
  ).length;
  const external = links.filter(
    (h) => /^https?:/i.test(h) && !h.includes(host),
  ).length;
  const schema = html ? schemaTypes(html) : [];
  const ok = !!page && page.status < 400 && !!html;

  return {
    input: raw,
    host,
    reachable: ok,
    status: page?.status ?? null,
    https: (page?.finalUrl ?? u.toString()).startsWith("https:"),
    responseMs: ok ? ttfbMs : null,
    title,
    titleLen: title.length,
    metaDescLen: desc.length,
    hasMetaDesc: desc.length > 0,
    canonical: !!linkHref(html, "canonical"),
    viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    openGraph: /<meta[^>]+property=["']og:title["']/i.test(html),
    h1Count: hd.h1n,
    h2Count: hd.h2,
    h3Count: hd.h3,
    words,
    images: imgs.length,
    imagesNoAlt: noAlt,
    internalLinks: internal,
    externalLinks: external,
    schema,
    tech: ok ? detectTech(html, page!.headers) : [],
    robotsFound: !!robots,
    sitemapUrls: sitemap ?? 0,
    trancoRank: rank ?? null,
    pageRank: opr?.score ?? null,
    domainSince: age?.since ?? null,
    domainYears: age?.since
      ? Math.max(0, Math.round(((Date.now() - Date.parse(age.since)) / 3.15576e10) * 10) / 10)
      : null,
    speed: speed
      ? {
          performance: speed.scores?.performance ?? null,
          seo: speed.scores?.seo ?? null,
          accessibility: speed.scores?.accessibility ?? null,
          lcp: speed.vitals?.lcp ?? null,
          cls: speed.vitals?.cls ?? null,
          tbt: speed.vitals?.tbt ?? null,
        }
      : null,
  };
}

type Site = Awaited<ReturnType<typeof measure>>;

// Metric table: higher or lower is better, used for "who wins" and for the fix list.
const METRICS: {
  key: string;
  label: string;
  better: "high" | "low";
  get: (s: Site) => number | null;
  fix: string;
}[] = [
  { key: "speed", label: "Mobile speed score", better: "high", get: (s) => s.speed?.performance ?? null, fix: "Improve mobile speed: compress images, remove unused JavaScript, use caching and a CDN." },
  { key: "lcp", label: "Largest paint (ms)", better: "low", get: (s) => s.speed?.lcp ?? null, fix: "Make the main image/heading load faster (preload it, use WebP/AVIF, smaller hero image)." },
  { key: "resp", label: "Server response (ms)", better: "low", get: (s) => s.responseMs, fix: "Server answers slowly: add page caching or a faster host." },
  { key: "rank", label: "Tranco rank", better: "low", get: (s) => s.trancoRank, fix: "Authority is lower: earn links and mentions from relevant sites." },
  { key: "pr", label: "Open PageRank", better: "high", get: (s) => s.pageRank, fix: "Link authority is lower: build backlinks (guest posts, directories, digital PR)." },
  { key: "age", label: "Domain age (years)", better: "high", get: (s) => s.domainYears, fix: "Domain is younger; this only improves with time and steady publishing." },
  { key: "sitemap", label: "Pages in sitemap", better: "high", get: (s) => s.sitemapUrls || null, fix: "Competitor has more indexable pages: publish more useful pages (guides, categories, FAQs)." },
  { key: "words", label: "Words on home page", better: "high", get: (s) => s.words, fix: "Home page has less text: add helpful sections that explain what you do (aim for 500+ words)." },
  { key: "h2", label: "H2 headings", better: "high", get: (s) => s.h2Count, fix: "Add more H2 section headings with the keywords people search." },
  { key: "schema", label: "Schema types", better: "high", get: (s) => s.schema.length, fix: "Add structured data (Organization, WebSite, FAQ, Product/LocalBusiness) so Google can show rich results." },
  { key: "alt", label: "Images missing alt", better: "low", get: (s) => (s.images ? s.imagesNoAlt : null), fix: "Add descriptive alt text to every image." },
  { key: "int", label: "Internal links", better: "high", get: (s) => s.internalLinks, fix: "Add more internal links between your important pages." },
];

function verdict(sites: Site[]) {
  const me = sites[0];
  const rivals = sites.slice(1);
  const rows = METRICS.map((m) => {
    const vals = sites.map((s) => m.get(s));
    const known = vals.filter((v): v is number => v != null);
    let winner: number | null = null;
    if (known.length >= 2) {
      const best = m.better === "high" ? Math.max(...known) : Math.min(...known);
      const idx = vals.indexOf(best);
      if (vals.filter((v) => v === best).length === 1) winner = idx;
    }
    return { key: m.key, label: m.label, better: m.better, values: vals, winner };
  });

  const fixes: { metric: string; you: number | null; best: number; bestHost: string; tip: string }[] = [];
  for (const m of METRICS) {
    const mine = m.get(me);
    let best: number | null = null;
    let bestHost = "";
    for (const r of rivals) {
      const v = m.get(r);
      if (v == null) continue;
      if (best == null || (m.better === "high" ? v > best : v < best)) {
        best = v;
        bestHost = r.host;
      }
    }
    if (best == null) continue;
    const behind =
      mine == null ? false : m.better === "high" ? mine < best * 0.9 : mine > best * 1.1;
    if (behind) fixes.push({ metric: m.label, you: mine, best, bestHost, tip: m.fix });
  }

  // checklist items every site should pass, flagged only for YOUR site
  const todo: string[] = [];
  if (!me.reachable) todo.push("Your site could not be opened. Check the address and that it is online.");
  if (!me.https) todo.push("Site is not on HTTPS.");
  if (!me.hasMetaDesc) todo.push("Home page has no meta description.");
  else if (me.metaDescLen < 70 || me.metaDescLen > 170) todo.push(`Meta description is ${me.metaDescLen} characters (aim for 70 to 160).`);
  if (me.titleLen < 25 || me.titleLen > 65) todo.push(`Title is ${me.titleLen} characters (aim for 30 to 60).`);
  if (me.h1Count !== 1) todo.push(me.h1Count === 0 ? "No H1 heading on the home page." : `${me.h1Count} H1 headings (use exactly one).`);
  if (!me.canonical) todo.push("No canonical link tag.");
  if (!me.viewport) todo.push("No mobile viewport tag.");
  if (!me.openGraph) todo.push("No Open Graph tags (social sharing previews).");
  if (!me.robotsFound) todo.push("No robots.txt found.");
  if (!me.sitemapUrls) todo.push("No sitemap.xml found (or it is empty).");

  const wins = sites.map((_, i) => rows.filter((r) => r.winner === i).length);
  return { rows, fixes, todo, wins };
}

Deno.serve(
  handle(async (req) => {
    await requireUser(req);
    const body = await req.json();
    const mine = String(body.me ?? "").trim();
    const rivals: string[] = (Array.isArray(body.competitors) ? body.competitors : [])
      .map((x: unknown) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    if (!mine) throw new HttpError(400, "Enter your website.");
    if (!rivals.length) throw new HttpError(400, "Add at least one competitor.");
    const withSpeed = body.speed !== false;

    let sites: Site[];
    try {
      sites = await Promise.all(
        [mine, ...rivals].map((s) => measure(s, withSpeed)),
      );
    } catch (e) {
      throw new HttpError(400, (e as Error).message || "Could not read one of the websites.");
    }
    return json({ checkedAt: new Date().toISOString(), sites, ...verdict(sites) });
  }),
);