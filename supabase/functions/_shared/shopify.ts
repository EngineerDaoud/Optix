// Public Shopify store facts for ANY Shopify website. No login, no API key, no paid tool.
// Everything comes from endpoints every Shopify storefront already serves publicly.
//
// Fallback chain (first one that returns products wins):
//   1. /products.json                      (pages fetched one after another, not in parallel)
//   2. /collections/all/products.json      (often open when /products.json is blocked)
//   3. /collections/<handle>/products.json (top collections, merged)
//   4. sitemap_products_*.xml + /products/<handle>.js for a sample (works even if every .json list is blocked)
// Plus: best sellers (the store's own "best-selling" sort), collections with product counts, currency.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HDRS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json,text/xml,text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

type Diag = { path: string; status: number | string; n: number };
type P = {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  type: string;
  tags: string[];
  price: number | null;
  compareAt: number | null;
  available: boolean | null;
  published: string | null;
  updated: string | null;
  image: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (p: string) =>
  p
    .split("?")[0]
    .replace(/^\/products\/[^/]+/, "/products/*")
    .replace(/^\/collections\/[^/]+\/products/, "/collections/*/products");
function log(diag: Diag[], path: string, status: number | string) {
  const k = norm(path);
  const hit = diag.find((d) => d.path === k && d.status === status);
  if (hit) hit.n++;
  else diag.push({ path: k, status, n: 1 });
}

async function req(
  host: string,
  path: string,
  diag: Diag[],
  tries = 2,
): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://${host}${path}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(9000),
        headers: HDRS,
      });
      log(diag, path, r.status);
      if (r.status === 429 || r.status >= 500) {
        await r.body?.cancel();
        await sleep(700 * (i + 1));
        continue;
      }
      return r;
    } catch {
      log(diag, path, "error");
    }
  }
  return null;
}

async function getJson(host: string, path: string, diag: Diag[]) {
  const r = await req(host, path, diag);
  if (!r || !r.ok) {
    await r?.body?.cancel();
    return null;
  }
  try {
    return await r.json();
  } catch {
    return null;
  }
}

async function getText(host: string, path: string, diag: Diag[]) {
  const r = await req(host, path, diag);
  if (!r || !r.ok) {
    await r?.body?.cancel();
    return null;
  }
  try {
    return (await r.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
};

/** products.json shape (prices are decimal strings) */
function fromJson(p: any): P {
  const vs: any[] = p.variants ?? [];
  const prices = vs.map((v) => num(v.price)).filter((n): n is number => !!n);
  const cmp = vs.map((v) => num(v.compare_at_price)).filter((n): n is number => !!n);
  return {
    id: String(p.id ?? p.handle),
    title: String(p.title ?? ""),
    handle: String(p.handle ?? ""),
    vendor: String(p.vendor ?? ""),
    type: String(p.product_type ?? ""),
    tags: Array.isArray(p.tags)
      ? p.tags.map(String)
      : typeof p.tags === "string"
        ? p.tags.split(",").map((t: string) => t.trim())
        : [],
    price: prices.length ? Math.min(...prices) : null,
    compareAt: cmp.length ? Math.max(...cmp) : null,
    available: vs.length ? vs.some((v) => v.available !== false) : null,
    published: p.published_at ?? null,
    updated: p.updated_at ?? p.published_at ?? null,
    image: p.images?.[0]?.src ?? null,
  };
}

/** /products/<handle>.js shape (prices are in cents) */
function fromJs(p: any, lastmod?: string | null): P {
  const vs: any[] = p.variants ?? [];
  const prices = vs.map((v) => num(v.price)).filter((n): n is number => !!n);
  const cmp = vs.map((v) => num(v.compare_at_price)).filter((n): n is number => !!n);
  return {
    id: String(p.id ?? p.handle),
    title: String(p.title ?? ""),
    handle: String(p.handle ?? ""),
    vendor: String(p.vendor ?? ""),
    type: String(p.type ?? ""),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    price: prices.length ? Math.min(...prices) / 100 : null,
    compareAt: cmp.length ? Math.max(...cmp) / 100 : null,
    available: typeof p.available === "boolean" ? p.available : null,
    published: p.published_at ?? p.created_at ?? null,
    updated: lastmod ?? p.published_at ?? null,
    image: p.featured_image ?? p.images?.[0] ?? null,
  };
}

async function pagedProducts(
  host: string,
  base: string,
  diag: Diag[],
  maxPages = 8,
): Promise<any[]> {
  const out: any[] = [];
  for (let n = 1; n <= maxPages; n++) {
    const j = await getJson(host, `${base}?limit=250&page=${n}`, diag);
    const list: any[] = j?.products ?? [];
    out.push(...list);
    if (list.length < 250) break;
    await sleep(200);
  }
  return out;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

type SmProduct = { handle: string; lastmod: string | null; title: string | null; images: number };
type Sitemap = {
  products: SmProduct[];
  pageHandles: string[];
  collections: number;
  articles: number;
  lastPost: string | null;
};

function parseUrls(xml: string) {
  return xml
    .split("<url>")
    .slice(1)
    .map((blk) => ({
      loc: blk.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1] ?? "",
      lastmod: blk.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? null,
      title: blk.match(/<image:title>\s*([^<]+?)\s*<\/image:title>/)?.[1] ?? null,
      images: (blk.match(/<image:image>/g) ?? []).length,
    }))
    .filter((u) => u.loc);
}
const pathOf = (loc: string) => {
  try {
    const u = new URL(loc);
    return u.pathname + u.search;
  } catch {
    return null;
  }
};

/** The sitemap lists every product, page, collection and blog post, which is the safest public source there is. */
async function readSitemap(host: string, diag: Diag[]): Promise<Sitemap | null> {
  const idx = await getText(host, "/sitemap.xml", diag);
  if (!idx) return null;
  const locs = [...idx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const of = (re: RegExp, n: number) => locs.filter((l) => re.test(l)).slice(0, n);
  const fetchMaps = async (list: string[]) =>
    (
      await Promise.all(
        list.map(async (l) => {
          const p = pathOf(l);
          return p ? getText(host, p, diag) : null;
        }),
      )
    )
      .filter((x): x is string => !!x)
      .flatMap(parseUrls);

  const [prod, pages, cols, blogs] = await Promise.all([
    fetchMaps(of(/sitemap_products/i, 4)),
    fetchMaps(of(/sitemap_pages/i, 1)),
    fetchMaps(of(/sitemap_collections/i, 2)),
    fetchMaps(of(/sitemap_blogs/i, 3)),
  ]);
  const direct = !locs.some((l) => /sitemap_/i.test(l)) ? parseUrls(idx) : [];
  const productRows = [...prod, ...direct].filter((u) => /\/products\//.test(u.loc));
  const posts = blogs.filter((u) => /\/blogs\/[^/]+\/[^/]+/.test(u.loc));
  const dates = posts.map((p) => p.lastmod).filter(Boolean).sort() as string[];
  return {
    products: productRows.map((u) => ({
      handle: decodeURIComponent(u.loc.match(/\/products\/([^/?#]+)/)![1]),
      lastmod: u.lastmod,
      title: u.title,
      images: u.images,
    })),
    pageHandles: pages
      .map((u) => u.loc.match(/\/pages\/([^/?#]+)/)?.[1]?.toLowerCase() ?? "")
      .filter(Boolean),
    collections: cols.length,
    articles: posts.length,
    lastPost: dates.length ? dates[dates.length - 1] : null,
  };
}

/* ---------------------------------------------------------------- product page (JSON-LD + SEO tags) */
function ldNodes(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(ldNodes);
  if (x["@graph"]) return [x, ...ldNodes(x["@graph"])];
  return [x];
}
const isType = (n: any, t: string) =>
  [].concat(n?.["@type"] ?? []).some((v: string) => String(v).toLowerCase() === t);

type PageInfo = {
  titleLen: number;
  descLen: number;
  h1: number;
  canonical: boolean;
  schema: boolean;
  rating: number | null;
  reviews: number;
  images: number;
  imgNoAlt: number;
  price: number | null;
  currency: string | null;
  available: boolean | null;
  brand: string;
  name: string;
};

function parsePage(html: string): PageInfo {
  const head = html.slice(0, 450_000);
  const title = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const desc =
    head.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
    head.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ??
    "";
  const imgs = (head.match(/<img\b[^>]*>/gi) ?? []).slice(0, 80);
  const noAlt = imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length;
  let prod: any = null;
  for (const m of head.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const n = ldNodes(JSON.parse(m[1])).find(
        (x) => isType(x, "product") || isType(x, "productgroup"),
      );
      if (n) {
        prod = n;
        break;
      }
    } catch {
      /* invalid JSON-LD block: ignore */
    }
  }
  const offer: any = (() => {
    const o = prod?.offers ?? prod?.hasVariant?.[0]?.offers;
    return Array.isArray(o) ? o[0] : o;
  })();
  const rating = num(prod?.aggregateRating?.ratingValue);
  return {
    titleLen: title.length,
    descLen: desc.trim().length,
    h1: (head.match(/<h1[\s>]/gi) ?? []).length,
    canonical: /<link[^>]+rel=["']canonical["']/i.test(head),
    schema: !!prod,
    rating,
    reviews: Number(prod?.aggregateRating?.reviewCount ?? prod?.aggregateRating?.ratingCount ?? 0) || 0,
    images: imgs.length,
    imgNoAlt: noAlt,
    price: num(offer?.price ?? offer?.lowPrice),
    currency: offer?.priceCurrency ?? null,
    available:
      typeof offer?.availability === "string"
        ? /instock|limitedavailability|preorder/i.test(offer.availability)
        : null,
    brand: String(prod?.brand?.name ?? prod?.brand ?? ""),
    name: String(prod?.name ?? ""),
  };
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

const median = (a: number[]) => {
  const x = [...a].sort((p, q) => p - q);
  return x.length ? x[Math.floor(x.length / 2)] : null;
};
const top = (list: string[], n = 5) => {
  const m = new Map<string, number>();
  list.filter(Boolean).forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
};

function priceBuckets(prices: number[]) {
  if (prices.length < 3) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const raw = p95 / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = Math.max(1, Math.ceil(raw / mag) * mag);
  const rows = Array.from({ length: 5 }, (_, i) => ({
    key:
      i === 4
        ? `${step * 4}+`
        : `${step * i}–${step * (i + 1)}`,
    value: 0,
  }));
  prices.forEach((p) => rows[Math.min(4, Math.floor(p / step))].value++);
  return rows.filter((r) => r.value > 0);
}

async function bestSellers(host: string, diag: Diag[]) {
  const [best, newest] = await Promise.all([
    getJson(host, "/collections/all/products.json?limit=12&sort_by=best-selling", diag),
    getJson(host, "/collections/all/products.json?limit=12&sort_by=created-descending", diag),
  ]);
  const a: any[] = best?.products ?? [];
  const b: any[] = newest?.products ?? [];
  if (!a.length) return null;
  // if the store ignored the sort, both lists are identical: then this is NOT a real ranking, so show nothing
  const same =
    b.length === a.length && a.every((p, i) => p.handle === b[i]?.handle);
  if (same) return null;
  return a.slice(0, 8).map((p) => {
    const x = fromJson(p);
    return { title: x.title, handle: x.handle, price: x.price, image: x.image, available: x.available };
  });
}


const STACK: [string, RegExp][] = [
  ["Judge.me reviews", /judge\.me|judgeme/i],
  ["Yotpo reviews", /yotpo/i],
  ["Loox reviews", /loox\.io|loox-/i],
  ["Stamped reviews", /stamped\.io/i],
  ["Okendo reviews", /okendo/i],
  ["Trustpilot", /trustpilot/i],
  ["Klaviyo email", /klaviyo/i],
  ["Mailchimp email", /mailchimp|chimpstatic/i],
  ["Omnisend email", /omnisend/i],
  ["Live chat", /tidio|gorgias|intercom|livechat|tawk\.to|zendesk|crisp\.chat/i],
  ["Shop Pay", /shop-pay|shopify-pay|shop_pay/i],
  ["Klarna", /klarna/i],
  ["Afterpay / Clearpay", /afterpay|clearpay/i],
  ["PayPal", /paypal/i],
];

export async function detectShopify(
  host: string,
  home: { html: string; shopHeader: boolean } | null,
) {
  const diag: Diag[] = [];
  const html = home?.html ?? "";
  const markedByHome =
    !!home && (home.shopHeader || /cdn\.shopify\.com|Shopify\.shop|myshopify\.com/i.test(html));
  const theme =
    html.match(/Shopify\.theme\s*=\s*\{[^}]*"name"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  let currency =
    html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null;

  const [cols, sm] = await Promise.all([
    getJson(host, "/collections.json?limit=250", diag),
    readSitemap(host, diag),
  ]);
  const colList: any[] = cols?.collections ?? [];

  // 1) /products.json   2) /collections/all/products.json   3) biggest collections
  let raw = await pagedProducts(host, "/products.json", diag);
  let source = "products.json";
  if (!raw.length) {
    raw = await pagedProducts(host, "/collections/all/products.json", diag);
    source = "collections/all";
  }
  if (!raw.length && colList.length) {
    const biggest = [...colList]
      .sort((a, b) => (b.products_count ?? 0) - (a.products_count ?? 0))
      .filter((c) => (c.products_count ?? 1) > 0)
      .slice(0, 10);
    const lists = await pool(biggest, 3, (c) =>
      getJson(host, `/collections/${encodeURIComponent(c.handle)}/products.json?limit=250`, diag),
    );
    raw = lists.flatMap((j) => j?.products ?? []);
    source = "collections";
  }
  let products = [...new Map(raw.map((p) => [String(p.id), fromJson(p)])).values()];
  let total = products.length;
  let sampled = false;

  // which product pages to open for the SEO check (same pages also fill the sample when every list is blocked)
  const smProducts = sm?.products ?? [];
  const byDate = [...smProducts].sort((a, b) => +new Date(b.lastmod ?? 0) - +new Date(a.lastmod ?? 0));
  const spread = (arr: SmProduct[], n: number) => {
    const stride = Math.max(1, Math.floor(arr.length / n));
    return arr.filter((_, i) => i % stride === 0).slice(0, n);
  };

  const spread2 = <T,>(arr: T[], n: number) => {
    const stride = Math.max(1, Math.floor(arr.length / n));
    return arr.filter((_, i) => i % stride === 0).slice(0, n);
  };

  // 4) every list is blocked: use the sitemap and a gentle, slow sample of single product files
  if (!products.length && smProducts.length) {
    total = smProducts.length;
    sampled = true;
    source = "sitemap";
    const pick = [...byDate.slice(0, 20), ...spread(byDate.slice(20), 20)];
    let fails = 0;
    const got = await pool(pick, 3, async (u) => {
      if (fails >= 6) return null; // file endpoint is closed for us: stop hitting the store
      await sleep(150);
      const j = await getJson(host, `/products/${encodeURIComponent(u.handle)}.js`, diag);
      if (!j) fails++;
      else fails = 0;
      return j ? fromJs(j, u.lastmod) : null;
    });
    products = got.filter((x): x is P => !!x);
  }

  // SEO check of real product pages (also used to fill price / stock when the lists gave nothing)
  type Pick = { handle: string; lastmod: string | null; title: string | null };
  const auditPick: Pick[] =
    products.length && !sampled
      ? spread2(
          [...products].sort((a, b) => +new Date(b.updated ?? 0) - +new Date(a.updated ?? 0)),
          16,
        ).map((p) => ({ handle: p.handle, lastmod: p.updated, title: p.title }))
      : spread(byDate, 16);
  const bestP = bestSellers(host, diag);
  let pageFails = 0;
  const pages = await pool(auditPick, 3, async (u) => {
    if (pageFails >= 5) return null;
    await sleep(150);
    const t = await getText(host, `/products/${encodeURIComponent(u.handle)}`, diag);
    if (!t) {
      pageFails++;
      return null;
    }
    pageFails = 0;
    return { u, info: parsePage(t) };
  });
  const okPages = pages.filter((x): x is { u: any; info: PageInfo } => !!x);

  // sitemap-only mode and the single files failed: fill the sample from the pages themselves
  if (sampled) {
    const have = new Set(products.map((p) => p.handle));
    for (const { u, info } of okPages) {
      if (have.has(u.handle)) continue;
      products.push({
        id: u.handle,
        title: info.name || u.title || u.handle,
        handle: u.handle,
        vendor: info.brand,
        type: "",
        tags: [],
        price: info.price,
        compareAt: null,
        available: info.available,
        published: null,
        updated: u.lastmod,
        image: null,
      });
      if (!currency && info.currency) currency = info.currency;
    }
    if (!products.length)
      products = byDate.slice(0, 20).map((u) => ({
        id: u.handle,
        title: u.title ?? u.handle,
        handle: u.handle,
        vendor: "",
        type: "",
        tags: [],
        price: null,
        compareAt: null,
        available: null,
        published: null,
        updated: u.lastmod,
        image: null,
      }));
  }

  const detected = markedByHome || colList.length > 0 || products.length > 0 || !!smProducts.length;
  const short = diag.slice(0, 14);
  if (!detected) return { detected: false, fetched: !!home };
  if (!products.length && !colList.length && !smProducts.length)
    return { detected: true, theme, currency, blocked: true, diag: short };

  if (!currency) {
    const cart = await getJson(host, "/cart.js", diag);
    currency = cart?.currency ?? null;
  }
  const best = await bestP;

  const prices = products.map((p) => p.price).filter((n): n is number => !!n);
  const monthAgo = Date.now() - 30 * 86400_000;
  const withStock = products.filter((p) => p.available !== null);
  const sortBy = (k: "published" | "updated") =>
    [...products]
      .filter((p) => p[k])
      .sort((a, b) => +new Date(b[k]!) - +new Date(a[k]!));

  // product page quality (share of the checked pages that pass each test)
  const n = okPages.length;
  const sum = (f: (i: PageInfo) => boolean) => okPages.filter((x) => f(x.info)).length;
  const imgTotal = okPages.reduce((a, x) => a + x.info.images, 0);
  const imgBad = okPages.reduce((a, x) => a + x.info.imgNoAlt, 0);
  const ratings = okPages.map((x) => x.info.rating).filter((r): r is number => !!r);
  const pageAudit = n
    ? {
        checked: n,
        tried: auditPick.length,
        metaDesc: pct(sum((i) => i.descLen >= 50), n),
        schema: pct(sum((i) => i.schema), n),
        titleOk: pct(sum((i) => i.titleLen >= 20 && i.titleLen <= 65), n),
        oneH1: pct(sum((i) => i.h1 === 1), n),
        canonical: pct(sum((i) => i.canonical), n),
        altOk: imgTotal ? Math.round(((imgTotal - imgBad) / imgTotal) * 100) : null,
        rated: pct(ratings.length, n),
        avgRating: ratings.length
          ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
          : null,
        reviews: okPages.reduce((a, x) => a + x.info.reviews, 0),
      }
    : null;

  // trust pages and policies
  const has = (re: RegExp) => (sm?.pageHandles ?? []).some((h) => re.test(h)) || re.test(htmlLinks(html));
  const trust = {
    contact: has(/contact/),
    about: has(/about|our-story|who-we-are/),
    shipping: has(/shipping|delivery/) || /\/policies\/shipping-policy/.test(html),
    returns: has(/return|refund/) || /\/policies\/refund-policy/.test(html),
    faq: has(/faq|help|questions/),
    privacy: /\/policies\/privacy-policy|\/pages\/privacy/.test(html) || has(/privacy/),
    terms: /\/policies\/terms-of-service|\/pages\/terms/.test(html) || has(/terms/),
    social: ["instagram.com", "facebook.com", "tiktok.com", "youtube.com", "x.com", "twitter.com"].filter((d) =>
      html.includes(d),
    ).length,
  };
  const stack = STACK.filter(([, re]) => re.test(html)).map(([k]) => k);
  const homeSeo = home
    ? {
        titleLen: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().length ?? 0,
        descLen:
          html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim().length ?? 0,
      }
    : null;

  return {
    detected: true,
    theme,
    currency,
    blocked: false,
    source,
    sampled,
    sampledCount: products.length,
    products: total,
    capped: !sampled && total >= 2000,
    collections: colList.length || sm?.collections || null,
    topCollections: [...colList]
      .filter((c) => (c.products_count ?? 0) > 0)
      .sort((a, b) => (b.products_count ?? 0) - (a.products_count ?? 0))
      .slice(0, 6)
      .map((c) => ({ key: String(c.title), value: Number(c.products_count) })),
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    priceMedian: median(prices),
    priceBuckets: priceBuckets(prices),
    inStock: withStock.length
      ? Math.round((withStock.filter((p) => p.available).length / withStock.length) * 100)
      : null,
    soldOut: withStock.length ? withStock.filter((p) => !p.available).length : null,
    onSale: prices.length
      ? products.filter((p) => p.compareAt && p.price && p.compareAt > p.price).length
      : null,
    updated30d: products.filter((p) => p.updated && +new Date(p.updated) > monthAgo).length,
    vendors: top(products.map((p) => p.vendor)),
    types: top(products.map((p) => p.type)),
    tags: top(products.flatMap((p) => p.tags), 8),
    newest: sortBy("published")
      .concat(sortBy("updated").filter((p) => !p.published))
      .slice(0, 5)
      .map((p) => ({
        title: p.title,
        handle: p.handle,
        date: String(p.published ?? p.updated).slice(0, 10),
      })),
    bestSellers: best,
    pageAudit,
    trust,
    stack,
    homeSeo,
    content: sm ? { articles: sm.articles, lastPost: sm.lastPost, pages: sm.pageHandles.length } : null,
    diag: short,
  };
}

/** all href values on the home page, so policy / page links can be recognised */
function htmlLinks(html: string) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((m) => m[1].toLowerCase())
    .slice(0, 600)
    .join(" ");
}