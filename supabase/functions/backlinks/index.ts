import {
  admin,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { takeQuota } from "../_shared/quota.ts";
import { clean, get, parseInput } from "../_shared/siteinfo.ts";
import {
  quickScan,
  scanPage,
  siteKey,
  type Placement,
  type Scan,
} from "../_shared/linkscan.ts";
import {
  knownLinkKeys,
  markLinksLost,
  saveLinks,
  saveSnapshot,
  savedLinks,
} from "../_shared/bank.ts";
import {
  braveEnabled,
  braveSearch,
  dataForSeo,
  dataForSeoEnabled,
  duckSearch,
  fromGitHub,
  fromHackerNews,
  fromReddit,
  fromStackExchange,
  fromWikipedia,
  normUrl,
} from "../_shared/linksources.ts";

// Backlink discovery in three small steps. One edge function call may only use ~2 s of CPU and 256 MB of memory,
// so the browser calls this function several times and shows every backlink as soon as it is confirmed:
//   action "cache"    -> last saved result (free, instant)
//   action "discover" -> FIND: Wikipedia, Hacker News, Reddit, GitHub, Stack Exchange, DuckDuckGo / Google (Serper), Brave, DataForSEO (last 3 optional).
//                        Returns the list of pages to open. Nothing is opened here.
//   action "verify"   -> VERIFY: opens up to 15 pages, finds the real links (cheerio) and gives each linking site an authority.
//   action "finish"   -> SCORE + TRACK: summary, new / lost links compared with the previous run, saves the result.
// Without DataForSEO this is a SAMPLE, not a full index. The UI says so.

const CACHE_DAYS = 7;
const MAX_VERIFY = 90;
const MAX_BATCH = 15;
const MAX_REQUESTS = 22; // web searches per run (Serper)
const MAX_REQUESTS_DDG = 14; // DuckDuckGo is slower and stricter, so fewer
const MAX_PER_DOMAIN = 2;
const MAX_PER_WIKI = 10;
const MAX_BYTES = 1_500_000;
const CPU_BUDGET_MS = 1200; // per call. After this, pages are read with the cheap regex scanner so the call never gets killed
const DEADLINE_MS = 100_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const UAS = [
  BROWSER_UA,
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];
const PLATFORMS = [
  "reddit.com",
  "medium.com",
  "quora.com",
  "github.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
  "dev.to",
];
const TLD_SWEEPS = ["edu", "gov", "org"];
const GENERIC = new Set([
  "click here",
  "here",
  "website",
  "site",
  "link",
  "visit",
  "read more",
  "more",
  "this",
  "source",
  "learn more",
  "check it out",
  "this website",
  "this site",
  "web",
  "homepage",
  "home",
  "official site",
  "official website",
  "go",
  "link here",
  "via",
  "source link",
]);
const REL_FACTOR = {
  dofollow: 1,
  ugc: 0.35,
  nofollow: 0.3,
  sponsored: 0.2,
} as const;
const PLACE_FACTOR: Record<Placement, number> = {
  content: 1,
  sidebar: 0.6,
  nav: 0.5,
  footer: 0.5,
  comment: 0.3,
};
// pages that link to hundreds of different sites pass less value per link
const outboundFactor = (n: number | null) =>
  n == null || n <= 50 ? 1 : n <= 150 ? 0.8 : 0.6;

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const publicHost = (h: string) =>
  !!h &&
  h.includes(".") &&
  !/^(\d{1,3}\.){3}\d{1,3}$/.test(h) &&
  !h.includes(":") &&
  !/(^|\.)(localhost|local|internal)$/.test(h);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serper(q: string) {
  // same request shape as the working rank checker. No quoted phrases and no "page": Serper free accounts refuse both.
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "X-API-KEY": Deno.env.get("SERPER_API_KEY") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, gl: "us", hl: "en", num: 10 }),
  });
  if (!r.ok) {
    const txt = (await r.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 160);
    throw new Error(`Serper error ${r.status}${txt ? `: ${txt}` : ""}`);
  }
  return await r.json();
}

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
        const k = i++;
        out[k] = await worker(items[k]);
      }
    }),
  );
  return out;
}

type Cand = {
  url: string;
  domain: string;
  title: string;
  position: number;
  sources: string[];
};
type Fetched = { html: string; url: string } | { fail: string };
type Checked =
  { ok: true; scan: Scan } | { ok: false; reason: string; scan: Scan | null };
type AnchorType = "brand" | "url" | "generic" | "keyword" | "image";
type Row = {
  url: string;
  domain: string;
  title: string;
  verified: boolean;
  anchor: string | null;
  anchorType: AnchorType | null;
  rel: string | null;
  links: number;
  unreachable: boolean;
  reason: string | null;
  mentioned: boolean;
  mentionKind: "url" | "brand" | null;
  authority: number | null;
  power: number | null;
  isNew: boolean;
  sources: string[];
  placement: Placement | null;
  target: string | null;
  outbound: number | null;
  wrapped: boolean;
};

async function readCapped(r: Response, max: number) {
  const reader = r.body?.getReader();
  if (!reader) return (await r.text()).slice(0, max);
  const dec = new TextDecoder();
  let out = "",
    n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    out += dec.decode(value, { stream: true });
    if (n >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out;
}

/** Opens a page like a normal browser. When a site blocks us (403, 429...) it tries again as Googlebot and as a phone. */
async function fetchPage(url: string, t0: number): Promise<Fetched> {
  let fail = "could not be opened";
  for (let i = 0; i < UAS.length; i++) {
    if (Date.now() - t0 > DEADLINE_MS) return { fail: "skipped (time limit)" };
    try {
      const r = await get(url, i === 0 ? 8000 : 6000, {
        headers: {
          "User-Agent": UAS[i],
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.google.com/",
        },
      });
      if (r.status === 404 || r.status === 410) {
        await r.body?.cancel().catch(() => {});
        return { fail: `page removed (${r.status})` };
      }
      if ([401, 403, 406, 429, 451, 503, 520, 999].includes(r.status)) {
        fail = `site blocked the check (${r.status})`;
        await r.body?.cancel().catch(() => {});
        continue;
      }
      if (!r.ok) {
        fail = `error ${r.status}`;
        await r.body?.cancel().catch(() => {});
        if (r.status >= 500) continue;
        return { fail };
      }
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      if (ct && !/html|xml|text\/plain/.test(ct)) {
        await r.body?.cancel().catch(() => {});
        return { fail: "not a web page" };
      }
      return { html: await readCapped(r, MAX_BYTES), url: r.url || url };
    } catch (e) {
      fail =
        (e as Error).name === "TimeoutError"
          ? "timed out"
          : "could not connect";
      if (i >= 1) break; // a dead or slow site will not answer the next user agent either
    }
  }
  return { fail };
}

async function verify(
  c: Cand,
  root: string,
  brand: string,
  t0: number,
  cpu: { ms: number },
): Promise<Checked> {
  const f = await fetchPage(c.url, t0);
  if ("fail" in f) return { ok: false, reason: f.fail, scan: null };
  try {
    const s = performance.now();
    // once this call has used most of its CPU budget, switch to the cheap scanner instead of risking a platform kill
    const scan =
      cpu.ms > CPU_BUDGET_MS
        ? quickScan(f.html, f.url, root, brand)
        : scanPage(f.html, f.url, root, brand);
    cpu.ms += performance.now() - s;
    return scan.best ? { ok: true, scan } : { ok: false, reason: "", scan };
  } catch {
    return { ok: false, reason: "page could not be read", scan: null };
  }
}

async function authority(roots: string[]) {
  const key = Deno.env.get("OPENPAGERANK_API_KEY");
  const map = new Map<string, number>();
  if (!key || !roots.length) return { map, used: false };
  try {
    for (let i = 0; i < roots.length; i += 100) {
      const qs = roots
        .slice(i, i + 100)
        .map((d) => `domains[]=${encodeURIComponent(d)}`)
        .join("&");
      const r = await get(
        `https://openpagerank.com/api/v1.0/getPageRank?${qs}`,
        12000,
        { headers: { "API-OPR": key, Authorization: `Bearer ${key}` } },
      );
      if (!r.ok) return { map, used: map.size > 0 };
      const j = await r.json();
      for (const row of j.response ?? [])
        if (row.status_code === 200)
          map.set(
            String(row.domain).toLowerCase(),
            Math.round(Number(row.page_rank_decimal) * 10),
          );
    }
    return { map, used: true };
  } catch {
    return { map, used: map.size > 0 };
  }
}

async function brandOf(host: string, label: string) {
  try {
    const r = await get(`https://${host}`, 8000);
    const html = (await r.text()).slice(0, 200_000);
    const title = clean(
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    );
    const parts = title
      .split(/\s[|\u2013\u2014:-]\s/)
      .map((x) => x.trim())
      .filter(Boolean);
    let name = parts.length > 1 ? parts[parts.length - 1] : title;
    if (!name || name.length > 40 || name.split(" ").length > 4)
      name = parts[0]?.length <= 40 ? parts[0] : label;
    return name.toLowerCase();
  } catch {
    return label;
  }
}

function anchorType(
  a: string,
  isImage: boolean,
  root: string,
  label: string,
  brand: string,
): AnchorType {
  if (isImage || a === "(image link)") return "image";
  const t = a.toLowerCase().trim();
  if (
    t.includes(root) ||
    /^https?:\/\//.test(t) ||
    /^www\./.test(t) ||
    /\.[a-z]{2,}(\/|$)/.test(t)
  )
    return "url";
  if (t.includes(label) || (brand.length > 2 && t.includes(brand)))
    return "brand";
  if (GENERIC.has(t) || t === "(empty)" || t === "") return "generic";
  return "keyword";
}

// ======================= DISCOVER =======================
async function discover(host: string, root: string, label: string) {
  const cands = new Map<string, Cand>();
  const found = new Set<string>();
  const notes: string[] = [];
  const sourceCounts: Record<string, number> = {};
  let requests = 0;
  const addNote = (m: string) => {
    if (!notes.includes(m)) notes.push(m);
  };
  const add = (url: string, title: string, source: string, position = 50) => {
    const d = hostOf(url);
    if (!/^https?:\/\//i.test(url) || !publicHost(d) || siteKey(d) === root)
      return false;
    const k = normUrl(url);
    const ex = cands.get(k);
    if (ex) {
      if (!ex.sources.includes(source)) ex.sources.push(source);
      ex.position = Math.min(ex.position, position);
      return false;
    }
    cands.set(k, { url, domain: d, title, position, sources: [source] });
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    return true;
  };

  // free sources that need no key: run them in the background while the web is searched
  const freeSources = Promise.all([
    fromWikipedia(root),
    fromHackerNews(root),
    fromReddit(root),
    fromGitHub(root),
    fromStackExchange(root),
  ]);

  // search engine: Google via Serper when a key exists and has credits, otherwise DuckDuckGo (free, no key)
  let serperOk = !!Deno.env.get("SERPER_API_KEY");
  let ddgOk = true;
  let ddgNext = 0;
  const ddgTurn = async () => {
    const at = Math.max(Date.now(), ddgNext);
    ddgNext = at + 1300;
    if (at > Date.now()) await sleep(at - Date.now());
  };
  const engine = async (
    q: string,
  ): Promise<{ list: { url: string; title: string }[]; source: string }> => {
    if (serperOk) {
      try {
        const j = await serper(q);
        return {
          list: ((j.organic ?? []) as any[]).map((o) => ({
            url: String(o.link ?? ""),
            title: String(o.title ?? ""),
          })),
          source: "google",
        };
      } catch (e) {
        const m = (e as Error).message;
        if (/Serper error (401|402|403)|credit/i.test(m)) {
          serperOk = false;
          addNote(
            "Serper key missing or free credits finished. DuckDuckGo is used instead.",
          );
        } else throw e;
      }
    }
    if (!ddgOk) throw new Error("no search engine available");
    await ddgTurn();
    try {
      return { list: await duckSearch(q), source: "duckduckgo" };
    } catch (e) {
      if (/captcha|error 40[29]|error 403/i.test((e as Error).message))
        ddgOk = false;
      throw e;
    }
  };
  const maxRequests = () => (serperOk ? MAX_REQUESTS : MAX_REQUESTS_DDG);
  const search = async (q: string) => {
    if (requests >= maxRequests()) return -1;
    requests++;
    try {
      const { list, source } = await engine(q);
      let fresh = 0;
      list.forEach((o, i) => {
        const d = hostOf(o.url);
        if (!publicHost(d) || siteKey(d) === root) return;
        if (!found.has(d)) {
          found.add(d);
          fresh++;
        }
        add(o.url, o.title, source, i + 1);
      });
      return fresh;
    } catch (e) {
      addNote(`${(e as Error).message} for search: ${q}`);
      return -1;
    }
  };
  const brand = await brandOf(host, label);

  // Brave (optional, paid or credit) runs in the background, one query per second as its plan requires
  const braveQs = braveEnabled()
    ? [
        `${root} -site:${root}`,
        `${brand} -site:${root}`,
        `${label} review -site:${root}`,
        ...["reddit.com", "medium.com", "quora.com", "github.com"].map(
          (p) => `${root} site:${p}`,
        ),
      ]
    : [];
  const bravePromise = (async () => {
    for (const q of braveQs) {
      try {
        for (const x of await braveSearch(q)) add(x.url, x.title, "brave");
      } catch (e) {
        addNote(`${(e as Error).message} for search: ${q}`);
        break;
      }
      await sleep(1100);
    }
  })();

  // optional real backlink index
  const indexPromise = dataForSeoEnabled()
    ? dataForSeo(root).catch((e) => {
        addNote((e as Error).message);
        return null;
      })
    : Promise.resolve(null);

  // 1. plain mention search, then "dig": exclude the domains found last, so the engine must show new ones
  await search(`${root} -site:${root}`);
  for (let round = 0; round < 4; round++) {
    const exclude = [...found]
      .slice(-8)
      .map((d) => `-site:${d}`)
      .join(" ");
    if ((await search(`${root} -site:${root} ${exclude}`)) <= 0) break;
  }
  // 2. places where links usually live: forums, blogs, code + trusted TLDs (edu / gov / org)
  const sweeps = [
    ...PLATFORMS.map((p) => `${root} site:${p}`),
    ...TLD_SWEEPS.map((t) => `${root} site:${t}`),
  ];
  for (let i = 0; i < sweeps.length; i += 4)
    await Promise.all(sweeps.slice(i, i + 4).map(search));
  // 3. brand name searches (many sites write the brand, not the web address)
  const brandQs = new Set([
    `${brand} -site:${root}`,
    `${label} -site:${root}`,
    `${brand} review -site:${root}`,
    `${label} alternatives -site:${root}`,
  ]);
  await Promise.all([...brandQs].map(search));

  const [free, idx] = await Promise.all([
    freeSources,
    indexPromise,
    bravePromise,
  ]).then(([a, b]) => [a, b] as const);
  const guaranteed = new Set<string>(); // pages where the source itself proves a link exists
  for (const c of free.flat()) {
    add(c.url, c.title, c.source, 1);
    if (["wikipedia", "hackernews", "reddit"].includes(c.source))
      guaranteed.add(normUrl(c.url));
  }
  // links saved in the data bank on earlier runs are opened again: removed links get noticed and the list keeps growing run after run
  for (const s of await savedLinks(root, 40)) add(s.source_url, "", "saved", 3);

  // pick what to open: proven links first, then pages several engines agree on, then the best ranked. Few pages per site.
  const perSite = new Map<string, number>();
  const list = [...cands.entries()]
    .map(([k, c]) => ({
      k,
      c,
      prio:
        (guaranteed.has(k) ? -100 : 0) -
        (c.sources.length - 1) * 8 +
        c.position,
    }))
    .sort((a, b) => a.prio - b.prio)
    .filter(({ c }) => {
      const key = siteKey(c.domain);
      const cap = key === "wikipedia.org" ? MAX_PER_WIKI : MAX_PER_DOMAIN;
      const n = perSite.get(key) ?? 0;
      if (n >= cap) return false;
      perSite.set(key, n + 1);
      return true;
    })
    .slice(0, MAX_VERIFY)
    .map((x) => x.c);

  return {
    root,
    host,
    label,
    brand,
    cands: list,
    pagesFound: cands.size,
    requests,
    notes,
    sourceCounts,
    indexRows: idx?.rows ?? [],
    totalBacklinks: idx?.totalBacklinks ?? null,
    totalDomains: idx?.totalDomains ?? null,
  };
}

// ======================= VERIFY (one small batch) =======================
async function verifyBatch(body: any, root: string, label: string) {
  const t0 = Date.now();
  const brand = String(body.brand ?? "")
    .slice(0, 60)
    .toLowerCase();
  const input = (Array.isArray(body.cands) ? body.cands : []).slice(
    0,
    MAX_BATCH,
  ) as Cand[];
  // the browser sends these urls, so only public http(s) pages are opened
  const list = input
    .filter(
      (c) =>
        c &&
        typeof c.url === "string" &&
        /^https?:\/\//i.test(c.url) &&
        publicHost(hostOf(c.url)) &&
        siteKey(hostOf(c.url)) !== root,
    )
    .map((c) => ({
      url: c.url,
      domain: hostOf(c.url),
      title: String(c.title ?? "").slice(0, 160),
      position: Number(c.position) || 50,
      sources: Array.isArray(c.sources)
        ? c.sources.map(String).slice(0, 6)
        : [],
    }));
  const cpu = { ms: 0 };
  const checked = await pool(list, 5, (c) => verify(c, root, brand, t0, cpu));
  const auth = await authority([
    ...new Set(list.map((c) => siteKey(c.domain))),
  ]);

  const rows: Row[] = list.map((c, i): Row => {
    const v = checked[i];
    const sc = v.scan;
    const best = v.ok ? v.scan.best! : null;
    const a = auth.map.get(siteKey(c.domain)) ?? null;
    return {
      url: c.url,
      domain: c.domain,
      title: c.title || sc?.title || "",
      verified: v.ok,
      anchor: best ? best.anchor : null,
      anchorType: best
        ? anchorType(best.anchor, best.isImage, root, label, brand)
        : null,
      rel: best?.rel ?? null,
      links: sc ? sc.links.length : 0,
      unreachable: !v.ok && !!v.reason,
      reason: !v.ok && v.reason ? v.reason : null,
      mentioned: !v.ok && (!!sc?.mentionedUrl || !!sc?.mentionedBrand),
      mentionKind: !v.ok
        ? sc?.mentionedUrl
          ? "url"
          : sc?.mentionedBrand
            ? "brand"
            : null
        : null,
      authority: a,
      power:
        best && a != null
          ? Math.round(
              a *
                REL_FACTOR[best.rel] *
                PLACE_FACTOR[best.placement] *
                outboundFactor(sc?.outbound ?? null),
            )
          : null,
      isNew: false,
      sources: c.sources,
      placement: best?.placement ?? null,
      target: best?.target ?? null,
      outbound: v.ok && sc ? sc.outbound : null,
      wrapped: !!best?.wrapped,
    };
  });
  return { rows, authorityUsed: auth.used, cpuMs: Math.round(cpu.ms) };
}

// ======================= FINISH =======================
async function finish(
  userId: string,
  host: string,
  root: string,
  label: string,
  body: any,
) {
  const brand = String(body.brand ?? label)
    .slice(0, 60)
    .toLowerCase();
  const rows: Row[] = (Array.isArray(body.rows) ? body.rows : [])
    .slice(0, 400)
    .filter(
      (r: Row) =>
        r && typeof r.url === "string" && typeof r.domain === "string",
    );
  const indexRows = (Array.isArray(body.indexRows) ? body.indexRows : []).slice(
    0,
    200,
  ) as Awaited<ReturnType<typeof dataForSeo>>["rows"];
  const notes: string[] = (Array.isArray(body.notes) ? body.notes : [])
    .map(String)
    .slice(0, 20);
  let authorityUsed = !!body.authorityUsed;

  const { data: prevRows } = await admin()
    .from("backlink_runs")
    .select("result")
    .eq("user_id", userId)
    .eq("host", host)
    .order("created_at", { ascending: false })
    .limit(1);
  const prev = (prevRows?.[0]?.result?.rows ?? []) as {
    url: string;
    domain: string;
    verified: boolean;
  }[];
  const prevVerified = new Map(
    prev.filter((r) => r.verified).map((r) => [normUrl(r.url), r]),
  );

  // rows from the real index (already known to be live links, no page fetch needed)
  if (indexRows.length) {
    const need = [
      ...new Set(
        indexRows
          .filter((x) => x.authority == null)
          .map((x) => siteKey(x.domain)),
      ),
    ];
    const extra = need.length
      ? await authority(need)
      : { map: new Map<string, number>(), used: false };
    authorityUsed =
      authorityUsed || extra.used || indexRows.some((x) => x.authority != null);
    const have = new Set(rows.map((r) => normUrl(r.url)));
    const haveDomain = new Set(
      rows.filter((r) => r.verified).map((r) => siteKey(r.domain)),
    );
    for (const x of indexRows) {
      if (
        have.has(normUrl(x.url)) ||
        haveDomain.has(siteKey(x.domain)) ||
        siteKey(x.domain) === root
      )
        continue;
      const a = x.authority ?? extra.map.get(siteKey(x.domain)) ?? null;
      rows.push({
        url: x.url,
        domain: x.domain,
        title: x.title,
        verified: true,
        anchor: x.anchor,
        anchorType: anchorType(x.anchor, x.isImage, root, label, brand),
        rel: x.rel,
        links: 1,
        unreachable: false,
        reason: null,
        mentioned: false,
        mentionKind: null,
        authority: a,
        power: a != null ? Math.round(a * REL_FACTOR[x.rel]) : null,
        isNew: false,
        sources: ["dataforseo"],
        placement: null,
        target: x.target,
        outbound: null,
        wrapped: false,
      });
    }
  }
  if (rows.length && !authorityUsed)
    notes.push(
      "Authority scores need OPENPAGERANK_API_KEY (free at openpagerank.com).",
    );
  // NEW = never saved in the link bank before (falls back to the previous run when the bank is still empty)
  const known = await knownLinkKeys(root);
  const bankOn = known.total > 0;
  rows.forEach((r) => {
    r.isNew =
      r.verified &&
      (bankOn
        ? !known.keys.has(normUrl(r.url))
        : prev.length > 0 && !prevVerified.has(normUrl(r.url)));
  });
  rows.sort(
    (x, y) =>
      Number(y.verified) - Number(x.verified) ||
      (y.power ?? -1) - (x.power ?? -1) ||
      (y.authority ?? -1) - (x.authority ?? -1),
  );

  const ver = rows.filter((r) => r.verified);
  const scored = ver.filter((r) => r.authority != null);
  const domainsVerified = new Set(ver.map((r) => siteKey(r.domain))).size;
  const avgAuthority = scored.length
    ? Math.round(
        scored.reduce((s, r) => s + (r.authority ?? 0), 0) / scored.length,
      )
    : null;
  const followShare = ver.length
    ? ver.filter((r) => r.rel === "dofollow").length / ver.length
    : 0;
  const totalDomains = Number(body.totalDomains) || null,
    totalBacklinks = Number(body.totalBacklinks) || null;
  // SEOPilot's own simple formula (not Semrush): 40% how many linking domains, 40% how strong they are, 20% share of follow links
  const domainBase = Math.max(domainsVerified, totalDomains ?? 0);
  const score = ver.length
    ? Math.round(
        0.4 * Math.min(100, domainBase * 10) +
          0.4 * (avgAuthority ?? 0) +
          0.2 * followShare * 100,
      )
    : 0;
  const anchors = { brand: 0, url: 0, generic: 0, keyword: 0, image: 0 };
  ver.forEach((r) => {
    if (r.anchorType) anchors[r.anchorType]++;
  });
  const placements: Record<string, number> = {
    content: 0,
    sidebar: 0,
    nav: 0,
    footer: 0,
    comment: 0,
  };
  ver.forEach((r) => {
    if (r.placement) placements[r.placement]++;
  });
  const pageHits = new Map<
    string,
    { url: string; links: number; domains: Set<string> }
  >();
  ver.forEach((r) => {
    if (!r.target) return;
    const k = normUrl(r.target);
    const e = pageHits.get(k) ?? {
      url: r.target,
      links: 0,
      domains: new Set<string>(),
    };
    e.links++;
    e.domains.add(siteKey(r.domain));
    pageHits.set(k, e);
  });
  const topPages = [...pageHits.values()]
    .sort((a, b) => b.links - a.links)
    .slice(0, 8)
    .map((e) => ({ url: e.url, links: e.links, domains: e.domains.size }));
  const nowVerified = new Set(ver.map((r) => normUrl(r.url)));
  // LOST = the page was opened in this run and the link (or the whole page) is gone. A saved link whose page was not opened this time
  // (the search sample differs every run) or that blocked the check is NOT counted as lost.
  const gone = rows.filter(
    (r) =>
      !r.verified &&
      (!r.unreachable || /removed/.test(r.reason ?? "")) &&
      known.keys.has(normUrl(r.url)) &&
      !known.lostKeys.has(normUrl(r.url)),
  );
  const oldLost = prev.length
    ? [...prevVerified.entries()]
        .filter(([k]) => !nowVerified.has(k))
        .slice(0, 15)
        .map(([, r]) => ({ url: r.url, domain: r.domain }))
    : [];
  const lost = bankOn
    ? gone.slice(0, 15).map((r) => ({ url: r.url, domain: r.domain }))
    : oldLost;

  const summary = {
    pagesFound: Number(body.pagesFound) || rows.length,
    domainsChecked: rows.length,
    verified: ver.length,
    linkingDomains: domainsVerified,
    mentionsOnly: rows.length - ver.length,
    unlinkedMentions: rows.filter((r) => !r.verified && r.mentioned).length,
    dofollow: ver.filter((r) => r.rel === "dofollow").length,
    nofollow: ver.filter((r) => r.rel !== "dofollow").length,
    avgAuthority,
    strong: scored.filter((r) => (r.authority ?? 0) >= 40).length,
    average: scored.filter(
      (r) => (r.authority ?? 0) >= 20 && (r.authority ?? 0) < 40,
    ).length,
    weak: scored.filter((r) => (r.authority ?? 0) < 20).length,
    score,
    anchors,
    newLinks: rows.filter((r) => r.isNew).length,
    lost: bankOn ? gone.length : lost.length,
    hasPrevious: prev.length > 0 || bankOn,
    savedLinks: known.total,
    placements,
    topPages,
    sourceCounts: (body.sourceCounts && typeof body.sourceCounts === "object"
      ? body.sourceCounts
      : {}) as Record<string, number>,
    totalBacklinks,
    totalDomains,
    blocked: rows.filter((r) => r.unreachable && /blocked/.test(r.reason ?? ""))
      .length,
  };
  const result = {
    host,
    root,
    brand,
    checkedAt: new Date().toISOString(),
    requests: Number(body.requests) || 0,
    summary,
    rows,
    lost,
    notes,
    authorityUsed,
    indexUsed: indexRows.length > 0,
  };
  const { data: saved } = await admin()
    .from("backlink_runs")
    .insert({ user_id: userId, host, result })
    .select("created_at")
    .single();
  // data bank: every verified link is saved with first seen / last seen, removed links are marked lost, and the counts become a trend line
  await Promise.allSettled([
    saveLinks(
      root,
      ver.map((r) => ({
        source_key: normUrl(r.url),
        source_url: r.url,
        source_domain: siteKey(r.domain),
        anchor: r.anchor,
        rel: r.rel,
        authority: r.authority,
        target_url: r.target,
        placement: r.placement,
      })),
    ),
    markLinksLost(
      root,
      gone.map((r) => normUrl(r.url)),
    ),
    saveSnapshot(userId, host, "all", {
      linking_domains: domainsVerified,
      verified_links: ver.length,
      link_score: score,
    }),
  ]);
  return {
    ...result,
    cached: false,
    createdAt: saved?.created_at ?? result.checkedAt,
  };
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const u = parseInput(body.url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const root = siteKey(host);
    const label = root.split(".")[0];
    const action = String(body.action ?? "cache");

    if (action === "cache") {
      const since = new Date(
        Date.now() - CACHE_DAYS * 86_400_000,
      ).toISOString();
      const { data } = await admin()
        .from("backlink_runs")
        .select("id, result, created_at")
        .eq("user_id", user.id)
        .eq("host", host)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data?.[0])
        return json({
          ...data[0].result,
          cached: true,
          createdAt: data[0].created_at,
        });
      return json({ miss: true });
    }
    if (action === "discover") {
      await takeQuota(user, "backlinks");
      return json(await discover(host, root, label));
    }
    if (action === "verify") return json(await verifyBatch(body, root, label));
    if (action === "finish")
      return json(await finish(user.id, host, root, label, body));
    throw new HttpError(400, "Unknown action");
  }),
);
