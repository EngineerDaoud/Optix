import { publicText } from "../lib/clean";
import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

export const Spinner = ({ className = "" }: { className?: string }) => (
  <Loader2 className={`h-4 w-4 animate-spin ${className}`} />
);

const crumbNames: Record<string, string> = {
  dashboard: "Dashboard",
  traffic: "Traffic",
  competitors: "Competitor traffic",
  domains: "Domains",
  keywords: "Keyword Lab",
  reports: "Reports",
  tasks: "Tasks",
  integrations: "Integrations",
  settings: "Settings",
  admin: "Admin",
};
export function Breadcrumbs() {
  const seg =
    useLocation().pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
    >
      <Link to="/dashboard" className="hover:text-brand-600">
        Home
      </Link>
      <span>/</span>
      <span className="font-medium text-brand-600">
        {crumbNames[seg] ?? seg}
      </span>
    </nav>
  );
}

export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Breadcrumbs />
        <h1 className="text-2xl font-medium tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {sub && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {sub}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        {text}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

const tones: Record<string, string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  brand: "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200",
};
export const Badge = ({
  tone = "slate",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) => (
  <span
    className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
  >
    {children}
  </span>
);
export const priorityTone = (p: string) =>
  p === "high" ? "red" : p === "medium" ? "amber" : "slate";

export function KpiCard({
  label,
  value,
  delta,
  invert,
  series,
  empty,
}: {
  label: string;
  value: string;
  delta?: number | null;
  invert?: boolean;
  series?: number[];
  empty?: boolean;
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="card !p-4">
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </div>
      <div className="num mt-1 text-[32px] font-medium leading-tight">
        {empty ? "–" : value}
      </div>
      <div className="mt-1 flex h-8 items-end justify-between">
        {!empty && delta != null ? (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold ${good ? "text-green-600" : "text-red-600"}`}
          >
            {delta > 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : (
          <span />
        )}
        {!empty && series && series.some((v) => v > 0) && (
          <div className="h-8 w-20">
            <ResponsiveContainer>
              <LineChart data={series.map((v) => ({ v }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#6c47ff"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoreRing({
  value,
  label,
  size = 88,
}: {
  value: number | null | undefined;
  label: string;
  size?: number;
}) {
  const v = value ?? 0;
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const color =
    value == null
      ? "#94a3b8"
      : v >= 90
        ? "#16a34a"
        : v >= 50
          ? "#d97706"
          : "#dc2626";
  return (
    <div className="flex flex-col items-center gap-1">
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
          strokeOpacity={0.12}
          strokeWidth={7}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-current text-xl font-bold"
        >
          {value ?? "–"}
        </text>
      </svg>
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {publicText(message)}
    </div>
  );
}

/* ---------- copy button + clickable URL list (used by every issue / report list) ---------- */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through to the old way */
  }
  const t = document.createElement("textarea");
  t.value = text;
  t.style.position = "fixed";
  t.style.opacity = "0";
  document.body.appendChild(t);
  t.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  t.remove();
}

export function CopyButton({
  text,
  label,
  title = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={click}
      title={done ? "Copied" : title}
      aria-label={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${done ? "!text-green-600" : ""} ${className}`}
    >
      {done ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

export const hrefOf = (u: string) =>
  /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`;

export function UrlList({ urls, max = 8 }: { urls: string[]; max?: number }) {
  const [all, setAll] = useState(false);
  const list = Array.from(new Set(urls.filter(Boolean)));
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, max);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span className="text-[11px] font-medium text-slate-500">
          {list.length} {list.length === 1 ? "page" : "pages"}
        </span>
        <CopyButton
          text={list.join("\n")}
          label="Copy all"
          title="Copy all links"
        />
      </div>
      <ul className="scroll-thin max-h-64 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
        {shown.map((u) => (
          <li key={u} className="flex items-center gap-1 px-2.5 py-1">
            <a
              href={hrefOf(u)}
              target="_blank"
              rel="noopener noreferrer"
              title={u}
              className="min-w-0 flex-1 truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {u}
            </a>
            <CopyButton text={u} title="Copy link" />
            <a
              href={hrefOf(u)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              aria-label="Open in new tab"
              className="inline-flex shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
        ))}
      </ul>
      {list.length > max && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="w-full border-t border-slate-200 py-1.5 text-[11px] font-medium text-indigo-500 hover:underline dark:border-slate-800"
        >
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}