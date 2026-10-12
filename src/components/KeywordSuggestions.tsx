import Select from "./Select";
import { downloadPdf } from "../lib/pdfTable";
import { useMemo, useState } from "react";
import { Badge } from "./ui";

/**
 * Keyword Suggestions: what to target next, worked out from THIS site's real Google positions and from what the competitors use.
 *  - Rival keywords : phrases the sites ranking for your topic use in their titles, snippets and headings, plus Google related searches
 *                     and People Also Ask. The strongest ones are checked on Google (your position, difficulty, who ranks).
 *  - Quick wins     : the site already ranks 4-30, one good page edit away from the next step up
 *  - New content    : the site does not rank at all, so a new page is needed (shows who ranks now)
 *  - Ideas          : phrases Google autocomplete suggests for the site's topic, not checked yet
 *  - Defend         : already top 3, keep them
 *  - Rivals         : who competes with you, how many of your keywords they hold, their estimated visits from those keywords
 * Positions and competitors are real Google results. Search volume, difficulty and extra visits are ESTIMATES (shown with a *).
 */

type Rival = { domain: string; position: number };
type Row = {
  keyword: string;
  position: number | null;
  url?: string | null;
  volume: number;
  volumeLow?: number;
  volumeHigh?: number;
  kd: number | null;
  kdLabel?: string | null;
  gain: number;
  opportunity: number;
  action: string;
  intent?: string;
  rivals: Rival[];
  source?: string;
  verified?: boolean;
  priority?: number;
  rivalCount?: number;
  hits?: number;
  sample?: string;
};
type RivalRow = {
  domain: string;
  keywords: number;
  avgPosition: number;
  share: number;
  visits: number;
  tranco: number | null;
  strength: number | null;
  title?: string;
  url?: string | null;
  topKeywords: { keyword: string; position: number; volume: number }[];
  phrases: string[];
};
type Tab = "rival" | "quick" | "new" | "ideas" | "defend" | "rivals";

const nf = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
    : String(Math.round(n));
const kdTone = (kd: number | null) =>
  kd == null ? "slate" : kd < 30 ? "green" : kd < 60 ? "amber" : "red";
const posTone = (p: number | null) =>
  p == null ? "slate" : p <= 3 ? "green" : p <= 10 ? "amber" : "slate";
const prioTone = (p: number) =>
  p >= 60 ? "green" : p >= 40 ? "amber" : "slate";
const rivalText = (r: Rival[]) =>
  r.map((x) => `${x.domain} (#${x.position})`).join(", ");
/** "Above you: a.com (#1), b.com (#2), c.com (#3)" kept on ONE line: small text, cut with ... if the column is narrow, full text on hover */
function RivalLine({ rivals, label }: { rivals: Rival[]; label?: string }) {
  const full = `${label ? `${label} ` : ""}${rivalText(rivals)}`;
  return (
    <div
      className="max-w-[540px] truncate whitespace-nowrap text-[10.5px] leading-4 text-slate-400"
      title={full}
    >
      {full}
    </div>
  );
}
const SOURCE: Record<string, string> = {
  rivals: "Rivals use it",
  related: "Google related search",
  question: "Question people ask",
};
const INTENTS = [
  "All",
  "Transactional",
  "Commercial",
  "Informational",
] as const;

/** the rank the page can realistically aim for (an estimate from the current position and the difficulty) */
function target(r: Pick<Row, "position" | "kd">): string {
  const p = r.position;
  if (p && p <= 3) return "Stay in top 3";
  if (p && p <= 10) return "Reach top 3";
  if (p && p <= 20) return "Reach top 10";
  if (p) return "Reach top 20";
  if (r.kd == null) return "Top 10 (difficulty unknown)";
  if (r.kd < 30) return "Top 10, realistic";
  if (r.kd < 50) return "Top 10 with a strong page";
  if (r.kd < 70) return "Top 20, takes links";
  return "Long shot";
}

function todo(r: Row): string {
  switch (r.action) {
    case "Defend":
      return "Keep the page fresh and linked from other pages.";
    case "Quick win":
      return "Put the phrase in the title and H1, add detail, link to the page from related pages.";
    case "Push up":
      return "Hard phrase: make the page deeper than the ones above it and earn links to it.";
    case "Improve":
      return "Page ranks low: rewrite it around this phrase and link to it internally.";
    case "New content":
      return "Write a new page for this phrase. Easy enough and searched enough to be worth it.";
    case "Long shot":
      return "Very hard. Go after easier phrases first.";
    default:
      return r.position
        ? "Improve the page that ranks."
        : "Write a page for this phrase if it fits your business.";
  }
}

export default function KeywordSuggestions({ d }: { d: any }) {
  const { quick, fresh, defend, ideas, rival, rivalRows } = useMemo(() => {
    const rivalsOf = new Map<string, Rival[]>();
    for (const r of d?.rankings ?? []) {
      const seen = new Set<string>();
      const list: Rival[] = [];
      for (const h of r.top ?? []) {
        if (!h?.domain || seen.has(h.domain) || (r.url && h.url === r.url))
          continue; // never list the site itself
        seen.add(h.domain);
        list.push({ domain: h.domain, position: h.position });
      }
      rivalsOf.set(String(r.keyword), list.slice(0, 3));
    }
    const table: any[] = d?.keywordTable?.length
      ? d.keywordTable
      : (d?.rankings ?? [])
          .filter((r: any) => !r.error)
          .map((r: any) => ({
            keyword: r.keyword,
            position: r.position,
            url: r.url,
            volume: 0,
            kd: null,
            gain: 0,
            opportunity: 0,
            action: r.position
              ? r.position <= 3
                ? "Defend"
                : r.position <= 20
                  ? "Quick win"
                  : "Improve"
              : "Consider",
          }));
    const rows: Row[] = table
      .filter((k) => !String(k.keyword).endsWith("(brand)"))
      .map((k) => ({
        keyword: String(k.keyword),
        position: k.position ?? null,
        url: k.url ?? null,
        volume: Number(k.volume) || 0,
        volumeLow: k.volumeLow,
        volumeHigh: k.volumeHigh,
        kd: k.kd ?? null,
        kdLabel: k.kdLabel,
        gain: Number(k.gain) || 0,
        opportunity: Number(k.opportunity) || 0,
        action: String(k.action ?? ""),
        intent: k.intent,
        rivals: rivalsOf.get(String(k.keyword)) ?? [],
      }));
    const byValue = (a: Row, b: Row) =>
      b.gain - a.gain || b.opportunity - a.opportunity || b.volume - a.volume;
    const ideaRows: Row[] = (d?.ideaTable ?? []).map((x: any) => ({
      keyword: String(x.keyword),
      position: null,
      volume: Number(x.volume) || 0,
      volumeLow: x.volumeLow,
      volumeHigh: x.volumeHigh,
      kd: null,
      gain: 0,
      opportunity: 0,
      action: "Consider",
      intent: x.intent,
      rivals: [],
    }));
    const minedRows: Row[] = (d?.mined ?? []).map((x: any) => ({
      keyword: String(x.keyword),
      position: x.position ?? null,
      url: x.url ?? null,
      volume: Number(x.volume) || 0,
      volumeLow: x.volumeLow,
      volumeHigh: x.volumeHigh,
      kd: x.kd ?? null,
      kdLabel: x.kdLabel,
      gain: Number(x.gain) || 0,
      opportunity: Number(x.opportunity) || 0,
      action: String(x.action ?? "Consider"),
      intent: x.intent,
      rivals: Array.isArray(x.rivals) ? x.rivals : [],
      source: x.source,
      verified: !!x.verified,
      priority: Number(x.priority) || 0,
      rivalCount: x.rivalCount,
      hits: x.hits,
      sample: x.sample,
    }));
    return {
      quick: rows
        .filter((r) => r.position && r.position > 3 && r.position <= 30)
        .sort(byValue),
      fresh: rows
        .filter((r) => !r.position)
        .sort((a, b) => b.opportunity - a.opportunity || b.volume - a.volume),
      defend: rows
        .filter((r) => r.position && r.position <= 3)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      ideas: ideaRows.sort((a, b) => b.volume - a.volume),
      rival: minedRows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
      rivalRows: (d?.rivalTable ?? []) as RivalRow[],
    };
  }, [d]);

  const lists: Record<Exclude<Tab, "rivals">, Row[]> = {
    rival: rival,
    quick,
    new: fresh,
    ideas,
    defend,
  };
  const tabs: { k: Tab; l: string; n: number; hint: string }[] = [
    {
      k: "rival",
      l: "Rival keywords",
      n: rival.length,
      hint: "Phrases the sites that rank for your topic use (titles, snippets, headings) and what Google suggests (related searches, questions). Sorted by priority: evidence from rivals, searches and how easy it is. The top ones are checked on Google.",
    },
    {
      k: "quick",
      l: "Quick wins",
      n: quick.length,
      hint: "Your pages already on Google (position 4 to 30). A small edit can move them up.",
    },
    {
      k: "new",
      l: "New content",
      n: fresh.length,
      hint: "Phrases where you do not rank yet. Competitors on the right are who holds the top spots now.",
    },
    {
      k: "ideas",
      l: "Keyword ideas",
      n: ideas.length,
      hint: "Phrases Google autocomplete suggests for your topic. Not checked on Google yet.",
    },
    {
      k: "defend",
      l: "Defend",
      n: defend.length,
      hint: "Already in the top 3. Keep these safe.",
    },
    {
      k: "rivals",
      l: "Rivals",
      n: rivalRows.length,
      hint: "The sites you compete with: how many of your keywords they hold, how strong they are and their approximate visits from these keywords.",
    },
  ];
  const first = tabs.find((t) => t.n)?.k ?? "quick";
  const [tab, setTab] = useState<Tab>(first);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState("");
  const [intent, setIntent] = useState<(typeof INTENTS)[number]>("All");
  const [open, setOpen] = useState<string | null>(null);
  const cur: Tab = tabs.find((t) => t.k === tab)?.n ? tab : first;
  const hint = tabs.find((t) => t.k === cur)!.hint;

  const isRows = cur !== "rivals";
  const base = isRows ? lists[cur as Exclude<Tab, "rivals">] : [];
  const all = useMemo(
    () =>
      base.filter(
        (r) =>
          (!q || r.keyword.toLowerCase().includes(q.toLowerCase())) &&
          (intent === "All" || (r.intent ?? "") === intent),
      ),
    [base, q, intent],
  );
  const cap = cur === "rival" ? 60 : 40;
  const rows = more ? all.slice(0, cap) : all.slice(0, 10);

  if (!tabs.some((t) => t.n)) {
    return (
      <p className="text-sm text-slate-500">
        No keyword data yet. Run the analysis again to get suggestions.
      </p>
    );
  }

  function exportPdf() {
    downloadPdf(`keywords-${cur}.pdf`, [
      [
        "Keyword",
        "Position",
        "Searches/mo",
        "Difficulty",
        "Intent",
        "Action",
        "Priority",
        "Source",
        "Who ranks / uses it",
      ],
      ...all.map((r) => [
        r.keyword,
        r.position ?? "",
        r.volume || "",
        r.kd ?? "",
        r.intent ?? "",
        r.action,
        r.priority ?? "",
        r.source ?? "",
        rivalText(r.rivals),
      ]),
    ]);
  }

  const showAimCols = cur !== "ideas" && cur !== "rival";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => {
              setTab(t.k);
              setMore(false);
              setQ("");
              setIntent("All");
              setOpen(null);
            }}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${cur === t.k ? "bg-indigo-500 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:text-slate-800 dark:bg-slate-800 dark:hover:text-slate-200"}`}
          >
            {t.l} <span className="opacity-70">({t.n})</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>

      {isRows && base.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setMore(false);
            }}
            placeholder="Filter keywords"
            className="w-44 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
          />
          <Select
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value as (typeof INTENTS)[number]);
              setMore(false);
            }}
            className="rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i === "All" ? "All intents" : i}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={exportPdf}
            className="ml-auto rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300"
          >
            Download PDF
          </button>
        </div>
      )}

      {cur === "rivals" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60">
                <th className="th">Competitor</th>
                <th className="th text-right">Your keywords they hold</th>
                <th className="th text-right">Avg position</th>
                <th className="th text-right">
                  Visits/mo* (from these keywords)
                </th>
                <th className="th">Site strength*</th>
                <th className="th">Their top phrases</th>
              </tr>
            </thead>
            <tbody>
              {rivalRows.map((r) => (
                <tr
                  key={r.domain}
                  className="border-t border-line align-top dark:border-slate-800"
                >
                  <td className="td max-w-[200px]">
                    <div className="font-medium">{r.domain}</div>
                    {r.title && (
                      <div
                        className="truncate text-[11px] text-slate-400"
                        title={r.title}
                      >
                        {r.title}
                      </div>
                    )}
                  </td>
                  <td className="td text-right">
                    {r.keywords}{" "}
                    <span className="text-[11px] text-slate-400">
                      ({r.share}%)
                    </span>
                  </td>
                  <td className="td text-right">{r.avgPosition}</td>
                  <td className="td text-right font-medium">
                    {r.visits ? nf(r.visits) : "–"}
                  </td>
                  <td className="td">
                    {r.strength != null ? (
                      <Badge tone={kdTone(r.strength)}>{r.strength}</Badge>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                    {r.tranco ? (
                      <div className="text-[11px] text-slate-400">
                        Global rank #{nf(r.tranco)}
                      </div>
                    ) : null}
                  </td>
                  <td className="td text-xs text-slate-500">
                    {r.phrases.length
                      ? r.phrases.slice(0, 5).join(" · ")
                      : r.topKeywords
                          .slice(0, 3)
                          .map((k) => `${k.keyword} (#${k.position})`)
                          .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !all.length ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {base.length
            ? "No keyword matches the filter."
            : "Nothing in this list for this run."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60">
                <th className="th">Keyword</th>
                {cur === "rival" && <th className="th">Priority</th>}
                {cur !== "ideas" && <th className="th">Now</th>}
                {showAimCols && <th className="th">Aim for*</th>}
                <th className="th text-right">Searches/mo*</th>
                {cur !== "ideas" && <th className="th">Difficulty*</th>}
                {cur !== "ideas" && cur !== "defend" && (
                  <th className="th text-right">Extra visits/mo*</th>
                )}
                <th className="th">
                  {cur === "new"
                    ? "Who ranks now"
                    : cur === "rival"
                      ? "Who uses it"
                      : "What to do"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.keyword}
                  className="border-t border-line align-top dark:border-slate-800"
                >
                  <td className="td max-w-[260px]">
                    <div className="font-medium">{r.keyword}</div>
                    <div className="text-[11px] capitalize text-slate-400">
                      {[
                        r.intent,
                        cur === "rival" && r.source
                          ? (SOURCE[r.source] ?? r.source)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  {cur === "rival" && (
                    <td className="td">
                      <Badge tone={prioTone(r.priority ?? 0)}>
                        {r.priority ?? 0}
                      </Badge>
                    </td>
                  )}
                  {cur !== "ideas" && (
                    <td className="td">
                      {r.position ? (
                        <Badge
                          tone={posTone(r.position)}
                        >{`#${r.position}`}</Badge>
                      ) : cur === "rival" && !r.verified ? (
                        <span className="text-xs text-slate-400">
                          Not checked
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Not ranking
                        </span>
                      )}
                    </td>
                  )}
                  {showAimCols && (
                    <td className="td whitespace-nowrap text-xs">
                      {target(r)}
                    </td>
                  )}
                  <td
                    className="td text-right"
                    title={
                      r.volumeLow &&
                      r.volumeHigh &&
                      r.volumeHigh !== r.volumeLow
                        ? `Likely range ${nf(r.volumeLow)} to ${nf(r.volumeHigh)}`
                        : undefined
                    }
                  >
                    {r.volume ? nf(r.volume) : "–"}
                  </td>
                  {cur !== "ideas" && (
                    <td className="td">
                      {r.kd != null ? (
                        <Badge
                          tone={kdTone(r.kd)}
                        >{`${r.kd}${r.kdLabel ? ` · ${r.kdLabel}` : ""}`}</Badge>
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                  )}
                  {cur !== "ideas" && cur !== "defend" && (
                    <td className="td text-right font-medium">
                      {r.gain > 0 ? `+${nf(r.gain)}` : "–"}
                    </td>
                  )}
                  <td className="td min-w-[300px] text-[11.5px] leading-snug text-slate-500">
                    {cur === "new" ? (
                      r.rivals.length ? (
                        <RivalLine rivals={r.rivals} />
                      ) : (
                        todo(r)
                      )
                    ) : cur === "ideas" ? (
                      "Write a page or section for it, then check it on the next run."
                    ) : cur === "rival" ? (
                      <div>
                        {r.rivals.length ? (
                          <RivalLine rivals={r.rivals} />
                        ) : r.source === "question" ? (
                          "A question people ask: answer it on a page or in an FAQ."
                        ) : (
                          "Suggested by Google for your topic."
                        )}
                        {r.verified && (
                          <div className="mt-1 text-slate-400">{todo(r)}</div>
                        )}
                        {r.sample && (
                          <button
                            type="button"
                            className="mt-1 block text-[11px] text-indigo-500 hover:underline"
                            onClick={() =>
                              setOpen(open === r.keyword ? null : r.keyword)
                            }
                          >
                            {open === r.keyword
                              ? "Hide example"
                              : "Show example"}
                          </button>
                        )}
                        {open === r.keyword && (
                          <div className="mt-1 italic text-slate-400">
                            {r.sample}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {todo(r)}
                        {cur === "quick" && r.rivals.length > 0 && (
                          <div className="mt-0.5">
                            <RivalLine label="Above you:" rivals={r.rivals} />
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isRows && all.length > 10 && (
        <button
          type="button"
          className="mt-3 text-xs font-medium text-indigo-500 hover:underline"
          onClick={() => setMore(!more)}
        >
          {more
            ? "Show fewer"
            : `Show more (${Math.min(all.length, cap) - 10} more)`}
        </button>
      )}
      {cur === "rival" &&
        rival.length > 0 &&
        !rival.some((r) => r.verified) && (
          <p className="mt-3 text-[11px] text-slate-400">
            These phrases were not checked on Google in this run. Re-run with
            fresh data to check the strongest ones.
          </p>
        )}
    </div>
  );
}