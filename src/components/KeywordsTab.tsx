import { useState } from "react";
import { Badge } from "./ui";
import { Card, Stat, Table } from "./viz";
import PosSpark from "./PosSpark";

// Keywords tab of Domain Research: the "organic keywords", "keyword difficulty", "topics" and "share of voice" views of the
// paid tools, built from free data. Volume, difficulty and traffic are estimates and are labelled that way.

const nf = (n: number | null | undefined) =>
  n == null ? "–" : Math.round(n).toLocaleString();
const kdTone = (kd: number | null) =>
  kd == null ? "slate" : kd < 30 ? "green" : kd < 60 ? "amber" : "red";
const posTone = (p: number | null) =>
  p == null ? "slate" : p <= 3 ? "green" : p <= 10 ? "amber" : "slate";
const actionTone = (a: string) =>
  a === "Quick win" || a === "New content"
    ? "green"
    : a === "Defend"
      ? "brand"
      : a === "Push up" || a === "Improve"
        ? "amber"
        : "slate";
const intentTone = (i: string) =>
  i === "Transactional"
    ? "green"
    : i === "Commercial"
      ? "amber"
      : i === "Navigational"
        ? "brand"
        : "slate";
const oppColor = (s: number) =>
  s >= 60 ? "#16a34a" : s >= 35 ? "#d97706" : "#94a3b8";
const rangeText = (k: { volumeLow?: number; volumeHigh?: number }) =>
  k.volumeLow != null && k.volumeHigh != null
    ? `${nf(k.volumeLow)} – ${nf(k.volumeHigh)}`
    : "";
const short = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || "/";
  } catch {
    return u;
  }
};
const compact = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
      : String(n);

type View = "keywords" | "topics";

export default function KeywordsTab({ d }: { d: any }) {
  const m = d.meta;
  const scope: string = m.scope ?? "country";
  const table: any[] = d.keywordTable ?? [];
  const topics: any[] = d.topics ?? [];
  const sov: any[] = d.shareOfVoice ?? [];
  const ideas: any[] = d.ideaTable ?? [];
  const ch = d.changes;
  const [view, setView] = useState<View>(
    scope === "topic" ? "topics" : "keywords",
  );
  const [filter, setFilter] = useState<string>("all");

  if (!table.length) {
    return (
      <div className="card text-sm text-slate-600 dark:text-slate-300">
        No keyword data for this run. Keywords need <b>SERPER_API_KEY</b> in
        Supabase secrets, and a site that could be read. Press “Re-run with
        fresh data” after fixing it.
        {d.notes?.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">{d.notes.join(" · ")}</p>
        )}
      </div>
    );
  }

  const world = scope === "world";
  const shown = table.filter(
    (k) => filter === "all" || k.action === filter || k.intent === filter,
  );
  const winCount = table.filter(
    (k) => k.action === "Quick win" || k.action === "New content",
  ).length;
  const avgKd = (() => {
    const v = table.filter((k) => k.kd != null);
    return v.length
      ? Math.round(v.reduce((a, k) => a + k.kd, 0) / v.length)
      : null;
  })();
  const gainTotal = Math.round(table.reduce((a, k) => a + (k.gain ?? 0), 0));
  const own = sov.find((x) => x.own);
  const filters = [
    "all",
    "Quick win",
    "New content",
    "Push up",
    "Defend",
    "Transactional",
    "Commercial",
    "Informational",
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Quick wins and new content"
          value={winCount}
          sub="keywords you can realistically win"
        />
        <Stat
          label="Average difficulty"
          value={avgKd ?? "–"}
          sub={
            avgKd == null
              ? "No difficulty data"
              : avgKd < 30
                ? "Mostly easy to beat"
                : avgKd < 60
                  ? "Mixed: some effort needed"
                  : "Strong competitors"
          }
        />
        <Stat
          label="Visits you could add"
          value={`+${compact(gainTotal)}`}
          sub="per month, if these keywords reach #3"
        />
        <Stat
          label="Your share of voice"
          value={own ? `${own.share}%` : "0%"}
          sub="of all visibility in these searches"
        />
      </div>

      {ch && (
        <Card
          title="Changes since the last check"
          right={
            <span className="text-xs text-slate-500">
              {ch.since ? new Date(ch.since).toLocaleDateString() : ""}
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{`▲ ${ch.up} improved`}</Badge>
            <Badge tone="red">{`▼ ${ch.down} dropped`}</Badge>
            <Badge tone="green">{`+ ${ch.gained} newly ranking`}</Badge>
            <Badge tone="red">{`− ${ch.lost} lost`}</Badge>
            {ch.healthDelta != null && (
              <Badge
                tone={ch.healthDelta >= 0 ? "green" : "red"}
              >{`Site health ${ch.healthDelta >= 0 ? "+" : ""}${ch.healthDelta}`}</Badge>
            )}
            {ch.visits?.pct != null && (
              <Badge
                tone={ch.visits.pct >= 0 ? "green" : "red"}
              >{`Estimated visits ${ch.visits.pct >= 0 ? "+" : ""}${ch.visits.pct}%`}</Badge>
            )}
          </div>
          {ch.moves?.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th className="th">Keyword</th>
                  <th className="th">Before</th>
                  <th className="th">Now</th>
                  <th className="th">Change</th>
                </tr>
              </thead>
              <tbody>
                {ch.moves.map((x: any) => (
                  <tr
                    key={x.keyword}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="td">{x.keyword}</td>
                    <td className="td">{x.from ?? "–"}</td>
                    <td className="td">{x.to ?? "–"}</td>
                    <td className="td">
                      <Badge
                        tone={
                          x.kind === "up" ||
                          x.kind === "new rank" ||
                          x.kind === "new keyword"
                            ? "green"
                            : "red"
                        }
                      >
                        {x.kind}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={view === "keywords" ? "btn" : "btn-ghost"}
          onClick={() => setView("keywords")}
        >
          Keywords
        </button>
        <button
          className={view === "topics" ? "btn" : "btn-ghost"}
          onClick={() => setView("topics")}
        >
          By content topic
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {world
            ? `Worldwide view: ${(m.countries ?? []).map((c: string) => c.toUpperCase()).join(", ")}`
            : `Google ${m.country.toUpperCase()}`}
        </span>
      </div>

      {view === "keywords" && (
        <Card title="Keywords, ranked by opportunity">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
          <Table>
            <thead>
              <tr>
                <th className="th">Keyword</th>
                <th className="th">Pos.</th>
                <th className="th">Trend</th>
                <th className="th">Searches/mo*</th>
                {world && <th className="th">All markets*</th>}
                <th className="th">Difficulty*</th>
                <th className="th">Intent</th>
                <th className="th">Visits/mo*</th>
                <th className="th">Opportunity</th>
                <th className="th">Do this</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((k) => (
                <tr
                  key={k.keyword}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="td font-medium">
                    {k.keyword}
                    {k.url && (
                      <div className="max-w-[240px] truncate text-xs font-normal text-slate-400">
                        {short(k.url)}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    {k.position ? (
                      <Badge tone={posTone(k.position)}>{k.position}</Badge>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                  <td className="td">
                    {k.trend?.series?.length ? (
                      <div className="flex items-center gap-1.5">
                        <PosSpark
                          series={[...k.trend.series, k.position ?? null]}
                        />
                        {k.trend.prev != null &&
                          k.position != null &&
                          k.trend.prev !== k.position && (
                            <Badge
                              tone={k.trend.prev > k.position ? "green" : "red"}
                            >{`${k.trend.prev > k.position ? "▲" : "▼"} ${Math.abs(k.trend.prev - k.position)}`}</Badge>
                          )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        first check
                      </span>
                    )}
                  </td>
                  <td className="td" title={`Likely range ${rangeText(k)}`}>
                    {nf(k.volume)}
                    <div className="text-xs text-slate-400">{rangeText(k)}</div>
                  </td>
                  {world && <td className="td">{nf(k.volumeAll)}</td>}
                  <td className="td">
                    {k.kd == null ? (
                      <span className="text-slate-400">–</span>
                    ) : (
                      <Badge
                        tone={kdTone(k.kd)}
                      >{`${k.kd} · ${k.kdLabel}`}</Badge>
                    )}
                  </td>
                  <td className="td">
                    <Badge tone={intentTone(k.intent)}>{k.intent}</Badge>
                  </td>
                  <td className="td">{k.visits > 0 ? nf(k.visits) : "–"}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${k.opportunity}%`,
                            background: oppColor(k.opportunity),
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold">
                        {k.opportunity}
                      </span>
                    </div>
                  </td>
                  <td className="td">
                    <Badge tone={actionTone(k.action)}>{k.action}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            *Estimates. Searches come from an AI estimate checked against Google
            autocomplete and ads, shown with a likely range. Difficulty (0 to
            100) is how strong the sites ranking on page 1 are (domain
            popularity by Tranco rank), how crowded the page is with ads and
            shopping boxes, and how many pages target the exact phrase.
            {d.meta.kdCoverage != null &&
              ` Domain strength was known for ${d.meta.kdCoverage}% of the ranking sites; the rest were assumed to be small to medium.`}{" "}
            Backlinks are not included, so difficulty is lower than Ahrefs or
            Semrush for sites with many links.
          </p>
        </Card>
      )}

      {view === "topics" && (
        <Card title="Content topics: where the demand is and where you win">
          {topics.length === 0 ? (
            <p className="text-sm text-slate-500">
              Not enough keywords to form topics.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className="th">Topic</th>
                  <th className="th">Keywords</th>
                  <th className="th">Ranking</th>
                  <th className="th">Searches/mo*</th>
                  <th className="th">Share of demand</th>
                  <th className="th">Avg. position</th>
                  <th className="th">Avg. difficulty*</th>
                  <th className="th">Visits/mo*</th>
                </tr>
              </thead>
              <tbody>
                {topics.map((t: any) => (
                  <tr
                    key={t.topic}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="td font-medium">
                      {t.topic}
                      <div className="max-w-[260px] truncate text-xs font-normal text-slate-400">
                        {t.examples.join(" · ")}
                      </div>
                    </td>
                    <td className="td">{t.keywords}</td>
                    <td className="td">{t.ranking}</td>
                    <td className="td">{nf(t.volume)}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${t.volumeShare}%` }}
                          />
                        </div>
                        {t.volumeShare}%
                      </div>
                    </td>
                    <td className="td">{t.avgPosition ?? "–"}</td>
                    <td className="td">
                      {t.avgKd == null ? (
                        "–"
                      ) : (
                        <Badge tone={kdTone(t.avgKd)}>{t.avgKd}</Badge>
                      )}
                    </td>
                    <td className="td">{t.visits > 0 ? nf(t.visits) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Keywords are grouped by their main shared word. A topic with high
            demand and few or no rankings is a content gap worth writing for.
          </p>
        </Card>
      )}

      {sov.length > 0 && (
        <Card title="Share of voice: who owns these searches">
          <Table>
            <thead>
              <tr>
                <th className="th">Domain</th>
                <th className="th">Keywords</th>
                <th className="th">Avg. position</th>
                <th className="th">Share of voice</th>
              </tr>
            </thead>
            <tbody>
              {sov.map((x: any) => (
                <tr
                  key={x.domain}
                  className={`border-t border-slate-100 dark:border-slate-800 ${x.own ? "bg-brand-50 dark:bg-slate-800/50" : ""}`}
                >
                  <td className="td font-medium">
                    {x.domain} {x.own && <Badge tone="brand">you</Badge>}{" "}
                    {x.platform && !x.own && <Badge>platform</Badge>}
                  </td>
                  <td className="td">{x.keywords}</td>
                  <td className="td">{x.avgPosition}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, x.share)}%`,
                            background: x.own ? "#5b38ee" : "#94a3b8",
                          }}
                        />
                      </div>
                      {x.share}%
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            Visibility = searches x click rate at each position, added up over
            the checked keywords. It shows who gets the clicks, not just who
            appears.
          </p>
        </Card>
      )}

      {ideas.length > 0 && (
        <Card
          title="New keyword ideas from Google autocomplete"
          right={
            <span className="text-xs text-slate-500">
              not checked in Google yet
            </span>
          }
        >
          <Table>
            <thead>
              <tr>
                <th className="th">Keyword idea</th>
                <th className="th">Searches/mo*</th>
                <th className="th">Intent</th>
                <th className="th">Popularity</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((k: any) => (
                <tr
                  key={k.keyword}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="td">{k.keyword}</td>
                  <td className="td">
                    {nf(k.volume)}
                    <div className="text-xs text-slate-400">{rangeText(k)}</div>
                  </td>
                  <td className="td">
                    <Badge tone={intentTone(k.intent)}>{k.intent}</Badge>
                  </td>
                  <td className="td">
                    {"●".repeat(Math.min(k.popularity, 5))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            Popularity = in how many different Google autocomplete lists the
            phrase showed up. Add the good ones as pages, then re-run to see
            where you rank.
          </p>
        </Card>
      )}
    </div>
  );
}
