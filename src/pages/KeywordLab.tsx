import Select from "../components/Select";
import { downloadPdf } from "../lib/pdfTable";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Search } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { useSite } from "../context/Site";
import { useAuth } from "../context/Auth";
import { Badge, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { Card, Stat, Table, Tabs } from "../components/viz";
import PosSpark from "../components/PosSpark";

// Keyword Lab: the front door of the data bank (migration 006). Everything searched here, and everything the Dashboard checks,
// is saved in your own Supabase database and reused, so repeat searches are instant and cost no Serper / AI credits.

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
const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
};
const nf = (n: number | null | undefined) =>
  n == null ? "–" : Math.round(n).toLocaleString();
const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "–";
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "–";
const kdTone = (kd: number | null) =>
  kd == null ? "slate" : kd < 30 ? "green" : kd < 60 ? "amber" : "red";
const posTone = (p: number | null) =>
  p == null ? "slate" : p <= 3 ? "green" : p <= 10 ? "amber" : "slate";
const intentTone = (i: string | null) =>
  i === "Transactional"
    ? "green"
    : i === "Commercial"
      ? "amber"
      : i === "Navigational"
        ? "brand"
        : "slate";
const rangeText = (k: {
  volumeLow?: number | null;
  volumeHigh?: number | null;
}) =>
  k.volumeLow != null && k.volumeHigh != null
    ? `${nf(k.volumeLow)} – ${nf(k.volumeHigh)}`
    : "";

// every table download is a PDF now (was CSV)
function download(name: string, rows: (string | number | null)[][]) {
  downloadPdf(name.replace(/\.csv$/i, ".pdf"), rows);
}

const CountrySelect = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) => (
  <Select
    aria-label="Country"
    className="input !w-auto"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  >
    {COUNTRIES.map(([c, n]) => (
      <option key={c} value={c}>
        {n}
      </option>
    ))}
  </Select>
);

// ======================================================================================================================
// 1. Explore: look up any keyword
// ======================================================================================================================
function Explore({ host }: { host: string }) {
  const [text, setText] = useState("");
  const [country, setCountry] = useState("gb");
  const [fresh, setFresh] = useState(false);
  const [ideas, setIdeas] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async (override?: string) => {
    const kws = (override ?? text)
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!kws.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fn("keywordlab", {
        action: "lookup",
        keywords: kws,
        country,
        host,
        fresh,
        ideas,
      });
      setData(r);
      setOpen(r.results?.[0]?.keyword ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const pick = (k: string) => {
    setText(k);
    run(k);
  };

  const results: any[] = data?.results ?? [];
  const saved = results.filter((r) => r.from?.serp === "saved").length;

  return (
    <div className="grid gap-4">
      <Card title="Look up keywords">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <textarea
            className="input min-h-[96px]"
            placeholder={
              "One keyword per line (up to 5)\nelectric bikes uk\n1000w ebike kit"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-col gap-2 md:w-56">
            <CountrySelect value={country} onChange={setCountry} />
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={ideas}
                onChange={(e) => setIdeas(e.target.checked)}
              />{" "}
              Also find related ideas
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={fresh}
                onChange={(e) => setFresh(e.target.checked)}
              />{" "}
              Ignore saved Google results
            </label>
            <button
              className="btn"
              disabled={busy || !text.trim()}
              onClick={() => run()}
            >
              {busy ? <Spinner /> : <Search className="h-4 w-4" />} Look up
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Searched keywords are saved. Google results are reused for 3 days and
          volume numbers for 90 days, so repeat lookups are instant.
        </p>
      </Card>
      <ErrorNote message={err} />

      {results.length > 0 && (
        <Card
          title="Results"
          right={
            <span className="text-xs text-slate-500">
              {saved} of {results.length} came from your saved data
            </span>
          }
        >
          <Table>
            <thead>
              <tr>
                <th className="th">Keyword</th>
                <th className="th">Searches/mo*</th>
                <th className="th">Difficulty*</th>
                <th className="th">Intent</th>
                <th className="th">SERP features</th>
                {host && <th className="th">{host}</th>}
                <th className="th">Data</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.keyword}
                  onClick={() => setOpen(open === r.keyword ? null : r.keyword)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${open === r.keyword ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}
                >
                  <td className="td font-medium">
                    {r.keyword}
                    {r.error && (
                      <div className="text-xs font-normal text-red-600">
                        {r.error}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    {nf(r.volume)}
                    <div className="text-xs text-slate-400">{rangeText(r)}</div>
                  </td>
                  <td className="td">
                    {r.kd == null ? (
                      <span className="text-slate-400">–</span>
                    ) : (
                      <Badge
                        tone={kdTone(r.kd)}
                      >{`${r.kd} · ${r.kdLabel}`}</Badge>
                    )}
                  </td>
                  <td className="td">
                    <Badge tone={intentTone(r.intent)}>{r.intent}</Badge>
                  </td>
                  <td className="td text-xs text-slate-500">
                    {r.features
                      ? [
                          r.features.ads > 0 && `${r.features.ads} ads`,
                          r.features.shopping && "shopping",
                          r.features.paa > 0 && "people also ask",
                          r.features.answerBox && "answer box",
                          r.features.places && "map",
                          r.features.videos && "videos",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "none"
                      : "–"}
                  </td>
                  {host && (
                    <td className="td">
                      {r.ownPosition ? (
                        <Badge tone={posTone(r.ownPosition)}>
                          {r.ownPosition}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                  )}
                  <td className="td text-xs text-slate-500">
                    {r.from?.serp === "saved" ? (
                      <Badge tone="brand">saved {day(r.from.serpAt)}</Badge>
                    ) : r.from?.serp === "live" ? (
                      <Badge tone="green">fresh from Google</Badge>
                    ) : (
                      "–"
                    )}
                    <div className="mt-0.5">
                      volume:{" "}
                      {r.from?.volume === "saved"
                        ? "saved"
                        : r.from?.volume === "ai"
                          ? "calculated"
                          : "approximate"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            *Approximate figures: searches are calculated from Google
            suggestions and ad data. Difficulty is based on how strong the
            page-1 sites are. Click a row to see the top 10.
          </p>
        </Card>
      )}

      {results
        .filter((r) => r.keyword === open && r.ok)
        .map((r) => (
          <Card
            key={r.keyword}
            title={`Top 10 on Google for “${r.keyword}”`}
            right={
              <span className="text-xs text-slate-500">
                {r.from?.serp === "saved"
                  ? `saved ${when(r.from.serpAt)}`
                  : "just checked"}
              </span>
            }
          >
            <Table>
              <thead>
                <tr>
                  <th className="th">#</th>
                  <th className="th">Page</th>
                  <th className="th">Site</th>
                  <th className="th">Site strength*</th>
                </tr>
              </thead>
              <tbody>
                {r.top.map((t: any) => (
                  <tr
                    key={t.position}
                    className={`border-t border-slate-100 dark:border-slate-800 ${host && t.domain && (t.domain === host || host.endsWith(`.${t.domain}`) || t.domain.endsWith(host)) ? "bg-brand-50 dark:bg-slate-800/50" : ""}`}
                  >
                    <td className="td font-semibold">{t.position}</td>
                    <td className="td">
                      <a
                        className="font-medium hover:underline"
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.title || t.url}
                      </a>
                      <div className="max-w-[420px] truncate text-xs text-slate-400">
                        {t.url}
                      </div>
                    </td>
                    <td className="td">
                      {t.domain}{" "}
                      {t.home && <Badge tone="amber">home page</Badge>}
                    </td>
                    <td className="td">
                      {t.strength == null ? (
                        <span className="text-slate-400">unknown</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${t.strength}%`,
                                background:
                                  t.strength > 60
                                    ? "#dc2626"
                                    : t.strength > 30
                                      ? "#d97706"
                                      : "#16a34a",
                              }}
                            />
                          </div>
                          <span className="text-xs">{t.strength}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {r.related.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-slate-500">
                  Related searches and questions (click to look up)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.related.map((x: string) => (
                    <button
                      key={x}
                      onClick={() => pick(x)}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}

      {(data?.ideas?.length ?? 0) > 0 && (
        <Card
          title="More keyword ideas from Google autocomplete"
          right={
            <span className="text-xs text-slate-500">
              for “{results[0]?.keyword}”
            </span>
          }
        >
          <Table>
            <thead>
              <tr>
                <th className="th">Idea</th>
                <th className="th">Searches/mo*</th>
                <th className="th">Intent</th>
                <th className="th">Popularity</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {data.ideas.map((k: any) => (
                <tr
                  key={k.keyword}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="td">{k.keyword}</td>
                  <td className="td">{nf(k.volume)}</td>
                  <td className="td">
                    <Badge tone={intentTone(k.intent)}>{k.intent}</Badge>
                  </td>
                  <td className="td">
                    {"●".repeat(Math.min(k.popularity, 5))}
                  </td>
                  <td className="td">
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => pick(k.keyword)}
                    >
                      Look up
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ======================================================================================================================
// 2. My keyword bank
// ======================================================================================================================
function Bank() {
  const [country, setCountry] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [sort, setSort] = useState<"volume" | "kd" | "last" | "az">("last");

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(
        await fn("keywordlab", {
          action: "bank",
          country: country === "all" ? undefined : country,
          q,
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [country]);

  const rows: any[] = useMemo(() => {
    const r = [...(data?.rows ?? [])];
    r.sort((a, b) =>
      sort === "volume"
        ? (b.volume ?? -1) - (a.volume ?? -1)
        : sort === "kd"
          ? (a.kd ?? 999) - (b.kd ?? 999)
          : sort === "az"
            ? a.keyword.localeCompare(b.keyword)
            : Date.parse(b.lastAt) - Date.parse(a.lastAt),
    );
    return r;
  }, [data, sort]);
  const st = data?.stats;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Keywords in your list"
          value={st ? nf(st.mine) : "–"}
          sub="searched here or tracked from the Dashboard"
        />
        <Stat
          label="Keywords in the shared bank"
          value={st ? nf(st.sharedKeywords) : "–"}
          sub="numbers saved once, reused by every check"
        />
        <Stat
          label="Google results saved"
          value={st ? nf(st.serpSaved) : "–"}
          sub="kept for 3 days so repeat lookups are instant"
        />
      </div>
      <ErrorNote message={err} />
      <Card
        title="Your keyword bank"
        right={
          <button
            className="btn-ghost"
            disabled={!rows.length}
            onClick={() =>
              download("keyword-bank.pdf", [
                [
                  "Keyword",
                  "Country",
                  "Searches/mo",
                  "Low",
                  "High",
                  "Difficulty",
                  "Intent",
                  "Site",
                  "Times searched",
                  "Last searched",
                ],
                ...rows.map((r) => [
                  r.keyword,
                  r.country.toUpperCase(),
                  r.volume,
                  r.volumeLow,
                  r.volumeHigh,
                  r.kd,
                  r.intent,
                  r.host,
                  r.lookups,
                  r.lastAt,
                ]),
              ])
            }
          >
            <Download className="h-4 w-4" /> Download PDF
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className="input !w-56"
            placeholder="Filter keywords…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <Select
            aria-label="Country"
            className="input !w-auto"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="all">All countries</option>
            {COUNTRIES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort"
            className="input !w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="last">Newest first</option>
            <option value="volume">Highest volume</option>
            <option value="kd">Easiest first</option>
            <option value="az">A to Z</option>
          </Select>
          <button className="btn-ghost" onClick={load} disabled={busy}>
            {busy ? <Spinner /> : "Search"}
          </button>
        </div>
        {!busy && rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing saved yet. Look up a keyword in the Explore tab, or run a
            website check on the Dashboard: every keyword it checks is saved
            here.
          </p>
        ) : (
          <div className="scroll-thin max-h-[560px] overflow-auto">
            <Table>
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr>
                  <th className="th">Keyword</th>
                  <th className="th">Country</th>
                  <th className="th">Searches/mo*</th>
                  <th className="th">Difficulty*</th>
                  <th className="th">Intent</th>
                  <th className="th">From site</th>
                  <th className="th">Searched</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.keyword}|${r.country}`}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="td font-medium">{r.keyword}</td>
                    <td className="td">{r.country.toUpperCase()}</td>
                    <td className="td">
                      {nf(r.volume)}
                      <div className="text-xs text-slate-400">
                        {rangeText(r)}
                      </div>
                    </td>
                    <td className="td">
                      {r.kd == null ? (
                        <span className="text-slate-400">–</span>
                      ) : (
                        <Badge
                          tone={kdTone(r.kd)}
                        >{`${r.kd} · ${r.kdLabel}`}</Badge>
                      )}
                    </td>
                    <td className="td">
                      {r.intent ? (
                        <Badge tone={intentTone(r.intent)}>{r.intent}</Badge>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {r.host ?? "Keyword Lab"}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {r.lookups}× · {day(r.lastAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ======================================================================================================================
// 3. Rank history and trends (read straight from your tables, protected by row level security)
// ======================================================================================================================
async function pageAll(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>,
) {
  const all: any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

function History({
  hosts,
  initialHost,
}: {
  hosts: string[];
  initialHost: string;
}) {
  const [host, setHost] = useState(initialHost || hosts[0] || "");
  const [country, setCountry] = useState("gb");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kw, setKw] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!host) return;
    let live = true;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const since = new Date(Date.now() - 180 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const rows = await pageAll((a, b) =>
          supabase
            .from("keyword_rank_history")
            .select("keyword, position, checked_on, volume, kd")
            .eq("host", host)
            .eq("country", country)
            .gte("checked_on", since)
            .order("checked_on", { ascending: true })
            .order("keyword")
            .range(a, b),
        );
        const { data: sn, error } = await supabase
          .from("site_snapshots")
          .select("*")
          .eq("host", host)
          .in("country", [country, "all"])
          .gte("checked_on", since)
          .order("checked_on", { ascending: true });
        if (error)
          throw new Error(
            "History could not be loaded. Please try again later.",
          );
        if (!live) return;
        type Series = {
          keyword: string;
          series: (number | null)[];
          dates: string[];
          volume: number | null;
          kd: number | null;
        };
        const by = new Map<string, Series>();
        for (const r of rows) {
          const e: Series = by.get(r.keyword) ?? {
            keyword: r.keyword,
            series: [],
            dates: [],
            volume: null,
            kd: null,
          };
          e.series.push(r.position);
          e.dates.push(r.checked_on);
          e.volume = r.volume ?? e.volume;
          e.kd = r.kd ?? e.kd;
          by.set(r.keyword, e);
        }
        setKw([...by.values()]);
        const merged = new Map<string, any>();
        for (const s of sn ?? []) {
          const m = merged.get(s.checked_on) ?? { date: s.checked_on };
          for (const [k, v] of Object.entries(s))
            if (
              v != null &&
              ![
                "id",
                "user_id",
                "host",
                "country",
                "checked_on",
                "created_at",
              ].includes(k)
            )
              m[k] = Number(v);
          merged.set(s.checked_on, m);
        }
        setSnaps([...merged.values()]);
      } catch (e) {
        if (live) setErr((e as Error).message);
      }
      if (live) setBusy(false);
    })();
    return () => {
      live = false;
    };
  }, [host, country]);

  const rows = useMemo(
    () =>
      kw
        .map((k) => {
          const last = k.series[k.series.length - 1] ?? null;
          const prev =
            k.series.length > 1 ? k.series[k.series.length - 2] : undefined;
          const real = k.series.filter(
            (p: number | null): p is number => p != null,
          );
          let change: number | null = null,
            tag = "";
          if (prev !== undefined) {
            if (last != null && prev != null) {
              change = prev - last;
              tag = change > 0 ? "up" : change < 0 ? "down" : "same";
            } else if (last != null && prev == null) tag = "new";
            else if (last == null && prev != null) tag = "lost";
          }
          return {
            ...k,
            last,
            best: real.length ? Math.min(...real) : null,
            change,
            tag,
            checks: k.series.length,
          };
        })
        .filter((k) => !filter || k.keyword.includes(filter.toLowerCase()))
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
    [kw, filter],
  );

  const nUp = rows.filter((r) => r.tag === "up" || r.tag === "new").length;
  const nDown = rows.filter((r) => r.tag === "down" || r.tag === "lost").length;
  const hasLinks = snaps.some((s) => s.linking_domains != null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {hosts.length > 0 ? (
          <Select
            aria-label="Website"
            className="input !w-auto"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        ) : (
          <input
            className="input !w-64"
            placeholder="example.com"
            value={host}
            onChange={(e) => setHost(hostOf(e.target.value))}
          />
        )}
        <CountrySelect value={country} onChange={setCountry} />
        {busy && <Spinner />}
      </div>
      <ErrorNote message={err} />

      {!busy && !err && kw.length === 0 && snaps.length === 0 && (
        <div className="card py-10 text-center text-sm text-slate-500">
          No history yet for {host || "this site"} in {country.toUpperCase()}.
          Every website check on the Dashboard adds one point per keyword (one
          per day), so trends appear from the second check onwards.
        </div>
      )}

      {snaps.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Organic visits and ranking keywords">
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart
                  data={snaps}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="a" tick={{ fontSize: 11 }} width={44} />
                  <YAxis
                    yAxisId="b"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={34}
                  />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="a"
                    type="monotone"
                    dataKey="visits_mid"
                    name="Visits/mo (est.)"
                    stroke="#5b38ee"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="b"
                    type="monotone"
                    dataKey="keywords_ranking"
                    name="Keywords ranking"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="b"
                    type="monotone"
                    dataKey="top10"
                    name="In top 10"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card
            title="Site health and backlinks"
            right={
              !hasLinks ? (
                <span className="text-xs text-slate-500">
                  run the backlink check to add link growth
                </span>
              ) : undefined
            }
          >
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart
                  data={snaps}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="a"
                    tick={{ fontSize: 11 }}
                    width={34}
                    domain={[0, 100]}
                  />
                  <YAxis
                    yAxisId="b"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={34}
                  />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="a"
                    type="monotone"
                    dataKey="health"
                    name="Site health"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="b"
                    type="monotone"
                    dataKey="linking_domains"
                    name="Linking domains"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="b"
                    type="monotone"
                    dataKey="verified_links"
                    name="Verified links"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {kw.length > 0 && (
        <Card
          title="Keyword positions over time"
          right={
            <div className="flex items-center gap-2">
              <Badge tone="green">{`▲ ${nUp}`}</Badge>
              <Badge tone="red">{`▼ ${nDown}`}</Badge>
              <input
                className="input !w-44"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                className="btn-ghost"
                onClick={() =>
                  download(`rank-history-${host}-${country}.pdf`, [
                    ["Keyword", "Date", "Position"],
                    ...kw.flatMap((k) =>
                      k.series.map((p: number | null, i: number) => [
                        k.keyword,
                        k.dates[i],
                        p,
                      ]),
                    ),
                  ])
                }
              >
                <Download className="h-4 w-4" /> PDF
              </button>
            </div>
          }
        >
          <div className="scroll-thin max-h-[560px] overflow-auto">
            <Table>
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr>
                  <th className="th">Keyword</th>
                  <th className="th">Now</th>
                  <th className="th">Change</th>
                  <th className="th">Best</th>
                  <th className="th">Trend</th>
                  <th className="th">Searches/mo*</th>
                  <th className="th">Difficulty*</th>
                  <th className="th">Checks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.keyword}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="td font-medium">{r.keyword}</td>
                    <td className="td">
                      {r.last ? (
                        <Badge tone={posTone(r.last)}>{r.last}</Badge>
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                    <td className="td">
                      {r.tag === "up" && (
                        <Badge tone="green">{`▲ ${r.change}`}</Badge>
                      )}
                      {r.tag === "down" && (
                        <Badge tone="red">{`▼ ${Math.abs(r.change)}`}</Badge>
                      )}
                      {r.tag === "new" && <Badge tone="green">new rank</Badge>}
                      {r.tag === "lost" && <Badge tone="red">lost</Badge>}
                      {(r.tag === "same" || !r.tag) && (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                    <td className="td">{r.best ?? "–"}</td>
                    <td className="td">
                      <PosSpark series={r.series} />
                    </td>
                    <td className="td">{nf(r.volume)}</td>
                    <td className="td">
                      {r.kd == null ? (
                        <span className="text-slate-400">–</span>
                      ) : (
                        <Badge tone={kdTone(r.kd)}>{r.kd}</Badge>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">{r.checks}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Positions are real Google positions from each check (one point per
            day). Lower is better; the trend line is drawn with #1 at the top. A
            gap in the line means the site was not in the checked results that
            day.
          </p>
        </Card>
      )}
    </div>
  );
}

// ======================================================================================================================
// 4. Link gap: sites that link to a competitor (from the link bank) but not to you
// ======================================================================================================================
function Gap({ hosts, initialHost }: { hosts: string[]; initialHost: string }) {
  const [host, setHost] = useState(initialHost || hosts[0] || "");
  const [competitor, setCompetitor] = useState("");
  const [suggest, setSuggest] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!host) return;
    let live = true;
    (async () => {
      const { data: d } = await supabase
        .from("research_runs")
        .select("competitors:result->competitors")
        .eq("host", host)
        .order("created_at", { ascending: false })
        .limit(1);
      const list = ((d?.[0] as any)?.competitors ?? []) as { domain: string }[];
      if (live)
        setSuggest(
          list
            .map((c) => c.domain)
            .filter(Boolean)
            .slice(0, 8),
        );
    })();
    return () => {
      live = false;
    };
  }, [host]);

  const find = async (comp = competitor) => {
    const c = hostOf(comp);
    if (!host || !c) return;
    setBusy(true);
    setErr(null);
    setProg("");
    try {
      setData(await fn("keywordlab", { action: "gap", host, competitor: c }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  /** Same three steps as the backlink panel (find, check pages in small batches, save), run for the competitor so its links enter the bank. */
  const checkCompetitor = async () => {
    const c = hostOf(competitor);
    if (!c) return;
    setBusy(true);
    setErr(null);
    try {
      setProg(`Searching the web for pages that link to ${c}…`);
      const d = await fn("backlinks", { url: c, action: "discover" });
      const cands = (d.cands ?? []) as any[];
      const batches: any[][] = [];
      for (let i = 0; i < cands.length; i += 10)
        batches.push(cands.slice(i, i + 10));
      const all: any[] = [];
      let authorityUsed = false,
        done = 0,
        next = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, batches.length) }, async () => {
          while (next < batches.length) {
            const mine = batches[next++];
            try {
              const v = await fn("backlinks", {
                url: c,
                action: "verify",
                brand: d.brand,
                cands: mine,
              });
              authorityUsed = authorityUsed || !!v.authorityUsed;
              all.push(...v.rows);
            } catch {
              /* one failed batch must not stop the rest */
            }
            done += mine.length;
            setProg(`Checked ${done} of ${cands.length} pages…`);
          }
        }),
      );
      setProg("Saving the links…");
      await fn("backlinks", {
        url: c,
        action: "finish",
        rows: all,
        indexRows: d.indexRows,
        brand: d.brand,
        notes: d.notes ?? [],
        authorityUsed,
        pagesFound: d.pagesFound,
        requests: d.requests,
        sourceCounts: d.sourceCounts,
        totalBacklinks: d.totalBacklinks,
        totalDomains: d.totalDomains,
      });
      setProg("");
      setData(await fn("keywordlab", { action: "gap", host, competitor: c }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setProg("");
    setBusy(false);
  };

  const g = data;
  return (
    <div className="grid gap-4">
      <Card title="Link gap">
        <div className="flex flex-wrap items-center gap-2">
          {hosts.length > 0 ? (
            <Select
              aria-label="Your website"
              className="input !w-auto"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            >
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          ) : (
            <input
              className="input !w-56"
              placeholder="your-site.com"
              value={host}
              onChange={(e) => setHost(hostOf(e.target.value))}
            />
          )}
          <span className="text-sm text-slate-500">vs</span>
          <input
            className="input !w-64"
            placeholder="competitor.com"
            value={competitor}
            onChange={(e) => setCompetitor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && find()}
          />
          <button
            className="btn"
            disabled={busy || !competitor.trim() || !host}
            onClick={() => find()}
          >
            {busy && !prog ? <Spinner /> : null} Find link gap
          </button>
        </div>
        {suggest.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">
              Competitors from your last check:
            </span>
            {suggest.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setCompetitor(s);
                  find(s);
                }}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Shows websites that link to the competitor but not to you: the best
          places to ask for a link. It uses the links saved in your link bank,
          so the competitor must have been checked once.
        </p>
      </Card>
      <ErrorNote message={err} />
      {prog && (
        <div className="card flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Spinner className="h-5 w-5" /> {prog}
        </div>
      )}

      {g && !g.hasData && !prog && (
        <div className="card flex flex-col items-center gap-3 py-8 text-center">
          <p className="max-w-lg text-sm text-slate-600 dark:text-slate-300">
            No links are saved for <b>{g.competitor}</b> yet. Check its
            backlinks once (about a minute) and they stay in your link bank.
          </p>
          <button className="btn" disabled={busy} onClick={checkCompetitor}>
            Check {g.competitor} backlinks now
          </button>
        </div>
      )}

      {g?.hasData && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat
              label={`${g.competitor} links saved`}
              value={nf(g.competitorLinks)}
              sub={`${nf(g.competitorDomains)} linking sites`}
            />
            <Stat
              label={`${g.me} linking sites saved`}
              value={nf(g.myDomains)}
              sub="in your link bank"
            />
            <Stat
              label="Link gap"
              value={nf(g.gapCount)}
              sub="sites that link to them, not to you"
            />
            <div className="card !p-4 flex items-center">
              <button
                className="btn-ghost w-full"
                disabled={busy}
                onClick={checkCompetitor}
              >
                Refresh competitor links
              </button>
            </div>
          </div>
          <Card
            title="Sites to ask for a link"
            right={
              <button
                className="btn-ghost"
                disabled={!g.gap.length}
                onClick={() =>
                  download(`link-gap-${g.me}-vs-${g.competitor}.pdf`, [
                    [
                      "Site",
                      "Authority",
                      "Links to competitor",
                      "Anchor",
                      "Example page",
                    ],
                    ...g.gap.map((r: any) => [
                      r.domain,
                      r.authority,
                      r.links,
                      r.anchor,
                      r.url,
                    ]),
                  ])
                }
              >
                <Download className="h-4 w-4" /> PDF
              </button>
            }
          >
            {g.gap.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing missing: every site saved for {g.competitor} also links
                to you.
              </p>
            ) : (
              <div className="scroll-thin max-h-[520px] overflow-auto">
                <Table>
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <th className="th">Site</th>
                      <th className="th">Authority</th>
                      <th className="th">Type</th>
                      <th className="th">Anchor text</th>
                      <th className="th">Example page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.gap.map((r: any) => (
                      <tr
                        key={r.domain}
                        className="border-t border-slate-100 dark:border-slate-800"
                      >
                        <td className="td font-medium">
                          {r.domain}
                          {r.links > 1 && (
                            <span className="ml-1 text-xs text-slate-400">
                              ×{r.links}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          {r.authority == null ? (
                            <span className="text-slate-400">–</span>
                          ) : (
                            <Badge
                              tone={
                                r.authority >= 40
                                  ? "green"
                                  : r.authority >= 20
                                    ? "amber"
                                    : "slate"
                              }
                            >
                              {r.authority}
                            </Badge>
                          )}
                        </td>
                        <td className="td text-xs">
                          {r.rel === "dofollow" ? (
                            <Badge tone="green">follow</Badge>
                          ) : (
                            <Badge>{r.rel ?? "–"}</Badge>
                          )}
                        </td>
                        <td className="td max-w-[200px] truncate text-xs text-slate-500">
                          {r.anchor || "–"}
                        </td>
                        <td className="td max-w-[280px] truncate text-xs">
                          <a
                            className="text-brand-700 hover:underline dark:text-brand-300"
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.url}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ======================================================================================================================
// 5. Data bank: what the tool has learned so far (migration 010)
// ======================================================================================================================
function DataBank() {
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [country, setCountry] = useState("gb");
  const [dom, setDom] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uni, setUni] = useState<any[] | null>(null);
  const [uniErr, setUniErr] = useState<string | null>(null);
  const [uniQ, setUniQ] = useState("");

  useEffect(() => {
    fn("keywordlab", { action: "stats" })
      .then(setStats)
      .catch((e) => setErr((e as Error).message));
  }, []);

  const lookup = async () => {
    const d = hostOf(domain);
    if (!d) return;
    setBusy(true);
    setErr(null);
    try {
      setDom(await fn("keywordlab", { action: "domain", domain: d, country }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const loadUniverse = async () => {
    setUniErr(null);
    try {
      const r = await fn("keywordlab", {
        action: "universe",
        q: uniQ,
        limit: 1000,
      });
      setUni(r.rows ?? []);
    } catch (e) {
      setUniErr((e as Error).message);
    }
  };

  const cal = stats?.calibration;
  return (
    <div className="space-y-4">
      <ErrorNote message={err} />
      {!stats && !err && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Loading…
        </div>
      )}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Keywords in the universe"
              value={nf(stats.universe)}
              sub="every keyword ever seen, kept forever"
            />
            <Stat
              label="Keywords with numbers"
              value={nf(stats.with_volume)}
              sub={`${nf(stats.with_gsc)} have a TRUE volume (Search Console)`}
            />
            <Stat
              label="Ranking rows saved"
              value={nf(stats.serp_rows)}
              sub={`${nf(stats.domains)} different domains`}
            />
            <Stat
              label="Backlinks saved"
              value={nf(stats.links)}
              sub={`from ${nf(stats.link_domains)} linking sites`}
            />
          </div>
          <Card title="Volume correction learned from Search Console">
            {cal && cal.samples >= 15 ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Calculated volumes are adjusted by <b>{cal.factor}</b> (learned
                from {nf(cal.samples)} keywords that have both a calculated
                number and a real Search Console number; the middle half of
                keywords sit between ×{cal.p25} and ×{cal.p75}). More connected
                sites means a better correction.
              </p>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Not learned yet ({nf(cal?.samples ?? 0)} of 15 keywords needed).
                Connect Search Console for a site and run its Domain Research
                report: its real queries become true volumes and start the
                correction.
              </p>
            )}
          </Card>
        </>
      )}

      <Card
        title="What does the bank know about a domain?"
        right={
          <div className="flex items-center gap-2">
            <input
              className="input !w-56"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
            <CountrySelect value={country} onChange={setCountry} />
            <button className="btn-primary" onClick={lookup} disabled={busy}>
              {busy ? <Spinner /> : <Search className="h-4 w-4" />} Look up
            </button>
          </div>
        }
      >
        {!dom && (
          <p className="text-sm text-slate-500">
            Shows every keyword where the domain appeared in a saved Google
            result, with the saved volume and the visits it likely brings. It
            grows with every search anyone makes in this tool.
          </p>
        )}
        {dom && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="Keywords known"
                value={nf(dom.keywords)}
                sub={
                  dom.unvolumed
                    ? `${nf(dom.unvolumed)} more without a volume yet`
                    : undefined
                }
              />
              <Stat
                label="Visits/mo (est.)"
                value={nf(dom.visits)}
                sub="volume × click rate"
              />
              <Stat
                label="In top 3 / top 10"
                value={`${nf(dom.top3)} / ${nf(dom.top10)}`}
              />
              <Stat
                label="True volumes"
                value={nf(dom.trueVolumes)}
                sub="from Search Console"
              />
            </div>
            {dom.note && <p className="text-sm text-slate-500">{dom.note}</p>}
            {dom.rows?.length > 0 && (
              <>
                <div className="flex justify-end">
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      download(`bank-${dom.domain}-${dom.country}.pdf`, [
                        [
                          "Keyword",
                          "Position",
                          "Searches/mo",
                          "Visits/mo",
                          "True volume",
                        ],
                        ...dom.rows.map((r: any) => [
                          r.keyword,
                          r.position,
                          r.volume,
                          r.visits,
                          r.truth ? "yes" : "",
                        ]),
                      ])
                    }
                  >
                    <Download className="h-4 w-4" /> PDF
                  </button>
                </div>
                <div className="scroll-thin max-h-[420px] overflow-auto">
                  <Table>
                    <thead className="sticky top-0 bg-white dark:bg-slate-900">
                      <tr>
                        <th className="th">Keyword</th>
                        <th className="th">Position</th>
                        <th className="th">Searches/mo</th>
                        <th className="th">Visits/mo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dom.rows.map((r: any) => (
                        <tr
                          key={r.keyword}
                          className="border-t border-slate-100 dark:border-slate-800"
                        >
                          <td className="td font-medium">{r.keyword}</td>
                          <td className="td">
                            <Badge tone={posTone(r.position)}>
                              {r.position}
                            </Badge>
                          </td>
                          <td className="td">
                            {nf(r.volume)}{" "}
                            {r.truth && <Badge tone="green">true</Badge>}
                          </td>
                          <td className="td">{nf(r.visits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Keyword universe (download everything)"
        right={
          <div className="flex items-center gap-2">
            <input
              className="input !w-48"
              placeholder="Filter…"
              value={uniQ}
              onChange={(e) => setUniQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUniverse()}
            />
            <button className="btn-ghost" onClick={loadUniverse}>
              Load
            </button>
            {uni && uni.length > 0 && (
              <button
                className="btn-ghost"
                onClick={() =>
                  download("keyword-universe.pdf", [
                    [
                      "Keyword",
                      "Country",
                      "Sources",
                      "Seed",
                      "Times seen",
                      "First seen",
                      "Last seen",
                      "Searches/mo",
                      "True volume",
                      "Difficulty",
                      "Intent",
                    ],
                    ...uni.map((r) => [
                      r.keyword,
                      r.country,
                      (r.sources ?? []).join("|"),
                      r.seed,
                      r.seen,
                      r.firstSeen,
                      r.lastSeen,
                      r.volume,
                      r.trueVolume ? "yes" : "",
                      r.kd,
                      r.intent,
                    ]),
                  ])
                }
              >
                <Download className="h-4 w-4" /> PDF
              </button>
            )}
          </div>
        }
      >
        <ErrorNote message={uniErr} />
        {!uni && !uniErr && (
          <p className="text-sm text-slate-500">
            Autocomplete ideas, related searches, people-also-ask, keywords
            found on sites and Search Console queries, all in one list (newest
            first, up to 1,000 per load). Only admin accounts can open it,
            because it also shows which sites were researched.
          </p>
        )}
        {uni && (
          <div className="scroll-thin max-h-[420px] overflow-auto">
            <Table>
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr>
                  <th className="th">Keyword</th>
                  <th className="th">Country</th>
                  <th className="th">Found by</th>
                  <th className="th">Seen</th>
                  <th className="th">Searches/mo</th>
                  <th className="th">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {uni.map((r) => (
                  <tr
                    key={`${r.keyword}|${r.country}`}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="td font-medium">{r.keyword}</td>
                    <td className="td uppercase">{r.country}</td>
                    <td className="td text-xs">
                      {(r.sources ?? []).join(", ")}
                    </td>
                    <td className="td">{r.seen}</td>
                    <td className="td">
                      {nf(r.volume)}{" "}
                      {r.trueVolume && <Badge tone="green">true</Badge>}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {day(r.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ======================================================================================================================
export default function KeywordLab() {
  const { sites, current } = useSite();
  const hosts = useMemo(
    () => [...new Set(sites.map((s) => hostOf(s.url)).filter(Boolean))],
    [sites],
  );
  const initial = current ? hostOf(current.url) : (hosts[0] ?? "");
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<
    "explore" | "bank" | "history" | "gap" | "databank"
  >("explore");

  return (
    <div>
      <PageHeader
        title="Keyword Lab"
        sub="Your own keyword, rank and link database: everything you search is saved and reused."
      />
      <div className="mb-4">
        <Tabs
          tabs={[
            { id: "explore", label: "Explore keywords" },
            { id: "bank", label: "My keyword bank" },
            { id: "history", label: "Rank history" },
            { id: "gap", label: "Link gap" },
            // how much data the tool has collected is for the admin only; normal users never see this tab
            ...(isAdmin ? [{ id: "databank" as const, label: "Data bank" }] : []),
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "explore" && <Explore host={initial} />}
      {tab === "bank" && <Bank />}
      {tab === "history" && <History hosts={hosts} initialHost={initial} />}
      {tab === "gap" && <Gap hosts={hosts} initialHost={initial} />}
      {tab === "databank" && isAdmin && <DataBank />}
    </div>
  );
}