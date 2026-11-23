// Keyword quality: is this phrase something a person would really type into Google?
// Pure functions (no network, no cost). A phrase can be written on the site and still be a bad keyword, for example:
//   "102 406 e bike snow sand"                      loose numbers copied from a product spec table
//   "xt90 battery connector mt60 phase connectors"  two part codes glued into one product title
//   "48v 20ah 1000w 26 inch"                        a list of specs
//   "polo s shirts" / "e bike and"                  broken fragments
// This file removes those shapes. The AI judge (keyjudge.ts) then handles what rules cannot see.

const UNIT_NUM =
  /^\d+(?:[.,]\d+)?(?:v|w|kw|ah|mah|wh|mm|cm|m|km|kg|g|lb|lbs|oz|gb|tb|mb|hz|mp|k|l|ml|in|inch|inches|ft|x|pc|pcs|pack|ply|th|st|nd|rd)$/;
// part number / model code: letters and digits mixed (xt90, mt60, bbs01b, rtx4090) and NOT just a number with a unit (48v, 20ah)
const CODE = /^(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}$/;
// single letters that are real words / prefixes in search phrases ("e bike", "x ray", "t shirt", "v neck", "3d")
const OK_SINGLE = new Set(["e", "x", "t", "v", "a"]);

/** a bare number (102) or a part code (xt90, mt60, bbs01b): the tokens that turn a product title into spec soup. Units like 48v / 20ah are NOT noisy. */
export const isNoisyToken = (t: string) =>
  /^\d+$/.test(t) || (!UNIT_NUM.test(t) && CODE.test(t));

export type Shape = { ok: boolean; reason?: string };

/** tokens = the phrase split on spaces (already lower case, letters/digits only, as the grounding module stores them) */
export function keywordShape(phrase: string): Shape {
  const toks = phrase
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const n = toks.length;
  if (n < 1) return { ok: false, reason: "empty" };
  if (n > 6) return { ok: false, reason: "too long" };

  let pure = 0,
    units = 0,
    codes = 0;
  const seen = new Set<string>();
  for (const t of toks) {
    if (/^\d+$/.test(t)) pure++;
    else if (UNIT_NUM.test(t)) units++;
    else if (CODE.test(t)) codes++;
    if (t.length === 1 && !/\d/.test(t) && !OK_SINGLE.has(t))
      return { ok: false, reason: "broken word" };
    if (t.length >= 2 && seen.has(t)) return { ok: false, reason: "repeated word" };
    seen.add(t);
  }

  if (pure >= 2) return { ok: false, reason: "loose numbers" };
  // one bare number is fine in a short phrase that does not start with it ("iphone 15", "model 3"); in a longer phrase it is a
  // piece of a spec / model line ("e bike snow sand 4", "406 e bike snow sand")
  if (pure === 1 && (n > 3 || /^\d+$/.test(toks[0])))
    return { ok: false, reason: "loose number" };
  if (codes >= 2) return { ok: false, reason: "two or more part codes" };
  if (codes >= 1 && n > 4) return { ok: false, reason: "long product title with a part code" };
  if (units >= 3) return { ok: false, reason: "spec list" };
  if (units >= 1 && pure >= 1) return { ok: false, reason: "spec fragment" };
  if (units + codes + pure >= Math.ceil(n / 2) + 1 && n >= 3)
    return { ok: false, reason: "mostly numbers and codes" };
  // a phrase that is nothing but short non-words (no vowels in any token) is a code dump
  if (!toks.some((t) => /[aeiouy\u00e0-\u00ff]/.test(t)) && !toks.some((t) => /[\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}]/u.test(t)))
    return { ok: false, reason: "no real words" };
  return { ok: true };
}

export const isRealKeyword = (phrase: string) => keywordShape(phrase).ok;