import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fn } from "../lib/supabase";
import { ErrorNote, Spinner } from "./ui";
import { Panel } from "./dash";

/* Live visitors from Google Analytics Realtime (last 30 minutes). Real numbers. Refreshes every 30 seconds while the tab is open and visible. */

type Live = {
  checkedAt: string;
  last30: number;
  last5: number;
  series: { minutesAgo: number; users: number }[];
  pages: { name: string; users: number }[];
  countries: { name: string; users: number }[];
  devices: { name: string; users: number }[];
};

const REFRESH_MS = 30_000;

function List({ title, rows }: { title: string; rows: { name: string; users: number }[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No visitors right now</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex justify-between gap-3">
              <span className="truncate" title={r.name}>
                {r.name}
              </span>
              <span className="tabular-nums text-slate-500">{r.users}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LiveVisitors({ websiteId }: { websiteId: string }) {
  const [data, setData] = useState<Live | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const dead = useRef(false); // stop polling after a setup error (not connected / not allowed): asking again every 30 s would only repeat it

  const load = useCallback(async () => {
    if (busy.current || dead.current) return;
    busy.current = true;
    try {
      setData(await fn<Live>("realtime", { websiteId }));
      setErr(null);
    } catch (e) {
      const m = (e as Error).message;
      setErr(m);
      if (/not connected|did not allow|sign in/i.test(m)) dead.current = true;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [websiteId]);

  useEffect(() => {
    dead.current = false;
    setData(null);
    setLoading(true);
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return (
    <Panel
      title="Live visitors"
      sub="Real numbers from Google Analytics Realtime, updated every 30 seconds"
      right={
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${data && data.last5 > 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
          {data ? new Date(data.checkedAt).toLocaleTimeString() : ""}
        </span>
      }
    >
      <ErrorNote message={err} />
      {loading && !data ? (
        <div className="grid place-items-center py-8">
          <Spinner className="h-5 w-5" />
        </div>
      ) : data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-4xl font-semibold tabular-nums">{data.last5}</div>
              <div className="text-xs text-slate-500">on the site in the last 5 minutes</div>
            </div>
            <div>
              <div className="text-2xl font-medium tabular-nums">{data.last30}</div>
              <div className="text-xs text-slate-500">in the last 30 minutes</div>
            </div>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="minutesAgo"
                  tickFormatter={(m) => (m === 0 ? "now" : `-${m}m`)}
                  interval={4}
                  tick={{ fontSize: 10 }}
                  reversed
                />
                <YAxis hide allowDecimals={false} />
                <Tooltip
                  labelFormatter={(m) => (m === 0 ? "this minute" : `${m} min ago`)}
                  formatter={(v: number) => [v, "active users"]}
                />
                <Bar dataKey="users" fill="#10b981" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <List title="Pages being viewed" rows={data.pages} />
            <List title="Countries" rows={data.countries} />
            <List title="Devices" rows={data.devices} />
          </div>
          <p className="text-xs text-slate-400">
            Google counts a visitor as active for 30 minutes after their last action, so "last 30 minutes" is the number of different people, not page views.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}