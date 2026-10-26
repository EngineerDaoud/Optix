import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, Globe, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/Auth";
import { findCountry, flag } from "../lib/countries";
import { Badge, Empty, ErrorNote, PageHeader, Spinner } from "../components/ui";

type UserRow = {
  email: string;
  name: string;
  role: string;
  last_login: string | null;
  last_activity: string | null;
  commands: number;
  websites: number;
  runs: number;
  keyword_checks: number;
  unique_keywords: number;
  last_run: string | null;
};
type SiteRow = {
  host: string;
  country: string;
  runs: number;
  first_run: string;
  last_run: string;
  health: number | null;
  ranked: number | null;
  keywords_checked: number | null;
  keyword_checks: number;
  unique_keywords: number;
};
type RunRow = {
  id: string;
  created_at: string;
  country: string;
  depth: number;
  health: number | null;
  ranked: number | null;
  keywords_checked: number | null;
  response_ms: number | null;
  http_status: number | null;
};
type BankCountry = {
  country: string;
  universe: number;
  bank: number;
  with_volume: number;
  serp_rows: number;
  domains: number;
  sites: number;
  ranking: number;
  top3: number;
  top10: number;
};
type Bank = {
  totals: {
    universe: number;
    bank: number;
    with_volume: number;
    with_gsc: number;
    serps: number;
    serp_rows: number;
    domains: number;
    links: number;
    runs: number;
  };
  countries: BankCountry[];
};
type KwRow = { keyword: string; rank_position: number | null; url: string | null };
type LogRow = {
  id: number;
  action: string;
  request: string | null;
  ok: boolean;
  duration_ms: number | null;
  created_at: string;
};

const LIMIT = 2000;

// friendly names for the edge functions
const LABELS: Record<string, string> = {
  backlinks: "Backlinks",
  mygoogle: "My Google data",
  research: "Research",
  keywordlab: "Keyword Lab",
  crawl: "Site crawl",
  audit: "Audit",
  overview: "Domain overview",
  competitor: "Competitor traffic",
  sitetraffic: "Site traffic",
  report: "Report",
  insights: "Insights",
  sync: "Sync",
  google: "Google",
  scheduled: "Scheduled run",
  gaprovision: "GA provision",
};
const label = (a: string) => LABELS[a] ?? a;

const when = (d: string | null) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Never";

const secs = (ms: number | null) => (ms == null ? "" : `${(ms / 1000).toFixed(1)}s`);

/** the website / keyword the command was run for (so you see what, not the raw data) */
function target(req: string | null): string {
  if (!req) return "";
  try {
    const j = JSON.parse(req);
    const v = j?.url ?? j?.domain ?? j?.host ?? j?.site ?? j?.keyword ?? j?.query ?? j?.q;
    return typeof v === "string" ? v.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

type Group = {
  action: string;
  total: number;
  today: number;
  failed: number;
  avgMs: number | null;
  last: string;
  runs: LogRow[];
};

function group(logs: LogRow[]): Group[] {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const map = new Map<string, Group>();
  for (const l of logs) {
    // logs arrive newest first, so the first one seen is the last run
    let g = map.get(l.action);
    if (!g) {
      g = { action: l.action, total: 0, today: 0, failed: 0, avgMs: null, last: l.created_at, runs: [] };
      map.set(l.action, g);
    }
    g.total++;
    if (!l.ok) g.failed++;
    if (new Date(l.created_at) >= startOfDay) g.today++;
    g.runs.push(l);
  }
  for (const g of map.values()) {
    const t = g.runs.map((r) => r.duration_ms).filter((x): x is number => x != null);
    g.avgMs = t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function Stat({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      <p className="num mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function CommandBox({ g }: { g: Group }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card !p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full p-4 text-left transition hover:bg-brand-50/60 dark:hover:bg-slate-800/60"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{label(g.action)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Last run: {when(g.last)}</p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        <div className="mt-3 flex items-end gap-5">
          <div>
            <b className="num block text-3xl font-semibold leading-none">{g.total}</b>
            <span className="text-xs text-slate-500 dark:text-slate-400">times run</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <b className="num block text-sm text-slate-800 dark:text-slate-100">{g.today}</b>today
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <b className={`num block text-sm ${g.failed ? "text-red-600" : "text-slate-800 dark:text-slate-100"}`}>{g.failed}</b>failed
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <b className="num block text-sm text-slate-800 dark:text-slate-100">{g.avgMs == null ? "–" : secs(g.avgMs)}</b>avg time
          </div>
        </div>
      </button>
      {open && (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-auto border-t border-slate-100 px-4 dark:divide-slate-800 dark:border-slate-800">
          {g.runs.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 py-2 text-xs">
              {r.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Worked" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Failed" />
              )}
              <span className="num shrink-0">{when(r.created_at)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{target(r.request)}</span>
              <span className="num shrink-0 text-slate-500 dark:text-slate-400">{secs(r.duration_ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** name to show on the box: saved name, else made from the email ("ali.khan55@x.com" -> "Ali Khan") */
function niceName(u: { name: string; email: string }): string {
  if (u.name) return u.name;
  const base = u.email.split("@")[0].replace(/[0-9]+/g, " ").replace(/[._-]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : u.email;
}

const scoreTone = (h: number | null) => (h == null ? "slate" : h >= 80 ? "green" : h >= 50 ? "amber" : "red");

function UserBox({ u, onOpen }: { u: UserRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card w-full text-left transition hover:bg-brand-50/60 dark:hover:bg-slate-800/60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{niceName(u)}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
        </div>
        {u.role === "admin" && <Badge tone="brand">Admin</Badge>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <b className="num block text-2xl font-semibold leading-none">{u.websites}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">websites</span>
        </div>
        <div>
          <b className="num block text-2xl font-semibold leading-none">{u.unique_keywords}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">keywords</span>
        </div>
        <div>
          <b className="num block text-2xl font-semibold leading-none">{u.runs}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">runs</span>
        </div>
      </div>
      <div className="mt-3 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
        <p>Last run: {when(u.last_run)}</p>
        <p>Last sign-in: {when(u.last_login)}</p>
        <p>{u.commands} commands</p>
      </div>
    </button>
  );
}

function SiteBox({ s, onOpen }: { s: SiteRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card w-full text-left transition hover:bg-brand-50/60 dark:hover:bg-slate-800/60">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-slate-400" />
          <p className="truncate text-sm font-semibold">{s.host}</p>
        </div>
        <Badge tone={scoreTone(s.health)}>{s.health == null ? "no score" : `Score ${s.health}`}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <b className="num block text-2xl font-semibold leading-none">{s.runs}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">runs</span>
        </div>
        <div>
          <b className="num block text-2xl font-semibold leading-none">{s.unique_keywords}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">keywords</span>
        </div>
        <div>
          <b className="num block text-2xl font-semibold leading-none">{s.ranked ?? "–"}</b>
          <span className="text-xs text-slate-500 dark:text-slate-400">ranking</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Last run: {when(s.last_run)} · {s.country?.toUpperCase()}
      </p>
    </button>
  );
}

function RunBox({
  r,
  kws,
  onOpen,
}: {
  r: RunRow;
  kws: KwRow[] | "loading" | undefined;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card !p-0 overflow-hidden">
      <button
        onClick={() => {
          if (!open && kws === undefined) onOpen();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="w-full p-4 text-left transition hover:bg-brand-50/60 dark:hover:bg-slate-800/60"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="num text-sm font-semibold">{when(r.created_at)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Country {r.country?.toUpperCase()} · depth {r.depth}
              {r.http_status ? ` · HTTP ${r.http_status}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={scoreTone(r.health)}>{r.health == null ? "no score" : `Score ${r.health}`}</Badge>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </div>
        <div className="mt-3 flex items-end gap-6">
          <div>
            <b className="num block text-2xl font-semibold leading-none">{r.keywords_checked ?? 0}</b>
            <span className="text-xs text-slate-500 dark:text-slate-400">keywords checked</span>
          </div>
          <div>
            <b className="num block text-2xl font-semibold leading-none">{r.ranked ?? 0}</b>
            <span className="text-xs text-slate-500 dark:text-slate-400">site ranks for</span>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800">
          {kws === undefined || kws === "loading" ? (
            <div className="grid h-20 place-items-center"><Spinner className="h-5 w-5" /></div>
          ) : kws.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">No keywords saved for this run.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-auto px-4 dark:divide-slate-800">
              {kws.map((k, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{k.keyword}</span>
                  <span className="num w-20 shrink-0 text-right text-slate-500 dark:text-slate-400">
                    {k.rank_position == null ? "not in top" : `#${k.rank_position}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();

function BankPanel({ bank }: { bank: Bank }) {
  const t = bank.totals;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold">Data collected so far (whole database)</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat title="Keywords found" value={fmt(t.universe)} sub="every keyword the tool has seen" />
        <Stat title="With full data" value={fmt(t.bank)} sub="volume, difficulty, intent saved" />
        <Stat title="With search volume" value={fmt(t.with_volume)} />
        <Stat title="Google results saved" value={fmt(t.serps)} sub={`${fmt(t.serp_rows)} ranking rows`} />
        <Stat title="Domains seen ranking" value={fmt(t.domains)} />
        <Stat title="Backlinks saved" value={fmt(t.links)} sub={`${fmt(t.runs)} site runs`} />
      </div>
      <div className="card mt-3 !p-0 overflow-hidden">
        <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Country wise
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-slate-500 dark:text-slate-400">
              <tr>
                {["Country", "Keywords found", "With full data", "Google results", "Sites tracked", "Ranking keywords", "Top 3", "Top 10"].map((h, i) => (
                  <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {bank.countries.map((c) => {
                const info = findCountry(c.country);
                return (
                  <tr key={c.country}>
                    <td className="px-4 py-2 font-medium">
                      {info ? `${flag(info.a2)} ${info.name}` : c.country.toUpperCase()}
                    </td>
                    <td className="num px-4 py-2 text-right">{fmt(c.universe)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.bank)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.serp_rows)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.sites)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.ranking)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.top3)}</td>
                    <td className="num px-4 py-2 text-right">{fmt(c.top10)}</td>
                  </tr>
                );
              })}
              {bank.countries.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-3 text-slate-500">Nothing saved yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-3 pt-2 text-xs text-slate-500 dark:text-slate-400">
          Sites tracked, ranking keywords, Top 3 and Top 10 come from the latest run of each user's website in that country.
        </p>
      </div>
    </section>
  );
}

export default function Admin() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [picked, setPicked] = useState<UserRow | null>(null);
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [site, setSite] = useState<SiteRow | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [kwCache, setKwCache] = useState<Record<string, KwRow[] | "loading">>({});
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setError(null);
    const [u, b] = await Promise.all([supabase.rpc("admin_user_usage"), supabase.rpc("admin_bank_overview")]);
    if (u.error) setError(u.error.message);
    else setUsers((u.data ?? []) as UserRow[]);
    if (b.error) setError((e) => e ?? `Data bank: ${b.error.message}`);
    else setBank(b.data as Bank);
  }, []);

  const loadUser = useCallback(async (email: string) => {
    setSites(null);
    setLogs(null);
    setError(null);
    const [s, l] = await Promise.all([
      supabase.rpc("admin_user_sites", { p_email: email }),
      supabase
        .from("activity_log")
        .select("id,action,request,ok,duration_ms,created_at") // no response data: boxes only
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
    ]);
    if (s.error) setError(s.error.message);
    else if (l.error) setError(l.error.message);
    setSites((s.data ?? []) as SiteRow[]);
    setLogs((l.data ?? []) as LogRow[]);
  }, []);

  const loadRuns = useCallback(async (email: string, host: string) => {
    setRuns(null);
    setError(null);
    const { data, error } = await supabase.rpc("admin_site_runs", { p_email: email, p_host: host });
    if (error) setError(error.message);
    setRuns((data ?? []) as RunRow[]);
  }, []);

  const loadKeywords = useCallback(async (runId: string) => {
    setKwCache((c) => ({ ...c, [runId]: "loading" }));
    const { data, error } = await supabase.rpc("admin_run_keywords", { p_run_id: runId });
    if (error) setError(error.message);
    setKwCache((c) => ({ ...c, [runId]: (data ?? []) as KwRow[] }));
  }, []);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  const groups = useMemo(() => (logs ? group(logs) : []), [logs]);

  if (!isAdmin) return null;

  const refresh = () => {
    if (picked && site) return loadRuns(picked.email, site.host);
    if (picked) return loadUser(picked.email);
    return loadUsers();
  };
  const back = () => {
    if (site) {
      setSite(null);
      setRuns(null);
    } else {
      setPicked(null);
      setSites(null);
      setLogs(null);
      loadUsers();
    }
  };
  const failed = logs ? logs.filter((l) => !l.ok).length : 0;

  const title = site ? site.host : picked ? niceName(picked) : "Admin";
  const sub = site
    ? `${picked?.email}: every time this website was run. Tap a run to see the keywords found.`
    : picked
      ? `${picked.email}: websites this user ran, and the commands they used. Tap a website for its runs.`
      : "One box per user: websites run, keywords found, last run. Tap a user to see more.";

  return (
    <>
      <PageHeader title={title} sub={sub}>
        <div className="flex gap-2">
          {picked && (
            <button
              onClick={back}
              className="flex h-9 items-center gap-1.5 rounded-full border border-brand-100 bg-white px-3.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" /> {site ? "Websites" : "All users"}
            </button>
          )}
          <button
            onClick={refresh}
            className="flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-sm font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </PageHeader>
      <ErrorNote message={error} />

      {!picked ? (
        users === null ? (
          <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
          {bank && <BankPanel bank={bank} />}
          <h2 className="mb-2 text-sm font-semibold">Users</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {users.map((u) => (
              <UserBox
                key={u.email}
                u={u}
                onOpen={() => {
                  setPicked(u);
                  loadUser(u.email);
                }}
              />
            ))}
          </div>
          </>
        )
      ) : site ? (
        runs === null ? (
          <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>
        ) : runs.length === 0 ? (
          <Empty title="No runs" text="No saved runs for this website." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {runs.map((r) => (
              <RunBox key={r.id} r={r} kws={kwCache[r.id]} onOpen={() => loadKeywords(r.id)} />
            ))}
          </div>
        )
      ) : sites === null || logs === null ? (
        <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat title="Websites run" value={picked.websites} />
            <Stat title="Total runs" value={picked.runs} />
            <Stat title="Keywords found" value={picked.unique_keywords} sub="different keywords" />
            <Stat title="Keyword checks" value={picked.keyword_checks} sub="all runs added up" />
            <Stat title="Last run" value={when(picked.last_run)} />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Websites</h2>
            {sites.length === 0 ? (
              <Empty title="No websites yet" text="This user has not run any website yet." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sites.map((s) => (
                  <SiteBox
                    key={s.host}
                    s={s}
                    onOpen={() => {
                      setSite(s);
                      loadRuns(picked.email, s.host);
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Commands ({logs.length}
              {failed ? `, ${failed} failed` : ""})
            </h2>
            {logs.length === 0 ? (
              <Empty title="Nothing yet" text="This user has not run any command yet." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groups.map((g) => (
                  <CommandBox key={g.action} g={g} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}