import { useMemo } from "react";
import { useOrgCompetitors, type MapPoint } from "../lib/orgCompetitors";
import { ErrorNote, Spinner } from "./ui";

const COLORS = [
  "#6366d1",
  "#34d3a5",
  "#c084fc",
  "#fbbf24",
  "#fb7185",
  "#93a8fb",
];
const SITE = "#6c47ff";

const W = 480,
  H = 340,
  L = 60,
  R = 18,
  T = 14,
  B = 48;

/** Round axis steps (0, 100, 200...) so the labels are readable. */
function ticks(max: number, n = 4) {
  const raw = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= step * n + 1e-9; v += step) out.push(v);
  return out;
}
const fmt = (n: number) =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 10 && n % 1
        ? n.toFixed(1)
        : String(Math.round(n));

/**
 * "Competitive Positioning Map": x = organic keywords, y = estimated monthly organic traffic, bubble size = traffic.
 * The site itself is drawn too (purple, "you") so you see where you stand. Free: same data as the competitor table
 * (supabase/functions/orgcompetitors), traffic = search volume x click rate by position, an estimate.
 */
export default function PositioningMap({
  url,
  country,
  keywords,
}: {
  url: string;
  country: string;
  keywords: string[];
}) {
  const { data, loading, error } = useOrgCompetitors(url, country, keywords);

  const pts = useMemo(() => {
    const list = (data?.map ?? []).filter((p) => p.keywords > 0 || p.traffic > 0);
    const xMax = Math.max(1, ...list.map((p) => p.keywords)) * 1.18;
    const yMax = Math.max(1, ...list.map((p) => p.traffic)) * 1.18;
    const xt = ticks(xMax);
    const yt = ticks(yMax);
    const xTop = xt[xt.length - 1];
    const yTop = yt[yt.length - 1];
    const maxT = Math.max(1, ...list.map((p) => p.traffic));
    let ci = 0;
    const items = list.map((p) => ({
      ...p,
      color: p.site ? SITE : COLORS[ci++ % COLORS.length],
      cx: L + (p.keywords / xTop) * (W - L - R),
      cy: H - B - (p.traffic / yTop) * (H - T - B),
      r: p.traffic > 0 ? 8 + 38 * Math.sqrt(p.traffic / maxT) : 7,
    }));
    return { items, xt, yt, xTop, yTop };
  }, [data]);

  const nothing = !loading && !error && pts.items.length === 0;

  return (
    <section className="card fade-up flex flex-col !p-0">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h2 className="text-[19px] font-bold tracking-tight">
          Competitive Positioning Map
        </h2>
      </div>

      <div className="flex-1 px-6 pb-5 pt-4">
        <ErrorNote message={error} />

        {loading && !data && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading
          </div>
        )}

        {nothing && (
          <p className="py-8 text-center text-sm text-slate-500">
            Not enough data yet. Run a full check on the Dashboard; every check adds to our keyword
            database.
          </p>
        )}

        {pts.items.length > 0 && (
          <>
            {/* legend */}
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {pts.items.map((p) => (
                <div
                  key={p.domain}
                  className="flex min-w-0 items-center gap-2 text-[14px]"
                  title={p.site ? `${p.domain} (your site)` : p.domain}
                >
                  <i
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: p.color }}
                  />
                  <span className="truncate">
                    {p.domain}
                    {p.site ? " (you)" : ""}
                  </span>
                </div>
              ))}
            </div>

            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full text-slate-500"
              role="img"
              aria-label="Competitive positioning map"
            >
              {/* grid + axis numbers */}
              {pts.yt.map((v) => {
                const y = H - B - (v / pts.yTop) * (H - T - B);
                return (
                  <g key={`y${v}`}>
                    <line
                      x1={L}
                      x2={W - R}
                      y1={y}
                      y2={y}
                      className="stroke-slate-200 dark:stroke-slate-700"
                    />
                    <text x={L - 8} y={y + 4} textAnchor="end" fontSize="11" fill="currentColor">
                      {fmt(v)}
                    </text>
                  </g>
                );
              })}
              {pts.xt.map((v) => {
                const x = L + (v / pts.xTop) * (W - L - R);
                return (
                  <g key={`x${v}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={T}
                      y2={H - B}
                      className="stroke-slate-200 dark:stroke-slate-700"
                    />
                    <text x={x} y={H - B + 16} textAnchor="middle" fontSize="11" fill="currentColor">
                      {fmt(v)}
                    </text>
                  </g>
                );
              })}
              <text
                x={W / 2 + L / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="12"
                fill="currentColor"
              >
                Organic Keywords
              </text>
              <text
                transform={`translate(13 ${(H - B + T) / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize="12"
                fill="currentColor"
              >
                Organic Search Traffic
              </text>

              {/* bubbles: biggest first so small ones stay visible on top */}
              {[...pts.items]
                .sort((a, b) => b.r - a.r)
                .map((p: MapPoint & { color: string; cx: number; cy: number; r: number }) => (
                  <g key={p.domain}>
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={p.r}
                      fill={p.color}
                      fillOpacity={p.site ? 0.5 : 0.38}
                      stroke={p.color}
                      strokeOpacity="0.9"
                      strokeWidth={p.site ? 2.5 : 1}
                    >
                      <title>
                        {`${p.domain}${p.site ? " (you)" : ""}\n${p.keywords.toLocaleString("en-GB")} keywords · ~${Math.round(p.traffic).toLocaleString("en-GB")} visits/month (estimate)${p.coverage < 100 ? `\nVolume known for ${p.coverage}% of its keywords` : ""}`}
                      </title>
                    </circle>
                    <path
                      d={`M${p.cx - 3} ${p.cy}h6M${p.cx} ${p.cy - 3}v6`}
                      stroke={p.color}
                      strokeWidth="1.6"
                    />
                  </g>
                ))}
            </svg>
          </>
        )}
      </div>
    </section>
  );
}