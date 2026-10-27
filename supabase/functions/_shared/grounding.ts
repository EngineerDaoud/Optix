// Site-grounded keywords. Pure functions only (no network), so they are easy to test.
//
// Problem this solves: the keyword list used to come mostly from an AI step ("what would a customer type?"),
// so many phrases were never written anywhere on the website. This file makes the crawled pages the single
// source of truth:
//   1. buildCorpus          turns the crawled pages into searchable text segments (title, H1, H2/H3, meta description,
//                           URL slug, link text, body sentences)
//   2. extractSiteKeywords  finds the real multi-word phrases the site is built around, ranked by WHERE and HOW OFTEN
//                           they appear (title/H1 count more than body text), longest full phrase preferred
//   3. groundPhrase         checks any phrase (from the AI, from an old run, from Google autocomplete) against the corpus
//   4. groundSeeds          keeps only the phrases that really are on the site, and completes cut-off phrases to the
//                           full phrase the site uses
// Every keyword that survives can say exactly where it was found.

import { isJunkPhrase } from "./keywords.ts";

// ---------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------

export type Field =
  | "title"
  | "h1"
  | "heading"
  | "description"
  | "url"
  | "link"
  | "meta"
  | "body";

type PageLike = {
  url: string;
  status?: number;
  noindex?: boolean;
  title?: string;
  description?: string;
  h1s?: string[];
  h2s?: string[];
  anchors?: string[];
  metaKeywords?: string;
  text?: string;
};

type Segment = {
  page: number; // index into corpus.pages
  field: Field;
  toks: string[]; // folded + stemmed tokens
  str: string; // " tok tok tok " for fast phrase containment
};

export type Corpus = {
  pages: string[]; // page URLs
  segs: Segment[];
  index: Map<string, number[]>; // token -> segment ids
  brand: string[]; // squashed brand strings
  cache: Map<string, Evidence>; // groundPhrase results (the same phrase is checked more than once per run)
};

export type Evidence = {
  mode: "exact" | "words" | "none";
  fields: Field[]; // where it was found, best first
  pages: number; // on how many pages
  url: string | null; // best page for it
};

export type SiteKeyword = {
  keyword: string; // the full phrase as the site writes it (lower case)
  score: number;
  pages: number;
  fields: Field[];
  url: string | null;
};

// ---------------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------------

/** lower case, accents removed, only letters and digits (any language) kept */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** very light stemmer so "polo shirts" and "polo shirt" count as the same phrase */
export function stem(w: string) {
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(?:ss|us|is)$/.test(w)) return w;
  if (/(?:sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const tokens = (s: string) =>
  fold(s)
    .split(" ")
    .filter(Boolean)
    .map(stem);

// words that can sit inside a phrase but never start or end one
const GLUE = new Set(["of", "for", "and", "in", "to", "on", "with", "de", "la"]);
const STOP = new Set(
  `a an the this that these those it its is are was were be been being am i we you your our their his her my me us they them he she
   at by from as or if but not no yes so than then too very just can will would should could may might must do does did done have has had
   how what why when where who which whom whose there here also only more most less some any all each every both other such own same
   about above after again against all before below between during into over through under until up down out off once while
   get got use used using one two new click read learn view see add shop now`
    .split(/\s+/)
    .filter(Boolean)
    .map(stem),
);
// page furniture that is never a keyword on its own
const FURNITURE = new Set(
  `menu skip content cookie cookies privacy policy terms conditions copyright rights reserved login logon signin signup register subscribe
   newsletter follow share tweet facebook instagram twitter linkedin youtube pinterest tiktok whatsapp email phone call mobile address
   cart checkout basket account wishlist search home homepage page pages previous next back top close open submit send loading
   sitemap powered designed developed all rights`
    .split(/\s+/)
    .filter(Boolean)
    .map(stem),
);
// first words that turn a phrase into a call-to-action ("learn more about", "shop now")
const ACTION_START = new Set(
  "click read learn view see add shop get buy order download subscribe follow share sign log join discover explore pick choose select enjoy try meet welcome why".split(
    " ",
  ),
);

const FIELD_WEIGHT: Record<Field, number> = {
  title: 6,
  h1: 6,
  heading: 3.5,
  meta: 3,
  description: 2.5,
  url: 2.5,
  link: 2,
  body: 1,
};

const GENERIC_SEGMENT = new Set(
  "collections collection products product blog blogs category categories cat shop store pages page tag tags post posts news article articles p item items catalog catalogue en us uk index home".split(
    " ",
  ),
);
// only the LAST path segment names the page ("/collections/polo-shirts" -> "polo shirts"); folders like /products/ are not keywords
function slugText(url: string) {
  try {
    const u = new URL(url);
    const segs = decodeURIComponent(u.pathname)
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .split("/")
      .filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    if (!last || GENERIC_SEGMENT.has(last.toLowerCase())) return "";
    if (/^[0-9a-f-]{16,}$/i.test(last) || /^\d+$/.test(last)) return ""; // ids
    return last.replace(/[-_+]+/g, " ");
  } catch {
    return "";
  }
}

// split into small units so a phrase never runs across a comma, a pipe or a full stop
function units(raw: string, field: Field): string[] {
  const splitter =
    field === "body"
      ? /[.!?;:\n\r|•·–—()\[\]{}"“”«»\u2022]+|\s[-/]\s/
      : /[|•·–—:\n\r()\[\]{}"“”«»\u2022]+|\s[-/]\s|[,;.!?]\s/;
  return raw
    .split(splitter)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

// ---------------------------------------------------------------------------------------------------------
// 1. Corpus
// ---------------------------------------------------------------------------------------------------------

export function buildCorpus(
  pages: PageLike[],
  opts: { brand?: string[]; skipUrl?: (url: string) => boolean } = {},
): Corpus {
  const brand = (opts.brand ?? [])
    .map((b) => fold(b).replace(/\s/g, ""))
    .filter((b) => b.length >= 3);
  const corpus: Corpus = {
    pages: [],
    segs: [],
    index: new Map(),
    brand,
    cache: new Map(),
  };
  for (const p of pages) {
    if (p.status != null && p.status !== 200) continue;
    if (p.noindex) continue;
    if (opts.skipUrl?.(p.url)) continue;
    const pi = corpus.pages.push(p.url) - 1;
    const add = (raw: string | undefined, field: Field) => {
      if (!raw) return;
      for (const u of units(raw, field)) {
        const toks = tokens(u);
        if (toks.length < 1 || toks.length > 40) continue;
        const id =
          corpus.segs.push({
            page: pi,
            field,
            toks,
            str: ` ${toks.join(" ")} `,
          }) - 1;
        for (const t of new Set(toks)) {
          const l = corpus.index.get(t);
          if (l) l.push(id);
          else corpus.index.set(t, [id]);
        }
      }
    };
    add(p.title, "title");
    for (const h of p.h1s ?? []) add(h, "h1");
    for (const h of p.h2s ?? []) add(h, "heading");
    add(p.description, "description");
    add(p.metaKeywords?.replace(/,/g, " | "), "meta");
    add(slugText(p.url), "url");
    for (const a of p.anchors ?? []) add(a, "link");
    add(p.text, "body");
  }
  return corpus;
}

const isBrandy = (c: Corpus, phrase: string) => {
  const sq = fold(phrase).replace(/\s/g, "");
  return c.brand.some((b) => sq === b || (sq.length > 3 && b.includes(sq)));
};
const containsBrand = (c: Corpus, phrase: string) => {
  const sq = fold(phrase).replace(/\s/g, "");
  return c.brand.some((b) => sq.includes(b));
};

// ---------------------------------------------------------------------------------------------------------
// 2. Extract the real keywords of the site
// ---------------------------------------------------------------------------------------------------------

function validPhrase(toks: string[]) {
  const n = toks.length;
  if (n < 1 || n > 6) return false;
  if (STOP.has(toks[0]) || STOP.has(toks[n - 1])) return false;
  if (GLUE.has(toks[0]) || GLUE.has(toks[n - 1])) return false;
  let glue = 0;
  for (let i = 1; i < n - 1; i++) {
    if (GLUE.has(toks[i])) glue++;
    else if (STOP.has(toks[i])) return false;
  }
  if (glue > 1) return false;
  if (toks.every((t) => FURNITURE.has(t) || STOP.has(t) || GLUE.has(t)))
    return false;
  if (ACTION_START.has(toks[0])) return false; // "order custom polo shirts": the keyword is the part after the button word
  // a number glued to "in / of / for" is a sentence ("polo shirts in 20 colors"), not a keyword
  if (
    toks.some(
      (t, i) =>
        /^\d+$/.test(t) && (GLUE.has(toks[i - 1] ?? "") || GLUE.has(toks[i + 1] ?? "")),
    )
  )
    return false;
  if (toks.every((t) => /^\d+$/.test(t))) return false;
  if (/^\d+$/.test(toks[0]) && n <= 2) return false; // "20 colors"
  if (toks.some((t) => t.length > 24)) return false; // hashes, ids
  const digits = toks.filter((t) => /\d/.test(t)).length;
  if (digits > 2 && digits >= n - 1) return false;
  return true;
}

const WHOLE_LINE = new Set<Field>(["title", "h1", "heading", "link", "meta", "url"]);
const FIELD_BIT: Record<Field, number> = {
  title: 1,
  h1: 2,
  heading: 4,
  description: 8,
  url: 16,
  link: 32,
  meta: 64,
  body: 128,
};
const FIELD_ORDER = Object.keys(FIELD_WEIGHT) as Field[];

// One small object per candidate phrase (no Maps): this runs on sites with hundreds of pages inside an edge function
// that has a tight CPU and memory limit. Segments of one page are stored next to each other, so "the best weight of
// this page" can be kept in two numbers instead of a Map.
type Cand = {
  toks: string[];
  score: number; // sum over finished pages of the best field weight on that page
  pages: number;
  lastPage: number;
  lastW: number;
  bestW: number;
  bestPage: number;
  mask: number; // which fields it was seen in
};

const MAX_CANDS = 120_000; // hard stop for memory

export function extractSiteKeywords(
  corpus: Corpus,
  opts: {
    limit?: number;
    maxWords?: number;
    minWords?: number;
    budgetMs?: number; // stop early when this much time was used (CPU protection)
  } = {},
): SiteKeyword[] {
  const limit = opts.limit ?? 80;
  const maxN = Math.min(6, opts.maxWords ?? 5);
  const minN = Math.max(1, opts.minWords ?? 2);
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 800;
  const cands = new Map<string, Cand>();
  const nPages = Math.max(1, corpus.pages.length);

  const touch = (toks: string[], seg: Segment, wholeUnit: boolean) => {
    const key = toks.join(" ");
    let c = cands.get(key);
    if (!c) {
      if (cands.size >= MAX_CANDS) return;
      c = {
        toks,
        score: 0,
        pages: 0,
        lastPage: -1,
        lastW: 0,
        bestW: -1,
        bestPage: -1,
        mask: 0,
      };
      cands.set(key, c);
    }
    // a heading that IS the phrase (the whole line) is the strongest signal
    const w = FIELD_WEIGHT[seg.field] * (wholeUnit ? 1.5 : 1);
    if (c.lastPage !== seg.page) {
      c.score += c.lastW;
      c.lastPage = seg.page;
      c.lastW = w;
      c.pages++;
    } else if (w > c.lastW) c.lastW = w;
    if (w > c.bestW) {
      c.bestW = w;
      c.bestPage = seg.page;
    }
    c.mask |= FIELD_BIT[seg.field];
  };

  const scan = (seg: Segment) => {
    const t = seg.toks;
    const L = t.length;
    if (L < 1) return;
    const whole = WHOLE_LINE.has(seg.field);
    // the whole line as a phrase (headings, titles, link text): "custom embroidered polo shirts"
    if (whole && L >= minN && L <= 6 && validPhrase(t)) touch(t, seg, true);
    const top = Math.min(maxN, L);
    for (let n = minN; n <= top; n++) {
      if (n === L && whole && L <= 6) continue; // already counted as whole line
      for (let i = 0; i + n <= L; i++) {
        const g = t.slice(i, i + n);
        if (validPhrase(g)) touch(g, seg, n === L);
      }
    }
  };

  // One pass over the segments in page order (the per-page counting above depends on that order).
  // Titles, headings, descriptions, URL names and link text are always read: that is where a site states what it is about, and it
  // is a small part of the text, so it is cheap. Body sentences are read only when the site has very little of that (for example a
  // page-builder site with no headings), and then only the first 8 sentences of each page.
  let structuredSegs = 0;
  for (const seg of corpus.segs) if (seg.field !== "body") structuredSegs++;
  const useBody = structuredSegs < nPages * 6;
  const bodySeen = new Map<number, number>();
  let n1 = 0;
  for (const seg of corpus.segs) {
    if (seg.field === "body") {
      if (!useBody) continue;
      const k = (bodySeen.get(seg.page) ?? 0) + 1;
      bodySeen.set(seg.page, k);
      if (k > 8) continue;
    }
    scan(seg);
    if (++n1 % 800 === 0 && Date.now() - t0 > budget) break;
  }

  const out: SiteKeyword[] = [];
  for (const [key, c] of cands) {
    const score0 = c.score + c.lastW;
    const structured = (c.mask & ~FIELD_BIT.body) !== 0;
    if (!structured && c.pages < 2) continue; // body-only phrases must appear on at least 2 pages
    let s = score0;
    // a phrase on almost EVERY page is template text (menu, footer, tagline)
    if (nPages >= 6 && c.pages / nPages > 0.6) s *= 0.15;
    // longer, more specific phrases are worth slightly more than their parts
    s *= 1 + 0.12 * (c.toks.length - 2);
    if (isJunkPhrase(key)) continue;
    if (isBrandy(corpus, key) || (c.toks.length <= 2 && containsBrand(corpus, key)))
      continue;
    const fields: Field[] = FIELD_ORDER.filter((f) => c.mask & FIELD_BIT[f]);
    out.push({
      keyword: key,
      score: Math.round(s * 100) / 100,
      pages: c.pages,
      fields,
      url: c.bestPage >= 0 ? corpus.pages[c.bestPage] : null,
    });
  }
  cands.clear();

  // keep the best few thousand before the pairwise "full phrase" step so it stays fast
  out.sort((a, b) => b.score - a.score);
  const pool = out.slice(0, 1500);

  // FULL PHRASE: drop a shorter phrase when a longer phrase that contains it is almost as well supported
  // ("polo shirts" is dropped when "custom embroidered polo shirts" appears nearly everywhere "polo shirts" does).
  pool.sort((a, b) => b.keyword.split(" ").length - a.keyword.split(" ").length);
  const kept: SiteKeyword[] = [];
  for (const k of pool) {
    const padded = ` ${k.keyword} `;
    const covered = kept.some(
      (big) =>
        big.keyword !== k.keyword &&
        big.score >= k.score * 0.75 &&
        ` ${big.keyword} `.includes(padded),
    );
    if (!covered) kept.push(k);
  }
  kept.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  return kept.slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------
// 3. Check any phrase against the site
// ---------------------------------------------------------------------------------------------------------

// Words people add when they search ("buy", "price", "near me"). They are rarely written on the site itself.
const MODIFIERS = new Set(
  `buy price cheap cheapest best top online near me sale shop store cost deal deals discount cheaper affordable review compare comparison
   vs versus free quote hire`
    .split(/\s+/)
    .filter(Boolean)
    .map(stem),
);

/**
 * strict   (default): the phrase must be written on the site: the same words in a row on at least one page, or all of its words
 *                     inside ONE heading / title / description / link text / sentence (any order).
 * relaxed:            same as strict, but search words such as "buy", "price", "best", "near me" are ignored, so "buy custom polos"
 *                     is accepted when the site writes "custom polos".
 */
export type Mode = "strict" | "relaxed";

export function groundPhrase(
  phrase: string,
  corpus: Corpus,
  mode: Mode = "strict",
): Evidence {
  const all = tokens(phrase);
  const none: Evidence = { mode: "none", fields: [], pages: 0, url: null };
  if (!all.length) return none;
  const ck = `${mode}|${all.join(" ")}`;
  const hit = corpus.cache.get(ck);
  if (hit) return hit;
  const res = groundUncached(all, corpus, mode, none);
  corpus.cache.set(ck, res);
  return res;
}

function groundUncached(
  all: string[],
  corpus: Corpus,
  mode: Mode,
  none: Evidence,
): Evidence {
  let toks = all;
  if (mode === "relaxed") {
    const core = all.filter((t) => !MODIFIERS.has(t));
    if (core.length >= 2 && core.length < all.length) toks = core;
  }
  const need = toks.filter((t) => !GLUE.has(t));
  if (!need.length) return none;
  // start from the rarest word on the site
  let rare: number[] | undefined;
  for (const t of need) {
    const l = corpus.index.get(t);
    if (!l) return none; // a word that appears nowhere on the site
    if (!rare || l.length < rare.length) rare = l;
  }
  const exact = ` ${toks.join(" ")} `;
  const fields = new Map<Field, number>();
  const pages = new Set<number>();
  let mode_: "exact" | "words" = "words";
  const bestAt = new Map<number, number>();
  for (const id of rare!) {
    const seg = corpus.segs[id];
    let hit: "exact" | "words" | null = null;
    if (seg.str.includes(exact)) hit = "exact";
    else if (need.length >= 3 && need.every((t) => seg.str.includes(` ${t} `)))
      hit = "words";
    if (!hit) continue;
    if (hit === "exact") mode_ = "exact";
    fields.set(seg.field, (fields.get(seg.field) ?? 0) + 1);
    pages.add(seg.page);
    const w = FIELD_WEIGHT[seg.field] * (hit === "exact" ? 2 : 1);
    if (w > (bestAt.get(seg.page) ?? 0)) bestAt.set(seg.page, w);
  }
  if (!pages.size) return none;
  // a 1-word phrase only counts when it is an exact heading/title/link hit
  let best = -1,
    bw = -1;
  for (const [p, w] of bestAt) if (w > bw) ((bw = w), (best = p));
  // if some hit was exact, report exact (a mix of exact and any-order hits is still an exact phrase on the site)
  return {
    mode: mode_,
    fields: [...fields.keys()].sort((a, b) => FIELD_WEIGHT[b] - FIELD_WEIGHT[a]),
    pages: pages.size,
    url: best >= 0 ? corpus.pages[best] : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 4. Keep only phrases that are on the site, and complete cut-off phrases
// ---------------------------------------------------------------------------------------------------------

/** "polo shirts" -> "custom embroidered polo shirts" when the site nearly always writes the longer phrase */
export function completePhrase(
  phrase: string,
  extracted: SiteKeyword[],
  corpus: Corpus,
  mode: Mode = "strict",
): string {
  const base = tokens(phrase).join(" ");
  if (!base) return phrase;
  const own = groundPhrase(phrase, corpus, mode);
  if (own.mode === "none") return phrase;
  if (base.split(" ").length > 3) return phrase;
  const STRUCTURED = new Set<Field>(["title", "h1", "heading", "link", "meta"]);
  let best: SiteKeyword | null = null;
  for (const e of extracted) {
    if (e.keyword === base) continue;
    const n = e.keyword.split(" ").length;
    if (n > 5 || n > base.split(" ").length + 3) continue;
    if (!` ${e.keyword} `.includes(` ${base} `)) continue;
    if (!e.fields.some((f) => STRUCTURED.has(f))) continue; // the full phrase must be a real title / heading / link text
    // the longer phrase must be written almost everywhere the short one is, on at least 2 pages
    if (e.pages < 2 || e.pages < own.pages * 0.8) continue;
    if (!best || e.pages > best.pages || (e.pages === best.pages && n > best.keyword.split(" ").length))
      best = e;
  }
  return best ? best.keyword : phrase;
}

export type Grounded = {
  kept: string[]; // phrases that are on the site (completed to the full phrase), same order as given
  removed: string[]; // phrases NOT found anywhere on the site
  evidence: Record<string, Evidence>;
};

export function groundSeeds(
  seeds: string[],
  corpus: Corpus,
  extracted: SiteKeyword[],
  mode: Mode = "strict",
): Grounded {
  const kept: string[] = [];
  const removed: string[] = [];
  const evidence: Record<string, Evidence> = {};
  const seen = new Set<string>();
  for (const raw of seeds) {
    const w = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!w) continue;
    const ev = groundPhrase(w, corpus, mode);
    if (ev.mode === "none") {
      removed.push(w);
      continue;
    }
    const full = completePhrase(w, extracted, corpus, mode);
    const norm = tokens(full).join(" ");
    if (seen.has(norm)) continue;
    seen.add(norm);
    kept.push(full);
    evidence[full] = full === w ? ev : groundPhrase(full, corpus, mode);
  }
  return { kept, removed, evidence };
}

/**
 * The corpus keeps only stems, so to SHOW "polo shirts" (not "polo shirt") the original wording is looked up in the pages.
 * Titles, headings, descriptions and link text are scanned first; body text only for phrases still not found, and only a limited
 * amount of it, with a time limit, because this runs inside an edge function.
 */
export function surfaceForms(
  pages: PageLike[],
  phrases: string[],
  budgetMs = 500,
): Map<string, string> {
  const t0 = Date.now();
  const want = new Map<string, string>(); // stemmed phrase -> given phrase
  let lo = 6,
    hi = 1;
  for (const p of phrases) {
    const key = tokens(p).join(" ");
    if (!key) continue;
    want.set(key, p);
    const n = key.split(" ").length;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
  }
  const found = new Map<string, Map<string, number>>();
  const scan = (raw?: string) => {
    if (!raw || !want.size) return;
    for (const u of units(raw, "heading")) {
      const words = fold(u).split(" ").filter(Boolean);
      const st = words.map(stem);
      for (let n = lo; n <= Math.min(hi, words.length); n++)
        for (let i = 0; i + n <= words.length; i++) {
          const key = st.slice(i, i + n).join(" ");
          if (!want.has(key)) continue;
          const m = found.get(key) ?? new Map<string, number>();
          const f = words.slice(i, i + n).join(" ");
          m.set(f, (m.get(f) ?? 0) + 1);
          found.set(key, m);
        }
    }
  };
  let c = 0;
  for (const p of pages) {
    scan(p.title);
    (p.h1s ?? []).forEach(scan);
    (p.h2s ?? []).forEach(scan);
    scan(p.description);
    (p.anchors ?? []).forEach(scan);
    if (++c % 50 === 0 && Date.now() - t0 > budgetMs) break;
  }
  if (found.size < want.size && Date.now() - t0 < budgetMs) {
    c = 0;
    for (const p of pages) {
      scan((p.text ?? "").slice(0, 1200));
      if (++c % 25 === 0 && Date.now() - t0 > budgetMs) break;
    }
  }
  const out = new Map<string, string>();
  for (const [key, original] of want) {
    const m = found.get(key);
    out.set(
      original,
      m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : original,
    );
  }
  return out;
}