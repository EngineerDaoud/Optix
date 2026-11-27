import { admin, handle, HttpError, json, requireUser } from "../_shared/utils.ts";
import { takeQuota } from "../_shared/quota.ts";
import { claude, setAiDeadline } from "../_shared/ai.ts";
import {
  aiReadiness,
  ask,
  setAskDeadline,
  availableEngines,
  buildTips,
  cleanBrand,
  detect,
  ENGINES,
  EngineId,
  Hit,
  INTENTS,
  Intent,
  cleanQuestions,
  knowsBrand,
  pickShown,
  templatePrompts,
  topDomains,
} from "../_shared/aivis.ts";
import {
  clean,
  homepage,
  isShared,
  meta,
  parseInput,
  rootDomain,
  schemaTypes,
} from "../_shared/siteinfo.ts";

// AI Visibility for any public site, free sources only (see _shared/aivis.ts for how it works).
// Body: { url, keywords?: string[], brand?: string, force?: boolean, cached_only?: boolean }
// One run = about 12 questions x up to 3 engines (set AIVIS_PROMPTS, 3-24). All of them count in the score and are
// saved, but the response marks only a handful as `show` so the screen stays short. Saved for 24 h.

const CACHE_HOURS = 24;
const BUDGET_MS = 105_000; // edge functions die at about 150 s: stop starting new questions here...
const HARD_MS = 125_000; // ...and no single model call may run past this

function guessBrand(html: string, host: string) {
  const site = clean(meta(html, "og:site_name") ?? "");
  if (site && site.length <= 40) return site;
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const parts = title
    .split(/\s*[|–—•:·-]\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 30);
  // the brand is usually the short piece of the title, and often the one that looks like the domain name
  const sld = host.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const like = parts.find((p) =>
    p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(sld),
  );
  if (like) return like;
  const sldName = host.split(".")[0].replace(/[-_]+/g, " ");
  return sldName.replace(/\b\w/g, (c) => c.toUpperCase());
}

function pageTopics(html: string) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const desc = clean(meta(html, "description") ?? "");
  const h1 = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  return { title, desc, h1 };
}

const SHOWN = 5; // questions listed on the screen; the rest still count in every number

async function makePrompts(
  brand: string,
  domain: string,
  topics: string[],
  page: { title: string; desc: string; h1: string },
  n: number,
): Promise<{ q: string; intent: Intent }[]> {
  let list: { q: string; intent: Intent }[] = [];
  try {
    setAiDeadline(Date.now() + 25_000);
    const out = await claude(
      "You write the questions real customers type into ChatGPT, Gemini or Google AI. Reply with JSON only.",
      `A website: ${domain} (brand: ${brand}).\nTitle: ${page.title}\nDescription: ${page.desc}\nMain heading: ${page.h1}\nKeywords: ${topics.join(", ")}\n\n` +
        `Write ${n + 4} different questions a potential customer would ask an AI assistant when looking for what this website offers. ` +
        `Give each one an intent: "best" (best/top lists), "choose" (how to choose, what to look for), "compare" (X vs Y, alternatives), ` +
        `"price" (cost, cheap, value, where to buy), "problem" (a problem to solve or a mistake to avoid). Use a spread of all five intents. ` +
        `Each is ONE complete question in natural, correct English, 6-18 words, starting with a capital letter and ending with "?". ` +
        `Cover different products, needs and buyer types, not the same question reworded. ` +
        `NEVER include the brand name or the domain. ` +
        `JSON: {"prompts":[{"q":"...","intent":"best"}]}`,
      1600,
      { json: true },
    );
    const j = JSON.parse(out.replace(/```json|```/g, "").trim());
    list = cleanQuestions(
      (j.prompts as unknown[]).map((p) =>
        typeof p === "string" ? { q: p } : (p as { q: unknown; intent?: unknown }),
      ),
      brand,
      domain,
      n,
    );
  } catch {
    /* no key, or the model failed: fall back to templates */
  } finally {
    setAiDeadline(0);
  }
  // too few good ones: top up from templates (also de-duplicated and cleaned)
  if (list.length < n) {
    const more = cleanQuestions(
      [...list, ...templatePrompts(topics, n * 2)],
      brand,
      domain,
      n,
    );
    if (more.length > list.length) list = more;
  }
  return list.slice(0, n);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pool<T>(items: T[], size: number, worker: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const x = items[i++];
        await worker(x);
      }
    }),
  );
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const u = parseInput(body.url);
    const host = u.hostname.replace(/^www\./, "");
    // shared addresses (myshopify.com, vercel.app...) must be matched as the full host, or every store on them would look the same
    const domain = isShared(host) ? host : rootDomain(host);
    const db = admin();

    // 1) saved result (free)
    const since = new Date(Date.now() - CACHE_HOURS * 3600_000).toISOString();
    const { data: saved } = await db
      .from("ai_visibility_runs")
      .select("result, created_at")
      .eq("user_id", user.id)
      .eq("host", host)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (body.cached_only)
      return json(saved ? { ...saved.result, ranAt: saved.created_at, cached: true } : null);
    if (saved && !body.force && saved.created_at > since)
      return json({ ...saved.result, ranAt: saved.created_at, cached: true });

    const engines = availableEngines();
    if (!engines.length)
      throw new HttpError(
        400,
        "No AI key is set. Add GEMINI_API_KEY (free, aistudio.google.com) and optionally GROQ_API_KEY (free, console.groq.com) to Supabase secrets.",
      );
    await takeQuota(user, "aivis");

    const t0 = Date.now();
    setAskDeadline(t0 + HARD_MS);
    const timeLeft = () => BUDGET_MS - (Date.now() - t0);

    // 2) the site itself: brand, topics, schema, AI crawler access
    let html = "";
    let origin = u.origin;
    try {
      const h = await homepage(u);
      html = h.html;
      origin = new URL(h.finalUrl).origin;
    } catch {
      /* site did not open: we can still ask the AIs about the domain */
    }
    const brand = cleanBrand(
      String(body.brand ?? "").trim() || guessBrand(html, host),
    );
    const page = pageTopics(html);
    const kw = ((body.keywords as string[]) ?? [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 8);
    const topics = kw.length
      ? kw
      : [page.h1, page.title.split(/\s*[|–—-]\s*/)[0]].filter(Boolean);
    const nPrompts = Math.max(
      3,
      Math.min(24, Number(Deno.env.get("AIVIS_PROMPTS") ?? 12)),
    );

    const [prompts, readiness] = await Promise.all([
      makePrompts(brand, domain, topics, page, nPrompts),
      aiReadiness(origin, schemaTypes(html)).catch(() => null),
    ]);
    if (!prompts.length)
      throw new HttpError(
        422,
        "Could not work out what this site is about. Pass some keywords or try a site with readable text.",
      );
    const brandQ = `What is ${brand} (${domain})? Tell me what they do and whether they are a good choice. If you do not know it, say so.`;

    // 3) ask every engine every question
    type Task = { engine: EngineId; qi: number; q: string; isBrand: boolean };
    const tasks: Task[] = [];
    for (const e of engines) {
      prompts.forEach((p, qi) => tasks.push({ engine: e, qi, q: p.q, isBrand: false }));
      tasks.push({ engine: e, qi: -1, q: brandQ, isBrand: true });
    }
    const cell: Record<string, Hit> = {}; // `${engine}:${qi}`
    const known: Partial<Record<EngineId, boolean>> = {};
    const errors: Partial<Record<EngineId, string>> = {};
    const skipped = { n: 0 };
    const retry: Task[] = [];

    const runTask = async (t: Task, second: boolean) => {
      if (timeLeft() < 8000) {
        if (!second) skipped.n++;
        return;
      }
      try {
        const raw = await ask(t.engine, t.q);
        if (t.isBrand) known[t.engine] = knowsBrand(raw, brand, domain);
        else
          cell[`${t.engine}:${t.qi}`] = {
            ok: true,
            ...detect(raw, brand, domain, ENGINES[t.engine].web),
          };
      } catch (err) {
        const msg = String((err as Error)?.message ?? "failed").slice(0, 160);
        errors[t.engine] = msg;
        if (!second) retry.push(t);
        if (!t.isBrand && !cell[`${t.engine}:${t.qi}`])
          cell[`${t.engine}:${t.qi}`] = {
            ok: false,
            error: msg,
            mentioned: false,
            match: null,
            cited: false,
            cites: [],
            snippet: "",
          };
      }
    };

    // each engine has its own small queue, so one slow or limited engine does not block the others
    const size = (e: EngineId) =>
      e === "google"
        ? 3
        : e === "open"
          ? Math.max(1, Number(Deno.env.get("AIVIS_GROQ_PARALLEL") ?? 1))
          : 4;
    await Promise.all(
      engines.map((e) =>
        pool(
          tasks.filter((t) => t.engine === e),
          size(e),
          (t) => runTask(t, false),
        ),
      ),
    );
    // second chance for every question that failed (busy model, short rate limit): slower and gentler
    if (retry.length && timeLeft() > 20_000) {
      await sleep(3000);
      await Promise.all(
        engines.map((e) =>
          pool(
            retry.filter((t) => t.engine === e),
            1,
            (t) => runTask(t, true),
          ),
        ),
      );
    }

    // 4) numbers
    const rows = engines.map((e) => {
      const hits = prompts
        .map((_, qi) => cell[`${e}:${qi}`])
        .filter((h): h is Hit => !!h && h.ok);
      const mentions = hits.filter((h) => h.mentioned).length;
      const citations = hits.filter((h) => h.cited).length;
      const present = hits.filter((h) => h.mentioned || h.cited).length;
      return {
        id: e,
        label: ENGINES[e].label,
        note: ENGINES[e].note,
        web: ENGINES[e].web,
        asked: hits.length,
        mentions,
        citations,
        rate: hits.length ? Math.round((present / hits.length) * 100) : null,
        brandKnown: known[e] ?? null,
        failed: prompts.length - hits.length,
        error:
          prompts.length - hits.length > 0
            ? (errors[e] ?? "Skipped (time limit)")
            : null,
      };
    });
    const live = rows.filter((r) => r.asked > 0);
    const score = live.length
      ? Math.round(live.reduce((a, r) => a + (r.rate ?? 0), 0) / live.length)
      : 0;
    const citesAll = prompts.flatMap((_, qi) =>
      engines
        .filter((e) => ENGINES[e].web)
        .map((e) => cell[`${e}:${qi}`]?.cites ?? []),
    );

    // one row per question: every engine's verdict
    const promptRows = prompts.map((p, qi) => ({
      q: p.q,
      intent: p.intent,
      results: Object.fromEntries(
        engines.map((e) => {
          const h = cell[`${e}:${qi}`];
          return [
            e,
            h
              ? {
                  ok: h.ok,
                  mentioned: h.mentioned,
                  cited: h.cited,
                  match: h.match,
                  snippet: h.snippet,
                }
              : null,
          ];
        }),
      ) as Record<string, { ok: boolean; mentioned: boolean; cited: boolean; match: "domain" | "brand" | null; snippet: string } | null>,
    }));
    const shown = pickShown(promptRows, SHOWN);
    // per kind of question: how often the site appears (answered cells only)
    const intentStats = [...INTENTS, "other" as Intent]
      .map((intent) => {
        const cells = promptRows
          .filter((r) => r.intent === intent)
          .flatMap((r) => Object.values(r.results))
          .filter((c): c is NonNullable<typeof c> => !!c && c.ok);
        const present = cells.filter((c) => c.mentioned || c.cited).length;
        return {
          intent,
          questions: promptRows.filter((r) => r.intent === intent).length,
          asked: cells.length,
          present,
          rate: cells.length ? Math.round((present / cells.length) * 100) : null,
        };
      })
      .filter((x) => x.questions > 0);

    const result = {
      host,
      domain,
      brand,
      score,
      answers: live.reduce((a, r) => a + r.asked, 0),
      mentions: live.reduce((a, r) => a + r.mentions, 0),
      citations: live.reduce((a, r) => a + r.citations, 0),
      engines: rows,
      prompts: promptRows.map((r) => ({
        q: r.q,
        intent: r.intent,
        show: shown.has(r),
        results: r.results,
      })),
      intents: intentStats,
      questionsAsked: promptRows.length,
      topSources: topDomains(citesAll, domain),
      readiness,
      tips: readiness
        ? buildTips({
            score,
            anyKnows: Object.values(known).some(Boolean),
            citedAny: live.some((r) => r.citations > 0),
            engines: live.length,
            readiness,
          })
        : [],
      skipped: skipped.n,
      seconds: Math.round((Date.now() - t0) / 1000),
    };

    const { error } = await db
      .from("ai_visibility_runs")
      .insert({ user_id: user.id, host, score, result });
    if (error) console.error("ai_visibility_runs save failed (run migration 018?):", error.message);

    return json({ ...result, ranAt: new Date().toISOString(), cached: false });
  }),
);