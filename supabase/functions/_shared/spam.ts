// Spam / toxicity scoring for backlinks and for a whole link profile.
// Free signals only (no paid API). Every rule is explainable: the UI can show WHY a link is flagged.
//
//  Link level   -> spamScore 0-100 (higher = worse) + reasons[] + level: clean | watch | toxic
//  Profile level -> toxicShare, spamRisk 0-100, penalty (points to subtract from authority)

export type SpamInput = {
  domain: string;
  title?: string | null;
  anchor?: string | null;
  anchorType?: string | null;
  rel?: string | null;
  placement?: string | null;
  outbound?: number | null; // different external sites the linking page points to
  authority?: number | null; // 0-100 authority of the linking domain
  links?: number; // links from that page to the target
};

export type SpamLevel = "clean" | "watch" | "toxic";
export type SpamResult = { score: number; level: SpamLevel; reasons: string[] };

// TLDs that are heavily abused (cheap / free registrations). A flag on its own is weak, so it only adds a few points.
const RISKY_TLD = new Set([
  "xyz", "top", "click", "loan", "work", "gq", "ml", "cf", "tk", "ga", "icu", "buzz", "rest",
  "monster", "cyou", "sbs", "bid", "win", "party", "review", "trade", "stream", "download", "men", "date",
]);
const TRUST_TLD = /\.(edu|gov|ac\.[a-z]{2}|gov\.[a-z]{2}|edu\.[a-z]{2}|mil)$/i;

// Topics that dominate link-farm / PBN / hacked-site networks.
const SPAM_WORDS =
  /\b(casino|poker|betting|bet365|slot(s)?|gambl\w*|viagra|cialis|pharma\w*|pills?|payday|loans?|escort|porn\w*|xxx|adult|replica|fake\s?(id|passport)|cheap\s?(jerseys|nfl|nike)|essay\s?writ\w*|buy\s?followers|crypto\s?signal|forex\s?signal|keto|cbd\s?oil|seo\s?(service|package)s?|backlinks?\s?(for\s?sale|service)|guest\s?post(s|ing)?\s?(service|for\s?sale))\b/i;

// Spam in non-English too (Urdu/Hindi romanised, Arabic, Russian, Chinese) - common on hacked sites.
const SPAM_WORDS_INTL = /(赌场|博彩|彩票|казино|ставк|порно|كازينو|قمار|सट्टा|जुआ)/i;

const COMMERCIAL_ANCHOR =
  /\b(buy|cheap|best price|discount|coupon|order online|free download|cracked?|nulled|mod apk|hack tool|online casino|near me)\b/i;

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));

/** "bestcheap-casino-online24.xyz" style domains */
function domainSignals(domain: string): { pts: number; reasons: string[] } {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const parts = d.split(".");
  const tld = parts[parts.length - 1];
  const name = parts.length > 1 ? parts[parts.length - 2] : d;
  let pts = 0;
  const reasons: string[] = [];

  if (TRUST_TLD.test(d)) return { pts: -25, reasons: [] }; // edu / gov sites are almost never spam
  if (RISKY_TLD.has(tld)) {
    pts += 12;
    reasons.push(`Risky domain ending .${tld}`);
  }
  if ((name.match(/-/g) ?? []).length >= 3) {
    pts += 12;
    reasons.push("Many hyphens in the domain name");
  }
  if (/\d{4,}/.test(name) || (/\d/.test(name) && name.length > 18)) {
    pts += 8;
    reasons.push("Numbers in a long domain name");
  }
  if (name.length > 28) {
    pts += 8;
    reasons.push("Very long domain name");
  }
  if (SPAM_WORDS.test(name.replace(/-/g, " ")) || SPAM_WORDS_INTL.test(name)) {
    pts += 30;
    reasons.push("Spam topic in the domain name");
  }
  // keyword-stuffed exact-match domains: 4+ common commercial words glued together
  const stuffed = (name.match(/(best|cheap|buy|online|top|free|review|price|shop|store|deals?|seo|link|rank|traffic)/g) ?? []).length;
  if (stuffed >= 3) {
    pts += 12;
    reasons.push("Keyword-stuffed domain name");
  }
  return { pts, reasons };
}

export function linkSpam(i: SpamInput): SpamResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    score += pts;
    reasons.push(why);
  };

  const ds = domainSignals(i.domain);
  score += ds.pts;
  reasons.push(...ds.reasons);

  const text = `${i.title ?? ""} ${i.anchor ?? ""}`;
  if (SPAM_WORDS.test(text) || SPAM_WORDS_INTL.test(text)) add(28, "Spam topic on the page or in the link text");
  if (i.anchor && COMMERCIAL_ANCHOR.test(i.anchor)) add(10, "Money-style anchor text");

  // link-farm behaviour: the page links out to a huge number of different sites
  const out = i.outbound ?? null;
  if (out != null) {
    if (out > 300) add(22, `Page links to ${out}+ different sites (link farm pattern)`);
    else if (out > 150) add(14, `Page links to ${out} different sites`);
    else if (out > 80) add(6, "Page links to many different sites");
  }

  if (i.placement === "comment") add(14, "Link left in a comment");
  else if (i.placement === "footer") add(5, "Link in a footer (sitewide pattern)");
  if (i.rel === "sponsored") add(6, "Paid (sponsored) link");

  if ((i.links ?? 1) >= 6) add(10, "Same page links many times to you");

  // a weak linking domain is only suspicious when something else is also wrong
  const a = i.authority;
  if (a != null) {
    if (a < 8 && score >= 10) add(10, "Very low authority linking site");
    else if (a >= 55 && score < 40) score -= 10; // strong, trusted site: spam rules are probably false alarms
  }

  score = Math.round(clamp(score));
  const level: SpamLevel = score >= 50 ? "toxic" : score >= 25 ? "watch" : "clean";
  return { score, level, reasons: [...new Set(reasons)].slice(0, 5) };
}

export type ProfileSpam = {
  toxicLinks: number;
  watchLinks: number;
  cleanLinks: number;
  toxicShare: number; // 0-1, of the links that were scored
  anchorOverOptimised: boolean; // too many exact keyword anchors
  spamRisk: number; // 0-100
  riskLabel: "Low" | "Moderate" | "High" | "Severe";
  penalty: number; // points subtracted from authority (0-30)
};

/** Share of toxic links, anchor over-optimisation and link-farm pressure -> a single risk number. */
export function profileSpam(
  rows: { spam?: SpamResult | null; anchorType?: string | null; verified?: boolean }[],
): ProfileSpam {
  const ver = rows.filter((r) => r.verified !== false && r.spam);
  const n = ver.length;
  const toxic = ver.filter((r) => r.spam!.level === "toxic").length;
  const watch = ver.filter((r) => r.spam!.level === "watch").length;
  const toxicShare = n ? toxic / n : 0;
  const kw = ver.filter((r) => r.anchorType === "keyword").length;
  const anchorOver = n >= 10 && kw / n > 0.35;

  // small samples are noisy: scale the risk up slowly until there are 20 links to judge
  const confidence = Math.min(1, n / 20);
  const raw = (toxicShare * 100 + (watch / Math.max(1, n)) * 25) * (0.5 + 0.5 * confidence) + (anchorOver ? 8 : 0);
  const spamRisk = Math.round(clamp(raw));
  const riskLabel = spamRisk >= 60 ? "Severe" : spamRisk >= 35 ? "High" : spamRisk >= 15 ? "Moderate" : "Low";
  // penalty: 0 when risk < 10, then up to 30 points off authority
  const penalty = Math.round(clamp((spamRisk - 10) * 0.4, 0, 30));
  return { toxicLinks: toxic, watchLinks: watch, cleanLinks: n - toxic - watch, toxicShare, anchorOverOptimised: anchorOver, spamRisk, riskLabel, penalty };
}
