import { ReactNode, useMemo } from "react";
import { Info } from "lucide-react";
import { useOrgCompetitors } from "../lib/orgCompetitors";
import { positionBuckets } from "../lib/report";
import { compact, healthColor } from "./dash";
import { siteAuthority } from "./DomainOverview";
import type { Backlinks } from "./BacklinksPanel";

const authLabel = (a: number) =>
  a >= 60 ? "Strong" : a >= 40 ? "Good" : a >= 20 ? "Average" : "Weak";

/** Small "i" that explains where a number comes from (hover). */
const Hint = ({ text }: { text: string }) => (
  <span title={text} className="cursor-help text-slate-400">
    <Info className="h-4 w-4" />
  </span>
);

function Cell({
  label,
  hint,
  children,
  sub,
}: {
  label: ReactNode;
  hint: string;
  children: ReactNode;
  sub?: string;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="flex items-center gap-1.5 text-[15px] font-medium">
        <span className="truncate">{label}</span>
        <Hint text={hint} />
      </div>
      <div className="mt-1 flex items-center gap-2">{children}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <span className="num text-[34px] font-extrabold leading-none text-brand-700 dark:text-brand-200">
    {children}
  </span>
);

/** Donut for the traffic share. */
function Donut({ pct }: { pct: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 -rotate-90" aria-hidden>
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="7"
        className="stroke-slate-200 dark:stroke-slate-700"
      />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="7"
        stroke="#6c47ff"
        strokeDasharray={`${(Math.max(pct, 2) / 100) * c} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * "SEO" summary, the first card of the Dashboard. Every number comes from free data we already collect:
 *  - Authority score:   same formula as the Authority card (open link score + traffic + global rank)
 *  - Organic traffic:   estimate = search volume x click rate by position (the app's own traffic model)
 *  - Organic keywords:  keywords our keyword database knows this site ranks for (or the checked ones, if more)
 *  - Traffic share:     this site's share of the estimated organic traffic of the site + its closest competitors
 *  - Ref. domains / Backlinks: the saved backlink check (full index total when a backlink API is connected,
 *                       otherwise the links we could verify, which is a sample)
 *  - Paid keywords / traffic: the site's own Google ads seen on the tracked searches (Serper "ads" field, no extra
 *                       cost), traffic = volume x ad click rate. Only keywords we check, like the organic numbers
 */
export default function SeoSummary({
  d,
  url,
  country,
  keywords,
  backlinks,
}: {
  d: any;
  url: string;
  country: string;
  keywords: string[];
  backlinks: Backlinks | null;
}) {
  const { data: org } = useOrgCompetitors(url, country, keywords);
  const bk = positionBuckets(d);
  const authority = siteAuthority(d);
  const organic: number | null = d?.traffic?.seo?.organic?.mid ?? null;

  const share = useMemo(() => {
    const pts = org?.map ?? [];
    const me = pts.find((p) => p.site);
    const sum = pts.reduce((a, p) => a + (p.traffic || 0), 0);
    if (!me || sum <= 0) return null;
    return Math.round((me.traffic / sum) * 100);
  }, [org]);

  const orgKeywords = Math.max(
    org?.map?.find((p) => p.site)?.keywords ?? 0,
    bk.ranked,
  );

  // Paid: the research check records when the site's OWN ad shows on a tracked search (field `paid`, set by every
  // ranking of a new check). Paid traffic = search volume x ad click rate by ad position (an estimate).
  const paid = useMemo(() => {
    const r: any[] = (d?.rankings ?? []).filter((x: any) => !x?.error);
    if (!r.length || !r.some((x) => x.paid !== undefined)) return null; // saved before this feature: re-run the check
    const vol = new Map<string, number>(
      (d?.keywordTable ?? []).map((k: any) => [String(k.keyword), Number(k.volume) || 0]),
    );
    const adCtr = (pos: number) => [0.04, 0.025, 0.015, 0.01][pos - 1] ?? 0.007;
    let keywords = 0,
      traffic = 0;
    for (const x of r)
      if (x.paid) {
        keywords++;
        traffic += (vol.get(String(x.keyword)) ?? 0) * adCtr(x.paid.pos);
      }
    return { keywords, traffic: Math.round(traffic) };
  }, [d]);

  const s = backlinks?.summary;
  const refDomains = s ? (s.totalDomains ?? s.linkingDomains) : null;
  const links = s ? (s.totalBacklinks ?? s.verified) : null;
  const sample = s && !s.totalDomains && !s.totalBacklinks;
  const none = (
    <span className="text-[34px] font-extrabold leading-none text-slate-300 dark:text-slate-600">
      –
    </span>
  );

  return (
    <section className="card fade-up relative overflow-hidden !p-0">
      <div className="inline-block rounded-br-2xl bg-brand-100 px-5 py-2 text-[15px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
        SEO
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200 py-2 dark:divide-slate-700 lg:grid-cols-4 [&>*]:border-slate-200 dark:[&>*]:border-slate-700 [&>*:nth-child(n+5)]:border-t lg:[&>*:nth-child(n+5)]:border-t-0">
        <Cell
          label="Authority Score"
          hint="0-100. Built from link strength, search traffic and global rank (free data)."
        >
          {authority != null ? (
            <>
              <Big>{authority}</Big>
              <span
                className="rounded-full px-3 py-1 text-[13px] font-semibold"
                style={{
                  color: healthColor(authority),
                  background: `${healthColor(authority)}1f`,
                }}
              >
                {authLabel(authority)}
              </span>
            </>
          ) : (
            none
          )}
        </Cell>

        <Cell
          label="Organic Traffic"
          hint="Estimated monthly visits from Google: search volume x click rate by position."
          sub="estimate / month"
        >
          {organic != null && organic > 0 ? <Big>{compact(organic)}</Big> : none}
        </Cell>

        <Cell
          label="Paid Traffic"
          hint="Estimate: search volume x ad click rate, for the tracked keywords where this site's own Google ad appeared in this check."
          sub={paid ? "estimate / month · tracked keywords" : "re-run the check to measure"}
        >
          {paid ? <Big>{compact(paid.traffic)}</Big> : none}
        </Cell>

        <Cell
          label="Ref.Domains"
          hint={
            sample
              ? "Different websites we could verify linking to this site. A sample, not the full web."
              : "Websites linking to this site."
          }
          sub={sample ? "verified sample" : undefined}
        >
          {refDomains != null ? <Big>{compact(refDomains)}</Big> : none}
        </Cell>

        <Cell
          label="Traffic Share"
          hint="This site's share of the estimated organic traffic of itself plus its closest competitors."
          sub="vs closest competitors"
        >
          {share != null ? (
            <>
              <Donut pct={share} />
              <Big>{share}%</Big>
            </>
          ) : (
            none
          )}
        </Cell>

        <Cell
          label="Organic Keywords"
          hint="Keywords this site ranks for on Google, from our keyword database and this check."
        >
          {orgKeywords > 0 ? <Big>{compact(orgKeywords)}</Big> : none}
        </Cell>

        <Cell
          label="Paid Keywords"
          hint="Tracked keywords where this site's own Google ad appeared in the results of this check."
          sub={paid ? "tracked keywords" : "re-run the check to measure"}
        >
          {paid ? <Big>{compact(paid.keywords)}</Big> : none}
        </Cell>

        <Cell
          label="Backlinks"
          hint={
            sample
              ? "Links we could verify to this site. A sample, not the full web."
              : "Links pointing to this site."
          }
          sub={sample ? "verified sample" : undefined}
        >
          {links != null ? <Big>{compact(links)}</Big> : none}
        </Cell>
      </div>
    </section>
  );
}