import { useSyncExternalStore } from "react";
import { fn } from "./supabase";

// The website check (crawl -> speed -> rankings -> action plan) lives HERE, outside any page.
// So when the user opens another page (or another browser tab) while it runs, nothing stops: the crawl keeps going,
// the loading screen is still there when they come back, and the finished report is waiting for them.
// The running job is also written to localStorage, so after a page reload the crawl is picked up again where it was
// (the crawl job id is kept on the server, and its "step" call can be repeated safely).

export type Params = {
  url: string;
  country: string;
  scope: string;
  maxPages: number;
  force: boolean; // "Re-run with fresh data"
};

export type Job = {
  id: number;
  status: "running" | "done" | "error" | "cancelled";
  progress: string;
  percent: number; // 0-100, never goes backwards
  params: Params;
  startedAt: number;
  result?: any;
  cached?: boolean;
  error?: string;
};

const KEY = "optix.activeRun";
let job: Job | null = null;
let ctl: AbortController | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const patch = (id: number, p: Partial<Job>) => {
  if (!job || job.id !== id) return;
  job = { ...job, ...p };
  emit();
};

/** percent only ever goes up, so the bar never jumps back when the crawl discovers more pages */
const pct = (id: number, v: number) => {
  if (!job || job.id !== id) return;
  const n = Math.max(job.percent, Math.min(99, Math.round(v)));
  if (n !== job.percent) {
    job = { ...job, percent: n };
    emit();
  }
};

const save = (v: { params: Params; jobId?: string; startedAt: number } | null) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage not available: the check still runs, it just cannot resume after a reload */
  }
};

export const getJob = () => job;
export const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useAnalysis = () => useSyncExternalStore(subscribe, getJob, getJob);
export const isRunning = () => job?.status === "running";

/** the page calls this after it has taken the finished result / error, so it is not shown twice */
export function consumeAnalysis() {
  if (job && job.status !== "running") {
    job = null;
    emit();
  }
}

export function cancelAnalysis() {
  ctl?.abort();
}

const crawlLabel = (p: any) =>
  p.phase === "crawl"
    ? `Crawling pages: ${p.crawled} done, ${p.queued} waiting${p.rendered ? `, ${p.rendered} opened in a browser (JavaScript sites)` : ""}…`
    : `Checking links for broken pages: ${p.linksChecked} of ${p.linksTotal}…`;

// Share of the whole check: 0-5% opening the site, 5-55% crawling pages, 55-70% checking links,
// 70-98% speed + Google rankings + traffic + action plan (one long server call, so it moves with time).
const crawlPct = (p: any) => {
  if (p.phase === "crawl") {
    const total = (p.crawled ?? 0) + (p.queued ?? 0);
    return 5 + 50 * (total ? (p.crawled ?? 0) / total : 0);
  }
  const t = p.linksTotal ?? 0;
  return 55 + 15 * (t ? (p.linksChecked ?? 0) / t : 1);
};
const researchPct = (secs: number) => 70 + 28 * (1 - Math.exp(-secs / 45));

async function stepWithRetry(jobId: string, sig: AbortSignal) {
  let last: Error | null = null;
  for (let i = 0; i < 3; i++) {
    if (sig.aborted) throw new Error("cancelled");
    try {
      return await fn("crawl", { action: "step", job_id: jobId }, sig);
    } catch (err) {
      if (sig.aborted) throw err;
      last = err as Error;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last!;
}

/** Starts the full check. Does nothing if one is already running. resumeJobId continues a crawl that was already started. */
export function startAnalysis(params: Params, resumeJobId?: string) {
  if (job?.status === "running") return;
  ctl = new AbortController();
  const sig = ctl.signal;
  const startedAt = Date.now();
  const id = startedAt;
  job = { id, status: "running", progress: "", percent: 1, params, startedAt };
  save({ params, startedAt });
  emit();
  void (async () => {
    try {
      const { url, country, scope, maxPages, force } = params;
      const body = { url, country, depth: 10, scope };
      let jobId = resumeJobId;
      if (!jobId) {
        if (!force) {
          patch(id, { progress: "Looking for a recent saved report…" });
          const c = await fn("research", { ...body, cacheOnly: true }, sig);
          if (!c.miss) {
            save(null);
            patch(id, { status: "done", result: c, cached: true, progress: "", percent: 100 });
            return;
          }
        }
        patch(id, { progress: "Opening the website and reading its sitemap…" });
        pct(id, 2);
        const s = await fn("crawl", { action: "start", url, maxPages }, sig);
        jobId = s.job_id as string;
        save({ params, jobId, startedAt });
        let p = s.progress;
        while (!p.done) {
          patch(id, { progress: crawlLabel(p) });
          pct(id, crawlPct(p));
          p = (await stepWithRetry(jobId, sig)).progress;
        }
      } else {
        // continuing after a reload: repeat the step call until the crawl says it is done
        patch(id, { progress: "Continuing the crawl where it stopped…" });
        let p = (await stepWithRetry(jobId, sig)).progress;
        while (!p.done) {
          patch(id, { progress: crawlLabel(p) });
          pct(id, crawlPct(p));
          p = (await stepWithRetry(jobId, sig)).progress;
        }
      }
      pct(id, 70);
      patch(id, {
        progress:
          "Checking speed and Google rankings, then analysing traffic by country and preparing the action plan…",
      });
      // fresh = the "Re-run with fresh data" button: skip the saved Google results and keyword numbers in the data bank as well
      // This is one long server call without steps, so the bar creeps forward with time while it runs.
      const tStart = Date.now();
      const tick = setInterval(
        () => pct(id, researchPct((Date.now() - tStart) / 1000)),
        1000,
      );
      let r: any;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            r = await fn(
              "research",
              { ...body, force: true, fresh: force, job_id: jobId },
              sig,
            );
            break;
          } catch (err) {
            // "out of time or memory" (546): the server keeps the Google results it already fetched, so the next try is lighter
            const m = (err as Error).message ?? "";
            if (sig.aborted || attempt >= 2 || !/546|out of time|memory/i.test(m))
              throw err;
            patch(id, {
              progress: "The server was busy. Trying again with the saved results…",
            });
            await new Promise((res) => setTimeout(res, 3000));
          }
        }
      } finally {
        clearInterval(tick);
      }
      save(null);
      patch(id, { status: "done", result: r, cached: false, progress: "", percent: 100 });
    } catch (err) {
      save(null);
      if (sig.aborted) patch(id, { status: "cancelled", progress: "" });
      else
        patch(id, {
          status: "error",
          error: (err as Error).message,
          progress: "",
        });
    }
  })();
}

/** Called once when the app opens: picks up a check that was running when the page was closed or reloaded. */
export function resumeAnalysis() {
  if (job) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { params?: Params; jobId?: string; startedAt?: number };
    // a run older than 3 hours is abandoned
    if (!v.params || !v.startedAt || Date.now() - v.startedAt > 3 * 3600_000) {
      save(null);
      return;
    }
    startAnalysis(v.params, v.jobId);
  } catch {
    save(null);
  }
}