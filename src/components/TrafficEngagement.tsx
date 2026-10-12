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
import { ChartTip, Delta, TipRow } from "./dash";
import { publicText } from "../lib/clean";

export type Kpi = {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
};

/** Traffic & Engagement: KPI numbers on top, chart below. Shown inside a Box on the board. */
export default function TrafficEngagement({
  kpis,
  daily,
  ga,
  gs,
  est,
  kwRows,
  tr,
}: {
  kpis: Kpi[];
  daily: any[];
  ga: any;
  gs: any;
  est: any;
  kwRows: any[];
  tr: any;
}) {
  return (
    <>
      {kpis.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k) => (
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
            "No traffic data is available for this check yet. Press “Re-run with fresh data” to try again."}
        </p>
      )}
      <div className="h-52">
        {daily.length > 1 ? (
          <ResponsiveContainer>
            <AreaChart data={daily} margin={{ left: -18, right: 6, top: 6 }}>
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
                dataKey="date"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => String(v).slice(5)}
                minTickGap={24}
              />
              <YAxis fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                content={
                  <ChartTip
                    labelFormat={(l: string) =>
                      new Date(l).toLocaleDateString([], {
                        dateStyle: "medium",
                      })
                    }
                  />
                }
              />
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
        ) : est && kwRows.some((k) => k.visits > 0) ? (
          <ResponsiveContainer>
            <AreaChart
              data={kwRows.filter((k) => k.visits > 0).slice(0, 20)}
              margin={{ left: -18, right: 10, top: 10 }}
            >
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
              <XAxis
                dataKey="keyword"
                tick={false}
                axisLine={false}
                tickLine={false}
              />
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
                        label="Visits / month*"
                        value={Math.round(
                          payload[0].payload.visits,
                        ).toLocaleString()}
                        color="#5b38ee"
                      />
                      <TipRow
                        label="Google position"
                        value={payload[0].payload.position ?? "–"}
                      />
                      <TipRow
                        label="Searches / month*"
                        value={Math.round(
                          payload[0].payload.volume,
                        ).toLocaleString()}
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
        {ga || gs
          ? "Read live from your Google accounts (last 30 days). Arrows compare the second half of the period with the first."
          : "Chart: visits per keyword, biggest first (hover for details). *Approximate figures."}
      </p>
    </>
  );
}
