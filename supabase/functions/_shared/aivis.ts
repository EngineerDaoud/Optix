import { HttpError } from "./utils.ts";
import { get } from "./siteinfo.ts";

// AI Visibility, built from FREE sources only (no Semrush / paid API).
//
// How it works: we ask real AI models the questions a customer would ask ("best X", "how to choose X") and check
// whether the answer mentions the site (brand or domain) and, when the model searched the web, whether it cited it.
//
// Engines (each one is optional, it runs only when its key exists in Supabase secrets):
//   google : Gemini WITH Google Search grounding  -> mentions + real citations (closest free stand-in for Google AI Overview / AI Mode)
//   gemini : Gemini WITHOUT search                -> what the model "knows" about the brand by itself
//   open   : Groq open model (gpt-oss-120b)       -> a ChatGPT-style model without web search
//   claude : Claude (only if ANTHROPIC_API_KEY)   -> optional
// These are stand-ins. Real ChatGPT / Perplexity / AI Mode numbers need paid APIs, and the UI says so.

export type EngineId = "google" | "gemini" | "open" | "claude";

export const ENGINES: Record<
  EngineId,
  { label: string; note: string; web: boolean }
> = {
  google: {
    label: "Google AI (Gemini + Search)",
    note: "Stand-in for AI Overview / AI Mode. Reads the live web and shows its sources.",
    web: true,
  },
  gemini: {
    label: "Gemini (own knowledge)",
    note: "Answers without searching the web: shows if the brand is already known.",
    web: false,
  },
  open: {
    label: "ChatGPT-style (open model)",
    note: "Stand-in for ChatGPT. An open model without web search, not ChatGPT itself.",
    web: false,
  },
  claude: {
    label: "Claude",
    note: "Answers without web search.",
    web: false,
  },
};

export type Hit = {
  ok: boolean; // the engine answered
  error?: string;
  mentioned: boolean;
  match: "domain" | "brand" | null;
  cited: boolean;
  cites: string[]; // domains the engine cited (web engines only)
  snippet: string; // short piece of the answer around the mention (or the start of the answer)
};

const ANSWER_SYSTEM =
  "You are a helpful AI assistant. Answer the user's question the way you normally would for a real person: " +
  "recommend specific companies, websites, products or tools by name when that is useful. Keep it under 220 words.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (e: unknown) => {
  const st = (e as { status?: number }).status ?? 0;
  return (
    [429, 500, 502, 503, 504].includes(st) ||
    /high demand|overloaded|unavailable|quota|rate.?limit|timed out|timeout/i.test(
      String((e as Error)?.message ?? ""),
    )
  );
};

// ---------------------------------------------------------------------------------------------------------
// Engine calls
// ---------------------------------------------------------------------------------------------------------

type Raw = { text: string; sources: { uri: string; title: string }[] };

// Hard stop for every model call of one run. Without it a slow or rate-limited model could keep retrying past the
// edge function limit and the whole run died with status 546. index.ts sets it; calls never go past it.
let askUntil = 0;
export const setAskDeadline = (ms: number) => {
  askUntil = ms;
};
const timeLeft = () => (askUntil ? askUntil - Date.now() : 40_000);
const callTimeout = () => Math.max(1500, Math.min(30_000, timeLeft() - 500));

async function geminiCall(
  key: string,
  model: string,
  user: string,
  grounded: boolean,
): Promise<Raw> {
  const is25 = model.includes("2.5");
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 900 + (is25 ? 0 : 3000),
    temperature: 0.4,
  };
  if (is25 && model.includes("flash"))
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  else if (!is25) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(callTimeout()),
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ANSWER_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
        ...(grounded ? { tools: [{ google_search: {} }] } : {}),
      }),
    },
  );
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(r.status, j.error?.message ?? "Gemini API error");
  const cand = j.candidates?.[0];
  const text = ((cand?.content?.parts ?? []) as {
    text?: string;
    thought?: boolean;
  }[])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text) throw new HttpError(502, "Gemini returned an empty answer");
  const chunks = (cand?.groundingMetadata?.groundingChunks ?? []) as {
    web?: { uri?: string; title?: string };
  }[];
  return {
    text,
    sources: chunks
      .filter((c) => c.web)
      .map((c) => ({ uri: c.web!.uri ?? "", title: c.web!.title ?? "" })),
  };
}

async function geminiTry(key: string, user: string, grounded: boolean) {
  const main = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
  const extra = (
    Deno.env.get("GEMINI_FALLBACK_MODELS") ?? "gemini-3.5-flash-lite"
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  let last: unknown = null;
  for (const m of [...new Set([main, ...extra])]) {
    // the main model gets one retry on a busy / rate-limit error, the fallback just one go
    const tries = m === main ? 2 : 1;
    for (let t = 0; t < tries; t++) {
      if (timeLeft() < 3000) throw last ?? new HttpError(504, "Skipped (time limit)");
      try {
        return await geminiCall(key, m, user, grounded);
      } catch (e) {
        last = e;
        if (!transient(e)) break; // wrong or retired model name, bad key...: go straight to the next model
        if (t < tries - 1) await sleep(Math.min(2500 + Math.random() * 1000, Math.max(0, timeLeft() - 4000)));
      }
    }
  }
  throw last;
}

async function groqOne(
  key: string,
  user: string,
  model: string,
): Promise<Raw> {
  const oss = model.includes("gpt-oss");
  let last: unknown = null;
  // Groq free plan: 30 requests/min but only 8,000 tokens/min per model, and max_tokens counts toward that budget.
  // So: a modest max_tokens, one call at a time (see index.ts), and on 429 wait as long as Groq says before retrying.
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(callTimeout()),
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: oss ? 1200 : 700,
          temperature: 0.4,
          ...(oss ? { reasoning_effort: "low" } : {}),
          messages: [
            { role: "system", content: ANSWER_SYSTEM },
            { role: "user", content: user },
          ],
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        const e = new HttpError(
          r.status,
          j.error?.message ?? "Groq API error",
        ) as HttpError & { wait?: number };
        e.wait = Number(r.headers.get("retry-after") ?? 0);
        throw e;
      }
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) throw new HttpError(502, "Groq returned an empty answer");
      return { text, sources: [] };
    } catch (e) {
      last = e;
      if (!transient(e) || t === 3) break;
      const wait = (e as { wait?: number }).wait ?? 0;
      const pause = Math.min(20000, Math.max(3000, wait * 1000 + 500));
      if (timeLeft() < pause + 4000) break; // no time to wait and try again
      await sleep(pause);
    }
  }
  throw last;
}

// Main model first (default gpt-oss-120b: the strongest open model on Groq and the closest to ChatGPT). Every Groq model has its
// own token budget, so when the main one is rate limited or fails, the smaller one still answers.
async function groqCall(key: string, user: string): Promise<Raw> {
  const main = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  let last: unknown = null;
  for (const m of [...new Set([main, "openai/gpt-oss-20b"])]) {
    try {
      return await groqOne(key, user, m);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// Groq "compound" = an open model that SEARCHES THE WEB by itself (free plan, same GROQ_API_KEY). Used when Gemini + Google Search
// is down, over its free limit or not allowed for the key, so the "Google AI" row is not left empty. Sources come from the search it ran.
async function groqWebCall(key: string, user: string): Promise<Raw> {
  const model = Deno.env.get("GROQ_WEB_MODEL") ?? "groq/compound-mini";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(callTimeout()),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: ANSWER_SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(r.status, j.error?.message ?? "Groq web search error");
  const msg = j.choices?.[0]?.message ?? {};
  const text = String(msg.content ?? "");
  if (!text) throw new HttpError(502, "Groq web search returned an empty answer");
  const sources: { uri: string; title: string }[] = [];
  for (const t of (msg.executed_tools ?? []) as {
    search_results?: { results?: { url?: string; title?: string }[] };
  }[])
    for (const x of t.search_results?.results ?? [])
      if (x.url) sources.push({ uri: x.url, title: x.title ?? "" });
  return { text, sources };
}

async function claudeCall(key: string, user: string): Promise<Raw> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(40000),
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 700,
      temperature: 0.4,
      system: ANSWER_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new HttpError(r.status, j.error?.message ?? "Claude error");
  const text = (j.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { text, sources: [] };
}

/** Which engines can run, from the secrets that exist. */
export function availableEngines(): EngineId[] {
  const out: EngineId[] = [];
  // the Google AI row can run on Gemini + Google Search OR (fallback) on Groq's web-searching model
  if (Deno.env.get("GEMINI_API_KEY")) out.push("google", "gemini");
  else if (Deno.env.get("GROQ_API_KEY")) out.push("google");
  if (Deno.env.get("GROQ_API_KEY")) out.push("open");
  if (Deno.env.get("ANTHROPIC_API_KEY") && Deno.env.get("AIVIS_USE_CLAUDE"))
    out.push("claude");
  return out;
}

export async function ask(engine: EngineId, question: string): Promise<Raw> {
  if (engine === "google") {
    const gk = Deno.env.get("GEMINI_API_KEY");
    const qk = Deno.env.get("GROQ_API_KEY");
    if (gk) {
      try {
        return await geminiTry(gk, question, true);
      } catch (e) {
        if (!qk) throw e; // no fallback key
        try {
          return await groqWebCall(qk, question);
        } catch {
          throw e; // show the Gemini error: it is the main engine
        }
      }
    }
    return groqWebCall(qk!, question);
  }
  if (engine === "gemini")
    return geminiTry(Deno.env.get("GEMINI_API_KEY")!, question, false);
  if (engine === "open") return groqCall(Deno.env.get("GROQ_API_KEY")!, question);
  return claudeCall(Deno.env.get("ANTHROPIC_API_KEY")!, question);
}

// ---------------------------------------------------------------------------------------------------------
// Detecting the site in an answer
// ---------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostOf = (s: string) => {
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return s.toLowerCase().replace(/^www\./, "");
  }
};

const COMPANY_WORDS =
  /\b(ltd|limited|llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|gmbh|pvt|private|plc|llp|sarl|bv|ag|sa)\b\.?/gi;

/** "ElectroCity Bikes LTD" -> "ElectroCity Bikes": AI answers almost never write the legal ending. */
export function cleanBrand(name: string) {
  const c = name
    .replace(COMPANY_WORDS, " ")
    .replace(/^\s*the\s+/i, "")
    .replace(/[|,.\-–—]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return c.length >= 2 ? c : name.trim();
}

/** every way the brand can be written: with spaces, joined, with a hyphen, or as the domain name. */
function brandVariants(brand: string, domain: string) {
  const base = cleanBrand(brand);
  const sld = domain.split(".")[0];
  const set = new Set<string>();
  for (const v of [
    base,
    base.replace(/([a-z])([A-Z])/g, "$1 $2"),
    base.replace(/\s+/g, ""),
    base.replace(/\s+/g, "-"),
    sld,
    sld.replace(/[-_]+/g, " "),
  ]) {
    const t = v.trim();
    if (t.length >= 3) set.add(t);
  }
  return [...set];
}

export function detect(
  raw: Raw,
  brand: string,
  domain: string,
  web: boolean,
): Omit<Hit, "ok" | "error"> {
  const text = raw.text;
  const dom = new RegExp(`(^|[^a-z0-9-])${esc(domain)}([^a-z0-9-]|$)`, "i");
  let match: "domain" | "brand" | null = null;
  let at = -1;
  const dm = dom.exec(text);
  if (dm) {
    match = "domain";
    at = dm.index;
  } else {
    for (const v of brandVariants(brand, domain)) {
      // short names would match everywhere, so they must be written with the same capital letters
      const re = new RegExp(
        `(^|[^\\p{L}\\p{N}])${esc(v).replace(/(\\\s|\s)+/g, "[\\s-]?")}([^\\p{L}\\p{N}]|$)`,
        v.length >= 5 ? "iu" : "u",
      );
      const bm = re.exec(text);
      if (bm) {
        match = "brand";
        at = bm.index;
        break;
      }
    }
  }
  const cites = web
    ? [
        ...new Set(
          raw.sources
            .map((s) => {
              // Google returns redirect links; the readable domain is in the title
              const t = s.title.includes(".") && !/\s/.test(s.title) ? s.title : "";
              return hostOf(t || s.uri);
            })
            .filter(Boolean),
        ),
      ]
    : [];
  const cited = cites.some((c) => c === domain || c.endsWith("." + domain));
  const flat = text.replace(/\s+/g, " ").trim();
  const from = at >= 0 ? Math.max(0, at - 80) : 0;
  return {
    mentioned: match !== null,
    match,
    cited,
    cites,
    snippet: (from > 0 ? "…" : "") + flat.slice(from, from + 220),
  };
}

const UNKNOWN =
  /(don'?t|do not|cannot|can'?t) (know|find|have)|not (familiar|aware)|no (information|record|specific)|unable to (find|verify)|couldn'?t find|isn'?t (a )?(widely|well)|not a (widely|well)/i;

/** Brand test: does the model really know this brand, or is it guessing / admitting it does not know it. */
export function knowsBrand(raw: Raw, brand: string, domain: string) {
  const d = detect(raw, brand, domain, false);
  return d.mentioned && !UNKNOWN.test(raw.text.slice(0, 400));
}

// ---------------------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------------------

export type Intent = "best" | "choose" | "compare" | "price" | "problem" | "other";

export const INTENTS: Intent[] = ["best", "choose", "compare", "price", "problem"];

/** Guess what kind of question this is, so results can be grouped ("best lists", "price"...). */
export function classifyIntent(q: string): Intent {
  const t = q.toLowerCase();
  if (/\b(vs|versus|compare|comparison|difference between|alternatives?)\b/.test(t)) return "compare";
  if (/\b(price|prices|cost|costs|cheap|cheaper|cheapest|affordable|budget|worth|value|how much|deal|deals|discount)\b/.test(t)) return "price";
  if (/\b(best|top|top-rated|leading|recommended?|recommend)\b/.test(t)) return "best";
  if (/\b(how (do|to|can|should)|which|what to look for|choose|choosing|pick|picking|right|suitable|guide)\b/.test(t)) return "choose";
  if (/\b(fix|problem|issue|not working|stop|avoid|prevent|reduce|improve|solve|help me|struggling|can't|cannot)\b/.test(t)) return "problem";
  return "other";
}

const STOP = new Set("a an the of for to in on and or is are do does can i my me you your with what which how where who best top".split(" "));
const tokens = (q: string) =>
  new Set(
    q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
const similar = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
};

/** One clean question: no numbering/quotes, capital first letter, ends with ?, sensible length. Null = reject. */
export function tidyQuestion(raw: unknown, brand: string, domain: string): string | null {
  let q = String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;
  q = q.replace(/[.!\s]+$/, "").replace(/\?+$/, "");
  q = q.charAt(0).toUpperCase() + q.slice(1);
  const words = q.split(" ").length;
  if (q.length < 20 || q.length > 150 || words < 4 || words > 24) return null;
  const low = q.toLowerCase();
  if (brand && brand.length > 2 && low.includes(brand.toLowerCase())) return null;
  if (domain && low.includes(domain.toLowerCase())) return null;
  if (/https?:|www\./i.test(q)) return null;
  // not a question at all (a statement or a keyword list)
  if (!/^(what|which|who|where|when|why|how|can|could|should|is|are|do|does|will|would|any|best|top|i need|i want|looking|recommend)/i.test(q) && !/\b(best|top|vs|versus|cost|price)\b/i.test(q)) return null;
  return q + "?";
}

/** Clean, de-duplicate and keep the mix of intents even. Returns at most n questions. */
export function cleanQuestions(
  list: { q: unknown; intent?: unknown }[],
  brand: string,
  domain: string,
  n: number,
): { q: string; intent: Intent }[] {
  const kept: { q: string; intent: Intent; tk: Set<string> }[] = [];
  for (const x of list) {
    const q = tidyQuestion(x.q, brand, domain);
    if (!q) continue;
    const tk = tokens(q);
    if (kept.some((k) => similar(tk, k.tk) >= 0.75)) continue; // near-duplicate
    const said = String(x.intent ?? "").toLowerCase() as Intent;
    kept.push({ q, intent: INTENTS.includes(said) ? said : classifyIntent(q), tk });
  }
  // round-robin over intents so one kind of question does not fill the whole list
  const buckets = new Map<Intent, typeof kept>();
  for (const k of kept) buckets.set(k.intent, [...(buckets.get(k.intent) ?? []), k]);
  const out: { q: string; intent: Intent }[] = [];
  const order = [...INTENTS, "other" as Intent].filter((i) => buckets.has(i));
  while (out.length < n && order.some((i) => buckets.get(i)!.length)) {
    for (const i of order) {
      const k = buckets.get(i)!.shift();
      if (k && out.length < n) out.push({ q: k.q, intent: k.intent });
    }
  }
  return out;
}

/** Used when no AI key can write prompts (or it gave too few): plain templates from the site's own keywords. */
export function templatePrompts(topics: string[], n: number): { q: string; intent: Intent }[] {
  const t = topics.filter(Boolean).slice(0, 5);
  const forms: ((k: string) => { q: string; intent: Intent })[] = [
    (k) => ({ q: `What are the best ${k}?`, intent: "best" }),
    (k) => ({ q: `How do I choose the right ${k}?`, intent: "choose" }),
    (k) => ({ q: `Where can I find affordable ${k}?`, intent: "price" }),
    (k) => ({ q: `Can you compare the top options for ${k}?`, intent: "compare" }),
    (k) => ({ q: `What are the top-rated ${k} right now?`, intent: "best" }),
    (k) => ({ q: `How much does good quality ${k} typically cost?`, intent: "price" }),
    (k) => ({ q: `What mistakes should I avoid when buying ${k}?`, intent: "problem" }),
  ];
  const out: { q: string; intent: Intent }[] = [];
  for (let i = 0; out.length < n && i < forms.length; i++)
    for (const k of t) {
      if (out.length >= n) break;
      const x = forms[i](k);
      if (!out.some((o) => o.q === x.q)) out.push(x);
    }
  return out;
}

/**
 * Which questions the screen shows. All questions are asked and counted in the score, but the page only lists
 * a few: first the ones where the site shows up (they teach the most), then a spread of the other kinds.
 */
export function pickShown<T extends { intent: Intent; results: Record<string, { mentioned?: boolean; cited?: boolean; ok?: boolean } | null> }>(
  rows: T[],
  k: number,
): Set<T> {
  const present = (r: T) =>
    Object.values(r.results).filter((c) => c && c.ok && (c.cited || c.mentioned)).length;
  const answered = (r: T) => Object.values(r.results).filter((c) => c && c.ok).length;
  const ranked = rows
    .filter((r) => answered(r) > 0) // a question nobody answered says nothing
    .sort((a, b) => present(b) - present(a));
  const pick = new Set<T>();
  const seen = new Set<Intent>();
  for (const r of ranked) {
    // first pass: one per intent, so the list is varied
    if (pick.size >= k) break;
    if (!seen.has(r.intent)) {
      seen.add(r.intent);
      pick.add(r);
    }
  }
  for (const r of ranked) {
    if (pick.size >= k) break;
    pick.add(r);
  }
  return pick;
}

// ---------------------------------------------------------------------------------------------------------
// AI readiness: can AI crawlers read the site at all? (no API needed)
// ---------------------------------------------------------------------------------------------------------

export const AI_BOTS = [
  { ua: "GPTBot", owner: "OpenAI (training)" },
  { ua: "OAI-SearchBot", owner: "ChatGPT search" },
  { ua: "ChatGPT-User", owner: "ChatGPT browsing" },
  { ua: "ClaudeBot", owner: "Anthropic" },
  { ua: "PerplexityBot", owner: "Perplexity" },
  { ua: "Google-Extended", owner: "Gemini / AI training" },
  { ua: "Applebot-Extended", owner: "Apple Intelligence" },
  { ua: "CCBot", owner: "Common Crawl (feeds many AIs)" },
];

export async function aiReadiness(origin: string, schema: string[]) {
  let robots = "";
  let robotsOk = false;
  try {
    const r = await get(`${origin}/robots.txt`, 7000);
    if (r.ok) {
      robots = (await r.text()).slice(0, 200_000);
      robotsOk = /user-agent/i.test(robots);
    }
  } catch {
    /* no robots.txt: everything is allowed */
  }
  // group rules by user-agent
  const groups: { uas: string[]; disallow: string[]; allow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasUa = false;
  for (const line of robots.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2];
    if (k === "user-agent") {
      if (!cur || !lastWasUa) {
        cur = { uas: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.uas.push(v.toLowerCase());
      lastWasUa = true;
    } else {
      lastWasUa = false;
      if (cur && k === "disallow") cur.disallow.push(v);
      if (cur && k === "allow") cur.allow.push(v);
    }
  }
  const bots = AI_BOTS.map((b) => {
    const g =
      groups.find((x) => x.uas.includes(b.ua.toLowerCase())) ??
      groups.find((x) => x.uas.includes("*"));
    const blocked =
      !!g && g.disallow.includes("/") && !g.allow.some((a) => a === "/");
    return { ...b, blocked };
  });
  let llms = false;
  try {
    const r = await get(`${origin}/llms.txt`, 6000);
    const ct = r.headers.get("content-type") ?? "";
    llms = r.ok && !ct.includes("text/html");
  } catch {
    /* none */
  }
  const has = (t: string) => schema.some((s) => s.toLowerCase() === t);
  return {
    robotsOk,
    bots,
    llmsTxt: llms,
    schema: {
      organization: has("organization") || has("localbusiness"),
      faq: has("faqpage"),
      article: has("article") || has("blogposting"),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Tips (plain rules, no AI needed)
// ---------------------------------------------------------------------------------------------------------

export function buildTips(r: {
  score: number;
  anyKnows: boolean;
  citedAny: boolean;
  engines: number;
  readiness: Awaited<ReturnType<typeof aiReadiness>>;
}) {
  const tips: string[] = [];
  const blocked = r.readiness.bots.filter((b) => b.blocked);
  if (blocked.length)
    tips.push(
      `robots.txt blocks ${blocked.map((b) => b.ua).join(", ")}. Allow the search bots (OAI-SearchBot, PerplexityBot, ChatGPT-User) so AI answers can read and cite your pages.`,
    );
  if (!r.anyKnows)
    tips.push(
      "AI models do not know this brand yet. Build brand signals: a clear About page, Organization schema with sameAs links, a Google Business Profile, LinkedIn, Crunchbase and similar profiles, and mentions on other websites.",
    );
  if (!r.readiness.schema.organization)
    tips.push(
      "Add Organization (or LocalBusiness) JSON-LD on the home page with name, logo and sameAs links so AI can tell who you are.",
    );
  if (!r.readiness.schema.faq)
    tips.push(
      "Add pages that answer real questions in plain words (with FAQ schema). AI answers quote short, direct answers.",
    );
  if (!r.readiness.llmsTxt)
    tips.push(
      "Optional: add /llms.txt, a short plain-text guide to your most important pages. Cheap to add, few AI tools use it yet.",
    );
  if (!r.citedAny)
    tips.push(
      "AI search did not cite you for any question. Publish one strong page per question people ask (best X, how to choose X) and get it mentioned on trusted sites in your niche.",
    );
  if (r.score < 20)
    tips.push(
      "Very new or small sites usually start near 0. Visibility grows with backlinks, brand mentions and content that answers questions. Re-check every few weeks.",
    );
  return tips;
}

export function topDomains(list: string[][], skip: string) {
  const c = new Map<string, number>();
  for (const l of list)
    for (const d of l) {
      if (d === skip || d.endsWith("." + skip)) continue;
      c.set(d, (c.get(d) ?? 0) + 1);
    }
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain, count]) => ({ domain, count }));
}