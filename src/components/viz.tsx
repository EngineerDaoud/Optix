import { ReactNode } from "react";

/** Progress / score colour scale: 90+ green, 74-89 yellow, 50-73 orange, <50 red. */
export const scoreColor = (v: number | null | undefined) =>
  v == null
    ? "#94a3b8"
    : v >= 90
      ? "#16a34a"
      : v >= 74
        ? "#eab308"
        : v >= 50
          ? "#f97316"
          : "#dc2626";

/** Semi-circle gauge like the "UR / DR" dials in the reference design. */
export function Gauge({
  value,
  label,
  color,
}: {
  value: number | null | undefined;
  label: string;
  color?: string;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 44;
  const arc = Math.PI * r;
  const c = color ?? scoreColor(value);
  return (
    <div className="flex flex-col items-center">
      <svg
        width="120"
        height="72"
        viewBox="0 0 120 72"
        role="img"
        aria-label={`${label} ${value ?? "n/a"}`}
      >
        <path
          d="M 16 64 A 44 44 0 0 1 104 64"
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={10}
          strokeLinecap="round"
        />
        <path
          d="M 16 64 A 44 44 0 0 1 104 64"
          fill="none"
          stroke={c}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={arc}
          strokeDashoffset={arc * (1 - v / 100)}
        />
        <text
          x="60"
          y="56"
          textAnchor="middle"
          className="fill-current text-2xl font-bold"
        >
          {value ?? "–"}
        </text>
      </svg>
      <span className="-mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </span>
    </div>
  );
}

export function Spark({
  values,
  color = "#6c47ff",
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2)
    return (
      <div className="h-10 w-28 text-right text-[11px] text-slate-400">
        Run again to see a trend
      </div>
    );
  const w = 112,
    h = 40,
    max = Math.max(...values),
    min = Math.min(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * (w - 4) + 2},${h - 4 - ((v - min) / span) * (h - 8)}`,
    )
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="trend"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null | undefined;
  color?: string;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="font-semibold">
          {value == null ? "–" : `${value}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full"
          style={{ width: `${v}%`, background: color ?? scoreColor(value) }}
        />
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  right,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-tight">{value}</div>
        {sub && (
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {sub}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div
      className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900"
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            value === t.id
              ? "bg-brand-600 text-white"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {t.label}
          {t.count != null && t.count > 0 && (
            <span
              className={`ml-1.5 rounded-full px-1.5 text-xs ${value === t.id ? "bg-white/25" : "bg-slate-100 dark:bg-slate-800"}`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export const Card = ({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) => (
  <section className="card">
    {(title || right) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && <h2 className="text-base font-semibold">{title}</h2>}
        {right}
      </div>
    )}
    {children}
  </section>
);

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[560px] border-collapse text-left">
      {children}
    </table>
  </div>
);