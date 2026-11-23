import {
  admin,
  handle,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import { extractHeadings, stripToBodyHtml } from "../_shared/headings.ts";
import { looksJsRendered, renderEnabled, renderHtml } from "../_shared/render.ts";
import { clean } from "../_shared/siteinfo.ts";
import { hasLink, linkHref, metaContent, robotsDirectives } from "../_shared/htmlmeta.ts";
import { canon } from "../_shared/analyse.ts";
import { isUtilityUrl } from "../_shared/keywords.ts";

const UA = "Mozilla/5.0 (compatible; SEOPilotBot/1.0)";
const SKIP_EXT =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|zip|xml|mp4|mp3|woff2?)(\?|$)/i;

async function psi(url: string, strategy: "mobile" | "desktop") {
  const qs = new URLSearchParams({ url, strategy });
  ["performance", "seo", "accessibility", "best-practices"].forEach((c) =>
    qs.append("category", c),
  );
  const key = Deno.env.get("PAGESPEED_API_KEY");
  if (key) qs.set("key", key);
  const r = await fetch(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "PageSpeed request failed");
  const lh = j.lighthouseResult;
  const score = (k: string) => Math.round((lh.categories[k]?.score ?? 0) * 100);
  const a = lh.audits;
  return {
    scores: {
      performance: score("performance"),
      seo: score("seo"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
    },
    vitals: {
      lcp: a["largest-contentful-paint"]?.numericValue ?? null,
      cls: a["cumulative-layout-shift"]?.numericValue ?? null,
      tbt: a["total-blocking-time"]?.numericValue ?? null,
      fcp: a["first-contentful-paint"]?.numericValue ?? null,
      inp:
        j.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ??
        null,
    },
  };
}

type Page = {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  description: string;
  h1: number;
  imgNoAlt: number;
  canonical: boolean;
  canonicalUrl: string;
  noindex: boolean;
  viewport: boolean;
  lang: boolean;
  words: number;
  links: string[];
};

// Sites that draw their page with JavaScript (React, Vue...) have an empty shell in the raw HTML, so "no H1" would be wrong.
// For those, a few pages per audit are opened in a real browser service (free Jina Reader fallback) and checked again.
let renderLeft = 3;

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

async function fetchPage(url: string, siteHost: string): Promise<Page> {
  const empty: Page = {
    url,
    finalUrl: url,
    status: 0,
    title: "",
    description: "",
    h1: 0,
    imgNoAlt: 0,
    canonical: false,
    canonicalUrl: "",
    noindex: false,
    viewport: false,
    lang: false,
    words: 0,
    links: [],
  };
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const finalUrl = r.url || url;
    const type = r.headers.get("content-type") ?? "";
    if (!type.includes("text/html"))
      return { ...empty, finalUrl, status: r.status };
    let html = await r.text();
    if (renderLeft > 0 && renderEnabled() && extractHeadings(html).h1n === 0) {
      const words = stripToBodyHtml(html)
        .replace(/<[^>]+>/g, " ")
        .split(/\s+/)
        .filter(Boolean).length;
      const anchors = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
      if (looksJsRendered(html, words, anchors)) {
        renderLeft--;
        const rendered = await renderHtml(url);
        if (rendered) html = rendered;
      }
    }
    // links: resolved against the FINAL url, tracking parameters / #fragments / trailing slashes removed, so "/about" and
    // "/about/" (or ?utm_source=...) are one page instead of several, and same-site links work after an http->https or
    // example.com->www redirect
    const links = new Set<string>();
    for (const m of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
      try {
        const u = new URL(m[1].trim(), finalUrl);
        if (!/^https?:$/.test(u.protocol)) continue;
        if (bare(u.hostname) !== siteHost || SKIP_EXT.test(u.pathname)) continue;
        const c = canon(u.toString());
        if (c) links.add(c);
      } catch {
        /* ignore bad hrefs */
      }
    }
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const canonicalHref = linkHref(html, "canonical");
    const text = clean(stripToBodyHtml(html));
    return {
      url,
      finalUrl,
      status: r.status,
      title: clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
      description: metaContent(html, "description").trim(),
      h1: extractHeadings(html).h1n,
      imgNoAlt: imgs.filter((i) => !/\balt\s*=/i.test(i)).length,
      canonical: !!canonicalHref || hasLink(html, "canonical"),
      canonicalUrl: canonicalHref,
      noindex: robotsDirectives(html, r.headers.get("x-robots-tag")).noindex,
      viewport: !!metaContent(html, "viewport"),
      lang: /<html[^>]+\blang\s*=\s*["']?[a-z]/i.test(html),
      words: text ? text.split(" ").filter(Boolean).length : 0,
      links: [...links],
    };
  } catch {
    return empty;
  }
}

async function crawl(start: string, max = 25) {
  const siteHost = bare(new URL(start).hostname);
  const seen = new Set<string>();
  const seenFinal = new Set<string>(); // two addresses that redirect to the same page count once
  const key = (u: string) => canon(u) ?? u;
  const queue = [start];
  const pages: Page[] = [];
  while (queue.length && pages.length < max) {
    const batch = queue
      .splice(0, 5)
      .filter((u) => !seen.has(key(u)));
    batch.forEach((u) => seen.add(key(u)));
    const res = await Promise.all(batch.map((u) => fetchPage(u, siteHost)));
    for (const p of res) {
      const fk = key(p.finalUrl);
      if (seenFinal.has(fk)) continue;
      seenFinal.add(fk);
      seen.add(fk);
      pages.push(p);
      for (const l of p.links)
        if (!seen.has(key(l)) && !queue.some((q) => key(q) === key(l)) && queue.length < max * 3)
          queue.push(l);
    }
  }
  return pages.slice(0, max);
}

type Issue = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  count: number;
  pages: string[];
};

const SOFT_404 =
  /\b(?:page not found|error 404|404 error|404 not found|404 page|(?:this|that|the) page (?:does(?:n'?t| not)|did(?:n'?t| not)) exist|nothing found)\b|^\s*(?:404|not found)\s*(?:[|\-–—:!]|$)/i;

function pageIssues(pages: Page[]): Issue[] {
  const ok = (p: Page) => p.status >= 200 && p.status < 400;
  // a page the owner keeps out of Google on purpose is not judged on snippets or content
  const idx = (p: Page) => ok(p) && !p.noindex;
  const count = (key: (p: Page) => string) => {
    const g = new Map<string, number>();
    for (const p of pages)
      if (idx(p)) {
        const k = key(p).trim().toLowerCase();
        if (k) g.set(k, (g.get(k) ?? 0) + 1);
      }
    return g;
  };
  const titles = count((p) => p.title);
  const descs = count((p) => p.description);
  const rules: {
    id: string;
    severity: Issue["severity"];
    title: string;
    test: (p: Page) => boolean;
  }[] = [
    {
      id: "broken",
      severity: "critical",
      title: "Broken pages (4xx / 5xx / unreachable)",
      test: (p) => !ok(p),
    },
    {
      id: "soft-404",
      severity: "critical",
      title: "Pages that say \"not found\" but return 200 (soft 404)",
      test: (p) =>
        ok(p) && p.words < 250 && SOFT_404.test(p.title),
    },
    {
      id: "no-title",
      severity: "critical",
      title: "Pages without a title",
      test: (p) => idx(p) && !p.title,
    },
    {
      id: "dup-title",
      severity: "warning",
      title: "Pages that share the same title",
      test: (p) => idx(p) && (titles.get(p.title.trim().toLowerCase()) ?? 0) > 1,
    },
    {
      id: "no-desc",
      severity: "warning",
      title: "Pages without a meta description",
      test: (p) => idx(p) && !p.description,
    },
    {
      id: "desc-len",
      severity: "info",
      title: "Meta descriptions too short (under 70) or too long (over 165)",
      test: (p) =>
        idx(p) &&
        !!p.description &&
        (p.description.length < 70 || p.description.length > 165),
    },
    {
      id: "dup-desc",
      severity: "info",
      title: "Pages that share the same meta description",
      test: (p) =>
        idx(p) && (descs.get(p.description.trim().toLowerCase()) ?? 0) > 1,
    },
    {
      id: "no-h1",
      severity: "warning",
      title: "Pages without an H1 heading",
      test: (p) => ok(p) && p.h1 === 0,
    },
    {
      id: "no-viewport",
      severity: "critical",
      title: "Pages without a mobile viewport tag",
      test: (p) => ok(p) && !p.viewport,
    },
    {
      id: "img-alt",
      severity: "warning",
      title: "Pages with images missing alt text",
      test: (p) => ok(p) && p.imgNoAlt > 0,
    },
    {
      id: "noindex",
      severity: "warning",
      title: "Pages set to noindex (meta tag or X-Robots-Tag header)",
      test: (p) => ok(p) && p.noindex,
    },
    {
      id: "thin",
      severity: "info",
      title: "Thin pages (under 300 words)",
      test: (p) => idx(p) && p.words < 300 && !isUtilityUrl(p.finalUrl),
    },
    {
      id: "multi-h1",
      severity: "info",
      title: "Pages with more than one H1",
      test: (p) => ok(p) && p.h1 > 1,
    },
    {
      id: "title-len",
      severity: "info",
      title: "Titles too long (over 65) or too short (under 20)",
      test: (p) =>
        idx(p) && !!p.title && (p.title.length > 65 || p.title.length < 20),
    },
    {
      id: "canonical",
      severity: "info",
      title: "Pages without a canonical tag",
      test: (p) => idx(p) && !p.canonical,
    },
    {
      id: "canon-other",
      severity: "info",
      title: "Pages whose canonical points to a different address",
      test: (p) => {
        if (!idx(p) || !p.canonicalUrl) return false;
        const a = canon(p.finalUrl),
          b = canon(new URL(p.canonicalUrl, p.finalUrl).toString());
        return !!a && !!b && a !== b;
      },
    },
    {
      id: "no-lang",
      severity: "info",
      title: "Pages without a language attribute on <html>",
      test: (p) => ok(p) && !p.lang,
    },
  ];
  return rules
    .map((r) => {
      let hit: string[] = [];
      try {
        hit = pages.filter(r.test).map((p) => p.finalUrl);
      } catch {
        hit = []; // a malformed canonical must not break the whole audit
      }
      return {
        id: r.id,
        severity: r.severity,
        title: r.title,
        count: hit.length,
        pages: hit.slice(0, 10),
      };
    })
    .filter((i) => i.count > 0);
}

function vitalIssues(v: Record<string, number | null> | undefined): Issue[] {
  if (!v) return [];
  const out: Issue[] = [];
  const add = (id: string, severity: Issue["severity"], title: string) =>
    out.push({ id, severity, title, count: 1, pages: [] });
  if (v.lcp != null) {
    if (v.lcp > 4000)
      add(
        "lcp",
        "critical",
        "Largest Contentful Paint is slow on mobile (over 4s)",
      );
    else if (v.lcp > 2500)
      add(
        "lcp",
        "warning",
        "Largest Contentful Paint needs improvement on mobile (over 2.5s)",
      );
  }
  if (v.cls != null) {
    if (v.cls > 0.25)
      add(
        "cls",
        "critical",
        "Layout shifts a lot while loading (CLS over 0.25)",
      );
    else if (v.cls > 0.1)
      add("cls", "warning", "Layout shifts while loading (CLS over 0.1)");
  }
  if (v.inp != null) {
    if (v.inp > 500)
      add("inp", "critical", "Slow response to clicks and taps (INP over 500 ms)");
    else if (v.inp > 200)
      add("inp", "warning", "Response to clicks and taps needs improvement (INP over 200 ms)");
  }
  if (v.tbt != null && v.tbt > 600)
    add(
      "tbt",
      "warning",
      "Page is blocked by heavy JavaScript (TBT over 600ms)",
    );
  return out;
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const { website_id } = await req.json();
    renderLeft = 3;
    const site = await ownedWebsite(user.id, website_id);
    const url = /^https?:\/\//i.test(site.url)
      ? site.url
      : `https://${site.url}`;

    const [m, d, pages] = await Promise.allSettled([
      psi(url, "mobile"),
      psi(url, "desktop"),
      crawl(url),
    ]);
    const mobile = m.status === "fulfilled" ? m.value : null;
    const desktop = d.status === "fulfilled" ? d.value : null;
    const crawled = pages.status === "fulfilled" ? pages.value : [];
    const psiError =
      m.status === "rejected" ? String(m.reason?.message ?? m.reason) : null;

    const issues = [
      ...vitalIssues(mobile?.vitals),
      ...pageIssues(crawled),
    ].sort(
      (a, b) =>
        ["critical", "warning", "info"].indexOf(a.severity) -
        ["critical", "warning", "info"].indexOf(b.severity),
    );

    const { data, error } = await admin()
      .from("audits")
      .insert({
        website_id: site.id,
        scores: {
          mobile: mobile?.scores ?? null,
          desktop: desktop?.scores ?? null,
        },
        vitals: {
          mobile: mobile?.vitals ?? null,
          desktop: desktop?.vitals ?? null,
        },
        issues,
        pages_crawled: crawled.length,
        psi_error: psiError,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return json({ audit: data });
  }),
);