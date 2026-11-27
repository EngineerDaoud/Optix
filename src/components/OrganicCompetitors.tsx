import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ExternalLink, X } from "lucide-react";
import { useOrgCompetitors } from "../lib/orgCompetitors";
import { ErrorNote, Spinner } from "./ui";

const SHOWN = 5;
const nf = (n: number) => n.toLocaleString("en-GB");


type Row = NonNullable<ReturnType<typeof useOrgCompetitors>["data"]>["competitors"][number];

function CompTable({
  rows,
  maxLevel,
  asc,
  setAsc,
}: {
  rows: Row[];
  maxLevel: number;
  asc: boolean;
  setAsc: (f: (v: boolean) => boolean) => void;
}) {
  return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
              <th className="py-3 pr-3 font-medium">Competitor</th>
              <th className="px-3 py-3 font-medium">
                <button
                  type="button"
                  onClick={() => setAsc((v) => !v)}
                  className="inline-flex items-center gap-1.5 font-medium"
                  title="Sort by competition level"
                >
                  Com. Level
                  {asc ? (
                    <ArrowUpNarrowWide className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ArrowDownWideNarrow className="h-4 w-4 text-slate-500" />
                  )}
                </button>
              </th>
              <th className="px-3 py-3 text-right font-medium" title="Keywords you both rank for">
                Com. Keywords
              </th>
              <th
                className="py-3 pl-3 text-right font-medium"
                title="Keywords our database knows this site ranks for"
              >
                SE Keywords
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.domain} className="border-t border-slate-100 dark:border-slate-800">
                <td className="max-w-[210px] py-3 pr-3">
                  <a
                    href={`https://${c.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-2 text-[15px] text-blue-600 hover:underline dark:text-blue-400"
                    title={c.domain}
                  >
                    <span className="truncate">{c.domain}</span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                  </a>
                </td>
                <td className="px-3 py-3">
                  <div
                    className="h-2.5 w-[120px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                    title={`${c.level}% of your keywords · average position ${c.avgPosition}`}
                  >
                    <i
                      className="block h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(8, (c.level / maxLevel) * 100)}%` }}
                    />
                  </div>
                </td>
                <td className="num px-3 py-3 text-right text-[15px] text-blue-600 dark:text-blue-400">
                  {nf(c.common)}
                </td>
                <td className="num py-3 pl-3 text-right text-[15px] text-blue-600 dark:text-blue-400">
                  {nf(c.seKeywords)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}

/** Popup with every competitor; the dashboard card itself stays short. */
function CompetitorsModal({
  total,
  onClose,
  children,
}: {
  total: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Main organic competitors"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold">
            Main Organic Competitors{" "}
            <span className="font-normal text-slate-500">{nf(total)}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scroll-thin overflow-auto px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Main Organic Competitors": the sites that rank on Google for the same keywords as this site.
 * Free: it reads our own keyword database (supabase/functions/orgcompetitors), no paid API.
 * Com. keywords = keywords both rank for (top 20). Com. level = their share of this site's keywords.
 * SE keywords = keywords our database knows they rank for (it grows with every check anyone runs).
 */
export default function OrganicCompetitors({
  url,
  country,
  keywords,
}: {
  url: string;
  country: string;
  keywords: string[];
}) {
  const { data, loading, error } = useOrgCompetitors(url, country, keywords);
  const [open, setOpen] = useState(false);
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const list = [...(data?.competitors ?? [])];
    list.sort((a, b) =>
      asc ? a.level - b.level || a.common - b.common : b.level - a.level || b.common - a.common,
    );
    return list;
  }, [data, asc]);
  const top = rows.slice(0, SHOWN);
  const maxLevel = Math.max(1, ...(data?.competitors.map((c) => c.level) ?? [1]));
  const more = (data?.competitors.length ?? 0) > SHOWN;

  return (
    <section className="card fade-up flex flex-col !p-0">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h2 className="text-[19px] font-bold tracking-tight">
          Main Organic Competitors{" "}
          {data && data.total > 0 && (
            <span className="font-normal text-slate-500">{nf(data.total)}</span>
          )}
        </h2>
      </div>

      <div className="flex-1 px-6 pb-6 pt-3">
        <ErrorNote message={error} />

        {loading && !data && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading
          </div>
        )}

        {data && top.length === 0 && !loading && (
          <p className="py-8 text-center text-sm text-slate-500">
            No competitors yet. Run a full check on the Dashboard; every check adds to our keyword
            database and competitors appear here.
          </p>
        )}

        {top.length > 0 && (
          <CompTable rows={top} maxLevel={maxLevel} asc={asc} setAsc={setAsc} />
        )}

        {more && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 rounded-lg bg-[#1b1d1b] px-4 py-2 text-[15px] font-semibold text-white transition hover:bg-black dark:bg-slate-100 dark:text-slate-900"
          >
            View details
          </button>
        )}
      </div>

      {open && (
        <CompetitorsModal total={rows.length} onClose={() => setOpen(false)}>
          <CompTable rows={rows} maxLevel={maxLevel} asc={asc} setAsc={setAsc} />
        </CompetitorsModal>
      )}
    </section>
  );
}