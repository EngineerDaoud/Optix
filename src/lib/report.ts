import { findCountry } from "./countries";
import type { CountryRow } from "../components/WorldMap";

export type CountryTraffic = {
  rows: CountryRow[];
  unit: string;
  source: "ga4" | "gsc" | "estimate" | "none";
  label: string;
  skipped: number;
};

const pctText = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Turns whatever country data the report has into one list for the map: real Google Analytics > real Search Console > estimate. */
export function countryTraffic(d: any): CountryTraffic {
  const tr = d?.traffic;
  const ga = tr?.own?.ga4;
  const gs = tr?.own?.gsc;
  const est = tr?.seo;
  const build = (
    items: {
      key: string;
      value: number;
      extra: (v: any) => CountryRow["extra"];
      raw: any;
    }[],
  ) => {
    const map = new Map<string, CountryRow>();
    let skipped = 0;
    for (const it of items) {
      const c = findCountry(it.key);
      if (!c || !(it.value > 0)) {
        if (it.value > 0) skipped += it.value;
        continue;
      }
      const prev = map.get(c.a2);
      if (prev) prev.value += it.value;
      else
        map.set(c.a2, {
          a2: c.a2,
          name: c.name,
          value: it.value,
          share: 0,
          extra: it.extra(it.raw),
        });
    }
    const rows = [...map.values()].sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0) || 1;
    rows.forEach((r) => (r.share = r.value / total));
    return { rows, skipped };
  };

  if (ga?.countries?.length) {
    const { rows, skipped } = build(
      ga.countries.map((x: any) => ({
        key: x.key,
        value: x.sessions,
        raw: x,
        extra: (r: any) => [
          { label: "Users", value: Number(r.users).toLocaleString() },
        ],
      })),
    );
    if (rows.length)
      return {
        rows,
        unit: "Sessions",
        source: "ga4",
        label: "Real data · Google Analytics · last 30 days",
        skipped,
      };
  }
  if (gs?.countries?.length) {
    const { rows, skipped } = build(
      gs.countries.map((x: any) => ({
        key: x.key,
        value: x.clicks,
        raw: x,
        extra: (r: any) => [
          {
            label: "Impressions",
            value: Math.round(r.impressions).toLocaleString(),
          },
          { label: "CTR", value: pctText(r.ctr) },
          { label: "Avg. position", value: Number(r.position).toFixed(1) },
        ],
      })),
    );
    if (rows.length)
      return {
        rows,
        unit: "Google clicks",
        source: "gsc",
        label: "Real data · Search Console · last 30 days",
        skipped,
      };
  }
  if (est?.countries?.length) {
    const { rows, skipped } = build(
      est.countries.map((x: any) => ({
        key: x.country,
        value: x.visits,
        raw: x,
        extra: () => [],
      })),
    );
    if (rows.length)
      return {
        rows,
        unit: "Visits / month (approx.)",
        source: "estimate",
        label: "Approximate, based on Google rankings",
        skipped,
      };
  }
  return { rows: [], unit: "Visits", source: "none", label: "", skipped: 0 };
}

/** Counts of keywords by Google position bucket. */
export function positionBuckets(d: any) {
  const ranks: any[] = (d?.rankings ?? []).filter((r: any) => !r.error);
  const pos = ranks
    .map((r) => r.position)
    .filter((p: any): p is number => typeof p === "number");
  return {
    checked: ranks.length,
    top3: pos.filter((p) => p <= 3).length,
    top10: pos.filter((p) => p <= 10).length,
    top30: pos.filter((p) => p <= 30).length,
    ranked: pos.length,
  };
}

/** Compare the second half of a daily series with the first half. */
export function halfDelta(values: number[]) {
  if (values.length < 6) return null;
  const mid = Math.floor(values.length / 2);
  const a = values.slice(0, mid).reduce((x, y) => x + y, 0);
  const b = values.slice(mid).reduce((x, y) => x + y, 0);
  return a ? (b - a) / a : null;
}

export const shortPath = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || "/";
  } catch {
    return u;
  }
};
export const TLD: Record<string, string> = {
  uk: "gb",
  pk: "pk",
  in: "in",
  ae: "ae",
  ca: "ca",
  au: "au",
  de: "de",
  fr: "fr",
  es: "es",
  it: "it",
  nl: "nl",
  sa: "sa",
  tr: "tr",
  br: "br",
  mx: "mx",
  za: "za",
  ng: "ng",
};
export const guessCountry = (raw: string) => {
  try {
    const h = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname;
    return TLD[h.split(".").pop() ?? ""] ?? "us";
  } catch {
    return "us";
  }
};
