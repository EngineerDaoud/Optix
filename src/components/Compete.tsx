import { useMemo, useState } from "react";
import { Badge } from "./ui";
import { compact, Panel, Spark } from "./dash";

/* ------------------------------------------------------------------------------------------------
   Head-to-head: pick a competitor and see, keyword by keyword, who ranks higher.
   Uses only the Google results already collected for this check (top 10 of every keyword), so it is free.
------------------------------------------------------------------------------------------------ */
export function HeadToHead({ d }: { d: any }) {
  const comps: { domain: string; keywords: number }[] = (
    d.competitors ?? []
  ).slice(0, 6);
  const [sel, setSel] = useState<string>(comps[0]?.domain ?? "");
  const vol = useMemo(
    () =>
      new Map<string, any>(
        (d.keywordTable ?? []).map((k: any) => [
          String(k.keyword).toLowerCase(),
          k,
        ]),
      ),
    [d],
  );

  const res = useMemo(() => {
    if (!sel) return null;
    let they = 0,
      you = 0,
      only = 0,
      tie = 0;
    const lose: {
      keyword: string;
      you: number | null;
      them: number;
      volume: number;
      kd: number | null;
    }[] = [];
    for (const r of d.rankings ?? []) {
      if (r.error || !r.serp?.domains) continue;
      const hit = r.serp.domains
        .filter((x: any) => x.d === sel)
        .map((x: any) => x.p);
      const them: number | null = hit.length ? Math.min(...hit) : null;
      const me: number | null = r.position ?? null;
      if (them == null && me == null) continue;
      if (them != null && (me == null || them < me)) {
        they++;
        if (me == null) only++;
        const k = vol.get(String(r.keyword).toLowerCase());
        lose.push({
          keyword: r.keyword,
          you: me,
          them,
          volume: k?.volume ?? 0,
          kd: k?.kd ?? null,
        });
      } else if (me != null && (them == null || me < them)) you++;
      else tie++;
    }
    lose.sort((a, b) => b.volume - a.volume || a.them - b.them);
    return { they, you, only, tie, lose };
  }, [d, sel, vol]);

  return (
    <Panel
      title="Head-to-head"
      sub="You vs one competitor, keyword by keyword (Google top 10)"
    >
      {!comps.length || !res ? (
        <p className="text-sm text-slate-500">
          No competitors found yet. Press “Re-run with fresh data” on the
          Dashboard to look again.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {comps.map((c) => (
              <button
                key={c.domain}
                onClick={() => setSel(c.domain)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${sel === c.domain ? "border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-300" : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-white/10"}`}
              >
                {c.domain}
              </button>
            ))}
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-green-500/10 py-3">
              <div className="text-2xl font-extrabold text-green-600">
                {res.you}
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                You rank higher
              </div>
            </div>
            <div className="rounded-xl bg-red-500/10 py-3">
              <div className="text-2xl font-extrabold text-red-600">
                {res.they}
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                They rank higher
              </div>
            </div>
            <div className="rounded-xl bg-amber-500/10 py-3">
              <div className="text-2xl font-extrabold text-amber-600">
                {res.only}
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                Only they rank
              </div>
            </div>
          </div>
          {res.lose.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left">
                <thead>
                  <tr>
                    <th className="th">Keywords to take from them</th>
                    <th className="th">Volume*</th>
                    <th className="th">You</th>
                    <th className="th">Them</th>
                  </tr>
                </thead>
                <tbody>
                  {res.lose.slice(0, 10).map((k) => (
                    <tr key={k.keyword}>
                      <td className="td font-medium">{k.keyword}</td>
                      <td className="td">
                        {k.volume ? compact(k.volume) : "–"}
                      </td>
                      <td className="td">
                        {k.you ? (
                          `#${k.you}`
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="td">
                        <Badge tone="amber">#{k.them}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-400">
                * Approximate. Start with the top rows: highest search volume
                where they already beat you.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Good news: {sel} does not beat you on any keyword in this check.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------------
   Keyword tracker: position of each keyword over your saved checks (real history, like Semrush
   Position Tracking). Every check you run adds one more point.
------------------------------------------------------------------------------------------------ */
export function KeywordTracker({ d, history }: { d: any; history: any[] }) {
  const runs = history.filter((h) => Array.isArray(h.ranks));
  const rows = useMemo(() => {
    const out: {
      keyword: string;
      now: number | null;
      prev: number | null;
      best: number | null;
      series: number[];
      volume: number;
    }[] = [];
    const volOf = new Map<string, number>(
      (d.keywordTable ?? []).map((k: any) => [
        String(k.keyword).toLowerCase(),
        k.volume ?? 0,
      ]),
    );
    const keys = new Set<string>();
    runs.forEach((h) => h.ranks.forEach((x: any) => keys.add(x.k)));
    keys.forEach((kw) => {
      const pos = runs.map((h) => {
        const x = h.ranks.find((y: any) => y.k === kw);
        return x ? (x.p as number | null) : null;
      });
      const now = pos[pos.length - 1] ?? null;
      const prev = pos.length > 1 ? pos[pos.length - 2] : null;
      const ranked = pos.filter((p): p is number => p != null);
      out.push({
        keyword: kw,
        now,
        prev,
        best: ranked.length ? Math.min(...ranked) : null,
        series: pos.map((p) => (p == null ? 0 : 101 - p)),
        volume: volOf.get(kw.toLowerCase()) ?? 0,
      });
    });
    return out
      .filter((r) => r.now != null || r.prev != null)
      .sort((a, b) => (a.now ?? 999) - (b.now ?? 999) || b.volume - a.volume);
  }, [d, runs]);

  const change = (r: (typeof rows)[number]) => {
    if (runs.length < 2) return null;
    if (r.now != null && r.prev == null) return <Badge tone="green">New</Badge>;
    if (r.now == null && r.prev != null) return <Badge tone="red">Lost</Badge>;
    if (r.now == null || r.prev == null) return null;
    const dlt = r.prev - r.now;
    return dlt === 0 ? (
      <span className="text-xs text-slate-400">–</span>
    ) : (
      <span
        className={`text-xs font-bold ${dlt > 0 ? "text-green-600" : "text-red-600"}`}
      >
        {dlt > 0 ? "▲" : "▼"} {Math.abs(dlt)}
      </span>
    );
  };

  return (
    <Panel
      title="Keyword tracker"
      sub={
        runs.length > 1
          ? `Positions across your last ${runs.length} checks`
          : "Run the same site again on another day to see movement"
      }
    >
      {!rows.length ? (
        <p className="text-sm text-slate-500">
          No ranking history yet. Every check you run is saved and adds a point
          here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left">
            <thead>
              <tr>
                <th className="th">Keyword</th>
                <th className="th">Now</th>
                <th className="th">Change</th>
                <th className="th">Best</th>
                <th className="th w-24">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((r) => (
                <tr key={r.keyword}>
                  <td className="td font-medium">{r.keyword}</td>
                  <td className="td">
                    {r.now ? (
                      <Badge
                        tone={
                          r.now <= 3 ? "green" : r.now <= 10 ? "amber" : "slate"
                        }
                      >
                        #{r.now}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                  <td className="td">{change(r)}</td>
                  <td className="td text-xs text-slate-500">
                    {r.best ? `#${r.best}` : "–"}
                  </td>
                  <td className="td">
                    {r.series.length > 1 ? (
                      <div className="h-6 w-20">
                        <Spark
                          values={r.series}
                          color={
                            r.now && r.prev && r.now > r.prev
                              ? "#dc2626"
                              : "#16a34a"
                          }
                          h={24}
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
