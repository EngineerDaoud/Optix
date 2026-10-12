import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Empty, Spinner } from "../components/ui";
import { compact, healthColor, Panel } from "../components/dash";

type Row = {
  id: string;
  host: string;
  country: string;
  health: number | null;
  ranked: number | null;
  keywords_checked: number | null;
  response_ms: number | null;
  http_status: number | null;
  created_at: string;
};

/** Every website you have analysed, newest check per site. Click a row to open its full report. */
export default function Domains() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    supabase
      .from("research_runs")
      .select(
        "id, host, country, health, ranked, keywords_checked, response_ms, http_status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        const seen = new Set<string>();
        setRows(
          ((data ?? []) as Row[]).filter((r) =>
            seen.has(r.host) ? false : (seen.add(r.host), true),
          ),
        );
      });
  }, []);
  const list = useMemo(
    () => (rows ?? []).filter((r) => r.host.includes(q.trim().toLowerCase())),
    [rows, q],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">My Domains</h1>
        <p className="mt-1 text-sm text-slate-500">
          All websites you have analysed. Click one to see its issues, keywords,
          traffic and domain details.
        </p>
      </div>
      {rows === null ? (
        <div className="card grid place-items-center py-12">
          <Spinner className="h-5 w-5" />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title="No domains yet"
          text="Analyse a website from the Dashboard and it will appear here."
        >
          <Link to="/dashboard" className="btn">
            Go to Dashboard
          </Link>
        </Empty>
      ) : (
        <Panel
          className="!p-0"
          flush
          title="Websites"
          right={
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 dark:bg-slate-800">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                className="w-44 bg-transparent py-1.5 text-xs outline-none"
                placeholder="Search domain"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          }
        >
          <div className="overflow-x-auto pb-3">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr>
                  <th className="th !pl-5">Domain</th>
                  <th className="th">Health</th>
                  <th className="th">Keywords ranking</th>
                  <th className="th">Speed</th>
                  <th className="th">Status</th>
                  <th className="th">Checked</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => {
                      localStorage.setItem("lastReport", r.id);
                      nav("/dashboard");
                    }}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      (localStorage.setItem("lastReport", r.id),
                      nav("/dashboard"))
                    }
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="td !pl-5 font-semibold">
                      {r.host}{" "}
                      <span className="text-xs font-medium uppercase text-slate-400">
                        {r.country}
                      </span>
                    </td>
                    <td className="td w-52">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${r.health ?? 0}%`,
                              background: healthColor(r.health),
                            }}
                          />
                        </div>
                        <b
                          className="w-8 text-xs"
                          style={{ color: healthColor(r.health) }}
                        >
                          {r.health ?? "–"}
                        </b>
                      </div>
                    </td>
                    <td className="td">
                      {r.ranked ?? "–"}
                      <span className="text-xs text-slate-400">
                        {" "}
                        / {r.keywords_checked ?? "–"}
                      </span>
                    </td>
                    <td className="td">
                      {r.response_ms != null
                        ? `${compact(r.response_ms)} ms`
                        : "–"}
                    </td>
                    <td className="td">
                      <span
                        className={`font-semibold ${r.http_status && r.http_status < 400 ? "text-green-600" : "text-red-600"}`}
                      >
                        {r.http_status ?? "–"}
                      </span>
                    </td>
                    <td className="td text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleDateString([], {
                        dateStyle: "medium",
                      })}
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="td text-center text-slate-500">
                      No domain matches “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
