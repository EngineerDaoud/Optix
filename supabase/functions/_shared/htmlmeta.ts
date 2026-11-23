// Small, dependency-free HTML helpers (no Deno / network APIs), so they can be unit-tested anywhere.
//
// Why this file exists: the old `meta()` helper used  content=["']([^"']*)["']  which stops at the FIRST quote of any kind,
// so  <meta name="description" content="We're the UK's best shop">  was read as just  "We".  Every description-length,
// Open Graph and keyword check built on it was wrong for any text that has an apostrophe. Tags are now parsed attribute by
// attribute, and a value that opens with " only ends at the next ".

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  pound: "£",
  euro: "€",
  yen: "¥",
  cent: "¢",
  bull: "•",
  middot: "·",
  times: "×",
  deg: "°",
};

/** Decode HTML entities (named and numeric). Unknown named entities become a space, like the old behaviour. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (_m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return NAMED[body.toLowerCase()] ?? " ";
  });
}

/** Parse the attributes of one start tag. Names are lower-cased; quoted values may contain the other quote and ">" . */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // skip "<name" then read attr, attr=value, attr="value", attr='value'
  const body = tag.replace(/^<\s*[a-z0-9:-]+/i, "").replace(/\/?>\s*$/, "");
  const re =
    /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (name in out) continue; // the first occurrence wins, like a browser
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

// a start tag that does not end at a ">" found inside a quoted value
const TAG = (name: string) =>
  new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi");

/** content of <meta name|property|itemprop="NAME" content="...">, either attribute order. "" when absent. */
export function metaContent(html: string, name: string): string {
  const want = name.toLowerCase();
  for (const m of html.matchAll(TAG("meta"))) {
    const a = parseAttrs(m[0]);
    const key = (a.name ?? a.property ?? a.itemprop ?? "").toLowerCase();
    // a tag can carry both name= and property=: look at each
    if (
      key === want ||
      (a.property ?? "").toLowerCase() === want ||
      (a.name ?? "").toLowerCase() === want
    )
      if (a.content !== undefined) return a.content;
  }
  return "";
}

/** href of the first <link rel="REL"> (rel can hold several words, any attribute order). "" when absent. */
export function linkHref(html: string, rel: string): string {
  const want = rel.toLowerCase();
  for (const m of html.matchAll(TAG("link"))) {
    const a = parseAttrs(m[0]);
    if (
      (a.rel ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes(want) &&
      a.href
    )
      return a.href.trim();
  }
  return "";
}

/** true when <link rel="REL"> exists even without a usable href */
export function hasLink(html: string, rel: string): boolean {
  const want = rel.toLowerCase();
  for (const m of html.matchAll(TAG("link")))
    if (
      (parseAttrs(m[0]).rel ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes(want)
    )
      return true;
  return false;
}

/** All hreflang alternates of a page: [{ lang: "en-gb", href: "https://..." }] */
export function hreflangs(html: string): { lang: string; href: string }[] {
  const out: { lang: string; href: string }[] = [];
  for (const m of html.matchAll(TAG("link"))) {
    const a = parseAttrs(m[0]);
    if (
      (a.rel ?? "").toLowerCase().split(/\s+/).includes("alternate") &&
      a.hreflang &&
      a.href
    )
      out.push({ lang: a.hreflang.toLowerCase(), href: a.href.trim() });
  }
  return out;
}

/** Robots directives from <meta name="robots|googlebot"> and an optional X-Robots-Tag header value. */
export function robotsDirectives(html: string, header?: string | null) {
  const text = [
    metaContent(html, "robots"),
    metaContent(html, "googlebot"),
    header ?? "",
  ]
    .join(",")
    .toLowerCase();
  const has = (w: string) => new RegExp(`(^|[\\s,:])${w}(?=$|[\\s,;])`).test(text);
  return {
    noindex: has("noindex") || has("none"),
    nofollow: has("nofollow") || has("none"),
  };
}

/** Resolve a (possibly relative) URL against the page URL. "" when it cannot be resolved. */
export function absUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Structured data (JSON-LD) quality. The old check only listed the TYPES on a page, so a Product without a price, an
// Article without a date or a JSON-LD block with a syntax error all counted as "has schema". Google ignores such markup,
// so no rich result (price, stars, FAQ, breadcrumbs) is ever shown. These rules follow Google's structured-data docs.
// ---------------------------------------------------------------------------------------------------------

const filled = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(filled);
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true; // numbers, booleans
};
const asList = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v]).filter(
    (x): x is Record<string, unknown> => !!x && typeof x === "object",
  );

const LOCAL_TYPE =
  /(LocalBusiness|Restaurant|Store|Hotel|Dentist|Physician|Clinic|Salon|Spa|Repair|Plumber|Electrician|Contractor|Agency|Bakery|Pharmacy|Gym)$/;

/** Human-readable problems found in the page's JSON-LD ([] = nothing wrong or no schema at all). */
export function schemaProblems(html: string): string[] {
  const out = new Set<string>();
  const check = (o: Record<string, unknown>) => {
    const raw = o["@type"];
    const types = (Array.isArray(raw) ? raw : [raw]).filter(
      (t): t is string => typeof t === "string",
    );
    const is = (...n: string[]) => types.some((t) => n.includes(t));
    if (is("Product", "ProductGroup")) {
      if (!filled(o.name)) out.add("Product: missing name");
      const offers = asList(o.offers);
      if (!offers.length && !filled(o.aggregateRating) && !filled(o.review))
        out.add("Product: missing offers (price), aggregateRating or review");
      for (const of of offers) {
        const hasPrice =
          filled(of.price) || filled(of.lowPrice) || filled(of.priceSpecification);
        if (!hasPrice) out.add("Product: offer has no price");
        else if (
          !filled(of.priceCurrency) &&
          !filled(of.priceSpecification)
        )
          out.add("Product: offer has no priceCurrency");
        if (!filled(of.availability))
          out.add("Product: offer has no availability");
      }
      if (!filled(o.image)) out.add("Product: missing image");
    }
    if (is("Article", "BlogPosting", "NewsArticle", "TechArticle")) {
      if (!filled(o.headline)) out.add("Article: missing headline");
      if (!filled(o.datePublished)) out.add("Article: missing datePublished");
      if (!filled(o.image)) out.add("Article: missing image");
      if (!filled(o.author)) out.add("Article: missing author");
    }
    if (is("FAQPage")) {
      const qs = asList(o.mainEntity);
      if (!qs.length) out.add("FAQPage: no questions (mainEntity)");
      else if (qs.some((q) => !filled(q.name) || !filled(q.acceptedAnswer)))
        out.add("FAQPage: a question has no answer");
    }
    if (is("BreadcrumbList") && !asList(o.itemListElement).length)
      out.add("BreadcrumbList: no items");
    if (is("AggregateRating")) {
      if (!filled(o.ratingValue)) out.add("AggregateRating: missing ratingValue");
      if (!filled(o.reviewCount) && !filled(o.ratingCount))
        out.add("AggregateRating: missing reviewCount");
    }
    if (types.some((t) => LOCAL_TYPE.test(t))) {
      if (!filled(o.name)) out.add("LocalBusiness: missing name");
      if (!filled(o.address)) out.add("LocalBusiness: missing address");
      if (!filled(o.telephone)) out.add("LocalBusiness: missing telephone");
    }
    if (is("Organization", "Corporation") && !filled(o.name))
      out.add("Organization: missing name");
  };
  const walk = (n: unknown, depth = 0) => {
    if (depth > 8) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      check(o);
      for (const v of Object.values(o)) walk(v, depth + 1);
    }
  };
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const body = m[1]
      .trim()
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "")
      .trim();
    if (!body) continue;
    try {
      walk(JSON.parse(body));
    } catch {
      out.add("Invalid JSON-LD (syntax error): Google ignores this block");
    }
  }
  return [...out].slice(0, 8);
}