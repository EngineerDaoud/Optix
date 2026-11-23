// FILE: src/components/TrafficEngagement.tsx   (REPLACE the old file)
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTip, Delta, TipRow, compact } from "./dash";
import { publicText } from "../lib/clean";
import { halfDelta } from "../lib/report";
import { supabase } from "../lib/supabase";
import { daysAgo } from "../lib/format";

export type Kpi = {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
};

/* ============================================================ periods */
type Period = "day" | "week" | "month" | "year";
const PERIODS: { k: Period; l: string }[] = [
  { k: "day", l: "Daily" },
  { k: "week", l: "Weekly" },
  { k: "month", l: "Monthly" },
  { k: "year", l: "Yearly" },
];
const UNIT: Record<Period, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

// ESTIMATES: the app only knows a monthly figure. One average month = 365.25 / 12 days, so
//   per day  = month / 30.44      per week = month x 7 / 30.44      per year = month x 12
// The same factor is applied to low / mid / high, so the range keeps its meaning.
const DAYS_PER_MONTH = 365.25 / 12;
const FACTOR: Record<Period, number> = {
  day: 1 / DAYS_PER_MONTH,
  week: 7 / DAYS_PER_MONTH,
  month: 1,
  year: 12,
};
const HOW: Record<Period, string> = {
  day: "the monthly estimate divided by 30.44 days",
  week: "the monthly estimate x 7 / 30.44",
  month: "",
  year: "the monthly estimate x 12",
};

// REAL DATA: saved history (traffic_rollup) is read in the grain that fits the view.
const GRAIN: Record<Period, "day" | "week" | "month"> = {
  day: "day",
  week: "week",
  month: "month",
  year: "month",
};

/** one number for people: 0.4 -> "<1", 3.27 -> "3.3", 70 -> "70", 2140 -> "2.1K" */
const fmtN = (v: number | null | undefined) =>
  v == null || isNaN(v) ? "–" : v <= 0 ? "0" : v < 1 ? "<1" : v < 10 ? v.toFixed(1) : compact(v);

/* ============================================================ date helpers (all UTC, plain YYYY-MM-DD) */
const toDay = (s: unknown) => {
  let d = String(s ?? "");
  if (/^\d{8}$/.test(d)) d = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  return d.slice(0, 10);
};
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const nextMonth = (day: string) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
};
const monthStartBack = (n: number) => {
  const d = new Date(daysAgo(0) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - n, 1);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
const fmtDate = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en", {
    ...o,
    timeZone: "UTC",
  });
/** is the block that starts on `t` already over? (an unfinished week / month must never be shown as if it was complete) */
const isDone = (t: string, p: Period, today: string) =>
  p === "week"
    ? addDays(t, 7) <= today
    : p === "day"
      ? addDays(t, 1) <= today
      : nextMonth(t) <= today;

/* ============================================================ real-data points */
type Metric = "sessions" | "users" | "pageviews" | "clicks" | "impressions";
type Pt = { t: string } & Record<Metric, number>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const sumOf = (pts: Pt[], k: Metric) => pts.reduce((a, p) => a + p[k], 0);

/** same-size blocks of 7 days counted backwards from the newest day (used when no saved history exists yet) */
function weeklyFromDaily(pts: Pt[]): Pt[] {
  if (pts.length < 7) return [];
  const last = pts[pts.length - 1].t;
  const map = new Map<number, Pt & { n: number }>();
  for (const p of pts) {
    const idx = Math.floor(diffDays(last, p.t) / 7);
    const e =
      map.get(idx) ??
      ({
        t: addDays(last, -(idx * 7 + 6)),
        sessions: 0,
        users: 0,
        pageviews: 0,
        clicks: 0,
        impressions: 0,
        n: 0,
      } as Pt & { n: number });
    (["sessions", "pageviews", "clicks", "impressions"] as Metric[]).forEach(
      (k) => (e[k] += p[k]),
    );
    e.n++;
    map.set(idx, e);
  }
  return [...map.values()]
    .filter((e) => e.n === 7) // only full weeks
    .sort((a, b) => a.t.localeCompare(b.t));
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
      {PERIODS.map((p) => (
        <button
          key={p.k}
          type="button"
          onClick={() => onChange(p.k)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${value === p.k ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
        >
          {p.l}
        </button>
      ))}
    </div>
  );
}

/** Traffic & Engagement: period switch, KPI numbers on top, chart below. Shown inside a Box on the board. */
export default function TrafficEngagement({
  kpis,
  daily,
  ga,
  gs,
  est,
  kwRows,
  tr,
  siteId,
}: {
  kpis: Kpi[];
  daily: any[];
  ga: any;
  gs: any;
  est: any;
  kwRows: any[];
  tr: any;
  siteId?: string | null;
}) {
  const real = !!(ga || gs);
  const [period, setPeriod] = useState<Period>("month");
  const [rows, setRows] = useState<Pt[] | null>(null);
  const [loading, setLoading] = useState(false);

  /* ---------- saved history for Weekly / Monthly / Yearly (connected sites only) ---------- */
  useEffect(() => {
    if (!real || !siteId || period === "day") {
      setRows(null);
      return;
    }
    let off = false;
    setLoading(true);
    const from =
      period === "week" ? daysAgo(91) : monthStartBack(11); // 13 weeks / this month + the 11 before it
    (async () => {
      try {
        const { data, error } = await supabase.rpc("traffic_rollup", {
          p_website: siteId,
          p_grain: GRAIN[period],
          p_from: from,
          p_to: daysAgo(0),
        });
        if (error) throw error;
        const pts: Pt[] = ((data ?? []) as any[])
          .map((r) => ({
            t: toDay(r.period),
            sessions: num(r.sessions),
            users: num(r.users),
            pageviews: num(r.pageviews),
            clicks: num(r.gsc_clicks),
            impressions: num(r.gsc_impressions),
          }))
          .sort((a, b) => a.t.localeCompare(b.t));
        // the first block can start BEFORE the range and so hold only a few days: never show it as a full week / month
        if (pts.length > 1 && pts[0].t < from) pts.shift();
        if (!off) setRows(pts.length ? pts : null);
      } catch {
        if (!off) setRows(null); // fall back to the live 30 days
      }
      if (!off) setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [real, siteId, period]);

  const dailyPts: Pt[] = useMemo(
    () =>
      (daily ?? [])
        .map((x: any) => ({
          t: toDay(x.date),
          sessions: num(x.sessions),
          users: num(x.users),
          pageviews: num(x.pageviews),
          clicks: num(x.clicks),
          impressions: num(x.impressions),
        }))
        .filter((x) => x.t)
        .sort((a, b) => a.t.localeCompare(b.t)),
    [daily],
  );

  /* ---------- REAL DATA: chart series + KPIs for the chosen period ---------- */
  const realView = useMemo(() => {
    if (!real) return null;
    const today = daysAgo(0);
    let series: Pt[] = [];
    let fromHistory = true;
    // Daily: the live last 30 days. Today is still running, so it is left out (it would always look like a drop).
    const finished = dailyPts.filter((p) => p.t < today);
    const live = finished.length > 6 ? finished : dailyPts;
    if (period === "day") {
      series = live.slice(-30);
    } else if (rows) {
      series = rows;
    } else {
      fromHistory = false;
      if (period === "week") series = weeklyFromDaily(live);
      else series = [];
    }

    const out: Kpi[] = [];
    const defs: { key: Metric; label: string; show: boolean }[] = [
      { key: "sessions", label: "Visits", show: !!ga },
      { key: "users", label: "Visitors", show: !!ga },
      { key: "pageviews", label: "Page views", show: !!ga },
      { key: "clicks", label: "Search clicks", show: !!gs },
      { key: "impressions", label: "Impressions", show: !!gs },
    ];
    const hasData = (k: Metric) => series.some((p) => p[k] > 0) || (period !== "day" && live.some((p) => p[k] > 0));
    let note: string | null = null;

    for (const d of defs) {
      if (!d.show || !hasData(d.key)) continue;
      if (period === "day") {
        const n = series.length;
        if (!n) continue;
        const avg = sumOf(series, d.key) / n;
        out.push({
          label: `${d.label} / day`,
          value: fmtN(avg),
          sub: `average of the last ${n} days`,
          delta: halfDelta(series.map((p) => p[d.key])),
        });
      } else if (period === "week" || period === "month") {
        if (!series.length) {
          // no saved history yet: the live 30 days are the only real numbers
          if (period === "month" && live.length) {
            const last30 = live.slice(-30);
            out.push({
              label: `${d.label} / month`,
              value: fmtN(sumOf(last30, d.key)),
              sub: `last ${last30.length} days (no saved history yet)`,
              delta: halfDelta(last30.map((p) => p[d.key])),
            });
            note =
              "Monthly history is saved from the day this site was connected. Until a full month is saved, the last 30 days are shown.";
          }
          continue;
        }
        const done = series.filter((p) => isDone(p.t, period, today));
        const cur = done.length ? done[done.length - 1] : series[series.length - 1];
        const partial = !done.length;
        const i = series.indexOf(cur);
        const prev = i > 0 ? series[i - 1] : null;
        out.push({
          label: `${d.label} / ${UNIT[period]}`,
          value: fmtN(cur[d.key]),
          sub: partial
            ? `${period === "week" ? "this week" : "this month"} so far`
            : period === "week"
              ? `week of ${fmtDate(cur.t, { month: "short", day: "numeric" })}`
              : fmtDate(cur.t, { month: "long", year: "numeric" }),
          delta: prev && prev[d.key] ? (cur[d.key] - prev[d.key]) / prev[d.key] : null,
        });
      } else {
        // YEAR
        if (rows) {
          // people can come back in several months, so visitors cannot be added up: skipped here on purpose
          if (d.key === "users") continue;
          const months = series.length;
          out.push({
            label: `${d.label} / year`,
            value: fmtN(sumOf(series, d.key)),
            sub:
              months < 12
                ? `only ${months} month${months === 1 ? "" : "s"} saved so far`
                : "last 12 months",
            delta: halfDelta(series.map((p) => p[d.key])),
          });
        } else if (live.length >= 14 && d.key !== "users") {
          const avg = sumOf(live, d.key) / live.length;
          out.push({
            label: `${d.label} / year (projected)`,
            value: fmtN(avg * 365),
            sub: `average of ${live.length} days x 365`,
            delta: null,
          });
          note =
            "No saved yearly history yet. The yearly numbers are a projection from the live days and will become real as history is saved.";
        }
      }
    }
    // average position is not a sum, so it is kept as it comes from Google (last 30 days)
    const pos = (kpis ?? []).find((k) => k.label === "Avg. position");
    if (pos && gs) out.push({ ...pos, sub: `${pos.sub ?? ""} · 30 days`.replace(/^ · /, "") });
    return { series, kpis: out, fromHistory, note, today };
  }, [real, period, rows, dailyPts, kpis, ga, gs]);

  /* ---------- ESTIMATE: scale the monthly numbers to the chosen period ---------- */
  const f = FACTOR[period];
  const estKpis: Kpi[] = useMemo(() => {
    if (real || !est) return kpis ?? [];
    return (kpis ?? []).map((k) => {
      if (k.label === "Organic visits / month" && est.organic?.mid > 0)
        return {
          ...k,
          label: `Organic visits / ${UNIT[period]}`,
          value: fmtN(est.organic.mid * f),
          sub: `Range ${fmtN(est.organic.low * f)} – ${fmtN(est.organic.high * f)}`,
        };
      if (k.label === "Total visits / month" && est.organic?.mid > 0)
        return {
          ...k,
          label: `Total visits / ${UNIT[period]}`,
          value: `${fmtN(est.allSources.low * f)}–${fmtN(est.allSources.high * f)}`,
        };
      if (k.label === "Growth potential" && est.potential)
        return {
          ...k,
          value: `+${fmtN(est.potential.top3 * f)}`,
          sub: `extra visits / ${UNIT[period]} at top 3`,
        };
      return k;
    });
  }, [real, est, kpis, period, f]);

  const estRows = useMemo(
    () =>
      (kwRows ?? [])
        .filter((k) => k.visits > 0)
        .slice(0, 20)
        .map((k) => ({ ...k, visits: k.visits * f })),
    [kwRows, f],
  );

  const shownKpis = real ? (realView?.kpis ?? []) : estKpis;
  const series = realView?.series ?? [];
  const tickFmt = (v: string) =>
    period === "day"
      ? String(v).slice(5)
      : period === "week"
        ? fmtDate(v, { month: "short", day: "numeric" })
        : fmtDate(v, { month: "short", year: "2-digit" });
  const tipFmt = (l: string) =>
    period === "day"
      ? fmtDate(l, { dateStyle: "medium" } as any)
      : period === "week"
        ? `Week of ${fmtDate(l, { month: "short", day: "numeric", year: "numeric" })}`
        : fmtDate(l, { month: "long", year: "numeric" });

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2">
        {loading && <span className="text-[11px] text-slate-400">Loading…</span>}
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {shownKpis.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
          {shownKpis.map((k) => (
            <div key={k.label} className="min-w-0">
              <div className="truncate text-[10.5px] font-semibold text-slate-500">
                {k.label}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="num whitespace-nowrap text-[19px] font-medium leading-tight sm:text-[21px]">
                  {k.value}
                </span>
                {k.delta != null && <Delta v={k.delta} />}
              </div>
              {k.sub && (
                <div className="truncate text-[10.5px] text-slate-400">
                  {k.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">
          {publicText(tr?.note) ??
            "No traffic data is available for this view yet. Try another period or press “Re-run with fresh data”."}
        </p>
      )}

      <div className="h-52">
        {real ? (
          series.length > 1 ? (
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: -18, right: 6, top: 6 }}>
                <defs>
                  <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6c47ff" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#6c47ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  strokeOpacity={0.25}
                />
                <XAxis
                  dataKey="t"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={tickFmt}
                  minTickGap={24}
                />
                <YAxis fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip labelFormat={tipFmt} />} />
                {ga && (
                  <Area
                    dataKey="sessions"
                    name="Visits"
                    stroke="#5b38ee"
                    strokeWidth={2}
                    fill="url(#gS)"
                  />
                )}
                {gs && (
                  <Line
                    dataKey="clicks"
                    name="Google clicks"
                    stroke="#16a34a"
                    dot={false}
                    strokeWidth={2}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-500">
              {loading
                ? "Loading…"
                : period === "year" || period === "month"
                  ? "Not enough saved history for a chart yet. History is saved every day from the moment Google is connected."
                  : "Not enough data for this view yet."}
            </div>
          )
        ) : est && estRows.length > 0 ? (
          <ResponsiveContainer>
            <AreaChart data={estRows} margin={{ left: -18, right: 10, top: 10 }}>
              <defs>
                <linearGradient id="gK" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6c47ff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#6c47ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                strokeOpacity={0.25}
              />
              <XAxis dataKey="keyword" tick={false} axisLine={false} tickLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
                content={({ active, payload }: any) =>
                  active && payload?.[0] ? (
                    <div className="w-56 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-pop dark:border-slate-700 dark:bg-slate-800">
                      <div className="mb-1.5 font-bold">
                        {payload[0].payload.keyword}
                      </div>
                      <TipRow
                        label={`Visits / ${UNIT[period]}*`}
                        value={fmtN(payload[0].payload.visits)}
                        color="#5b38ee"
                      />
                      <TipRow
                        label="Google position"
                        value={payload[0].payload.position ?? "–"}
                      />
                      <TipRow
                        label="Searches / month*"
                        value={Math.round(payload[0].payload.volume).toLocaleString()}
                      />
                      <TipRow
                        label="Difficulty*"
                        value={payload[0].payload.kd ?? "–"}
                      />
                    </div>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="visits"
                name="Visits*"
                stroke="#5b38ee"
                strokeWidth={2.5}
                fill="url(#gK)"
                dot={{ r: 3, fill: "#5b38ee", strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-slate-500">
            No keywords are bringing in visits yet.
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        {real
          ? `Read from your Google accounts${realView?.fromHistory && period !== "day" ? " and the saved history" : " (live last 30 days)"}. Arrows compare with the ${period === "week" || period === "month" ? "previous " + UNIT[period] : "first half of the period"}. ${realView?.note ?? ""}`
          : `Chart: visits per keyword, biggest first (hover for details). *Approximate figures.${period === "month" ? "" : ` Per-${UNIT[period]} numbers are ${HOW[period]}: an average, not a measured ${UNIT[period]}.`}`}
      </p>
    </>
  );
}