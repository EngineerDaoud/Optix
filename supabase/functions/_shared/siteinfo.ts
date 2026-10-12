import { HttpError } from "./utils.ts";

// Shared helpers for the overview and research functions (free data sources only).

export const UA = "Mozilla/5.0 (compatible; SEOPilotBot/1.0)";
export const SHARED_HOSTS = [
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
];
const SLD = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
export const isShared = (host: string) =>
  SHARED_HOSTS.some((s) => host === s || host.endsWith("." + s));

export const get = async (url: string, ms = 10000, init: RequestInit = {}) =>
  await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
    ...init,
    headers: { "User-Agent": UA, ...(init.headers ?? {}) },
  });

export function rootDomain(host: string) {
  const p = host.split(".");
  if (p.length >= 3 && p[p.length - 1].length === 2 && SLD.has(p[p.length - 2]))
    return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

export function parseInput(raw: string) {
  let s = String(raw ?? "").trim();
  if (!s) throw new HttpError(400, "Enter a website address");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, "That does not look like a website address");
  }
  const h = u.hostname.toLowerCase();
  if (
    !/^https?:$/.test(u.protocol) ||
    !h.includes(".") ||
    h.includes(":") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(h) ||
    /(^|\.)(localhost|local|internal)$/.test(h)
  ) {
    throw new HttpError(
      400,
      "Enter a public website address, like example.com",
    );
  }
  return u;
}

export const meta = (html: string, name: string) =>
  html.match(
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
  )?.[1] ??
  html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      "i",
    ),
  )?.[1] ??
  "";

export const clean = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function schemaTypes(html: string) {
  const out = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      const t = o["@type"];
      if (typeof t === "string") out.add(t);
      else if (Array.isArray(t))
        t.forEach((x) => typeof x === "string" && out.add(x));
      Object.values(o).forEach(walk);
    }
  };
  for (const m of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* ignore bad json-ld */
    }
  }
  return [...out].slice(0, 12);
}

export function detectTech(html: string, h: Headers) {
  const t: string[] = [];
  const add = (name: string, cond: boolean) => cond && t.push(name);
  add("Shopify", /cdn\.shopify\.com|Shopify\.theme/i.test(html));
  add("WordPress", /wp-content|wp-includes/i.test(html));
  add("WooCommerce", /woocommerce/i.test(html));
  add("Wix", /wixstatic\.com|wix\.com/i.test(html));
  add("Squarespace", /squarespace/i.test(html));
  add("Webflow", /webflow/i.test(html));
  add("Magento", /Magento|mage\//i.test(html));
  add("Next.js", /__NEXT_DATA__|\/_next\//i.test(html));
  add("Nuxt", /__NUXT__|\/_nuxt\//i.test(html));
  add(
    "React",
    /data-reactroot|react/i.test(html) && /<div id=["']root["']/i.test(html),
  );
  add("Vercel", !!h.get("x-vercel-id"));
  add(
    "Cloudflare",
    !!h.get("cf-ray") || /cloudflare/i.test(h.get("server") ?? ""),
  );
  add("Google Analytics 4", /gtag\/js\?id=G-|G-[A-Z0-9]{6,}/.test(html));
  add("Google Tag Manager", /googletagmanager\.com\/gtm\.js/i.test(html));
  add("Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents/i.test(html));
  add("Microsoft Clarity", /clarity\.ms/i.test(html));
  add("Hotjar", /static\.hotjar\.com/i.test(html));
  const gen = meta(html, "generator");
  if (gen) t.push(`Generator: ${gen.slice(0, 40)}`);
  return t;
}

export async function homepage(u: URL) {
  const r = await get(u.toString(), 12000);
  const ct = r.headers.get("content-type") ?? "";
  const finalUrl = r.url;
  if (!ct.includes("text/html"))
    return { status: r.status, finalUrl, html: "", headers: r.headers };
  return {
    status: r.status,
    finalUrl,
    html: (await r.text()).slice(0, 1_500_000),
    headers: r.headers,
  };
}

export async function psi(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
) {
  const key =
    Deno.env
      .get("PAGESPEED_API_KEY")
      ?.trim()
      .replace(/^["']|["']$/g, "") || undefined;
  const build = (cats: string[]) => {
    const qs = new URLSearchParams({ url, strategy });
    cats.forEach((c) => qs.append("category", c));
    if (key) qs.set("key", key);
    return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`;
  };
  // PageSpeed can take 40 to 90 seconds on heavy sites. Try all 4 categories first; if that times out or is busy, ask for two lighter halves in parallel.
  const ALL = ["performance", "seo", "accessibility", "best-practices"];
  const call = async (cats: string[], ms: number) => {
    const r = await get(build(cats), ms);
    const body = await r.json();
    return { ok: r.ok, status: r.status, body };
  };
  let j: any = null;
  let lastErr = "PageSpeed request failed";
  const noteErr = (status: number, body: any) => {
    lastErr = body?.error?.message ?? `PageSpeed error ${status}`;
    if (status === 429)
      lastErr =
        "PageSpeed rate limit reached. Add PAGESPEED_API_KEY or wait a minute.";
    if (status === 403)
      lastErr = `Google refused the PageSpeed key: ${lastErr}. In Google Cloud turn on "PageSpeed Insights API" for this key's project and set the key restriction to None (or an API restriction that includes PageSpeed Insights API).`;
  };
  const timeoutMsg = (e: unknown) => {
    const m = String((e as Error)?.message ?? "");
    return /abort|timed? ?out|signal/i.test(m)
      ? "PageSpeed took too long for this site (it timed out twice). Press Re-run, or test the page at pagespeed.web.dev."
      : m;
  };
  // 1) all four categories in one request
  let fatal = false;
  try {
    const a = await call(ALL, 50000);
    if (a.ok) j = a.body;
    else {
      noteErr(a.status, a.body);
      fatal = a.status === 400 || a.status === 403;
    } // bad key or unreachable page: retrying will not help
    if (!j && !fatal) await new Promise((r) => setTimeout(r, 1500)); // a busy answer (429 / 5xx): short pause before the retry
  } catch (e) {
    lastErr = timeoutMsg(e);
  }
  if (fatal) throw new Error(lastErr);
  // 2) it timed out or was busy: ask for two lighter requests in parallel. PERFORMANCE alone goes first on its own, because that is the
  //    Speed score and the Core Web Vitals; the other three categories come in the second request. If only one answers, its scores are still shown.
  if (!j) {
    const [p1, p2] = await Promise.allSettled([
      call(["performance"], 38000),
      call(["seo", "accessibility", "best-practices"], 38000),
    ]);
    const ok1 = p1.status === "fulfilled" && p1.value.ok ? p1.value.body : null;
    const ok2 = p2.status === "fulfilled" && p2.value.ok ? p2.value.body : null;
    if (ok1 && ok2) {
      j = ok1;
      j.lighthouseResult.categories = {
        ...ok2.lighthouseResult.categories,
        ...ok1.lighthouseResult.categories,
      };
      j.lighthouseResult.audits = {
        ...ok2.lighthouseResult.audits,
        ...ok1.lighthouseResult.audits,
      };
    } else if (ok1 || ok2) {
      j = ok1 ?? ok2;
    } else {
      const bad = [p1, p2].find(
        (p) => p.status === "fulfilled" && !p.value.ok,
      ) as
        | PromiseFulfilledResult<{ ok: boolean; status: number; body: any }>
        | undefined;
      if (bad) noteErr(bad.value.status, bad.value.body);
      else if (p1.status === "rejected") lastErr = timeoutMsg(p1.reason);
    }
  }
  if (!j) throw new Error(lastErr);
  const lh = j.lighthouseResult;
  // a category that was not tested (e.g. the retry only asked for some) is null, shown as a dash, never as a fake 0
  const s = (k: string): number | null =>
    lh.categories[k]?.score == null
      ? null
      : Math.round(lh.categories[k].score * 100);
  const a = lh.audits;
  const num = (id: string) =>
    typeof a[id]?.numericValue === "number"
      ? (a[id].numericValue as number)
      : null;

  // what to fix: time-saving opportunities, plus failed checks from every category
  const opportunities = Object.values(a as Record<string, any>)
    .filter(
      (x) =>
        x?.details?.type === "opportunity" &&
        (x.details.overallSavingsMs ?? 0) > 0,
    )
    .sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs)
    .slice(0, 8)
    .map((x) => ({
      id: x.id as string,
      title: x.title as string,
      displayValue: (x.displayValue ?? "") as string,
      savingsMs: Math.round(x.details.overallSavingsMs),
    }));
  const catOf: Record<string, string> = {};
  for (const [cat, label] of [
    ["performance", "Performance"],
    ["seo", "SEO"],
    ["accessibility", "Accessibility"],
    ["best-practices", "Best practices"],
  ]) {
    for (const ref of lh.categories[cat]?.auditRefs ?? [])
      if (!catOf[ref.id]) catOf[ref.id] = label;
  }
  const failed = Object.values(a as Record<string, any>)
    .filter(
      (x) =>
        catOf[x?.id] &&
        typeof x.score === "number" &&
        x.score < 0.9 &&
        ["binary", "numeric", "metricSavings"].includes(x.scoreDisplayMode),
    )
    .sort((x, y) => x.score - y.score)
    .slice(0, 14)
    .map((x) => ({
      id: x.id as string,
      title: x.title as string,
      displayValue: (x.displayValue ?? "") as string,
      category: catOf[x.id],
    }));

  // Real-user data also comes back inside the PageSpeed answer, so it works even when the CrUX API is blocked for the key.
  const fm = (j.loadingExperience?.metrics ??
    j.originLoadingExperience?.metrics ??
    {}) as Record<string, { percentile?: number }>;
  const fp = (k: string) =>
    typeof fm[k]?.percentile === "number" ? fm[k].percentile! : null;
  const field =
    fp("LARGEST_CONTENTFUL_PAINT_MS") != null ||
    fp("INTERACTION_TO_NEXT_PAINT") != null
      ? {
          lcp: fp("LARGEST_CONTENTFUL_PAINT_MS"),
          cls:
            fp("CUMULATIVE_LAYOUT_SHIFT_SCORE") != null
              ? fp("CUMULATIVE_LAYOUT_SHIFT_SCORE")! / 100
              : null,
          inp: fp("INTERACTION_TO_NEXT_PAINT"),
        }
      : null;

  return {
    field,
    scores: {
      performance: s("performance"),
      seo: s("seo"),
      accessibility: s("accessibility"),
      bestPractices: s("best-practices"),
    },
    vitals: {
      lcp: num("largest-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbt: num("total-blocking-time"),
      fcp: num("first-contentful-paint"),
      speedIndex: num("speed-index"),
    },
    opportunities,
    failed,
  };
}

export async function crux(origin: string) {
  const key =
    Deno.env
      .get("PAGESPEED_API_KEY")
      ?.trim()
      .replace(/^["']|["']$/g, "") || undefined;
  if (!key) return null;
  const r = await get(
    `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${key}`,
    10000,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor: "PHONE" }),
    },
  );
  if (r.status === 404) return null; // not enough real-user data for this site
  const j = await r.json();
  if (!r.ok) {
    const msg = String(j.error?.message ?? "CrUX request failed");
    if (
      /blocked|not enabled|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED/i.test(msg)
    ) {
      throw new Error("CRUX_BLOCKED"); // handled quietly by the caller: PageSpeed already returns the same real-user data
    }
    throw new Error(msg);
  }
  const m = j.record?.metrics ?? {};
  const p75 = (k: string) =>
    m[k]?.percentiles?.p75 != null ? Number(m[k].percentiles.p75) : null;
  return {
    lcp: p75("largest_contentful_paint"),
    cls: p75("cumulative_layout_shift"),
    inp: p75("interaction_to_next_paint"),
  };
}

export async function tranco(domain: string) {
  const r = await get(
    `https://tranco-list.eu/api/ranks/domain/${domain}`,
    8000,
  );
  if (!r.ok) return null;
  const j = await r.json();
  const rank = j.ranks?.[0]?.rank;
  return typeof rank === "number" ? rank : null;
}

export async function openPageRank(domain: string) {
  const key = Deno.env.get("OPENPAGERANK_API_KEY");
  if (!key) return null;
  const r = await get(
    `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`,
    8000,
    { headers: { "API-OPR": key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return null;
  const j = await r.json();
  const row = j.response?.[0];
  return row?.status_code === 200
    ? {
        score: row.page_rank_decimal as number,
        rank: row.rank ? Number(row.rank) : null,
      }
    : null;
}

export async function domainAge(domain: string) {
  try {
    const r = await get(`https://rdap.org/domain/${domain}`, 8000);
    if (r.ok) {
      const j = await r.json();
      const ev = (j.events ?? []).find(
        (e: { eventAction: string }) => e.eventAction === "registration",
      );
      if (ev?.eventDate)
        return {
          since: String(ev.eventDate).slice(0, 10),
          source: "domain registry",
        };
    }
  } catch {
    /* fall through to archive */
  }
  const r = await get(
    `https://archive.org/wayback/available?url=${domain}&timestamp=19960101`,
    8000,
  );
  const j = await r.json();
  const ts = j.archived_snapshots?.closest?.timestamp as string | undefined;
  return ts
    ? {
        since: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
        source: "first web archive copy",
      }
    : null;
}

/** Full domain record from the public RDAP registry plus a DNS lookup. Free, no key. */
export async function domainDetails(domain: string) {
  const out: {
    registered: string | null;
    expires: string | null;
    updated: string | null;
    registrar: string | null;
    nameservers: string[];
    status: string[];
    ip: string | null;
    ipCount: number;
  } = {
    registered: null,
    expires: null,
    updated: null,
    registrar: null,
    nameservers: [],
    status: [],
    ip: null,
    ipCount: 0,
  };
  const [rd, dns] = await Promise.allSettled([
    get(`https://rdap.org/domain/${domain}`, 9000).then((r) =>
      r.ok ? r.json() : null,
    ),
    get(`https://dns.google/resolve?name=${domain}&type=A`, 6000).then((r) =>
      r.ok ? r.json() : null,
    ),
  ]);
  const j: any = rd.status === "fulfilled" ? rd.value : null;
  if (j) {
    const ev = (a: string) =>
      (j.events ?? []).find((e: { eventAction: string }) => e.eventAction === a)
        ?.eventDate;
    const d = (x?: string) => (x ? String(x).slice(0, 10) : null);
    out.registered = d(ev("registration"));
    out.expires = d(ev("expiration"));
    out.updated = d(ev("last changed"));
    out.nameservers = (j.nameservers ?? [])
      .map((n: { ldhName?: string }) => String(n.ldhName ?? "").toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    out.status = (j.status ?? []).slice(0, 6);
    const reg = (j.entities ?? []).find((e: { roles?: string[] }) =>
      e.roles?.includes("registrar"),
    );
    const fn = reg?.vcardArray?.[1]?.find((x: unknown[]) => x[0] === "fn")?.[3];
    out.registrar = typeof fn === "string" ? fn : null;
  }
  const dj: any = dns.status === "fulfilled" ? dns.value : null;
  const ips = (dj?.Answer ?? [])
    .filter((a: { type: number }) => a.type === 1)
    .map((a: { data: string }) => a.data);
  out.ip = ips[0] ?? null;
  out.ipCount = ips.length;
  return out;
}
