import {
  admin,
  handle,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";

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
  status: number;
  title: string;
  description: string;
  h1: number;
  imgNoAlt: number;
  canonical: boolean;
  noindex: boolean;
  links: string[];
};

async function fetchPage(url: string, origin: string): Promise<Page> {
  const empty = {
    url,
    status: 0,
    title: "",
    description: "",
    h1: 0,
    imgNoAlt: 0,
    canonical: false,
    noindex: false,
    links: [],
  };
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const type = r.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return { ...empty, status: r.status };
    const html = await r.text();
    const meta = (name: string) =>
      html.match(
        new RegExp(
          `<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`,
          "i",
        ),
      )?.[1] ??
      html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`,
          "i",
        ),
      )?.[1] ??
      "";
    const links = new Set<string>();
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      try {
        const u = new URL(m[1], url);
        if (
          u.origin === origin &&
          !SKIP_EXT.test(u.pathname) &&
          /^https?:$/.test(u.protocol)
        )
          links.add(u.origin + u.pathname + u.search);
      } catch {
        /* ignore bad hrefs */
      }
    }
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    return {
      url,
      status: r.status,
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim(),
      description: meta("description").trim(),
      h1: (html.match(/<h1[\s>]/gi) ?? []).length,
      imgNoAlt: imgs.filter((i) => !/\balt=/i.test(i)).length,
      canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
      noindex: /noindex/i.test(meta("robots")),
      links: [...links],
    };
  } catch {
    return empty;
  }
}

async function crawl(start: string, max = 25) {
  const origin = new URL(start).origin;
  const seen = new Set<string>();
  const queue = [start];
  const pages: Page[] = [];
  while (queue.length && pages.length < max) {
    const batch = queue.splice(0, 5).filter((u) => !seen.has(u));
    batch.forEach((u) => seen.add(u));
    const res = await Promise.all(batch.map((u) => fetchPage(u, origin)));
    for (const p of res) {
      pages.push(p);
      for (const l of p.links)
        if (!seen.has(l) && !queue.includes(l) && queue.length < max * 3)
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

function pageIssues(pages: Page[]): Issue[] {
  const ok = (p: Page) => p.status >= 200 && p.status < 400;
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
      id: "no-title",
      severity: "critical",
      title: "Pages without a title",
      test: (p) => ok(p) && !p.title,
    },
    {
      id: "no-desc",
      severity: "warning",
      title: "Pages without a meta description",
      test: (p) => ok(p) && !p.description,
    },
    {
      id: "no-h1",
      severity: "warning",
      title: "Pages without an H1 heading",
      test: (p) => ok(p) && p.h1 === 0,
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
      title: "Pages set to noindex",
      test: (p) => ok(p) && p.noindex,
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
      title: "Titles too long (over 60) or too short (under 25)",
      test: (p) =>
        ok(p) && !!p.title && (p.title.length > 60 || p.title.length < 25),
    },
    {
      id: "canonical",
      severity: "info",
      title: "Pages without a canonical tag",
      test: (p) => ok(p) && !p.canonical,
    },
  ];
  return rules
    .map((r) => {
      const hit = pages.filter(r.test).map((p) => p.url);
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
