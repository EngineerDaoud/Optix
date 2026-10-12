import { handle, HttpError, json, requireUser } from "../_shared/utils.ts";
import {
  clean,
  crux,
  detectTech,
  domainAge,
  get,
  homepage,
  isShared,
  meta,
  openPageRank,
  parseInput,
  psi,
  rootDomain,
  schemaTypes,
  tranco,
} from "../_shared/siteinfo.ts";

// "Competitor / domain overview" for ANY public website, using free sources only.
// It cannot return real clicks, traffic or sales of sites you do not own (that data is private).

const STOP = new Set(
  "this that with from your have will they their about which would there been were what when where more than also into only other some such these those them then very just like over most make made many much each both here does doing being while after before under again once because without within between through during against could should shall might must can our out are was for and the not but you all any her his its who why how get got use used using new one two can't dont don't".split(
    " ",
  ),
);

function analyse(html: string, origin: string) {
  const title = clean(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  );
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
    .slice(0, 5);
  const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length;
  const body = clean(
    html.replace(
      /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi,
      " ",
    ),
  );
  const words = body.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, count]) => ({ word, count }));
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  let internal = 0,
    external = 0;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      new URL(m[1], origin).origin === origin ? internal++ : external++;
    } catch {
      /* skip */
    }
  }
  return {
    title,
    titleLength: title.length,
    description: meta(html, "description").trim(),
    descriptionLength: meta(html, "description").trim().length,
    h1s,
    h2Count,
    wordCount: words.length,
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    noindex: /noindex/i.test(meta(html, "robots")),
    lang: html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? "",
    viewport: !!meta(html, "viewport"),
    openGraph: !!meta(html, "og:title"),
    twitterCard: !!meta(html, "twitter:card"),
    schema: schemaTypes(html),
    images: imgs.length,
    imagesNoAlt: imgs.filter((i) => !/\balt=/i.test(i)).length,
    internalLinks: internal,
    externalLinks: external,
    keywords,
  };
}

async function sitemaps(origin: string) {
  let robotsOk = false;
  let found: string[] = [];
  try {
    const r = await get(`${origin}/robots.txt`, 6000);
    const txt = r.ok ? await r.text() : "";
    robotsOk = r.ok && /user-agent/i.test(txt);
    found = [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    /* ignore */
  }
  if (!found.length) found = [`${origin}/sitemap.xml`];
  let urls = 0,
    children = 0,
    ok = false;
  try {
    const r = await get(found[0], 8000);
    if (r.ok) {
      const xml = await r.text();
      if (xml.includes("<loc")) {
        ok = true;
        const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
          (m) => m[1],
        );
        if (/<sitemapindex/i.test(xml)) {
          children = locs.length;
          for (const c of locs.slice(0, 3)) {
            try {
              const cr = await get(c, 8000);
              if (cr.ok)
                urls += ((await cr.text()).match(/<loc>/gi) ?? []).length;
            } catch {
              /* skip child */
            }
          }
        } else urls = locs.length;
      }
    }
  } catch {
    /* ignore */
  }
  return {
    robotsOk,
    sitemapUrl: found[0],
    sitemapOk: ok,
    urls,
    childSitemaps: children,
    partial: children > 3,
  };
}

async function ideas(seeds: string[]) {
  const out: { seed: string; suggestions: string[] }[] = [];
  for (const seed of seeds) {
    try {
      const r = await get(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}`,
        6000,
      );
      if (!r.ok) continue;
      const j = await r.json();
      const list = (j[1] as string[])
        .filter((s) => s.toLowerCase() !== seed.toLowerCase())
        .slice(0, 8);
      if (list.length) out.push({ seed, suggestions: list });
    } catch {
      /* skip seed */
    }
  }
  return out;
}

Deno.serve(
  handle(async (req) => {
    await requireUser(req);
    const { url } = await req.json();
    const u = parseInput(url);
    const origin = u.origin;
    const host = u.hostname.replace(/^www\./, "");
    const domain = rootDomain(host);
    const shared = isShared(host);
    const notes: string[] = [];

    const [home, sm, speed, field, rank, opr, age, speedD] =
      await Promise.allSettled([
        homepage(u),
        sitemaps(origin),
        psi(u.toString()),
        crux(origin),
        shared ? Promise.resolve(null) : tranco(domain),
        shared ? Promise.resolve(null) : openPageRank(domain),
        shared ? Promise.resolve(null) : domainAge(domain),
        psi(u.toString(), "desktop"),
      ]);
    const val = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
      if (r.status === "fulfilled") return r.value;
      const msg = (r.reason as Error)?.message ?? "failed";
      if (msg === "CRUX_BLOCKED") return null; // PageSpeed field data is used instead
      notes.push(`${label}: ${msg}`);
      return null;
    };

    const speedVal = val(speed, "Speed test");
    const speedDesktopVal = val(speedD, "Desktop speed test");
    const h = val(home, "Homepage");
    if (!h)
      throw new HttpError(
        502,
        "Could not open that website. Check the address and try again.",
      );
    const page = analyse(h.html, new URL(h.finalUrl).origin);
    const ideaSeeds = page.keywords.slice(0, 3).map((k) => k.word);

    return json({
      url: u.toString(),
      finalUrl: h.finalUrl,
      host,
      domain,
      shared,
      status: h.status,
      page,
      tech: detectTech(h.html, h.headers),
      crawl: val(sm, "Sitemap"),
      speed: speedVal,
      speedDesktop: speedDesktopVal,
      field: val(field, "Real-user speed") ?? speedVal?.field ?? null,
      authority: {
        trancoRank: val(rank, "Tranco rank"),
        openPageRank: val(opr, "Open PageRank"),
      },
      age: val(age, "Domain age"),
      ideas: await ideas(ideaSeeds),
      notes,
    });
  }),
);
