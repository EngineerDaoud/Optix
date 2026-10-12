import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { scoreColor } from "./viz";

export const compact = (n: number | null | undefined) =>
  n == null || isNaN(n)
    ? "–"
    : Math.abs(n) >= 1e6
      ? `${(n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1)}M`
      : Math.abs(n) >= 1e3
        ? `${(n / 1e3).toFixed(Math.abs(n) >= 1e4 ? 0 : 1)}K`
        : String(Math.round(n));

export const healthColor = scoreColor;

/* ------------------------------------------------------------------ Panel */
export function Panel({
  title,
  sub,
  right,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`card fade-up ${className}`}>
      {(title || right) && (
        <div
          className={`flex items-start justify-between gap-3 ${flush ? "mb-0 border-b border-slate-100 px-5 py-4 dark:border-slate-800" : "mb-4"}`}
        >
          <div>
            {title && (
              <h2 className="text-[15px] font-medium tracking-tight">
                {title}
              </h2>
            )}
            {sub && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {sub}
              </p>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------- hover tooltip hook */
// Put `ref` on a `relative` wrapper, call onMove(content) on mouse move over a shape, render `node` inside the wrapper.
export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    content: ReactNode;
  } | null>(null);
  // x / y are viewport coordinates, the card is positioned with `fixed` and
  // clamped after it is measured so it can never leave the screen.
  const onMove = (content: ReactNode) => (e: React.MouseEvent) =>
    setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t || !tip) return;
    const pad = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    let left = tip.x + 14;
    if (left + tw > vw - pad) left = tip.x - tw - 14;
    let top = tip.y + 14;
    if (top + th > vh - pad) top = tip.y - th - 14;
    t.style.left = `${Math.max(pad, Math.min(left, vw - tw - pad))}px`;
    t.style.top = `${Math.max(pad, Math.min(top, vh - th - pad))}px`;
  }, [tip]);
  const node = tip && (
    <div
      ref={el}
      className="pointer-events-none fixed left-0 top-0 z-[120] w-56 max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-pop dark:border-slate-700 dark:bg-slate-800"
    >
      {tip.content}
    </div>
  );
  return { ref, onMove, hide, node };
}

export const TipRow = ({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) => (
  <div className="flex items-center justify-between gap-3 py-0.5">
    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color }}
        />
      )}
      {label}
    </span>
    <span className="font-semibold text-slate-900 dark:text-slate-100">
      {value}
    </span>
  </div>
);

/* recharts custom tooltip, styled like the card in the reference design */
export function ChartTip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: any & {
  format?: (v: number, name: string) => string;
  labelFormat?: (l: any) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="w-52 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-pop dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-1.5 font-bold">
        {labelFormat ? labelFormat(label) : label}
      </div>
      {payload.map((p: any) => (
        <TipRow
          key={p.dataKey ?? p.name}
          label={p.name}
          color={p.color ?? p.stroke ?? p.fill}
          value={
            format
              ? format(Number(p.value), String(p.name))
              : Number(p.value).toLocaleString()
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Semi gauge */
const polar = (cx: number, cy: number, r: number, pct: number) => {
  const a = Math.PI * (1 - pct / 100);
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
};
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

export function SemiGauge({
  value,
  detail,
}: {
  value: number | null | undefined;
  detail?: ReactNode;
}) {
  const { ref, onMove, hide, node } = useTip();
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = healthColor(value);
  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[280px]">
      <svg
        viewBox="0 0 260 150"
        className="w-full"
        role="img"
        aria-label={`Site health ${value ?? "n/a"} percent`}
        onMouseMove={onMove(
          <>
            <div className="mb-1 font-bold">Site health</div>
            {detail}
          </>,
        )}
        onMouseLeave={hide}
      >
        <path
          d={arc(130, 130, 100, 0, 100)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={30}
        />
        {value != null && (
          <path
            d={arc(130, 130, 100, 0, Math.max(v, 0.5))}
            fill="none"
            stroke={color}
            strokeWidth={30}
            style={{ transition: "all .6s" }}
          />
        )}
        <text
          x="130"
          y="122"
          textAnchor="middle"
          className="fill-current text-[44px] font-medium"
        >
          {value == null ? "–" : `${value}%`}
        </text>
      </svg>
      {node}
    </div>
  );
}

/* ------------------------------------------------------------------- Ring */
export function Ring({
  value,
  max = 100,
  color,
  label,
  display,
  size = 44,
  sub,
  delta,
}: {
  value: number | null | undefined;
  max?: number;
  color?: string;
  label: string;
  display?: string;
  size?: number;
  sub?: string;
  delta?: number | null;
}) {
  const { ref, onMove, hide, node } = useTip();
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, (value ?? 0) / max));
  const col = color ?? healthColor(value == null ? null : (value / max) * 100);
  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2.5"
      onMouseMove={onMove(
        <>
          <div className="mb-1 font-bold">{label}</div>
          <TipRow
            label="Score"
            value={value == null ? "–" : `${display ?? value}`}
            color={col}
          />
          {sub && <p className="mt-1 text-slate-500">{sub}</p>}
        </>,
      )}
      onMouseLeave={hide}
    >
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`${label} ${value ?? "n/a"}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "all .6s" }}
        />
      </svg>
      <div className="leading-tight">
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {label}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-2xl font-medium">
            {value == null ? "–" : (display ?? value)}
          </span>
          {delta != null && <Delta v={delta} />}
        </div>
      </div>
      {node}
    </div>
  );
}

export function Delta({ v, invert }: { v: number; invert?: boolean }) {
  const good = invert ? v < 0 : v > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${good ? "text-green-600" : "text-red-600"}`}
    >
      {v > 0 ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {Math.abs(v * 100).toFixed(1)}%
    </span>
  );
}

/* --------------------------------------------------------------- Mini line */
export function Spark({
  values,
  color = "#3b82f6",
  w = 120,
  h = 34,
}: {
  values: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  if (values.length < 2)
    return (
      <div className="flex h-[34px] items-center text-[10px] text-slate-400">
        Re-run later for a trend
      </div>
    );
  const max = Math.max(...values),
    min = Math.min(...values),
    span = max - min || 1;
  const pts = values.map(
    (v, i) =>
      [
        (i / (values.length - 1)) * (w - 4) + 2,
        h - 4 - ((v - min) / span) * (h - 8),
      ] as const,
  );
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `2,${h} ${line} ${w - 2},${h}`;
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon points={area} fill={color} fillOpacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------- Horizontal bars */
export function HBars({
  rows,
  color = "#6c47ff",
  unit = "",
  active,
  onHover,
}: {
  rows: { key: string; value: number; sub?: string; left?: ReactNode }[];
  color?: string;
  unit?: string;
  active?: string | null;
  onHover?: (k: string | null) => void;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length)
    return <p className="text-sm text-slate-500">No data for this period.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.key}
          onMouseEnter={() => onHover?.(r.key)}
          onMouseLeave={() => onHover?.(null)}
          className={`group rounded-lg px-2 py-1.5 transition ${active === r.key ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              {r.left}
              <span className="truncate">{r.key || "(not set)"}</span>
            </span>
            <span className="shrink-0 font-bold">
              {compact(r.value)}
              {unit}{" "}
              <span className="font-medium text-slate-400">
                · {Math.round((r.value / total) * 100)}%
              </span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const Dot = ({ color }: { color: string }) => (
  <span
    className="mr-1.5 inline-block h-2 w-2 rounded-full"
    style={{ background: color }}
  />
);

/* ------------------------------------------- +N / -N change (like the reference) */
export function Chg({ v }: { v: number }) {
  if (!v) return null;
  return (
    <span
      className={`text-[11px] font-bold ${v > 0 ? "text-green-600" : "text-red-600"}`}
    >
      {v > 0 ? "+" : "-"}
      {compact(Math.abs(v))}
    </span>
  );
}

/* ------------------------------------------ keyword stat tile: ring + number + trend */
export function StatTile({
  label,
  value,
  max,
  color,
  delta,
  spark,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  delta?: number | null;
  spark?: number[];
  hint?: string;
}) {
  const size = 38,
    r = size / 2 - 4,
    c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / Math.max(max, 1)));
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="flex items-center gap-2.5">
        <svg width={size} height={size} aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={5}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="num text-[26px] font-medium leading-none">
          {compact(value)}
        </span>
        {delta != null && <Chg v={delta} />}
      </div>
      <div className="mt-2 h-[34px]" title={hint}>
        {spark && spark.length > 1 ? (
          <Spark values={spark} color={color} h={34} />
        ) : (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(value ? 4 : 0, pct * 100)}%`,
                background: color,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}