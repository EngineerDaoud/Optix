import { clean, get } from "./siteinfo.ts";
import {
  dataForSeo,
  dataForSeoEnabled,
  fromGitHub,
  fromHackerNews,
  fromReddit,
  fromStackExchange,
  fromWikipedia,
} from "./linksources.ts";

// SEO checklist (Technical / Content / Authority). Each item is checked from real crawl data where that is possible.
// Items that need paid data (backlinks) or a login (Google Business Profile) are marked "manual" instead of guessed.

export type CheckStatus = "pass" | "warn" | "fail" | "manual";
export type CheckItem = {
  id: string;
  group: string;
  cadence: string;
  name: string;
  priority: "High" | "Med";
  benefit: string;
  status: CheckStatus;
  detail: string;
  fix: string;
};
export type Flags = {
  cta: boolean;
  reviews: boolean;
  faq: boolean;
  trust: string[];
  payment: string[];
  maps: boolean;
};

export type CPage = {
  url: string;
  status: number;
  ms: number;
  title: string;
  h1s: string[];
  words: number;
  canonical: string;
  viewport: boolean;
  mixed: number;
  schema: string[];
  linkStats: { internal: number };
  internalUrls: string[];
  images: { total: number; noAlt: number };
  flags: Flags;
};

export const emptyFlags = (): Flags => ({
  cta: false,
  reviews: false,
  faq: false,
  trust: [],
  payment: [],
  maps: false,
});

// ---------- per page detection (called while crawling) ----------

const CTA_RE =
  /\b(book now|book online|book today|book a |enquire|inquire|get a quote|request a quote|get quote|contact us|call now|whatsapp|buy now|add to cart|reserve|sign up|get started|apply now|shop now|order now|check availability|get in touch)\b/i;

export function pageFlags(html: string): Flags {
  let clickable = "";
  let n = 0;
  for (const m of html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    clickable += " " + clean(m[2]).slice(0, 80);
    if (++n > 400) break;
  }
  const low = html.toLowerCase();
  const trust: string[] = [];
  for (const [label, re] of [
    ["IATA", /\biata\b/],
    ["ATOL", /\batol\b/],
    ["ABTA", /\babta\b/],
    ["Accredited", /\baccredited|accreditation\b/],
    ["Licensed", /\blicen[sc]ed\b/],
    ["Money-back guarantee", /money[- ]back|refund guarantee/],
    ["Trustpilot", /trustpilot/],
  ] as [string, RegExp][])
    if (re.test(low)) trust.push(label);
  const payment: string[] = [];
  for (const [label, re] of [
    ["Secure payment", /secure (payment|checkout)|ssl secure|256-bit|pci/],
    ["Visa", /\bvisa\b/],
    ["Mastercard", /master ?card/],
    ["PayPal", /paypal/],
    ["Stripe", /stripe/],
    ["Apple/Google Pay", /apple pay|google pay/],
  ] as [string, RegExp][])
    if (re.test(low)) payment.push(label);
  return {
    cta: CTA_RE.test(clickable),
    reviews:
      /aggregaterating|"@type"\s*:\s*"review"|testimonial|customer reviews?|google reviews|trustpilot|reviews\.io|feefo|star-rating|\b[1-5](\.\d)?\s*\/\s*5\b/i.test(
        html,
      ),
    faq: /\bfaqs?\b|frequently asked/i.test(html),
    trust,
    payment,
    maps: /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page\/|goo\.gl\/maps/i.test(
      html,
    ),
  };
}

// ---------- helpers ----------

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
const list = (a: string[], n = 3) =>
  a.slice(0, n).join(", ") + (a.length > n ? ` and ${a.length - n} more` : "");
const short = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || "/";
  } catch {
    return u;
  }
};

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function robotsInfo(origin: string) {
  const r = await safe(get(`${origin}/robots.txt`, 6000), null);
  if (!r || !r.ok)
    return {
      found: false,
      blocksAll: false,
      sitemaps: [] as string[],
      status: r?.status ?? 0,
    };
  const txt = await r.text();
  if (/<html/i.test(txt.slice(0, 300)))
    return {
      found: false,
      blocksAll: false,
      sitemaps: [] as string[],
      status: 200,
    };
  let inStar = false,
    blocksAll = false;
  const sitemaps: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(),
      v = m[2].trim();
    if (k === "user-agent") inStar = v === "*";
    else if (k === "disallow" && inStar && v === "/") blocksAll = true;
    else if (k === "sitemap" && v) sitemaps.push(v);
  }
  return { found: true, blocksAll, sitemaps, status: 200 };
}

async function sitemapInfo(origin: string, fromRobots: string[]) {
  const url = fromRobots[0] ?? `${origin}/sitemap.xml`;
  const r = await safe(get(url, 8000), null);
  if (!r || !r.ok) return { ok: false, url, count: 0, status: r?.status ?? 0 };
  const xml = await r.text();
  const isIndex = /<sitemapindex/i.test(xml);
  const count = (xml.match(/<loc>/gi) ?? []).length;
  return { ok: count > 0, url, count, status: r.status, isIndex };
}

async function imageWeights(html: string, base: string) {
  const urls: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if (!src || src.startsWith("data:")) continue;
    try {
      const u = new URL(src, base).toString();
      if (!urls.includes(u)) urls.push(u);
    } catch {
      /* skip */
    }
    if (urls.length >= 12) break;
  }
  const rows = await Promise.all(
    urls.map(async (u) => {
      const r = await safe(get(u, 6000, { method: "HEAD" }), null);
      const len = Number(r?.headers.get("content-length") ?? 0);
      return { url: u, bytes: len > 0 ? len : null };
    }),
  );
  const modern = urls.filter((u) => /\.(webp|avif)(\?|$)/i.test(u)).length;
  return {
    total: urls.length,
    measured: rows.filter((r) => r.bytes != null).length,
    big: rows.filter((r) => (r.bytes ?? 0) > 200_000),
    huge: rows.filter((r) => (r.bytes ?? 0) > 500_000),
    modern,
  };
}

function slugProblems(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const out: string[] = [];
  const segs = u.pathname.split("/").filter(Boolean);
  if (!segs.length) return out;
  const last = segs[segs.length - 1];
  if (u.pathname.length > 75) out.push("long");
  if (last.split("-").length > 6) out.push("many words");
  if (/[A-Z]/.test(u.pathname)) out.push("capital letters");
  if (/[_%\s]/.test(u.pathname)) out.push("underscores or odd characters");
  if (u.search) out.push("query string");
  if (/\d{5,}/.test(last)) out.push("long number id");
  return out;
}


// ---------- backlink helpers (free public sources, or DataForSEO when its keys are set) ----------
const hostKey = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Websites that link to (or carry) a domain. Real index with DataForSEO, otherwise a sample from public sources. */
async function linkingHosts(
  root: string,
): Promise<{ hosts: Set<string>; real: boolean }> {
  const hosts = new Set<string>();
  if (dataForSeoEnabled()) {
    try {
      const r = await dataForSeo(root);
      for (const x of r.rows)
        if (x.domain && x.domain !== root) hosts.add(x.domain);
      return { hosts, real: true };
    } catch {
      /* fall back to the free sources */
    }
  }
  const lists = await Promise.all([
    safe(fromWikipedia(root, ["en"]), []),
    safe(fromHackerNews(root), []),
    safe(fromReddit(root), []),
    safe(fromStackExchange(root), []),
    safe(fromGitHub(root), []),
  ]);
  for (const l of lists)
    for (const cand of l) {
      const h = hostKey(cand.url);
      if (h && h !== root && !h.endsWith("." + root)) hosts.add(h);
    }
  return { hosts, real: false };
}

// ---------- the checklist ----------

export type ChecklistCtx = {
  pages: CPage[];
  homeHtml: string;
  finalUrl: string;
  origin: string;
  host: string;
  siteRoot: string;
  shared: boolean;
  speed: {
    scores: { performance: number | null };
    vitals: { lcp: number | null };
    opportunities: { id: string; title: string }[];
  } | null;
  seeds: string[];
  competitors: string[];
  serperSearch: ((q: string) => Promise<any>) | null;
  /** Google Maps search (Serper /places): checks the Google Business Profile for real. */
  serperPlaces?: ((q: string) => Promise<any>) | null;
  /** Google search limited to the past 7 days (Serper tbs=qdr:w): weekly competitor tracking. */
  serperRecent?: ((q: string) => Promise<any>) | null;
  brand?: string;
};

export async function buildChecklist(
  c: ChecklistCtx,
): Promise<{ items: CheckItem[]; extraRequests: number }> {
  const items: CheckItem[] = [];
  const TECH = "Technical Performance & Core Health Audit",
    CONTENT = "Content & On-Page Architecture",
    AUTH = "Authority & Trust Acquisition";
  const add = (
    group: string,
    cadence: string,
    id: string,
    name: string,
    priority: "High" | "Med",
    benefit: string,
    status: CheckStatus,
    detail: string,
    fix = "",
  ) =>
    items.push({
      id,
      group,
      cadence,
      name,
      priority,
      benefit,
      status,
      detail,
      fix: status === "pass" ? "" : fix,
    });

  const ok = c.pages.filter((p) => p.status === 200);
  const home = c.pages[0];
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  let extraRequests = 0;

  const [robots, httpTry] = await Promise.all([
    robotsInfo(c.origin),
    c.finalUrl.startsWith("https:")
      ? safe(get(`http://${c.host}/`, 6000), null)
      : Promise.resolve(null),
  ]);
  const sitemap = await sitemapInfo(c.origin, robots.sitemaps);

  // ===== 1. Technical =====
  {
    const https = c.finalUrl.startsWith("https:");
    const redirects = !!httpTry && httpTry.url.startsWith("https:");
    const mixed = c.pages.reduce((s, p) => s + p.mixed, 0);
    const st: CheckStatus = !https
      ? "fail"
      : !redirects || mixed > 0
        ? "warn"
        : "pass";
    const parts = [
      https
        ? "Site loads over https with a valid certificate."
        : "Site is NOT served over https.",
    ];
    if (https)
      parts.push(
        redirects
          ? "http redirects to https."
          : "http does not redirect to https.",
      );
    if (mixed)
      parts.push(`${mixed} insecure http resources found on https pages.`);
    add(
      TECH,
      "One Time",
      "1.1",
      "SSL/HTTPS Health",
      "High",
      "Security: Protects user data and booking payments.",
      st,
      parts.join(" "),
      "Install an SSL certificate, redirect every http URL to https (301) and change http image/script links to https.",
    );
  }
  {
    const st: CheckStatus = robots.blocksAll
      ? "fail"
      : !robots.found
        ? "warn"
        : "pass";
    const d = robots.blocksAll
      ? "robots.txt blocks the whole site (Disallow: /) for all bots."
      : !robots.found
        ? "No robots.txt file found."
        : `robots.txt found${robots.sitemaps.length ? " and lists a sitemap" : " but does not list a sitemap"}.`;
    add(
      TECH,
      "One Time",
      "1.2",
      "Robots.txt Setup",
      "High",
      "Crawl Efficiency: Directs Google away from junk pages.",
      !robots.blocksAll && robots.found && !robots.sitemaps.length
        ? "warn"
        : st,
      d,
      robots.blocksAll
        ? "Remove Disallow: / for User-agent: * so Google can crawl the site."
        : "Add a robots.txt that blocks admin, cart and search pages and has a Sitemap: line.",
    );
  }
  {
    const inRobots = robots.sitemaps.length > 0;
    const st: CheckStatus = !sitemap.ok ? "fail" : inRobots ? "pass" : "warn";
    add(
      TECH,
      "One Time",
      "1.3",
      "XML Sitemap",
      "High",
      "Indexation: Helps Google find your new Umrah packages fast.",
      st,
      sitemap.ok
        ? `Sitemap found at ${short(sitemap.url)} with ${sitemap.count} ${sitemap.isIndex ? "sub-sitemaps" : "URLs"}.${inRobots ? "" : " It is not listed in robots.txt."}`
        : `No working sitemap at ${short(sitemap.url)} (status ${sitemap.status || "no answer"}).`,
      "Create sitemap.xml with all indexable pages, add it to robots.txt and submit it in Google Search Console.",
    );
  }
  {
    const lcp = c.speed?.vitals.lcp ?? null;
    const st: CheckStatus =
      lcp == null
        ? "manual"
        : lcp <= 2500
          ? "pass"
          : lcp <= 4000
            ? "warn"
            : "fail";
    add(
      TECH,
      "One Time",
      "1.4",
      "Mobile Speed (LCP)",
      "High",
      "Retention: Faster loading leads to higher booking rates.",
      st,
      lcp == null
        ? "The mobile speed test did not finish, run PageSpeed Insights manually."
        : `Mobile LCP is ${(lcp / 1000).toFixed(1)} s (good is 2.5 s or less). Mobile performance score ${c.speed!.scores.performance}/100.`,
      "Compress the hero image, use modern formats (WebP), lazy-load below-the-fold images, remove unused JavaScript and add caching or a CDN.",
    );
  }
  {
    const bad = c.pages.filter((p) => p.status !== 200);
    add(
      TECH,
      "One Time",
      "1.5",
      "Broken Links (404)",
      "High",
      "UX: Ensures customers don't hit dead ends.",
      bad.length ? "fail" : "pass",
      bad.length
        ? `${bad.length} of ${c.pages.length} crawled pages did not load: ${list(bad.map((p) => `${short(p.url)} (${p.status || "no answer"})`))}.`
        : `All ${c.pages.length} crawled pages load correctly (external links are not checked).`,
      "Fix or 301-redirect the broken URLs and update links that point to them.",
    );
  }
  {
    const miss = ok.filter((p) => !p.canonical);
    const st: CheckStatus = !miss.length
      ? "pass"
      : pct(miss.length, ok.length) > 50
        ? "fail"
        : "warn";
    add(
      TECH,
      "One Time",
      "1.6",
      "Canonical Tags",
      "High",
      "Accuracy: Prevents duplicate package issues.",
      st,
      miss.length
        ? `${miss.length} of ${ok.length} pages have no canonical tag, e.g. ${list(miss.map((p) => short(p.url)))}.`
        : `All ${ok.length} pages have a canonical tag.`,
      'Add <link rel="canonical" href="preferred URL"> to every page (self-referencing is fine).',
    );
  }
  {
    const miss = ok.filter((p) => !p.viewport);
    const perf = c.speed?.scores.performance;
    add(
      TECH,
      "One Time",
      "1.7",
      "Mobile-First Design",
      "High",
      "Visibility: Google ranks the mobile version of your site first.",
      miss.length ? "fail" : perf != null && perf < 50 ? "warn" : "pass",
      miss.length
        ? `${miss.length} pages have no mobile viewport tag.`
        : `All pages have a viewport tag.${perf != null ? ` Mobile performance score ${perf}/100.` : ""}`,
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and make sure text, buttons and menus work on a phone.',
    );
  }
  {
    const withSchema = ok.filter((p) => p.schema.length);
    const all = new Set(ok.flatMap((p) => p.schema));
    const org = [
      "Organization",
      "LocalBusiness",
      "TravelAgency",
      "Store",
      "Corporation",
    ].some((t) => all.has(t));
    const offer = [
      "Product",
      "Offer",
      "TouristTrip",
      "Service",
      "Event",
      "Article",
      "BlogPosting",
    ].some((t) => all.has(t));
    const st: CheckStatus = !withSchema.length
      ? "fail"
      : org && offer
        ? "pass"
        : "warn";
    add(
      TECH,
      "One Time",
      "1.8",
      "Schema Markups",
      "High",
      "E-com: Shows price & availability in Google Search.",
      st,
      withSchema.length
        ? `${withSchema.length} of ${ok.length} pages have schema. Types found: ${[...all].slice(0, 8).join(", ")}.${org ? "" : " No Organization/LocalBusiness schema."}${offer ? "" : " No Product/Offer/Service schema."}`
        : "No schema (JSON-LD) found on any crawled page.",
      "Add JSON-LD: Organization or LocalBusiness on the home page, Product with Offer (price, availability) on package or product pages, BreadcrumbList and FAQPage where they apply.",
    );
  }
  {
    const re =
      /(checkout|cart|basket|booking|book-|\/book|payment|enquir|inquir|reserve)/i;
    let target = ok.find((p) => re.test(p.url));
    let ms: number | null = target?.ms ?? null;
    let url = target?.url ?? "";
    if (!target) {
      const link = home?.internalUrls.find((u) => re.test(u));
      if (link) {
        const t0 = Date.now();
        const r = await safe(get(link, 8000), null);
        if (r) {
          ms = Date.now() - t0;
          url = link;
        }
      }
    }
    const st: CheckStatus =
      ms == null ? "manual" : ms <= 800 ? "pass" : ms <= 1800 ? "warn" : "fail";
    add(
      TECH,
      "One Time",
      "1.9",
      "Checkout Speed Audit",
      "High",
      "Sales: Ensures the booking process is fast and lag-free.",
      st,
      ms == null
        ? "No booking, cart or checkout page was found in the crawl. Test the checkout by hand with PageSpeed Insights."
        : `${short(url)} responded in ${ms} ms (server response only, not the full payment flow).`,
      "Speed up the booking page: cache what you can, remove heavy scripts and test the real payment step in PageSpeed Insights.",
    );
  }
  {
    const w = await imageWeights(c.homeHtml, c.finalUrl);
    const opp = (c.speed?.opportunities ?? []).filter((o) =>
      [
        "uses-optimized-images",
        "modern-image-formats",
        "uses-responsive-images",
        "offscreen-images",
      ].includes(o.id),
    );
    let st: CheckStatus = "pass";
    if (w.huge.length || w.big.length >= 3) st = "fail";
    else if (w.big.length || opp.length) st = "warn";
    const d = !w.total
      ? "No images found on the home page."
      : `${w.total} home page images checked${w.measured ? `, ${w.big.length} over 200 KB${w.huge.length ? ` (${w.huge.length} over 500 KB)` : ""}` : " (sizes were not readable)"}; ${w.modern} use WebP/AVIF.${
          opp.length
            ? ` PageSpeed also flags: ${list(
                opp.map((o) => o.title),
                2,
              )}.`
            : ""
        }`;
    add(
      TECH,
      "One Time",
      "1.11",
      "Image Compression",
      "Med",
      "Speed: Makes pages load faster by reducing image size.",
      st,
      d,
      "Convert images to WebP, resize them to the size shown on screen and keep each image under about 150 KB.",
    );
  }

  // ===== 2. Content =====
  {
    const seeds = c.seeds
      .map((s) =>
        s
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2),
      )
      .filter((t) => t.length);
    const has = (text: string) =>
      seeds.filter((t) => t.every((w) => text.toLowerCase().includes(w)));
    if (!seeds.length || !home) {
      add(
        CONTENT,
        "Quarterly",
        "2.1",
        "Primary Keyword Placement",
        "High",
        "Relevance: Clearly tells Google what the page is about.",
        "manual",
        "No keywords were found for this site, so placement could not be checked.",
      );
    } else {
      const inTitle = has(home.title),
        inH1 = has(home.h1s.join(" "));
      const cover = ok.filter((p) => has(p.title).length).length;
      const st: CheckStatus =
        inTitle.length && inH1.length
          ? "pass"
          : inTitle.length || inH1.length
            ? "warn"
            : "fail";
      add(
        CONTENT,
        "Quarterly",
        "2.1",
        "Primary Keyword Placement",
        "High",
        "Relevance: Clearly tells Google what the page is about.",
        st,
        `Home page title ${inTitle.length ? `contains "${inTitle[0].join(" ")}"` : "has none of the detected target keywords"}; H1 ${inH1.length ? `contains "${inH1[0].join(" ")}"` : "has none of them"}. ${cover} of ${ok.length} pages have a target keyword in the title.`,
        "Put the main keyword of each page in the title (near the start), the H1 and the first paragraph, written naturally.",
      );
    }
  }
  {
    const none = ok.filter((p) => p.h1s.length === 0),
      multi = ok.filter((p) => p.h1s.length > 1);
    add(
      CONTENT,
      "Quarterly",
      "2.2",
      "One H1 Per Page",
      "High",
      'Structure: Fixes the "multiple H1 tags" error.',
      multi.length ? "fail" : none.length ? "warn" : "pass",
      multi.length || none.length
        ? `${multi.length} pages have more than one H1${
            multi.length
              ? ` (e.g. ${list(
                  multi.map((p) => short(p.url)),
                  2,
                )})`
              : ""
          }; ${none.length} pages have no H1.`
        : `All ${ok.length} pages have exactly one H1.`,
      "Keep one H1 per page that states the topic and change the extra ones to H2 or H3 (often a theme or logo problem).",
    );
  }
  {
    const total = ok.reduce((s, p) => s + p.images.total, 0),
      miss = ok.reduce((s, p) => s + p.images.noAlt, 0);
    const st: CheckStatus = !miss
      ? "pass"
      : pct(miss, total) > 20
        ? "fail"
        : "warn";
    add(
      CONTENT,
      "Quarterly",
      "2.3",
      "Image Alt Text",
      "Med",
      "Search: Helps packages show up in Google Images.",
      st,
      total
        ? `${miss} of ${total} images have no alt attribute (${pct(miss, total)}%).`
        : "No images found on the crawled pages.",
      "Add short, descriptive alt text to every meaningful image, for example the package or place shown.",
    );
  }
  {
    const homeLinks = home?.linkStats.internal ?? 0;
    const set = new Set((home?.internalUrls ?? []).map(norm));
    const others = ok.slice(1);
    const notFromHome = others.filter((p) => !set.has(norm(p.url)));
    const weak = others.filter((p) => p.linkStats.internal < 3);
    const st: CheckStatus =
      homeLinks < 5
        ? "fail"
        : weak.length ||
            (others.length && notFromHome.length > others.length / 2)
          ? "warn"
          : "pass";
    add(
      CONTENT,
      "Quarterly",
      "2.4",
      "Internal Link Flow",
      "High",
      "Authority: Passes power from Home to Package pages.",
      st,
      `Home page has ${homeLinks} internal links. ${notFromHome.length} of ${others.length} other crawled pages are not linked from the home page; ${weak.length} pages have fewer than 3 internal links.`,
      "Link from the home page and menus to your key package/service pages, and link related pages to each other with clear anchor text.",
    );
  }
  {
    const withCta = ok.filter((p) => p.flags.cta);
    const st: CheckStatus = home?.flags.cta
      ? pct(withCta.length, ok.length) >= 50
        ? "pass"
        : "warn"
      : "fail";
    add(
      CONTENT,
      "Quarterly",
      "2.5",
      "Call-to-Action (CTA)",
      "High",
      'Sales: Makes "Book Now" or "Inquire" buttons clear.',
      st,
      `${home?.flags.cta ? "Home page has a clear CTA button/link." : "No CTA (Book now, Enquire, Contact, Get a quote...) found on the home page."} ${withCta.length} of ${ok.length} pages have one.`,
      'Add one clear button per page such as "Book Now" or "Enquire", visible without scrolling and repeated lower down.',
    );
  }
  {
    const all = new Set(ok.flatMap((p) => p.schema));
    const schemaOk = all.has("Review") || all.has("AggregateRating");
    const shown = ok.filter((p) => p.flags.reviews).length;
    const st: CheckStatus = schemaOk ? "pass" : shown ? "warn" : "fail";
    add(
      CONTENT,
      "Quarterly",
      "2.6",
      "Customer Reviews",
      "High",
      "Trust: Builds credibility for expensive travel packages.",
      st,
      `${shown} of ${ok.length} pages show reviews or testimonials. ${schemaOk ? "Review schema is present." : "No Review/AggregateRating schema found."}`,
      "Show real customer reviews on key pages and mark them up with AggregateRating schema (only for reviews that are genuinely on the page).",
    );
  }
  {
    const all = new Set(ok.flatMap((p) => p.schema));
    const text = ok.filter((p) => p.flags.faq).length;
    const st: CheckStatus = all.has("FAQPage")
      ? "pass"
      : text
        ? "warn"
        : "fail";
    add(
      CONTENT,
      "Quarterly",
      "2.8",
      "FAQ Content",
      "Med",
      "SERP Space: Wins more space on the Google search page.",
      st,
      `${text} of ${ok.length} pages contain FAQ content. ${all.has("FAQPage") ? "FAQPage schema is present." : "No FAQPage schema found."}`,
      "Add 5 to 8 real customer questions with short answers to key pages and mark them up with FAQPage schema.",
    );
  }
  {
    const bad = ok
      .slice(1)
      .map((p) => ({ p, why: slugProblems(p.url) }))
      .filter((x) => x.why.length);
    const n = Math.max(1, ok.length - 1);
    add(
      CONTENT,
      "Quarterly",
      "2.9",
      "URL Slug Cleanliness",
      "Med",
      "UX: Short, readable URLs are better for sharing.",
      !bad.length ? "pass" : pct(bad.length, n) > 30 ? "fail" : "warn",
      bad.length
        ? `${bad.length} of ${ok.length - 1} URLs are not clean: ${list(
            bad.map((x) => `${short(x.p.url)} (${x.why[0]})`),
            2,
          )}.`
        : "All crawled URLs are short and readable.",
      "Use short lowercase URLs with hyphens (about 3 to 5 words) and 301-redirect the old ones.",
    );
  }
  {
    const trust = [...new Set(ok.flatMap((p) => p.flags.trust))],
      pay = [...new Set(ok.flatMap((p) => p.flags.payment))];
    const cert = trust.some((t) =>
      ["IATA", "ATOL", "ABTA", "Accredited", "Licensed"].includes(t),
    );
    const st: CheckStatus =
      cert && (pay.length || trust.includes("Money-back guarantee"))
        ? "pass"
        : cert || pay.length || trust.length
          ? "warn"
          : "fail";
    add(
      CONTENT,
      "Quarterly",
      "2.11",
      "Trust Badges (IATA/ATOL)",
      "High",
      "E-com: Proves the site is safe for financial transactions.",
      st,
      trust.length || pay.length
        ? `Found: ${[...trust, ...pay].join(", ")}.${cert ? "" : " No licence or accreditation (IATA/ATOL/ABTA) mention."}`
        : "No trust badges, accreditations or secure-payment marks found in page code.",
      "Show your licence/accreditation logos (IATA, ATOL, ABTA or local equivalent) and secure-payment icons in the footer and on booking pages.",
    );
  }

  // ===== 3. Authority =====
  {
    const NAME = "Backlink Gap Analysis";
    const BEN = "Competition: See where competitors get their links.";
    const FIX =
      "List the sites that link to your competitors but not to you, then pitch each one (guest post, resource page, digital PR or a better version of the page they link to).";
    const comps = c.competitors
      .filter((d) => d && d !== c.siteRoot)
      .slice(0, 2);
    if (c.shared || !comps.length) {
      add(
        AUTH,
        "Weekly",
        "3.1",
        NAME,
        "High",
        BEN,
        "manual",
        c.shared
          ? "This site is on a shared platform domain, so its own backlinks cannot be separated from the platform."
          : "No competitors were found in Google yet, so there is nothing to compare. Run the SERP check first.",
        FIX,
      );
    } else {
      try {
        const [own, ...rivals] = await Promise.all([
          linkingHosts(c.siteRoot),
          ...comps.map((d) => linkingHosts(d)),
        ]);
        const real = own.real && rivals.every((r) => r.real);
        const count = new Map<string, number>();
        for (const r of rivals)
          for (const h of r.hosts)
            if (!own.hosts.has(h)) count.set(h, (count.get(h) ?? 0) + 1);
        const gap = [...count.entries()]
          .sort((x, y) => y[1] - x[1])
          .map(([h]) => h);
        const rivalTotal = new Set(rivals.flatMap((r) => [...r.hosts])).size;
        const source = real
          ? "from the DataForSEO backlink index"
          : "from a sample of public sources (Wikipedia, Hacker News, Reddit, Stack Exchange, GitHub). Add DataForSEO keys for the full index";
        add(
          AUTH,
          "Weekly",
          "3.1",
          NAME,
          "High",
          BEN,
          !rivalTotal ? "manual" : gap.length ? "warn" : "pass",
          !rivalTotal
            ? `No sites linking to ${list(comps, 2)} were found in the public sources, so no gap could be measured. A backlink tool (Ahrefs, Semrush or DataForSEO) is needed for these competitors.`
            : gap.length
              ? `${gap.length} sites link to ${list(comps, 2)} but not to you, ${source}: ${list(gap, 6)}.`
              : `Every site found linking to ${list(comps, 2)} also links to you (${source}).`,
          FIX,
        );
      } catch (e) {
        add(
          AUTH,
          "Weekly",
          "3.1",
          NAME,
          "High",
          BEN,
          "manual",
          `The link comparison failed (${(e as Error).message}). Try the Backlinks page or a backlink tool.`,
          FIX,
        );
      }
    }
  }
  {
    const localSchema = ok.some((p) =>
      p.schema.some((t) =>
        ["LocalBusiness", "TravelAgency", "Store", "Restaurant", "Hotel"].includes(
          t,
        ),
      ),
    );
    const maps = ok.some((p) => p.flags.maps);
    const NAME = "Google Business Profile";
    const BEN = "Local SEO: Rank in the Google Maps section.";
    const FIX =
      "Claim and verify your Google Business Profile, fill every field, add photos, then link it from the site and add LocalBusiness schema with the same name, address and phone.";
    const q = (c.brand || c.siteRoot.split(".")[0]).trim();
    let done = false;
    if (c.serperPlaces && !c.shared && q.length >= 3) {
      try {
        extraRequests++;
        const j = await c.serperPlaces(q);
        const places: any[] = Array.isArray(j?.places) ? j.places : [];
        const mine = places.find((p) => {
          const h = hostKey(String(p.website ?? ""));
          return !!h && (h === c.siteRoot || h.endsWith("." + c.siteRoot));
        });
        if (mine) {
          const rating = Number(mine.rating ?? 0);
          const n = Number(mine.ratingCount ?? 0);
          const weak = (rating > 0 && rating < 4) || n < 10;
          add(
            AUTH,
            "Weekly",
            "3.2",
            NAME,
            "High",
            BEN,
            weak ? "warn" : "pass",
            `Google Maps listing found: "${mine.title}"${mine.category ? ` (${mine.category})` : ""}${mine.address ? `, ${mine.address}` : ""}. ${rating ? `Rating ${rating} from ${n} reviews.` : "No rating yet."}${n < 10 ? " Fewer than 10 reviews: ask happy customers to review." : ""}${rating > 0 && rating < 4 ? " Rating is below 4.0." : ""}`,
            "Ask recent customers for Google reviews, reply to every review and keep opening hours, photos and services up to date.",
          );
        } else {
          add(
            AUTH,
            "Weekly",
            "3.2",
            NAME,
            "High",
            BEN,
            "warn",
            `No Google Maps listing with this website was found for "${q}"${localSchema ? " although LocalBusiness-type schema is on the site" : ""}${maps ? " (the site does link to Google Maps)" : ""}. If you are an online-only shop this may be fine, otherwise the profile is missing or not linked to this website.`,
            FIX,
          );
        }
        done = true;
      } catch {
        /* fall through to the manual note below */
      }
    }
    if (!done)
      add(
        AUTH,
        "Weekly",
        "3.2",
        NAME,
        "High",
        BEN,
        localSchema || maps ? "manual" : "warn",
        `${localSchema ? "LocalBusiness-type schema is on the site. " : ""}${maps ? "The site links to Google Maps. " : ""}${localSchema || maps ? "Whether the profile is verified and complete can only be checked in business.google.com." : "No Google Maps link or LocalBusiness schema found on the site. Whether a profile exists can only be checked in business.google.com."}`,
        FIX,
      );
  }
  {
    const brand = c.siteRoot.split(".")[0];
    if (!c.serperSearch || brand.length < 4 || c.shared) {
      add(
        AUTH,
        "Weekly",
        "3.3",
        "Unlinked Brand Mentions",
        "Med",
        "Easy Links: Get credit when people talk about your site.",
        "manual",
        c.serperSearch
          ? "Brand name is too short or generic to search for reliably."
          : 'Needs SERPER_API_KEY to search Google for mentions. Search manually for: "your brand" -site:yourdomain.',
      );
    } else {
      try {
        extraRequests++;
        const j = await c.serperSearch(`"${brand}" -site:${c.siteRoot}`);
        const hits: { link: string; title: string }[] = (
          Array.isArray(j.organic) ? j.organic : []
        )
          .slice(0, 8)
          .map((o: { link?: string; title?: string }) => ({
            link: o.link ?? "",
            title: o.title ?? "",
          }))
          .filter((h: { link: string }) => h.link);
        const checked = await Promise.all(
          hits.map(async (h) => {
            const r = await safe(get(h.link, 6000), null);
            if (!r || !r.ok) return { ...h, linked: null as boolean | null };
            const html = (await safe(r.text(), ""))
              .slice(0, 600_000)
              .toLowerCase();
            if (!html.includes(brand.toLowerCase()))
              return { ...h, linked: null };
            return { ...h, linked: html.includes(c.siteRoot) };
          }),
        );
        const unlinked = checked.filter((h) => h.linked === false);
        const mentions = checked.filter((h) => h.linked !== null);
        add(
          AUTH,
          "Weekly",
          "3.3",
          "Unlinked Brand Mentions",
          "Med",
          "Easy Links: Get credit when people talk about your site.",
          !mentions.length ? "pass" : unlinked.length ? "warn" : "pass",
          !mentions.length
            ? `No other web pages mentioning "${brand}" were found in the top results.`
            : `${mentions.length} pages mention "${brand}"; ${unlinked.length} of them do not link to you${
                unlinked.length
                  ? `: ${list(
                      unlinked.map((h) => {
                        try {
                          return new URL(h.link).hostname.replace(/^www\./, "");
                        } catch {
                          return h.link;
                        }
                      }),
                      4,
                    )}`
                  : ""
              }.`,
          "Email the owners of those pages, thank them and ask for a link to your site where they mention you.",
        );
      } catch (e) {
        add(
          AUTH,
          "Weekly",
          "3.3",
          "Unlinked Brand Mentions",
          "Med",
          "Easy Links: Get credit when people talk about your site.",
          "manual",
          `Mention search failed (${(e as Error).message}). Search manually for: "${brand}" -site:${c.siteRoot}`,
        );
      }
    }
  }
  {
    const NAME = "Competitor Link Tracking";
    const BEN = "Strategy: Monitoring daily rival movements.";
    const FIX =
      "Review the new pages that mention your rivals, find the ones worth a link (lists, reviews, news) and pitch them. Repeat weekly, or set up free Google Alerts for the rival brand names.";
    const comps = c.competitors
      .filter((d) => d && d !== c.siteRoot)
      .slice(0, 3);
    if (c.serperRecent && comps.length) {
      try {
        const rows = await Promise.all(
          comps.map(async (d) => {
            extraRequests++;
            const j = await c.serperRecent!(`"${d}" -site:${d}`);
            const hits: string[] = (Array.isArray(j?.organic) ? j.organic : [])
              .map((o: { link?: string }) => hostKey(String(o.link ?? "")))
              .filter((h: string) => h && h !== d && !h.endsWith("." + d));
            return { d, hosts: [...new Set(hits)] };
          }),
        );
        const total = rows.reduce((n, r) => n + r.hosts.length, 0);
        add(
          AUTH,
          "Weekly",
          "3.4",
          NAME,
          "Med",
          BEN,
          total ? "warn" : "pass",
          total
            ? `New pages from the last 7 days that mention your rivals: ${rows
                .filter((r) => r.hosts.length)
                .map((r) => `${r.d} (${list(r.hosts, 3)})`)
                .join("; ")}.`
            : `No new pages mentioning ${list(comps, 3)} were found in Google in the last 7 days.`,
          FIX,
        );
      } catch (e) {
        add(
          AUTH,
          "Weekly",
          "3.4",
          NAME,
          "Med",
          BEN,
          "manual",
          `The weekly rival search failed (${(e as Error).message}). ${c.competitors.length ? `Competitors to track: ${list(c.competitors, 5)}.` : ""}`,
          FIX,
        );
      }
    } else {
      add(
        AUTH,
        "Weekly",
        "3.4",
        NAME,
        "Med",
        BEN,
        "manual",
        `${c.serperRecent ? "" : "Needs SERPER_API_KEY to search Google for the last 7 days. "}${comps.length ? `Competitors to track: ${list(comps, 5)}.` : "No competitors were found yet. Run the SERP check first."}`,
        FIX,
      );
    }
  }

  return { items, extraRequests };
}