import { downloadPdf } from "../lib/pdfTable";
import {
  Children,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  ChevronDown,
  ExternalLink,
  ListChecks,
  MoreHorizontal,
  Printer,
  RefreshCw,
  RotateCw,
  Search,
  Star,
  X,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import WorldMap, { CountryRow } from "./WorldMap";
import TrafficEngagement from "./TrafficEngagement";
import KeywordSuggestions from "./KeywordSuggestions";
import { Badge, CopyButton, UrlList, hrefOf } from "./ui";
import {
  ChartTip,
  compact,
  Dot,
  healthColor,
  SemiGauge,
  TipRow,
} from "./dash";
import SpeedVitals from "./SpeedVitals";
import ChecklistPanel from "./ChecklistPanel";
import { halfDelta, shortPath } from "../lib/report";
import { exportBox } from "../lib/exportBox";
import { publicText } from "../lib/clean";
import { supabase } from "../lib/supabase";
import { daysAgo } from "../lib/format";

const C = {
  indigo: "#5b50ea",
  blue: "#3b82f6",
  green: "#2ed47a",
  pink: "#f0508c",
  teal: "#2dd4bf",
  amber: "#f5a623",
  violet: "#8b5cf6",
  grey: "#e5e9f2",
};
// same palette as the rest of the dashboard: blue, green, red, amber, pink, violet, teal, orange, lime
const KW_COLORS = [
  C.blue,
  C.green,
  "#ef4444",
  C.amber,
  C.pink,
  C.violet,
  C.teal,
  "#fb923c",
  "#a3e635",
];
const PAL = [C.indigo, C.green, C.amber, C.pink, C.blue, C.violet, C.teal];

/* ------------------------------------------------- Daily / Weekly / Monthly */
// Daily   = last 14 days, one bar per day
// Weekly  = last 7 days, one bar per day (with weekday + date)
// Monthly = last 30 days, one bar per 5-day block (e.g. "Sep 9–13")
type Period = "day" | "week" | "month";
const PERIODS: { k: Period; l: string }[] = [
  { k: "day", l: "Daily" },
  { k: "week", l: "Weekly" },
  { k: "month", l: "Monthly" },
];
const SPAN: Record<Period, { days: number; step: number }> = {
  day: { days: 14, step: 1 },
  week: { days: 7, step: 1 },
  month: { days: 30, step: 5 },
};
const RANGE_TEXT: Record<Period, string> = {
  day: "Last 14 days",
  week: "Last 7 days",
  month: "Last 30 days · 5-day blocks",
};
const tick = (n: number) => (n <= 8 ? 0 : Math.ceil(n / 8) - 1); // x-axis labels: show all when few bars, every 2nd when many

/** Small Daily / Weekly / Monthly switch shown in a card header. */
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
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  ymd(Date.parse(day + "T00:00:00Z") + n * 86400000);
const dayStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const fmtWeekday = (day: string) =>
  `${new Date(day + "T00:00:00Z").toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })} ${fmtDay(day)}`;
/** the date blocks of a view ending on `end`, oldest first */
const blocks = (p: Period, end: string) => {
  const { days, step } = SPAN[p];
  const out: { from: string; to: string; label: string }[] = [];
  for (let k = 0; k < days / step; k++) {
    const to = addDays(end, -(days - (k + 1) * step));
    const from = addDays(to, -(step - 1));
    const label =
      step === 1
        ? p === "week"
          ? fmtWeekday(to)
          : fmtDay(to)
        : from.slice(5, 7) === to.slice(5, 7)
          ? `${fmtDay(from)}–${Number(to.slice(8))}`
          : `${fmtDay(from)}–${fmtDay(to)}`;
    out.push({ from, to, label });
  }
  return out;
};
/** add up the traffic of every day inside each block */
const sumBlocks = (
  m: Map<string, { A: number; B: number }>,
  p: Period,
  end: string,
) =>
  blocks(p, end).map((b) => {
    let A = 0,
      B = 0;
    for (
      let t = Date.parse(b.from + "T00:00:00Z");
      t <= Date.parse(b.to + "T00:00:00Z");
      t += 86400000
    ) {
      const e = m.get(ymd(t));
      if (e) {
        A += e.A;
        B += e.B;
      }
    }
    return { d: b.label, A, B };
  });
const rankOf = (h: any) => Number(h?.ranked ?? 0);
const sortedChecks = (history: any[]) =>
  [...(history ?? [])]
    .map((h) => ({ ...h, day: dayStr(new Date(h.created_at)) }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
/** site health + keywords ranking as they stood at the end of each block (days without a check keep the last known value) */
const trendFor = (history: any[], p: Period) => {
  if ((history?.length ?? 0) < 2) return [];
  const rows = sortedChecks(history);
  return blocks(p, dayStr(new Date())).map((b) => {
    let last: any = null;
    for (const h of rows) {
      if (h.day <= b.to) last = h;
      else break;
    }
    return {
      n: b.label,
      A: last ? (last.health ?? 0) : null,
      B: last ? rankOf(last) : null,
    };
  });
};
/** keywords gained (+) or lost (-) inside each block, compared with where the previous block ended */
const flowFor = (history: any[], p: Period) => {
  const rows = sortedChecks(history);
  return blocks(p, dayStr(new Date())).map((b) => {
    let prev: any = null,
      first: any = null,
      cur: any = null;
    for (const h of rows) {
      if (h.day < b.from) prev = h;
      else if (h.day <= b.to) {
        if (!first) first = h;
        cur = h;
      }
    }
    if (!cur) return { n: b.label, v: 0 };
    return { n: b.label, v: rankOf(cur) - rankOf(prev ?? first) };
  });
};
const NoData = ({ text }: { text: string }) => (
  <p className="py-10 text-center text-xs text-slate-400">{text}</p>
);

/* ----------------------------------------------------------------- Box */
/** What the buttons in every card header do. refresh = reload this card from the newest saved data; rerun = full fresh check. */
type BoardActions = {
  refresh?: () => Promise<string | void>;
  rerun?: () => Promise<void>;
  host?: string;
};
const BoardCtx = createContext<BoardActions>({});

function Box({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
  tone = "light",
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "light" | "brand";
}) {
  const brand = tone === "brand";
  const act = useContext(BoardCtx);
  const ref = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "pdf" | "png" | "rerun">(
    "",
  );
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<{ err: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const run = async (
    kind: "refresh" | "pdf" | "png" | "rerun",
    job: () => Promise<string | void>,
  ) => {
    setMenu(false);
    setNote(null);
    setBusy(kind);
    try {
      const msg = await job();
      if (typeof msg === "string" && msg) setNote({ err: false, text: msg });
    } catch (e) {
      setNote({
        err: true,
        text:
          publicText((e as Error)?.message) ||
          "Something went wrong. Please try again.",
      });
    }
    setBusy("");
  };
  const refresh = () => act.refresh && run("refresh", act.refresh);
  const save = (kind: "pdf" | "png") =>
    ref.current &&
    run(kind, () => exportBox(ref.current!, title, act.host, kind));
  const rerun = () => {
    if (!act.rerun) return;
    if (
      window.confirm(
        "Re-run the full check with fresh data? This crawls the site again and can take a few minutes.",
      )
    )
      run("rerun", act.rerun);
  };

  const spinning = busy === "refresh" || busy === "rerun";
  const btn = `inline-flex items-center rounded p-1 transition disabled:cursor-wait disabled:opacity-60 ${brand ? "hover:bg-white/10 hover:text-white" : "hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"}`;
  const item =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <section
      ref={ref}
      className={`fade-up flex min-w-0 flex-col rounded-card border shadow-panel ${brand ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white dark:border-slate-800 dark:bg-slate-900"} ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <h3 className="truncate text-[14px] font-medium">{title}</h3>
        <div
          className={`flex shrink-0 items-center gap-2 ${brand ? "text-white/70" : "text-slate-400"}`}
        >
          {right}
          <div
            data-no-export
            className="relative flex items-center gap-0.5"
            ref={menuRef}
          >
            <button
              type="button"
              className={`${btn} hidden sm:inline-flex`}
              title="Refresh this section with the latest data"
              aria-label={`Refresh ${title}`}
              disabled={!!busy || !act.refresh}
              onClick={refresh}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              className={`${btn} hidden sm:inline-flex`}
              title="Download this section as a PDF report"
              aria-label={`Download ${title} as PDF`}
              disabled={!!busy}
              onClick={() => save("pdf")}
            >
              {busy === "pdf" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              className={btn}
              title="More"
              aria-label={`More options for ${title}`}
              aria-haspopup="menu"
              aria-expanded={menu}
              disabled={!!busy && busy !== "refresh"}
              onClick={() => setMenu((v) => !v)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menu && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={refresh}
                  disabled={!act.refresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh this section
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => save("pdf")}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download as PDF
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => save("png")}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Download as image (PNG)
                </button>
                {act.rerun && (
                  <button
                    type="button"
                    role="menuitem"
                    className={`${item} border-t border-slate-100 dark:border-slate-800`}
                    onClick={rerun}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Re-run full check (fresh data)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={`relative p-4 pt-3 ${bodyClassName}`}>
        {children}
        {note && (
          <p
            data-no-export
            role="status"
            className={`mt-2 text-[11px] ${note.err ? "text-red-500" : "text-slate-400"}`}
          >
            {note.text}
          </p>
        )}
        {spinning && (
          <div
            data-no-export
            className={`absolute inset-0 z-10 flex items-center justify-center rounded-b-card backdrop-blur-[1px] ${brand ? "bg-brand-600/60" : "bg-white/70 dark:bg-slate-900/70"}`}
          >
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}
      </div>
    </section>
  );
}
const Up = ({ v }: { v: number }) => (
  <span
    className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${v >= 0 ? "text-green-600" : "text-pink-600"}`}
  >
    {v >= 0 ? (
      <TrendingUp className="h-3 w-3" />
    ) : (
      <TrendingDown className="h-3 w-3" />
    )}
    {Math.abs(v).toFixed(1)}%
  </span>
);
const axis = { fontSize: 10, tickLine: false, axisLine: false } as const;
const Legend = ({ items }: { items: [string, string][] }) => (
  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
    {items.map(([l, c]) => (
      <span key={l} className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-2 w-2 rounded-sm"
          style={{ background: c }}
        />
        {l}
      </span>
    ))}
  </div>
);
const Prog = ({ pct, color = C.indigo }: { pct: number; color?: string }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
    <div
      className="h-full rounded-full"
      style={{
        width: `${Math.max(2, Math.min(100, pct))}%`,
        background: color,
      }}
    />
  </div>
);
const Stars = ({ n }: { n: number }) => (
  <span className="inline-flex">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        className="h-3 w-3"
        fill={i <= n ? C.amber : "none"}
        stroke={i <= n ? C.amber : "#cbd5e1"}
      />
    ))}
  </span>
);
const Mini = ({
  data,
  color,
  kind = "bar",
  h = 46,
}: {
  data: number[];
  color: string;
  kind?: "bar" | "area";
  h?: number;
}) => {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height: h }} className="w-full min-w-0">
      <ResponsiveContainer>
        {kind === "bar" ? (
          <BarChart
            data={rows}
            margin={{ top: 2, bottom: 0, left: 0, right: 0 }}
          >
            <Bar dataKey="v" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {rows.map((_, i) => (
                <Cell
                  key={i}
                  fill={color}
                  fillOpacity={0.25 + (i / rows.length) * 0.75}
                />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <AreaChart
            data={rows}
            margin={{ top: 4, bottom: 0, left: 0, right: 0 }}
          >
            <Area
              dataKey="v"
              type="monotone"
              stroke={color}
              fill={color}
              fillOpacity={0.18}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

/* a row that only exists when at least one of its panels has real data */
function Row({ children, cols = "" }: { children: ReactNode; cols?: string }) {
  if (!Children.toArray(children).length) return null;
  return (
    <div
      className={`grid gap-4 ${cols || "grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]"}`}
    >
      {children}
    </div>
  );
}
const has = (n: number | undefined | null) => (n ?? 0) > 0;

/* ================================================================ BOARD  (real data only) */
export default function CassieBoard({
  speed,
  vitals,
  speedDesktop,
  vitalsDesktop,
  errMobile,
  errDesktop,
  kpis,
  d,
  history,
  kwRows,
  ct,
  bk,
  sev,
  scoreBuckets,
  trend,
  daily,
  siteId,
  ga,
  gs,
  est,
  onRefresh,
  onRerun,
}: any) {
  const [hot, setHot] = useState<string | null>(null);
  const [pOrg, setPOrg] = useState<Period>("day");
  const [pVis, setPVis] = useState<Period>("day");
  const [pClk, setPClk] = useState<Period>("day");
  const [pTrend, setPTrend] = useState<Period>("day");
  const [pFlow, setPFlow] = useState<Period>("day");
  // daily traffic for connected sites comes from the saved history table (traffic_rollup); it fills / overrides the live 30 days
  const [rollDay, setRollDay] = useState<any[]>([]);
  useEffect(() => {
    if (!siteId) {
      setRollDay([]);
      return;
    }
    let off = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("traffic_rollup", {
          p_website: siteId,
          p_grain: "day",
          p_from: daysAgo(31),
          p_to: daysAgo(0),
        });
        if (!error && data && !off) setRollDay(data);
      } catch {
        /* keep the live data */
      }
    })();
    return () => {
      off = true;
    };
  }, [siteId, d?.id]);
  if (!d) return null;
  const m = d.meta;

  const s30 = useMemo(
    () =>
      daily?.length > 1
        ? daily.slice(-30).map((x: any) => ({
            d: String(x.date).slice(5),
            A: x.sessions ?? 0,
            B: x.clicks ?? 0,
          }))
        : [],
    [daily],
  );
  const hasA = s30.some((x: any) => x.A > 0),
    hasB = s30.some((x: any) => x.B > 0);
  const dA = halfDelta(s30.map((x: any) => x.A)),
    dB = halfDelta(s30.map((x: any) => x.B));
  const trafficMap = new Map<string, { A: number; B: number }>();
  (daily ?? []).forEach((x: any) => {
    let ds = String(x.date);
    if (/^\d{8}$/.test(ds))
      ds = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6)}`;
    trafficMap.set(ds.slice(0, 10), { A: x.sessions ?? 0, B: x.clicks ?? 0 });
  });
  rollDay.forEach((x: any) =>
    trafficMap.set(String(x.period).slice(0, 10), {
      A: Number(x.sessions) || 0,
      B: Number(x.gsc_clicks) || 0,
    }),
  );
  const trafficEnd = daysAgo(1);
  const seriesFor = (p: Period) => sumBlocks(trafficMap, p, trafficEnd);
  const sOrg = seriesFor(pOrg),
    sVis = seriesFor(pVis),
    sClk = seriesFor(pClk);
  const sumOf = (rows: { A: number; B: number }[], k: "A" | "B") =>
    rows.reduce((a, x) => a + x[k], 0);

  const visitsTotal: number | null =
    ga?.totals?.sessions ?? (est?.organic?.mid > 0 ? est.organic.mid : null);
  const strip: { l: string; v: string; d?: number | null }[] = [];
  if (visitsTotal != null)
    strip.push({
      l: ga ? "Visits" : "Est. visits / month",
      v: compact(visitsTotal),
      d: ga ? dA : null,
    });
  if (gs) {
    strip.push(
      { l: "Impressions", v: compact(gs.totals.impressions) },
      { l: "Clicks", v: compact(gs.totals.clicks), d: dB },
      { l: "CTR", v: `${(gs.totals.ctr * 100).toFixed(1)}%` },
    );
    if (gs.totals.position)
      strip.push({ l: "Avg. position", v: gs.totals.position.toFixed(1) });
  }
  const checked = bk?.checked ?? 0;
  const top10 = checked ? Math.round((bk.top10 / checked) * 100) : 0;
  const top3 = checked ? Math.round((bk.top3 / checked) * 100) : 0;

  const topKw = (kwRows ?? []).slice(0, 6).map((k: any) => ({
    n: k.keyword,
    s: k.position ? `Position ${k.position}` : "Not in top results",
    v: k.visits > 0 ? k.visits : k.volume,
    kd: k.kd,
  }));
  const kwBars = (kwRows ?? [])
    .slice(0, 9)
    .map((k: any) => ({ n: k.keyword, v: k.visits > 0 ? k.visits : k.volume }))
    .filter((k: any) => k.v > 0);

  const pagesList: any[] = d.pages ?? [];
  const healthy = pagesList.filter((p) => p.score >= 90).length;
  const quota = (scoreBuckets ?? []).map((b: any) => ({
    n: b.name,
    v: b.n,
    c: b.c,
  }));
  const pageRows = [...pagesList]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((p) => ({
      n: shortPath(p.url) || "/",
      i: p.issues?.length ?? 0,
      s: p.score,
    }));
  const issues = (d.issues ?? []).slice(0, 5).map((i: any) => {
    const fromPages = pagesList
      .filter((p: any) =>
        (p.issues ?? []).some((x: any) => (x?.id ?? x) === i.id),
      )
      .map((p: any) => String(p.url));
    return {
      t: i.label,
      s: i.severity,
      c: i.count,
      fix: i.fix as string | undefined,
      urls: fromPages.length ? fromPages : ((i.examples ?? []) as string[]),
    };
  });
  const sevRows = (sev ?? []).filter((x: any) => x.value > 0);
  const sevTotal = sevRows.reduce((a: number, x: any) => a + x.value, 0);

  // real crawl data for the "On-Page Coverage" and "Speed & Content" cards
  const okPages = pagesList.filter(
    (p: any) =>
      p.status === 200 &&
      (p.words > 0 || !!p.title || (p.h1s?.length ?? 0) > 0),
  );
  const countOf = (test: (p: any) => boolean) => okPages.filter(test).length;
  const imgTotal = okPages.reduce(
    (a: number, p: any) => a + (p.images?.total ?? 0),
    0,
  );
  const imgNoAlt = okPages.reduce(
    (a: number, p: any) => a + (p.images?.noAlt ?? 0),
    0,
  );
  const covRows = okPages.length
    ? [
        { n: "Title tag", v: countOf((p) => !!p.title), t: okPages.length },
        {
          n: "Meta description",
          v: countOf((p) => !!p.description),
          t: okPages.length,
        },
        {
          n: "H1 heading",
          v: countOf((p) => (p.h1s?.length ?? 0) > 0),
          t: okPages.length,
        },
        {
          n: "Structured data",
          v: countOf((p) => (p.schema?.length ?? 0) > 0),
          t: okPages.length,
        },
        ...(imgTotal > 0
          ? [{ n: "Images with alt text", v: imgTotal - imgNoAlt, t: imgTotal }]
          : []),
      ]
    : [];
  const covColor = (pct: number) =>
    pct >= 90 ? "#16a34a" : pct >= 74 ? "#eab308" : pct >= 50 ? "#f97316" : "#dc2626";
  const timed = okPages.filter((p: any) => p.ms > 0);
  const avgMs = timed.length
    ? Math.round(
        timed.reduce((a: number, p: any) => a + p.ms, 0) / timed.length,
      )
    : null;
  const withWords = okPages.filter((p: any) => p.words > 0);
  const avgWords = withWords.length
    ? Math.round(
        withWords.reduce((a: number, p: any) => a + p.words, 0) /
          withWords.length,
      )
    : null;
  const linksInt = okPages.reduce(
    (a: number, p: any) => a + (p.linkStats?.internal ?? 0),
    0,
  );
  const linksExt = okPages.reduce(
    (a: number, p: any) => a + (p.linkStats?.external ?? 0),
    0,
  );
  const slowRows = [...timed]
    .sort((a: any, b: any) => b.ms - a.ms)
    .slice(0, 4)
    .map((p: any) => ({ n: shortPath(p.url) || "/", ms: p.ms as number }));
  const topLeftHas =
    pageRows.length > 0 || covRows.length > 0 || okPages.length > 0;
  const msColor = (ms: number) =>
    ms > 2000 ? C.pink : ms > 1000 ? C.amber : C.green;

  const channels: { name: string; value: number }[] = ga?.channels?.length
    ? ga.channels.map((x: any) => ({ name: x.key, value: x.sessions }))
    : [];
  const channelTitle = "Traffic by Channel";

  const trendRows = trendFor(history, pTrend);
  // how many dates of the trend have a saved check: with 1 date a line cannot be drawn, so dots + a note are shown instead
  const trendPoints = trendRows.filter((r: any) => r.A != null).length;
  const historyOk = (history?.length ?? 0) >= 2;
  const rankSeries: number[] = (history ?? []).map((h: any) =>
    Number(h.ranked ?? 0),
  );
  const flow = flowFor(history, pFlow);
  const countryRows = ct?.rows ?? [];
  const posRows = checked
    ? [
        { name: "Top 3", value: bk.top3 },
        { name: "4 – 10", value: Math.max(bk.top10 - bk.top3, 0) },
        { name: "11 – 30", value: Math.max(bk.top30 - bk.top10, 0) },
        { name: "Beyond 30", value: Math.max(bk.ranked - bk.top30, 0) },
      ].filter((r) => r.value > 0)
    : [];
  const healthScore = m?.health;

  return (
    <BoardCtx.Provider
      value={{ refresh: onRefresh, rerun: onRerun, host: m?.host }}
    >
      <div className="space-y-4">
        {/* organic chart (only when Google Analytics / Search Console data exists) */}
        {s30.length > 0 && (
          <Row cols="grid-cols-1">
            <Box
              title="Organic Visits & Clicks"
              right={
                <div className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-slate-400 sm:inline">
                    {RANGE_TEXT[pOrg]}
                  </span>
                  <PeriodTabs value={pOrg} onChange={setPOrg} />
                </div>
              }
            >
              <div className="h-60 min-w-0">
                <ResponsiveContainer>
                  <BarChart
                    data={sOrg}
                    margin={{ left: -20, right: 4, top: 6 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      strokeDasharray="3 3"
                      strokeOpacity={0.3}
                    />
                    <XAxis dataKey="d" {...axis} interval={tick(sOrg.length)} />
                    <YAxis {...axis} />
                    <Tooltip
                      content={<ChartTip />}
                      cursor={{ fill: "#6c47ff11" }}
                    />
                    {hasA && (
                      <Bar
                        dataKey="A"
                        name="Visits"
                        stackId="a"
                        fill={C.teal}
                      />
                    )}
                    {hasB && (
                      <Bar
                        dataKey="B"
                        name="Clicks"
                        stackId="a"
                        fill={C.indigo}
                        radius={[2, 2, 0, 0]}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {strip.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 dark:border-slate-800 sm:grid-cols-3 lg:grid-cols-5">
                  {strip.map((x) => (
                    <div key={x.l} className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="num text-xl font-medium">{x.v}</span>
                        {x.d != null && <Up v={x.d * 100} />}
                      </div>
                      <div className="truncate text-[10px] uppercase text-slate-400">
                        {x.l}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Box>
          </Row>
        )}

        {/* visits + clicks over time */}
        <Row>
          {hasA && (
            <Box
              title="Visits (Google Analytics)"
              right={<PeriodTabs value={pVis} onChange={setPVis} />}
            >
              <div className="flex items-baseline gap-2">
                <span className="num text-[34px] font-medium leading-none">
                  {compact(sumOf(sVis, "A"))}
                </span>
                {pVis === "month" && dA != null && <Up v={dA * 100} />}
                <span className="text-[11px] text-slate-400">
                  {RANGE_TEXT[pVis].toLowerCase()}
                </span>
              </div>
              <div className="mt-2 h-40">
                <ResponsiveContainer>
                  <AreaChart
                    data={sVis}
                    margin={{ left: -30, right: 0, top: 4 }}
                  >
                    <defs>
                      <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={C.indigo}
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="100%"
                          stopColor={C.indigo}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="d" {...axis} interval={tick(sVis.length)} />
                    <YAxis {...axis} />
                    <Tooltip content={<ChartTip />} />
                    <Area
                      dataKey="A"
                      name="Visits"
                      type="monotone"
                      stroke={C.indigo}
                      strokeWidth={2}
                      fill="url(#gE)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Box>
          )}
          {hasB && (
            <Box
              title="Google Search Clicks"
              right={<PeriodTabs value={pClk} onChange={setPClk} />}
            >
              <div className="flex items-baseline gap-2">
                <span className="num text-[34px] font-medium leading-none">
                  {compact(sumOf(sClk, "B"))}
                </span>
                {pClk === "month" && dB != null && <Up v={dB * 100} />}
                <span className="text-[11px] text-slate-400">
                  {RANGE_TEXT[pClk].toLowerCase()}
                </span>
              </div>
              <div className="mt-2 h-40">
                <ResponsiveContainer>
                  <LineChart
                    data={sClk}
                    margin={{ left: -30, right: 0, top: 4 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      strokeDasharray="3 3"
                      strokeOpacity={0.3}
                    />
                    <XAxis dataKey="d" {...axis} interval={tick(sClk.length)} />
                    <YAxis {...axis} />
                    <Tooltip content={<ChartTip />} />
                    <Line
                      dataKey="B"
                      name="Clicks"
                      type="monotone"
                      stroke={C.green}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Box>
          )}
        </Row>

        {/* site health + speed, same size side by side */}
        <Row cols="xl:grid-cols-2">
          <Box title="Site health">
            <SemiGauge
              value={m?.health}
              detail={<TipRow label="Pages crawled" value={m?.pagesCrawled} />}
            />
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span>
                  <Dot color={healthColor(m?.health)} />
                  Your site
                </span>
                <b>{m?.health}%</b>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
              {has(m?.pagesCrawled) && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Pages crawled</span>
                  <b>{m.pagesCrawled}</b>
                </div>
              )}
              {pagesList.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Pages scoring 90+</span>
                  <b>
                    {healthy} / {pagesList.length}
                  </b>
                </div>
              )}
              {checked > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">
                    Keywords found in Google
                  </span>
                  <b>
                    {bk.ranked} / {checked}
                  </b>
                </div>
              )}
            </div>
          </Box>
          <Box title="Speed & Core Web Vitals">
            <SpeedVitals
              speed={speed}
              vitals={vitals}
              speedDesktop={speedDesktop}
              vitalsDesktop={vitalsDesktop}
              errMobile={errMobile}
              errDesktop={errDesktop}
            />
          </Box>
        </Row>

        {/* traffic & engagement + world map, same size side by side */}
        <Row cols={countryRows.length ? "xl:grid-cols-2" : "grid-cols-1"}>
          <Box
            title="Traffic & Engagement"
            right={
              <Badge tone={ga || gs ? "green" : "amber"}>
                {ga || gs ? "Real data" : "Approx."}
              </Badge>
            }
          >
            <TrafficEngagement
              kpis={kpis ?? []}
              daily={daily ?? []}
              ga={ga}
              gs={gs}
              est={est}
              kwRows={kwRows ?? []}
              tr={d?.traffic}
            />
          </Box>
          {countryRows.length > 0 && (
            <Box
              title="Traffic by Location"
              bodyClassName="flex flex-1 flex-col justify-center"
            >
              <div className="mx-auto w-full max-w-[680px] min-w-0">
                <WorldMap
                  rows={countryRows as CountryRow[]}
                  unit={ct.unit}
                  active={hot}
                  onHover={setHot}
                />
              </div>
              <div className="mx-auto mt-4 w-full max-w-[680px] border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="mb-2 text-center text-[10px] font-medium uppercase text-slate-400">
                  Top countries · {ct.unit}
                </div>
                <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  {countryRows.slice(0, 6).map((r: any, i: number) => (
                    <li
                      key={r.a2}
                      onMouseEnter={() => setHot(r.a2)}
                      onMouseLeave={() => setHot(null)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <i
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: PAL[i % PAL.length] }}
                        />
                        <span className="truncate">{r.name}</span>
                      </span>
                      <b className="num font-medium">{compact(r.value)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Box>
          )}
        </Row>

        {/* health trend + keyword movement, side by side */}
        <Row cols="xl:grid-cols-2">
          {historyOk && (
            <Box
              title="Health & Ranking Trend"
              right={<PeriodTabs value={pTrend} onChange={setPTrend} />}
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
                {healthScore != null && (
                  <span>
                    <span className="text-slate-400">SITE HEALTH </span>
                    <b className="num text-base font-medium">{healthScore}</b>
                  </span>
                )}
                <span className="ml-auto">
                  <Legend
                    items={[
                      ["Health", C.green],
                      ["Keywords ranking", C.blue],
                    ]}
                  />
                </span>
              </div>
              {trendRows.every((r: any) => r.A == null) ? (
                <NoData text="No saved check in this period yet. Run a check to fill this graph." />
              ) : (
                <div className="h-52">
                  <ResponsiveContainer>
                    <AreaChart
                      data={trendRows}
                      margin={{ left: -24, right: 4, top: 6 }}
                    >
                      <defs>
                        <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={C.green}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor={C.green}
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={C.blue}
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="100%"
                            stopColor={C.blue}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        strokeDasharray="3 3"
                        strokeOpacity={0.3}
                      />
                      <XAxis
                        dataKey="n"
                        {...axis}
                        interval={tick(trendRows.length)}
                      />
                      <YAxis {...axis} />
                      <Tooltip content={<ChartTip />} />
                      <Area
                        dataKey="A"
                        name="Health"
                        type="monotone"
                        stroke={C.green}
                        strokeWidth={2}
                        fill="url(#gA)"
                        connectNulls
                        dot={trendPoints <= 3 ? { r: 4, fill: C.green } : false}
                      />
                      <Area
                        dataKey="B"
                        name="Keywords ranking"
                        type="monotone"
                        stroke={C.blue}
                        strokeWidth={2}
                        fill="url(#gB)"
                        connectNulls
                        dot={trendPoints <= 3 ? { r: 4, fill: C.blue } : false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {trendPoints === 1 && (
                <p className="mt-1 text-center text-[11px] text-slate-400">
                  Only one day of saved checks so far, so the graph shows a single point. The line appears as more
                  daily checks are saved.
                </p>
              )}
            </Box>
          )}
          {historyOk && (
            <Box
              title="Keyword Movement Between Checks"
              right={<PeriodTabs value={pFlow} onChange={setPFlow} />}
            >
              <Legend
                items={[
                  ["Gained", C.green],
                  ["Lost", C.pink],
                ]}
              />
              {flow.length === 0 ? (
                <NoData text="No saved checks in this period yet." />
              ) : flow.every((f: any) => !f.v) ? (
                <NoData text="No keywords were gained or lost between the saved checks in this period. Bars appear here when the number of ranking keywords changes from one check to the next." />
              ) : (
                <div className="mt-2 h-48">
                  <ResponsiveContainer>
                    <BarChart
                      data={flow}
                      margin={{ left: -22, right: 4, top: 6 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        strokeDasharray="3 3"
                        strokeOpacity={0.3}
                      />
                      <XAxis
                        dataKey="n"
                        {...axis}
                        interval={tick(flow.length)}
                      />
                      <YAxis {...axis} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="v" name="Change" radius={[2, 2, 0, 0]}>
                        {flow.map((f: any, i: number) => (
                          <Cell key={i} fill={f.v >= 0 ? C.green : C.pink} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Box>
          )}
        </Row>

        {/* channels (keyword performance now lives inside the Organic search card) */}
        <Row cols="grid-cols-1">
          {channels.length > 0 && (
            <Box title={channelTitle}>
              <div style={{ height: Math.max(190, channels.length * 38) }}>
                <ResponsiveContainer>
                  <BarChart
                    data={channels}
                    layout="vertical"
                    margin={{ left: 6, right: 16, top: 4 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="3 3"
                      strokeOpacity={0.3}
                    />
                    <XAxis type="number" {...axis} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      {...axis}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      content={<ChartTip />}
                      cursor={{ fill: "#6c47ff11" }}
                    />
                    <Bar
                      dataKey="value"
                      name={ga?.channels?.length ? "Visits" : "Share"}
                      radius={[0, 3, 3, 0]}
                      barSize={14}
                    >
                      {channels.map((_, i) => (
                        <Cell key={i} fill={PAL[i % PAL.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Box>
          )}
        </Row>

        {/* keyword suggestions (replaces the two 3D charts) */}
        {(has(d?.keywordTable?.length) ||
          has(d?.rankings?.length) ||
          has(d?.ideaTable?.length)) && (
          <Row cols="grid-cols-1">
            <Box title="Keyword Suggestions">
              <KeywordSuggestions d={d} />
            </Box>
          </Row>
        )}

        {/* tables */}
        <Row
          cols={
            (pageRows.length > 0 || covRows.length > 0 || okPages.length > 0) &&
            (issues.length > 0 || sevTotal > 0)
              ? "xl:grid-cols-[7fr_5fr]"
              : "grid-cols-1"
          }
        >
          {topLeftHas && (
            <Box title="Top Pages" className="min-w-0">
              {pageRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <th className="th">Page</th>
                        <th className="th text-right">Issues</th>
                        <th className="th text-right">Score</th>
                        <th className="th">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((p: any) => (
                        <tr
                          key={p.n}
                          className="border-t border-line dark:border-slate-800"
                        >
                          <td className="td max-w-[220px] truncate">{p.n}</td>
                          <td className="td text-right">{p.i}</td>
                          <td className="td text-right font-medium">{p.s}%</td>
                          <td className="td">
                            <Stars n={Math.max(1, Math.round(p.s / 20))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(covRows.length > 0 || okPages.length > 0) && (
                <div
                  className={`grid min-w-0 gap-x-8 gap-y-6 md:grid-cols-2 ${pageRows.length > 0 ? "mt-5 border-t border-line pt-5 dark:border-slate-800" : ""}`}
                >
                  {covRows.length > 0 && (
                    <div className="flex min-w-0 flex-col">
                      <h4 className="mb-1 text-[13px] font-medium">
                        On-Page Coverage
                      </h4>
                      <p className="mb-2 text-[11px] text-slate-500">
                        Crawled pages with each basic SEO element. Hover a bar
                        for details.
                      </p>
                      <div className="relative min-h-[230px] flex-1">
                        <div className="absolute inset-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={covRows.map((r) => {
                                const pct = Math.round(
                                  (r.v / Math.max(r.t, 1)) * 100,
                                );
                                return { n: r.n, v: r.v, t: r.t, pct };
                              })}
                              layout="vertical"
                              margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
                              barCategoryGap="28%"
                            >
                              <XAxis type="number" domain={[0, 100]} hide />
                              <YAxis
                                type="category"
                                dataKey="n"
                                width={112}
                                {...axis}
                                tick={{ fontSize: 11, fill: "#94a3b8" }}
                              />
                              <Tooltip
                                cursor={{ fill: "#6c47ff11" }}
                                content={({ active, payload }: any) => {
                                  if (!active || !payload?.length) return null;
                                  const r = payload[0].payload;
                                  return (
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                      <div className="mb-0.5 font-medium">
                                        {r.n}
                                      </div>
                                      <div className="text-slate-500">
                                        <b className="num font-medium text-current">
                                          {r.v}
                                        </b>{" "}
                                        of {r.t} · {r.pct}%
                                      </div>
                                      <div className="text-slate-500">
                                        {r.t - r.v} missing
                                      </div>
                                    </div>
                                  );
                                }}
                              />
                              <Bar
                                dataKey="pct"
                                radius={[0, 4, 4, 0]}
                                barSize={16}
                                background={{ fill: "#94a3b81f", radius: 4 }}
                              >
                                {covRows.map((r) => (
                                  <Cell
                                    key={r.n}
                                    fill={covColor(
                                      Math.round(
                                        (r.v / Math.max(r.t, 1)) * 100,
                                      ),
                                    )}
                                  />
                                ))}
                                <LabelList
                                  dataKey="pct"
                                  position="right"
                                  formatter={(v: any) => `${v}%`}
                                  style={{ fontSize: 11, fill: "#94a3b8" }}
                                />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                  {okPages.length > 0 && (
                    <div className="min-w-0">
                      <h4 className="mb-1 text-[13px] font-medium">
                        Speed &amp; Content
                      </h4>

                      <p className="mb-2 text-[11px] text-slate-500">
                        Averages across {okPages.length} crawled pages.
                      </p>
                      <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
                        <div className="rounded-lg bg-slate-50 px-1.5 py-2 dark:bg-slate-800/60">
                          <div className="text-[10px] font-semibold text-slate-500">
                            Response
                          </div>
                          <div className="num whitespace-nowrap text-sm font-medium">
                            {avgMs != null ? `${avgMs} ms` : "–"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-1.5 py-2 dark:bg-slate-800/60">
                          <div className="text-[10px] font-semibold text-slate-500">
                            Words / page
                          </div>
                          <div className="num whitespace-nowrap text-sm font-medium">
                            {avgWords != null ? avgWords : "–"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-1.5 py-2 dark:bg-slate-800/60">
                          <div className="text-[10px] font-semibold text-slate-500">
                            Links in / out
                          </div>
                          <div className="num whitespace-nowrap text-sm font-medium">
                            {linksInt} / {linksExt}
                          </div>
                        </div>
                      </div>
                      {slowRows.length > 0 && (
                        <>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Slowest pages
                          </div>
                          <ul className="divide-y divide-line text-[11px] dark:divide-slate-800">
                            {slowRows.map((r) => (
                              <li
                                key={r.n}
                                className="flex items-center justify-between gap-3 py-1.5"
                              >
                                <span className="min-w-0 truncate">{r.n}</span>
                                <b
                                  className="num shrink-0 font-medium"
                                  style={{ color: msColor(r.ms) }}
                                >
                                  {r.ms} ms
                                </b>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {timed.length > 0 && (
                        <SpeedDetailsButton
                          pages={timed.map((p: any) => ({
                            url: String(p.url),
                            ms: p.ms as number,
                          }))}
                          total={okPages.length}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </Box>
          )}
          {(issues.length > 0 || sevTotal > 0) && (
            <div
              className={`relative min-w-0 ${topLeftHas ? "xl:min-h-[420px]" : ""}`}
            >
              <Box
                title="Issues Found"
                className={topLeftHas ? "xl:absolute xl:inset-0" : ""}
                bodyClassName={
                  topLeftHas ? "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col" : ""
                }
              >
                {sevTotal > 0 && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-baseline gap-2">
                        <span className="num text-[44px] font-medium leading-none">
                          {sevTotal}
                        </span>
                        <span className="text-xs text-slate-500">
                          issues in total
                        </span>
                      </div>
                      {(d?.checklist?.length ?? 0) > 0 && (
                        <ChecklistMini items={d.checklist} />
                      )}
                    </div>
                    <div className="my-3 flex h-2 overflow-hidden rounded-full">
                      {sevRows.map((x: any) => (
                        <i
                          key={x.name}
                          style={{
                            width: `${(x.value / sevTotal) * 100}%`,
                            background: x.c,
                          }}
                        />
                      ))}
                    </div>
                    <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                      {sevRows.map((x: any) => (
                        <li key={x.name} className="flex items-center gap-2">
                          <i
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{ background: x.c }}
                          />
                          {x.name}
                          <span className="text-slate-500">
                            <b className="num font-medium text-current">
                              {x.value}
                            </b>{" "}
                            · {Math.round((x.value / sevTotal) * 100)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                    <IssueDetailsButton pages={pagesList} total={sevTotal} />
                  </>
                )}
                {issues.length > 0 && (
                  <IssueList
                    issues={issues}
                    withTop={sevTotal > 0}
                    fill={topLeftHas}
                  />
                )}
              </Box>
            </div>
          )}
        </Row>
      </div>
    </BoardCtx.Provider>
  );
}

/** one row of "Issues Found": click it to see the fix and the clickable, copyable list of affected pages */
function IssueList({
  issues,
  withTop,
  fill = false,
}: {
  issues: any[];
  withTop: boolean;
  fill?: boolean;
}) {
  // accordion: only one issue is open at a time, opening another closes the previous one
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <ul
      className={`scroll-thin divide-y divide-line dark:divide-slate-800 ${withTop ? "mt-4 border-t border-line dark:border-slate-800" : ""} ${fill ? "xl:min-h-0 xl:flex-1 xl:overflow-y-auto" : ""}`}
    >
      {issues.map((i: any, k: number) => (
        <IssueItem
          key={k}
          i={i}
          k={k}
          open={openIdx === k}
          onToggle={() => setOpenIdx(openIdx === k ? null : k)}
        />
      ))}
    </ul>
  );
}

function IssueItem({
  i,
  k,
  open,
  onToggle,
}: {
  i: any;
  k: number;
  open: boolean;
  onToggle: () => void;
}) {
  const col = PAL[k % PAL.length];
  const has = (i.urls?.length ?? 0) > 0 || !!i.fix;
  return (
    <li className="py-2.5">
      <button
        type="button"
        disabled={!has}
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-medium"
          style={{ background: `${col}22`, color: col }}
        >
          {i.c}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{i.t}</div>
          <div className="text-[11px] text-slate-400">
            {i.c} found{has ? (open ? " · hide pages" : " · show pages") : ""}
          </div>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${i.s === "high" ? "bg-pink-100 text-pink-700" : i.s === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}
        >
          {i.s}
        </span>
        {has && (
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-12">
          {i.fix && <p className="text-xs text-slate-500">{i.fix}</p>}
          <UrlList urls={i.urls ?? []} />
        </div>
      )}
    </li>
  );
}

/* ---------- Issue Severity: button + popup with every issue, the exact page and what is wrong ---------- */
type Inst = {
  url: string;
  id: string;
  label: string;
  severity: string;
  fix?: string;
  detail?: string;
};
const sevCls = (s: string) =>
  s === "high"
    ? "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300"
    : s === "medium"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
const SevTag = ({ s }: { s: string }) => (
  <span
    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${sevCls(s)}`}
  >
    {s}
  </span>
);
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
/* ---------- "Improve" guide: why each issue matters and the exact steps to fix it ---------- */
type Guide = { why: string; steps: string[]; code?: string };
const IMPROVE: Record<string, Guide> = {
  "no-og": {
    why: "Open Graph tags control the title, text and picture shown when this page is shared on WhatsApp, Facebook, LinkedIn, Slack and X. Without them the preview looks blank or random and gets fewer clicks.",
    steps: [
      "Open the page template (or the SEO / social settings of your CMS) and find the <head> section.",
      "Add og:title (the page title), og:description (1 to 2 sentences) and og:image (a 1200 x 630 px picture, full https link).",
      "Also add og:url and og:type so every platform reads the page the same way.",
      "Test the result in the Facebook Sharing Debugger or LinkedIn Post Inspector, then run the audit again.",
    ],
    code: `<meta property="og:title" content="Page title here" />\n<meta property="og:description" content="Short summary of the page." />\n<meta property="og:image" content="https://example.com/images/share.jpg" />\n<meta property="og:url" content="https://example.com/this-page" />\n<meta property="og:type" content="website" />`,
  },
  "no-canonical": {
    why: "A canonical tag tells Google which URL is the main version of the page. Without it, the same page reached through filters, tracking links or www / non-www can be treated as duplicates and split its ranking power.",
    steps: [
      "Decide the one preferred URL of this page (https, one host version, no tracking parameters).",
      "Add a canonical link in the <head> that points to that URL.",
      "Every page should point to itself unless it is a deliberate duplicate of another page.",
    ],
    code: `<link rel="canonical" href="https://example.com/this-page" />`,
  },
  "no-lang": {
    why: "The lang attribute tells browsers, screen readers and search engines which language the page is written in. It helps accessibility and correct translation and regional results.",
    steps: [
      "Open the main layout / theme file that outputs the <html> tag.",
      "Add the language code, for example en or en-GB.",
      "Use the matching code on translated pages.",
    ],
    code: `<html lang="en-GB">`,
  },
  "no-viewport": {
    why: "Without a viewport tag phones show a zoomed-out desktop page. Google ranks on the mobile version, so this can hurt rankings and usability.",
    steps: [
      "Open the page template and find the <head> section.",
      "Add the viewport meta tag exactly as below.",
      "Check the page on a phone or in browser mobile mode.",
    ],
    code: `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
  },
  "no-title": {
    why: "The title is the blue link in Google results and the strongest on-page signal. A missing title means Google invents one.",
    steps: [
      "Write a unique title of 30 to 60 characters.",
      "Put the main keyword near the start and the brand at the end.",
      "Add it inside <head>.",
    ],
    code: `<title>Main keyword | Brand name</title>`,
  },
  "title-short": {
    why: "A very short title wastes space in the search result and says little about the page.",
    steps: [
      "Rewrite the title to 30 to 60 characters.",
      "Include the main keyword and one benefit or detail.",
    ],
  },
  "title-long": {
    why: "Google cuts titles longer than about 60 characters, so the end (often the keyword or brand) is hidden.",
    steps: [
      "Shorten the title to 60 characters or less.",
      "Keep the main keyword at the start.",
    ],
  },
  "dup-title": {
    why: "Pages with the same title compete with each other and Google cannot tell which one to show.",
    steps: [
      "Open each page listed and write a title unique to that page.",
      "Mention what is different (product, city, category).",
    ],
  },
  "no-desc": {
    why: "Without a meta description Google picks random text from the page, which is usually a weaker pitch.",
    steps: [
      "Write 70 to 160 characters that describe the page and give a reason to click.",
      "Add it in the <head>.",
    ],
    code: `<meta name="description" content="Short, clear summary that makes people want to click." />`,
  },
  "desc-short": {
    why: "A very short description does not use the space available to win the click.",
    steps: [
      "Expand it to 70 to 160 characters.",
      "Mention the main keyword and a benefit.",
    ],
  },
  "desc-long": {
    why: "Google cuts descriptions longer than about 160 characters, so the ending is lost.",
    steps: [
      "Shorten it to about 150 to 160 characters.",
      "Put the most important message first.",
    ],
  },
  "dup-desc": {
    why: "Identical descriptions make different pages look the same in search results.",
    steps: [
      "Write a different description for every page listed.",
      "Describe what is unique on that page.",
    ],
  },
  "no-h1": {
    why: "The H1 is the main heading. It tells visitors and Google what the page is about.",
    steps: [
      "Add one H1 near the top of the page.",
      "Use the main keyword in natural words.",
    ],
    code: `<h1>Main heading of the page</h1>`,
  },
  "multi-h1": {
    why: "More than one H1 makes the page topic unclear and usually points to a template problem.",
    steps: [
      "Keep one H1 for the page topic.",
      "Change the other H1s to H2 or H3.",
    ],
  },
  thin: {
    why: "Pages with very little text rarely rank because they do not answer what people search for.",
    steps: [
      "Add original, useful content: details, FAQs, sizes, delivery, how to choose.",
      "Aim for at least 300 words of real content.",
      "If the page cannot be improved, merge it into a stronger page or set it to noindex.",
    ],
  },
  alt: {
    why: "Alt text describes images for screen readers and for Google image search. Missing alt text hurts accessibility and image traffic.",
    steps: [
      "Open each image listed and add a short description of what it shows.",
      "Leave alt empty only for purely decorative images.",
    ],
    code: `<img src="bike.jpg" alt="Black electric folding bike on a city street" />`,
  },
  "no-size": {
    why: "Images without width and height make the page jump while it loads, which hurts the Cumulative Layout Shift (CLS) score.",
    steps: [
      "Add the real width and height attributes to each <img>.",
      "Keep responsive CSS (max-width:100%; height:auto) so it still scales.",
    ],
    code: `<img src="bike.jpg" width="800" height="600" alt="..." />`,
  },
  slow: {
    why: "A slow first response delays everything else and lowers Core Web Vitals and conversions.",
    steps: [
      "Turn on page caching or a CDN.",
      "Check slow plugins, database queries and heavy server work.",
      "Aim for a first response under 800 ms.",
    ],
  },
  mixed: {
    why: "Loading http resources on an https page triggers browser warnings and can block content.",
    steps: [
      "Change every http:// image, script and style link to https://.",
      'Check the browser console for "mixed content" messages.',
    ],
  },
  "broken-link": {
    why: "Links to pages that return errors frustrate visitors and waste crawl budget.",
    steps: [
      "Open each broken link listed.",
      "Update it to the right page, redirect it, or remove it.",
    ],
  },
  "broken-ext": {
    why: "Dead outbound links make the page look neglected.",
    steps: ["Replace the link with a working source or remove it."],
  },
  noindex: {
    why: "A noindex tag removes the page from Google. That is only right for pages you do not want found.",
    steps: [
      "If the page should rank, remove the noindex from the robots meta tag or the X-Robots-Tag header.",
      "Request indexing in Google Search Console.",
    ],
  },
  status: {
    why: "Pages that return errors lose rankings and waste crawl budget.",
    steps: [
      "Open the URL and check the error.",
      "Fix the page, or 301-redirect it to the best replacement, and remove it from the sitemap if it is gone.",
    ],
  },
};
const NON_HTML_URL =
  /\.(md|markdown|txt|json|xml|ya?ml|csv|pdf|rss|atom)(\?.*)?$/i;

function ImproveDialog({
  inst,
  count,
  onClose,
}: {
  inst: Inst;
  count: number;
  onClose: () => void;
}) {
  const g = IMPROVE[inst.id];
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(g?.code ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="How to improve"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <h3 className="text-base font-semibold">{inst.label}</h3>
              <SevTag s={inst.severity} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              How to improve this issue
              {count > 1 ? ` (found on ${count} pages)` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin flex-1 space-y-4 overflow-auto px-4 py-3 text-sm">
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Affected page
            </h4>
            <div className="flex items-center gap-1 rounded-md bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
              <a
                href={hrefOf(inst.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                title={inst.url}
              >
                {inst.url}
              </a>
              <CopyButton text={inst.url} title="Copy link" />
            </div>
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              What is wrong
            </h4>
            <p className="text-slate-700 dark:text-slate-300">
              {inst.detail ?? inst.label}
            </p>
            {g && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                <b className="font-medium">Why it matters: </b>
                {g.why}
              </p>
            )}
          </section>
          {NON_HTML_URL.test(inst.url) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
              This URL is a file, not a web page. Search and social tags (title,
              canonical, Open Graph, language) do not apply to it, so you can
              safely ignore this issue. Run a new audit and files like this will
              be skipped automatically.
            </p>
          )}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              What to do
            </h4>
            {g ? (
              <ol className="list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-300">
                {g.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-slate-700 dark:text-slate-300">
                {inst.fix ??
                  "Review this page and fix the problem described above."}
              </p>
            )}
          </section>
          {g?.code && (
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Example code
                </h4>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
              <pre className="scroll-thin overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100 dark:bg-black/60">
                <code>{g.code}</code>
              </pre>
            </section>
          )}
        </div>
        <div className="flex justify-end border-t border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- SEO checklist: short summary on the page, full list in a popup ---------- */
function ChecklistMini({ items }: { items: any[] }) {
  const [open, setOpen] = useState(false);
  const n = (st: string) => items.filter((x) => x.status === st).length;
  const rows = [
    { k: "fail", c: C.pink },
    { k: "warn", c: C.amber },
    { k: "manual", c: "#94a3b8" },
    { k: "pass", c: C.green },
  ];
  return (
    <>
      <button
        type="button"
        data-no-export
        onClick={() => setOpen(true)}
        title="Open the full SEO checklist"
        className="group w-[210px] max-w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-indigo-400 dark:border-slate-700 dark:hover:border-indigo-400"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <ListChecks className="h-3.5 w-3.5 text-indigo-500" /> SEO checklist
          </span>
          <span className="text-slate-500">
            <b className="num font-medium text-current">{n("pass")}</b> /{" "}
            {items.length}
          </span>
        </div>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full">
          {rows.map((r) => (
            <i
              key={r.k}
              style={{
                width: `${(n(r.k) / items.length) * 100}%`,
                background: r.c,
              }}
            />
          ))}
        </div>
        <div className="mt-1 text-[10.5px] text-slate-400 group-hover:text-indigo-500">
          {n("fail") + n("warn")} to fix · view details
        </div>
      </button>
      {open && <ChecklistModal items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChecklistModal({
  items,
  onClose,
}: {
  items: any[];
  onClose: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="SEO checklist"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">SEO checklist</h2>
            <p className="text-xs text-slate-500">
              {items.length} technical, content and authority checks. Click a
              row to see what was found and how to fix it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin overflow-auto p-4">
          <ChecklistPanel items={items} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Speed popup: response time of every crawled page ---------- */
function SpeedDetailsButton({
  pages,
  total,
}: {
  pages: { url: string; ms: number }[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-no-export
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-indigo-600"
      >
        <ListChecks className="h-4 w-4" /> View speed of all {total} pages
      </button>
      {open && <SpeedModal pages={pages} onClose={() => setOpen(false)} />}
    </>
  );
}

function SpeedModal({
  pages,
  onClose,
}: {
  pages: { url: string; ms: number }[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"slow" | "fast">("slow");

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      pages
        .filter((p) => !needle || p.url.toLowerCase().includes(needle))
        .sort((a, b) => (order === "slow" ? b.ms - a.ms : a.ms - b.ms)),
    [pages, needle, order],
  );
  const slow = pages.filter((p) => p.ms > 2000).length;
  const mid = pages.filter((p) => p.ms > 1000 && p.ms <= 2000).length;
  const fast = pages.length - slow - mid;
  const col = (ms: number) =>
    ms > 2000 ? C.pink : ms > 1000 ? C.amber : C.green;
  const chip = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Speed of all pages"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">Speed of every page</h2>
            <p className="text-xs text-slate-500">
              Response time of {pages.length} crawled pages ·{" "}
              <span style={{ color: C.green }}>{fast} fast</span> ·{" "}
              <span style={{ color: C.amber }}>{mid} medium</span> ·{" "}
              <span style={{ color: C.pink }}>{slow} slow</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="flex gap-1">
            <button
              type="button"
              className={chip(order === "slow")}
              onClick={() => setOrder("slow")}
            >
              Slowest first
            </button>
            <button
              type="button"
              className={chip(order === "fast")}
              onClick={() => setOrder("fast")}
            >
              Fastest first
            </button>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search page..."
            className="min-w-[160px] flex-1 rounded-md border border-slate-200 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-indigo-400 dark:border-slate-700"
          />
        </div>
        <ul className="scroll-thin divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {list.map((p) => (
            <li key={p.url} className="flex items-center gap-3 px-4 py-2">
              <a
                href={hrefOf(p.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={p.url}
                className="min-w-0 flex-1 truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {shortPath(p.url) || "/"}
              </a>
              <b
                className="num shrink-0 text-xs font-medium"
                style={{ color: col(p.ms) }}
              >
                {p.ms} ms
              </b>
              <CopyButton text={p.url} title="Copy link" />
            </li>
          ))}
          {!list.length && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              No page found.
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function IssueDetailsButton({ pages, total }: { pages: any[]; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-no-export
        onClick={() => setOpen(true)}
        className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-600"
      >
        <ListChecks className="h-4 w-4" /> View all {total} issues with pages
      </button>
      {open && <IssuesModal pages={pages} onClose={() => setOpen(false)} />}
    </>
  );
}

function IssuesModal({
  pages,
  onClose,
}: {
  pages: any[];
  onClose: () => void;
}) {
  const [view, setView] = useState<"issue" | "page">("issue");
  const [sev, setSev] = useState<"all" | "high" | "medium" | "low">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [improve, setImprove] = useState<{ inst: Inst; count: number } | null>(
    null,
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // files such as .md / .txt / .json are not web pages: ignore HTML issues saved by older audits
  const all = useMemo<Inst[]>(
    () =>
      pages
        .filter((p: any) => !NON_HTML_URL.test(String(p.url)))
        .flatMap((p: any) =>
          (p.issues ?? []).map((i: any) => ({
            url: String(p.url),
            id: String(i.id ?? i.label ?? i),
            label: String(i.label ?? i.id ?? i),
            severity: String(i.severity ?? "low"),
            fix: i.fix,
            detail: i.detail,
          })),
        ),
    [pages],
  );
  const counts = {
    all: all.length,
    high: all.filter((x) => x.severity === "high").length,
    medium: all.filter((x) => x.severity === "medium").length,
    low: all.filter((x) => x.severity === "low").length,
  };

  const needle = q.trim().toLowerCase();
  const list = all.filter(
    (x) =>
      (sev === "all" || x.severity === sev) &&
      (!needle ||
        x.label.toLowerCase().includes(needle) ||
        x.url.toLowerCase().includes(needle) ||
        (x.detail ?? "").toLowerCase().includes(needle)),
  );
  const groups = useMemo(() => {
    const m = new Map<string, Inst[]>();
    for (const x of list) {
      const k = view === "issue" ? x.id : x.url;
      (m.get(k) ?? m.set(k, []).get(k)!).push(x);
    }
    return [...m.entries()].sort((a, b) =>
      view === "issue"
        ? (SEV_ORDER[a[1][0].severity] ?? 3) -
            (SEV_ORDER[b[1][0].severity] ?? 3) || b[1].length - a[1].length
        : b[1].length - a[1].length,
    );
  }, [list, view]);

  function exportPdf() {
    downloadPdf("site-issues.pdf", [
      ["Page", "Issue", "Severity", "What is wrong", "How to fix"],
      ...list.map((x) => [x.url, x.label, x.severity, x.detail ?? "", x.fix ?? ""]),
    ]);
  }

  const chip = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="All issues"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">All issues found</h2>
            <p className="text-xs text-slate-500">
              {counts.all} issues on {pages.length} pages. Click an item to see
              the exact pages and what is wrong.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
            >
              <Download className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="flex gap-1">
            <button
              type="button"
              className={chip(view === "issue")}
              onClick={() => {
                setView("issue");
                setOpen(null);
              }}
            >
              By issue
            </button>
            <button
              type="button"
              className={chip(view === "page")}
              onClick={() => {
                setView("page");
                setOpen(null);
              }}
            >
              By page
            </button>
          </div>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <div className="flex flex-wrap gap-1">
            {(["all", "high", "medium", "low"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={chip(sev === k)}
                onClick={() => {
                  setSev(k);
                  setOpen(null);
                }}
              >
                <span className="capitalize">{k}</span>{" "}
                <span className="opacity-70">({counts[k]})</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(null);
              }}
              placeholder="Search issue or page"
              className="w-48 rounded-md border border-slate-200 bg-transparent py-1 pl-7 pr-2 text-xs dark:border-slate-700"
            />
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-auto px-4 py-2">
          {!groups.length ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No issue matches the filter.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map(([key, items]) => {
                const id = `${view}:${key}`;
                const isOpen = open === id;
                const first = items[0];
                return (
                  <li key={id} className="py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span className="grid h-7 min-w-[1.75rem] shrink-0 place-items-center rounded-full bg-slate-100 px-1.5 text-xs font-medium dark:bg-slate-800">
                        {items.length}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        title={view === "issue" ? first.label : key}
                      >
                        {view === "issue" ? first.label : key}
                      </span>
                      {view === "issue" && <SevTag s={first.severity} />}
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="mt-2 space-y-2 pl-10">
                        {view === "issue" && first.fix && (
                          <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                            <b className="font-medium">How to fix: </b>
                            {first.fix}
                          </p>
                        )}
                        {view === "page" && (
                          <div className="flex items-center gap-1">
                            <a
                              href={hrefOf(key)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              <ExternalLink className="h-3 w-3" /> Open page
                            </a>
                            <CopyButton
                              text={key}
                              label="Copy link"
                              title="Copy link"
                            />
                          </div>
                        )}
                        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                          {view === "issue" && (
                            <li className="flex items-center justify-between px-2.5 py-1.5">
                              <span className="text-[11px] font-medium text-slate-500">
                                {items.length}{" "}
                                {items.length === 1 ? "page" : "pages"}
                              </span>
                              <CopyButton
                                text={items.map((x) => x.url).join("\n")}
                                label="Copy all links"
                                title="Copy all links"
                              />
                            </li>
                          )}
                          {items.map((x, n) => (
                            <li
                              key={`${x.url}-${x.id}-${n}`}
                              className="flex items-start gap-1 px-2.5 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                {view === "issue" ? (
                                  <a
                                    href={hrefOf(x.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={x.url}
                                    className="block truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                                  >
                                    {x.url}
                                  </a>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="truncate text-xs font-medium"
                                      title={x.label}
                                    >
                                      {x.label}
                                    </span>
                                    <SevTag s={x.severity} />
                                  </div>
                                )}
                                {x.detail && (
                                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span className="font-medium">
                                      What is wrong:{" "}
                                    </span>
                                    {x.detail}
                                  </div>
                                )}
                                {view === "page" && x.fix && (
                                  <div className="mt-0.5 text-[11px] text-slate-400">
                                    {x.fix}
                                  </div>
                                )}
                              </div>
                              {view === "page" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImprove({
                                      inst: x,
                                      count: all.filter((a) => a.id === x.id)
                                        .length,
                                    })
                                  }
                                  title="How to improve"
                                  aria-label="How to improve"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950"
                                >
                                  <Lightbulb className="h-3.5 w-3.5" /> Improve
                                </button>
                              )}
                              {view === "issue" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setImprove({
                                        inst: x,
                                        count: items.length,
                                      })
                                    }
                                    title="How to improve"
                                    aria-label="How to improve"
                                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950"
                                  >
                                    <Lightbulb className="h-3.5 w-3.5" />{" "}
                                    Improve
                                  </button>
                                  <CopyButton text={x.url} title="Copy link" />
                                  <a
                                    href={hrefOf(x.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open in new tab"
                                    aria-label="Open in new tab"
                                    className="inline-flex shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {improve && (
        <ImproveDialog
          inst={improve.inst}
          count={improve.count}
          onClose={() => setImprove(null)}
        />
      )}
    </div>,
    document.body,
  );
}