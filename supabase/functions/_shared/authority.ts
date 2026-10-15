import { admin } from "./utils.ts";
import type { VerifiedSignals } from "./googlemetrics.ts";

/**
 * Authority score 0-100 built from every free signal we have, so one missing source never leaves the ring empty or wrong.
 *
 *  signal            source                                   meaning
 *  ----------------  ---------------------------------------  ------------------------------------------------
 *  link strength     Open PageRank 0-10                       link equity of the whole web graph (log scale)
 *  referring sites   your own verified backlink bank          how many different sites link to this domain
 *  search traffic    SEO traffic estimate                     how much Google traffic the site earns
 *  keywords          ranked keywords + saved top-10 results   how widely the site is visible in Google
 *  popularity        Tranco rank (top 1M)                     how many people visit the site overall
 *  real users        Chrome real-user data exists             the site has regular real visitors
 *  age / size        domain age, pages found                  small trust bonus
 *
 * Every signal is turned into 0-100, then a weighted average is taken over the signals that exist (weights are re-balanced).
 * A strong signal is never pulled down by a missing one: popularity and links are allowed to lift the result (see `lift`).
 */

export type AuthorityInput = {
  oprScore: number | null; // 0-10
  externalRefDomains?: number | null; // referring networks from the free Majestic Million dataset (optional, top 1M sites only)
  trancoRank: number | null;
  organicTraffic: number | null; // estimated monthly organic visits
  rankedKeywords: number | null;
  referringDomains: number | null; // from the backlink bank (known, not total)
  top10Appearances: number | null; // saved Google results where the domain is in the top 10
  realUsers: boolean; // Chrome real-user data found
  ageYears: number | null;
  pages: number | null;
  verified?: VerifiedSignals | null; // real numbers from the user's connected Google account (optional)
};

export type AuthorityParts = {
  key: string;
  label: string;
  value: number; // 0-100
  weight: number;
};

export type AuthorityResult = {
  score: number;
  parts: AuthorityParts[];
  confidence: "High" | "Medium" | "Low";
  version: 3;
  verified?: boolean; // true when real Google data (Search Console / Analytics) was used
  verifiedSources?: string[];
};

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const log10 = (n: number) => Math.log10(Math.max(1, n));

export function computeAuthority(i: AuthorityInput): AuthorityResult | null {
  const parts: AuthorityParts[] = [];
  const add = (key: string, label: string, v: number | null, w: number) => {
    if (v != null && Number.isFinite(v))
      parts.push({ key, label, value: Math.round(clamp(v)), weight: w });
  };

  // link strength: curve, because the 0-10 scale is logarithmic (1/10 ~ 14, 4/10 ~ 46, 6/10 ~ 64, 8/10 ~ 83)
  add(
    "links",
    "Link strength",
    i.oprScore != null ? 100 * Math.pow(clamp(i.oprScore, 0, 10) / 10, 0.85) : null,
    0.4,
  );

  // referring sites: 3 sites ~ 12, 30 ~ 37, 300 ~ 62, 3,000 ~ 87 (needs 3+ known: a domain nobody scanned has 0 known, not 0 real)
  // external index count and our own verified bank are both lower bounds, so the larger one is the better estimate
  const refs = Math.max(i.referringDomains ?? 0, i.externalRefDomains ?? 0);
  if (refs >= 3)
    add("refdomains", "Referring sites", (log10(refs) / 3.8) * 100, 0.25);

  // REAL Google data (user connected Search Console / Analytics): measured, so it replaces the estimates and counts fully
  const v = i.verified ?? null;
  const realVisits =
    v == null
      ? null
      : Math.max(v.organicSessions28 ?? 0, v.clicks28 ?? 0) || (v.clicks28 != null || v.organicSessions28 != null ? 0 : null);
  let vTrafficValue = 0;
  if (realVisits != null) {
    vTrafficValue = Math.pow(clamp(log10(realVisits + 1) / 8.5, 0, 1), 1.5) * 100;
    add("vtraffic", "Search visits (Google verified)", vTrafficValue, 0.3);
  }
  if (v?.queries != null && v.queries > 0)
    add("vkeywords", "Search phrases (Google verified)", (log10(v.queries) / 4.5) * 100, 0.15);

  // search traffic: 5K ~ 29, 50K ~ 43, 1M ~ 59, 50M ~ 85
  if (realVisits == null && i.organicTraffic != null && i.organicTraffic > 0)
    add(
      "traffic",
      "Search traffic",
      Math.pow(clamp(log10(i.organicTraffic + 1) / 8.5, 0, 1), 1.5) * 100,
      0.2,
    );

  // keyword visibility
  const kw = Math.max(i.rankedKeywords ?? 0, 0) + Math.max(i.top10Appearances ?? 0, 0) * 2;
  if (kw > 0 && v?.queries == null) add("keywords", "Keyword visibility", (log10(kw) / 4.5) * 100, 0.1);

  // popularity: Tranco top 1M only (rank 1 = 100, 1,000 = 85, 100,000 = 45, 1M = 25)
  if (i.trancoRank && i.trancoRank <= 1e6)
    add("rank", "Global popularity", clamp(100 - (log10(i.trancoRank) / 6) * 75), 0.15);

  if (!parts.length && !i.realUsers && !i.ageYears) return null;

  // Traffic and keyword counts come from a SAMPLE (only the keywords we could check), so they are lower bounds.
  // They may raise the score but never pull down what the link signals already prove.
  const SAMPLED = ["traffic", "keywords"]; // estimates from a sample; verified Google parts are NOT in this list
  const avg = (ps: AuthorityParts[]) => {
    const w = ps.reduce((a, p) => a + p.weight, 0);
    return w ? ps.reduce((a, p) => a + p.value * p.weight, 0) / w : null;
  };
  const linkBase = avg(parts.filter((p) => !SAMPLED.includes(p.key)));
  const sampled = avg(parts.filter((p) => SAMPLED.includes(p.key)));
  let score = 0;
  if (linkBase != null) {
    score = linkBase;
    if (sampled != null && sampled > linkBase) score += (sampled - linkBase) * 0.4;
  } else if (sampled != null) {
    score = sampled;
  }

  // lift: a strong global rank or a big link base proves strength even when other sources have no data (never lowers the score)
  const strong = parts
    .filter((p) => ["rank", "refdomains", "links"].includes(p.key))
    .reduce((m, p) => Math.max(m, p.value), 0);
  if (strong > score) score += Math.min(10, (strong - score) * 0.25);

  // small trust bonus: real visitors exist, old domain, big site (max +5)
  let bonus = 0;
  if (i.realUsers) bonus += 2;
  if (i.ageYears != null) bonus += clamp(i.ageYears / 10, 0, 1.5);
  if (i.pages != null && i.pages > 100) bonus += clamp(log10(i.pages / 100), 0, 1.5);
  score = Math.round(clamp(score + Math.min(5, bonus)));

  // Sanity cap: the web-wide link graph (Open PageRank) is the hardest signal to fake. A handful of known links, a small bank or a lucky
  // traffic estimate must not make a site with almost no link strength look strong. Rough calibration from one Semrush comparison
  // (OPR 1.0 ~ Authority 18); only applies to weak sites (OPR below 5), strong sites are not capped.
  // Real Google traffic proves the site has real strength, so verified data loosens the cap (up to about +9 for a busy site).
  if (i.oprScore != null && i.oprScore < 5) {
    score = Math.min(score, Math.round(12 + i.oprScore * 6 + vTrafficValue * 0.3));
  }

  // honest confidence: how many independent signals contributed
  const n = parts.length;
  const confidence = v != null || n >= 4 ? "High" : n >= 2 ? "Medium" : "Low";
  return {
    score,
    parts,
    confidence,
    version: 3,
    ...(v ? { verified: true, verifiedSources: v.sources } : {}),
  };
}

/** Counts from the data bank. Never throws: if the migration is missing the numbers are just null. */
export async function bankSignals(root: string): Promise<{
  referringDomains: number | null;
  top10Appearances: number | null;
}> {
  let referringDomains: number | null = null;
  let top10Appearances: number | null = null;
  try {
    const [lk, vis] = await Promise.all([
      admin().rpc("referring_domain_counts", { p_roots: [root] }),
      admin().rpc("domain_visibility", { p_domains: [root] }),
    ]);
    const a = (lk.data ?? [])[0] as { n: number } | undefined;
    const b = (vis.data ?? [])[0] as { n: number } | undefined;
    if (a) referringDomains = Number(a.n);
    if (b) top10Appearances = Number(b.n);
  } catch {
    /* data bank not available: ignore */
  }
  return { referringDomains, top10Appearances };
}