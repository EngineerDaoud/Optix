import * as cheerio from "npm:cheerio@1.0.0";

// Strong link detector. Opens a page's HTML with a real parser (cheerio) instead of regex and finds every link to a target site:
//  - plain <a href>, <area href>, links in <base href> pages, relative and protocol-relative urls
//  - redirect wrappers (facebook l.php?u=, google /url?q=, linkedin, reddit, "?url=" style shims, urls glued into the path)
//  - rel parsing (nofollow / sponsored / ugc) plus page-level <meta name="robots" content="nofollow">
//  - anchor text (text, image alt, title, aria-label) and image links
//  - placement: real content, sidebar, navigation, footer or comment (sitewide / spam links count less)
//  - which page of the target is linked (target url)
//  - unlinked mentions of the web address or the brand name in the visible text

export type Rel = "dofollow" | "nofollow" | "sponsored" | "ugc";
export type Placement = "content" | "sidebar" | "nav" | "footer" | "comment";

export type PageLink = {
  target: string;
  anchor: string;
  isImage: boolean;
  rel: Rel;
  placement: Placement;
  wrapped: boolean;
};
export type Scan = {
  links: PageLink[]; // every link found, de-duplicated by target + anchor
  best: PageLink | null; // the link that represents this page
  title: string;
  outbound: number; // number of different external sites this page links to
  mentionedUrl: boolean; // web address written in the visible text
  mentionedBrand: boolean; // brand name written in the visible text
  pageNofollow: boolean;
};

const SLD = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
const SHARED = [
  "vercel.app",
  "netlify.app",
  "github.io",
  "pages.dev",
  "myshopify.com",
  "wixsite.com",
  "blogspot.com",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "onrender.com",
  "wordpress.com",
  "substack.com",
  "tumblr.com",
];

/** "blog.example.co.uk" -> "example.co.uk". Free-hosting names (x.github.io) stay whole, because every user is a different site. */
export function siteKey(host: string) {
  const h = host.toLowerCase().replace(/^www\./, "");
  const shared = SHARED.find((s) => h === s || h.endsWith("." + s));
  if (shared)
    return h === shared
      ? h
      : h
          .split(".")
          .slice(-(shared.split(".").length + 1))
          .join(".");
  const p = h.split(".");
  if (p.length >= 3 && p[p.length - 1].length === 2 && SLD.has(p[p.length - 2]))
    return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

const WRAP_PARAMS = [
  "u",
  "url",
  "q",
  "target",
  "to",
  "link",
  "href",
  "dest",
  "destination",
  "redirect",
  "redir",
  "goto",
  "out",
  "r",
  "ru",
  "ref",
  "continue",
  "next",
  "uri",
  "l",
];
const GENERIC_SCHEME = /^(javascript|mailto|tel|sms|data|blob|about):/i;

function hostOfUrl(u: URL) {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

/** Returns the absolute url if it points at the target site, looking inside redirect wrappers too. */
function resolveHit(
  raw: string,
  base: string,
  root: string,
): { url: string; wrapped: boolean } | null {
  const href = raw.trim();
  if (!href || href.startsWith("#") || GENERIC_SCHEME.test(href)) return null;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (siteKey(hostOfUrl(u)) === root) return { url: u.href, wrapped: false };
  // wrapper in the query string: ?u=https%3A%2F%2Fexample.com%2F
  for (const k of WRAP_PARAMS) {
    const v = u.searchParams.get(k);
    if (!v) continue;
    for (const cand of [v, safeDecode(v)]) {
      try {
        const inner = new URL(cand);
        if (
          /^https?:$/.test(inner.protocol) &&
          siteKey(hostOfUrl(inner)) === root
        )
          return { url: inner.href, wrapped: true };
      } catch {
        /* not a url */
      }
    }
  }
  // wrapper glued into the path or hash: /redirect/https://example.com/page
  const m = safeDecode(u.pathname + u.search + u.hash).match(
    /https?:\/\/[^\s"'<>]+/i,
  );
  if (m) {
    try {
      const inner = new URL(m[0]);
      if (siteKey(hostOfUrl(inner)) === root)
        return { url: inner.href, wrapped: true };
    } catch {
      /* ignore */
    }
  }
  return null;
}
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const PLACEMENT_RULES: [Placement, string][] = [
  [
    "comment",
    "#comments, #respond, .comments, .comment, .comment-list, .comment-body, .commentlist, [class*='comment-content'], [itemprop='comment']",
  ],
  [
    "footer",
    "footer, [role='contentinfo'], #footer, .footer, .site-footer, .page-footer",
  ],
  [
    "nav",
    "nav, [role='navigation'], .navbar, .menu, .main-menu, #menu, .breadcrumb, .breadcrumbs",
  ],
  [
    "sidebar",
    "aside, [role='complementary'], .sidebar, #sidebar, .widget, .widget-area, .blogroll",
  ],
];

type El = ReturnType<ReturnType<typeof cheerio.load>>;
function placementOf($: cheerio.CheerioAPI, el: El): Placement {
  // a link inside the main article always counts as content, even if the site wraps it in other blocks
  const inArticle =
    el.closest(
      "article, main, [role='main'], .entry-content, .post-content, .article-body, .post-body, .single-content",
    ).length > 0;
  for (const [name, sel] of PLACEMENT_RULES) {
    const hit = el.closest(sel);
    if (!hit.length) continue;
    // an <article> or <main> that sits INSIDE the hit means the link is really content (e.g. a comment-styled wrapper around the post)
    if (
      name !== "comment" &&
      inArticle &&
      hit.find("article, main").length > 0 &&
      hit.closest("article, main").length === 0
    )
      continue;
    return name;
  }
  // site header that is not an article header
  const head = el.closest("header, [role='banner']");
  if (head.length && head.closest("article").length === 0 && !inArticle)
    return "nav";
  return "content";
}

function relOf(attr: string | undefined, pageNofollow: boolean): Rel {
  const t = (attr ?? "").toLowerCase().split(/[\s,]+/);
  if (t.includes("sponsored")) return "sponsored";
  if (t.includes("ugc")) return "ugc";
  if (t.includes("nofollow") || pageNofollow) return "nofollow";
  return "dofollow";
}

const clip = (s: string, n = 80) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Rank of a link when a page has several: follow beats nofollow, content beats footer, text beats image. */
const rank = (l: PageLink) =>
  (l.rel === "dofollow"
    ? 8
    : l.rel === "ugc"
      ? 3
      : l.rel === "sponsored"
        ? 2
        : 4) +
  (l.placement === "content" ? 4 : l.placement === "sidebar" ? 2 : 0) +
  (l.anchor && l.anchor !== "(empty)" ? 1 : 0) +
  (l.isImage ? 0 : 0.5);

/** Visible text, lower case, without a DOM. Cheap enough to run on every page. */
function visibleLower(lower: string) {
  return lower
    .slice(0, 700_000)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}
const quickTitle = (html: string) =>
  clip(
    (
      html.slice(0, 60_000).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    ).replace(/<[^>]+>/g, " "),
    140,
  );
const decodeAmp = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

/** Fast, DOM-free scan with regex. Used when the CPU budget of the request is nearly used up. Cannot tell where on the page a link sits. */
export function quickScan(
  html: string,
  pageUrl: string,
  root: string,
  brand = "",
): Scan {
  const lower = html.toLowerCase();
  const links: PageLink[] = [];
  const seen = new Set<string>();
  if (lower.includes(root)) {
    for (const m of html
      .slice(0, 1_500_000)
      .matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
      if (!m[1].toLowerCase().includes(root)) continue;
      const h = m[1].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const hit = resolveHit(
        decodeAmp(h?.[1] ?? h?.[2] ?? h?.[3] ?? ""),
        pageUrl,
        root,
      );
      if (!hit) continue;
      const inner = m[2];
      const text = clip(decodeAmp(inner.replace(/<[^>]+>/g, " ")));
      const isImage = !text && /<img|<svg/i.test(inner);
      const l: PageLink = {
        target: hit.url,
        anchor: text || (isImage ? "(image link)" : "(empty)"),
        isImage,
        wrapped: hit.wrapped,
        rel: relOf(
          m[1]
            .match(/rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
            ?.slice(1)
            .find(Boolean),
          false,
        ),
        placement: "content",
      };
      const key = `${l.target}|${l.anchor}|${l.rel}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push(l);
      }
    }
  }
  const vis = visibleLower(lower);
  const b = brand.trim().toLowerCase();
  return {
    links,
    best: links.length ? [...links].sort((x, y) => rank(y) - rank(x))[0] : null,
    title: quickTitle(html),
    outbound: 0,
    mentionedUrl: vis.includes(root),
    mentionedBrand: b.length >= 4 && vis.includes(b),
    pageNofollow: false,
  };
}

export function scanPage(
  html: string,
  pageUrl: string,
  root: string,
  brand = "",
): Scan {
  // No DOM needed when the web address does not appear anywhere in the page: no link can exist. Most Google results end here.
  const lowerAll = html.toLowerCase();
  if (!lowerAll.includes(root)) {
    const b = brand.trim().toLowerCase();
    return {
      links: [],
      best: null,
      title: quickTitle(html),
      outbound: 0,
      mentionedUrl: false,
      mentionedBrand: b.length >= 4 && visibleLower(lowerAll).includes(b),
      pageNofollow: false,
    };
  }
  // htmlparser2 is about 3x faster and 3x lighter than the default parser; links do not need a browser-exact DOM
  const $ = cheerio.load(html, {
    _useHtmlParser2: true,
  } as cheerio.CheerioOptions);
  let base = pageUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      /* keep page url */
    }
  }

  const robots = (
    $("meta[name='robots'], meta[name='googlebot']")
      .map((_, e) => $(e).attr("content") ?? "")
      .get()
      .join(",") || ""
  ).toLowerCase();
  const pageNofollow = /\bnofollow\b/.test(robots) || /\bnone\b/.test(robots);

  const seen = new Set<string>();
  const links: PageLink[] = [];
  const outSites = new Set<string>();

  $("a[href], area[href], [data-href], [data-url]").each((_, node) => {
    const el = $(node);
    const raw =
      el.attr("href") ?? el.attr("data-href") ?? el.attr("data-url") ?? "";
    if (!raw) return;
    let host = "";
    try {
      host = siteKey(hostOfUrl(new URL(raw.trim(), base)));
    } catch {
      /* relative or bad */
    }
    const hit = resolveHit(raw, base, root);
    if (!hit) {
      if (host && host !== siteKey(hostOfUrl(new URL(pageUrl))))
        outSites.add(host);
      return;
    }

    const img = el.find("img").first();
    const text = clip(el.text());
    const alt = clip(img.attr("alt") ?? "");
    const label = clip(el.attr("title") ?? el.attr("aria-label") ?? "");
    const isImage = !text && (img.length > 0 || el.find("svg").length > 0);
    const anchor =
      text ||
      (isImage ? "(image link)" : label) ||
      (alt ? alt : "") ||
      "(empty)";
    const l: PageLink = {
      target: hit.url,
      anchor,
      isImage,
      wrapped: hit.wrapped,
      rel: relOf(el.attr("rel"), pageNofollow),
      placement: placementOf($, el as unknown as El),
    };
    const key = `${l.target}|${l.anchor}|${l.rel}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(l);
  });

  // visible text only (no scripts or styles) for unlinked mentions
  $("script, style, noscript, template").remove();
  const text = $("body").text().toLowerCase().replace(/\s+/g, " ");
  const b = brand.trim().toLowerCase();

  return {
    links,
    best: links.length ? [...links].sort((x, y) => rank(y) - rank(x))[0] : null,
    title: clip($("title").first().text(), 140),
    outbound: outSites.size,
    mentionedUrl: text.includes(root),
    mentionedBrand: b.length >= 4 && text.includes(b),
    pageNofollow,
  };
}
