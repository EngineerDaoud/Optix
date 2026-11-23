import { claude } from "./ai.ts";

// AI keyword editor. The rule-based filter (keyquality.ts) already removed the obvious junk; this asks the AI to
// look at what rules cannot see (part-number soup, spec lists, sentence fragments, phrases nobody searches).
// SAFETY: the AI can only REMOVE phrases from the list. It answers with list numbers, never with text, so it cannot
// add or change a keyword. If the AI is busy, fails, or wants to remove too much, the list is returned unchanged.

export type JudgeContext = {
  site?: string;
  topic?: string;
  offerings?: string[];
  titles?: string[];
};

export type JudgeResult = {
  kept: string[]; // same order as the input, minus removed phrases
  dropped: string[]; // phrases the AI removed
  used: boolean; // true when the AI answered and its answer was applied
  note?: string; // short human-readable reason when the AI was skipped / ignored
};

const MAX_REMOVE_SHARE = 0.6;

function pickIndexes(text: string): number[] | null {
  const t = text.replace(/```json|```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(t.slice(start, end + 1));
    const arr = Array.isArray(j.remove) ? j.remove : Array.isArray(j.drop) ? j.drop : null;
    if (!arr) return null;
    return arr
      .map((x: unknown) => Number(x))
      .filter((n: number) => Number.isInteger(n));
  } catch {
    return null;
  }
}

export async function judgeKeywords(
  phrases: string[],
  ctx: JudgeContext = {},
  opts: { max?: number } = {},
): Promise<JudgeResult> {
  // de-duplicate (case-insensitive) but keep the first spelling and the original order
  const seen = new Set<string>();
  const all = phrases.filter((p) => {
    const k = (p ?? "").trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const max = Math.max(1, opts.max ?? 120);
  const head = all.slice(0, max);
  const tail = all.slice(max); // not judged, kept as they are
  if (head.length < 8) return { kept: all, dropped: [], used: false };

  const system =
    "You are a strict SEO keyword editor. You receive a numbered list of phrases found on one website, plus what the site is about. " +
    "Remove every phrase that is NOT a good target keyword for THIS website's own business. Remove a phrase when it is: " +
    "(1) a part number, model code, list of specs or dimensions, loose numbers; " +
    "(2) a broken sentence fragment, or navigation / legal / policy / account / checkout text (refund policy, privacy, terms, login, contact); " +
    "(3) the name of a person (author, reviewer, staff, customer) or any personal name; " +
    "(4) OFF-TOPIC: it has nothing to do with what this website sells or offers (for example text about another industry, a plugin or " +
    "app the site merely uses, stock-photo or website-builder wording on a bike shop), even if the words appear somewhere on a page; " +
    "(5) a phrase nobody would type into Google. " +
    "Keep brand names, product types, product categories, services, locations and normal buyer search phrases that match the site's topic. " +
    "When a phrase clearly fits the site's topic, keep it. When it clearly does not fit the topic, remove it. " +
    'Reply with JSON only, exactly like {"remove":[3,17]} using the list numbers. Use {"remove":[]} when nothing should go.';
  const lines = [
    `Website: ${ctx.site ?? ""}`,
    `Topic: ${ctx.topic ?? ""}`,
    `Offerings: ${(ctx.offerings ?? []).slice(0, 8).join("; ")}`,
    `Page titles: ${(ctx.titles ?? []).slice(0, 8).join(" | ")}`,
    "",
    "Phrases:",
    ...head.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");

  let raw: string;
  try {
    raw = await claude(system, lines, 600, { json: true });
  } catch {
    return { kept: all, dropped: [], used: false, note: "the editor was busy, the list was left as it is" };
  }
  const idx = pickIndexes(raw);
  if (!idx) return { kept: all, dropped: [], used: false, note: "the editor answer was not readable, the list was left as it is" };

  const drop = new Set(idx.filter((n) => n >= 1 && n <= head.length).map((n) => n - 1));
  if (drop.size > head.length * MAX_REMOVE_SHARE)
    return { kept: all, dropped: [], used: false, note: "the editor wanted to remove too many phrases, so it was ignored" };

  const dropped = head.filter((_, i) => drop.has(i));
  const kept = [...head.filter((_, i) => !drop.has(i)), ...tail];
  return { kept, dropped, used: true };
}