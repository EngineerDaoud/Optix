import Select from "../components/Select";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import {
  Download,
  Globe,
  ListPlus,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import {
  cancelAnalysis,
  consumeAnalysis,
  getJob,
  startAnalysis,
  useAnalysis,
} from "../lib/analysisRun";
import { useSite } from "../context/Site";
import {
  countryTraffic,
  guessCountry,
  halfDelta,
  positionBuckets,
  shortPath,
} from "../lib/report";
import { cleanReport } from "../lib/dedupe";
import { exportReport, listSections, SectionInfo } from "../lib/exportreport";
import AnalyzingOverlay from "../components/AnalyzingOverlay";
import ExportDialog from "../components/ExportDialog";
import { publicText } from "../lib/clean";
import { flag } from "../lib/countries";
import {
  Badge,
  Breadcrumbs,
  ErrorNote,
  Spinner,
  priorityTone,
} from "../components/ui";
import {
  ChartTip,
  compact,
  Delta,
  Dot,
  HBars,
  healthColor,
  Panel,
  Ring,
  SemiGauge,
  Spark,
  StatTile,
  TipRow,
} from "../components/dash";
import WorldMap from "../components/WorldMap";
import CassieBoard from "../components/CassieBoard";
import DomainOverview from "../components/DomainOverview";
import { HeadToHead, KeywordTracker } from "../components/Compete";
import BacklinksPanel from "../components/BacklinksPanel";
import MyGoogleData from "../components/MyGoogleData";

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
type Scope = "country" | "world";
const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
};
const kdColor = (kd: number | null) =>
  kd == null
    ? "#94a3b8"
    : kd < 30
      ? "#16a34a"
      : kd < 60
        ? "#d97706"
        : "#dc2626";
const posTone = (p: number | null) =>
  p == null ? "slate" : p <= 3 ? "green" : p <= 10 ? "amber" : "slate";
const rate = (v: number | null | undefined, good: number, poor: number) =>
  v == null ? null : v <= good ? "green" : v <= poor ? "amber" : "red";
const rateText = (t: string | null) =>
  t === "green"
    ? "Good"
    : t === "amber"
      ? "Needs work"
      : t === "red"
        ? "Poor"
        : "No data";
const actionTone = (a: string) =>
  a === "Quick win" || a === "New content"
    ? "green"
    : a === "Defend"
      ? "brand"
      : a === "Push up" || a === "Improve"
        ? "amber"
        : "slate";

export default function Dashboard() {
  const { sites, add, select } = useSite();
  const [url, setUrl] = useState("");
  const [country, setCountry] = useState("gb");
  const [touched, setTouched] = useState(false);
  const [scope, setScope] = useState<Scope>("world");
  const [maxPages, setMaxPages] = useState(300);
  const [showOpts, setShowOpts] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [hoverCountry, setHoverCountry] = useState<string | null>(null);
  const [ovTab, setOvTab] = useState<"trend" | "pages">("pages");
  const [pgTab, setPgTab] = useState<"pages" | "queries">("pages");
  const [done, setDone] = useState<number[]>([]);
  const [busySite, setBusySite] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SectionInfo[] | null>(null);
  const job = useAnalysis(); // the running check lives outside this page, so it survives opening other pages
  const running = job?.status === "running";
  const busy = loading || running; // opening a saved report, or the background check
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllPlan, setShowAllPlan] = useState(false);
  // store data + website score: loaded together with the website check, not after it
  const [store, setStore] = useState<{ host: string; data: any; err?: string } | null>(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [blOpen, setBlOpen] = useState(false);
  // bumped on every Analyze / Re-run so the backlinks run together with the check
  const [blRun, setBlRun] = useState<{ id: number; force: boolean } | null>(null);
  const storeKey = useRef("");
  const loadStore = async (u: string, rematch = false) => {
    const h = hostOf(u);
    if (!h) return;
    if (!rematch && storeKey.current === h) return; // already loading or loaded for this site
    storeKey.current = h;
    setStoreBusy(true);
    try {
      const r = await fn("mygoogle", { action: "report", url: u, rematch });
      if (storeKey.current === h) setStore({ host: h, data: r });
    } catch (e) {
      if (storeKey.current === h) setStore({ host: h, data: null, err: (e as Error).message });
      storeKey.current = ""; // allow a retry
    }
    setStoreBusy(false);
  };

  const loadSaved = async () => {
    const { data: rows } = await supabase
      .from("research_runs")
      .select("id, host, country, health, created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    const seen = new Set<string>();
    setSaved(
      (rows ?? [])
        .filter((r) => (seen.has(r.host) ? false : (seen.add(r.host), true)))
        .slice(0, 8),
    );
  };
  const loadHistory = async (host: string, c: string) => {
    const { data: rows } = await supabase
      .from("research_runs")
      .select(
        "id, created_at, health, ranked, keywords_checked, rankings:result->rankings",
      )
      .eq("host", host)
      .eq("country", c)
      .order("created_at", { ascending: false })
      .limit(120); // newest 120 checks (enough for monthly view), shown oldest first
    setHistory(
      [...(rows ?? [])].reverse().map((r: any) => {
        const has = Array.isArray(r.rankings);
        const pos: number[] = has
          ? r.rankings
              .filter((x: any) => !x?.error && typeof x?.position === "number")
              .map((x: any) => x.position)
          : [];
        const { rankings: _drop, ...rest } = r;
        const ranks = has
          ? r.rankings
              .filter((x: any) => !x?.error && x?.keyword)
              .map((x: any) => ({
                k: String(x.keyword),
                p: typeof x.position === "number" ? x.position : null,
              }))
          : null;
        return {
          ...rest,
          ranks,
          top3: has ? pos.filter((q) => q <= 3).length : null,
          top10: has ? pos.filter((q) => q <= 10).length : null,
          top30: has ? pos.filter((q) => q <= 30).length : null,
        };
      }),
    );
    setOvTab((rows ?? []).length >= 2 ? "trend" : "pages");
  };
  const show = (r: any) => {
    r = cleanReport(r);
    setData(r);
    setError(null);
    setDone([]);
    if (r.id) localStorage.setItem("lastReport", r.id);
    loadHistory(r.meta.host, r.meta.country);
  };
  const open = async (id: string) => {
    setLoading(true);
    setError(null);
    setProgress("Opening saved report…");
    const { data: row, error: err } = await supabase
      .from("research_runs")
      .select("id, result, created_at")
      .eq("id", id)
      .maybeSingle();
    if (err || !row) {
      localStorage.removeItem("lastReport");
      if (err) setError(err.message);
    } else {
      show({
        ...row.result,
        id: row.id,
        cached: true,
        createdAt: row.created_at,
      });
      setUrl(row.result.meta.url);
      setCountry(row.result.meta.country);
      setScope(row.result.meta.scope === "country" ? "country" : "world");
    }
    setProgress("");
    setLoading(false);
  };
  useEffect(() => {
    if (data?.meta?.url) loadStore(data.meta.url); /* eslint-disable-next-line */
  }, [data?.meta?.host]);
  useEffect(() => {
    loadSaved();
    const j = getJob();
    if (j) {
      // a check is running (or just finished) while the user was on another page: show it again instead of the last saved report
      setUrl(j.params.url);
      setCountry(j.params.country);
      setScope(j.params.scope === "country" ? "country" : "world");
      setMaxPages(j.params.maxPages);
      return;
    }
    const last = localStorage.getItem("lastReport");
    if (last) open(last); /* eslint-disable-next-line */
  }, []);
  // take the result of the background check as soon as it is ready (also if it finished while the user was on another page)
  useEffect(() => {
    if (!job || job.status === "running") return;
    const j = job;
    consumeAnalysis();
    if (j.status === "done") {
      show(j.result);
      setUrl(j.params.url);
      setBlRun({ id: Date.now(), force: j.cached ? false : j.params.force });
      loadSaved();
    } else if (j.status === "cancelled") setNotice("The check was cancelled.");
    else if (j.status === "error") setError(j.error ?? "The check failed.");
    /* eslint-disable-next-line */
  }, [job]);

  const cancelRun = () => cancelAnalysis();

  // ONE button runs everything: crawl, speed, SEO issues, Google rankings, traffic by country, action plan.
  // The work itself runs in lib/analysisRun.ts, so it keeps going when the user opens another page.
  const run = async (force: boolean, e?: FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setError(null);
    setNotice(null);
    setProgress("");
    loadStore(url, force); // runs next to the crawl, so it is ready when the report appears
    startAnalysis({ url, country, scope, maxPages, force });
  };

  // Refresh button inside every card: reload the newest saved check for this site from the database (no full re-crawl, no quota used).
  const refreshLatest = async (): Promise<string | void> => {
    if (!data?.meta) return;
    const { host, country: c } = data.meta;
    const { data: row, error: err } = await supabase
      .from("research_runs")
      .select("id, result, created_at")
      .eq("host", host)
      .eq("country", c)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (err) throw new Error(err.message);
    if (!row) return "No saved data found for this site yet.";
    const same = row.id === data.id;
    setData(
      cleanReport({
        ...row.result,
        id: row.id,
        cached: true,
        createdAt: row.created_at,
      }),
    );
    localStorage.setItem("lastReport", row.id);
    await Promise.all([loadHistory(host, c), loadSaved()]);
    return same
      ? "Reloaded. This is already the newest saved check. Use ⋯ → Re-run full check for brand-new data."
      : "Updated with the newest saved check.";
  };

  const d = data;
  const m = d?.meta;
  const storeNow = store && store.host === m?.host ? store : null;
  const storeScore = storeNow?.data?.score ?? null;
  // the report's own steps and the store improvements in ONE list, most important first
  const planAll: any[] = useMemo(() => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const pr = (t: any) => rank[String(t.priority ?? "medium").toLowerCase()] ?? 1;
    const base = (d?.plan ?? []).map((t: any) => ({ ...t }));
    const extra = (storeScore?.tips ?? []).map((t: any) => ({
      title: t.title,
      why: t.detail,
      action: "",
      priority: t.priority,
      src: "store",
    }));
    return [...base, ...extra]
      .map((t, i) => ({ t, i }))
      .sort((a, b) => pr(a.t) - pr(b.t) || a.i - b.i)
      .map((x) => x.t);
  }, [d, storeScore]);
  const speed = d?.site?.speed;
  const speedDesktop = d?.site?.speedDesktop;
  const speedNotes: string[] = (d?.notes ?? []).filter((n: string) =>
    /speed test/i.test(n),
  );
  const errMobile = publicText(
    speedNotes
      .find((n) => !/^desktop/i.test(n))
      ?.replace(/^Speed test:\s*/i, ""),
  );
  const errDesktop = publicText(
    speedNotes
      .find((n) => /^desktop/i.test(n))
      ?.replace(/^Desktop speed test:\s*/i, ""),
  );
  const field = d?.site?.field;
  const tr = d?.traffic;
  const ga = tr?.own?.ga4;
  const gs = tr?.own?.gsc;
  const est = tr?.seo;
  const mine = d ? sites.find((s) => hostOf(s.url) === m.host) : undefined;
  const bk = useMemo(() => positionBuckets(d), [d]);
  const ct = useMemo(() => countryTraffic(d), [d]);
  const kwRows: any[] = useMemo(
    () =>
      [...(d?.keywordTable ?? [])].sort(
        (a, b) => b.visits - a.visits || b.volume - a.volume,
      ),
    [d],
  );
  const topPages = useMemo(() => {
    if (gs?.pages?.length)
      return gs.pages.slice(0, 10).map((x: any) => ({
        key: x.key,
        title: shortPath(x.key),
        sub: "",
        n: compact(x.clicks),
        unit: "clicks",
      }));
    const by = new Map<string, { url: string; visits: number; kw: number }>();
    kwRows.forEach((k) => {
      if (!k.url) return;
      const e = by.get(k.url) ?? { url: k.url, visits: 0, kw: 0 };
      e.visits += k.visits || 0;
      e.kw++;
      by.set(k.url, e);
    });
    const titles = new Map<string, string>(
      (d?.pages ?? []).map((p: any) => [p.url, p.title]),
    );
    return [...by.values()]
      .sort((a, b) => b.visits - a.visits || b.kw - a.kw)
      .slice(0, 10)
      .map((e) => ({
        key: e.url,
        title: titles.get(e.url) || shortPath(e.url),
        sub: shortPath(e.url),
        n: e.visits > 0 ? compact(e.visits) : String(e.kw),
        unit: e.visits > 0 ? "visits" : "keywords",
      }));
  }, [d, gs, kwRows]);
  const maxVisits = useMemo(
    () => Math.max(...kwRows.map((k) => k.visits || 0), 1),
    [kwRows],
  );
  const scoreBuckets = useMemo(() => {
    const pages: any[] = d?.pages ?? [];
    const b = [
      { name: "0–49", n: 0, c: "#dc2626" },
      { name: "50–69", n: 0, c: "#d97706" },
      { name: "70–89", n: 0, c: "#3b82f6" },
      { name: "90–100", n: 0, c: "#16a34a" },
    ];
    pages.forEach((p) => {
      b[p.score >= 90 ? 3 : p.score >= 70 ? 2 : p.score >= 50 ? 1 : 0].n++;
    });
    return b;
  }, [d]);
  const healthDelta =
    history.length > 1 && history[history.length - 2].health
      ? ((history[history.length - 1].health ?? 0) -
          history[history.length - 2].health) /
        history[history.length - 2].health
      : null;
  const trend = history.map((h) => ({
    date: new Date(h.created_at).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    }),
    health: h.health ?? 0,
    ranked: h.ranked ?? 0,
  }));
  const daily = useMemo(() => {
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
  }, [ga, gs]);

  const kpis: {
    label: string;
    value: string;
    sub?: string;
    delta?: number | null;
  }[] = [];
  if (ga) {
    kpis.push({
      label: "Visits",
      value: compact(ga.totals.sessions),
      delta: halfDelta((ga.daily ?? []).map((x: any) => x.sessions)),
      sub: "30 days",
    });
    kpis.push({
      label: "Visitors",
      value: compact(ga.totals.users),
      sub: `${compact(ga.totals.newUsers)} new`,
    });
    kpis.push({
      label: "Engaged visits",
      value: compact(ga.totals.engagedSessions),
      sub: `${Math.round(ga.totals.engagementRate * 100)}% engaged`,
    });
  }
  if (gs) {
    kpis.push({
      label: "Search clicks",
      value: compact(gs.totals.clicks),
      delta: halfDelta((gs.daily ?? []).map((x: any) => x.clicks)),
      sub: `${compact(gs.totals.impressions)} impressions`,
    });
    kpis.push({
      label: "Avg. position",
      value: gs.totals.position ? gs.totals.position.toFixed(1) : "–",
      sub: `CTR ${(gs.totals.ctr * 100).toFixed(1)}%`,
    });
  }
  if (!ga && !gs && est) {
    kpis.push({
      label: "Organic visits / month",
      value: est.organic.mid > 0 ? compact(est.organic.mid) : "Very low",
      sub:
        est.organic.mid > 0
          ? `Range ${compact(est.organic.low)} – ${compact(est.organic.high)}`
          : "Not ranking yet",
    });
    kpis.push({
      label: "Total visits / month",
      value:
        est.organic.mid > 0
          ? `${compact(est.allSources.low)}–${compact(est.allSources.high)}`
          : "–",
      sub: "All traffic sources",
    });
    kpis.push({
      label: "Keywords ranking",
      value: `${est.keywordsRanking} / ${est.keywordsChecked}`,
      sub: `top ${est.depth} in Google ${est.gl.toUpperCase()}`,
    });
    kpis.push({
      label: "Growth potential",
      value: est.potential ? `+${compact(est.potential.top3)}` : "–",
      sub: "extra visits / month at top 3",
    });
    kpis.push({
      label: "Global rank",
      value: d.site.tranco ? `#${compact(d.site.tranco)}` : "Outside top 1M",
      sub: d.site.tranco ? "among the top 1M sites" : "smaller site",
    });
  }

  // "Download All": opens a list of sections, then builds one PDF from the ticked ones.
  const downloadAll = () => {
    if (reportRef.current) setDialog(listSections(reportRef.current));
  };
  const confirmExport = async (ids: number[], toc: boolean) => {
    if (!reportRef.current || !m) return;
    setDialog(null);
    setError(null);
    setExporting("Preparing PDF…");
    try {
      await new Promise((r) => setTimeout(r, 150));
      await exportReport(reportRef.current, m.host, {
        include: ids,
        toc,
        onProgress: (done, total) =>
          setExporting(`Building PDF… ${done}/${total}`),
      });
    } catch {
      setError("The PDF could not be created. Please try again.");
    }
    setExporting(null);
  };

  const saveSite = async () => {
    setBusySite(true);
    try {
      const s = await add(m.url);
      select(s.id);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusySite(false);
  };
  const createTask = async (t: any, i: number) => {
    if (!mine) return;
    const { error: err } = await supabase.from("tasks").insert({
      website_id: mine.id,
      title: t.action || t.title,
      description: `${t.title}\n${t.why}`,
      priority: t.priority ?? "medium",
      source: "ai",
    });
    if (err) setError(err.message);
    else setDone((x) => [...x, i]);
  };

  const sev = d
    ? [
        { name: "High", value: d.severity.high, c: "#dc2626" },
        { name: "Medium", value: d.severity.medium, c: "#d97706" },
        { name: "Low", value: d.severity.low, c: "#94a3b8" },
      ]
    : [];
  const sevTotal = sev.reduce((a, s) => a + s.value, 0);
  const makeVitals = (sp: any, inp: number | null | undefined) => {
    const vit = sp?.vitals;
    return [
      {
        name: "Largest Contentful Paint",
        text: vit?.lcp != null ? `${(vit.lcp / 1000).toFixed(1)} s` : "–",
        t: rate(vit?.lcp, 2500, 4000),
      },
      {
        name: "Cumulative Layout Shift",
        text: vit?.cls != null ? vit.cls.toFixed(2) : "–",
        t: rate(vit?.cls, 0.1, 0.25),
      },
      {
        name: "Total Blocking Time",
        text: vit?.tbt != null ? `${Math.round(vit.tbt)} ms` : "–",
        t: rate(vit?.tbt, 200, 600),
      },
      {
        name: "Interaction (real users, INP)",
        text: inp != null ? `${inp} ms` : "–",
        t: rate(inp, 200, 500),
      },
    ];
  };
  const vitals = d ? makeVitals(speed, field?.inp) : [];
  const vitalsDesktop = d
    ? makeVitals(speedDesktop, speedDesktop?.field?.inp)
    : [];
  const worstPages = useMemo(
    () =>
      [...(d?.pages ?? [])]
        .sort((a: any, b: any) => a.score - b.score)
        .slice(0, 8),
    [d],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumbs />
          <h1 className="text-2xl font-medium tracking-tight sm:text-[30px]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {d ? (
              <>
                {m.host} · checked {when(d.createdAt ?? m.checkedAt)} ·{" "}
                {m.pagesCrawled} pages crawled
                {d.cached ? " · saved report" : ""}
              </>
            ) : (
              "Enter a website once. Speed, SEO, rankings and traffic by country all come from this one page."
            )}
          </p>
        </div>
        {d && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn"
              disabled={busy || !!exporting}
              onClick={downloadAll}
              title="Download the full report as one PDF"
            >
              {exporting ? <Spinner /> : <Download className="h-4 w-4" />}{" "}
              {exporting ?? "Download All"}
            </button>
            {!mine && (
              <button
                className="btn-ghost"
                onClick={saveSite}
                disabled={busySite}
              >
                {busySite ? <Spinner /> : <Plus className="h-4 w-4" />} Add to
                my websites
              </button>
            )}
            {mine && (
              <Link to="/integrations" className="btn-ghost">
                Connect Google for real traffic
              </Link>
            )}
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => run(true)}
            >
              <RefreshCw className="h-4 w-4" /> Re-run with fresh data
            </button>
          </div>
        )}
      </div>

      {/* the only place a website address is typed */}
      <form onSubmit={(e) => run(false, e)} className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded bg-slate-100 px-3 dark:bg-slate-800">
            <Globe className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              className="w-full bg-transparent py-2.5 text-sm outline-none"
              placeholder="example.com or https://example.com"
              aria-label="Website address"
              value={url}
              disabled={busy}
              onChange={(e) => {
                setUrl(e.target.value);
                if (!touched) setCountry(guessCountry(e.target.value));
              }}
            />
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowOpts((v) => !v)}
            aria-expanded={showOpts}
          >
            <SlidersHorizontal className="h-4 w-4" /> Options
          </button>
          <button className="btn !py-2.5" disabled={busy || !url.trim()}>
            {busy && <Spinner />} Analyze
          </button>
          {busy && running && (
            <button
              type="button"
              className="btn-ghost !py-2.5"
              onClick={cancelRun}
            >
              Cancel
            </button>
          )}
        </div>
        {showOpts && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-500">
              Main Google country
              <Select
                className="input mt-1"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setTouched(true);
                }}
              >
                {COUNTRIES.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Traffic map coverage
              <Select
                className="input mt-1"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
              >
                <option value="world">Worldwide (top 6 markets)</option>
                <option value="country">This country only (cheaper)</option>
              </Select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Pages to crawl
              <Select
                className="input mt-1"
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
              >
                {[100, 300, 500, 1000].map((n) => (
                  <option key={n} value={n}>
                    Up to {n} pages
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
        {saved.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-500">Recent:</span>
            {saved.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => open(s.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {s.host}{" "}
                <span
                  className="font-bold"
                  style={{ color: healthColor(s.health) }}
                >
                  {s.health ?? "–"}
                </span>
              </button>
            ))}
          </div>
        )}
      </form>

      <ErrorNote message={error} />
      {notice && !busy && (
        <div className="card flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span>{notice}</span>
          <button
            type="button"
            className="btn-ghost !py-1 text-xs"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {dialog && (
        <ExportDialog
          sections={dialog}
          onClose={() => setDialog(null)}
          onConfirm={confirmExport}
        />
      )}

      {/* the results area: while a check runs, the loading panel sits on top of it (blurred), not over the whole screen */}
      <div className={`relative ${busy ? "min-h-[520px]" : ""}`}>
        {busy && (
          <AnalyzingOverlay
            progress={running ? job!.progress : progress}
            percent={running ? job!.percent : undefined}
            onCancel={running ? cancelRun : undefined}
          />
        )}
      {!d && !busy && (
        <div className="card grid place-items-center gap-3 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40">
            <Globe className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-medium">Paste a website to start</h2>
          <p className="max-w-lg text-sm text-slate-500 dark:text-slate-400">
            One check gives you site health, speed, SEO issues, Google rankings,
            keyword difficulty, traffic by country on a world map and an action
            plan.
          </p>
        </div>
      )}

      {d && (
        <div ref={reportRef} className="space-y-5">
          {/* ---------------- domain authority + keyword research ---------------- */}
          <DomainOverview d={d} store={storeScore} />

          {/* ---------------- your own Google Analytics + Search Console, matched automatically for any site ---------------- */}
          <div
            className={`grid items-stretch gap-5 ${storeOpen || blOpen ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))]"}`}
          >
            <MyGoogleData
              url={m.url}
              host={m.host}
              data={storeNow?.data ?? null}
              busy={storeBusy && !storeNow}
              error={storeNow?.err ?? null}
              onReload={() => loadStore(m.url, true)}
              refreshing={storeBusy}
              open={storeOpen}
              onOpenChange={setStoreOpen}
            />
            <BacklinksPanel
              url={m.url}
              host={m.host}
              crawl={d.links}
              open={blOpen}
              onOpenChange={setBlOpen}
              trigger={blRun}
            />
          </div>

          {/* ---------------- 1. Position tracking ---------------- */}
          <Panel
            title="Keyword Research & Position Tracking"
            sub={`Google ${m.country.toUpperCase()} · top ${m.depth} checked · ${bk.checked} keywords`}
            className="!p-0"
            flush
            right={
              <span className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {d.cached ? "Saved check" : "Latest check"} ·{" "}
                {when(d.createdAt ?? m.checkedAt)}
              </span>
            }
          >
            <div className="grid gap-0 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] xl:divide-x divide-slate-100 dark:divide-slate-800">
              <div className="p-5">
                <div className="mb-3 text-xs font-semibold text-slate-500">
                  Keywords
                </div>
                {m.serperUsed ? (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                    {(() => {
                      const withR = history.filter((h) => h.top3 != null);
                      const ser = (k: string) =>
                        withR.length > 1
                          ? withR.map((h) => Number(h[k] ?? 0))
                          : [];
                      const dl = (a: number[]) =>
                        a.length > 1 ? a[a.length - 1] - a[a.length - 2] : null;
                      const posList: number[] = (d?.rankings ?? [])
                        .filter(
                          (r: any) =>
                            !r.error && typeof r.position === "number",
                        )
                        .map((r: any) => r.position);
                      const curve = (n: number) =>
                        Array.from(
                          { length: Math.max(2, n) },
                          (_, i) => posList.filter((q) => q <= i + 1).length,
                        );
                      const depth = Math.min(Number(m.depth) || 30, 100);
                      const hr = history.map((h) => Number(h.ranked ?? 0));
                      const pick = (key: string, n: number) => {
                        const s1 = ser(key);
                        return s1.length > 1
                          ? { s: s1, h: "Change between your saved checks" }
                          : {
                              s: curve(n),
                              h: `Keywords ranking at or above each position, 1 to ${n} (this check)`,
                            };
                      };
                      const rows = [
                        {
                          l: "Top 3",
                          v: bk.top3,
                          c: "#16a34a",
                          key: "top3",
                          n: 3,
                        },
                        {
                          l: "Top 10",
                          v: bk.top10,
                          c: "#3b82f6",
                          key: "top10",
                          n: 10,
                        },
                        {
                          l: "Top 30",
                          v: bk.top30,
                          c: "#6c47ff",
                          key: "top30",
                          n: 30,
                        },
                      ].map((k) => {
                        const pk = pick(k.key, k.n);
                        return {
                          ...k,
                          s: pk.s,
                          h: pk.h,
                          dl: ser(k.key).length > 1 ? dl(ser(k.key)) : null,
                        };
                      });
                      const rk =
                        hr.length > 1
                          ? { s: hr, h: "Change between your saved checks" }
                          : {
                              s: curve(depth),
                              h: `Keywords ranking at or above each position, 1 to ${depth} (this check)`,
                            };
                      return [
                        ...rows,
                        {
                          l: "Ranking",
                          v: bk.ranked,
                          c: "#64748b",
                          key: "r",
                          n: depth,
                          s: rk.s,
                          h: rk.h,
                          dl: hr.length > 1 ? dl(hr) : null,
                        },
                      ].map((k) => (
                        <StatTile
                          key={k.l}
                          label={k.l}
                          value={k.v}
                          max={Math.max(bk.checked, 1)}
                          color={k.c}
                          delta={k.dl}
                          spark={k.s}
                          hint={k.h}
                        />
                      ));
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Keyword rankings are not available for this check. Press
                    “Re-run with fresh data” to try again.
                  </p>
                )}
              </div>
              <div className="min-w-0 p-5">
                <div className="mb-2 text-xs font-semibold text-slate-500">
                  Top keywords
                </div>
                {kwRows.length ? (
                  <div className="scroll-thin max-h-[290px] overflow-auto">
                    <table className="w-full min-w-[520px] text-left">
                      <thead className="sticky top-0 bg-white dark:bg-slate-900">
                        <tr>
                          <th className="th !pl-0">Keyword</th>
                          <th className="th">Volume*</th>
                          <th className="th">KD %*</th>
                          <th className="th">Position</th>
                          <th className="th min-w-[130px]">Traffic*</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kwRows.slice(0, 15).map((k) => (
                          <tr
                            key={k.keyword}
                            className="border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                            title={k.url ?? ""}
                          >
                            <td className="td !pl-0 max-w-[200px] truncate">
                              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                                {k.keyword}
                              </span>
                            </td>
                            <td className="td font-semibold">
                              {compact(k.volume)}
                            </td>
                            <td className="td">
                              <Dot color={kdColor(k.kd)} />
                              <span className="font-semibold">
                                {k.kd ?? "–"}
                              </span>
                            </td>
                            <td className="td">
                              {k.position ? (
                                <Badge tone={posTone(k.position) as any}>
                                  {k.position}
                                </Badge>
                              ) : (
                                <span className="text-slate-400">–</span>
                              )}
                            </td>
                            <td className="td">
                              <div className="flex items-center gap-2">
                                <span className="w-9 shrink-0 text-xs font-semibold">
                                  {k.visits > 0 ? compact(k.visits) : "–"}
                                </span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    className="h-full rounded-full bg-[#6c47ff]"
                                    style={{
                                      width: `${k.visits > 0 ? Math.max(4, (k.visits / maxVisits) * 100) : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No keyword data for this run.
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  *Approximate figures based on live Google positions.
                </p>
              </div>
            </div>
          </Panel>

          <CassieBoard
            speed={speed}
            vitals={vitals}
            speedDesktop={speedDesktop}
            vitalsDesktop={vitalsDesktop}
            errMobile={errMobile}
            errDesktop={errDesktop}
            kpis={kpis}
            d={d}
            siteId={mine?.id}
            history={history}
            kwRows={kwRows}
            ct={ct}
            bk={bk}
            sev={sev}
            scoreBuckets={scoreBuckets}
            trend={trend}
            daily={daily}
            ga={ga}
            gs={gs}
            est={est}
            onRefresh={refreshLatest}
            onRerun={() => run(true)}
          />

          <h2 className="pt-2 text-lg font-medium">Detailed analysis</h2>

          {/* ---------------- 4b. compete: head-to-head + keyword tracker ---------------- */}
          <div className="grid gap-5 xl:grid-cols-2">
            <HeadToHead d={d} />
            <KeywordTracker d={d} history={history} />
          </div>

          {/* ---------------- 5. action plan + pages ---------------- */}
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              title="Action plan"
              sub="Recommended next steps based on this report and the store checks"
              right={
                storeScore && (
                  <span
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold dark:bg-slate-800"
                    style={{ color: healthColor(storeScore.score) }}
                  >
                    Website score {storeScore.score}/100
                  </span>
                )
              }
            >
              {planAll.length === 0 && (
                <p className="text-sm text-slate-500">
                  No action plan is available for this report yet. Press “Re-run
                  with fresh data” to create one.
                </p>
              )}
              <ul className="space-y-3">
                {(showAllPlan ? planAll : planAll.slice(0, 6)).map((t: any, i: number) => (
                  <li
                    key={i}
                    className="rounded-xl border border-slate-200 p-3 transition hover:border-brand-300 dark:border-slate-800"
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={priorityTone(t.priority)}>
                          {t.priority}
                        </Badge>
                        <h3 className="text-sm font-semibold">{t.title}</h3>
                        {t.src === "store" && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-800">
                            Store
                          </span>
                        )}
                      </div>
                      {mine && (
                        <button
                          className="btn-ghost !py-1 text-xs"
                          disabled={done.includes(i)}
                          onClick={() => createTask(t, i)}
                        >
                          <ListPlus className="h-3.5 w-3.5" />{" "}
                          {done.includes(i) ? "Task added" : "Create task"}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {t.why}
                    </p>
                    {t.action && (
                      <p className="mt-1.5 text-xs">
                        <b>Do this: </b>
                        {t.action}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {planAll.length > 6 && (
                <button
                  className="mt-3 text-xs font-medium text-brand-600 underline"
                  onClick={() => setShowAllPlan(!showAllPlan)}
                >
                  {showAllPlan ? "Show fewer steps" : `Show all ${planAll.length} steps`}
                </button>
              )}
            </Panel>

            <Panel
              title={gs ? "Top pages & searches" : "Pages that need attention"}
              right={
                gs && (
                  <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
                    {(
                      [
                        ["pages", "Pages"],
                        ["queries", "Searches"],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        onClick={() => setPgTab(k)}
                        className={`rounded-md px-2.5 py-1 ${pgTab === k ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )
              }
            >
              <div className="scroll-thin max-h-[420px] overflow-auto">
                {gs ? (
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="th !pl-0">
                          {pgTab === "pages" ? "Page" : "Search"}
                        </th>
                        <th className="th">Clicks</th>
                        <th className="th">Impr.</th>
                        <th className="th">Pos.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pgTab === "pages" ? gs.pages : gs.queries).map(
                        (x: any) => (
                          <tr
                            key={x.key}
                            className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                            title={x.key}
                          >
                            <td className="td !pl-0 max-w-[240px] truncate">
                              {pgTab === "pages" && /^https?:\/\//i.test(x.key) ? (
                                <a
                                  href={x.key}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-600 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-brand-400"
                                  title={`Open ${x.key}`}
                                >
                                  {shortPath(x.key)}
                                </a>
                              ) : pgTab === "pages" ? (
                                shortPath(x.key)
                              ) : (
                                x.key
                              )}
                            </td>
                            <td className="td font-semibold">
                              {compact(x.clicks)}
                            </td>
                            <td className="td">{compact(x.impressions)}</td>
                            <td className="td">{x.position?.toFixed(1)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="th !pl-0">Page</th>
                        <th className="th">Score</th>
                        <th className="th">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worstPages.map((p: any) => (
                        <tr
                          key={p.url}
                          className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                          title={p.issues
                            .map((i: any) => i.label ?? i.id ?? i)
                            .join(", ")}
                        >
                          <td className="td !pl-0 max-w-[260px] truncate">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-600 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-brand-400"
                              title={`Open ${p.url}`}
                            >
                              {shortPath(p.url)}
                            </a>
                          </td>
                          <td
                            className="td font-bold"
                            style={{ color: healthColor(p.score) }}
                          >
                            {p.score}
                          </td>
                          <td className="td">{p.issues.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Panel>
          </div>

          {d.notes.length > 0 && (
            <p className="text-xs text-slate-500">
              Some checks could not be completed:{" "}
              {publicText(d.notes.join(" · "))}
            </p>
          )}
          <p className="text-xs text-slate-400">
            Figures for websites that are not connected to Google Analytics and
            Search Console are approximate.
          </p>
        </div>
      )}
      </div>
    </div>
  );
}