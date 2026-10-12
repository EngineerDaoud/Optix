export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};

export const num = (n: number | null | undefined, digits = 0) =>
  n == null || isNaN(n)
    ? "–"
    : new Intl.NumberFormat("en", {
        notation: Math.abs(n) >= 100000 ? "compact" : "standard",
        maximumFractionDigits: digits,
      }).format(n);

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const change = (cur: number, prev: number) =>
  prev ? (cur - prev) / prev : null;
export const pathOf = (u: string) => {
  try {
    return new URL(u).pathname || "/";
  } catch {
    return u;
  }
};

export type Row = {
  date: string;
  source: string;
  data: Record<string, number>;
};

export function aggregate(rows: Row[], from: string, to: string) {
  const r = rows.filter((x) => x.date >= from && x.date <= to);
  const sum = (src: string, k: string) =>
    r.filter((x) => x.source === src).reduce((a, x) => a + (x.data[k] ?? 0), 0);
  const clicks = sum("gsc", "clicks");
  const impressions = sum("gsc", "impressions");
  const posNum = r
    .filter((x) => x.source === "gsc")
    .reduce(
      (a, x) => a + (x.data.position ?? 0) * (x.data.impressions ?? 0),
      0,
    );
  const sessions = sum("ga4", "sessions");
  const orders = sum("ga4", "orders");
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? posNum / impressions : 0,
    sessions,
    users: sum("ga4", "users"),
    orders,
    revenue: sum("ga4", "revenue"),
    convRate: sessions ? orders / sessions : 0,
  };
}
