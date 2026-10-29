import {
  admin,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { get, parseInput, rootDomain } from "../_shared/siteinfo.ts";
import { canon, fetchPage, hostOf, isLimited, Page } from "../_shared/analyse.ts";
import { renderEnabled } from "../_shared/render.ts";

// Full-site crawler that works in small steps, so it never hits the edge function time limit.
// The browser calls: start -> step, step, step ... until progress.done, then calls `research` with the job id.
//   phase "crawl": fetch + analyse pages, add every internal link it finds to the queue (up to max_pages)
//   phase "links": check the status of every other internal link and of external links (HEAD, then GET if blocked)

const BATCH = 8; // pages per round (keeps CPU time per request low)
// Edge functions are stopped after 2 s of CPU time (status 546, "CPU Time exceeded"). Waiting for websites is free, but
// reading the HTML of big pages (Shopify pages are often 500 KB+) is not, and it adds up over every round of one request.
// So one request does only a few rounds and the browser simply calls "step" again (a step is safe to repeat).
const MAX_PAGE_ROUNDS = 1; // page rounds per request
const MAX_LINK_ROUNDS = 3; // link-check rounds per request (status checks need very little CPU)
const LINK_BATCH = 40;
const STEP_MS = 60_000; // stop a step after this long and let the browser call again
const MAX_RENDER = 60; // JavaScript renders per crawl (they are slow and cost credits)
const MAX_EXTERNAL = 150; // external links checked per crawl
const MAX_INTERNAL_LINKS = 600; // internal URLs checked for status only (beyond the page limit)
const HARD_CAP = 2000;
const SKIP_EXT =
  /\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js|json|xml|ico|mp4|mp3|woff2?|txt|md|markdown|ya?ml|csv|rss|atom|docx?|xlsx?|pptx?|rar|gz)$/i;

type Row = {
  job_id: string;
  url: string;
  kind: "page" | "link" | "ext";
  state: string;
  depth: number;
  status?: number | null;
  page?: Page | null;
};

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
        const idx = i++;
        out[idx] = await worker(items[idx]);
      }
    }),
  );
  return out;
}

async function sitemapUrls(
  origin: string,
  isInternal: (h: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  const locsOf = (xml: string) =>
    [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
      m[1].replace(/&amp;/g, "&"),
    );
  const roots: string[] = [];
  try {
    const rb = await get(`${origin}/robots.txt`, 5000);
    if (rb.ok)
      for (const m of (await rb.text()).matchAll(/^\s*sitemap:\s*(\S+)/gim))
        roots.push(m[1]);
  } catch {
    /* use default path */
  }
  if (!roots.length) roots.push(`${origin}/sitemap.xml`);
  const seen = new Set<string>();
  const queue = roots.slice(0, 5);
  let files = 0;
  while (queue.length && files < 15 && found.length < 5000) {
    const sm = queue.shift()!;
    if (seen.has(sm) || /\.gz(\?|$)/i.test(sm)) continue;
    seen.add(sm);
    files++;
    try {
      const r = await get(sm, 10000);
      if (!r.ok) continue;
      const xml = await r.text();
      const locs = locsOf(xml);
      if (/<sitemapindex/i.test(xml)) queue.push(...locs);
      else found.push(...locs);
    } catch {
      /* skip this sitemap */
    }
  }
  return found.filter((u) => {
    const h = hostOf(u);
    return h && isInternal(h);
  });
}

async function checkOnce(url: string): Promise<number> {
  try {
    let r = await get(url, 8000, { method: "HEAD" });
    if ([400, 403, 405, 501].includes(r.status)) {
      r = await get(url, 8000, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
      });
      await r.body?.cancel();
    }
    return r.status === 206 ? 200 : r.status;
  } catch {
    return 0; // timeout, DNS failure or connection error
  }
}

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

// a 429 means the website slowed us down, not that the link is broken: wait and ask again
async function checkStatus(url: string): Promise<number> {
  let st = await checkOnce(url);
  for (const wait of [1200, 3000]) {
    if (!isLimited(st)) break;
    await nap(wait);
    st = await checkOnce(url);
  }
  return st;
}

async function loadJob(userId: string, id: string) {
  const { data } = await admin()
    .from("crawl_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Crawl not found. Start again.");
  return data as {
    id: string;
    url: string;
    final_url: string;
    host: string;
    shared: boolean;
    max_pages: number;
    render: boolean;
    phase: string;
    status: string;
    skipped: number;
    rendered: number;
  };
}

async function count(jobId: string, kinds: string[], states?: string[]) {
  let q = admin()
    .from("crawl_pages")
    .select("url", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("kind", kinds);
  if (states) q = q.in("state", states);
  const { count: n } = await q;
  return n ?? 0;
}

async function progress(job: {
  id: string;
  phase: string;
  status: string;
  skipped: number;
  rendered: number;
  max_pages: number;
}) {
  const [crawled, queued, linksDone, linksAll] = await Promise.all([
    count(job.id, ["page"], ["done"]),
    count(job.id, ["page"], ["queued", "working"]),
    count(job.id, ["link", "ext"], ["done"]),
    count(job.id, ["link", "ext"]),
  ]);
  return {
    phase: job.phase,
    done: job.status === "done",
    crawled,
    queued,
    pagesTotal: crawled + queued,
    linksChecked: linksDone,
    linksTotal: linksAll,
    rendered: job.rendered,
    skipped: job.skipped,
    maxPages: job.max_pages,
  };
}

async function insertRows(rows: Row[]) {
  const db = admin();
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await db
      .from("crawl_pages")
      .upsert(rows.slice(i, i + 400), {
        onConflict: "job_id,url",
        ignoreDuplicates: true,
      });
    if (error)
      throw new HttpError(
        500,
        `Crawl database error: ${error.message}. Run the 003_crawl.sql migration.`,
      );
  }
}

async function startLinkPhase(
  jobId: string,
  isExternalOk: (u: string) => boolean,
) {
  const db = admin();
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (let from = 0; rows.length < MAX_EXTERNAL; from += 200) {
    const { data } = await db
      .from("crawl_pages")
      .select("externalLinks:page->externalLinks")
      .eq("job_id", jobId)
      .eq("kind", "page")
      .eq("state", "done")
      .order("url")
      .range(from, from + 199);
    if (!data?.length) break;
    for (const r of data as { externalLinks: { url: string }[] | null }[]) {
      for (const l of r.externalLinks ?? []) {
        const c = canon(l.url);
        if (!c || seen.has(c) || !isExternalOk(c)) continue;
        seen.add(c);
        if (rows.length < MAX_EXTERNAL)
          rows.push({
            job_id: jobId,
            url: c,
            kind: "ext",
            state: "queued",
            depth: 0,
          });
      }
    }
    if (data.length < 200) break;
  }
  if (rows.length) await insertRows(rows);
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const db = admin();

    // ---------------- start ----------------
    if (body.action === "start") {
      const u = parseInput(body.url);
      const maxPages = Math.min(
        HARD_CAP,
        Math.max(10, Number(body.maxPages) || 300),
      );
      let home: Response;
      try {
        home = await get(u.toString(), 12000);
      } catch {
        throw new HttpError(
          502,
          "Could not open that website. Check the address and try again.",
        );
      }
      await home.body?.cancel();
      const finalUrl = home.url;
      const origin = new URL(finalUrl).origin;
      const host = new URL(finalUrl).hostname
        .toLowerCase()
        .replace(/^www\./, "");
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
      ];
      const shared = SHARED.some((s) => host === s || host.endsWith("." + s));
      const root = rootDomain(host);
      const isInternal = (h: string) =>
        shared ? h === host : rootDomain(h) === root;

      const { data: job, error } = await db
        .from("crawl_jobs")
        .insert({
          user_id: user.id,
          url: u.toString(),
          final_url: finalUrl,
          host,
          shared,
          max_pages: maxPages,
          render: body.render !== false && renderEnabled(),
        })
        .select("*")
        .single();
      if (error || !job)
        throw new HttpError(
          500,
          `Could not start the crawl: ${error?.message ?? "unknown error"}. Run the 003_crawl.sql migration.`,
        );

      const homeKey = canon(finalUrl)!;
      const seeds = [homeKey];
      for (const s of await sitemapUrls(origin, isInternal)) {
        const c = canon(s);
        if (c && !SKIP_EXT.test(new URL(c).pathname) && !seeds.includes(c))
          seeds.push(c);
      }
      const pageSeeds = seeds.slice(0, maxPages);
      await insertRows(
        pageSeeds.map((url, i) => ({
          job_id: job.id,
          url,
          kind: "page",
          state: "queued",
          depth: i === 0 ? 0 : 1,
        })),
      );
      const skipped = Math.max(0, seeds.length - pageSeeds.length);
      if (skipped)
        await db.from("crawl_jobs").update({ skipped }).eq("id", job.id);
      return json({
        job_id: job.id,
        progress: await progress({ ...job, skipped }),
      });
    }

    // ---------------- step ----------------
    if (body.action === "step") {
      const job = await loadJob(user.id, String(body.job_id ?? ""));
      if (job.status === "done")
        return json({ job_id: job.id, progress: await progress(job) });

      await db
        .from("crawl_pages")
        .update({ state: "queued" })
        .eq("job_id", job.id)
        .eq("state", "working"); // recover from an interrupted step
      const root = rootDomain(job.host);
      const isInternal = (h: string) =>
        job.shared ? h === job.host : rootDomain(h) === root;
      const t0 = Date.now();

      // every URL already known, so nothing is queued twice
      const known = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await db
          .from("crawl_pages")
          .select("url")
          .eq("job_id", job.id)
          .range(from, from + 999);
        (data ?? []).forEach((r: { url: string }) => known.add(r.url));
        if (!data || data.length < 1000) break;
      }
      let pageRows = await count(job.id, ["page"]);
      let linkRows = await count(job.id, ["link"]);
      let renderedNow = job.rendered;
      let skipped = job.skipped;

      let pageRounds = 0;
      let linkRounds = 0;
      let pageConc = 6; // lowered automatically when the website starts answering 429
      let linkConc = 10;
      while (Date.now() - t0 < STEP_MS && job.phase !== "done") {
        if (job.phase === "crawl") {
          const { data: batch } = await db
            .from("crawl_pages")
            .select("url, depth")
            .eq("job_id", job.id)
            .eq("kind", "page")
            .eq("state", "queued")
            .order("depth")
            .limit(BATCH);
          if (!batch?.length) {
            await startLinkPhase(job.id, (c) => {
              const h = hostOf(c);
              return (
                !!h && !isInternal(h) && !SKIP_EXT.test(new URL(c).pathname)
              );
            });
            job.phase = "links";
            await db
              .from("crawl_jobs")
              .update({ phase: "links", updated_at: new Date().toISOString() })
              .eq("id", job.id);
            continue;
          }
          await db
            .from("crawl_pages")
            .update({ state: "working" })
            .eq("job_id", job.id)
            .in(
              "url",
              batch.map((b: { url: string }) => b.url),
            );
          const results = await pool(
            batch as { url: string; depth: number }[],
            pageConc,
            async (row) => {
              const canRender = job.render && renderedNow < MAX_RENDER;
              const page = await fetchPage(row.url, isInternal, canRender);
              if (page.rendered) renderedNow++;
              return { row, page };
            },
          );
          const done: Row[] = [];
          const fresh: Row[] = [];
          if (results.some((x) => isLimited(x.page.status))) {
            pageConc = Math.max(2, pageConc - 2);
            await nap(2000);
          }
          for (const { row, page } of results) {
            done.push({
              job_id: job.id,
              url: row.url,
              kind: "page",
              state: "done",
              depth: row.depth,
              status: page.status,
              page,
            });
            if (page.status !== 200) continue;
            for (const link of page.internalUrls) {
              const c = canon(link);
              if (!c || known.has(c) || SKIP_EXT.test(new URL(c).pathname))
                continue;
              known.add(c);
              const crawlable = !new URL(c).search; // links with ?filters are only checked, not crawled (avoids endless crawl traps)
              if (crawlable && pageRows < job.max_pages) {
                fresh.push({
                  job_id: job.id,
                  url: c,
                  kind: "page",
                  state: "queued",
                  depth: row.depth + 1,
                });
                pageRows++;
              } else if (linkRows < MAX_INTERNAL_LINKS) {
                fresh.push({
                  job_id: job.id,
                  url: c,
                  kind: "link",
                  state: "queued",
                  depth: row.depth + 1,
                });
                linkRows++;
              } else skipped++;
            }
          }
          // update finished pages (full row), then add new URLs
          for (let i = 0; i < done.length; i += 400) {
            const { error } = await db
              .from("crawl_pages")
              .upsert(done.slice(i, i + 400), { onConflict: "job_id,url" });
            if (error)
              throw new HttpError(
                500,
                `Crawl database error: ${error.message}`,
              );
          }
          if (fresh.length) await insertRows(fresh);
          await db
            .from("crawl_jobs")
            .update({
              rendered: renderedNow,
              skipped,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          if (++pageRounds >= MAX_PAGE_ROUNDS) break; // CPU budget of this request is used: the browser calls step again
        } else {
          const { data: batch } = await db
            .from("crawl_pages")
            .select("url, kind, depth")
            .eq("job_id", job.id)
            .in("kind", ["link", "ext"])
            .eq("state", "queued")
            .limit(LINK_BATCH);
          if (!batch?.length) {
            job.phase = "done";
            job.status = "done";
            await db
              .from("crawl_jobs")
              .update({
                phase: "done",
                status: "done",
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            break;
          }
          const checked = await pool(
            batch as { url: string; kind: "link" | "ext"; depth: number }[],
            linkConc,
            async (r) => ({ r, status: await checkStatus(r.url) }),
          );
          if (checked.some((x) => isLimited(x.status))) {
            linkConc = Math.max(3, linkConc - 3);
            await nap(2000);
          }
          const rows: Row[] = checked.map(({ r, status }) => ({
            job_id: job.id,
            url: r.url,
            kind: r.kind,
            state: "done",
            depth: r.depth,
            status,
          }));
          const { error } = await db
            .from("crawl_pages")
            .upsert(rows, { onConflict: "job_id,url" });
          if (error)
            throw new HttpError(500, `Crawl database error: ${error.message}`);
          if (++linkRounds >= MAX_LINK_ROUNDS) break;
        }
      }
      return json({
        job_id: job.id,
        progress: await progress({ ...job, rendered: renderedNow, skipped }),
      });
    }

    throw new HttpError(400, "Unknown action");
  }),
);