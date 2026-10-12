import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, RefreshCw } from "lucide-react";
import { fn } from "../lib/supabase";
import { ErrorNote, Spinner } from "./ui";
import { ChartTip, compact, Delta, HBars, healthColor, Panel, Ring } from "./dash";
import { shortPath } from "../lib/report";

const change = (cur?: number, prev?: number) =>
  cur != null && prev ? (cur - prev) / prev : null;
const secs = (s: number) =>
  s >= 60
    ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
    : `${Math.round(s)}s`;

function Tile({
  label,
  value,
  sub,
  delta,
  invert,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  invert?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
      <div className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[22px] font-medium leading-tight">
          {value}
        </span>
        {delta != null && isFinite(delta) && (
          <Delta v={delta} invert={invert} />
        )}
      </div>
      {sub && (
        <div className="truncate text-[10.5px] text-slate-400">{sub}</div>
      )}
    </div>
  );
}

function Tracking({ t }: { t: any }) {
  if (!t) return null;
  const found = [...(t.ga4 ?? []), ...(t.gtm ?? []), ...(t.universal ?? [])];
  const others = [
    t.metaPixel && "Meta Pixel",
    t.tiktokPixel && "TikTok Pixel",
    t.klaviyo && "Klaviyo",
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="font-semibold text-slate-500">
        Tracking on the website:
      </span>
      {found.length ? (
        found.map((x: string) => (
          <span
            key={x}
            className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300"
          >
            {x}
          </span>
        ))
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500 dark:bg-slate-800">
          No Google Analytics code found
        </span>
      )}
      {others.map((x) => (
        <span
          key={x}
          className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {x}
        </span>
      ))}
      {t.searchConsoleTag && (
        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          Search Console tag
        </span>
      )}
    </div>
  );
}

const money = (n: number | null | undefined, cur?: string | null) =>
  n == null
    ? "–"
    : `${cur ? cur + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** How the website score is made up: a radar picture of the parts, and each part with its note. */
function ScoreBreakdown({
  sc,
  connected,
  onConnect,
}: {
  sc: any;
  connected: boolean;
  onConnect: () => void;
}) {
  if (!sc) return null;
  const n = (sc.tips ?? []).length;
  const parts: any[] = sc.parts ?? [];
  const radar = parts.length >= 3;
  return (
    <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Website score{" "}
          <span className="font-normal text-slate-400">
            · {sc.score}/100 · {sc.label}
            {sc.covers < 100 ? ` · based on ${sc.covers}% of the checks` : ""}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          {n ? `${n} improvements are listed in the Action plan` : "Nothing important to fix"}
          {!connected && (
            <>
              {" · "}
              <button className="font-medium text-brand-600 underline" onClick={onConnect}>
                Connect Google for the full score
              </button>
            </>
          )}
        </span>
      </div>
      <div
        className={`grid items-center gap-4 ${radar ? "lg:grid-cols-[200px_minmax(0,1fr)]" : ""}`}
      >
        {radar && (
          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative h-40 w-40">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  strokeWidth="10"
                  className="stroke-slate-100 dark:stroke-slate-800"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  stroke={healthColor(sc.score)}
                  strokeDasharray={`${(Math.max(0, Math.min(100, sc.score)) / 100) * 314.16} 314.16`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="num text-4xl font-bold leading-none">{sc.score}</span>
                <span className="mt-1 text-[11px] text-slate-400">out of 100</span>
              </div>
            </div>
            <span
              className="mt-2 rounded-full px-3 py-0.5 text-xs font-semibold"
              style={{ background: `${healthColor(sc.score)}22`, color: healthColor(sc.score) }}
            >
              {sc.label}
            </span>
          </div>
        )}
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {parts.map((x: any) => (
            <div key={x.key}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">{x.label}</span>
                <span className="num text-slate-500">{x.score}/100</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${x.score}%`, background: healthColor(x.score) }}
                />
              </div>
              <div className="mt-0.5 text-[10.5px] text-slate-400">{x.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
    {children}
  </span>
);

const PassBars = ({ rows }: { rows: { key: string; value: number }[] }) => (
  <ul className="space-y-2">
    {rows.map((r) => (
      <li key={r.key}>
        <div className="flex justify-between text-xs">
          <span className="font-medium">{r.key}</span>
          <span className="num font-bold">{r.value}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(2, r.value)}%`, background: healthColor(r.value) }}
          />
        </div>
      </li>
    ))}
  </ul>
);

const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-slate-100 text-slate-400 line-through dark:bg-slate-800"}`}
  >
    {ok ? "✓" : "✗"} {label}
  </span>
);

const PAL = ["#6c47ff", "#16a34a", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6", "#f97316"];
type KV = { key: string; value: number };
const cut = (t: string, n = 16) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const Block = ({
  title,
  sub,
  children,
  className = "",
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`min-w-0 rounded-xl border border-slate-100 p-4 dark:border-slate-800 ${className}`}>
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      {sub && <div className="text-[10.5px] text-slate-400">{sub}</div>}
    </div>
    {children}
  </div>
);

/** horizontal bars (brands, collections) */
function BarList({ rows, color }: { rows: KV[]; color: string }) {
  const data = rows.slice(0, 7).map((r) => ({ n: r.key || "(not set)", v: r.value }));
  return (
    <div style={{ height: Math.max(120, data.length * 30) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="n"
            width={104}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickFormatter={(v: string) => cut(v, 17)}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: "#6c47ff11" }} />
          <Bar dataKey="v" name="Products" radius={[0, 4, 4, 0]} barSize={12} fill={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** vertical columns (price ranges) */
function Columns({ rows, color }: { rows: KV[]; color: string }) {
  const data = rows.map((r) => ({ n: r.key, v: r.value }));
  return (
    <div className="h-48">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -22, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.25} />
          <XAxis dataKey="n" tickLine={false} axisLine={false} fontSize={10} interval={0} />
          <YAxis tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
          <Tooltip content={<ChartTip />} cursor={{ fill: "#6c47ff11" }} />
          <Bar dataKey="v" name="Products" radius={[4, 4, 0, 0]} maxBarSize={30} fill={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** donut + legend (product types) */
function Donut({ rows }: { rows: KV[] }) {
  const data = rows.slice(0, 6).map((r) => ({ name: r.key || "(not set)", value: r.value }));
  const total = data.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <div className="flex items-center gap-3">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={PAL[i % PAL.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((r, i) => (
          <li key={r.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: PAL[i % PAL.length] }} />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="shrink-0 text-slate-500">
              <b className="num font-medium text-current">{r.value}</b> · {Math.round((r.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Public facts from a Shopify store (its public product list). Works for any Shopify website, no login needed. */
function ShopifyInfo({ s }: { s: any }) {
  if (!s || s.detected === false) return null;
  if (s.blocked)
    return (
      <div className="rounded-xl border border-slate-100 p-4 text-xs text-slate-500 dark:border-slate-800">
        <div className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Shopify store found, but its product list is private
        </div>
        This store does not allow public access to its products
        {s.diag?.length
          ? ` (${s.diag.map((d: any) => `${d.path} → ${d.status}`).join(", ")})`
          : ""}
        . Connect Google if you own it to see real visits.
      </div>
    );
  const cur = s.currency;
  const checks = s.pageAudit
    ? ([
        { key: "Meta description", value: s.pageAudit.metaDesc },
        { key: "Product schema", value: s.pageAudit.schema },
        { key: "Good title length", value: s.pageAudit.titleOk },
        { key: "Images with alt text", value: s.pageAudit.altOk },
        { key: "One main heading", value: s.pageAudit.oneH1 },
        { key: "Star rating shown", value: s.pageAudit.rated },
      ].filter((r: any) => r.value != null) as KV[])
    : [];
  const hasInfo = !!s.trust || !!s.stack?.length || !!s.content;
  return (
    <div className="space-y-4 rounded-xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Public store data{" "}
          <span className="font-normal text-slate-400">
            · Shopify{s.theme ? ` · theme ${s.theme}` : ""}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Taken from the store's public pages, not from its Google Analytics
        </span>
      </div>
      {s.sampled && (
        <details className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <summary className="cursor-pointer">
            This store hides its full product list, so price, stock and brand
            numbers come from {s.sampledCount} of its {compact(s.products)}{" "}
            products (found through its sitemap).
          </summary>
          <div className="mt-1 text-amber-700/80 dark:text-amber-300/80">
            {(s.diag ?? [])
              .map((d: any) => `${d.path} → ${d.status}${d.n > 1 ? ` ×${d.n}` : ""}`)
              .join("  ·  ")}
          </div>
        </details>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Products"
          value={`${compact(s.products)}${s.capped ? "+" : ""}`}
          sub={s.collections != null ? `${s.collections} collections` : undefined}
        />
        <Tile
          label="Typical price"
          value={money(s.priceMedian, cur)}
          sub={s.priceMin != null ? `${money(s.priceMin)} – ${money(s.priceMax)}` : undefined}
        />
        <Tile
          label="In stock"
          value={s.inStock != null ? `${s.inStock}%` : "–"}
          sub={s.soldOut != null ? `${s.soldOut} sold out` : "of products"}
        />
        <Tile
          label="Updated lately"
          value={String(s.updated30d ?? 0)}
          sub={s.onSale != null ? `${s.onSale} on sale · in 30 days` : "products in 30 days"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {!!s.priceBuckets?.length && (
          <Block title={`Price ranges${cur ? ` (${cur})` : ""}`}>
            <Columns rows={s.priceBuckets} color="#f59e0b" />
          </Block>
        )}
        {!!s.types?.length && (
          <Block title="Product types">
            <Donut rows={s.types} />
          </Block>
        )}
        {!!s.vendors?.length && (
          <Block title="Top brands">
            <BarList rows={s.vendors} color="#6c47ff" />
          </Block>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {checks.length > 0 && (
          <Block title="Product page checks" sub={`${s.pageAudit.checked} pages`}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {checks.map((r) => (
                <Ring key={r.key} value={r.value} label={r.key} display={`${r.value}%`} size={40} />
              ))}
            </div>
          </Block>
        )}
        {!!s.topCollections?.length && (
          <Block title="Biggest collections">
            <BarList rows={s.topCollections} color="#0ea5e9" />
          </Block>
        )}
        {!!s.tags?.length && (
          <Block title="Popular tags">
            <div className="flex flex-wrap gap-1.5">
              {(s.tags as KV[]).slice(0, 14).map((t, i) => (
                <span
                  key={t.key}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: `${PAL[i % PAL.length]}1f`, color: PAL[i % PAL.length] }}
                >
                  {t.key} <b className="num">{t.value}</b>
                </span>
              ))}
            </div>
          </Block>
        )}
        {hasInfo && (
          <Block title="Trust, tools and content">
            <div className="space-y-3">
              {s.trust && (
                <div className="flex flex-wrap gap-1.5">
                  <Check ok={s.trust.contact} label="Contact" />
                  <Check ok={s.trust.about} label="About" />
                  <Check ok={s.trust.shipping} label="Shipping" />
                  <Check ok={s.trust.returns} label="Returns" />
                  <Check ok={s.trust.faq} label="FAQ" />
                  <Check ok={s.trust.privacy} label="Privacy" />
                  <Check ok={s.trust.terms} label="Terms" />
                </div>
              )}
              {!!s.stack?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {s.stack.map((x: string) => (
                    <span
                      key={x}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              )}
              {s.content && (
                <div className="text-xs text-slate-500">
                  <span className="font-semibold">Blog:</span>{" "}
                  {s.content.articles
                    ? `${s.content.articles} posts${s.content.lastPost ? `, last one ${String(s.content.lastPost).slice(0, 10)}` : ""}`
                    : "no posts found"}
                  {s.pageAudit?.avgRating != null && (
                    <>
                      {" · "}
                      <span className="font-semibold">Average rating:</span> {s.pageAudit.avgRating} / 5
                    </>
                  )}
                </div>
              )}
            </div>
          </Block>
        )}
        {!!s.newest?.length && (
          <Block title="Newest products">
            <ul className="space-y-1.5 text-xs">
              {s.newest.map((p: any) => (
                <li key={p.handle} className="flex justify-between gap-2">
                  <span className="truncate">{p.title}</span>
                  <span className="shrink-0 text-slate-400">{p.date}</span>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {!!s.bestSellers?.length && (
          <Block title="Best sellers" sub="the store's own ranking">
            <ol className="space-y-1.5 text-xs">
              {s.bestSellers.map((p: any, i: number) => (
                <li key={p.handle} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-slate-400">{i + 1}</span>
                  {p.image && (
                    <img src={p.image} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded object-cover" />
                  )}
                  <span className="truncate">{p.title}</span>
                  <span className="ml-auto shrink-0 text-slate-400">
                    {p.available === false ? "sold out" : money(p.price, cur)}
                  </span>
                </li>
              ))}
            </ol>
          </Block>
        )}
      </div>
    </div>
  );
}

/** Real Google Analytics + Search Console numbers for ANY website you analyze, found automatically
 *  through the one Google account you connected. Nothing needs to be linked per website. */
/** Google Analytics is connected but has not recorded a single visit yet (new property, tracking code not installed). */
function GaWaiting({
  ga,
  tracking,
  busy,
  onReload,
}: {
  ga: any;
  tracking: any;
  busy: boolean;
  onReload: () => void;
}) {
  const codeFound = (tracking?.ga4 ?? []).length > 0;
  return (
    <section className="card fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium tracking-tight">
            Google Analytics is connected
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Waiting for the first visits
            </span>
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {ga?.name ?? "Analytics property"} · no visits recorded in the last
            28 days
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={busy}
          className="btn-ghost !px-2.5 !py-1 text-[11px]"
        >
          {busy ? <Spinner /> : <RefreshCw className="h-3 w-3" />}
          Check again
        </button>
      </div>
      <ol className="mt-4 space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${codeFound ? "bg-green-600" : "bg-slate-400"}`}
          >
            {codeFound ? "✓" : "1"}
          </span>
          <span>
            {codeFound
              ? `Tracking code found on the website (${(tracking.ga4 ?? []).join(", ")}).`
              : "Paste the Analytics tracking code just before </head> on every page of the website."}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-400 text-[11px] font-bold text-white">
            2
          </span>
          <span>
            Open the website once, then check Analytics → Reports → Realtime.
            Your own visit should show up within a minute.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-400 text-[11px] font-bold text-white">
            3
          </span>
          <span>
            Full reports can take a few hours (sometimes up to 24 to 48 hours).
            This card turns into your results as soon as data arrives.
          </span>
        </li>
      </ol>
    </section>
  );
}

/** Plain-language result of the last 28 days, built only from numbers Google returned. */
function Result({ ga, gs }: { ga: any; gs: any }) {
  if (!ga && !gs) return null;
  type Line = { tone: "good" | "bad" | "neutral"; text: string };
  const lines: Line[] = [];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const share = (rows: any[], i = 0) => {
    const total = (rows ?? []).reduce((a, r) => a + (r.value ?? 0), 0);
    return rows?.[i] && total ? rows[i].value / total : 0;
  };
  let verdict: { label: string; color: string } | null = null;

  if (ga) {
    const t = ga.totals;
    const d = change(t.sessions, ga.prev?.sessions);
    if (d != null && isFinite(d))
      verdict =
        d >= 0.05
          ? { label: "Growing", color: "#16a34a" }
          : d <= -0.05
            ? { label: "Declining", color: "#dc2626" }
            : { label: "Steady", color: "#eab308" };
    lines.push({
      tone: d == null ? "neutral" : d >= 0.05 ? "good" : d <= -0.05 ? "bad" : "neutral",
      text: `${compact(t.sessions)} visits from ${compact(t.users)} people (${compact(t.newUsers)} new)${
        d != null && isFinite(d)
          ? `, ${d >= 0 ? "up" : "down"} ${Math.abs(Math.round(d * 100))}% on the 28 days before`
          : ""
      }.`,
    });
    lines.push({
      tone: t.engagementRate >= 0.6 ? "good" : t.engagementRate < 0.4 ? "bad" : "neutral",
      text: `${pct(t.engagementRate)} of visits were engaged (bounce rate ${pct(t.bounceRate)}), about ${secs(t.avgDuration)} per visit.`,
    });
    if (ga.channels?.[0])
      lines.push({
        tone: "neutral",
        text: `Most visits come from ${ga.channels[0].key} (${pct(share(ga.channels))}).`,
      });
    if (ga.countries?.[0])
      lines.push({
        tone: "neutral",
        text: `Top country is ${ga.countries[0].key} (${pct(share(ga.countries))} of visits).`,
      });
    if (ga.pages?.[0])
      lines.push({
        tone: "neutral",
        text: `Most viewed page: ${shortPath(ga.pages[0].key)} with ${compact(ga.pages[0].views)} views.`,
      });
    if (ga.devices?.[0])
      lines.push({
        tone: "neutral",
        text: `${pct(share(ga.devices))} of visits are on ${String(ga.devices[0].key).toLowerCase()}.`,
      });
  }
  if (gs) {
    const t = gs.totals;
    const d = change(t.clicks, gs.prev?.clicks);
    lines.push({
      tone: d == null ? "neutral" : d >= 0.05 ? "good" : d <= -0.05 ? "bad" : "neutral",
      text: `Google Search: ${compact(t.clicks)} clicks from ${compact(t.impressions)} impressions, average position ${t.position.toFixed(1)}${
        d != null && isFinite(d)
          ? ` (clicks ${d >= 0 ? "up" : "down"} ${Math.abs(Math.round(d * 100))}%)`
          : ""
      }.`,
    });
    if (gs.queries?.[0])
      lines.push({
        tone: "neutral",
        text: `Top search query: "${gs.queries[0].key}" (${compact(gs.queries[0].clicks)} clicks).`,
      });
  }
  const dot = { good: "#16a34a", bad: "#dc2626", neutral: "#94a3b8" };
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium">Result for the last 28 days</h3>
        {verdict && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `${verdict.color}22`, color: verdict.color }}
          >
            {verdict.label}
          </span>
        )}
      </div>
      <ul className="space-y-1.5 text-[13px]">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: dot[l.tone] }}
            />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MyGoogleData({
  url: _url,
  host,
  data,
  busy,
  error: loadError,
  onReload,
  open: openProp,
  onOpenChange,
  refreshing = false,
}: {
  refreshing?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  url: string;
  host: string;
  /** the "mygoogle" report, loaded by the Dashboard together with the website check */
  data: any;
  busy: boolean;
  error?: string | null;
  onReload: () => void;
}) {
  const [openInner, setOpenInner] = useState(false);
  const open = openProp ?? openInner;
  const setOpen = (v: boolean) => {
    setOpenInner(v);
    onOpenChange?.(v);
  };
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pages" | "queries">("pages");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("mygoogle_error"))
      setError(`Google connection failed: ${q.get("mygoogle_error")}`);
    if (q.get("mygoogle") || q.get("mygoogle_error"))
      window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const connect = async () => {
    try {
      const r = await fn("mygoogle", { action: "start" });
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ga = data?.ga4,
    gs = data?.gsc,
    shop = data?.shopify;
  // real Google numbers exist only when this Google account really has data for the website
  const hasReal = (!!ga && (!ga.managed || ga.totals.sessions > 0)) || !!gs;
  const hasShop = !!shop?.detected;
  // Google Analytics is matched but has recorded no visits yet (a brand new property)
  const waitingGa = !!ga && !!ga.managed && ga.totals.sessions === 0;

  // still loading together with the check: a thin placeholder, never an empty panel
  if (!data && busy)
    return (
      <section className="card flex items-center gap-3 text-sm text-slate-500">
        <Spinner /> Checking the store and Google data…
      </section>
    );
  // nothing real to show: show nothing at all (no empty panel, no zeros)
  const shownError = error ?? loadError ?? null;
  if (!hasReal && !hasShop)
    return waitingGa ? (
      <GaWaiting
        ga={ga}
        tracking={data?.tracking}
        busy={busy}
        onReload={onReload}
      />
    ) : shownError ? (
      <ErrorNote message={shownError} />
    ) : null;

  const daily = (() => {
    const map = new Map<
      string,
      { date: string; sessions?: number; clicks?: number }
    >();
    (ga?.daily ?? []).forEach((x: any) =>
      map.set(x.date, {
        ...(map.get(x.date) ?? { date: x.date }),
        sessions: x.sessions,
      }),
    );
    (gs?.daily ?? []).forEach((x: any) =>
      map.set(x.date, {
        ...(map.get(x.date) ?? { date: x.date }),
        clicks: x.clicks,
      }),
    );
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  })();
  const showGa = !!ga && (!ga.managed || ga.totals.sessions > 0);

  const sc = data?.score;
  const stats: [string, string][] = [];
  if (showGa) stats.push(["Visits", compact(ga.totals.sessions)]);
  if (gs) stats.push(["Search clicks", compact(gs.totals.clicks)]);
  if (hasShop && !shop.blocked) {
    stats.push(["Products", compact(shop.products)]);
    if (shop.priceMedian)
      stats.push(["Typical price", money(shop.priceMedian, shop.currency)]);
    if (shop.inStock != null) stats.push(["In stock", `${shop.inStock}%`]);
  }

  return (
    <section className="card fade-up">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium tracking-tight">
            {hasReal ? "Your real Google data" : "Store data"}
            {sc && (
              <span
                className="ml-2 text-xs font-semibold"
                style={{ color: healthColor(sc.score) }}
              >
                {sc.label}
              </span>
            )}
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {host}
            {sc?.tips?.length ? ` · ${sc.tips.length} improvements` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReload}
            disabled={refreshing || busy}
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
          >
            {refreshing ? (
              <Spinner />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Find again
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
          >
            {open ? "Hide results" : "View results"}
            <ChevronDown
              className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {sc && (
          <div className="w-[170px] shrink-0">
            <Ring
              value={sc.score}
              label="Website score"
              display={String(sc.score)}
              size={56}
            />
          </div>
        )}
        {stats.slice(0, 3).map(([l, v]) => (
          <div key={l} className="min-w-[80px] flex-1">
            <div className="text-[11px] font-semibold text-slate-500">{l}</div>
            <div className="num text-xl font-medium">{v}</div>
          </div>
        ))}
      </div>

      {open && (
    <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
      {hasReal && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Last 28 days · from your own Google Analytics and Search Console
          </p>
          <button className="btn-ghost !py-1 text-xs" onClick={onReload} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      )}
      <ErrorNote message={shownError} />
      <div className="space-y-5">
        {waitingGa && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Google Analytics is connected but has not recorded any visits yet.
            Install the tracking code on the website and check Realtime.
          </p>
        )}
        {hasReal && <Result ga={showGa ? ga : null} gs={gs} />}
        <ScoreBreakdown sc={sc} connected={!!data?.connected} onConnect={connect} />
        {hasReal && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {showGa && (
                <>
                  <Tile
                    label="Visits"
                    value={compact(ga.totals.sessions)}
                    delta={change(ga.totals.sessions, ga.prev.sessions)}
                    sub="vs previous 28 days"
                  />
                  <Tile
                    label="Visitors"
                    value={compact(ga.totals.users)}
                    delta={change(ga.totals.users, ga.prev.users)}
                    sub={`${compact(ga.totals.newUsers)} new`}
                  />
                  <Tile
                    label="Page views"
                    value={compact(ga.totals.pageviews)}
                    delta={change(ga.totals.pageviews, ga.prev.pageviews)}
                    sub={`${secs(ga.totals.avgDuration)} per visit`}
                  />
                  <Tile
                    label="Engaged"
                    value={`${Math.round(ga.totals.engagementRate * 100)}%`}
                    sub={`Bounce ${Math.round(ga.totals.bounceRate * 100)}%`}
                  />
                </>
              )}
              {gs && (
                <>
                  <Tile
                    label="Google clicks"
                    value={compact(gs.totals.clicks)}
                    delta={change(gs.totals.clicks, gs.prev?.clicks)}
                    sub="from Search Console"
                  />
                  <Tile
                    label="Impressions"
                    value={compact(gs.totals.impressions)}
                    delta={change(gs.totals.impressions, gs.prev?.impressions)}
                  />
                  <Tile
                    label="Click rate (CTR)"
                    value={`${(gs.totals.ctr * 100).toFixed(1)}%`}
                  />
                  <Tile
                    label="Avg. position"
                    value={
                      gs.totals.position ? gs.totals.position.toFixed(1) : "–"
                    }
                    delta={change(gs.totals.position, gs.prev?.position)}
                    invert
                  />
                </>
              )}
            </div>

            {daily.length > 1 && (
              <div className="h-52">
                <ResponsiveContainer>
                  <AreaChart
                    data={daily}
                    margin={{ left: -18, right: 6, top: 6 }}
                  >
                    <defs>
                      <linearGradient id="mgS" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#6c47ff"
                          stopOpacity={0.45}
                        />
                        <stop
                          offset="100%"
                          stopColor="#6c47ff"
                          stopOpacity={0}
                        />
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
                    {showGa && (
                      <Area
                        dataKey="sessions"
                        name="Visits"
                        stroke="#5b38ee"
                        strokeWidth={2}
                        fill="url(#mgS)"
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
              </div>
            )}

            {showGa && (
              <div className="grid gap-5 lg:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">
                    Where visits come from
                  </div>
                  <HBars rows={ga.channels} color="#6c47ff" />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">
                    Visits by country
                  </div>
                  <HBars rows={ga.countries} color="#16a34a" />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">
                    Devices
                  </div>
                  <HBars rows={ga.devices} color="#d97706" />
                </div>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              {showGa && (
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">
                    Most viewed pages
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="th !pl-0">Page</th>
                        <th className="th">Views</th>
                        <th className="th">Visitors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ga.pages.map((p: any) => (
                        <tr
                          key={p.key}
                          className="border-t border-slate-100 dark:border-slate-800"
                          title={p.key}
                        >
                          <td className="td !pl-0 max-w-[260px] truncate">
                            {shortPath(p.key)}
                          </td>
                          <td className="td font-semibold">
                            {compact(p.views)}
                          </td>
                          <td className="td">{compact(p.users)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {gs && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">
                      Google Search
                    </span>
                    <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
                      {(
                        [
                          ["pages", "Pages"],
                          ["queries", "Searches"],
                        ] as const
                      ).map(([k, l]) => (
                        <button
                          key={k}
                          onClick={() => setTab(k)}
                          className={`rounded-md px-2.5 py-1 ${tab === k ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="th !pl-0">
                          {tab === "pages" ? "Page" : "Search"}
                        </th>
                        <th className="th">Clicks</th>
                        <th className="th">Impr.</th>
                        <th className="th">Pos.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(tab === "pages" ? gs.pages : gs.queries).map(
                        (x: any) => (
                          <tr
                            key={x.key}
                            className="border-t border-slate-100 dark:border-slate-800"
                            title={x.key}
                          >
                            <td className="td !pl-0 max-w-[240px] truncate">
                              {tab === "pages" ? shortPath(x.key) : x.key}
                            </td>
                            <td className="td font-semibold">
                              {compact(x.clicks)}
                            </td>
                            <td className="td">{compact(x.impressions)}</td>
                            <td className="td">{x.position.toFixed(1)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        <ShopifyInfo s={shop} />
        <Tracking t={data?.tracking} />
        {!data?.connected && hasShop && (
          <p className="text-[11px] text-slate-400">
            Own this store?{" "}
            <button
              className="font-medium text-brand-600 underline"
              onClick={connect}
            >
              Connect Google
            </button>{" "}
            to also see its real visits and clicks.
          </p>
        )}
      </div>
    </div>
      )}
    </section>
  );
}