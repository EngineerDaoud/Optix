import {
  admin,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { takeQuota } from "../_shared/quota.ts";
import {
  buildChecklist,
  emptyFlags,
  type CheckItem,
} from "../_shared/checklist.ts";
import {
  autocompleteInfo,
  domainStrengths,
  expandIdeas,
  keywordVolumes,
  seoEstimate,
  trafficFor,
} from "../_shared/traffic.ts";
import {
  adjustVolume,
  classifyIntent,
  compareRuns,
  extractFeatures,
  featureFactor,
  groupTopics,
  isJunkPhrase,
  isUtilityUrl,
  keywordDifficulty,
  opportunity,
  parseScope,
  scopeCountries,
  shareOfVoice,
  volumeRange,
  type Features,
  type KeywordEvidence,
  type SerpDomain,
} from "../_shared/keywords.ts";
import { claude, setAiDeadline } from "../_shared/ai.ts";
import {
  analysePage,
  canon,
  fetchPage,
  hostOf,
  isLimited,
  LinkStats,
  norm,
  Page,
} from "../_shared/analyse.ts";
import { bankDomainKeywords, recordUniverse } from "../_shared/universe.ts";
import {
  bankEvidence,
  normKw,
  noteLookups,
  rankTrends,
  recordRanks,
  saveEvidence,
  saveKeywordDetails,
  saveSnapshot,
  serpGet,
  serpPut,
} from "../_shared/bank.ts";
import {
  clean,
  crux,
  detectTech,
  domainAge,
  domainDetails,
  get,
  openPageRank,
  isShared,
  meta,
  parseInput,
  psi,
  rootDomain,
  schemaTypes,
  tranco,
} from "../_shared/siteinfo.ts";

// Domain Research agent: works for ANY public website, free data only.
// crawl -> per-page issues -> AI understands the site -> Serper rank check -> competitors + gaps -> AI action plan -> save.
// Search volume, traffic and Keyword Difficulty are ESTIMATES built from free signals (real Google positions, SERP features,
// autocomplete, Tranco rank, AI) and are labelled as estimates in the UI. Backlink counts, DR/DA and revenue are never invented.
// Scope: "country" = one country, "world" = top markets added up, "topic" = same data grouped by content topic.

const MAX_PAGES = 12;
const CACHE_DAYS = 7;
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
const COUNTRY_BY_TLD: Record<string, string> = {
  uk: "gb",
  pk: "pk",
  in: "in",
  ae: "ae",
  ca: "ca",
  au: "au",
  de: "de",
  fr: "fr",
  es: "es",
  it: "it",
  nl: "nl",
  sa: "sa",
  tr: "tr",
  br: "br",
  mx: "mx",
  za: "za",
  ng: "ng",
};
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
const STOP = new Set(
  "this that with from your have will they their about which would there been were what when where more than also into only other some such these those them then very just like over most make made many much each both here does doing being while after before under again once because without within between through during against could should shall might must can our out are was for and the not but you all any her his its who why how get got use used using new one two".split(
    " ",
  ),
);

type Sev = "high" | "medium" | "low";
type PageIssue = {
  id: string;
  label: string;
  severity: Sev;
  fix: string;
  detail?: string;
};
type Hit = { position: number; title: string; url: string; domain: string };
type Ranking = {
  keyword: string;
  position: number | null;
  url: string | null;
  title: string | null;
  top: Hit[];
  commercial?: boolean;
  error?: string;
  features?: Features;
  serp?: { domains: SerpDomain[]; titleMatches: number };
};

const CATALOG: Record<string, { label: string; severity: Sev; fix: string }> = {
  status: {
    label: "Page did not load properly",
    severity: "high",
    fix: "Fix or redirect this URL. Pages that return errors lose rankings and waste crawl budget. Also remove it from the sitemap if it is gone.",
  },
  noindex: {
    label: "Blocked from Google (noindex)",
    severity: "high",
    fix: "Remove the noindex tag if this page should appear in search results.",
  },
  "no-title": {
    label: "Missing title tag",
    severity: "high",
    fix: "Add a unique <title> of about 30 to 60 characters that includes the main keyword of the page.",
  },
  "title-short": {
    label: "Title is too short",
    severity: "low",
    fix: "Use 30 to 60 characters so the title explains the page and includes the main keyword.",
  },
  "title-long": {
    label: "Title is too long",
    severity: "low",
    fix: "Keep the title under about 60 characters. Google cuts longer titles in the results.",
  },
  "dup-title": {
    label: "Duplicate title",
    severity: "medium",
    fix: "Give every page its own title. Identical titles make it hard for Google to tell pages apart.",
  },
  "no-desc": {
    label: "Missing meta description",
    severity: "medium",
    fix: "Add a meta description of 70 to 160 characters that sells the click.",
  },
  "desc-short": {
    label: "Meta description is too short",
    severity: "low",
    fix: "Expand it to 70 to 160 characters.",
  },
  "desc-long": {
    label: "Meta description is too long",
    severity: "low",
    fix: "Shorten it to about 160 characters so it is not cut off.",
  },
  "dup-desc": {
    label: "Duplicate meta description",
    severity: "low",
    fix: "Write a unique description for each page.",
  },
  "no-h1": {
    label: "Missing H1 heading",
    severity: "medium",
    fix: "Add one H1 that states what the page is about.",
  },
  "multi-h1": {
    label: "More than one H1 heading",
    severity: "low",
    fix: "Keep a single H1 and use H2 or H3 for sub-headings.",
  },
  thin: {
    label: "Thin content (under 300 words)",
    severity: "medium",
    fix: "Add useful, original content that answers what visitors search for. Merge or noindex pages that cannot be improved.",
  },
  "no-canonical": {
    label: "No canonical tag",
    severity: "low",
    fix: 'Add <link rel="canonical"> pointing to the preferred URL to avoid duplicate-content problems.',
  },
  alt: {
    label: "Images missing alt text",
    severity: "medium",
    fix: "Add short descriptive alt text to every meaningful image. It helps accessibility and image search.",
  },
  "no-size": {
    label: "Images without width and height",
    severity: "low",
    fix: "Add width and height attributes so the page does not jump while loading (layout shift).",
  },
  "no-viewport": {
    label: "No mobile viewport tag",
    severity: "high",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the page is mobile friendly.',
  },
  "no-lang": {
    label: "No language set on the page",
    severity: "low",
    fix: 'Add a lang attribute to the <html> tag, for example lang="en".',
  },
  "no-og": {
    label: "No Open Graph tags",
    severity: "low",
    fix: "Add og:title, og:description and og:image so links look good when shared.",
  },
  slow: {
    label: "Slow server response",
    severity: "medium",
    fix: "Improve hosting, caching or server work. Aim for the first response in under 800 ms.",
  },
  mixed: {
    label: "Insecure (http) resources on an https page",
    severity: "medium",
    fix: "Load every image, script and style over https to avoid browser warnings.",
  },
  "broken-ext": {
    label: "Links to a broken external page",
    severity: "low",
    fix: "Remove or replace the external links that return errors. Dead outbound links hurt user trust and look neglected.",
  },
  "broken-link": {
    label: "Links to a broken page",
    severity: "medium",
    fix: "Update or remove the links that point to pages returning errors.",
  },
};
const WEIGHT: Record<Sev, number> = { high: 25, medium: 10, low: 3 };

const isPlatform = (root: string) => PLATFORM_NAMES.has(root.split(".")[0]);

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
        const idx = i++;
        out[idx] = await worker(items[idx]);
      }
    }),
  );
  return out;
}

function parseJson(t: string): any {
  const s = t.replace(/```json|```/g, "").trim();
  const a = s.indexOf("{"),
    b = s.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}

// ---------- 1. crawl ----------

async function discover(
  origin: string,
  hostKey: string,
  homeHtml: string,
  skipUrl: string,
): Promise<string[]> {
  const found: string[] = [];
  const add = (u: string) => {
    try {
      const x = new URL(u, origin);
      x.hash = "";
      if (!/^https?:$/.test(x.protocol)) return;
      if (x.hostname.toLowerCase().replace(/^www\./, "") !== hostKey) return;
      if (
        /\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js|json|xml|ico|mp4|mp3|woff2?|txt|md|markdown|ya?ml|csv|rss|atom)$/i.test(
          x.pathname,
        )
      )
        return;
      found.push(x.toString());
    } catch {
      /* skip bad url */
    }
  };
  const locsOf = (xml: string) =>
    [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  try {
    let sm = `${origin}/sitemap.xml`;
    try {
      const rb = await get(`${origin}/robots.txt`, 5000);
      if (rb.ok) {
        const m = (await rb.text()).match(/^\s*sitemap:\s*(\S+)/im);
        if (m) sm = m[1];
      }
    } catch {
      /* use default sitemap path */
    }
    const r = await get(sm, 8000);
    if (r.ok) {
      const xml = await r.text();
      let locs = locsOf(xml);
      if (/<sitemapindex/i.test(xml)) {
        const pages: string[] = [];
        for (const c of locs.slice(0, 2)) {
          try {
            const cr = await get(c, 8000);
            if (cr.ok) pages.push(...locsOf(await cr.text()));
          } catch {
            /* skip child sitemap */
          }
        }
        locs = pages;
      }
      locs.forEach(add);
    }
  } catch {
    /* no sitemap, fall back to links */
  }
  for (const m of homeHtml.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi))
    add(m[1]);

  const seen = new Set<string>([norm(skipUrl), norm(origin)]);
  const uniq: string[] = [];
  for (const u of found) {
    const key = norm(u);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(u);
  }
  const depth = (u: string) =>
    new URL(u).pathname.split("/").filter(Boolean).length;
  return uniq.sort((a, b) => depth(a) - depth(b));
}

// ---------- 2. issues, per page and per site ----------

function pageIssues(
  p: Page,
  ctx: {
    dupTitle: Set<string>;
    dupDesc: Set<string>;
    broken: Set<string>;
    brokenExt: Set<string>;
  },
): PageIssue[] {
  const out: PageIssue[] = [];
  const add = (id: string, detail?: string, severity?: Sev) => {
    const c = CATALOG[id];
    out.push({
      id,
      label: c.label,
      severity: severity ?? c.severity,
      fix: c.fix,
      ...(detail ? { detail } : {}),
    });
  };
  if (p.status === 200 && p.nonHtml) return out; // .md / .txt / .json / .pdf files are not web pages: HTML checks do not apply
  if (p.status !== 200) {
    add(
      "status",
      p.status === 0
        ? "The page could not be fetched (timeout or connection error)"
        : `Returned status ${p.status}`,
    );
    return out;
  }
  if (p.noindex) add("noindex");
  if (!p.title) add("no-title");
  else {
    if (p.title.length < 20) add("title-short", `${p.title.length} characters`);
    if (p.title.length > 65) add("title-long", `${p.title.length} characters`);
    if (ctx.dupTitle.has(p.title.trim().toLowerCase()))
      add("dup-title", p.title.slice(0, 80));
  }
  if (!p.description) add("no-desc");
  else {
    if (p.description.length < 70)
      add("desc-short", `${p.description.length} characters`);
    if (p.description.length > 165)
      add("desc-long", `${p.description.length} characters`);
    if (ctx.dupDesc.has(p.description.trim().toLowerCase())) add("dup-desc");
  }
  if (p.h1s.length === 0) add("no-h1");
  else if (p.h1s.length > 1) add("multi-h1", `${p.h1s.length} H1 headings`);
  if (p.words < 300) add("thin", `${p.words} words`);
  if (!p.canonical)
    add(
      "no-canonical",
      'No <link rel="canonical"> found in the <head> of this page',
    );
  if (p.images.noAlt > 0)
    add(
      "alt",
      `${p.images.noAlt} of ${p.images.total} images`,
      p.images.noAlt > 3 ? "medium" : "low",
    );
  if (p.images.noSize > 3)
    add("no-size", `${p.images.noSize} of ${p.images.total} images`);
  if (!p.viewport)
    add(
      "no-viewport",
      'No <meta name="viewport"> found in the <head> of this page',
    );
  if (!p.lang) add("no-lang", "The <html> tag has no lang attribute");
  if (!p.og)
    add(
      "no-og",
      p.ogMissing?.length
        ? `Missing in the <head>: ${p.ogMissing.join(", ")}`
        : "No og:title, og:description or og:image found in the <head>",
    );
  if (p.ms > 2000)
    add(
      "slow",
      `${p.ms} ms to first response`,
      p.ms > 4000 ? "high" : "medium",
    ); // PageSpeed (Speed score) is the real speed test; this only catches clearly slow servers
  if (p.mixed > 0 && p.url.startsWith("https:"))
    add("mixed", `${p.mixed} http resources`);
  const broken = p.internalUrls.filter((u) => ctx.broken.has(canon(u) ?? ""));
  if (broken.length)
    add(
      "broken-link",
      `${broken.length} broken: ${broken.slice(0, 3).join(", ")}`,
      broken.length > 3 ? "high" : undefined,
    );
  const brokenX = p.externalLinks.filter((l) =>
    ctx.brokenExt.has(canon(l.url) ?? ""),
  );
  if (brokenX.length)
    add(
      "broken-ext",
      `${brokenX.length} broken: ${brokenX
        .slice(0, 3)
        .map((l) => l.url)
        .join(", ")}`,
    );
  return out;
}

const pageScore = (issues: PageIssue[]) =>
  Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHT[i.severity], 0));

// Pick pages from DIFFERENT parts of the site (collections, products, blog...) one by one, so the keyword ideas cover what the
// site really sells instead of only the first few pages that were crawled.
function diversePages(pages: Page[], n: number): Page[] {
  const ok = pages.filter((p) => p.status === 200 && !isUtilityUrl(p.url)); // cart, login, privacy... never feed keyword ideas
  const groups = new Map<string, Page[]>();
  for (const p of ok) {
    let g = "";
    try {
      g = new URL(p.url).pathname.split("/")[1] ?? "";
    } catch {
      /* keep home group */
    }
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(p);
  }
  const lists = [...groups.values()];
  const out: Page[] = [];
  for (
    let round = 0;
    out.length < n && lists.some((l) => l.length > round);
    round++
  ) {
    for (const l of lists) if (l[round] && out.length < n) out.push(l[round]);
  }
  return out;
}

// Alternate two keyword lists (first list first), without repeats.
function mixSeeds(a: string[], b: string[], max = 25): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; out.length < max && (i < a.length || i < b.length); i++) {
    for (const w of [a[i], b[i]])
      if (w && !seen.has(w) && !isJunkPhrase(w) && out.length < max) {
        seen.add(w);
        out.push(w);
      }
  }
  return out;
}

// ---------- 3. understand the site (AI, only from crawled text) ----------

async function understand(site: string, pages: Page[], want = 40) {
  const input = JSON.stringify({
    site,
    pages: diversePages(pages, 12).map((p) => ({
      url: p.url,
      title: p.title,
      description: p.description,
      h1: p.h1s.slice(0, 2),
      text: p.text.slice(0, 600),
    })),
  });
  const system = `You analyse a website using ONLY the page data provided. Return ONLY a JSON object, no markdown:
{"topic": "one short sentence", "audience": "one short sentence", "language": "two-letter code such as en", "offerings": ["main products, services or content types"], "seed_keywords": ["..."]}
Rules:
- seed_keywords: up to ${want} phrases of 2 to 5 words that a real customer would type into Google to find this kind of business, product or content. Spread them over EVERY product category, service and topic the pages show (not only the main one), and mix the search types: product or service names, buying phrases (buy, price, for sale, near me, best), comparisons, and problems or questions people search before buying. Use the site's own subject and wording. Prefer SPECIFIC phrases that match the real product, category or collection names on the pages (include models, sizes, voltages, part types and brands that are sold) over broad head terms such as "buy electric bikes uk". At least two thirds of the phrases must be specific. Do not add phrases for products the pages do not show. Never use utility pages as keywords: about, contact, privacy, terms, cart, checkout, login, account, password reset, shipping or returns policy, FAQ.
- No keywords that are only the brand name. Do not invent facts. If the data is too thin, return fewer keywords.`;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = parseJson(
        await claude(system, input, 1200 + want * 25, { json: true }),
      );
      const seen = new Set<string>();
      const seeds: string[] = [];
      for (const k of Array.isArray(j.seed_keywords) ? j.seed_keywords : []) {
        const w = String(k ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        if (
          w.length < 4 ||
          w.length > 70 ||
          w.split(" ").length > 6 ||
          seen.has(w) ||
          isJunkPhrase(w)
        )
          continue;
        seen.add(w);
        seeds.push(w);
      }
      if (!seeds.length) throw new Error("no keywords found");
      return {
        topic: String(j.topic ?? "").slice(0, 300),
        audience: String(j.audience ?? "").slice(0, 300),
        language: String(j.language ?? "")
          .toLowerCase()
          .slice(0, 2),
        offerings: (Array.isArray(j.offerings) ? j.offerings : [])
          .map((o: unknown) => String(o).slice(0, 80))
          .slice(0, 8),
        seeds: seeds.slice(0, want),
      };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`AI could not read the site: ${lastErr}`);
}

// The site's own name, taken from og:site_name, the title, or the domain. Used for brand searches in the traffic estimate.
function brandName(html: string, host: string): string {
  const og =
    html.match(
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,60})["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content=["']([^"']{2,60})["'][^>]+property=["']og:site_name["']/i,
    )?.[1];
  let name = (og ?? "").trim();
  if (!name) {
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = title
      .split(/\s[|\u2013\u2014:-]\s/)
      .map((x) => x.trim())
      .filter(Boolean);
    name = parts.length > 1 ? parts[parts.length - 1] : "";
  }
  if (!name || name.length > 40 || name.split(" ").length > 4)
    name = host.split(".")[0];
  return name.toLowerCase();
}

// ---------- 4. rank check (Serper) ----------

// Results are saved in the serp_cache table (migration 006) for 3 days, so the same keyword is not paid for twice and any site's position
// can be read from the saved top results. "Re-run with fresh data" skips the read (useCache = false) and refreshes the saved copy.
async function serperSearch(
  q: string,
  gl: string,
  hl: string,
  num: number,
  useCache = true,
): Promise<any> {
  if (useCache) {
    const hit = await serpGet(q, gl, num);
    if (hit) return { ...hit.data, _cached: true, _fetchedAt: hit.fetchedAt };
  }
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "X-API-KEY": Deno.env.get("SERPER_API_KEY") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, gl, hl, num }),
  });
  if (!r.ok) {
    const e = new Error(`Serper error ${r.status}`) as Error & {
      status: number;
    };
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  await serpPut(q, gl, num, j);
  return j;
}

async function checkRanks(
  keywords: string[],
  siteHost: string,
  siteRoot: string,
  shared: boolean,
  gl: string,
  hl: string,
  num: number,
  useCache = true,
  deadline = Infinity,
) {
  const rankings: Ranking[] = [];
  let cached = 0;
  const domains = new Map<
    string,
    { root: string; keywords: number; posSum: number }
  >();
  const ideas = new Set<string>();
  let requests = 0;
  let fatal = "";
  const isSite = (host: string) =>
    shared ? host === siteHost : rootDomain(host) === siteRoot;

  await pool(keywords, 6, async (keyword) => {
    if (fatal || Date.now() > deadline) return; // out of time: the keywords already checked are kept
    try {
      const j = await serperSearch(keyword, gl, hl, num, useCache);
      if (j._cached) cached++;
      else requests++;
      const organic: { title?: string; link?: string; position?: number }[] =
        Array.isArray(j.organic) ? j.organic.slice(0, num) : [];
      let position: number | null = null,
        url: string | null = null,
        title: string | null = null;
      const top: Hit[] = [];
      const serpDomains: SerpDomain[] = [];
      let titleMatches = 0;
      const kwWords = keyword.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
      organic.forEach((o, idx) => {
        const link = o.link ?? "";
        const host = hostOf(link);
        if (!host) return;
        const pos = typeof o.position === "number" ? o.position : idx + 1;
        if (pos <= 10) {
          let home = false;
          try {
            home = new URL(link).pathname.replace(/\/+$/, "") === "";
          } catch {
            /* keep false */
          }
          serpDomains.push({
            p: pos,
            d: isSite(host) ? (shared ? siteHost : siteRoot) : rootDomain(host),
            home,
          });
          const tl = (o.title ?? "").toLowerCase();
          if (kwWords.length && kwWords.every((w) => tl.includes(w)))
            titleMatches++;
        }
        if (top.length < 5)
          top.push({
            position: pos,
            title: o.title ?? "",
            url: link,
            domain: rootDomain(host),
          });
        if (isSite(host)) {
          if (position === null) {
            position = pos;
            url = link;
            title = o.title ?? "";
          }
        } else {
          const root = rootDomain(host);
          const d = domains.get(root) ?? { root, keywords: 0, posSum: 0 };
          d.keywords++;
          d.posSum += pos;
          domains.set(root, d);
        }
      });
      for (const p of j.peopleAlsoAsk ?? [])
        if (p?.question) ideas.add(String(p.question));
      for (const s of j.relatedSearches ?? [])
        if (s?.query) ideas.add(String(s.query));
      const commercial =
        (Array.isArray(j.ads) && j.ads.length > 0) ||
        (Array.isArray(j.shopping) && j.shopping.length > 0);
      rankings.push({
        keyword,
        position,
        url,
        title,
        top,
        commercial,
        features: extractFeatures(j),
        serp: { domains: serpDomains, titleMatches },
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403)
        fatal = "Serper rejected the API key. Check SERPER_API_KEY.";
      else if (status === 402 || status === 429)
        fatal =
          "Serper credits or rate limit reached. Try again later or top up credits.";
      rankings.push({
        keyword,
        position: null,
        url: null,
        title: null,
        top: [],
        error: (e as Error).message,
      });
    }
  });

  const checked = rankings.filter((r) => !r.error);
  const all = [...domains.values()]
    .map((d) => ({
      domain: d.root,
      keywords: d.keywords,
      avgPosition: Math.round((d.posSum / d.keywords) * 10) / 10,
      share: checked.length
        ? Math.round((d.keywords / checked.length) * 100)
        : 0,
    }))
    .sort((a, b) => b.keywords - a.keywords || a.avgPosition - b.avgPosition);

  const gaps = checked
    .filter((r) => r.position === null && r.top.length)
    .slice(0, 10)
    .map((r) => ({ keyword: r.keyword, top: r.top.slice(0, 3) }));
  const own = new Set(keywords);
  return {
    rankings: rankings.sort(
      (a, b) => (a.position ?? 999) - (b.position ?? 999),
    ),
    competitors: all.filter((d) => !isPlatform(d.domain)).slice(0, 10),
    platforms: all.filter((d) => isPlatform(d.domain)).slice(0, 5),
    gaps,
    ideas: [...ideas]
      .filter((i) => !own.has(i.toLowerCase()) && !isJunkPhrase(i))
      .slice(0, 30),
    requests,
    cached,
    fatal,
  };
}

// ---------- 5. action plan (AI, must cite evidence from the data) ----------

async function makePlan(data: unknown) {
  const input = JSON.stringify(data);
  const system = `You are an SEO analyst. Use ONLY the data provided. Return ONLY a JSON object, no markdown:
{"tasks": [{"title": "short action title", "why": "one plain sentence", "action": "one concrete step", "priority": "high"|"medium"|"low", "evidence": "the exact numbers, keywords, page counts or URLs from the data this is based on"}]}
Rules:
- 6 to 10 tasks, most important first.
- "evidence" must repeat real values from the data (for example a keyword and its position, an issue count, a URL or a score). If you cannot point to evidence, do not write the task.
- Volumes, traffic and keyword difficulty in the data are rough ESTIMATES: if you use them, call them "estimated". Never mention backlink counts, domain authority or revenue. That data is not provided.
- Do not invent competitors, keywords, pages or numbers.`;
  const lc = input.toLowerCase();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = parseJson(await claude(system, input, 2500, { json: true }));
      const tasks = (Array.isArray(j.tasks) ? j.tasks : [])
        .map((t: Record<string, unknown>) => ({
          title: String(t.title ?? "").slice(0, 140),
          why: String(t.why ?? "").slice(0, 300),
          action: String(t.action ?? "").slice(0, 400),
          priority: ["high", "medium", "low"].includes(String(t.priority))
            ? String(t.priority)
            : "medium",
          evidence: String(t.evidence ?? "").slice(0, 300),
        }))
        .filter((t: { title: string; action: string; evidence: string }) => {
          if (!t.title || !t.action || t.evidence.length < 8) return false;
          const toks = t.evidence.toLowerCase().match(/[a-z0-9.]{4,}/g) ?? [];
          return toks.filter((x) => lc.includes(x)).length >= 2; // evidence must really appear in the input
        })
        .slice(0, 10);
      if (tasks.length) return tasks;
    } catch {
      /* retry once */
    }
  }
  return [];
}

// If the AI step fails, still check rankings using phrases taken from titles and H1 headings (brand-only phrases are skipped).
function fallbackSeeds(pages: Page[], host: string): string[] {
  const brand = host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of raw.split(/\s[|\-–—:•·]\s|\|/)) {
      const w = part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s'&]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const squashed = w.replace(/\s/g, "");
      const n = w.split(" ").length;
      if (
        w.length < 4 ||
        w.length > 60 ||
        n < 2 ||
        n > 6 ||
        seen.has(w) ||
        isJunkPhrase(w)
      )
        continue;
      if (
        squashed === brand ||
        brand.includes(squashed) ||
        squashed.includes(brand)
      )
        continue;
      seen.add(w);
      out.push(w);
    }
  };
  for (const p of diversePages(pages, pages.length)) {
    p.h1s.slice(0, 1).forEach(add);
    add(p.title);
  }
  return out.slice(0, 80);
}

// ---------- main ----------

const guessCountry = (host: string) =>
  COUNTRY_BY_TLD[host.split(".").pop() ?? ""] ?? "us";

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const u = parseInput(body.url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const c = String(body.country ?? "").toLowerCase();
    const gl = /^[a-z]{2}$/.test(c) ? c : guessCountry(host);
    const num = Number(body.depth) === 30 ? 30 : 10;
    // how many keywords to check: 40 by default (was 15), up to 100. Each one costs one Serper search, but saved results are reused for 3 days.
    const kwLimit = Math.min(100, Math.max(5, Number(body.maxKeywords) || 40));
    const scope = parseScope(body.scope);
    const serperKey = !!Deno.env.get("SERPER_API_KEY");
    const jobId = body.job_id ? String(body.job_id) : null; // set when the full-site crawl (crawl function) already ran
    const useCache = !body.fresh; // saved Google results and keyword numbers (data bank) are reused unless "Re-run with fresh data" was pressed

    // reuse a recent saved run so Serper credits are not wasted (the data bank below saves credits on top of this)
    if (!body.force && !jobId) {
      const since = new Date(
        Date.now() - CACHE_DAYS * 86_400_000,
      ).toISOString();
      const { data: cachedRows } = await admin()
        .from("research_runs")
        .select("id, result, created_at")
        .eq("user_id", user.id)
        .eq("host", host)
        .eq("country", gl)
        .eq("depth", num)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      // reports saved before version 3 may hold junk keywords (privacy policy, cart...) or lack difficulty, so they are ignored and re-made
      const data =
        (cachedRows ?? []).find(
          (r) =>
            (r.result?.meta?.scope ?? "country") === scope &&
            (r.result?.meta?.v ?? 1) >= 3 &&
            (r.result?.meta?.kwLimit ?? 15) >= kwLimit,
        ) ?? null;
      const staleNoSerper =
        data?.result?.meta?.serperUsed === false && serperKey;
      if (data && !staleNoSerper)
        return json({
          ...data.result,
          id: data.id,
          cached: true,
          createdAt: data.created_at,
        });
    }
    if (body.cacheOnly) return json({ miss: true });
    await takeQuota(user, "research"); // a real (not saved) run starts here, so it counts against the daily free limit

    const notes: string[] = [];
    const t0 = Date.now();
    setAiDeadline(t0 + 120_000); // keep well under the 150 s edge function limit
    const elapsed = () => Date.now() - t0;
    let homeRes: Response;
    try {
      homeRes = await get(u.toString(), 12000);
    } catch {
      throw new HttpError(
        502,
        "Could not open that website. Check the address and try again.",
      );
    }
    const homeMs = Date.now() - t0;
    const finalUrl = homeRes.url;
    const finalOrigin = new URL(finalUrl).origin;
    const finalHost = new URL(finalUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    const shared = isShared(finalHost);
    const siteRoot = rootDomain(finalHost);
    const isInternal = (h: string) =>
      shared ? h === finalHost : rootDomain(h) === siteRoot;
    const homeHtml = (homeRes.headers.get("content-type") ?? "").includes(
      "text/html",
    )
      ? (await homeRes.text()).slice(0, 1_500_000)
      : "";

    // slow free lookups run in parallel with the crawl
    const factsP = Promise.allSettled([
      Promise.race([
        psi(finalUrl),
        new Promise<never>((_, rej) =>
          setTimeout(
            () =>
              rej(
                new Error(
                  "Speed test took too long and was skipped. Press Re-run.",
                ),
              ),
            98000,
          ),
        ),
      ]),
      crux(finalOrigin),
      shared ? Promise.resolve(null) : tranco(siteRoot),
      shared ? Promise.resolve(null) : domainAge(siteRoot),
      shared ? Promise.resolve(null) : domainDetails(siteRoot),
      shared ? Promise.resolve(null) : openPageRank(siteRoot),
      Promise.race([
        psi(finalUrl, "desktop"),
        new Promise<never>((_, rej) =>
          setTimeout(
            () =>
              rej(
                new Error(
                  "Desktop speed test took too long and was skipped. Press Re-run.",
                ),
              ),
            98000,
          ),
        ),
      ]),
    ]);

    // crawl: use the full-site crawl job made by the `crawl` function, or fall back to a quick 12-page crawl
    let pages: Page[];
    let urlsDiscovered: number;
    let crawlInfo: Record<string, unknown> | null = null;
    const brokenSet = new Set<string>();
    const brokenExt = new Set<string>();
    const brokenStatus = new Map<string, number>();
    const badStatus = (st: number, kind: string) =>
      kind === "ext"
        ? st === 404 || st === 410 || st >= 500
        : st === 0 || (st >= 400 && ![401, 403, 429, 430].includes(st));
    if (jobId) {
      const { data: job } = await admin()
        .from("crawl_jobs")
        .select("*")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!job) throw new HttpError(404, "Crawl not found. Start again.");
      const rows: {
        url: string;
        kind: string;
        status: number | null;
        page: Page | null;
      }[] = [];
      for (let from = 0; ; from += 300) {
        const { data } = await admin()
          .from("crawl_pages")
          .select("url, kind, status, page")
          .eq("job_id", jobId)
          .order("depth")
          .order("url")
          .range(from, from + 299);
        rows.push(...((data ?? []) as typeof rows));
        if (!data || data.length < 300) break;
      }
      const seenPage = new Set<string>();
      const loaded: Page[] = [];
      let linksChecked = 0;
      let limitedPages = 0; // pages the website would not show us because we asked too fast (429): unchecked, not broken
      for (const r of rows) {
        const key = canon(r.url) ?? r.url;
        if (r.kind === "page" ? isLimited(r.page?.status ?? r.status) : isLimited(r.status)) {
          if (r.kind === "page") limitedPages++;
          continue;
        }
        if (r.kind === "page" && r.page) {
          const pk = canon(r.page.url) ?? r.page.url;
          if (!seenPage.has(pk)) {
            seenPage.add(pk);
            loaded.push(r.page);
          }
        }
        if (r.kind !== "page") linksChecked++;
        const st = r.status;
        if (st === null || st === undefined) continue;
        if (r.kind === "page" ? st !== 200 : badStatus(st, r.kind)) {
          if (r.kind === "ext") brokenExt.add(key);
          else if (r.kind === "link" || badStatus(st, "page")) {
            brokenSet.add(key);
            brokenStatus.set(key, st);
          }
        }
      }
      if (!loaded.length)
        throw new HttpError(502, "The crawl found no pages. Try again.");
      const homeKey = canon(finalUrl);
      loaded.sort(
        (x, y) =>
          Number(canon(y.url) === homeKey) - Number(canon(x.url) === homeKey),
      );
      pages = loaded;
      urlsDiscovered =
        rows.filter((r) => r.kind !== "ext").length + (job.skipped ?? 0);
      crawlInfo = {
        full: true,
        maxPages: job.max_pages,
        rendered: job.rendered ?? 0,
        skipped: job.skipped ?? 0,
        linksChecked,
      };
      if (limitedPages > 0)
        notes.push(
          `${limitedPages} page(s) could not be checked because the website slowed our checker down (status 429). They are not counted as problems and do not change the scores. Run the check again in a few minutes to include them.`,
        );
      if ((job.rendered ?? 0) > 0)
        notes.push(
          `${job.rendered} page(s) are built with JavaScript, so they were opened in a browser service to read their real text and links.`,
        );
      const jsOnly = pages.filter(
        (p) =>
          p.status === 200 &&
          !p.rendered &&
          p.words < 40 &&
          p.linkStats.internal < 3,
      ).length;
      if (jsOnly > 0)
        notes.push(
          `${jsOnly} page(s) look empty without JavaScript and could not be rendered (rendering is off, the render limit was reached, or the render service failed). Their word counts and links may be too low.`,
        );
      if ((job.skipped ?? 0) > 0)
        notes.push(
          `${job.skipped} more internal URLs were found than the crawl limits allow, so they were not checked.`,
        );
    } else {
      const homePage = analysePage(
        homeHtml,
        finalUrl,
        homeRes.status,
        homeMs,
        isInternal,
      );
      const urls = await discover(finalOrigin, finalHost, homeHtml, finalUrl);
      const others = await pool(urls.slice(0, MAX_PAGES - 1), 5, (x) =>
        fetchPage(x, isInternal),
      );
      pages = [homePage, ...others.filter((p) => !isLimited(p.status))];
      urlsDiscovered = urls.length + 1;
      for (const p of pages)
        if (p.status !== 200) {
          const k = canon(p.url) ?? p.url;
          brokenSet.add(k);
          brokenStatus.set(k, p.status);
        }
    }

    // issues per page and per site
    const okPages = pages.filter((p) => p.status === 200);
    const dupOf = (key: (p: Page) => string) => {
      const g = new Map<string, number>();
      for (const p of okPages) {
        const k = key(p).trim().toLowerCase();
        if (k) g.set(k, (g.get(k) ?? 0) + 1);
      }
      return new Set([...g.entries()].filter(([, n]) => n > 1).map(([k]) => k));
    };
    const ctx = {
      dupTitle: dupOf((p) => p.title),
      dupDesc: dupOf((p) => p.description),
      broken: brokenSet,
      brokenExt,
    };
    const pageOut = pages.map((p) => {
      const issues = pageIssues(p, ctx);
      return {
        url: p.url,
        status: p.status,
        ms: p.ms,
        title: p.title,
        description: p.description,
        h1s: p.h1s,
        h2: p.h2,
        h3: p.h3,
        words: p.words,
        schema: p.schema,
        linkStats: p.linkStats,
        images: p.images,
        score: pageScore(issues),
        issues,
      };
    });
    const health = pageOut.length
      ? Math.round(pageOut.reduce((s, p) => s + p.score, 0) / pageOut.length)
      : 0;
    const byId = new Map<
      string,
      {
        id: string;
        label: string;
        severity: Sev;
        fix: string;
        count: number;
        examples: string[];
      }
    >();
    const severity = { high: 0, medium: 0, low: 0 };
    for (const p of pageOut) {
      for (const i of p.issues) {
        severity[i.severity]++;
        const g = byId.get(i.id) ?? {
          id: i.id,
          label: i.label,
          severity: CATALOG[i.id].severity,
          fix: i.fix,
          count: 0,
          examples: [],
        };
        g.count++;
        if (g.examples.length < 5) g.examples.push(p.url);
        byId.set(i.id, g);
      }
    }
    const order = { high: 0, medium: 1, low: 2 };
    const issues = [...byId.values()].sort(
      (a, b) => order[a.severity] - order[b.severity] || b.count - a.count,
    );

    // broken links with the pages that contain them
    const brokenMap = new Map<
      string,
      {
        url: string;
        status: number | null;
        kind: "internal" | "external";
        count: number;
        from: string[];
      }
    >();
    for (const p of pages) {
      for (const u of p.internalUrls) {
        const k = canon(u) ?? "";
        if (!brokenSet.has(k)) continue;
        const e = brokenMap.get(k) ?? {
          url: u,
          status: brokenStatus.get(k) ?? null,
          kind: "internal" as const,
          count: 0,
          from: [],
        };
        e.count++;
        if (e.from.length < 5 && !e.from.includes(p.url)) e.from.push(p.url);
        brokenMap.set(k, e);
      }
      for (const l of p.externalLinks) {
        const k = canon(l.url) ?? "";
        if (!brokenExt.has(k)) continue;
        const e = brokenMap.get(k) ?? {
          url: l.url,
          status: null,
          kind: "external" as const,
          count: 0,
          from: [],
        };
        e.count++;
        if (e.from.length < 5 && !e.from.includes(p.url)) e.from.push(p.url);
        brokenMap.set(k, e);
      }
    }
    const brokenLinks = [...brokenMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 200);

    // totals for the links and images tabs, content terms
    const sum = (k: keyof LinkStats) =>
      pages.reduce((s, p) => s + p.linkStats[k], 0);
    const links = {
      internal: sum("internal"),
      external: sum("external"),
      nofollow: sum("nofollow"),
      dofollow: sum("dofollow"),
      noreferrer: sum("noreferrer"),
      noopener: sum("noopener"),
      anchors: sum("anchors"),
      external_list: pages
        .flatMap((p) =>
          p.externalLinks.map((l) => ({
            ...l,
            domain: hostOf(l.url),
            from: p.url,
          })),
        )
        .slice(0, 100),
    };
    const images = {
      total: pages.reduce((s, p) => s + p.images.total, 0),
      noAlt: pages.reduce((s, p) => s + p.images.noAlt, 0),
      noSize: pages.reduce((s, p) => s + p.images.noSize, 0),
      notLazy: pages.reduce((s, p) => s + p.images.notLazy, 0),
      worst: pages
        .flatMap((p) => p.images.badAlt.map((src) => ({ src, page: p.url })))
        .slice(0, 30),
    };
    const freq = new Map<string, number>();
    for (const p of okPages)
      for (const w of p.text.toLowerCase().match(/[a-z]{4,}/g) ?? [])
        if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const terms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([word, count]) => ({ word, count }));

    // understand + rank
    let profile: Awaited<ReturnType<typeof understand>> | null = null;
    let ranks: Awaited<ReturnType<typeof checkRanks>> | null = null;
    let aiOk = true;
    try {
      profile = await understand(finalUrl, pages, Math.min(50, kwLimit));
      // titles and headings of real pages are phrases the site is built around: put them next to the AI ideas
      profile.seeds = mixSeeds(
        fallbackSeeds(pages, finalHost),
        profile.seeds,
        kwLimit + 15,
      );
    } catch (e) {
      aiOk = false;
      notes.push((e as Error).message);
      const seeds = fallbackSeeds(pages, finalHost);
      if (seeds.length) {
        profile = {
          topic: "",
          audience: "",
          language: "",
          offerings: [],
          seeds,
        };
        notes.push(
          "Because the AI step failed, ranking keywords were taken from page titles and headings instead.",
        );
      }
    }
    // SAME KEYWORDS EVERY RUN: the AI writes a slightly different keyword list each time, which made rankings and traffic jump between runs.
    // So the keywords checked last time for this site are reused first (new ones only fill the empty slots).
    // Send newKeywords: true in the request to let the AI choose again.
    if (!body.newKeywords) {
      try {
        const { data: prevRun } = await admin()
          .from("research_runs")
          .select("rankings:result->rankings")
          .eq("user_id", user.id)
          .eq("host", host)
          .eq("country", gl)
          .order("created_at", { ascending: false })
          .limit(1);
        const prevList = (
          (
            prevRun?.[0] as
              { rankings?: { keyword?: string; error?: string }[] } | undefined
          )?.rankings ?? []
        )
          .filter((r) => r?.keyword && !r.error)
          .map((r) => String(r.keyword).toLowerCase());
        if (prevList.length >= 3) {
          const keep = [...new Set(prevList)].slice(0, kwLimit);
          const extra = (profile?.seeds ?? []).filter((k) => !keep.includes(k));
          const seeds = [...keep, ...extra].slice(0, kwLimit + 15);
          profile = profile
            ? { ...profile, seeds }
            : { topic: "", audience: "", language: "", offerings: [], seeds };
          notes.push(
            `Same ${keep.length} keywords as the last run were checked, so results can be compared fairly.`,
          );
        }
      } catch {
        /* no earlier run: keep the new keywords */
      }
    }
    const hl = /^[a-z]{2}$/.test(profile?.language ?? "")
      ? profile!.language
      : (LANG_BY_COUNTRY[gl] ?? "en");
    // TOP-UP: when the AI and the page titles gave fewer phrases than asked for, real Google autocomplete phrases of the site's own seeds fill the rest
    // (ordered by how often Google suggests them). They are phrases real people type, so they are checked exactly like the AI ones.
    if (profile && serperKey && profile.seeds.length < kwLimit) {
      try {
        const own = new Set(profile.seeds);
        const need = kwLimit - profile.seeds.length;
        const more = await expandIdeas(
          profile.seeds,
          gl,
          hl,
          own,
          7000,
          4,
          Math.min(100, need * 2),
        );
        const add = more
          .filter(
            (x) => x.keyword.split(" ").length >= 2 && !isJunkPhrase(x.keyword),
          )
          .slice(0, need)
          .map((x) => x.keyword);
        if (add.length) {
          profile = { ...profile, seeds: [...profile.seeds, ...add] };
          notes.push(
            `${add.length} more keywords were added from Google autocomplete to reach ${kwLimit}.`,
          );
        }
      } catch {
        /* top-up is optional */
      }
    }
    // search volumes are asked now, in parallel with the Google checks, so they cannot run out of time later
    const brand = brandName(homeHtml, finalHost);
    // every keyword found on this site is kept forever in the keyword universe (migration 010)
    if (profile)
      await recordUniverse(
        profile.seeds.map((k) => ({
          keyword: k,
          country: gl,
          source: "site" as const,
          seed: finalHost,
        })),
      );
    const volP = profile
      ? keywordVolumes(
          [...new Set([...profile.seeds.slice(0, kwLimit), brand])],
          scopeCountries(scope, gl),
        ).catch(() => null)
      : null;
    if (profile && serperKey) {
      ranks = await checkRanks(
        profile.seeds.slice(0, kwLimit),
        finalHost,
        siteRoot,
        shared,
        gl,
        hl,
        num,
        useCache,
        t0 + 95_000,
      );
      if (ranks.fatal) notes.push(ranks.fatal);
    } else if (profile && !serperKey) {
      notes.push(
        "Ranking check skipped: SERPER_API_KEY is not set in Supabase secrets.",
      );
    }

    // how strong are the domains that rank? (Tranco, cached) -> Keyword Difficulty. Starts now, awaited later.
    const rk = ranks;
    const strengthP =
      rk && !rk.fatal
        ? (() => {
            const freq = new Map<string, number>();
            for (const r of rk.rankings)
              for (const h of r.serp?.domains ?? [])
                freq.set(h.d, (freq.get(h.d) ?? 0) + 1);
            const list = [...freq.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([d]) => d)
              .slice(0, 60);
            return domainStrengths(list, isPlatform).catch(
              () => ({}) as Awaited<ReturnType<typeof domainStrengths>>,
            );
          })()
        : null;

    // site facts
    const [speedR, fieldR, rankR, ageR, domR, oprR, speedDR] = await factsP;
    const val = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
      if (r.status === "fulfilled") return r.value;
      const msg = (r.reason as Error)?.message ?? "failed";
      if (msg === "CRUX_BLOCKED") return null; // not an error for the user: PageSpeed field data is used instead
      notes.push(`${label}: ${msg}`);
      return null;
    };
    let speed = val(speedR, "Speed test");
    let speedDesktop = val(speedDR, "Desktop speed test");
    // Google sometimes cannot finish a heavy site in time. Then the last successful speed test of this site is shown instead of an empty box
    // (and a note says so), so the screen is never blank just because one run timed out.
    if (!speed || !speedDesktop) {
      try {
        const { data: old } = await admin()
          .from("research_runs")
          .select("created_at, site:result->site")
          .eq("user_id", user.id)
          .eq("host", host)
          .order("created_at", { ascending: false })
          .limit(6);
        for (const row of (old ?? []) as {
          created_at: string;
          site?: { speed?: any; speedDesktop?: any };
        }[]) {
          if (!speed && row.site?.speed) {
            speed = row.site.speed;
            notes.push(
              `Mobile speed scores are from the last successful test (${row.created_at.slice(0, 10)}) because Google timed out this time.`,
            );
          }
          if (!speedDesktop && row.site?.speedDesktop) {
            speedDesktop = row.site.speedDesktop;
            notes.push(
              `Desktop speed scores are from the last successful test (${row.created_at.slice(0, 10)}) because Google timed out this time.`,
            );
          }
          if (speed && speedDesktop) break;
        }
      } catch {
        /* no earlier run: the normal "press Re-run" message stays */
      }
    }
    const field = val(fieldR, "Real-user speed") ?? speed?.field ?? null;
    const trancoRank = val(rankR, "Tranco rank");
    const age = val(ageR, "Domain age");
    const domain = val(domR, "Domain record");
    const opr = val(oprR, "OpenPageRank");

    // traffic: real numbers for your own connected sites, a rough guess for others
    let traffic: unknown = null;
    let extraRequests = 0;
    let extraCached = 0;
    let keywordTable: Record<string, unknown>[] = [];
    let topics: ReturnType<typeof groupTopics> = [];
    let sov: ReturnType<typeof shareOfVoice> = [];
    let ideaTable: Record<string, unknown>[] = [];
    let kdCoverage: number | null = null;
    try {
      // SEO estimate: real Google positions x estimated searches x click rate
      let seo: ReturnType<typeof seoEstimate> | null = null;
      const checkedKw = ranks ? ranks.rankings.filter((r) => !r.error) : [];
      if (ranks && !ranks.fatal && checkedKw.length) {
        const extras =
          serperKey &&
          elapsed() < 90_000 &&
          checkedKw.some((r) => r.position !== null)
            ? scopeCountries(scope, gl).slice(1)
            : [];
        const countries = [gl, ...extras];
        const { volumes, source, truth, calibration } =
          (await volP) ??
          (await keywordVolumes(
            checkedKw.map((r) => r.keyword),
            countries,
          ));
        const k5 = [...checkedKw]
          .sort(
            (a, b) =>
              (volumes[b.keyword]?.[gl] ?? 0) - (volumes[a.keyword]?.[gl] ?? 0),
          )
          .slice(0, 5)
          .map((r) => r.keyword);
        const countryPositions: Record<
          string,
          Record<string, number | null>
        > = {};
        for (const c of extras) {
          const lang = LANG_BY_COUNTRY[c] ?? "en";
          const res: Record<string, number | null> = {};
          let failed = false;
          await pool(k5, 4, async (kw) => {
            if (failed) return;
            try {
              const j = await serperSearch(kw, c, lang, num, useCache);
              if (j._cached) extraCached++;
              else extraRequests++;
              const organic: { link?: string; position?: number }[] =
                Array.isArray(j.organic) ? j.organic.slice(0, num) : [];
              let pos: number | null = null;
              organic.forEach((o, idx) => {
                const h = hostOf(o.link ?? "");
                if (!h || pos !== null) return;
                if (shared ? h === finalHost : rootDomain(h) === siteRoot)
                  pos = typeof o.position === "number" ? o.position : idx + 1;
              });
              res[kw] = pos;
            } catch {
              failed = true;
            }
          });
          if (!failed) countryPositions[c] = res; // a country that failed is left out instead of counted as zero
        }
        // free sanity signals for the volumes: Google autocomplete + ads on the result page
        const evidence: Record<string, KeywordEvidence> = {};
        for (const r of checkedKw)
          evidence[r.keyword] = {
            ac: null,
            acRank: null,
            commercial: !!r.commercial,
            ads: r.features?.ads ?? 0,
          };
        const evKeys = [...checkedKw.map((r) => r.keyword), brand];
        if (elapsed() < 100_000) {
          const savedEv = useCache
            ? await bankEvidence(evKeys, gl)
            : new Map<string, { ac: number | null; acRank: number | null }>();
          const freshEv: {
            keyword: string;
            ac: number | null;
            acRank: number | null;
          }[] = [];
          await pool(evKeys, 5, async (kw) => {
            const hit = savedEv.get(normKw(kw));
            const { ac, acRank } = hit ?? (await autocompleteInfo(kw, gl, hl));
            if (!hit) freshEv.push({ keyword: kw, ac, acRank });
            const prev = evidence[kw];
            evidence[kw] = {
              ac,
              acRank,
              commercial: prev?.commercial ?? false,
              ads: prev?.ads ?? 0,
            };
          });
          await saveEvidence(freshEv, gl);
        }
        // brand search: where does the site rank for its own name?
        let brandRank: { keyword: string; position: number | null } | null =
          null;
        if (serperKey && elapsed() < 100_000 && brand.length >= 3) {
          try {
            const j = await serperSearch(brand, gl, hl, num, useCache);
            if (j._cached) extraCached++;
            else extraRequests++;
            const organic: { link?: string; position?: number }[] =
              Array.isArray(j.organic) ? j.organic.slice(0, num) : [];
            let pos: number | null = null;
            organic.forEach((o, idx) => {
              const h = hostOf(o.link ?? "");
              if (!h || pos !== null) return;
              if (shared ? h === finalHost : rootDomain(h) === siteRoot)
                pos = typeof o.position === "number" ? o.position : idx + 1;
            });
            brandRank = { keyword: brand, position: pos };
          } catch {
            /* brand check is optional */
          }
        }
        // every other keyword the data bank has seen this site rank for (saved Google results of earlier searches by anyone)
        const bank = await bankDomainKeywords(
          shared ? finalHost : siteRoot,
          gl,
        );
        seo = seoEstimate({
          gl,
          scope,
          rankings: ranks.rankings,
          volumes,
          volumeSource: source,
          evidence,
          brand: brandRank,
          urls: Math.max(urlsDiscovered, pages.length),
          countryPositions,
          trancoRank,
          depth: num,
          truth,
          bank,
          calibration,
        });
      }
      // keyword table: volume range, difficulty, intent, opportunity (the Ahrefs / Semrush "organic keywords" view, from free data)
      if (seo && ranks) {
        const strengths = (await strengthP) ?? {};
        const strengthMap: Record<string, number | undefined> = {};
        for (const [d, v] of Object.entries(strengths))
          strengthMap[d] = v.strength;
        const ownKey = shared ? finalHost : siteRoot;
        const rowBy = new Map(seo.keywords.map((r) => [r.keyword, r]));
        let knownSum = 0,
          knownN = 0;
        keywordTable = ranks.rankings
          .filter((r) => !r.error)
          .map((r) => {
            const row = rowBy.get(r.keyword);
            const volume = row?.volume ?? 0;
            const kd = r.serp
              ? keywordDifficulty(r.serp, strengthMap, r.features)
              : { kd: null, label: "Unknown", known: 0 };
            if (r.serp) {
              knownSum += kd.known;
              knownN++;
            }
            const opp = opportunity({
              volume,
              kd: kd.kd,
              position: r.position,
              features: r.features,
            });
            return {
              keyword: r.keyword,
              position: r.position,
              url: r.url,
              volume,
              volumeLow: row?.volumeLow ?? volume,
              volumeHigh: row?.volumeHigh ?? volume,
              volumeAll: row?.volumeAll ?? volume,
              visits: row?.visits ?? 0,
              kd: kd.kd,
              kdLabel: kd.label,
              intent: classifyIntent(r.keyword, brand, !!r.commercial),
              commercial: !!r.commercial,
              features: r.features ?? null,
              opportunity: opp.score,
              action: opp.action,
              gain: opp.gain,
              potential: opp.potential,
            };
          })
          .sort(
            (a, b) => (b.opportunity as number) - (a.opportunity as number),
          );
        kdCoverage = knownN ? Math.round((knownSum / knownN) * 100) : null;
        // earlier positions of every keyword from the rank history table: a real trend line per keyword
        const trends = await rankTrends(
          user.id,
          host,
          gl,
          keywordTable.map((k) => String(k.keyword)),
        );
        keywordTable = keywordTable.map((k) => {
          const t = trends.get(normKw(String(k.keyword)));
          return {
            ...k,
            trend: t
              ? { prev: t.prev, series: t.series, firstSeen: t.firstSeen }
              : null,
          };
        });
        topics = groupTopics(
          keywordTable.map((k) => ({
            keyword: String(k.keyword),
            volume: Number(k.volume),
            visits: Number(k.visits),
            position: k.position as number | null,
            kd: k.kd as number | null,
          })),
        );
        sov = shareOfVoice(
          ranks.rankings
            .filter((r) => !r.error && r.serp)
            .map((r) => ({
              volume: rowBy.get(r.keyword)?.volume ?? 0,
              ff: featureFactor(r.features),
              ownPosition: r.position,
              domains: r.serp!.domains,
            })),
          ownKey,
          isPlatform,
        );
      }
      traffic = await trafficFor(user.id, finalHost, trancoRank, shared, seo);
    } catch (e) {
      notes.push(`Traffic: ${(e as Error).message}`);
    }

    // free keyword ideas from Google autocomplete, with estimated volume and intent
    if (profile && serperKey && ranks && !ranks.fatal && elapsed() < 85_000) {
      try {
        const own = new Set([
          ...profile.seeds,
          ...ranks.rankings.map((r) => r.keyword.toLowerCase()),
        ]);
        const raw = (
          await expandIdeas(profile.seeds, gl, hl, own, 12_000)
        ).slice(0, 30);
        if (raw.length && elapsed() < 100_000) {
          const { volumes: iv, truth: ivTruth } = await keywordVolumes(
            raw.map((x) => x.keyword),
            [gl],
          );
          ideaTable = raw
            .map((x) => {
              const ev: KeywordEvidence = {
                ac: null,
                acRank: x.hits >= 3 ? 0 : x.hits === 2 ? 2 : null,
                commercial: false,
              };
              const volume = ivTruth.has(`${x.keyword}|${gl}`)
                ? (iv[x.keyword]?.[gl] ?? 0)
                : adjustVolume(iv[x.keyword]?.[gl] ?? 0, ev);
              const rg = volumeRange(volume, ev);
              return {
                keyword: x.keyword,
                volume,
                volumeLow: rg.low,
                volumeHigh: rg.high,
                intent: classifyIntent(x.keyword, brand),
                popularity: x.hits,
              };
            })
            .sort((a, b) => b.volume - a.volume || b.popularity - a.popularity);
        }
      } catch {
        /* ideas are optional */
      }
    }

    // compare with the previous saved run of the same site and country: what grew, what fell
    let changes: ReturnType<typeof compareRuns> = null;
    try {
      const { data: prevRows } = await admin()
        .from("research_runs")
        .select(
          "created_at, health, rankings:result->rankings, visits:result->traffic->seo->organic->mid",
        )
        .eq("user_id", user.id)
        .eq("host", host)
        .eq("country", gl)
        .order("created_at", { ascending: false })
        .limit(1);
      const pr = prevRows?.[0] as
        | {
            created_at: string;
            health: number | null;
            rankings: unknown;
            visits: number | null;
          }
        | undefined;
      if (pr?.rankings) {
        const seoMid =
          (traffic as { seo?: { organic?: { mid?: number } } } | null)?.seo
            ?.organic?.mid ?? null;
        changes = compareRuns(
          {
            created_at: pr.created_at,
            result: {
              rankings: pr.rankings,
              meta: { health: pr.health },
              traffic: { seo: { organic: { mid: pr.visits } } },
            },
          },
          { rankings: ranks?.rankings ?? [], visitsMid: seoMid, health },
        );
      }
    } catch {
      /* first run, or history not available */
    }

    // action plan
    const plan =
      profile && aiOk
        ? await makePlan({
            site: finalHost,
            topic: profile.topic,
            pagesChecked: pages.length,
            healthScore: health,
            issueCounts: severity,
            speedMobile: speed?.scores ?? null,
            speedFixes: speed?.opportunities.map((o) => o.title) ?? [],
            issues: issues.map((i) => ({
              issue: i.label,
              pages: i.count,
              severity: i.severity,
              examples: i.examples.slice(0, 2),
            })),
            rankingsChecked: ranks
              ? {
                  country: gl,
                  depth: `top ${num}`,
                  keywords: ranks.rankings
                    .filter((r) => !r.error)
                    .map((r) => ({ keyword: r.keyword, position: r.position })),
                }
              : null,
            contentGaps:
              ranks?.gaps.map((g) => ({
                keyword: g.keyword,
                whoRanks: g.top.map((t) => `${t.domain}: ${t.title}`),
              })) ?? [],
            competitors: ranks?.competitors.slice(0, 5) ?? [],
            opportunities: keywordTable.slice(0, 8).map((k) => ({
              keyword: k.keyword,
              position: k.position,
              estimatedKeywordDifficulty: k.kd,
              action: k.action,
            })),
            shareOfVoice: sov.slice(0, 5).map((x) => ({
              domain: x.domain,
              sharePercent: x.share,
              own: x.own,
            })),
            changesSinceLastRun: changes
              ? {
                  up: changes.up,
                  down: changes.down,
                  gained: changes.gained,
                  lost: changes.lost,
                }
              : null,
          })
        : [];

    const keywordsChecked = ranks
      ? ranks.rankings.filter((r) => !r.error).length
      : 0;
    const rankedCount = ranks
      ? ranks.rankings.filter((r) => r.position !== null).length
      : 0;
    // SEO checklist (Technical / Content / Authority): every item is checked from the crawl or a real API, never guessed.
    // It runs last so it can reuse the crawl, the speed test and the competitors found above. A failure here never breaks the report.
    let checklist: CheckItem[] = [];
    if (elapsed() < 105_000) {
      try {
        const serperPost = async (path: string, extra: Record<string, unknown>) => {
          const r = await fetch(`https://google.serper.dev/${path}`, {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              "X-API-KEY": Deno.env.get("SERPER_API_KEY") ?? "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ gl, hl, ...extra }),
          });
          if (!r.ok) throw new Error(`Serper error ${r.status}`);
          return await r.json();
        };
        const cl = await Promise.race([
          buildChecklist({
            pages: pages.map((p) => ({ ...p, flags: p.flags ?? emptyFlags() })),
            homeHtml,
            finalUrl,
            origin: finalOrigin,
            host: finalHost,
            siteRoot,
            shared,
            speed,
            seeds: profile?.seeds ?? [],
            competitors: (ranks?.competitors ?? [])
              .map((x: { domain: string }) => x.domain)
              .slice(0, 5),
            brand,
            serperSearch: serperKey
              ? (q: string) => serperSearch(q, gl, hl, 10, useCache)
              : null,
            serperPlaces: serperKey
              ? (q: string) => serperPost("places", { q })
              : null,
            serperRecent: serperKey
              ? (q: string) => serperPost("search", { q, num: 10, tbs: "qdr:w" })
              : null,
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("checklist timed out")), 30_000),
          ),
        ]);
        checklist = cl.items;
        extraRequests += cl.extraRequests;
      } catch (e) {
        notes.push(`SEO checklist could not be built: ${(e as Error).message}`);
      }
    }

    const result = {
      meta: {
        v: 3,
        kwLimit,
        url: finalUrl,
        host: finalHost,
        country: gl,
        scope,
        countries: scopeCountries(scope, gl),
        language: hl,
        depth: num,
        checkedAt: new Date().toISOString(),
        pagesCrawled: pages.length,
        urlsDiscovered,
        crawl: crawlInfo,
        keywordsChecked,
        rankedCount,
        serperRequests: (ranks?.requests ?? 0) + extraRequests,
        serperCached: (ranks?.cached ?? 0) + extraCached,
        serperUsed: !!ranks,
        health,
        kdCoverage,
      },
      site: {
        status: homeRes.status,
        responseMs: homeMs,
        shared,
        tech: detectTech(homeHtml, homeRes.headers),
        tranco: trancoRank,
        age,
        domain,
        opr,
        root: siteRoot,
        speed,
        speedDesktop,
        field,
      },
      profile,
      traffic,
      pages: pageOut,
      issues,
      severity,
      links,
      brokenLinks,
      images,
      terms,
      rankings: ranks?.rankings ?? [],
      competitors: ranks?.competitors ?? [],
      platforms: ranks?.platforms ?? [],
      gaps: ranks?.gaps ?? [],
      ideas: ranks?.ideas ?? [],
      keywordTable,
      topics,
      shareOfVoice: sov,
      ideaTable,
      changes,
      plan,
      checklist,
      notes,
    };

    const { data: saved, error } = await admin()
      .from("research_runs")
      .insert({
        user_id: user.id,
        url: finalUrl,
        host,
        country: gl,
        depth: num,
        result,
        health,
        ranked: rankedCount,
        keywords_checked: keywordsChecked,
        response_ms: homeMs,
        http_status: homeRes.status,
      })
      .select("id, created_at")
      .single();
    if (error)
      result.notes.push(
        "Result was not saved. Run the 002_research.sql migration to enable saved reports and history.",
      );

    // save everything this run learned in the data bank: rank history, keyword numbers, daily snapshot (all best effort)
    try {
      const rows = keywordTable.length
        ? keywordTable.map((k) => ({
            keyword: String(k.keyword),
            position: (k.position as number | null) ?? null,
            url: (k.url as string | null) ?? null,
            volume: Number(k.volume) || 0,
            kd: (k.kd as number | null) ?? null,
          }))
        : (ranks?.rankings ?? [])
            .filter((r) => !r.error)
            .map((r) => ({
              keyword: r.keyword,
              position: r.position,
              url: r.url,
              volume: null,
              kd: null,
            }));
      const ranked = rows.filter((r) => r.position != null) as {
        position: number;
      }[];
      const tSeo = (
        traffic as {
          seo?: { organic?: { low?: number; mid?: number; high?: number } };
        } | null
      )?.seo?.organic;
      const ownSov = sov.find((x) => x.own);
      await Promise.allSettled([
        recordRanks(user.id, host, gl, rows),
        saveKeywordDetails(
          keywordTable
            .filter((k) => !String(k.keyword).endsWith("(brand)"))
            .map((k) => ({
              keyword: String(k.keyword),
              volume: Number(k.volume) || 0,
              volumeLow: Number(k.volumeLow) || 0,
              volumeHigh: Number(k.volumeHigh) || 0,
              kd: (k.kd as number | null) ?? null,
              intent: String(k.intent ?? ""),
              commercial: !!k.commercial,
              features: k.features ?? null,
            })),
          gl,
        ),
        noteLookups(
          user.id,
          rows.map((r) => r.keyword).filter((k) => !k.endsWith("(brand)")),
          gl,
          host,
        ),
        saveSnapshot(user.id, host, gl, {
          health,
          keywords_checked: keywordsChecked,
          keywords_ranking: rankedCount,
          top3: ranked.filter((r) => r.position <= 3).length,
          top10: ranked.filter((r) => r.position <= 10).length,
          avg_position: ranked.length
            ? Math.round(
                (ranked.reduce((a, r) => a + r.position, 0) / ranked.length) *
                  10,
              ) / 10
            : null,
          visits_low: tSeo?.low ?? null,
          visits_mid: tSeo?.mid ?? null,
          visits_high: tSeo?.high ?? null,
          share_of_voice: ownSov?.share ?? null,
        }),
      ]);
    } catch {
      /* the data bank is optional: run 006_data_bank.sql to turn it on */
    }
    return json({
      ...result,
      id: saved?.id ?? null,
      cached: false,
      createdAt: saved?.created_at ?? result.meta.checkedAt,
    });
  }),
);