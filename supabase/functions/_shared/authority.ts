import { admin } from "./utils.ts";
import type { VerifiedSignals } from "./googlemetrics.ts";
import { linkSpam, profileSpam, type ProfileSpam } from "./spam.ts";

/**
 * Authority score 0-100 (v4). Built from free signals and calibrated so the world's biggest domains land at the top of the scale,
 * like Semrush Authority Score: LINKS + TRAFFIC first, then a SPAM penalty.
 *
 *  signal            source                                   meaning
 *  ----------------  ---------------------------------------  ------------------------------------------------
 *  link strength     Open PageRank 0-10                       link equity of the whole web graph (log scale)
 *  referring sites   backlink bank + Majestic (if known)      how many DIFFERENT sites link to this domain (log scale up to 1M)
 *  search traffic    SEO traffic estimate / Google verified   how much Google traffic the site earns (log scale up to 1B)
 *  keywords          ranked keywords + saved top-10 results   how widely the site is visible in Google
 *  popularity        Tranco rank (top 1M)                     how many people visit the site overall
 *  spam penalty      toxic share of the backlink bank         subtracts up to 30 points when the link profile looks bought / farmed
 *
 * v4 changes vs v3:
 *  - referring sites curve no longer saturates at ~6,000 sites: it runs to 1,000,000 so big sites separate from huge sites
 *  - traffic curve runs to 1 billion visits
 *  - spam / toxic links subtract from the score (v3 ignored spam completely)
 *  - result carries `relative`: tier, nearest reference domains, and the biggest gap to a top domain per signal
 */

export type AuthorityInput = {
  oprScore: number | null; // 0-10
  externalRefDomains?: number | null;
  trancoRank: number | null;
  organicTraffic: number | null;
  rankedKeywords: number | null;
  referringDomains: number | null;
  top10Appearances: number | null;
  realUsers: boolean;
  ageYears: number | null;
  pages: number | null;
  verified?: VerifiedSignals | null;
  spam?: ProfileSpam | null; // from bankSignals(): toxic share of known backlinks
};

export type AuthorityParts = { key: string; label: string; value: number; weight: number };

/** What a top domain looks like per signal (0-100 on our own curves). Used to show "gap to the top". */
export const TOP_TYPICAL: Record<string, number> = {
  links: 90,
  refdomains: 88,
  traffic: 85,
  vtraffic: 85,
  keywords: 85,
  vkeywords: 85,
  rank: 95,
};

/** Reference ladder. Approximate calibration, tune `min` after you compare a few domains with Semrush / Ahrefs. */
export const TIERS: { tier: string; min: number; examples: string[] }[] = [
  { tier: "Elite (world top 100)", min: 90, examples: ["google.com", "wikipedia.org", "youtube.com"] },
  { tier: "Global leader", min: 78, examples: ["nytimes.com", "shopify.com", "hubspot.com"] },
  { tier: "Established brand", min: 62, examples: ["semrush.com", "moz.com", "canva.com"] },
  { tier: "Strong niche player", min: 45, examples: ["backlinko.com", "neilpatel.com"] },
  { tier: "Growing site", min: 30, examples: ["regional publishers", "mid-size shops"] },
  { tier: "Emerging", min: 15, examples: ["new blogs", "local businesses"] },
  { tier: "New / very low", min: 0, examples: ["new domains"] },
];

export type Relative = {
  tier: string;
  nextTier: string | null;
  pointsToNextTier: number | null;
  similarTo: string[];
  biggestGaps: { key: string; label: string; yours: number; top: number; gap: number }[];
  estimatedTopPercent: string; // rough share of websites this score beats
};

export type AuthorityResult = {
  score: number;
  scoreBeforeSpam: number;
  spamPenalty: number;
  spam: ProfileSpam | null;
  parts: AuthorityParts[];
  confidence: "High" | "Medium" | "Low";
  relative: Relative;
  version: 4;
  verified?: boolean;
  verifiedSources?: string[];
};

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const log10 = (n: number) => Math.log10(Math.max(1, n));

function topPercent(score: number): string {
  if (score >= 90) return "top 0.01%";
  if (score >= 78) return "top 0.1%";
  if (score >= 62) return "top 1%";
  if (score >= 45) return "top 5%";
  if (score >= 30) return "top 15%";
  if (score >= 15) return "top 40%";
  return "bottom half";
}

function relative(score: number, parts: AuthorityParts[]): Relative {
  const idx = TIERS.findIndex((t) => score >= t.min);
  const cur = TIERS[idx];
  const next = idx > 0 ? TIERS[idx - 1] : null;
  const gaps = parts
    .map((p) => {
      const top = TOP_TYPICAL[p.key] ?? 85;
      return { key: p.key, label: p.label, yours: p.value, top, gap: Math.max(0, top - p.value) };
    })
    .sort((a, b) => b.gap * (parts.find((p) => p.key === b.key)?.weight ?? 0) - a.gap * (parts.find((p) => p.key === a.key)?.weight ?? 0))
    .slice(0, 3);
  return {
    tier: cur.tier,
    nextTier: next?.tier ?? null,
    pointsToNextTier: next ? next.min - score : null,
    similarTo: cur.examples,
    biggestGaps: gaps,
    estimatedTopPercent: topPercent(score),
  };
}

export function computeAuthority(i: AuthorityInput): AuthorityResult | null {
  const parts: AuthorityParts[] = [];
  const add = (key: string, label: string, v: number | null, w: number) => {
    if (v != null && Number.isFinite(v)) parts.push({ key, label, value: Math.round(clamp(v)), weight: w });
  };

  // link strength: Open PageRank 0-10 is logarithmic (1/10 ~ 14, 4/10 ~ 46, 6/10 ~ 64, 8/10 ~ 83)
  add("links", "Link strength", i.oprScore != null ? 100 * Math.pow(clamp(i.oprScore, 0, 10) / 10, 0.85) : null, 0.35);

  // referring sites, now calibrated to 1,000,000: 3 ~ 13, 30 ~ 32, 300 ~ 49, 3,000 ~ 65, 30,000 ~ 79, 1M ~ 100
  const refs = Math.max(i.referringDomains ?? 0, i.externalRefDomains ?? 0);
  if (refs >= 3) add("refdomains", "Referring sites", 100 * Math.pow(clamp(log10(refs) / 6, 0, 1), 0.8), 0.25);

  // REAL Google data replaces estimates
  const v = i.verified ?? null;
  const realVisits =
    v == null
      ? null
      : Math.max(v.organicSessions28 ?? 0, v.clicks28 ?? 0) || (v.clicks28 != null || v.organicSessions28 != null ? 0 : null);
  const trafficCurve = (n: number) => Math.pow(clamp(log10(n + 1) / 9, 0, 1), 1.4) * 100; // 5K ~ 25, 100K ~ 42, 1M ~ 53, 100M ~ 76, 1B ~ 100
  let vTrafficValue = 0;
  if (realVisits != null) {
    vTrafficValue = trafficCurve(realVisits);
    add("vtraffic", "Search visits (Google verified)", vTrafficValue, 0.3);
  }
  if (v?.queries != null && v.queries > 0) add("vkeywords", "Search phrases (Google verified)", (log10(v.queries) / 5) * 100, 0.15);

  if (realVisits == null && i.organicTraffic != null && i.organicTraffic > 0)
    add("traffic", "Search traffic", trafficCurve(i.organicTraffic), 0.2);

  const kw = Math.max(i.rankedKeywords ?? 0, 0) + Math.max(i.top10Appearances ?? 0, 0) * 2;
  if (kw > 0 && v?.queries == null) add("keywords", "Keyword visibility", (log10(kw) / 5) * 100, 0.1);

  // popularity (Tranco): rank 1 = 100, 1,000 = 85, 100,000 = 45, 1M = 25
  if (i.trancoRank && i.trancoRank <= 1e6) add("rank", "Global popularity", clamp(100 - (log10(i.trancoRank) / 6) * 75), 0.15);

  if (!parts.length && !i.realUsers && !i.ageYears) return null;

  // traffic / keywords come from a sample: they can raise the score, never pull down what link signals prove
  const SAMPLED = ["traffic", "keywords"];
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
  } else if (sampled != null) score = sampled;

  // lift: a strong rank / big link base proves strength even when other sources are empty
  const strong = parts.filter((p) => ["rank", "refdomains", "links"].includes(p.key)).reduce((m, p) => Math.max(m, p.value), 0);
  if (strong > score) score += Math.min(10, (strong - score) * 0.25);

  let bonus = 0;
  if (i.realUsers) bonus += 2;
  if (i.ageYears != null) bonus += clamp(i.ageYears / 10, 0, 1.5);
  if (i.pages != null && i.pages > 100) bonus += clamp(log10(i.pages / 100), 0, 1.5);
  score = Math.round(clamp(score + Math.min(5, bonus)));

  // sanity cap for weak sites (OPR below 5)
  if (i.oprScore != null && i.oprScore < 5) score = Math.min(score, Math.round(12 + i.oprScore * 6 + vTrafficValue * 0.3));

  // SPAM PENALTY (new): a profile full of toxic links is not real authority
  const scoreBeforeSpam = score;
  const penalty = i.spam?.penalty ?? 0;
  score = Math.round(clamp(score - penalty));

  const n = parts.length;
  const confidence = v != null || n >= 4 ? "High" : n >= 2 ? "Medium" : "Low";
  return {
    score,
    scoreBeforeSpam,
    spamPenalty: penalty,
    spam: i.spam ?? null,
    parts,
    confidence,
    relative: relative(score, parts),
    version: 4,
    ...(v ? { verified: true, verifiedSources: v.sources } : {}),
  };
}

/** Counts + spam profile from the data bank. Never throws: if the migration is missing the numbers are just null. */
export async function bankSignals(root: string): Promise<{
  referringDomains: number | null;
  top10Appearances: number | null;
  spam: ProfileSpam | null;
}> {
  let referringDomains: number | null = null;
  let top10Appearances: number | null = null;
  let spam: ProfileSpam | null = null;
  try {
    const [lk, vis, links] = await Promise.all([
      admin().rpc("referring_domain_counts", { p_roots: [root] }),
      admin().rpc("domain_visibility", { p_domains: [root] }),
      admin()
        .from("backlink_links")
        .select("source_domain,anchor,rel,authority,placement")
        .eq("target_root", root)
        .is("lost_at", null)
        .limit(400),
    ]);
    const a = (lk.data ?? [])[0] as { n: number } | undefined;
    const b = (vis.data ?? [])[0] as { n: number } | undefined;
    if (a) referringDomains = Number(a.n);
    if (b) top10Appearances = Number(b.n);
    const rows = (links.data ?? []) as { source_domain: string; anchor: string | null; rel: string | null; authority: number | null; placement: string | null }[];
    if (rows.length) {
      spam = profileSpam(
        rows.map((r) => ({
          verified: true,
          anchorType: null,
          spam: linkSpam({ domain: r.source_domain, anchor: r.anchor, rel: r.rel, authority: r.authority, placement: r.placement }),
        })),
      );
    }
  } catch {
    /* data bank not available: ignore */
  }
  return { referringDomains, top10Appearances, spam };
}
