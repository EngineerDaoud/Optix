import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { useSite } from "../context/Site";
import {
  Empty,
  ErrorNote,
  KpiCard,
  PageHeader,
  Spinner,
} from "../components/ui";
import { change, daysAgo, num } from "../lib/format";

type Grain = "day" | "week" | "month";
type Row = {
  period: string;
  sessions: number;
  users: number;
  new_users: number;
  pageviews: number;
  organic: number;
  direct: number;
  referral: number;
  social: number;
  paid: number;
  email: number;
  other: number;
  gsc_clicks: number;
  gsc_impressions: number;
};

const RANGES: Record<Grain, { label: string; days: number }[]> = {
  day: [
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
  ],
  week: [
    { label: "12 weeks", days: 84 },
    { label: "26 weeks", days: 182 },
    { label: "1 year", days: 365 },
    { label: "All time", days: 0 },
  ],
  month: [
    { label: "12 months", days: 365 },
    { label: "All time", days: 0 },
  ],
};
const FAR_PAST = "2015-08-14";

const label = (p: string, g: Grain) => {
  const d = new Date(p + "T00:00:00Z");
  if (g === "month")
    return d.toLocaleDateString("en", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  return d.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
};
const sum = (rows: Row[], k: keyof Row) =>
  rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

async function rollup(website: string, grain: Grain, from: string, to: string) {
  const { data, error } = await supabase.rpc("traffic_rollup", {
    p_website: website,
    p_grain: grain,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, k === "period" ? v : Number(v)]),
    ),
  ) as Row[];
}

export default function Traffic() {
  const { current, reload } = useSite();
  const [grain, setGrain] = useState<Grain>("day");
  const [rangeIdx, setRangeIdx] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [recent, setRecent] = useState<Row[]>([]);
  const [months, setMonths] = useState<Row[]>([]);
  const [info, setInfo] = useState<{
    traffic_start: string | null;
    traffic_backfilled_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const changeGrain = (g: Grain) => {
    setGrain(g);
    setRangeIdx(0);
  };
  const range = RANGES[grain][Math.min(rangeIdx, RANGES[grain].length - 1)];

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const today = daysAgo(0);
      const from = range.days ? daysAgo(range.days) : FAR_PAST;
      const [main, last60, allMonths, w] = await Promise.all([
        rollup(current.id, grain, from, today),
        rollup(current.id, "day", daysAgo(60), today),
        rollup(current.id, "month", FAR_PAST, today),
        supabase
          .from("websites")
          .select("traffic_start,traffic_backfilled_at")
          .eq("id", current.id)
          .single(),
      ]);
      setRows(main);
      setRecent(last60);
      setMonths(allMonths);
      setInfo(w.data as any);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [current, grain, range.days]);
  useEffect(() => {
    load();
  }, [load]);

  const sync = async (mode?: "backfill") => {
    if (!current) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fn<{ result: Record<string, string> }>("sync", {
        website_id: current.id,
        mode,
      });
      const failed = Object.entries(r.result).filter(([, v]) => v !== "ok");
      if (failed.length)
        setError(failed.map(([k, v]) => `${k}: ${v}`).join(" · "));
      else
        setNote(
          mode
            ? "Full history saved in your database."
            : "Updated with the latest days.",
        );
      await reload();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const k = useMemo(() => {
    const byDate = new Map(recent.map((r) => [r.period, r]));
    const win = (a: number, b: number) =>
      recent.filter((r) => r.period >= daysAgo(a) && r.period <= daysAgo(b));
    const yest = byDate.get(daysAgo(1));
    const dayBefore = byDate.get(daysAgo(2));
    const w7 = win(7, 1),
      w7p = win(14, 8),
      w30 = win(30, 1),
      w30p = win(60, 31);
    return {
      yest: yest?.sessions ?? 0,
      yestD: change(yest?.sessions ?? 0, dayBefore?.sessions ?? 0),
      w7: sum(w7, "sessions"),
      w7D: change(sum(w7, "sessions"), sum(w7p, "sessions")),
      w30: sum(w30, "sessions"),
      w30D: change(sum(w30, "sessions"), sum(w30p, "sessions")),
      org30: sum(w30, "organic"),
      org30D: change(sum(w30, "organic"), sum(w30p, "organic")),
      all: sum(months, "sessions"),
      allOrg: sum(months, "organic"),
    };
  }, [recent, months]);

  const chart = rows.map((r) => ({
    name: label(r.period, grain),
    Organic: r.organic,
    Other: Math.max(r.sessions - r.organic, 0),
  }));

  const csv = () => {
    const head = [
      "period",
      "sessions",
      "organic",
      "direct",
      "referral",
      "social",
      "paid",
      "email",
      "other",
      "users",
      "new_users",
      "pageviews",
      "gsc_clicks",
      "gsc_impressions",
    ];
    const lines = [
      head.join(","),
      ...rows.map((r) => head.map((h) => (r as any)[h]).join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    );
    a.download = `traffic-${grain}-${daysAgo(0)}.csv`;
    a.click();
  };

  if (!current)
    return (
      <Empty
        title="No website yet"
        text="Add a website from the Dashboard first."
      />
    );
  const hasData = months.some((m) => m.sessions > 0);
  const synced = !!info?.traffic_backfilled_at;

  return (
    <div className="fade-up">
      <PageHeader
        title="Traffic"
        sub={`${current.name || current.url} · every visit is saved in your database${info?.traffic_start ? ` · tracking since ${info.traffic_start}` : ""}`}
      >
        <button className="btn-ghost" onClick={() => sync()} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Update now
        </button>
        <button
          className="btn"
          onClick={() => sync("backfill")}
          disabled={busy}
        >
          {busy && <Spinner />}{" "}
          {synced ? "Reload full history" : "Load full history"}
        </button>
      </PageHeader>
      <ErrorNote message={error} />
      {note && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {note}
        </div>
      )}

      {!hasData && !loading ? (
        <Empty
          title="No traffic saved yet"
          text="Connect Google Analytics on the Integrations page, pick your property, then press “Load full history”. Data exists only from the day the Analytics tag was installed on your website."
        >
          <button
            className="btn"
            onClick={() => sync("backfill")}
            disabled={busy}
          >
            {busy && <Spinner />} Load full history
          </button>
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard
              label="Yesterday (visits)"
              value={num(k.yest)}
              delta={k.yestD}
            />
            <KpiCard label="Last 7 days" value={num(k.w7)} delta={k.w7D} />
            <KpiCard label="Last 30 days" value={num(k.w30)} delta={k.w30D} />
            <KpiCard
              label="Organic, last 30 days"
              value={num(k.org30)}
              delta={k.org30D}
            />
            <KpiCard
              label="All time (organic)"
              value={`${num(k.all)} (${num(k.allOrg)})`}
            />
          </div>

          <div className="card mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(["day", "week", "month"] as Grain[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => changeGrain(g)}
                    className={`rounded-md px-3 py-1 text-sm font-medium ${grain === g ? "bg-white shadow-panel dark:bg-slate-700" : "text-slate-500"}`}
                  >
                    {g === "day"
                      ? "Daily"
                      : g === "week"
                        ? "Weekly"
                        : "Monthly"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Range"
                  className="input !w-auto"
                  value={rangeIdx}
                  onChange={(e) => setRangeIdx(Number(e.target.value))}
                >
                  {RANGES[grain].map((r, i) => (
                    <option key={r.label} value={i}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-ghost"
                  onClick={csv}
                  disabled={!rows.length}
                >
                  <Download className="h-4 w-4" /> CSV
                </button>
              </div>
            </div>
            <div className="h-72">
              {loading ? (
                <div className="grid h-full place-items-center">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      minTickGap={16}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="Organic"
                      stackId="a"
                      fill="#5b38ee"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="Other"
                      stackId="a"
                      fill="#6c47ff"
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card mt-4 !p-0">
            <div className="max-h-[480px] overflow-auto scroll-thin">
              <table className="w-full min-w-[860px]">
                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                  <tr>
                    {[
                      grain === "day"
                        ? "Date"
                        : grain === "week"
                          ? "Week starting"
                          : "Month",
                      "Visits",
                      "Organic",
                      "Direct",
                      "Referral",
                      "Social",
                      "Paid",
                      "Email",
                      "Other",
                      "Pageviews",
                      "Google clicks",
                    ].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr
                      key={r.period}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="td font-medium">
                        {grain === "month"
                          ? label(r.period, "month")
                          : r.period}
                      </td>
                      <td className="td font-semibold">{num(r.sessions)}</td>
                      <td className="td text-brand-700 dark:text-brand-300">
                        {num(r.organic)}
                      </td>
                      <td className="td">{num(r.direct)}</td>
                      <td className="td">{num(r.referral)}</td>
                      <td className="td">{num(r.social)}</td>
                      <td className="td">{num(r.paid)}</td>
                      <td className="td">{num(r.email)}</td>
                      <td className="td">{num(r.other)}</td>
                      <td className="td">{num(r.pageviews)}</td>
                      <td className="td">{num(r.gsc_clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Visits = Google Analytics sessions. Organic = sessions from
            Google/Bing and other search engines. Google Analytics reports up to
            yesterday, so today is not shown. Google clicks come from Search
            Console (up to 16 months back).
          </p>
        </>
      )}
    </div>
  );
}
