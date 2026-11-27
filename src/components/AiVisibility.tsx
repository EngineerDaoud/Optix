import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, RefreshCw, Sparkles } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { ErrorNote, Spinner } from "./ui";
import { Panel, healthColor } from "./dash";

type EngineRow = {
  id: string;
  label: string;
  note?: string;
  asked: number;
  mentions: number;
  citations: number;
  error?: string | null;
};
type Result = {
  host: string;
  brand: string;
  score: number;
  mentions: number;
  citations: number;
  engines: EngineRow[];
  ranAt?: string;
};

/* ------------------------------------------------------------ small icons */
const GoogleG = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path
      fill="#4285F4"
      d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4-3.1z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43A11.95 11.95 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.86 8.87 4.75 12 4.75z"
    />
  </svg>
);

const ICON: Record<string, JSX.Element> = {
  google: <GoogleG />,
  gemini: <Sparkles className="h-4 w-4 text-[#4f7cf6]" />,
  open: <Aperture className="h-4 w-4 text-slate-800 dark:text-slate-100" />,
  claude: <Sparkles className="h-4 w-4 text-[#d97757]" />,
};
const NAME: Record<string, string> = {
  google: "Google AI",
  gemini: "Gemini",
  open: "ChatGPT",
  claude: "Claude",
};

const when = (s?: string) =>
  s
    ? new Date(s).toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/* ------------------------------------------------------------ half-circle gauge */
function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const col = healthColor(v);
  const d = "M 8 50 A 42 42 0 0 1 92 50";
  return (
    <svg viewBox="0 0 100 56" className="h-[30px] w-[54px]" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth="11"
        strokeLinecap="round"
        pathLength={100}
        className="stroke-slate-200 dark:stroke-slate-700"
      />
      {v > 0 && (
        <path
          d={d}
          fill="none"
          strokeWidth="11"
          strokeLinecap="round"
          pathLength={100}
          stroke={col}
          strokeDasharray={`${Math.max(v, 3)} 100`}
          style={{ transition: "stroke-dasharray .6s ease" }}
        />
      )}
    </svg>
  );
}

const Num = ({ children }: { children: React.ReactNode }) => (
  <span className="num font-extrabold text-brand-700 dark:text-brand-200">
    {children}
  </span>
);

/**
 * Compact "AI Search" card (supabase/functions/aivisibility): one score, total mentions, total cited pages,
 * and the same two numbers per AI engine. Nothing else is shown. It runs only when the button is pressed,
 * so the daily AI limits are not used up on every page open.
 */
export default function AiVisibility({
  url,
  host,
  keywords,
  embedded = false,
}: {
  url: string;
  host: string;
  keywords: string[];
  /** true: no card of its own, it sits inside another card (the Organic search card) */
  embedded?: boolean;
}) {
  const kw = useRef(keywords);
  kw.current = keywords;
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const { data: rows } = await supabase
      .from("ai_visibility_runs")
      .select("result, created_at")
      .eq("host", host.replace(/^www\./, ""))
      .order("created_at", { ascending: false })
      .limit(1);
    setData(
      rows?.length
        ? { ...(rows[0].result as Result), ranAt: rows[0].created_at }
        : null,
    );
  }, [host]);

  useEffect(() => {
    setError(null);
    loadSaved();
  }, [loadSaved]);

  const run = async (keywords: string[]) => {
    setLoading(true);
    setError(null);
    try {
      await fn<unknown>("aivisibility", {
        url,
        keywords: keywords.slice(0, 8),
        force: true,
      });
      await loadSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const recheck = (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-800"
        disabled={loading}
        onClick={() => run(kw.current)}
        title={data ? `Last checked ${when(data.ranAt)}` : "Check AI visibility"}
      >
        {loading ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : data ? (
          <RefreshCw className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {loading ? "1-2 min" : data ? "Re-check" : "Run"}
      </button>
    </>
  );
  const bodyInner = (
    <>

        <ErrorNote message={error} />

        {!data && !loading && (
          <p className="py-4 text-center text-xs text-slate-500">
            Press Run to see how often AI assistants mention this site.
          </p>
        )}

        {data && (
          <div>
            {/* three headline numbers */}
            <div className="grid grid-cols-[1.35fr_1fr_1fr] gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-500">AI Visibility</div>
                <div className="mt-1 flex items-end gap-2">
                  <Gauge value={data.score} />
                  <Num>
                    <span className="text-[26px] leading-none">
                      {data.score}
                    </span>
                  </Num>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Mentions</div>
                <div className="mt-1 text-[26px] leading-none">
                  <Num>{data.mentions}</Num>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Cited Pages</div>
                <div className="mt-1 text-[26px] leading-none">
                  <Num>{data.citations}</Num>
                </div>
              </div>
            </div>

            {/* the same two numbers per engine */}
            <div className="mt-4 space-y-2">
              {data.engines.map((e) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[1.35fr_1fr_1fr] items-center gap-3"
                  title={
                    e.asked
                      ? (e.note ?? "")
                      : `No answer from this engine${e.error ? `: ${e.error}` : ""}`
                  }
                >
                  <div className="flex items-center gap-2 text-[13px]">
                    {ICON[e.id] ?? <Sparkles className="h-4 w-4" />}
                    {NAME[e.id] ?? e.label}
                  </div>
                  <span className="num text-sm font-semibold text-brand-600 dark:text-brand-300">
                    {e.asked ? e.mentions : "–"}
                  </span>
                  <span className="num text-sm font-semibold text-brand-600 dark:text-brand-300">
                    {e.asked ? e.citations : "–"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
    </>
  );

  if (embedded)
    return (
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight">AI Search</h3>
          {recheck}
        </div>
        {bodyInner}
      </div>
    );

  return (
    <Panel
      title="AI Search"
      sub="Mentions in AI assistants"
      right={recheck}
      className="flex flex-col"
    >
      {bodyInner}
    </Panel>
  );
}