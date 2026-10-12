import { HttpError } from "./utils.ts";

// Same function name (`claude`) so insights/report need no changes.
// Provider order: Gemini (GEMINI_API_KEY) -> Groq (GROQ_API_KEY) -> Anthropic (ANTHROPIC_API_KEY).
// Set AI_PROVIDER=gemini|groq|anthropic to force one.

type AiOpts = { json?: boolean };

// Edge functions are killed after about 150 s, which shows up as "non-2xx status code". The caller sets a deadline;
// after it every AI call fails fast, so the report still comes back (without the AI parts) instead of dying.
let deadline = 0;
export function setAiDeadline(ts: number) {
  deadline = ts;
}
const msLeft = () => (deadline ? deadline - Date.now() : Infinity);
const reqTimeout = () =>
  AbortSignal.timeout(Math.max(3000, Math.min(30000, msLeft())));

async function gemini(
  key: string,
  system: string,
  user: string,
  maxTokens: number,
  o: AiOpts,
  model: string,
): Promise<string> {
  const is25 = model.includes("2.5");
  // Thinking tokens count toward maxOutputTokens, so newer models get extra room to avoid cut-off JSON.
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: maxTokens + (is25 ? 0 : 4000),
    temperature: 0.2,
  };
  if (o.json) generationConfig.responseMimeType = "application/json";
  if (is25 && model.includes("flash"))
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  else if (!is25) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      signal: reqTimeout(),
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
    },
  );
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(r.status, j.error?.message ?? "Gemini API error");
  const parts = (j.candidates?.[0]?.content?.parts ?? []) as {
    text?: string;
    thought?: boolean;
  }[];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text)
    throw new HttpError(
      502,
      "Gemini returned an empty answer, please try again",
    );
  return text;
}

async function groq(
  key: string,
  system: string,
  user: string,
  maxTokens: number,
  o: AiOpts,
  model: string,
): Promise<string> {
  const isOss = model.includes("gpt-oss");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: reqTimeout(),
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens + (isOss ? 2000 : 0),
      temperature: 0.2,
      ...(isOss ? { reasoning_effort: "low" } : {}),
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(r.status, j.error?.message ?? "Groq API error");
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text)
    throw new HttpError(502, "Groq returned an empty answer, please try again");
  return text;
}

async function anthropic(
  key: string,
  system: string,
  user: string,
  maxTokens: number,
  _o: AiOpts,
): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: reqTimeout(),
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(r.status, j.error?.message ?? "Claude API error");
  return (j.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// busy / rate limited / temporary: worth retrying or trying the next model
const isTransient = (e: unknown) => {
  const st = (e as { status?: number }).status ?? 0;
  const msg = String((e as Error)?.message ?? "");
  return (
    st === 429 ||
    st === 500 ||
    st === 502 ||
    st === 503 ||
    st === 504 ||
    /high demand|overloaded|unavailable|quota|rate.?limit|try again|timed out|timeout|empty answer/i.test(
      msg,
    )
  );
};

type Attempt = { name: string; run: () => Promise<string> };

/**
 * Tries every configured model in order. A busy model ("high demand", 429, 503) is retried with a short wait,
 * then the next model / provider is used, so one overloaded model no longer kills the whole report.
 * Secrets (all optional except one key):
 *   GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY
 *   GEMINI_MODEL (main), GEMINI_FALLBACK_MODELS (comma list), GROQ_MODEL, ANTHROPIC_MODEL
 *   AI_PROVIDER=gemini|groq|anthropic puts that provider first (others still act as backup)
 */
export async function claude(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: AiOpts = {},
): Promise<string> {
  const g = Deno.env.get("GEMINI_API_KEY");
  const q = Deno.env.get("GROQ_API_KEY");
  const a = Deno.env.get("ANTHROPIC_API_KEY");
  const forced = (Deno.env.get("AI_PROVIDER") ?? "").toLowerCase();

  const groups: Record<string, Attempt[]> = {
    gemini: [],
    groq: [],
    anthropic: [],
  };
  if (g) {
    const main = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
    const extra = (
      Deno.env.get("GEMINI_FALLBACK_MODELS") ??
      "gemini-2.5-flash,gemini-2.5-flash-lite"
    )
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const m of [...new Set([main, ...extra])])
      groups.gemini.push({
        name: `Gemini ${m}`,
        run: () => gemini(g, system, user, maxTokens, opts, m),
      });
  }
  if (q) {
    const main = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
    // llama-3.3-70b-versatile was shut down by Groq on 2026-08-16.
    for (const m of [...new Set([main, "openai/gpt-oss-20b"])])
      groups.groq.push({
        name: `Groq ${m}`,
        run: () => groq(q, system, user, maxTokens, opts, m),
      });
  }
  if (a)
    groups.anthropic.push({
      name: "Claude",
      run: () => anthropic(a, system, user, maxTokens, opts),
    });

  const order = ["gemini", "groq", "anthropic"];
  if (forced && order.includes(forced))
    (order.splice(order.indexOf(forced), 1), order.unshift(forced));
  const attempts = order.flatMap((k) => groups[k]);
  if (!attempts.length)
    throw new HttpError(
      400,
      "No AI key set. Add GEMINI_API_KEY (or GROQ_API_KEY) to Supabase secrets.",
    );

  let lastErr: unknown = null;
  for (const at of attempts) {
    if (msLeft() < 6000) {
      lastErr = new Error("out of time");
      break;
    }
    // up to 2 tries per model; the 2nd only when the model was busy
    for (let t = 0; t < 2; t++) {
      try {
        return await at.run();
      } catch (e) {
        lastErr = e;
        if (!isTransient(e)) break; // bad key / bad request: do not retry this model, go to the next one
        if (msLeft() < 6000) break;
        if (t === 0) await sleep(1500 + Math.random() * 1000);
      }
    }
  }
  const msg = String((lastErr as Error)?.message ?? "AI failed");
  throw new HttpError(
    502,
    `All AI models are busy or unavailable right now (${msg}). Press "Re-run with fresh data" in a minute.`,
  );
}
