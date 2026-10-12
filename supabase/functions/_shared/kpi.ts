import { admin, daysAgo } from "./utils.ts";

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

export async function loadKpis(websiteId: string, from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = new Date(Date.parse(from) - 86400000)
    .toISOString()
    .slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const { data } = await admin()
    .from("daily_metrics")
    .select("date,source,data")
    .eq("website_id", websiteId)
    .gte("date", prevFrom)
    .lte("date", to)
    .limit(5000);
  const rows = (data ?? []) as Row[];
  return {
    current: aggregate(rows, from, to),
    previous: aggregate(rows, prevFrom, prevTo),
    rows,
    days,
  };
}

export function rangeFor(type: string) {
  const n =
    (
      { daily: 1, weekly: 7, fifteen: 15, monthly: 30 } as Record<
        string,
        number
      >
    )[type] ?? 7;
  return { from: daysAgo(n), to: daysAgo(1) };
}
