import * as cheerio from "npm:cheerio@1.0.0";
import { siteKey } from "./linkscan.ts";

// Where backlink candidates come from, besides Google (Serper).
//  - Wikipedia   : free, no key. The exturlusage API lists EVERY article that links to a domain (real index, not a guess).
//  - Hacker News : free, no key. Algolia search over submitted urls.
//  - Reddit, GitHub, Stack Exchange : free, no key. Posts / READMEs / questions that carry the domain.
//  - DuckDuckGo  : free, no key. Used as the search engine when Serper has no key or its free credits are finished.
//  - Brave Search: optional (BRAVE_API_KEY, free plan 2000/month). A second, independent search index next to Google.
//  - DataForSEO  : optional (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD, pay as you go). A real backlink database, like Semrush/Ahrefs.

export type Cand = { url: string; title: string; source: string };
const WIKI_UA = "SEOPilot/1.0 (backlink checker; https://github.com/seopilot)";

/** One key per page: no www, no #hash, no tracking params, no trailing slash. */
export function normUrl(u: string) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref$|ref_)/i.test(k)) x.searchParams.delete(k);
    const path = x.pathname.replace(/\/+$/, "");
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${path}${x.search}`;
  } catch {
    return u;
  }
}

const WIKIS = ["en", "de", "fr", "es", "ar"];

/** Every Wikipedia article that links to the domain. Wikipedia stores http and https separately, and subdomains need a wildcard. */
export async function fromWikipedia(
  root: string,
  langs: string[] = WIKIS,
): Promise<Cand[]> {
  const jobs: Promise<Cand[]>[] = [];
  for (const lang of langs) {
    for (const proto of ["https", "http"]) {
      for (const q of [root, `*.${root}`]) {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=exturlusage&euquery=${encodeURIComponent(q)}&euprotocol=${proto}&eunamespace=0&eulimit=25&format=json&formatversion=2&origin=*`;
        jobs.push(
          (async () => {
            try {
              const r = await fetch(url, {
                signal: AbortSignal.timeout(9000),
                headers: { "User-Agent": WIKI_UA, "Api-User-Agent": WIKI_UA },
              });
              if (!r.ok) return [];
              const j = await r.json();
              return (
                (j?.query?.exturlusage ?? []) as {
                  title: string;
                  url: string;
                }[]
              ).map((x) => ({
                url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(x.title).replace(/ /g, "_"))}`,
                title: String(x.title),
                source: "wikipedia",
              }));
            } catch {
              return [];
            }
          })(),
        );
      }
    }
  }
  const out = new Map<string, Cand>();
  for (const list of await Promise.all(jobs))
    for (const c of list) out.set(c.url, c);
  return [...out.values()];
}

/** Hacker News stories whose submitted link is on the domain. */
export async function fromHackerNews(root: string): Promise<Cand[]> {
  try {
    const r = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(root)}&restrictSearchableAttributes=url&tags=story&hitsPerPage=30`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (
      (j.hits ?? []) as {
        objectID: string;
        title: string;
        url: string | null;
      }[]
    )
      .filter((h) => {
        try {
          return !!h.url && siteKey(new URL(h.url).hostname) === root;
        } catch {
          return false;
        }
      })
      .map((h) => ({
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: String(h.title ?? ""),
        source: "hackernews",
      }));
  } catch {
    return [];
  }
}

export const braveEnabled = () => !!Deno.env.get("BRAVE_API_KEY");
/** Brave free plan allows 1 request per second, so callers must run these one after another. */
export async function braveSearch(
  q: string,
): Promise<{ url: string; title: string }[]> {
  const key = Deno.env.get("BRAVE_API_KEY");
  if (!key) return [];
  const r = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20`,
    {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json", "X-Subscription-Token": key },
    },
  );
  if (!r.ok) throw new Error(`Brave error ${r.status}`);
  const j = await r.json();
  return ((j?.web?.results ?? []) as { url: string; title: string }[]).map(
    (x) => ({ url: x.url, title: String(x.title ?? "") }),
  );
}

export type IndexRow = {
  url: string;
  domain: string;
  title: string;
  target: string;
  anchor: string;
  isImage: boolean;
  rel: "dofollow" | "nofollow";
  authority: number | null;
};
export const dataForSeoEnabled = () =>
  !!Deno.env.get("DATAFORSEO_LOGIN") && !!Deno.env.get("DATAFORSEO_PASSWORD");

/** Real backlink index. One row per linking domain, strongest first. Also returns the total counts of the whole index. */
export async function dataForSeo(
  root: string,
): Promise<{
  rows: IndexRow[];
  totalBacklinks: number | null;
  totalDomains: number | null;
}> {
  const auth =
    "Basic " +
    btoa(
      `${Deno.env.get("DATAFORSEO_LOGIN")}:${Deno.env.get("DATAFORSEO_PASSWORD")}`,
    );
  const call = async (path: string, body: unknown) => {
    const r = await fetch(
      `https://api.dataforseo.com/v3/backlinks/${path}/live`,
      {
        method: "POST",
        signal: AbortSignal.timeout(40000),
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify([body]),
      },
    );
    if (!r.ok) throw new Error(`DataForSEO error ${r.status}`);
    const j = await r.json();
    const t = j?.tasks?.[0];
    if (t?.status_code && t.status_code >= 40000)
      throw new Error(`DataForSEO: ${t.status_message ?? t.status_code}`);
    return t?.result?.[0];
  };
  const [sum, list] = await Promise.all([
    call("summary", {
      target: root,
      include_subdomains: true,
      backlinks_status_type: "live",
    }).catch(() => null),
    call("backlinks", {
      target: root,
      mode: "one_per_domain",
      limit: 150,
      order_by: ["rank,desc"],
      include_subdomains: true,
      backlinks_status_type: "live",
    }),
  ]);
  const rows: IndexRow[] = ((list?.items ?? []) as any[])
    .filter((x) => x.url_from && x.domain_from)
    .map((x) => ({
      url: String(x.url_from),
      domain: String(x.domain_from)
        .toLowerCase()
        .replace(/^www\./, ""),
      title: String(x.page_from_title ?? ""),
      target: String(x.url_to ?? `https://${root}/`),
      anchor:
        x.item_type === "image"
          ? "(image link)"
          : String(x.anchor ?? "")
              .trim()
              .slice(0, 80) || "(empty)",
      isImage: x.item_type === "image",
      rel: x.dofollow ? "dofollow" : "nofollow",
      authority:
        typeof x.domain_from_rank === "number"
          ? Math.round(x.domain_from_rank / 10)
          : typeof x.rank === "number"
            ? Math.round(x.rank / 10)
            : null,
    }));
  return {
    rows,
    totalBacklinks: Number(sum?.backlinks ?? NaN) || null,
    totalDomains: Number(sum?.referring_domains ?? NaN) || null,
  };
}

// ---------- more free sources (no key, no payment) ----------
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const unescape = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

/** Reddit posts whose link is on the domain. Reddit sometimes refuses server addresses; then this just returns nothing. */
export async function fromReddit(root: string): Promise<Cand[]> {
  try {
    const r = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent("site:" + root)}&sort=new&limit=25&raw_json=1`,
      {
        signal: AbortSignal.timeout(9000),
        headers: {
          "User-Agent": "SEOPilot/1.0 (backlink checker)",
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (
      (j?.data?.children ?? []) as {
        data: { permalink: string; title: string; url?: string };
      }[]
    )
      .filter((c) => {
        try {
          return !!c.data.url && siteKey(new URL(c.data.url).hostname) === root;
        } catch {
          return false;
        }
      })
      .map((c) => ({
        url: `https://old.reddit.com${c.data.permalink}`,
        title: String(c.data.title ?? ""),
        source: "reddit",
      }));
  } catch {
    return [];
  }
}

/** GitHub repositories whose README mentions the domain (README links are real links on the repo page). */
export async function fromGitHub(root: string): Promise<Cand[]> {
  try {
    const r = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(root + " in:readme")}&per_page=20`,
      {
        signal: AbortSignal.timeout(9000),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "SEOPilot-backlinks",
        },
      },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (
      (j.items ?? []) as {
        html_url: string;
        full_name: string;
        description?: string;
      }[]
    ).map((x) => ({
      url: x.html_url,
      title:
        `${x.full_name}${x.description ? " - " + x.description : ""}`.slice(
          0,
          120,
        ),
      source: "github",
    }));
  } catch {
    return [];
  }
}

/** Stack Exchange questions and answers that mention the domain. */
export async function fromStackExchange(root: string): Promise<Cand[]> {
  const sites: [string, string][] = [
    ["stackoverflow", "stackoverflow.com"],
    ["webmasters", "webmasters.stackexchange.com"],
    ["superuser", "superuser.com"],
  ];
  const out = new Map<string, Cand>();
  await Promise.all(
    sites.map(async ([site, domain]) => {
      try {
        const r = await fetch(
          `https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance&q=${encodeURIComponent(root)}&site=${site}&pagesize=15`,
          { signal: AbortSignal.timeout(9000) },
        );
        if (!r.ok) return;
        const j = await r.json();
        for (const x of (j.items ?? []) as {
          question_id?: number;
          title?: string;
        }[]) {
          if (!x.question_id) continue;
          const url = `https://${domain}/questions/${x.question_id}`;
          out.set(url, {
            url,
            title: unescape(String(x.title ?? "")),
            source: "stackexchange",
          });
        }
      } catch {
        /* ignore */
      }
    }),
  );
  return [...out.values()];
}

/** DuckDuckGo web search (free, no key). It supports site: and -site:. It may refuse many fast requests, so callers space them out. */
export async function duckSearch(
  q: string,
): Promise<{ url: string; title: string }[]> {
  const r = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": BROWSER,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html",
      },
    },
  );
  if (!r.ok) throw new Error(`DuckDuckGo error ${r.status}`);
  return parseDuck(await r.text());
}
export function parseDuck(html: string): { url: string; title: string }[] {
  const $ = cheerio.load(html, {
    _useHtmlParser2: true,
  } as cheerio.CheerioOptions);
  const out: { url: string; title: string }[] = [];
  $("a.result__a").each((_, a) => {
    let href = $(a).attr("href") ?? "";
    if (href.startsWith("//")) href = "https:" + href;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const real = u.searchParams.get("uddg") ?? href;
      if (
        /^https?:\/\//i.test(real) &&
        !/(^|\.)duckduckgo\.com$/.test(new URL(real).hostname)
      )
        out.push({ url: real, title: $(a).text().replace(/\s+/g, " ").trim() });
    } catch {
      /* skip bad link */
    }
  });
  if (!out.length && /anomaly|unusual traffic|captcha/i.test(html))
    throw new Error("DuckDuckGo asked for a captcha (too many requests)");
  return out;
}