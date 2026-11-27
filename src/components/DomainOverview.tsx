import { ReactNode } from "react";
import { CalendarClock, Globe2, ShieldCheck, Star } from "lucide-react";
import { Badge } from "./ui";
import { compact, Dot, healthColor, Panel, Ring } from "./dash";
import { positionBuckets } from "../lib/report";
import type { Backlinks } from "./BacklinksPanel";

const fmtDate = (s?: string | null) =>
  s
    ? new Date(s).toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "–";
const ageText = (since?: string | null) => {
  if (!since) return "–";
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(since).getTime()) / 864e5),
  );
  const y = Math.floor(days / 365),
    m = Math.floor((days % 365) / 30);
  return y
    ? `${y} yr${y > 1 ? "s" : ""}${m ? ` ${m} mo` : ""}`
    : m
      ? `${m} mo`
      : `${days} days`;
};
const daysLeft = (to?: string | null) =>
  to ? Math.floor((new Date(to).getTime() - Date.now()) / 864e5) : null;

const clamp = (n: number, a = 0, b = 100) => Math.max(a, Math.min(b, n));

/**
 * Authority 0-100, built like the well-known "authority score": link strength first, then how much search traffic the site earns.
 *  - link strength: the 0-10 link score on a curve (1/10 is about 14, 5/10 about 52, 8/10 about 82), because a plain x10 made small sites look far too weak
 *  - traffic: organic visits on a log scale (100 visits about 20, 5K about 37, 100K about 50, 1M about 60)
 *  - a site with no link score still gets a value from traffic and global rank, so the ring is never empty when we know something
 */
function authorityScore(
  oprScore: number | null | undefined,
  organic: number | null | undefined,
  trancoRank: number | null | undefined,
): number | null {
  const link =
    oprScore != null ? 100 * Math.pow(clamp(oprScore, 0, 10) / 10, 0.85) : null;
  const traffic =
    organic != null && organic > 0
      ? clamp((Math.log10(organic + 1) / 10) * 100)
      : null;
  const rank =
    trancoRank && trancoRank <= 1e6
      ? clamp(((6 - Math.log10(trancoRank)) / 6) * 100 + 10)
      : null;
  const parts: [number | null, number][] = [
    [link, 0.75],
    [traffic, 0.25],
    [rank, 0.15],
  ];
  const used = parts.filter(([v]) => v != null) as [number, number][];
  if (!used.length) return null;
  const w = used.reduce((a, [, x]) => a + x, 0);
  return Math.round(clamp(used.reduce((a, [v, x]) => a + v * x, 0) / w));
}

const ratingLabel = (stars: number) =>
  stars >= 4.5
    ? "Excellent"
    : stars >= 3.5
      ? "Good"
      : stars >= 2.5
        ? "Average"
        : stars >= 1.5
          ? "Needs work"
          : "Poor";

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-t border-slate-100 py-1.5 text-xs first:border-0 dark:border-slate-800">
    <span className="shrink-0 text-slate-500">{k}</span>
    <span className="min-w-0 break-words text-right font-semibold">{v}</span>
  </div>
);

/** Small donut with a percentage inside. */
function MiniRing({
  value,
  color,
  label,
}: {
  value: number;
  color: string;
  label: string;
}) {
  const r = 16;
  const len = 2 * Math.PI * r;
  return (
    <div className="text-center">
      <div className="relative h-12 w-12">
        <svg viewBox="0 0 40 40" className="h-12 w-12 -rotate-90" aria-hidden>
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            strokeWidth="5"
            className="stroke-slate-200 dark:stroke-slate-700"
          />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            strokeWidth="5"
            stroke={color}
            strokeLinecap="round"
            strokeDasharray={`${(Math.max(value, value ? 3 : 0) / 100) * len} ${len}`}
          />
        </svg>
        <span className="num absolute inset-0 grid place-items-center text-[11px] font-extrabold">
          {value}%
        </span>
      </div>
      <div className="mt-0.5 text-[10px] font-medium text-slate-500">
        {label}
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          <Dot color={color} />
          {label}
        </span>
        <b>{value}</b>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(value ? 3 : 0, (value / Math.max(max, 1)) * 100)}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

/** 5 stars with partial fill (e.g. 2.8 fills two stars fully and the third 80%). */
function Stars({ value, size = 20 }: { value: number; size?: number }) {
  return (
    <div
      className="flex gap-0.5"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = clamp(value - i, 0, 1) * 100;
        return (
          <div
            key={i}
            className="relative"
            style={{ width: size, height: size }}
          >
            <Star
              width={size}
              height={size}
              strokeWidth={0}
              fill="currentColor"
              className="absolute inset-0 text-slate-300 dark:text-slate-700"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill}%` }}
            >
              <Star
                width={size}
                height={size}
                strokeWidth={0}
                fill="currentColor"
                className="max-w-none"
                style={{ color: "#f59e0b" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Authority 0-100 of a saved check (shared with the SEO summary card, so both always show the same number). */
export function siteAuthority(d: any): number | null {
  const s = d?.site;
  if (!s) return null;
  return (
    (s.authority as { score: number } | null)?.score ??
    authorityScore(s.opr?.score, d?.traffic?.seo?.organic?.mid, s.tranco)
  );
}

/** Semrush-style "domain overview" row: who the site is, how strong it is, how it ranks, what we cannot know for free. */
export default function DomainOverview({
  d,
  store,
  backlinks,
  aiSlot,
}: {
  /** AI Search card, shown as its own card next to the Organic search card */
  aiSlot?: ReactNode;
  d: any;
  /** saved backlink check: fills the link rows when the Open PageRank score is not available */
  backlinks?: Backlinks | null;
  /** the store's own website score (Store data card), counted in the overall site rating */
  store?: { score?: number } | null;
}) {
  const s = d.site,
    dom = s.domain,
    m = d.meta,
    est = d.traffic?.seo;
  const bk = positionBuckets(d);
  const bl = backlinks?.summary ?? null;
  const segs = [
    { label: "Top 3", n: bk.top3, color: "#16a34a" },
    { label: "4-10", n: Math.max(0, bk.top10 - bk.top3), color: "#3b82f6" },
    { label: "11-30", n: Math.max(0, bk.top30 - bk.top10), color: "#6c47ff" },
    { label: "31+", n: Math.max(0, bk.ranked - bk.top30), color: "#94a3b8" },
    {
      label: "Not ranking",
      n: Math.max(0, bk.checked - bk.ranked),
      color: "#d97706",
    },
  ].filter((x) => x.n > 0);
  const left = daysLeft(dom?.expires);
  // the server builds the full score from every signal; old saved checks fall back to the local formula
  const auth = s.authority as {
    score: number;
    parts: { key: string; label: string; value: number }[];
    confidence: string;
  } | null;
  const authority: number | null =
    auth?.score ?? authorityScore(s.opr?.score, est?.organic?.mid, s.tranco);
  const when = dom?.registered ?? s.age?.since ?? null;

  // ---- Overall site rating (0-100 -> 0-5 stars) ----
  const parts: { label: string; value: number | null; weight: number }[] = [
    { label: "Site health", value: m.health ?? null, weight: 30 },
    { label: "Authority", value: authority, weight: 20 },
    {
      label: "Search visibility",
      value:
        bk.checked > 0
          ? clamp(
              ((bk.top10 + (bk.ranked - bk.top10) * 0.4) / bk.checked) * 100,
            )
          : null,
      weight: 20,
    },
    {
      label: "Speed",
      value:
        s.responseMs > 0
          ? clamp(100 - ((s.responseMs - 300) / 1700) * 100)
          : null,
      weight: 10,
    },
    { label: "Store", value: store?.score ?? null, weight: 20 },
  ];
  const used = parts.filter((p) => p.value != null);
  const wsum = used.reduce((a, p) => a + p.weight, 0);
  const score100 = wsum
    ? used.reduce((a, p) => a + (p.value as number) * p.weight, 0) / wsum
    : null;
  const stars = score100 == null ? null : score100 / 20;

  return (
    <div className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
      <Panel
        title="Domain"
        sub={s.root ?? m.host}
        right={
          <Badge tone={s.status >= 200 && s.status < 400 ? "green" : "red"}>
            {s.status}
          </Badge>
        }
      >
        {s.shared ? (
          <p className="text-sm text-slate-500">
            This is a shared hosting address ({m.host}), so registration details
            belong to the platform, not to this site.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-50 p-3 dark:bg-brand-900/30">
              <CalendarClock className="h-8 w-8 shrink-0 text-brand-600" />
              <div>
                <div className="text-[11px] font-semibold text-slate-500">
                  Registered
                </div>
                <div className="text-lg font-extrabold leading-tight">
                  {fmtDate(when)}
                </div>
                <div className="text-xs text-slate-500">
                  {ageText(when)} old
                  {!dom?.registered && s.age ? " (first seen online)" : ""}
                </div>
              </div>
            </div>
            <Row
              k="Expires"
              v={
                dom?.expires ? (
                  <>
                    {fmtDate(dom.expires)}{" "}
                    {left != null && (
                      <span
                        className={
                          left < 60 ? "text-red-600" : "text-slate-400"
                        }
                      >
                        ({left} days)
                      </span>
                    )}
                  </>
                ) : (
                  "–"
                )
              }
            />
            <Row k="Last changed" v={fmtDate(dom?.updated)} />
            <Row k="Registrar" v={dom?.registrar ?? "–"} />
            <Row
              k="Nameservers"
              v={dom?.nameservers?.length ? dom.nameservers.join(", ") : "–"}
            />
            <Row k="Server IP" v={dom?.ip ?? "–"} />
            <Row k="Response time" v={`${s.responseMs} ms`} />
          </>
        )}
        {s.tech?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {s.tech.map((t: string) => (
              <span
                key={t}
                className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium dark:bg-slate-800"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Authority"
        sub="Authority and rank"
        right={<ShieldCheck className="h-4 w-4 text-slate-400" />}
      >
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-3">
          <Ring
            value={authority}
            label="Authority (0-100)"
            sub={
              auth?.parts?.length
                ? auth.parts.map((p) => `${p.label} ${p.value}`).join(" · ")
                : "Based on links across the web."
            }
          />
          <Ring value={m.health} label="Site health" />
        </div>
        <Row
          k="Global rank"
          v={
            s.tranco
              ? s.tranco <= 1e6
                ? `#${s.tranco.toLocaleString()} of 1M`
                : `#${s.tranco.toLocaleString()}`
              : "Not in top 1M"
          }
        />
        <Row
          k="Link strength"
          v={
            s.opr ? (
              <>
                {s.opr.score.toFixed(1)} / 10
                {s.opr.rank ? ` · #${compact(s.opr.rank)}` : ""}
              </>
            ) : bl?.avgAuthority != null ? (
              <span title="Average authority of the sites we verified linking to this site (free backlink check). Open PageRank is not connected.">
                {bl.avgAuthority} / 100 · from links
              </span>
            ) : (
              <span title="Run the backlink check, or fix OPENPAGERANK_API_KEY (the free key only works from one IP address).">
                –
              </span>
            )
          }
        />
        {bl && (
          <Row
            k="Linking domains"
            v={`${(bl.totalDomains ?? bl.linkingDomains).toLocaleString()}${bl.totalDomains ? "" : " (verified)"}`}
          />
        )}
        <Row
          k="Pages crawled"
          v={`${m.pagesCrawled}${m.urlsDiscovered > m.pagesCrawled ? ` of ${m.urlsDiscovered} found` : ""}`}
        />

        {/* Overall site rating */}
        <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="text-[11px] font-semibold text-slate-500">
            Overall site rating
          </div>
          {stars == null ? (
            <div className="mt-1 text-sm text-slate-500">
              Not enough data yet.
            </div>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars value={stars} />
                <span className="num text-2xl font-extrabold leading-none">
                  {stars.toFixed(1)}
                  <span className="text-sm font-semibold text-slate-400">
                    {" "}
                    / 5
                  </span>
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                  style={{
                    color: healthColor(score100),
                    background: `${healthColor(score100)}1f`,
                  }}
                >
                  {ratingLabel(stars)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {parts.map((p) => (
                  <div key={p.label}>
                    <div className="mb-0.5 flex justify-between text-[11px]">
                      <span className="text-slate-500">{p.label}</span>
                      <b>{p.value == null ? "–" : Math.round(p.value)}</b>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${p.value ?? 0}%`,
                          background: healthColor(p.value),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* one column: Organic search on top, AI Search below it, each its own box */}
      <div className="flex flex-col gap-5">
        <Panel
          title="Organic search"
          sub={`Google ${m.country.toUpperCase()} · approx. monthly`}
          right={<Globe2 className="h-4 w-4 text-slate-400" />}
        >
          {/* headline: how many of the checked keywords rank, and how strong */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-500">
                Keywords ranking
              </div>
              <div className="num mt-0.5 text-[26px] font-extrabold leading-none text-brand-700 dark:text-brand-200">
                {bk.ranked}
                <span className="text-sm font-semibold text-slate-400">
                  {" "}
                  / {bk.checked}
                </span>
              </div>
            </div>
            {bk.checked > 0 && (
              <div className="flex shrink-0 gap-4">
                <MiniRing
                  value={Math.round((bk.top10 / bk.checked) * 100)}
                  color="#2dd4bf"
                  label="Top 10"
                />
                <MiniRing
                  value={Math.round((bk.top3 / bk.checked) * 100)}
                  color="#6c47ff"
                  label="Top 3"
                />
              </div>
            )}
          </div>

          {/* one bar: where the checked keywords sit */}
          {bk.checked > 0 && (
            <>
              <div
                className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="img"
                aria-label="Keyword positions"
              >
                {segs.map((x) => (
                  <i
                    key={x.label}
                    className="block h-full"
                    style={{
                      width: `${(x.n / bk.checked) * 100}%`,
                      background: x.color,
                    }}
                    title={`${x.label}: ${x.n}`}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  { l: "Top 3", n: bk.top3, c: "#16a34a" },
                  { l: "Top 10", n: bk.top10, c: "#3b82f6" },
                  { l: "Top 30", n: bk.top30, c: "#6c47ff" },
                  {
                    l: "Not ranking",
                    n: Math.max(0, bk.checked - bk.ranked),
                    c: "#d97706",
                  },
                ].map((x) => (
                  <div
                    key={x.l}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/60"
                  >
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      <Dot color={x.c} />
                      {x.l}
                    </span>
                    <b className="num text-xs">{x.n}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        {/* AI Search: its own separate box under Organic search */}
        {aiSlot}
      </div>
    </div>
  );
}