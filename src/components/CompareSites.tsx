import { useState } from "react";
import { Trophy, Wrench } from "lucide-react";
import { fn } from "../lib/supabase";
import { ErrorNote, Spinner } from "./ui";
import { Panel } from "./dash";

/* Free head-to-head: your site vs up to 4 competitors, measured live (speed, on-page SEO, authority, age, sitemap size).
   Server side: supabase/functions/compare. No paid API is used. */

type Row = {
  key: string;
  label: string;
  better: "high" | "low";
  values: (number | null)[];
  winner: number | null;
};
type Res = {
  checkedAt: string;
  sites: { host: string; reachable: boolean }[];
  rows: Row[];
  fixes: { metric: string; you: number | null; best: number; bestHost: string; tip: string }[];
  todo: string[];
  wins: number[];
};

const show = (v: number | null) =>
  v == null ? "n/a" : Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(v);

export default function CompareSites({ defaultMe = "" }: { defaultMe?: string }) {
  const [me, setMe] = useState(defaultMe);
  const [rivals, setRivals] = useState("");
  const [speed, setSpeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Res | null>(null);

  const run = async () => {
    const list = rivals
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!me.trim() || !list.length) {
      setErr("Enter your website and at least one competitor.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setRes(await fn<Res>("compare", { me: me.trim(), competitors: list, speed }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Me vs competitors"
      sub="Live check of speed, on-page SEO, authority, domain age and sitemap size. Free sources only."
    >
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
        <input className="input" placeholder="your-site.com" value={me} onChange={(e) => setMe(e.target.value)} />
        <input
          className="input"
          placeholder="competitor1.com, competitor2.com (up to 4)"
          value={rivals}
          onChange={(e) => setRivals(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : <Trophy className="h-4 w-4" />} Compare
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={speed} onChange={(e) => setSpeed(e.target.checked)} />
        Include Google PageSpeed (slower, up to about a minute)
      </label>
      <ErrorNote message={err} />

      {busy && <p className="mt-4 text-sm text-slate-500">Measuring all websites at the same time...</p>}

      {res && !busy && (
        <div className="mt-5 space-y-6">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">Metric</th>
                  {res.sites.map((s, i) => (
                    <th key={s.host} className="th">
                      {i === 0 ? "You: " : ""}
                      {s.host}
                      {!s.reachable && " (not reachable)"}
                      <span className="ml-1 text-[11px] font-normal text-slate-400">{res.wins[i]} wins</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="td text-slate-500">
                      {r.label} <span className="text-[11px]">({r.better === "high" ? "higher" : "lower"} is better)</span>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className={`td tabular-nums ${r.winner === i ? "font-semibold text-emerald-600" : ""}`}>
                        {show(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {res.fixes.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Wrench className="h-4 w-4" /> Where you are behind, and what to do
              </h3>
              <ul className="space-y-2 text-sm">
                {res.fixes.map((f) => (
                  <li key={f.metric} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <b>{f.metric}</b>: you {show(f.you)}, best is {show(f.best)} ({f.bestHost}). {f.tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.todo.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Quick fixes on your home page</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {res.todo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Real visits of other people's sites are private, so traffic stays an estimate. Everything in this table is measured directly.
          </p>
        </div>
      )}
    </Panel>
  );
}