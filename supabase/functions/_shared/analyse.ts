import { clean, get, meta, schemaTypes } from "./siteinfo.ts";
import { looksJsRendered, renderHtml } from "./render.ts";
import { emptyFlags, pageFlags, type Flags } from "./checklist.ts";

// Shared page analysis used by the crawl and research functions.

export type Link = { url: string; rel: string; anchor: string };
export type LinkStats = {
  internal: number;
  external: number;
  nofollow: number;
  dofollow: number;
  noreferrer: number;
  noopener: number;
  anchors: number;
};
export type ImgStats = {
  total: number;
  noAlt: number;
  noSize: number;
  notLazy: number;
  badAlt: string[];
};
export type Page = {
  url: string;
  status: number;
  ms: number;
  title: string;
  description: string;
  h1s: string[];
  h2s?: string[]; // text of the H2/H3 headings (used to find the site's real keywords)
  h2: number;
  h3: number;
  words: number;
  canonical: string;
  noindex: boolean;
  lang: string;
  viewport: boolean;
  og: boolean;
  mixed: number;
  schema: string[];
  rendered?: boolean;
  nonHtml?: boolean;
  contentType?: string;
  ogMissing?: string[];
  linkStats: LinkStats;
  internalUrls: string[];
  externalLinks: Link[];
  images: ImgStats;
  flags: Flags;
  text: string;
  anchors?: string[]; // visible text of internal links (menu, categories, product names)
  metaKeywords?: string;
};

export const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
export const hostOf = (link: string) => {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const TRACKING = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|ref$|ref_)/i;
/** One stable key per URL: no hash, no tracking params, no trailing slash, lowercase host. */
const CANON_CACHE = new Map<string, string | null>();
export function canon(u: string): string | null {
  // the same URL is normalised thousands of times per run (every link on every page): remember the answer
  const hit = CANON_CACHE.get(u);
  if (hit !== undefined) return hit;
  const out = canonRaw(u);
  if (CANON_CACHE.size > 40_000) CANON_CACHE.clear();
  CANON_CACHE.set(u, out);
  return out;
}
function canonRaw(u: string): string | null {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = "";
    x.hostname = x.hostname.toLowerCase();
    for (const k of [...x.searchParams.keys()])
      if (TRACKING.test(k)) x.searchParams.delete(k);
    let s = x.toString();
    if (x.pathname !== "/") s = s.replace(/\/(\?|$)/, "$1");
    else s = s.replace(/\/$/, "");
    return s;
  } catch {
    return null;
  }
}

export function extractLinks(
  html: string,
  base: string,
  isInternal: (host: string) => boolean,
) {
  const stats: LinkStats = {
    internal: 0,
    external: 0,
    nofollow: 0,
    dofollow: 0,
    noreferrer: 0,
    noopener: 0,
    anchors: 0,
  };
  const internalUrls = new Set<string>();
  const externalLinks: Link[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/\bhref=["']([^"']*)["']/i)?.[1]?.trim();
    if (!href) continue;
    if (href.startsWith("#")) {
      stats.anchors++;
      continue;
    }
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let x: URL;
    try {
      x = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(x.protocol)) continue;
    x.hash = "";
    const rel = (
      attrs.match(/\brel=["']([^"']*)["']/i)?.[1] ?? ""
    ).toLowerCase();
    const internal = isInternal(x.hostname.toLowerCase().replace(/^www\./, ""));
    if (internal) stats.internal++;
    else stats.external++;
    if (rel.includes("nofollow")) stats.nofollow++;
    else stats.dofollow++;
    if (rel.includes("noreferrer")) stats.noreferrer++;
    if (rel.includes("noopener")) stats.noopener++;
    if (internal) {
      if (internalUrls.size < 300) internalUrls.add(x.toString());
    } else if (externalLinks.length < 100)
      externalLinks.push({
        url: x.toString(),
        rel,
        anchor: clean(m[2]).slice(0, 80),
      });
  }
  return { stats, internalUrls: [...internalUrls], externalLinks };
}

export function extractImages(html: string): ImgStats {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const badAlt: string[] = [];
  let noAlt = 0,
    noSize = 0,
    notLazy = 0;
  for (const t of tags) {
    if (!/\balt\s*=/i.test(t)) {
      noAlt++;
      if (badAlt.length < 10)
        badAlt.push(
          (
            t.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1] ??
            "(inline image)"
          ).slice(0, 160),
        );
    }
    if (!(/\bwidth\s*=/i.test(t) && /\bheight\s*=/i.test(t))) noSize++;
    if (!/\bloading\s*=\s*["']lazy/i.test(t)) notLazy++;
  }
  return { total: tags.length, noAlt, noSize, notLazy, badAlt };
}

export function analysePage(
  html: string,
  finalUrl: string,
  status: number,
  ms: number,
  isInternal: (host: string) => boolean,
): Page {
  const title = clean(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  );
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
    .slice(0, 5);
  const body = clean(
    html.replace(
      /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi,
      " ",
    ),
  );
  const links = extractLinks(html, finalUrl, isInternal);
  const h2s = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
    .map((m) => clean(m[1]))
    .filter((t) => t && t.length <= 120)
    .slice(0, 12);
  const anchors = [
    ...new Set(
      [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
        .map((m) => {
          const href = m[1].match(/\bhref=[\"']([^\"']*)[\"']/i)?.[1] ?? "";
          if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href))
            return "";
          try {
            const x = new URL(href, finalUrl);
            if (!isInternal(x.hostname.toLowerCase().replace(/^www\./, "")))
              return "";
          } catch {
            return "";
          }
          return clean(m[2]);
        })
        .filter((t) => t.length >= 4 && t.length <= 70),
    ),
  ].slice(0, 25);
  return {
    url: finalUrl,
    status,
    ms,
    title,
    description: meta(html, "description").trim(),
    h1s,
    h2s,
    h2: (html.match(/<h2[\s>]/gi) ?? []).length,
    h3: (html.match(/<h3[\s>]/gi) ?? []).length,
    words: body ? body.split(" ").filter(Boolean).length : 0,
    canonical:
      html.match(
        /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
      )?.[1] ?? (/<link[^>]+rel=["']canonical["']/i.test(html) ? "yes" : ""),
    noindex: /noindex/i.test(meta(html, "robots")),
    lang: html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? "",
    viewport: !!meta(html, "viewport"),
    og: !!meta(html, "og:title"),
    ogMissing: ["og:title", "og:description", "og:image"].filter(
      (t) => !meta(html, t),
    ),
    mixed: (html.match(/\b(?:src|srcset)=["']http:\/\//gi) ?? []).length,
    schema: schemaTypes(html),
    linkStats: links.stats,
    internalUrls: links.internalUrls,
    externalLinks: links.externalLinks,
    images: extractImages(html),
    flags: pageFlags(html),
    text: body.slice(0, 3000),
    anchors,
    metaKeywords: meta(html, "keywords").trim().slice(0, 300),
  };
}

export const emptyPage = (url: string, status: number, ms: number): Page => ({
  url,
  status,
  ms,
  title: "",
  description: "",
  h1s: [],
  h2: 0,
  h3: 0,
  words: 0,
  canonical: "",
  noindex: false,
  lang: "",
  viewport: false,
  og: false,
  mixed: 0,
  schema: [],
  linkStats: {
    internal: 0,
    external: 0,
    nofollow: 0,
    dofollow: 0,
    noreferrer: 0,
    noopener: 0,
    anchors: 0,
  },
  internalUrls: [],
  externalLinks: [],
  images: { total: 0, noAlt: 0, noSize: 0, notLazy: 0, badAlt: [] },
  flags: emptyFlags(),
  text: "",
});

/**
 * Fetch and analyse one page. If the raw HTML looks empty because the site builds its content with JavaScript
 * (React, Vue, Angular...) and canRender is true, the page is rendered in a real browser service and analysed again.
 */
/** 429 / 430 mean "too many requests": the website slowed our checker down. The page itself is fine, so this is never a page problem. */
export const isLimited = (status: number | null | undefined) =>
  status === 429 || status === 430;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPage(
  url: string,
  isInternal: (host: string) => boolean,
  canRender = false,
): Promise<Page> {
  // one slow or failed answer is often just a cold start or a network hiccup: try once more and keep the better result,
  // so the same site gets the same Health score on every run
  const first = await fetchPageOnce(url, isInternal, canRender);
  if (first.status === 200 && first.ms <= 1500) return first;
  if (isLimited(first.status)) {
    // the website asked us to slow down: wait a little and ask again instead of hitting it harder
    let page = first;
    for (const wait of [1500, 3500]) {
      await sleep(wait);
      page = await fetchPageOnce(url, isInternal, canRender);
      if (!isLimited(page.status)) break;
    }
    return page;
  }
  const second = await fetchPageOnce(url, isInternal, canRender);
  if (first.status !== 200 && second.status === 200) return second;
  if (second.status === 200 && second.ms < first.ms) return second;
  return first;
}

async function fetchPageOnce(
  url: string,
  isInternal: (host: string) => boolean,
  canRender = false,
): Promise<Page> {
  const t0 = Date.now();
  try {
    const r = await get(url, 8000);
    const ms = Date.now() - t0;
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    // a file (markdown, text, json, pdf...) is not a web page: mark it so no HTML checks (canonical, OG, lang...) are run on it
    if (!ct.includes("text/html") && !ct.includes("application/xhtml"))
      return {
        ...emptyPage(r.url, r.status, ms),
        nonHtml: true,
        contentType: ct.split(";")[0] || "unknown",
      };
    const html = (await r.text()).slice(0, 800_000);
    const page = analysePage(html, r.url, r.status, ms, isInternal);
    if (
      canRender &&
      r.status === 200 &&
      looksJsRendered(html, page.words, page.linkStats.internal)
    ) {
      const rendered = await renderHtml(r.url);
      if (rendered) {
        const p2 = analysePage(rendered, r.url, r.status, ms, isInternal);
        if (
          p2.words > page.words ||
          p2.linkStats.internal > page.linkStats.internal
        )
          return { ...p2, rendered: true };
      }
    }
    return page;
  } catch {
    return emptyPage(url, 0, Date.now() - t0);
  }
}