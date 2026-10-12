import Select from "../components/Select";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { fn, supabase } from "../lib/supabase";
import {
  Badge,
  ErrorNote,
  PageHeader,
  ScoreRing,
  Spinner,
  priorityTone,
} from "../components/ui";
import {
  Card,
  Gauge,
  Meter,
  Spark,
  Stat,
  Table,
  Tabs,
  scoreColor,
} from "../components/viz";
import KeywordsTab from "../components/KeywordsTab";

const COUNTRIES: [string, string][] = [
  ["gb", "United Kingdom"],
  ["us", "United States"],
  ["pk", "Pakistan"],
  ["in", "India"],
  ["ae", "UAE"],
  ["ca", "Canada"],
  ["au", "Australia"],
  ["de", "Germany"],
  ["fr", "France"],
  ["es", "Spain"],
  ["it", "Italy"],
  ["nl", "Netherlands"],
  ["sa", "Saudi Arabia"],
  ["tr", "Turkey"],
  ["br", "Brazil"],
  ["mx", "Mexico"],
  ["za", "South Africa"],
  ["ng", "Nigeria"],
];
// What the numbers should cover: one country, the whole world (top markets added up), or grouped by content topic.
type Scope = "country" | "world" | "topic";
const SCOPES: [Scope, string][] = [
  ["country", "This country only"],
  ["world", "Worldwide (top 6 markets)"],
  ["topic", "By content topic"],
];
const TLD: Record<string, string> = {
  uk: "gb",
  pk: "pk",
  in: "in",
  ae: "ae",
  ca: "ca",
  au: "au",
  de: "de",
  fr: "fr",
  es: "es",
  it: "it",
  nl: "nl",
  sa: "sa",
  tr: "tr",
  br: "br",
  mx: "mx",
  za: "za",
  ng: "ng",
};
const guess = (raw: string) => {
  try {
    const h = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname;
    return TLD[h.split(".").pop() ?? ""] ?? "us";
  } catch {
    return "us";
  }
};

type Tab =
  | "overview"
  | "issues"
  | "crawler"
  | "content"
  | "serp"
  | "keywords"
  | "speed"
  | "images"
  | "links"
  | "uptime"
  | "traffic"
  | "plan";

const sec = (ms: number | null | undefined) =>
  ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`;
const short = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || "/";
  } catch {
    return u;
  }
};
const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const statusTone = (s: number) =>
  s === 200 ? "green" : s >= 300 && s < 400 ? "amber" : "red";
const posTone = (p: number | null) =>
  p == null ? "slate" : p <= 3 ? "green" : p <= 10 ? "amber" : "slate";
const rate = (v: number | null | undefined, good: number, poor: number) =>
  v == null ? null : v <= good ? "Good" : v <= poor ? "Needs work" : "Poor";
const rateTone = (r: string | null) =>
  r === "Good"
    ? "green"
    : r === "Needs work"
      ? "amber"
      : r === "Poor"
        ? "red"
        : "slate";

const kdBadge = (kd: number | null | undefined) =>
  kd == null ? "slate" : kd < 30 ? "green" : kd < 60 ? "amber" : "red";
const nf = (n: number | null | undefined) =>
  n == null ? "–" : Math.round(n).toLocaleString();
const compact = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
      : String(n);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Bars({
  rows,
  color = "#5b38ee",
}: {
  rows: { key: string; value: number }[];
  color?: string;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length)
    return <p className="text-sm text-slate-500">No data for this period.</p>;
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} className="mb-2 last:mb-0">
          <div className="mb-1 flex justify-between text-xs">
            <span className="truncate pr-2">{r.key || "(not set)"}</span>
            <span className="font-semibold">
              {nf(r.value)}{" "}
              <span className="font-normal text-slate-500">
                · {Math.round((r.value / total) * 100)}%
              </span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="mr-2 inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default function Research() {
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("gb");
  const [scope, setScope] = useState<Scope>("country");
  const [touched, setTouched] = useState(false);
  const [depth, setDepth] = useState(10);
  const [maxKeywords, setMaxKeywords] = useState(40);
  const [maxPages, setMaxPages] = useState(300);
  const [progress, setProgress] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<"page" | "issue">("page");
  const [relFilter, setRelFilter] = useState<"all" | "nofollow" | "dofollow">(
    "all",
  );
  const [history, setHistory] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);

  const loadSaved = async () => {
    const { data: rows } = await supabase
      .from("research_runs")
      .select("id, host, country, depth, health, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setSaved(rows ?? []);
  };
  const loadHistory = async (host: string, c: string) => {
    const { data: rows } = await supabase
      .from("research_runs")
      .select(
        "id, created_at, health, ranked, keywords_checked, response_ms, http_status",
      )
      .eq("host", host)
      .eq("country", c)
      .order("created_at", { ascending: true })
      .limit(30);
    setHistory(rows ?? []);
  };
  useEffect(() => {
    loadSaved();
  }, []);

  const show = (r: any) => {
    setData(r);
    setTab("overview");
    setError(null);
    loadHistory(r.meta.host, r.meta.country);
  };

  const crawlLabel = (p: any) =>
    p.phase === "crawl"
      ? `Crawling pages: ${p.crawled} done, ${p.queued} waiting${p.rendered ? `, ${p.rendered} opened in a browser (JavaScript sites)` : ""}…`
      : `Checking links for broken pages: ${p.linksChecked} of ${p.linksTotal}…`;

  // retry a step a few times so one bad network moment does not lose the whole crawl
  const stepWithRetry = async (jobId: string) => {
    let last: Error | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        return await fn("crawl", { action: "step", job_id: jobId });
      } catch (err) {
        last = err as Error;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw last!;
  };

  const run = async (force: boolean, e?: FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setProgress("");
    try {
      if (!force) {
        const c = await fn("research", {
          url,
          country,
          depth,
          scope,
          maxKeywords,
          cacheOnly: true,
        });
        if (!c.miss) {
          show(c);
          loadSaved();
          setLoading(false);
          return;
        }
      }
      setProgress("Opening the website and reading its sitemap…");
      const s = await fn("crawl", { action: "start", url, maxPages });
      let p = s.progress;
      while (!p.done) {
        setProgress(crawlLabel(p));
        p = (await stepWithRetry(s.job_id)).progress;
      }
      setProgress(
        "Checking speed and Google rankings, then writing the action plan…",
      );
      const r = await fn("research", {
        url,
        country,
        depth,
        scope,
        maxKeywords,
        force: true,
        job_id: s.job_id,
      });
      show(r);
      loadSaved();
    } catch (err) {
      setError((err as Error).message);
    }
    setProgress("");
    setLoading(false);
  };

  const open = async (id: string) => {
    setLoading(true);
    setError(null);
    const { data: row, error: err } = await supabase
      .from("research_runs")
      .select("id, result, created_at")
      .eq("id", id)
      .single();
    if (err || !row) setError(err?.message ?? "Could not load that report");
    else {
      show({
        ...row.result,
        id: row.id,
        cached: true,
        createdAt: row.created_at,
      });
      setUrl(row.result.meta.url);
      setCountry(row.result.meta.country);
      setScope((row.result.meta.scope ?? "country") as Scope);
    }
    setLoading(false);
  };

  const d = data;
  const m = d?.meta;
  const speed = d?.site?.speed;
  const pagesWithIssues = d
    ? d.pages.filter((p: any) => p.issues.length).length
    : 0;
  const tabs: { id: Tab; label: string; count?: number }[] = d
    ? [
        { id: "overview", label: "Overview" },
        {
          id: "issues",
          label: "Issues",
          count: d.severity.high + d.severity.medium + d.severity.low,
        },
        { id: "crawler", label: "Crawler", count: m.pagesCrawled },
        { id: "content", label: "Content" },
        { id: "serp", label: "SERP", count: d.rankings.length },
        {
          id: "keywords",
          label: "Keywords",
          count: (d.keywordTable ?? []).length,
        },
        { id: "speed", label: "Pagespeed" },
        { id: "images", label: "Images" },
        { id: "links", label: "Links" },
        { id: "uptime", label: "Uptime" },
        { id: "traffic", label: "Traffic" },
        { id: "plan", label: "Action plan", count: d.plan.length },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Domain Research"
        sub="Paste any public page or website. Real crawl, speed and Google ranking data, using free sources only."
      />

      <form
        onSubmit={(e) => run(false, e)}
        className="card mb-4 grid gap-2 md:grid-cols-[1fr_170px_190px_130px_150px_auto]"
      >
        <input
          className="input"
          placeholder="example.com or https://example.com/some-page"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (!touched) setCountry(guess(e.target.value));
          }}
        />
        <Select
          className="input"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setTouched(true);
          }}
          aria-label="Country for rankings"
        >
          {COUNTRIES.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          className="input"
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          aria-label="What the numbers should cover"
        >
          {SCOPES.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          className="input"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          aria-label="Ranking depth"
        >
          <option value={10}>Rank: top 10</option>
          <option value={30}>Rank: top 30</option>
        </Select>
        <Select
          className="input"
          value={maxKeywords}
          onChange={(e) => setMaxKeywords(Number(e.target.value))}
          aria-label="Keywords to check"
        >
          <option value={25}>Check 25 keywords</option>
          <option value={40}>Check 40 keywords</option>
          <option value={60}>Check 60 keywords</option>
          <option value={100}>Check 100 keywords</option>
        </Select>
        <Select
          className="input"
          value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value))}
          aria-label="Pages to crawl"
        >
          <option value={100}>Crawl up to 100 pages</option>
          <option value={300}>Crawl up to 300 pages</option>
          <option value={500}>Crawl up to 500 pages</option>
          <option value={1000}>Crawl up to 1000 pages</option>
        </Select>
        <button className="btn" disabled={loading}>
          {loading && <Spinner />} Analyze
        </button>
      </form>
      <ErrorNote message={error} />
      {loading && (
        <div className="card mb-4 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Spinner /> {progress || "Working…"} Big sites take a few minutes.
          Keep this tab open.
        </div>
      )}

      {d && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">
                {m.host}
                {d.site.shared ? " (shared hosting)" : ""}
              </h2>
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-600 hover:underline"
              >
                {m.url}
              </a>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Checked {when(d.createdAt ?? m.checkedAt)} · Google{" "}
                {m.country.toUpperCase()}
                {m.scope === "world"
                  ? " + 5 more markets"
                  : m.scope === "topic"
                    ? " · by topic"
                    : ""}{" "}
                · {m.pagesCrawled} of {m.urlsDiscovered} pages crawled
                {d.cached ? " · saved report" : ""}
              </p>
            </div>
            <button
              className="btn-ghost"
              disabled={loading}
              onClick={() => run(true)}
            >
              Re-run with fresh data
            </button>
          </div>

          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {/* ---------------- OVERVIEW ---------------- */}
          {tab === "overview" && (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <div className="flex justify-around">
                    <Gauge value={m.health} label="Site health" />
                    <Gauge
                      value={speed?.scores.performance}
                      label="Speed (mobile)"
                    />
                  </div>
                </Card>
                <Stat
                  label="Keywords ranking"
                  value={
                    m.serperUsed
                      ? `${m.rankedCount} / ${m.keywordsChecked}`
                      : "–"
                  }
                  sub={
                    m.serperUsed
                      ? `in Google top ${m.depth}, ${m.country.toUpperCase()}`
                      : "Add SERPER_API_KEY to check rankings"
                  }
                  right={
                    <Spark
                      values={history
                        .filter((h) => h.ranked != null)
                        .map((h) => h.ranked)}
                    />
                  }
                />
                {(() => {
                  const kds = (d.keywordTable ?? [])
                    .filter((k: any) => k.kd != null)
                    .map((k: any) => k.kd as number);
                  const avg = kds.length
                    ? Math.round(
                        kds.reduce((a: number, b: number) => a + b, 0) /
                          kds.length,
                      )
                    : null;
                  return (
                    <Stat
                      label="Keyword difficulty (avg)"
                      value={avg ?? "–"}
                      sub={
                        avg == null
                          ? "Re-run with fresh data to see KD"
                          : avg < 30
                            ? "Easy: good chance to rank"
                            : avg < 60
                              ? "Possible with good content"
                              : "Hard: strong competitors"
                      }
                    />
                  );
                })()}
                <Stat
                  label="Pages with issues"
                  value={`${pagesWithIssues} / ${m.pagesCrawled}`}
                  sub={
                    <span>
                      <Dot color="#dc2626" />
                      {d.severity.high} high <Dot color="#d97706" />
                      {d.severity.medium} medium <Dot color="#94a3b8" />
                      {d.severity.low} low
                    </span>
                  }
                  right={
                    <Spark
                      values={history
                        .filter((h) => h.health != null)
                        .map((h) => h.health)}
                      color="#16a34a"
                    />
                  }
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  <Card title="Site health">
                    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                      {m.health >= 90
                        ? "Overview: the site health is good."
                        : m.health >= 70
                          ? "Overview: some pages need attention."
                          : "Overview: many pages have problems to fix."}
                    </p>
                    <Meter label="Page health (crawl)" value={m.health} />
                    <Meter
                      label="Performance (mobile)"
                      value={speed?.scores.performance}
                    />
                    <Meter
                      label="SEO checks (Lighthouse)"
                      value={speed?.scores.seo}
                    />
                    <Meter
                      label="Accessibility"
                      value={speed?.scores.accessibility}
                    />
                    <Meter
                      label="Best practices"
                      value={speed?.scores.bestPractices}
                    />
                  </Card>
                </div>
                <div className="lg:col-span-2">
                  <Card
                    title="Links found"
                    right={
                      <span className="text-sm font-semibold">
                        {d.links.internal + d.links.external}
                      </span>
                    }
                  >
                    <Row
                      label={
                        <>
                          <Dot color="#6c47ff" />
                          Dofollow
                        </>
                      }
                    >
                      {d.links.dofollow}
                    </Row>
                    <Row
                      label={
                        <>
                          <Dot color="#d97706" />
                          Nofollow
                        </>
                      }
                    >
                      {d.links.nofollow}
                    </Row>
                    <Row
                      label={
                        <>
                          <Dot color="#16a34a" />
                          Noreferrer
                        </>
                      }
                    >
                      {d.links.noreferrer}
                    </Row>
                    <Row
                      label={
                        <>
                          <Dot color="#dc2626" />
                          Noopener
                        </>
                      }
                    >
                      {d.links.noopener}
                    </Row>
                    <div className="mt-3 text-xs font-semibold uppercase text-slate-500">
                      Link types
                    </div>
                    <Row label="Internal">{d.links.internal}</Row>
                    <Row label="External">{d.links.external}</Row>
                    <Row label="Anchor (#)">{d.links.anchors}</Row>
                  </Card>
                </div>
              </div>

              <Card
                title="Top issues to fix"
                right={
                  <button
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => setTab("issues")}
                  >
                    See all
                  </button>
                }
              >
                {d.issues.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No issues found on the crawled pages.
                  </p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th className="th">Issue</th>
                        <th className="th">Severity</th>
                        <th className="th">Pages</th>
                        <th className="th">Example page</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.issues.slice(0, 8).map((i: any) => (
                        <tr
                          key={i.id}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td font-medium">{i.label}</td>
                          <td className="td">
                            <Badge tone={priorityTone(i.severity)}>
                              {i.severity}
                            </Badge>
                          </td>
                          <td className="td">{i.count}</td>
                          <td className="td max-w-[260px] truncate text-slate-500">
                            {short(i.examples[0])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              <Card title="About this site">
                {d.profile && (
                  <>
                    {d.profile.topic && (
                      <Row label="Topic">{d.profile.topic}</Row>
                    )}
                    {d.profile.audience && (
                      <Row label="Audience">{d.profile.audience}</Row>
                    )}
                    {d.profile.offerings?.length > 0 && (
                      <Row label="Offers">{d.profile.offerings.join(", ")}</Row>
                    )}
                  </>
                )}
                <Row label="Domain age">
                  {d.site.age
                    ? `Since ${d.site.age.since} (${d.site.age.source})`
                    : d.site.shared
                      ? "Not available on shared hosting"
                      : "Not found"}
                </Row>
                <Row label="Tranco rank (top 1M sites)">
                  {d.site.tranco
                    ? `#${d.site.tranco.toLocaleString()}`
                    : "Not in the top 1M"}
                </Row>
                {d.site.tech.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.site.tech.map((t: string) => (
                      <Badge key={t} tone="brand">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                UR, DR, DA, backlink counts and organic traffic come from paid
                databases, so they are not shown. Everything here is measured
                from the live site, Google PageSpeed and Google search results.
              </p>
            </div>
          )}

          {/* ---------------- ISSUES ---------------- */}
          {tab === "issues" && (
            <Card
              title="Issues"
              right={
                <div className="flex gap-1">
                  <button
                    className={view === "page" ? "btn" : "btn-ghost"}
                    onClick={() => setView("page")}
                  >
                    By page
                  </button>
                  <button
                    className={view === "issue" ? "btn" : "btn-ghost"}
                    onClick={() => setView("issue")}
                  >
                    By issue
                  </button>
                </div>
              }
            >
              {view === "page" ? (
                <div className="grid gap-2">
                  {[...d.pages]
                    .sort((a: any, b: any) => a.score - b.score)
                    .map((p: any) => (
                      <details
                        key={p.url}
                        className="rounded-lg border border-slate-200 dark:border-slate-800"
                      >
                        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {short(p.url)}
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge tone={statusTone(p.status)}>
                              {p.status || "failed"}
                            </Badge>
                            <span className="text-xs text-slate-500">
                              {p.issues.length} issues
                            </span>
                            <span
                              className="w-10 text-right text-sm font-bold"
                              style={{ color: scoreColor(p.score) }}
                            >
                              {p.score}
                            </span>
                          </span>
                        </summary>
                        <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                          {p.issues.length === 0 ? (
                            <p className="py-2 text-sm text-green-700 dark:text-green-400">
                              No issues found on this page.
                            </p>
                          ) : (
                            p.issues.map((i: any, k: number) => (
                              <div
                                key={k}
                                className="border-b border-slate-100 py-2 last:border-0 dark:border-slate-800"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <Badge tone={priorityTone(i.severity)}>
                                    {i.severity}
                                  </Badge>
                                  <span className="font-medium">{i.label}</span>
                                  {i.detail && (
                                    <span className="text-slate-500">
                                      · {i.detail}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  How to fix: {i.fix}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      </details>
                    ))}
                </div>
              ) : (
                <div className="grid gap-2">
                  {d.issues.length === 0 && (
                    <p className="text-sm text-slate-500">
                      No issues found on the crawled pages.
                    </p>
                  )}
                  {d.issues.map((i: any) => (
                    <details
                      key={i.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800"
                    >
                      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <Badge tone={priorityTone(i.severity)}>
                            {i.severity}
                          </Badge>
                          <span className="font-medium">{i.label}</span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {i.count} {i.count === 1 ? "page" : "pages"}
                        </span>
                      </summary>
                      <div className="border-t border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                          How to fix: {i.fix}
                        </p>
                        <ul className="space-y-1">
                          {i.examples.map((u: string) => (
                            <li
                              key={u}
                              className="truncate text-slate-600 dark:text-slate-300"
                            >
                              {u}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Page score = 100 minus 25 per high, 10 per medium and 3 per low
                issue. Every crawled page is included.
              </p>
            </Card>
          )}

          {/* ---------------- CRAWLER ---------------- */}
          {tab === "crawler" && (
            <Card
              title="Crawled pages"
              right={
                <span className="text-xs text-slate-500">
                  {m.pagesCrawled} pages crawled · {m.urlsDiscovered} URLs found
                  {m.crawl?.linksChecked
                    ? ` · ${m.crawl.linksChecked} extra links checked`
                    : ""}
                </span>
              }
            >
              <Table>
                <thead>
                  <tr>
                    <th className="th">Page</th>
                    <th className="th">Status</th>
                    <th className="th">Response</th>
                    <th className="th">Words</th>
                    <th className="th">H1</th>
                    <th className="th">Issues</th>
                    <th className="th">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pages.map((p: any) => (
                    <tr
                      key={p.url}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="td max-w-[280px] truncate font-medium">
                        {short(p.url)}
                      </td>
                      <td className="td">
                        <Badge tone={statusTone(p.status)}>
                          {p.status || "failed"}
                        </Badge>
                      </td>
                      <td className="td">{p.ms} ms</td>
                      <td className="td">{p.words}</td>
                      <td className="td">{p.h1s.length}</td>
                      <td className="td">{p.issues.length}</td>
                      <td
                        className="td font-bold"
                        style={{ color: scoreColor(p.score) }}
                      >
                        {p.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {/* ---------------- CONTENT ---------------- */}
          {tab === "content" && (
            <div className="grid gap-4">
              <Card title="Titles, descriptions and headings">
                <Table>
                  <thead>
                    <tr>
                      <th className="th">Page</th>
                      <th className="th">Title</th>
                      <th className="th">Description</th>
                      <th className="th">H1</th>
                      <th className="th">H2</th>
                      <th className="th">Words</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pages
                      .filter((p: any) => p.status === 200)
                      .map((p: any) => (
                        <tr
                          key={p.url}
                          className="border-t border-slate-100 align-top dark:border-slate-800"
                        >
                          <td className="td max-w-[160px] truncate font-medium">
                            {short(p.url)}
                          </td>
                          <td className="td max-w-[220px]">
                            {p.title || <Badge tone="red">missing</Badge>}
                            <div className="text-xs text-slate-400">
                              {p.title.length} chars
                            </div>
                          </td>
                          <td className="td max-w-[260px]">
                            {p.description ? (
                              p.description.slice(0, 110) +
                              (p.description.length > 110 ? "…" : "")
                            ) : (
                              <Badge tone="amber">missing</Badge>
                            )}
                            <div className="text-xs text-slate-400">
                              {p.description.length} chars
                            </div>
                          </td>
                          <td className="td max-w-[180px]">
                            {p.h1s[0] ?? <Badge tone="amber">missing</Badge>}
                          </td>
                          <td className="td">{p.h2}</td>
                          <td className="td">{p.words}</td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </Card>
              <Card title="Words the site uses most">
                <div className="flex flex-wrap gap-2">
                  {d.terms.map((t: any) => (
                    <Badge key={t.word}>
                      {t.word} · {t.count}
                    </Badge>
                  ))}
                </div>
                {d.terms.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No readable text found.
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* ---------------- SERP ---------------- */}
          {tab === "serp" && (
            <div className="grid gap-4">
              {!m.serperUsed && (
                <div className="card text-sm text-slate-600 dark:text-slate-300">
                  Rankings were not checked. This needs SERPER_API_KEY in
                  Supabase secrets and a site that could be read. See the
                  "Skipped or incomplete" note at the bottom for the reason.
                </div>
              )}
              {d.rankings.length > 0 && (
                <Card
                  title="Keyword rankings"
                  right={
                    <span className="text-xs text-slate-500">
                      Google {m.country.toUpperCase()}, top {m.depth} only.
                      Results vary by location and device.
                    </span>
                  }
                >
                  <Table>
                    <thead>
                      <tr>
                        <th className="th">Keyword</th>
                        <th className="th">Position</th>
                        <th className="th">KD*</th>
                        <th className="th">Searches/mo*</th>
                        <th className="th">Ranking page</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rankings.map((r: any) => (
                        <tr
                          key={r.keyword}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td font-medium">{r.keyword}</td>
                          <td className="td">
                            {r.error ? (
                              <Badge tone="red">error</Badge>
                            ) : (
                              <Badge tone={posTone(r.position)}>
                                {r.position ?? `not in top ${m.depth}`}
                              </Badge>
                            )}
                          </td>
                          {(() => {
                            const k = (d.keywordTable ?? []).find(
                              (x: any) => x.keyword === r.keyword,
                            );
                            return (
                              <>
                                <td className="td">
                                  {k?.kd != null ? (
                                    <Badge
                                      tone={kdBadge(k.kd)}
                                    >{`${k.kd} · ${k.kdLabel}`}</Badge>
                                  ) : (
                                    <span className="text-slate-400">–</span>
                                  )}
                                </td>
                                <td className="td">{k ? nf(k.volume) : "–"}</td>
                              </>
                            );
                          })()}
                          <td className="td max-w-[320px] truncate text-slate-500">
                            {r.url ? short(r.url) : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}
              {d.competitors.length > 0 && (
                <Card title="Competitors in these searches">
                  <Table>
                    <thead>
                      <tr>
                        <th className="th">Domain</th>
                        <th className="th">Keywords</th>
                        <th className="th">Avg. position</th>
                        <th className="th">Share of checked keywords</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.competitors.map((c: any) => (
                        <tr
                          key={c.domain}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td font-medium">{c.domain}</td>
                          <td className="td">{c.keywords}</td>
                          <td className="td">{c.avgPosition}</td>
                          <td className="td">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className="h-full bg-brand-500"
                                  style={{ width: `${c.share}%` }}
                                />
                              </div>
                              {c.share}%
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {d.platforms.length > 0 && (
                    <p className="mt-3 text-xs text-slate-500">
                      Big platforms also showing up:{" "}
                      {d.platforms.map((p: any) => p.domain).join(", ")}
                    </p>
                  )}
                </Card>
              )}
              {d.gaps.length > 0 && (
                <Card title="Content gaps: keywords where this site is missing">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {d.gaps.map((g: any) => (
                      <div
                        key={g.keyword}
                        className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                      >
                        <div className="mb-1 text-sm font-semibold">
                          {g.keyword}
                        </div>
                        <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                          {g.top.map((t: any) => (
                            <li key={t.url} className="truncate">
                              #{t.position} {t.domain}: {t.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {d.ideas.length > 0 && (
                <Card title="Keyword ideas from Google (related searches and questions)">
                  <div className="flex flex-wrap gap-2">
                    {d.ideas.map((i: string) => (
                      <Badge key={i}>{i}</Badge>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === "keywords" && <KeywordsTab d={d} />}

          {/* ---------------- PAGESPEED ---------------- */}
          {tab === "speed" && (
            <div className="grid gap-4">
              {!speed ? (
                <div className="card text-sm text-slate-600 dark:text-slate-300">
                  The speed test did not finish.{" "}
                  {d.notes
                    .filter((n: string) => n.startsWith("Speed"))
                    .join(" ")}
                </div>
              ) : (
                <>
                  <Card title="Mobile scores">
                    <div className="flex flex-wrap justify-around gap-4">
                      <ScoreRing
                        value={speed.scores.performance}
                        label="Performance"
                      />
                      <ScoreRing value={speed.scores.seo} label="SEO" />
                      <ScoreRing
                        value={speed.scores.accessibility}
                        label="Accessibility"
                      />
                      <ScoreRing
                        value={speed.scores.bestPractices}
                        label="Best practices"
                      />
                    </div>
                  </Card>
                  <Card title="Core Web Vitals (lab test)">
                    {(
                      [
                        [
                          "Largest Contentful Paint",
                          sec(speed.vitals.lcp),
                          rate(speed.vitals.lcp, 2500, 4000),
                        ],
                        [
                          "Cumulative Layout Shift",
                          speed.vitals.cls?.toFixed(2) ?? "–",
                          rate(speed.vitals.cls, 0.1, 0.25),
                        ],
                        [
                          "Total Blocking Time",
                          speed.vitals.tbt != null
                            ? `${Math.round(speed.vitals.tbt)} ms`
                            : "–",
                          rate(speed.vitals.tbt, 200, 600),
                        ],
                        [
                          "First Contentful Paint",
                          sec(speed.vitals.fcp),
                          rate(speed.vitals.fcp, 1800, 3000),
                        ],
                        [
                          "Speed Index",
                          sec(speed.vitals.speedIndex),
                          rate(speed.vitals.speedIndex, 3400, 5800),
                        ],
                      ] as [string, string, string | null][]
                    ).map(([l, v, r]) => (
                      <Row key={l} label={l}>
                        {v} {r && <Badge tone={rateTone(r)}>{r}</Badge>}
                      </Row>
                    ))}
                    {d.site.field && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold uppercase text-slate-500">
                          Real Chrome users (75th percentile)
                        </div>
                        <Row label="LCP">
                          {sec(d.site.field.lcp)}{" "}
                          {d.site.field.lcp != null && (
                            <Badge
                              tone={rateTone(
                                rate(d.site.field.lcp, 2500, 4000),
                              )}
                            >
                              {rate(d.site.field.lcp, 2500, 4000)}
                            </Badge>
                          )}
                        </Row>
                        <Row label="CLS">{d.site.field.cls ?? "–"}</Row>
                        <Row label="INP">
                          {d.site.field.inp != null
                            ? `${d.site.field.inp} ms`
                            : "–"}{" "}
                          {d.site.field.inp != null && (
                            <Badge
                              tone={rateTone(rate(d.site.field.inp, 200, 500))}
                            >
                              {rate(d.site.field.inp, 200, 500)}
                            </Badge>
                          )}
                        </Row>
                      </div>
                    )}
                  </Card>
                  {speed.opportunities.length > 0 && (
                    <Card title="Biggest speed wins">
                      {speed.opportunities.map((o: any) => (
                        <Row key={o.id} label={o.title}>
                          {o.savingsMs >= 1000
                            ? `${(o.savingsMs / 1000).toFixed(1)} s`
                            : `${o.savingsMs} ms`}{" "}
                          faster
                        </Row>
                      ))}
                    </Card>
                  )}
                  {speed.failed.length > 0 && (
                    <Card title="Checks that failed">
                      {speed.failed.map((f: any) => (
                        <Row key={f.id} label={f.title}>
                          <Badge>{f.category}</Badge> {f.displayValue}
                        </Row>
                      ))}
                    </Card>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---------------- IMAGES ---------------- */}
          {tab === "images" && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Images found" value={d.images.total} />
                <Stat label="Missing alt text" value={d.images.noAlt} />
                <Stat label="No width/height" value={d.images.noSize} />
                <Stat label="Not lazy-loaded" value={d.images.notLazy} />
              </div>
              <Card title="Images per page">
                <Table>
                  <thead>
                    <tr>
                      <th className="th">Page</th>
                      <th className="th">Images</th>
                      <th className="th">No alt</th>
                      <th className="th">No size</th>
                      <th className="th">Not lazy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pages
                      .filter((p: any) => p.status === 200)
                      .map((p: any) => (
                        <tr
                          key={p.url}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td max-w-[260px] truncate font-medium">
                            {short(p.url)}
                          </td>
                          <td className="td">{p.images.total}</td>
                          <td className="td">{p.images.noAlt}</td>
                          <td className="td">{p.images.noSize}</td>
                          <td className="td">{p.images.notLazy}</td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </Card>
              {d.images.worst.length > 0 && (
                <Card title="Images that need alt text">
                  <ul className="space-y-2 text-sm">
                    {d.images.worst.map((w: any, i: number) => (
                      <li
                        key={i}
                        className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800"
                      >
                        <div className="truncate font-medium">{w.src}</div>
                        <div className="text-xs text-slate-500">
                          on {short(w.page)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}

          {/* ---------------- LINKS ---------------- */}
          {tab === "links" && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Internal links" value={d.links.internal} />
                <Stat label="External links" value={d.links.external} />
                <Stat label="Nofollow" value={d.links.nofollow} />
                <Stat label="Anchor (#) links" value={d.links.anchors} />
              </div>
              <Card title={`Broken links (${(d.brokenLinks ?? []).length})`}>
                {(d.brokenLinks ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No broken links found.
                  </p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th className="th">Broken URL</th>
                        <th className="th">Type</th>
                        <th className="th">Status</th>
                        <th className="th">Times linked</th>
                        <th className="th">Found on</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.brokenLinks.map((b: any) => (
                        <tr
                          key={b.url}
                          className="border-t border-slate-100 align-top dark:border-slate-800"
                        >
                          <td className="td max-w-[280px] truncate font-medium">
                            {b.url}
                          </td>
                          <td className="td">
                            <Badge
                              tone={b.kind === "internal" ? "red" : "amber"}
                            >
                              {b.kind}
                            </Badge>
                          </td>
                          <td className="td">
                            {b.status === 0
                              ? "no response"
                              : (b.status ?? "error")}
                          </td>
                          <td className="td">{b.count}</td>
                          <td className="td max-w-[240px] text-xs">
                            {b.from.map((f: string) => (
                              <div key={f} className="truncate">
                                {short(f)}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
              <Card
                title="Outgoing external links"
                right={
                  <Select
                    className="input w-36"
                    value={relFilter}
                    onChange={(e) => setRelFilter(e.target.value as any)}
                    aria-label="Filter links"
                  >
                    <option value="all">All</option>
                    <option value="nofollow">Nofollow</option>
                    <option value="dofollow">Dofollow</option>
                  </Select>
                }
              >
                <Table>
                  <thead>
                    <tr>
                      <th className="th">Domain</th>
                      <th className="th">Link</th>
                      <th className="th">Rel</th>
                      <th className="th">Anchor text</th>
                      <th className="th">Found on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.links.external_list
                      .filter(
                        (l: any) =>
                          relFilter === "all" ||
                          (relFilter === "nofollow"
                            ? l.rel.includes("nofollow")
                            : !l.rel.includes("nofollow")),
                      )
                      .map((l: any, i: number) => (
                        <tr
                          key={i}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td font-medium">{l.domain}</td>
                          <td className="td max-w-[240px] truncate text-slate-500">
                            {l.url}
                          </td>
                          <td className="td">
                            {l.rel ? (
                              l.rel
                                .split(/\s+/)
                                .map((r: string) => <Badge key={r}>{r}</Badge>)
                            ) : (
                              <Badge tone="green">dofollow</Badge>
                            )}
                          </td>
                          <td className="td max-w-[160px] truncate">
                            {l.anchor || "–"}
                          </td>
                          <td className="td max-w-[140px] truncate text-slate-500">
                            {short(l.from)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
                {d.links.external_list.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No external links found on the crawled pages.
                  </p>
                )}
              </Card>
              <p className="text-xs text-slate-500">
                These are links this site points to. Incoming backlinks (who
                links to this site) need a paid link index, so they are not
                shown. For your own sites, Bing Webmaster Tools and Ahrefs
                Webmaster Tools show backlinks for free.
              </p>
            </div>
          )}

          {/* ---------------- UPTIME ---------------- */}
          {tab === "uptime" && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Homepage status"
                  value={d.site.status}
                  sub={d.site.status === 200 ? "Site is up" : "Check this page"}
                />
                <Stat
                  label="First response time"
                  value={`${d.site.responseMs} ms`}
                  sub={
                    d.site.responseMs <= 800
                      ? "Fast"
                      : d.site.responseMs <= 1500
                        ? "Acceptable"
                        : "Slow"
                  }
                  right={
                    <Spark
                      values={history
                        .filter((h) => h.response_ms != null)
                        .map((h) => h.response_ms)}
                      color="#d97706"
                    />
                  }
                />
                <Stat
                  label="Pages that loaded"
                  value={`${d.pages.filter((p: any) => p.status === 200).length} / ${d.pages.length}`}
                />
              </div>
              <Card title="Response time per page">
                {[...d.pages]
                  .sort((a: any, b: any) => b.ms - a.ms)
                  .map((p: any) => (
                    <div key={p.url} className="mb-2 last:mb-0">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="truncate pr-2">{short(p.url)}</span>
                        <span className="font-semibold">{p.ms} ms</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (p.ms / 3000) * 100)}%`,
                            background:
                              p.ms <= 800
                                ? "#16a34a"
                                : p.ms <= 1500
                                  ? "#d97706"
                                  : "#dc2626",
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </Card>
              <Card title="Check history for this site">
                {history.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No saved checks yet. Every run adds a point here.
                  </p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th className="th">When</th>
                        <th className="th">Status</th>
                        <th className="th">Response</th>
                        <th className="th">Health</th>
                        <th className="th">Keywords ranking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h: any) => (
                        <tr
                          key={h.id}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td">{when(h.created_at)}</td>
                          <td className="td">
                            <Badge tone={statusTone(h.http_status ?? 0)}>
                              {h.http_status ?? "–"}
                            </Badge>
                          </td>
                          <td className="td">
                            {h.response_ms != null
                              ? `${h.response_ms} ms`
                              : "–"}
                          </td>
                          <td className="td">{h.health ?? "–"}</td>
                          <td className="td">
                            {h.ranked != null
                              ? `${h.ranked} / ${h.keywords_checked}`
                              : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  This shows the checks you ran, not 24/7 monitoring. Constant
                  uptime monitoring needs a scheduled job.
                </p>
              </Card>
            </div>
          )}

          {/* ---------------- TRAFFIC ---------------- */}
          {tab === "traffic" &&
            (() => {
              const tr = d.traffic;
              const own = tr?.own;
              const ga = own?.ga4;
              const gs = own?.gsc;
              return (
                <div className="grid gap-4">
                  {!tr && (
                    <div className="card text-sm text-slate-600 dark:text-slate-300">
                      Traffic could not be read for this run. Press "Re-run with
                      fresh data".
                    </div>
                  )}
                  {tr?.mode === "none" && (
                    <div className="card text-sm text-slate-600 dark:text-slate-300">
                      {tr.note}
                    </div>
                  )}

                  {tr?.mode === "own" && (
                    <>
                      <div className="card text-sm text-slate-600 dark:text-slate-300">
                        <Badge tone="green">Real data</Badge>{" "}
                        <span className="ml-2">
                          Read live from your Google accounts for the last{" "}
                          {own.days} days
                          {own.website?.name ? ` (${own.website.name})` : ""}.
                        </span>
                      </div>
                      {own.errors?.length > 0 && (
                        <div className="card text-sm text-amber-700 dark:text-amber-400">
                          {own.errors.join(" · ")}
                        </div>
                      )}

                      {ga && (
                        <>
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Stat
                              label="Visits (sessions)"
                              value={nf(ga.totals.sessions)}
                              sub="Google Analytics, 30 days"
                              right={
                                <Spark
                                  values={ga.daily.map((x: any) => x.sessions)}
                                  color="#5b38ee"
                                />
                              }
                            />
                            <Stat
                              label="Visitors (users)"
                              value={nf(ga.totals.users)}
                              sub={`${nf(ga.totals.newUsers)} new`}
                            />
                            <Stat
                              label="Engaged visits"
                              value={nf(ga.totals.engagedSessions)}
                              sub={`${Math.round(ga.totals.engagementRate * 100)}% of visits did something`}
                            />
                            {gs && (
                              <Stat
                                label="Google search clicks"
                                value={nf(gs.totals.clicks)}
                                sub={`${nf(gs.totals.impressions)} impressions`}
                                right={
                                  <Spark
                                    values={gs.daily.map((x: any) => x.clicks)}
                                    color="#16a34a"
                                  />
                                }
                              />
                            )}
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <Card title="Where visits come from (channel)">
                              <Bars
                                rows={ga.channels.map((x: any) => ({
                                  key: x.key,
                                  value: x.sessions,
                                }))}
                              />
                            </Card>
                            <Card title="Top sources">
                              <Bars
                                rows={ga.sources.map((x: any) => ({
                                  key: x.key,
                                  value: x.sessions,
                                }))}
                                color="#3b82f6"
                              />
                            </Card>
                            <Card title="Countries">
                              <Bars
                                rows={ga.countries.map((x: any) => ({
                                  key: x.key,
                                  value: x.sessions,
                                }))}
                                color="#d97706"
                              />
                            </Card>
                            <Card title="Devices">
                              <Bars
                                rows={ga.devices.map((x: any) => ({
                                  key: x.key,
                                  value: x.sessions,
                                }))}
                                color="#7c3aed"
                              />
                            </Card>
                          </div>
                        </>
                      )}

                      {gs && (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {!ga && (
                            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
                              <Stat
                                label="Google search clicks"
                                value={nf(gs.totals.clicks)}
                                sub="Search Console, 30 days"
                                right={
                                  <Spark
                                    values={gs.daily.map((x: any) => x.clicks)}
                                    color="#16a34a"
                                  />
                                }
                              />
                              <Stat
                                label="Impressions"
                                value={nf(gs.totals.impressions)}
                              />
                              <Stat
                                label="Average position"
                                value={
                                  gs.totals.position
                                    ? gs.totals.position.toFixed(1)
                                    : "–"
                                }
                                sub={`CTR ${pct(gs.totals.ctr)}`}
                              />
                            </div>
                          )}
                          <Card title="Top searches that bring clicks">
                            <Table>
                              <thead>
                                <tr>
                                  <th className="th">Search</th>
                                  <th className="th">Clicks</th>
                                  <th className="th">Impr.</th>
                                  <th className="th">Pos.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {gs.queries.map((q: any) => (
                                  <tr
                                    key={q.key}
                                    className="border-t border-slate-100 dark:border-slate-800"
                                  >
                                    <td className="td">{q.key}</td>
                                    <td className="td">{nf(q.clicks)}</td>
                                    <td className="td">{nf(q.impressions)}</td>
                                    <td className="td">
                                      {q.position.toFixed(1)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </Card>
                          <Card title="Top pages from Google">
                            <Table>
                              <thead>
                                <tr>
                                  <th className="th">Page</th>
                                  <th className="th">Clicks</th>
                                  <th className="th">Impr.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {gs.pages.map((q: any) => (
                                  <tr
                                    key={q.key}
                                    className="border-t border-slate-100 dark:border-slate-800"
                                  >
                                    <td
                                      className="td max-w-[260px] truncate"
                                      title={q.key}
                                    >
                                      {short(q.key)}
                                    </td>
                                    <td className="td">{nf(q.clicks)}</td>
                                    <td className="td">{nf(q.impressions)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </Card>
                          <Card title="Google clicks by country">
                            <Bars
                              rows={gs.countries.map((x: any) => ({
                                key: String(x.key).toUpperCase(),
                                value: x.clicks,
                              }))}
                              color="#16a34a"
                            />
                          </Card>
                        </div>
                      )}
                    </>
                  )}

                  {tr?.mode === "estimate" && own && !own.connected && (
                    <div className="card text-sm text-slate-600 dark:text-slate-300">
                      This looks like your site ({own.website?.name}), but
                      Google Analytics / Search Console is not connected or
                      could not be read. {own.errors?.join(" ")} Connect it on
                      the <b>Integrations</b> page to see real traffic, sources
                      and devices here.
                    </div>
                  )}

                  {tr?.seo
                    ? (() => {
                        const s = tr.seo;
                        const cname = (c: string) =>
                          (
                            ({
                              us: "United States",
                              gb: "United Kingdom",
                              ca: "Canada",
                              au: "Australia",
                              in: "India",
                              pk: "Pakistan",
                              de: "Germany",
                              fr: "France",
                            }) as Record<string, string>
                          )[c] ?? c.toUpperCase();
                        return (
                          <>
                            <div className="card text-sm text-slate-600 dark:text-slate-300">
                              <Badge tone="amber">Estimate</Badge>
                              <Badge
                                tone={
                                  s.confidence?.level === "Medium"
                                    ? "amber"
                                    : "red"
                                }
                              >{`Confidence: ${s.confidence?.level ?? "Low"}`}</Badge>
                              <span className="ml-2">
                                {tr.mode === "own"
                                  ? "For comparison with the real numbers above: "
                                  : ""}
                                Estimated from this site's real Google
                                positions, not measured visits.
                              </span>
                              {s.confidence?.reasons?.length > 0 && (
                                <p className="mt-2 text-xs text-slate-500">
                                  Why not higher:{" "}
                                  {s.confidence.reasons.join("; ")}.
                                </p>
                              )}
                              {s.bank?.keywords > 0 && (
                                <p className="mt-1 text-xs text-slate-500">
                                  Data bank: {s.bank.keywords.toLocaleString()}{" "}
                                  more keywords of this site were already known
                                  and counted with their real positions (about{" "}
                                  {s.bank.visits.toLocaleString()} visits),
                                  replacing {s.bank.replacedGuess}% of the
                                  scale-up guess.
                                </p>
                              )}
                              {s.bank?.trueVolumes > 0 && (
                                <p className="mt-1 text-xs text-slate-500">
                                  {s.bank.trueVolumes} keyword volumes come from
                                  real Search Console data, not from the AI.
                                </p>
                              )}
                              {s.calibration?.samples >= 15 &&
                                s.calibration.factor !== 1 && (
                                  <p className="mt-1 text-xs text-slate-500">
                                    AI volumes were corrected by x
                                    {s.calibration.factor} (learned from{" "}
                                    {s.calibration.samples} keywords with real
                                    Search Console numbers).
                                  </p>
                                )}
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              <Stat
                                label="Organic visits / month"
                                value={
                                  s.organic.mid > 0
                                    ? compact(s.organic.mid)
                                    : "Very low"
                                }
                                sub={
                                  s.organic.mid > 0
                                    ? `Range ${compact(s.organic.low)} – ${compact(s.organic.high)}`
                                    : "Not ranking for the checked keywords"
                                }
                              />
                              <Stat
                                label="All sources, rough"
                                value={
                                  s.organic.mid > 0
                                    ? `${compact(s.allSources.low)} – ${compact(s.allSources.high)}`
                                    : "–"
                                }
                                sub="If search is 30–55% of visits"
                              />
                              <Stat
                                label="Keywords ranking"
                                value={`${s.keywordsRanking} / ${s.keywordsChecked}`}
                                sub={`Top ${s.depth} in Google ${s.gl.toUpperCase()}`}
                              />
                              <Stat
                                label="Tranco rank"
                                value={
                                  tr.estimate?.trancoRank
                                    ? `#${nf(tr.estimate.trancoRank)}`
                                    : "Not in top 1M"
                                }
                                sub={
                                  tr.estimate?.low
                                    ? `Cross-check: ${compact(tr.estimate.low)} – ${compact(tr.estimate.high)} visits`
                                    : "Cross-check not possible"
                                }
                              />
                            </div>

                            {s.potential && s.organic.mid > 0 && (
                              <div className="card text-sm text-slate-600 dark:text-slate-300">
                                <Badge tone="green">Growth potential</Badge>
                                <span className="ml-2">
                                  If every checked keyword reached <b>#3</b>,
                                  organic visits could grow to about{" "}
                                  <b>{compact(s.potential.top3)}</b> a month (
                                  {(s.potential.top3 / s.organic.mid).toFixed(
                                    1,
                                  )}
                                  x today); at <b>#1</b>, about{" "}
                                  <b>{compact(s.potential.top1)}</b>. Open the{" "}
                                  <b>Keywords</b> tab to see which ones to start
                                  with.
                                </span>
                              </div>
                            )}

                            <div className="grid gap-4 lg:grid-cols-2">
                              <Card title="Estimated organic visits by country">
                                <Bars
                                  rows={s.countries
                                    .filter((c: any) => c.visits > 0)
                                    .map((c: any) => ({
                                      key: cname(c.country),
                                      value: c.visits,
                                    }))}
                                  color="#d97706"
                                />
                                <p className="mt-3 text-xs text-slate-500">
                                  {s.scope === "country" ||
                                  s.scope === "topic" ? (
                                    `Only ${s.gl.toUpperCase()} is counted. Choose “Worldwide” above to add the other big markets.`
                                  ) : (
                                    <>
                                      Compared on the top {s.top5.length}{" "}
                                      keywords in {s.countriesChecked + 1}{" "}
                                      countries.
                                      {s.countriesChecked === 0
                                        ? " Other countries were not checked because the site did not rank in the main country, or Serper was not available."
                                        : ""}
                                    </>
                                  )}
                                </p>
                              </Card>
                              <Card title="Keywords that bring the most visits">
                                <Table>
                                  <thead>
                                    <tr>
                                      <th className="th">Keyword</th>
                                      <th className="th">Pos.</th>
                                      <th className="th">Searches/mo*</th>
                                      <th className="th">Visits/mo</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.keywords.slice(0, 40).map((k: any) => (
                                      <tr
                                        key={k.keyword}
                                        className="border-t border-slate-100 dark:border-slate-800"
                                      >
                                        <td className="td">{k.keyword}</td>
                                        <td className="td">
                                          {k.position ? (
                                            <Badge tone={posTone(k.position)}>
                                              {k.position}
                                            </Badge>
                                          ) : (
                                            <span className="text-slate-400">
                                              –
                                            </span>
                                          )}
                                        </td>
                                        <td className="td">{nf(k.volume)}</td>
                                        <td className="td">
                                          {k.visits > 0 ? nf(k.visits) : "–"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </Table>
                                <p className="mt-3 text-xs text-slate-500">
                                  *
                                  {s.volumeSource === "ai"
                                    ? "Search volumes are AI estimates (free exact volumes do not exist)."
                                    : "AI volumes were not available, so volumes are guessed from the phrase length. Treat the totals as very rough."}
                                </p>
                              </Card>
                            </div>

                            <Card title="How this estimate is calculated">
                              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                                <li>
                                  We check where the site really ranks in Google
                                  for its main keywords (positions are real).
                                </li>
                                <li>
                                  Each keyword gets an estimated monthly search
                                  volume for that country. The AI number is then
                                  checked against Google autocomplete (how often
                                  and how high Google suggests the phrase) and
                                  ads on the results page, and pulled back if
                                  they disagree. More agreeing signals give a
                                  narrower range.
                                </li>
                                <li>
                                  Visits = searches x click rate at that
                                  position (#1 gets about 28%, #2 16%, #3 11%,
                                  #10 2.5%, page 2 about 1%). The click rate is
                                  lowered when the results page has ads,
                                  shopping boxes, answer boxes or maps, because
                                  they take clicks away.
                                </li>
                                <li>
                                  We add up all keywords, then add every other
                                  keyword the data bank already knows for this
                                  site. Only the part the bank cannot cover is
                                  scaled up (up to x{s.coverage}), because
                                  bigger sites rank for many more phrases than
                                  the ones checked. Searches for the site's own
                                  name (brand) are added on top, without
                                  scaling.
                                </li>
                                <li>
                                  Other countries are compared on the same top
                                  keywords and added in the same proportion.
                                </li>
                              </ol>
                              <p className="mt-3 text-xs text-slate-500">
                                Not included: direct visits, social, email and
                                ads. Devices and traffic sources cannot be
                                worked out from rankings. Expect the real number
                                to be anywhere from half to double. Connect
                                Google Analytics for a site you own to see exact
                                figures.
                              </p>
                            </Card>
                          </>
                        );
                      })()
                    : tr?.mode === "estimate" && (
                        <div className="card text-sm text-slate-600 dark:text-slate-300">
                          <Badge tone="amber">Estimate</Badge>
                          <span className="ml-2">
                            No ranking data was available for this run (keywords
                            were not checked), so no estimate could be made.
                            Check that SERPER_API_KEY is set, then re-run.
                          </span>
                          <p className="mt-2 text-xs text-slate-500">
                            {tr.estimate?.note}
                          </p>
                        </div>
                      )}
                </div>
              );
            })()}

          {/* ---------------- PLAN ---------------- */}
          {tab === "plan" && (
            <div className="grid gap-3">
              {d.plan.length === 0 && (
                <div className="card text-sm text-slate-600 dark:text-slate-300">
                  No action plan was created.{" "}
                  {d.notes
                    .filter((n: string) => n.startsWith("AI"))
                    .join(" ") || "Check that GEMINI_API_KEY is set."}
                </div>
              )}
              {d.plan.map((t: any, i: number) => (
                <div key={i} className="card">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                    <h3 className="text-sm font-semibold">{t.title}</h3>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t.why}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">Do this: </span>
                    {t.action}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Based on: {t.evidence}
                  </p>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                The plan is written by AI from the data in this report only.
                Check the numbers before making big changes.
              </p>
            </div>
          )}

          {d.notes.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Skipped or incomplete: {d.notes.join(" · ")}
            </p>
          )}
        </>
      )}

      {saved.length > 0 && (
        <div className="mt-8">
          <Card title="Saved reports">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((s) => (
                <button
                  key={s.id}
                  onClick={() => open(s.id)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">{s.host}</span>
                    <span
                      className="font-bold"
                      style={{ color: scoreColor(s.health) }}
                    >
                      {s.health ?? "–"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.country.toUpperCase()} · top {s.depth} ·{" "}
                    {when(s.created_at)}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}