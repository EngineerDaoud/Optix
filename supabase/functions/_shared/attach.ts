import { keywordVolumes } from "./traffic.ts";
import {
  bankDomainKeywords,
  type BankKeyword,
  type PendingKeyword,
} from "./universe.ts";
import {
  classifyIntent,
  ctrAt,
  featureFactor,
  kdLabel,
  opportunity,
  type Features,
} from "./keywords.ts";

// Attaches what the data bank ALREADY knows about a domain to the ranking table of a new search.
//
// In plain words:
//   1. A user searches a site. The tool checks a sample of keywords live (Google results) like before.
//   2. The data bank (serp_positions + keyword_bank) is asked: "which OTHER keywords has this domain ever been seen ranking for?"
//      Those keywords were saved by earlier searches of any user, so they cost no new Google call.
//   3. Keywords that have a position but no search volume yet get their volume now (one AI call, in batches). The numbers are
//      saved in keyword_bank, so the next search of any site that ranks for the same keywords already has them. This is how the
//      bank "trains" itself with every search, the same idea the paid tools use: a growing keyword -> ranking-domains index.
//   4. Everything is turned into the same row shape as a live-checked keyword (volume, difficulty, intent, visits, opportunity),
//      marked with source "bank" so the screen can tell the two apart.
// Everything is best effort: if the bank is empty or a step fails, the search works exactly as before.

export type BankAttach = {
  rows: BankKeyword[];
  unvolumed: number;
  pending: PendingKeyword[];
  filled: number; // volumes that were missing and have just been created (and saved) by this call
};

/**
 * Reads the bank for a domain and, when `fill` is true, asks for the volume of the keywords that have none yet (best positions first).
 * The returned `rows` can go straight into seoEstimate (traffic) and into bankTableRows (keyword table).
 */
export async function loadBankForDomain(
  domain: string,
  country: string,
  opts: { fill: boolean; fillLimit?: number } = { fill: true },
): Promise<BankAttach> {
  const base = await bankDomainKeywords(domain, country, 1500);
  let filled = 0;
  if (opts.fill && base.pending.length) {
    const pick = base.pending.slice(0, opts.fillLimit ?? 60);
    try {
      const res = await keywordVolumes(
        pick.map((p) => p.keyword),
        [country],
      );
      // "guess" means the AI was down and the numbers come from phrase length only: those are never shown as real data
      if (res.source === "ai") {
        const done = new Set<string>();
        for (const p of pick) {
          const v = res.volumes[p.keyword]?.[country];
          if (v == null || !Number.isFinite(v)) continue;
          base.rows.push({
            keyword: p.keyword,
            position: p.position,
            volume: Math.round(v),
            truth: res.truth.has(`${p.keyword}|${country}`),
            url: p.url,
            title: p.title,
            prevPosition: p.prevPosition,
            bestPosition: p.bestPosition,
            lastSeen: p.lastSeen,
            kd: null,
            intent: null,
            commercial: false,
            volumeLow: null,
            volumeHigh: null,
            features: null,
          });
          done.add(p.keyword);
          filled++;
        }
        base.pending = base.pending.filter((p) => !done.has(p.keyword));
      }
    } catch {
      /* the volume fill is optional: these keywords just stay without a number */
    }
  }
  return {
    rows: base.rows,
    unvolumed: base.pending.length,
    pending: base.pending,
    filled,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Turns bank keywords into rows of the keyword table (same fields as a live-checked keyword), skipping the ones already checked live.
 * `source: "bank"` marks them. Their position is the one seen in the latest saved Google result, so the row also says when that was.
 */
export function bankTableRows(
  rows: BankKeyword[],
  o: { exclude: Set<string>; brand?: string; limit?: number },
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const b of rows) {
    if (o.exclude.has(b.keyword)) continue;
    const volume = Math.max(0, Math.round(b.volume));
    const features = (b.features as Features | null) ?? null;
    const ff = features ? featureFactor(features) : 0.92; // 0.92 = typical SERP-feature factor when the result page was not saved
    const kd = b.kd ?? null;
    const opp = opportunity({ volume, kd, position: b.position, features });
    const hasPrev = b.prevPosition != null;
    out.push({
      keyword: b.keyword,
      position: b.position,
      url: b.url ?? null,
      volume,
      volumeLow: b.volumeLow ?? Math.round(volume * 0.6),
      volumeHigh: b.volumeHigh ?? Math.round(volume * 1.6),
      volumeAll: volume,
      visits: r1(volume * ctrAt(b.position) * ff),
      kd,
      kdLabel: kdLabel(kd),
      intent:
        b.intent ?? classifyIntent(b.keyword, o.brand, !!b.commercial),
      commercial: !!b.commercial,
      features,
      opportunity: opp.score,
      action: opp.action,
      gain: opp.gain,
      potential: opp.potential,
      source: "bank",
      trueVolume: b.truth,
      lastSeen: b.lastSeen ?? null,
      bestPosition: b.bestPosition ?? null,
      trend: hasPrev
        ? { prev: b.prevPosition, series: [b.prevPosition], firstSeen: null }
        : null,
    });
  }
  out.sort(
    (a, b) =>
      (b.visits as number) - (a.visits as number) ||
      (b.volume as number) - (a.volume as number),
  );
  return out.slice(0, o.limit ?? 400);
}