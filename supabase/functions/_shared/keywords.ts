// Keyword maths for the Domain Research page. Pure functions only (no network), so they are easy to test.
// Everything here uses FREE signals: real Google positions, SERP features, Google autocomplete, Tranco rank.
// It never pretends to know exact search volume or backlinks. Every number that is a guess says so in the UI.

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------------------------------------
// 0. Junk filter: utility pages (privacy, cart, login...) are not keywords anyone targets or ranks for
// ---------------------------------------------------------------------------------------------------------

const JUNK_EXACT =
  /^(?:about(?: us| me)?|contact(?: us| me)?|get in touch|privacy(?: policy| notice| statement)?|terms(?: (?:and|&) conditions| of (?:service|use|sale))?|conditions of (?:use|sale)|cookies?(?: policy| settings| notice)?|refund(?: policy)?|returns?(?: policy| (?:and|&) exchanges)?|shipping(?: policy| info| information| (?:and|&) delivery)?|delivery(?: information| policy)?|(?:your |my |the |shopping )?(?:cart|basket|bag)|checkout|(?:my |your |create |create an )?account|log ?in|sign ?in|sign ?up|register|(?:reset|forgot|change)(?: your| my)? password|password reset|wish ?list|site ?map|search(?: results)?|faqs?|frequently asked questions|thank you|page not found|404(?: error| not found)?|not found|home(?: ?page)?|welcome|blog|news|track(?: your| my)? order|order(?: tracking| status)|unsubscribe|accessibility(?: statement)?|disclaimer|legal(?: notice)?)$/;
const JUNK_INSIDE =
  /\b(?:privacy policy|terms (?:and|&) conditions|terms of (?:service|use)|cookie policy|refund policy|return policy|shipping policy|reset (?:your )?password|forgot (?:your )?password|your cart|my account|log in|sign in)\b/;

export function isJunkPhrase(phrase: string) {
  const p = phrase
    .toLowerCase()
    .replace(/[^a-z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !p || JUNK_EXACT.test(p) || JUNK_INSIDE.test(p);
}

const UTILITY_SEGMENTS = new Set([
  "cart",
  "checkout",
  "account",
  "my-account",
  "login",
  "log-in",
  "signin",
  "sign-in",
  "register",
  "signup",
  "sign-up",
  "wishlist",
  "search",
  "policies",
  "privacy",
  "privacy-policy",
  "terms",
  "terms-of-service",
  "terms-and-conditions",
  "terms-conditions",
  "refund-policy",
  "shipping-policy",
  "return-policy",
  "returns",
  "cookie-policy",
  "contact",
  "contact-us",
  "about",
  "about-us",
  "faq",
  "faqs",
  "sitemap",
  "thank-you",
  "orders",
  "order-tracking",
  "track-order",
  "password",
  "reset-password",
  "forgot-password",
  "unsubscribe",
  "404",
]);

// Utility pages are recognised by an exact path segment in the first three levels (so a blog post called /blog/privacy-tips is kept).
export function isUtilityUrl(url: string) {
  try {
    const segs = new URL(url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean)
      .slice(0, 3)
      .map((x) => x.replace(/\.[a-z]+$/, ""));
    return segs.some((x) => UTILITY_SEGMENTS.has(x));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// 1. Click-through rate by position, corrected for what else is on the results page
// ---------------------------------------------------------------------------------------------------------

const CTR_TOP10 = [
  0.276, 0.158, 0.11, 0.08, 0.062, 0.049, 0.04, 0.033, 0.028, 0.025,
]; // blended mobile + desktop
export function ctrAt(pos: number) {
  if (pos <= 10) return CTR_TOP10[Math.max(1, Math.round(pos)) - 1];
  if (pos <= 20) return 0.012 - (pos - 11) * 0.0008;
  if (pos <= 30) return 0.004;
  return 0.002;
}

export type Features = {
  ads: number;
  shopping: boolean;
  paa: number;
  answerBox: boolean;
  knowledgeGraph: boolean;
  videos: boolean;
  images: boolean;
  places: boolean;
  topStories: boolean;
};

export function extractFeatures(j: any): Features {
  const has = (k: string) => Array.isArray(j?.[k]) && j[k].length > 0;
  return {
    ads: Array.isArray(j?.ads) ? j.ads.length : 0,
    shopping: has("shopping"),
    paa: Array.isArray(j?.peopleAlsoAsk) ? j.peopleAlsoAsk.length : 0,
    answerBox: !!j?.answerBox,
    knowledgeGraph: !!j?.knowledgeGraph,
    videos: has("videos"),
    images: has("images"),
    places: has("places"),
    topStories: has("topStories"),
  };
}

// Ads, shopping boxes, answer boxes and maps push organic results down and take clicks. Rule-of-thumb multipliers
// (published CTR studies agree on the direction, not on exact values), never below 45% of the plain curve.
export function featureFactor(f?: Features | null) {
  if (!f) return 1;
  let m = 1;
  if (f.ads >= 3) m *= 0.82;
  else if (f.ads > 0) m *= 0.9;
  if (f.shopping) m *= 0.85;
  if (f.answerBox) m *= 0.85;
  if (f.places) m *= 0.85;
  if (f.knowledgeGraph) m *= 0.92;
  if (f.paa >= 3) m *= 0.95;
  if (f.videos) m *= 0.95;
  if (f.topStories) m *= 0.95;
  return Math.max(0.45, Math.round(m * 100) / 100);
}

// ---------------------------------------------------------------------------------------------------------
// 2. Search volume sanity checks (free Google signals keep the AI number from drifting)
// ---------------------------------------------------------------------------------------------------------

export type KeywordEvidence = {
  ac: number | null; // how many autocomplete suggestions start with the full phrase (null = unknown)
  acRank?: number | null; // position of the phrase inside autocomplete of its own shorter prefix: 0 = first, -1 = not suggested, null = unknown
  commercial: boolean; // ads or shopping boxes on the result page
  ads?: number;
};

export function adjustVolume(ai: number, ev: KeywordEvidence) {
  let lo = 10,
    hi = Infinity;
  if (ev.ac != null) {
    if (ev.ac === 0) hi = 50;
    else if (ev.ac <= 2) hi = 400;
    else if (ev.ac >= 6) lo = 150;
    else lo = 30;
  }
  if (ev.acRank != null) {
    if (ev.acRank === 0)
      lo = Math.max(lo, 120); // Google's own first suggestion: people really type it
    else if (ev.acRank > 0 && ev.acRank <= 2) lo = Math.max(lo, 60);
    else if (ev.acRank > 2) lo = Math.max(lo, 25);
    else if (ev.acRank === -1 && ev.ac === 0) hi = Math.min(hi, 40); // not suggested anywhere: a rare phrase
  }
  if (ev.commercial) lo = Math.max(lo, 100); // advertisers only bid on phrases people search
  if ((ev.ads ?? 0) >= 3) lo = Math.max(lo, 200);
  return Math.round(Math.min(Math.max(ai, lo), Math.max(hi, lo)));
}

export const niceNum = (n: number) => {
  if (n < 10) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
};

// An honest range around the volume: the more independent signals agree, the narrower it gets.
export function volumeRange(vol: number, ev?: KeywordEvidence | null) {
  const signals =
    (ev?.ac != null ? 1 : 0) + (ev?.acRank != null ? 1 : 0) + (ev ? 1 : 0);
  const spread = signals >= 3 ? 1.8 : signals === 2 ? 2.2 : 3;
  return {
    low: Math.max(10, niceNum(vol / spread)),
    high: niceNum(vol * spread),
    spread,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 3. Keyword Difficulty (0-100), the idea behind Ahrefs KD / Semrush KD, built from free data.
//    Ahrefs uses backlinks of the top 10. We cannot get backlinks, so we use how strong each ranking DOMAIN is
//    (Tranco rank: popularity of the domain on the whole web) plus how crowded and commercial the page is.
// ---------------------------------------------------------------------------------------------------------

// Tranco rank -> 0.05 .. 1. Rank 1,000 or better = 1.0; rank 1,000,000 = 0.09; not in the list = 0.05.
export function strengthFromRank(rank: number | null | undefined) {
  if (!rank || rank < 1) return 0.05;
  return clamp((6.3 - Math.log10(rank)) / 3.3, 0.05, 1);
}

export type SerpDomain = { p: number; d: string; home?: boolean };

export function kdLabel(kd: number | null) {
  if (kd == null) return "Unknown";
  return kd < 15
    ? "Very easy"
    : kd < 30
      ? "Easy"
      : kd < 50
        ? "Possible"
        : kd < 70
          ? "Hard"
          : kd < 85
            ? "Very hard"
            : "Super hard";
}

export function keywordDifficulty(
  serp: { domains: SerpDomain[]; titleMatches: number },
  strength: Record<string, number | undefined>,
  features?: Features | null,
) {
  const hits = serp.domains.slice(0, 10);
  if (!hits.length)
    return { kd: null as number | null, label: "Unknown", known: 0 };
  let s = 0,
    wSum = 0,
    known = 0;
  hits.forEach((h, i) => {
    const w = 1 / Math.sqrt(i + 1); // the first results matter most
    const st = strength[h.d];
    if (st !== undefined) known++;
    s += w * (st ?? 0.25); // unknown domain: assume a small-to-medium site
    wSum += w;
  });
  let kd = (100 * s) / wSum;
  kd += Math.min(6, hits.filter((h) => h.home).length * 2); // home pages ranking = a strong site, not just a strong page
  kd += serp.titleMatches >= 6 ? 5 : serp.titleMatches >= 4 ? 2 : 0; // many pages target this exact phrase
  if (features)
    kd +=
      (features.ads >= 3 ? 4 : features.ads > 0 ? 2 : 0) +
      (features.shopping ? 3 : 0);
  kd = Math.round(clamp(kd, 1, 100));
  return {
    kd,
    label: kdLabel(kd),
    known: Math.round((known / hits.length) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 4. Search intent
// ---------------------------------------------------------------------------------------------------------

export type Intent =
  "Transactional" | "Commercial" | "Informational" | "Navigational";

export function classifyIntent(
  keyword: string,
  brand?: string,
  commercial = false,
): Intent {
  const k = keyword.toLowerCase();
  if (brand && brand.length >= 3 && k.includes(brand.toLowerCase()))
    return "Navigational";
  if (
    /\b(login|log in|sign in|official site|official website|customer service|contact number)\b/.test(
      k,
    )
  )
    return "Navigational";
  if (
    /\b(buy|price|prices|pricing|cheap|cheapest|discount|deal|deals|coupon|order|shop|for sale|near me|hire|book|quote|cost|sale)\b/.test(
      k,
    )
  )
    return "Transactional";
  if (
    /\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|rated|worth it)\b/.test(
      k,
    )
  )
    return "Commercial";
  if (
    /^(how|what|why|when|where|who|which|can|does|do|is|are|should)\b|\b(guide|tutorial|tips|ideas|examples|meaning|definition|learn|difference|how to|symptoms|causes)\b/.test(
      k,
    )
  )
    return "Informational";
  if (commercial) return "Transactional";
  // product or place wording with no question word: people are shopping around ("electric bikes uk", "1000w kit")
  if (
    /\d|\b(?:kit|kits|set|pack|bundle|model|pro|uk|usa|us|canada|australia|pakistan|dubai|online)\b/.test(
      k,
    )
  )
    return "Commercial";
  return "Informational";
}

// ---------------------------------------------------------------------------------------------------------
// 5. Opportunity score (0-100) and what to do about each keyword
// ---------------------------------------------------------------------------------------------------------

export type Action =
  | "Defend"
  | "Quick win"
  | "Push up"
  | "New content"
  | "Consider"
  | "Long shot"
  | "Improve";

export function opportunity(i: {
  volume: number;
  kd: number | null;
  position: number | null;
  features?: Features | null;
}) {
  const ff = featureFactor(i.features);
  const pos = i.position;
  const potential = i.volume * ctrAt(3) * ff; // visits per month if the page reached #3
  const current = pos ? i.volume * ctrAt(pos) * ff : 0;
  const gain = Math.max(0, potential - current);
  const demand = clamp(Math.log10(i.volume + 1) / 4, 0, 1); // 10,000 searches = 1.0
  const ease = i.kd == null ? 0.5 : 1 - i.kd / 100;
  const gainScore = clamp(Math.log10(gain + 1) / 3.5, 0, 1);
  // pages at 4-20 are one good edit away from page 1; not ranking at all means new content must be written
  const reach = !pos
    ? 0.7
    : pos <= 3
      ? 0.15
      : pos <= 10
        ? 0.95
        : pos <= 20
          ? 1
          : 0.85;
  const score = Math.round(
    100 * (0.4 * gainScore + 0.35 * ease + 0.25 * demand) * reach,
  );
  let action: Action;
  if (pos && pos <= 3) action = "Defend";
  else if (pos && pos <= 20)
    action = i.kd == null || i.kd < 60 ? "Quick win" : "Push up";
  else if (pos) action = "Improve";
  else if (i.kd != null && i.kd < 45 && i.volume >= 50) action = "New content";
  else action = i.kd != null && i.kd >= 65 ? "Long shot" : "Consider";
  return {
    score: clamp(score, 0, 100),
    gain: Math.round(gain * 10) / 10,
    potential: Math.round(potential * 10) / 10,
    action,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 6. Countries: one country, the whole world (top markets), or a content topic view
// ---------------------------------------------------------------------------------------------------------

export type Scope = "country" | "world" | "topic";
export const parseScope = (s: unknown): Scope =>
  s === "world" || s === "topic" ? s : "country";
const WORLD = ["us", "gb", "in", "ca", "au", "de", "ae", "pk", "fr", "sa"];

// "country" and "topic" check the chosen country only (cheaper and cleaner). "world" adds 5 more big markets.
export const scopeCountries = (scope: Scope, gl: string) =>
  scope === "world" ? [gl, ...WORLD.filter((c) => c !== gl).slice(0, 5)] : [gl];

// ---------------------------------------------------------------------------------------------------------
// 7. Topics (content-wise view): group keywords that share their main word
// ---------------------------------------------------------------------------------------------------------

const TOPIC_STOP = new Set(
  "best cheap buy online near with from your for the and how what why which can does are you uk usa price prices cost review reviews top new used sale shop store".split(
    " ",
  ),
);
const stem = (w: string) =>
  w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
const toks = (k: string) =>
  [
    ...new Set(
      k
        .toLowerCase()
        .replace(/\(brand\)/g, "")
        .match(/[a-z0-9]{3,}/g) ?? [],
    ),
  ]
    .map(stem)
    .filter((w) => !TOPIC_STOP.has(w) && !/^\d+$/.test(w));

export type TopicItem = {
  keyword: string;
  volume: number;
  visits: number;
  position: number | null;
  kd: number | null;
};

export function groupTopics(items: TopicItem[]) {
  const live = items.filter((x) => !x.keyword.endsWith("(brand)"));
  const df = new Map<string, number>();
  for (const x of live)
    for (const t of toks(x.keyword)) df.set(t, (df.get(t) ?? 0) + 1);
  const groups = new Map<string, TopicItem[]>();
  for (const x of live) {
    const best =
      toks(x.keyword)
        .filter((t) => (df.get(t) ?? 0) >= 2)
        .sort((a, b) => df.get(b)! - df.get(a)! || a.localeCompare(b))[0] ??
      "other";
    (groups.get(best) ?? groups.set(best, []).get(best)!).push(x);
  }
  const totalVol = live.reduce((a, x) => a + x.volume, 0) || 1;
  return [...groups.entries()]
    .map(([topic, list]) => {
      const ranked = list.filter((x) => x.position);
      const kds = list.filter((x) => x.kd != null);
      const volume = list.reduce((a, x) => a + x.volume, 0);
      return {
        topic,
        keywords: list.length,
        ranking: ranked.length,
        volume,
        volumeShare: Math.round((volume / totalVol) * 100),
        visits: Math.round(list.reduce((a, x) => a + x.visits, 0) * 10) / 10,
        avgPosition: ranked.length
          ? Math.round(
              (ranked.reduce((a, x) => a + (x.position ?? 0), 0) /
                ranked.length) *
                10,
            ) / 10
          : null,
        avgKd: kds.length
          ? Math.round(kds.reduce((a, x) => a + (x.kd ?? 0), 0) / kds.length)
          : null,
        examples: list
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 3)
          .map((x) => x.keyword),
      };
    })
    .sort((a, b) =>
      a.topic === "other" ? 1 : b.topic === "other" ? -1 : b.volume - a.volume,
    )
    .slice(0, 14);
}

// ---------------------------------------------------------------------------------------------------------
// 8. Share of voice: who owns the visibility across the checked keywords (Semrush "competitive positioning")
// ---------------------------------------------------------------------------------------------------------

export type SovKeyword = {
  volume: number;
  ff: number;
  ownPosition: number | null;
  domains: SerpDomain[];
};

export function shareOfVoice(
  keywords: SovKeyword[],
  ownRoot: string,
  isPlatform: (d: string) => boolean,
) {
  const map = new Map<
    string,
    { visibility: number; keywords: number; posSum: number }
  >();
  const add = (d: string, pos: number, vis: number) => {
    const e = map.get(d) ?? { visibility: 0, keywords: 0, posSum: 0 };
    e.visibility += vis;
    e.keywords++;
    e.posSum += pos;
    map.set(d, e);
  };
  for (const k of keywords) {
    for (const h of k.domains)
      if (h.d !== ownRoot) add(h.d, h.p, k.volume * ctrAt(h.p) * k.ff);
    if (k.ownPosition)
      add(ownRoot, k.ownPosition, k.volume * ctrAt(k.ownPosition) * k.ff);
  }
  const total = [...map.values()].reduce((a, e) => a + e.visibility, 0) || 1;
  return [...map.entries()]
    .map(([domain, e]) => ({
      domain,
      own: domain === ownRoot,
      platform: isPlatform(domain),
      keywords: e.keywords,
      avgPosition: Math.round((e.posSum / e.keywords) * 10) / 10,
      visibility: Math.round(e.visibility),
      share: Math.round((e.visibility / total) * 1000) / 10,
    }))
    .sort((a, b) => b.visibility - a.visibility)
    .slice(0, 12);
}

// ---------------------------------------------------------------------------------------------------------
// 9. Compare with the previous saved run of the same site: what grew, what fell
// ---------------------------------------------------------------------------------------------------------

type RunLike = { created_at?: string; result?: any } | null | undefined;

export function compareRuns(
  prev: RunLike,
  cur: {
    rankings: { keyword: string; position: number | null; error?: string }[];
    visitsMid: number | null;
    health: number;
  },
) {
  if (!prev?.result) return null;
  const before = new Map<string, number | null>();
  for (const r of (prev.result.rankings ?? []) as {
    keyword: string;
    position: number | null;
    error?: string;
  }[])
    if (!r.error) before.set(r.keyword, r.position);
  const moves: {
    keyword: string;
    from: number | null;
    to: number | null;
    delta: number;
    kind: "new rank" | "lost" | "up" | "down" | "new keyword";
  }[] = [];
  let up = 0,
    down = 0,
    gained = 0,
    lost = 0,
    fresh = 0,
    same = 0;
  for (const r of cur.rankings) {
    if (r.error) continue;
    if (!before.has(r.keyword)) {
      fresh++;
      if (r.position)
        moves.push({
          keyword: r.keyword,
          from: null,
          to: r.position,
          delta: 0,
          kind: "new keyword",
        });
      continue;
    }
    const from = before.get(r.keyword) ?? null,
      to = r.position;
    if (from == null && to != null) {
      gained++;
      moves.push({
        keyword: r.keyword,
        from,
        to,
        delta: 100 - to,
        kind: "new rank",
      });
    } else if (from != null && to == null) {
      lost++;
      moves.push({
        keyword: r.keyword,
        from,
        to,
        delta: -(100 - from),
        kind: "lost",
      });
    } else if (from != null && to != null && from !== to) {
      if (to < from) up++;
      else down++;
      moves.push({
        keyword: r.keyword,
        from,
        to,
        delta: from - to,
        kind: to < from ? "up" : "down",
      });
    } else same++;
  }
  const prevVisits = prev.result?.traffic?.seo?.organic?.mid ?? null;
  const visits =
    prevVisits != null && cur.visitsMid != null
      ? {
          from: prevVisits,
          to: cur.visitsMid,
          pct: prevVisits
            ? Math.round(((cur.visitsMid - prevVisits) / prevVisits) * 1000) /
              10
            : null,
        }
      : null;
  return {
    since: prev.created_at ?? null,
    healthDelta:
      typeof prev.result?.meta?.health === "number"
        ? cur.health - prev.result.meta.health
        : null,
    visits,
    up,
    down,
    gained,
    lost,
    same,
    fresh,
    moves: moves
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 20),
  };
}
