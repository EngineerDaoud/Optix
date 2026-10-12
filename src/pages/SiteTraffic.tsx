import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search, X } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { Badge, Empty, KpiCard, PageHeader, Spinner } from "../components/ui";
import { compact, Panel } from "../components/dash";

type Grain = "day" | "week" | "month";
type EstPt = {
  period: string;
  visits: number;
  days: number;
  span: number;
  rank: number | null;
};
type RealPt = {
  period: string;
  visits: number;
  users: number;
  pageviews: number;
  organic: number;
  direct: number;
  referral: number;
  social: number;
  paid: number;
  email: number;
  gsc_clicks: number;
};
type Result = {
  host: string;
  root: string;
  shared: boolean;
  notes: string[];
  estimate: null | {
    latest: {
      date: string;
      rank: number;
      monthly: number;
      low: number;
      high: number;
    };
    change7: number | null;
    change30: number | null;
    rankChange7: number | null;
    rankChange30: number | null;
    storedDays: number;
    firstDate: string;
    fetched: number;
    day: EstPt[];
    week: EstPt[];
    month: EstPt[];
  };
  best?: null | {
    low: number;
    mid: number;
    high: number;
    level: "Low" | "Medium";
    reasons: string[];
  };
  real: null | ({ website: string; from: string } & Record<Grain, RealPt[]>);
  seo: null | { low: number; mid: number; high: number; at: string };
};

const GRAINS: { id: Grain; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];
const label = (p: string, g: Grain) => {
  const d = new Date(p + "T00:00:00Z");
  if (g === "month")
    return d.toLocaleDateString("en", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const s = d.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return g === "week" ? `Wk ${s}` : s;
};
const tip = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 };

export default function SiteTraffic() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [grain, setGrain] = useState<Grain>("week");
  const [view, setView] = useState<"real" | "estimate">("estimate");
  const [tracked, setTracked] = useState<string[]>([]);

  const loadTracked = useCallback(async () => {
    const { data } = await supabase
      .from("competitor_sites")
      .select("host")
      .order("last_checked_at", { ascending: false });
    setTracked((data ?? []).map((r: { host: string }) => r.host));
  }, []);
  useEffect(() => {
    loadTracked();
  }, [loadTracked]);

  const check = async (value = url) => {
    if (!value.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fn<Result>("sitetraffic", { url: value.trim() });
      setRes(r);
      setView(r.real ? "real" : "estimate");
      setUrl(value.trim());
      loadTracked();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const remove = async (host: string) => {
    await supabase.from("competitor_sites").delete().eq("host", host);
    await supabase.from("competitor_daily").delete().eq("host", host);
    loadTracked();
  };

  const showReal = view === "real" && !!res?.real;
  const est = res?.estimate ?? null;
  const rows = useMemo(
    () => (showReal ? res!.real![grain] : est ? est[grain] : []),
    [showReal, res, est, grain],
  );
  const chart = useMemo(
    () => rows.map((r) => ({ ...r, name: label(r.period, grain) })),
    [rows, grain],
  );

  const total = rows.reduce((a, r) => a + r.visits, 0);
  const best = rows.reduce(
    (a, r) => (r.visits > a.visits ? r : a),
    rows[0] ?? { period: "", visits: 0 },
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Traffic Checker"
        sub="Type any website address to see its traffic: daily, weekly and monthly."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        className="card flex flex-wrap items-center gap-3 !p-4"
      >
        <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full bg-transparent py-2 text-sm outline-none"
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button className="btn" disabled={busy || !url.trim()}>
          {busy ? <Spinner /> : null} Check traffic
        </button>
      </form>

      {tracked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tracked.map((h) => (
            <span
              key={h}
              className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold shadow-panel dark:bg-slate-900"
            >
              <button onClick={() => check(h)} className="hover:text-brand-600">
                {h}
              </button>
              <button
                onClick={() => remove(h)}
                aria-label={`Stop tracking ${h}`}
                className="text-slate-400 hover:text-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {err && (
        <div className="card !border-red-200 text-sm text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {!res && !busy && !err && (
        <Empty
          title="No website checked yet"
          text="Enter a website address above. Every check is saved, so the weekly and monthly history grows over time."
        />
      )}

      {res && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold">{res.host}</h2>
            {showReal ? (
              <Badge tone="green">Real data (Google Analytics)</Badge>
            ) : (
              <Badge tone="amber">Estimate</Badge>
            )}
            {res.real && est && (
              <div className="ml-auto flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {(["real", "estimate"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${view === v ? "bg-white shadow-panel dark:bg-slate-700" : "text-slate-500"}`}
                  >
                    {v === "real" ? "Real" : "Estimate"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {res.notes.map((n) => (
            <div
              key={n}
              className="card text-sm text-slate-600 dark:text-slate-300"
            >
              {n}
            </div>
          ))}

          {!showReal && res.best && (
            <Panel
              title="Best estimate (monthly visits)"
              sub="Rank and keyword signals combined. An estimate with a range, never an exact count."
              right={
                <Badge tone={res.best.level === "Medium" ? "amber" : "red"}>
                  {res.best.level} confidence
                </Badge>
              }
            >
              <div className="text-3xl font-extrabold">
                {compact(res.best.mid)}{" "}
                <span className="text-sm font-medium text-slate-500">
                  likely between {compact(res.best.low)} and{" "}
                  {compact(res.best.high)}
                </span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
                {res.best.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Panel>
          )}

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {showReal ? (
                  <>
                    <KpiCard
                      label={`Visits (all ${grain === "day" ? "days" : grain + "s"})`}
                      value={compact(total)}
                    />
                    <KpiCard
                      label={`Best ${grain}`}
                      value={compact(best.visits)}
                    />
                    <KpiCard
                      label="Organic share"
                      value={
                        total
                          ? `${Math.round(((rows as RealPt[]).reduce((a, r) => a + r.organic, 0) / total) * 100)}%`
                          : "–"
                      }
                    />
                    <KpiCard
                      label="Pageviews"
                      value={compact(
                        (rows as RealPt[]).reduce((a, r) => a + r.pageviews, 0),
                      )}
                    />
                  </>
                ) : (
                  est && (
                    <>
                      <KpiCard
                        label="Visits per month (rough)"
                        value={compact(est.latest.monthly)}
                        delta={est.change30}
                      />
                      <KpiCard
                        label="Likely range"
                        value={`${compact(est.latest.low)} – ${compact(est.latest.high)}`}
                      />
                      <KpiCard
                        label="Tranco rank"
                        value={`#${est.latest.rank.toLocaleString()}`}
                        delta={
                          est.rankChange7 != null
                            ? est.rankChange7 / Math.max(est.latest.rank, 1)
                            : null
                        }
                      />
                      <KpiCard
                        label="Days saved"
                        value={String(est.storedDays)}
                      />
                    </>
                  )
                )}
              </div>

              <Panel
                title={showReal ? "Visits" : "Estimated visits"}
                sub={
                  showReal
                    ? "Sessions from your Google Analytics history."
                    : "Rough guess from the site's rank. Treat it as a size and trend, not an exact count."
                }
                right={
                  <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                    {GRAINS.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setGrain(g.id)}
                        className={`rounded-md px-3 py-1 text-xs font-semibold ${grain === g.id ? "bg-white shadow-panel dark:bg-slate-700" : "text-slate-500"}`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                }
              >
                <div className="h-72">
                  <ResponsiveContainer>
                    <AreaChart
                      data={chart}
                      margin={{ left: 0, right: 8, top: 8 }}
                    >
                      <defs>
                        <linearGradient id="tv" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="#5b38ee"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor="#5b38ee"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#94a3b8"
                        strokeOpacity={0.25}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(v: number) => compact(v)}
                      />
                      <Tooltip
                        contentStyle={tip}
                        formatter={(v: number) => [
                          v.toLocaleString(),
                          "Visits",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="visits"
                        stroke="#5b38ee"
                        strokeWidth={2.5}
                        fill="url(#tv)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {!showReal && est && est.storedDays < 14 && (
                  <p className="mt-2 text-xs text-slate-500">
                    Only {est.storedDays} days are saved so far. Check this site
                    again in the coming days and the weekly and monthly views
                    fill up.
                  </p>
                )}
              </Panel>

              {!showReal && (
                <Panel
                  title="Rank trend"
                  sub="Lower is better. A line going up means the site is getting more popular."
                >
                  <div className="h-48">
                    <ResponsiveContainer>
                      <LineChart
                        data={chart}
                        margin={{ left: 0, right: 8, top: 8 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#94a3b8"
                          strokeOpacity={0.25}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          reversed
                          domain={["auto", "auto"]}
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={56}
                          tickFormatter={(v: number) => compact(v)}
                        />
                        <Tooltip
                          contentStyle={tip}
                          formatter={(v: number) => [
                            `#${v.toLocaleString()}`,
                            "Rank",
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="rank"
                          stroke="#6c47ff"
                          strokeWidth={2.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              )}

              <Panel
                className="!p-0"
                flush
                title={`${GRAINS.find((g) => g.id === grain)!.label} table`}
              >
                <div className="max-h-96 overflow-auto pb-3 scroll-thin">
                  <table className="w-full min-w-[520px] text-left">
                    <thead className="sticky top-0 bg-white dark:bg-slate-900">
                      <tr>
                        <th className="th !pl-5">
                          {grain === "day"
                            ? "Date"
                            : grain === "week"
                              ? "Week starting"
                              : "Month"}
                        </th>
                        <th className="th">Visits</th>
                        {showReal ? (
                          <>
                            <th className="th">Users</th>
                            <th className="th">Pageviews</th>
                            <th className="th">Organic</th>
                          </>
                        ) : (
                          <>
                            <th className="th">Avg rank</th>
                            <th className="th">Data</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows].reverse().map((r) => (
                        <tr
                          key={r.period}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td !pl-5 font-medium">
                            {label(r.period, grain)}
                          </td>
                          <td className="td font-semibold">
                            {r.visits.toLocaleString()}
                          </td>
                          {showReal ? (
                            <>
                              <td className="td">
                                {(r as RealPt).users.toLocaleString()}
                              </td>
                              <td className="td">
                                {(r as RealPt).pageviews.toLocaleString()}
                              </td>
                              <td className="td">
                                {(r as RealPt).organic.toLocaleString()}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="td">
                                #{((r as EstPt).rank ?? 0).toLocaleString()}
                              </td>
                              <td className="td text-xs text-slate-500">
                                {(r as EstPt).days >= (r as EstPt).span
                                  ? "complete"
                                  : `${(r as EstPt).days} of ${(r as EstPt).span} days`}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {res.seo && (
            <Panel
              title="SEO traffic estimate"
              sub={`From your last Domain Research run on ${new Date(res.seo.at).toLocaleDateString([], { dateStyle: "medium" })}. Visits per month from Google search only.`}
            >
              <div className="text-2xl font-bold">
                {compact(res.seo.mid)}{" "}
                <span className="text-sm font-medium text-slate-500">
                  likely range {compact(res.seo.low)} – {compact(res.seo.high)}
                </span>
              </div>
            </Panel>
          )}

          <p className="text-xs text-slate-500">
            Real visit numbers of other people's websites are private, and no
            free source has them. For your own sites, connect Google Analytics
            to get exact numbers. For other sites, the estimate comes from the
            public Tranco rank, so it shows size and direction, not exact
            visits.
          </p>
        </>
      )}
    </div>
  );
}
