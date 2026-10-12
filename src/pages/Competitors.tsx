import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { Empty, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { daysAgo, num } from "../lib/format";

type Site = { host: string; added_at: string; last_checked_at: string | null };
type Day = {
  host: string;
  date: string;
  tranco_rank: number | null;
  est_monthly_visits: number | null;
};
type Grain = "day" | "week" | "month";

const monthKey = (d: string) => d.slice(0, 7) + "-01";
const weekKey = (d: string) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const daysInMonth = (k: string) =>
  new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();

/** Estimated visits per day / week / month, built from the monthly-equivalent estimate of each saved day. */
function group(rows: Day[], grain: Grain) {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.est_monthly_visits == null) continue;
    const k =
      grain === "day"
        ? r.date
        : grain === "week"
          ? weekKey(r.date)
          : monthKey(r.date);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(
      r.est_monthly_visits / 30.4,
    );
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      const avgDay = v.reduce((a, b) => a + b, 0) / v.length;
      const visits =
        grain === "day"
          ? avgDay
          : grain === "week"
            ? avgDay * 7
            : avgDay * daysInMonth(k);
      return { period: k, visits: Math.round(visits), days: v.length };
    });
}

const fmtPeriod = (p: string, g: Grain) =>
  new Date(p + "T00:00:00Z").toLocaleDateString(
    "en",
    g === "month"
      ? { month: "short", year: "2-digit", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" },
  );

export default function Competitors() {
  const [sites, setSites] = useState<Site[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [snaps, setSnaps] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [grain, setGrain] = useState<Grain>("day");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, d, sn] = await Promise.all([
      supabase
        .from("competitor_sites")
        .select("host,added_at,last_checked_at")
        .order("added_at"),
      supabase
        .from("competitor_daily")
        .select("host,date,tranco_rank,est_monthly_visits")
        .gte("date", daysAgo(800))
        .order("date")
        .limit(20000),
      supabase
        .from("site_snapshots")
        .select("host,visits_mid,checked_on")
        .order("checked_on", { ascending: false })
        .limit(500),
    ]);
    if (s.error)
      setError("Competitor data could not be loaded. Please try again later.");
    setSites((s.data ?? []) as Site[]);
    setDays((d.data ?? []) as Day[]);
    const m: Record<string, number> = {};
    for (const r of (sn.data ?? []) as {
      host: string;
      visits_mid: number | null;
    }[])
      if (r.visits_mid != null && !(r.host in m)) m[r.host] = r.visits_mid;
    setSnaps(m);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!sel && sites.length) setSel(sites[0].host);
  }, [sites, sel]);

  const act = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await f();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const add = () =>
    act("add", async () => {
      if (!input.trim()) return;
      const r = await fn<{ host: string; rankedDays: number }>("competitor", {
        action: "add",
        host: input,
      });
      setInput("");
      setSel(r.host);
      if (!r.rankedDays)
        setError(
          `${r.host} is too small for a traffic figure to be calculated.`,
        );
    });

  const rowsOf = (h: string) => days.filter((d) => d.host === h);
  const series = useMemo(
    () => (sel ? group(rowsOf(sel), grain) : []),
    [days, sel, grain],
  ); // eslint-disable-line
  const chart = series.map((s) => ({
    name: fmtPeriod(s.period, grain),
    Visits: s.visits,
  }));
  const latest = (h: string) =>
    [...rowsOf(h)].reverse().find((r) => r.est_monthly_visits != null);
  const monthAgo = (h: string) =>
    rowsOf(h).find(
      (r) => r.date >= daysAgo(30) && r.est_monthly_visits != null,
    );

  return (
    <div className="fade-up">
      <PageHeader
        title="Competitor traffic"
        sub="Compare the traffic of any website over time. Figures are approximate and saved every day."
      >
        <input
          className="input !w-64"
          placeholder="example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn" onClick={add} disabled={!!busy}>
          {busy === "add" ? <Spinner /> : <Plus className="h-4 w-4" />} Track
          website
        </button>
        {sites.length > 0 && (
          <button
            className="btn-ghost"
            onClick={() =>
              act("all", async () => {
                await fn("competitor", { action: "refresh" });
              })
            }
            disabled={!!busy}
          >
            {busy === "all" ? <Spinner /> : <RefreshCw className="h-4 w-4" />}{" "}
            Update all
          </button>
        )}
      </PageHeader>
      <ErrorNote message={error} />

      {!loaded ? (
        <div className="card grid place-items-center py-12">
          <Spinner className="h-5 w-5" />
        </div>
      ) : sites.length === 0 ? (
        <Empty
          title="No websites tracked yet"
          text="Type any website address above and press Track website. You get the last 30 days at once, and a new day is added every night."
        />
      ) : (
        <>
          <div className="card !p-0">
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    {[
                      "Website",
                      "Global rank",
                      "Visits / month (approx.)",
                      "Change (30 days)",
                      "From keywords",
                      "",
                    ].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => {
                    const l = latest(s.host),
                      o = monthAgo(s.host);
                    const ch =
                      l?.est_monthly_visits && o?.est_monthly_visits
                        ? (l.est_monthly_visits - o.est_monthly_visits) /
                          o.est_monthly_visits
                        : null;
                    return (
                      <tr
                        key={s.host}
                        onClick={() => setSel(s.host)}
                        className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${sel === s.host ? "bg-brand-50 dark:bg-brand-900/30" : ""}`}
                      >
                        <td className="td font-medium">{s.host}</td>
                        <td className="td">
                          {l?.tranco_rank
                            ? `#${num(l.tranco_rank)}`
                            : "not in top 1M"}
                        </td>
                        <td className="td font-semibold">
                          {l?.est_monthly_visits
                            ? `~${num(l.est_monthly_visits)}`
                            : "–"}
                        </td>
                        <td
                          className={`td ${ch == null ? "" : ch >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {ch == null
                            ? "–"
                            : `${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(1)}%`}
                        </td>
                        <td className="td">
                          {snaps[s.host] != null
                            ? `~${num(snaps[s.host])} organic`
                            : "–"}
                        </td>
                        <td className="td text-right">
                          <button
                            aria-label={`Remove ${s.host}`}
                            className="rounded p-1 text-slate-400 hover:text-red-600"
                            disabled={!!busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              act("rm", async () => {
                                await fn("competitor", {
                                  action: "remove",
                                  host: s.host,
                                });
                                if (sel === s.host) setSel(null);
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {sel && (
            <div className="card mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {sel}: visits over time
                </h2>
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {(["day", "week", "month"] as Grain[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGrain(g)}
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
              </div>
              {chart.length < 2 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  Not enough days saved for this view yet. A new day is added
                  every night.
                </p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={chart}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        strokeOpacity={0.15}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        width={48}
                        tickFormatter={(v) => num(v)}
                      />
                      <Tooltip
                        formatter={(v: number) => [`~${num(v)}`, "Est. visits"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="Visits"
                        stroke="#5b38ee"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Figures are approximate and best used to follow direction (up or
            down) rather than exact size. Very small websites cannot be
            measured. Exact traffic is only visible to the website owner.
          </p>
        </>
      )}
    </div>
  );
}
