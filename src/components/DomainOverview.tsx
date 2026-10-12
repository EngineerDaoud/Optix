import { ReactNode } from "react";
import { CalendarClock, Globe2, ShieldCheck, Star } from "lucide-react";
import { Badge } from "./ui";
import { compact, Dot, healthColor, Panel, Ring } from "./dash";
import { positionBuckets } from "../lib/report";

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

/** Semrush-style "domain overview" row: who the site is, how strong it is, how it ranks, what we cannot know for free. */
export default function DomainOverview({
  d,
  store,
}: {
  d: any;
  /** the store's own website score (Store data card), counted in the overall site rating */
  store?: { score?: number } | null;
}) {
  const s = d.site,
    dom = s.domain,
    m = d.meta,
    est = d.traffic?.seo;
  const bk = positionBuckets(d);
  const left = daysLeft(dom?.expires);
  const authority = s.opr?.score != null ? Math.round(s.opr.score * 10) : null;
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
            sub="Based on links across the web."
          />
          <Ring value={m.health} label="Site health" />
        </div>
        <Row
          k="Global rank"
          v={s.tranco ? `#${s.tranco.toLocaleString()} of 1M` : "Not in top 1M"}
        />
        <Row
          k="Authority score"
          v={
            s.opr ? (
              <>
                {s.opr.score.toFixed(1)} / 10
                {s.opr.rank ? ` · #${compact(s.opr.rank)}` : ""}
              </>
            ) : (
              "–"
            )
          }
        />
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
            <div className="mt-1 text-sm text-slate-500">Not enough data yet.</div>
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

      <Panel
        title="Organic search"
        sub={`Google ${m.country.toUpperCase()} · approx. monthly`}
        right={<Globe2 className="h-4 w-4 text-slate-400" />}
      >
        <div className="mb-3 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <div className="whitespace-nowrap text-[11px] font-semibold text-slate-500">
              Traffic / month
            </div>
            <div
              className="whitespace-nowrap text-lg font-extrabold"
              style={{ color: healthColor(est?.organic?.mid > 0 ? 80 : 40) }}
            >
              {est?.organic?.mid > 0 ? compact(est.organic.mid) : "Very low"}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <div className="whitespace-nowrap text-[11px] font-semibold text-slate-500">
              Keywords
            </div>
            <div className="text-xl font-extrabold">
              {bk.ranked}
              <span className="text-xs font-semibold text-slate-400">
                {" "}
                / {bk.checked}
              </span>
            </div>
          </div>
        </div>
        <Bar label="Top 3" value={bk.top3} max={bk.checked} color="#16a34a" />
        <Bar label="Top 10" value={bk.top10} max={bk.checked} color="#3b82f6" />
        <Bar label="Top 30" value={bk.top30} max={bk.checked} color="#6c47ff" />
        <Bar
          label="Not ranking"
          value={Math.max(0, bk.checked - bk.ranked)}
          max={bk.checked}
          color="#d97706"
        />
        {bk.checked > 0 && (
          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold text-slate-500">
              Keyword performance
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  v: Math.round((bk.top10 / bk.checked) * 100),
                  l: "In top 10",
                  c: "#2dd4bf",
                },
                {
                  v: Math.round((bk.top3 / bk.checked) * 100),
                  l: "In top 3",
                  c: "#6c47ff",
                },
              ].map((x) => (
                <div key={x.l} className="min-w-0">
                  <div className="text-2xl font-extrabold leading-none">{x.v}%</div>
                  <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${x.v}%`, background: x.c }}
                    />
                  </div>
                  <div className="text-[11px] font-medium text-slate-500">
                    Keywords {x.l.toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}