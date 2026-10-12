import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/Auth";
import { Badge, Empty, ErrorNote, PageHeader, Spinner } from "../components/ui";

type UserRow = {
  email: string;
  role: string;
  last_login: string | null;
  last_activity: string | null;
  commands: number;
};
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

export default function Admin() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase.rpc("admin_user_summary");
    if (error) setError(error.message);
    else setUsers((data ?? []) as UserRow[]);
  }, []);

  const loadLogs = useCallback(async (email: string) => {
    setLogs(null);
    setError(null);
    const { data, error } = await supabase
      .from("activity_log")
      .select("id,action,request,ok,duration_ms,created_at") // no response data: boxes only
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) setError(error.message);
    setLogs((data ?? []) as LogRow[]);
  }, []);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  const groups = useMemo(() => (logs ? group(logs) : []), [logs]);

  if (!isAdmin) return null;

  const refresh = () => (picked ? loadLogs(picked) : loadUsers());
  const failed = logs ? logs.filter((l) => !l.ok).length : 0;

  return (
    <>
      <PageHeader
        title={picked ?? "Admin"}
        sub={picked ? "Which commands this user ran, how many times, and when. Tap a box for the run times." : "Who signed in with which email. Tap a person to see what they ran."}
      >
        <div className="flex gap-2">
          {picked && (
            <button
              onClick={() => {
                setPicked(null);
                setLogs(null);
                loadUsers();
              }}
              className="flex h-9 items-center gap-1.5 rounded-full border border-brand-100 bg-white px-3.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" /> All users
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
          <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <li key={u.email}>
                <button
                  onClick={() => {
                    setPicked(u.email);
                    loadLogs(u.email);
                  }}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left transition hover:bg-brand-50/60 dark:hover:bg-slate-800/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span className="truncate">{u.email}</span>
                      {u.role === "admin" && <Badge tone="brand">Admin</Badge>}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Last sign-in: {when(u.last_login)}
                    </span>
                  </span>
                  <span className="text-right text-xs text-slate-500 dark:text-slate-400">
                    <b className="num block text-sm text-slate-800 dark:text-slate-100">{u.commands}</b>
                    commands
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : logs === null ? (
        <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>
      ) : logs.length === 0 ? (
        <Empty title="Nothing yet" text="This user has not run any command yet." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat title="Total commands" value={logs.length} sub={logs.length >= LIMIT ? `latest ${LIMIT} shown` : undefined} />
            <Stat title="Different commands" value={groups.length} />
            <Stat title="Failed" value={failed} />
            <Stat title="Last active" value={when(logs[0].created_at)} />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <CommandBox key={g.action} g={g} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}