import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { fn } from "../lib/supabase";
import { publicText } from "../lib/clean";
import { uniqBy } from "../lib/dedupe";
import { Badge, Spinner } from "./ui";
import { Dot, healthColor, Panel, Ring } from "./dash";

type Row = {
  url: string;
  domain: string;
  title: string;
  verified: boolean;
  anchor: string | null;
  anchorType: string | null;
  rel: string | null;
  links: number;
  unreachable: boolean;
  mentioned: boolean;
  authority: number | null;
  power: number | null;
  isNew: boolean;
  reason?: string | null;
  mentionKind?: "url" | "brand" | null;
  sources?: string[];
  placement?: string | null;
  target?: string | null;
  outbound?: number | null;
  wrapped?: boolean;
};
export type Backlinks = {
  host: string;
  brand?: string;
  createdAt: string;
  cached?: boolean;
  authorityUsed: boolean;
  indexUsed?: boolean;
  notes: string[];
  requests?: number;
  summary: {
    pagesFound: number;
    domainsChecked: number;
    verified: number;
    linkingDomains: number;
    mentionsOnly: number;
    unlinkedMentions: number;
    dofollow: number;
    nofollow: number;
    avgAuthority: number | null;
    strong: number;
    average: number;
    weak: number;
    score: number;
    anchors: Record<string, number>;
    newLinks: number;
    lost: number;
    hasPrevious: boolean;
    placements: Record<string, number>;
    topPages: { url: string; links: number; domains: number }[];
    sourceCounts: Record<string, number>;
    totalBacklinks: number | null;
    totalDomains: number | null;
    blocked: number;
  };
  rows: Row[];
  lost: { url: string; domain: string }[];
};

const PLACES: [string, string, string][] = [
  ["content", "In the article / page content", "#16a34a"],
  ["sidebar", "Sidebar", "#3b82f6"],
  ["nav", "Menu / header", "#d97706"],
  ["footer", "Footer (often sitewide)", "#94a3b8"],
  ["comment", "Comments", "#dc2626"],
];
const shortPath = (u: string) => {
  try {
    const x = new URL(u);
    return (
      x.host.replace(/^www\./, "") + (x.pathname === "/" ? "" : x.pathname)
    );
  } catch {
    return u;
  }
};

const tone = (a: number | null) =>
  a == null ? "#94a3b8" : a >= 40 ? "#16a34a" : a >= 20 ? "#d97706" : "#dc2626";
const label = (a: number | null) =>
  a == null ? "No score" : a >= 40 ? "Strong" : a >= 20 ? "Average" : "Weak";
const ANCHORS: [string, string, string][] = [
  ["brand", "Brand name", "#16a34a"],
  ["url", "Web address", "#3b82f6"],
  ["keyword", "Keyword / phrase", "#d97706"],
  ["generic", "Generic (click here)", "#94a3b8"],
  ["image", "Image", "#8b5cf6"],
];

const outreach = (r: Row, host: string) =>
  `Subject: Quick thank-you (and a small request)\n\nHi,\n\nI came across your page "${r.title || r.url}" and noticed you mentioned ${host}. Thank you, that means a lot.\n\nWould you be happy to turn the mention into a link to https://${host}? It would help your readers find us easily.\n\nThanks so much,\n`;

/** Old saved results may miss newer fields. Fill safe defaults so the panel never crashes. */
const normalize = (r: any): Backlinks => {
  const s = r?.summary ?? {};
  return {
    ...r,
    authorityUsed: !!r?.authorityUsed,
    notes: Array.isArray(r?.notes) ? r.notes : [],
    rows: uniqBy(
      Array.isArray(r?.rows) ? r.rows : [],
      (x: any) =>
        String(x?.url ?? "")
          .trim()
          .toLowerCase()
          .replace(/#.*$/, "")
          .replace(/\/+$/, ""),
      (a: any, b: any) => !!a?.verified && !b?.verified,
    ),
    lost: uniqBy(Array.isArray(r?.lost) ? r.lost : [], (x: any) =>
      String(x?.url ?? "")
        .trim()
        .toLowerCase(),
    ),
    summary: {
      pagesFound: 0,
      domainsChecked: 0,
      verified: 0,
      linkingDomains: 0,
      mentionsOnly: 0,
      unlinkedMentions: 0,
      dofollow: 0,
      nofollow: 0,
      avgAuthority: null,
      strong: 0,
      average: 0,
      weak: 0,
      score: 0,
      newLinks: 0,
      lost: 0,
      hasPrevious: false,
      totalBacklinks: null,
      totalDomains: null,
      blocked: 0,
      ...s,
      anchors: s.anchors && typeof s.anchors === "object" ? s.anchors : {},
      placements:
        s.placements && typeof s.placements === "object" ? s.placements : {},
      sourceCounts:
        s.sourceCounts && typeof s.sourceCounts === "object"
          ? s.sourceCounts
          : {},
      topPages: Array.isArray(s.topPages) ? s.topPages : [],
    },
  };
};

// the last "Analyze" / "Re-run" request this panel already handled, so a remount never runs it twice
let handledTrigger = 0;

/** Backlinks found through Google, each opened and checked for a real link, then scored by domain authority. */
export default function BacklinksPanel({
  url,
  host,
  onLoaded,
  crawl,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  url: string;
  host: string;
  onLoaded?: (b: Backlinks | null) => void;
  crawl?: { internal?: number; external?: number } | null;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** set by the Dashboard every time Analyze / Re-run is pressed: the backlinks run together with the check */
  trigger?: { id: number; force: boolean } | null;
}) {
  const [openInner, setOpenInner] = useState(false);
  const open = openProp ?? openInner;
  const setOpen = (v: boolean) => {
    setOpenInner(v);
    onOpenChange?.(v);
  };
  const [bl, setBl] = useState<Backlinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [only, setOnly] = useState<"verified" | "strong" | "mentions">(
    "verified",
  );
  const [copied, setCopied] = useState<string | null>(null);

  const [live, setLive] = useState<Row[]>([]);
  const [prog, setProg] = useState<{
    text: string;
    done: number;
    total: number;
  }>({ text: "", done: 0, total: 0 });

  // Every answer that comes back late for a website the user has already left is thrown away
  // (before: a slow run of site A could finish after switching to site B and show A's backlinks on B).
  const runRef = useRef(0);

  /** The saved result of the last run (free and instant). */
  const loadSaved = async () => {
    const my = runRef.current;
    try {
      const r = await fn("backlinks", { url, action: "cache" });
      if (runRef.current !== my) return;
      if (r.miss) {
        setBl(null);
        onLoaded?.(null);
      } else {
        const n = normalize(r);
        setBl(n);
        onLoaded?.(n);
      }
    } catch {
      /* no saved result yet */
    }
  };

  /** A run is split into small calls (find, then check 10 pages at a time, then score) so one slow site can never break it.
   *  Every confirmed backlink shows up in the table right away. */
  const run = async () => {
    const my = ++runRef.current;
    const fresh = () => runRef.current === my;
    setBusy(true);
    setErr(null);
    setLive([]);
    setProg({
      text: "Searching the web for pages that mention this site…",
      done: 0,
      total: 0,
    });
    try {
      const d = await fn("backlinks", { url, action: "discover" });
      if (!fresh()) return;
      const cands = (d.cands ?? []) as any[];
      const batches: any[][] = [];
      for (let i = 0; i < cands.length; i += 12)
        batches.push(cands.slice(i, i + 12));
      const all: Row[] = [];
      const notes: string[] = [...(d.notes ?? [])];
      let authorityUsed = false,
        failed = 0,
        done = 0,
        next = 0;
      setProg({
        text: `Opening ${cands.length} pages and checking their links…`,
        done: 0,
        total: cands.length,
      });
      await Promise.all(
        Array.from({ length: Math.min(5, batches.length) }, async () => {
          while (next < batches.length && fresh()) {
            const mine = batches[next++];
            try {
              const v = await fn("backlinks", {
                url,
                action: "verify",
                brand: d.brand,
                cands: mine,
              });
              if (!fresh()) return;
              authorityUsed = authorityUsed || !!v.authorityUsed;
              all.push(...(v.rows as Row[]));
              setLive(
                uniqBy(
                  [...all],
                  (x: any) =>
                    String(x?.url ?? "")
                      .trim()
                      .toLowerCase()
                      .replace(/#.*$/, "")
                      .replace(/\/+$/, ""),
                  (a: any, b: any) => !!a?.verified && !b?.verified,
                ).sort(
                  (x, y) =>
                    Number(y.verified) - Number(x.verified) ||
                    (y.power ?? -1) - (x.power ?? -1),
                ),
              );
            } catch {
              failed += mine.length;
            }
            done += mine.length;
            setProg({
              text: `Checked ${done} of ${cands.length} pages…`,
              done,
              total: cands.length,
            });
          }
        }),
      );
      if (!fresh()) return;
      if (failed)
        notes.push(
          `${failed} pages could not be checked because the server stopped on them. Press Find again to retry.`,
        );
      setProg({
        text: "Scoring the backlinks…",
        done: cands.length,
        total: cands.length,
      });
      try {
        const r = await fn("backlinks", {
          url,
          action: "finish",
          rows: all,
          indexRows: d.indexRows,
          brand: d.brand,
          notes,
          authorityUsed,
          pagesFound: d.pagesFound,
          requests: d.requests,
          sourceCounts: d.sourceCounts,
          totalBacklinks: d.totalBacklinks,
          totalDomains: d.totalDomains,
        });
        if (!fresh()) return;
        const n = normalize(r);
        setBl(n);
        onLoaded?.(n);
        setLive([]);
      } catch (e) {
        if (!fresh()) return;
        // scoring failed, but the confirmed backlinks stay on screen
        setBl(null);
        onLoaded?.(null);
        setErr(
          `Could not save the final score (${(e as Error).message}). The backlinks found are shown below.`,
        );
      }
    } catch (e) {
      if (!fresh()) return;
      setErr((e as Error).message);
    }
    if (fresh()) setBusy(false);
  };
  useEffect(() => {
    runRef.current++; // a run of the previous website is no longer allowed to show anything
    setBusy(false);
    setBl(null);
    onLoaded?.(null);
    setLive([]);
    loadSaved(); /* eslint-disable-next-line */
  }, [host]);

  // Analyze / Re-run pressed: Analyze reuses a saved result (free) and only searches when there is none,
  // "Re-run with fresh data" always searches again
  useEffect(() => {
    if (!trigger || trigger.id === handledTrigger) return;
    handledTrigger = trigger.id;
    (async () => {
      if (trigger.force) return run();
      try {
        const r = await fn("backlinks", { url, action: "cache" });
        if (r.miss) await run();
      } catch {
        await run();
      }
    })(); /* eslint-disable-next-line */
  }, [trigger?.id]);

  const s = bl?.summary;
  const rows = (bl?.rows ?? []).filter((r) =>
    only === "mentions"
      ? !r.verified
      : only === "verified"
        ? r.verified
        : r.verified && (r.authority ?? 0) >= 40,
  );
  const total = Math.max(
    (s?.strong ?? 0) + (s?.average ?? 0) + (s?.weak ?? 0),
    1,
  );
  const anchorTotal = Math.max(
    Object.values(s?.anchors ?? {}).reduce((a, b) => a + b, 0),
    1,
  );
  const copy = async (r: Row) => {
    try {
      await navigator.clipboard.writeText(outreach(r, host));
      setCopied(r.url);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const table = (list: Row[], mentionsMode: boolean, emptyText: string) => (
    <div className="scroll-thin max-h-[460px] overflow-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead className="sticky top-0 bg-white dark:bg-slate-900">
          <tr>
            <th className="th !pl-0">Linking page</th>
            <th className="th">Authority</th>
            <th className="th">Anchor text</th>
            <th className="th">Type</th>
            <th className="th">{mentionsMode ? "Ask for link" : "Power"}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr
              key={r.url}
              className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
            >
              <td className="td !pl-0 max-w-[280px]">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-1 font-semibold hover:text-brand-600"
                >
                  <span className="truncate">{r.domain}</span>
                  {r.isNew && <Badge tone="green">new</Badge>}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </a>
                <div className="truncate text-[11px] text-slate-400">
                  {r.title}
                </div>
              </td>
              <td className="td w-36">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${r.authority ?? 0}%`,
                        background: tone(r.authority),
                      }}
                    />
                  </div>
                  <b className="text-xs" style={{ color: tone(r.authority) }}>
                    {r.authority ?? "–"}
                  </b>
                  <span className="text-[10px] text-slate-400">
                    {label(r.authority)}
                  </span>
                </div>
              </td>
              <td className="td max-w-[200px] truncate text-xs">
                {r.verified ? (
                  r.anchor
                ) : (
                  <span className="text-slate-400">
                    {r.unreachable
                      ? r.reason
                        ? r.reason.charAt(0).toUpperCase() + r.reason.slice(1)
                        : "Page could not be opened"
                      : r.mentioned
                        ? r.mentionKind === "url"
                          ? "Web address written, no link"
                          : "Name written, no link"
                        : "No link found"}
                  </span>
                )}
              </td>
              <td className="td">
                {r.verified ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={r.rel === "dofollow" ? "green" : "slate"}>
                      {r.rel}
                    </Badge>
                    {r.placement && r.placement !== "content" && (
                      <span className="text-[10px] text-slate-400">
                        {r.placement}
                      </span>
                    )}
                  </div>
                ) : (
                  <Badge tone="amber">mention</Badge>
                )}
              </td>
              <td className="td">
                {r.verified ? (
                  <b style={{ color: healthColor(r.power) }}>
                    {r.power ?? "–"}
                  </b>
                ) : r.mentioned ? (
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => copy(r)}
                  >
                    <Copy className="h-3 w-3" />
                    {copied === r.url ? "Copied" : "Copy email"}
                  </button>
                ) : (
                  <span className="text-slate-300">–</span>
                )}
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={5} className="td text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <Panel
      title="Backlinks"
      sub="Sites that link to this domain"
      right={
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            disabled={busy}
            onClick={() => run()}
          >
            {busy ? (
              <Spinner />
            ) : bl ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
            {bl || live.length ? "Find again" : "Find backlinks"}
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide results" : "View results"}
            <ChevronDown
              className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      }
    >
      {err && (
        <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {err}
        </p>
      )}
      {busy && (
        <div className="mb-3">
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> {prog.text} Keep this tab open.
          </p>
          {prog.total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${(prog.done / prog.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}
      {!open && !busy && !bl && live.length === 0 && (
        <p className="text-sm text-slate-500">
          Not checked yet. It runs together with <b>Analyze</b>, or press{" "}
          <b>Find backlinks</b>.
        </p>
      )}
      {!open && busy && live.length > 0 && (
        <p className="text-xs text-slate-500">
          Backlinks confirmed so far:{" "}
          <b className="text-slate-800 dark:text-slate-100">
            {live.filter((r) => r.verified).length}
          </b>
        </p>
      )}
      {!open && bl && s && !busy && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="w-[170px] shrink-0">
            <Ring value={s.score} label="Backlink score" size={56} />
          </div>
          {(
            [
              ["Real backlinks", s.verified],
              ["Linking domains", s.linkingDomains],
              ["Follow / nofollow", `${s.dofollow} / ${s.nofollow}`],
            ] as [string, string | number][]
          ).map(([l, v]) => (
            <div key={l} className="min-w-[80px] flex-1">
              <div className="text-[11px] font-semibold text-slate-500">
                {l}
              </div>
              <div className="num text-xl font-medium">{v}</div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <>
      {live.length > 0 && (busy || !bl) && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            Backlinks confirmed so far:{" "}
            <b className="text-slate-800 dark:text-slate-100">
              {live.filter((r) => r.verified).length}
            </b>{" "}
            · mentions without a link:{" "}
            <b>{live.filter((r) => !r.verified && r.mentioned).length}</b>
          </p>
          {table(
            live.filter((r) => r.verified),
            false,
            "No real link confirmed yet. More pages are still being checked.",
          )}
        </>
      )}
      {!bl && !busy && live.length === 0 && (
        <p className="text-sm text-slate-500">
          Press <b>Find backlinks</b> to search the web for sites that link to
          this domain. The result is saved for 7 days.
        </p>
      )}
      {bl && s && !(busy && live.length > 0) && (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <Ring
                value={s.score}
                label="Backlink score"
                size={64}
                sub="Based on the number of linking sites (40%), their strength (40%) and the share of follow links (20%)."
              />
              <div className="mt-3 space-y-1 text-[11px] text-slate-500">
                {s.hasPrevious ? (
                  <>
                    <div>
                      <Dot color="#16a34a" />
                      New since last check:{" "}
                      <b className="text-slate-800 dark:text-slate-100">
                        {s.newLinks}
                      </b>
                    </div>
                    <div>
                      <Dot color="#dc2626" />
                      Not seen this time:{" "}
                      <b className="text-slate-800 dark:text-slate-100">
                        {s.lost}
                      </b>
                    </div>
                  </>
                ) : (
                  <div>Run again later to see new and lost links.</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  l: "Verified backlinks",
                  v: s.verified,
                  sub: s.totalBacklinks
                    ? `${s.totalBacklinks.toLocaleString()} in the full index`
                    : `${s.mentionsOnly} mentions without a link`,
                },
                {
                  l: "Linking domains",
                  v: s.linkingDomains,
                  sub: s.totalDomains
                    ? `${s.totalDomains.toLocaleString()} in the full index`
                    : "different websites",
                },
                {
                  l: "Follow / nofollow",
                  v: `${s.dofollow} / ${s.nofollow}`,
                  sub: "follow passes ranking power",
                },
                {
                  l: "Average authority",
                  v: s.avgAuthority ?? "–",
                  sub: bl.authorityUsed ? "Scale 0–100" : "Not available",
                },
              ].map((k) => (
                <div
                  key={k.l}
                  className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                >
                  <div className="text-[11px] font-semibold text-slate-500">
                    {k.l}
                  </div>
                  <div className="text-2xl font-extrabold">{k.v}</div>
                  <div className="truncate text-[11px] text-slate-400">
                    {k.sub}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4 grid gap-5 md:grid-cols-2">
            {bl.authorityUsed && (
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-500">
                  Strength of linking sites
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  {[
                    ["Strong", s.strong, "#16a34a"],
                    ["Average", s.average, "#d97706"],
                    ["Weak", s.weak, "#dc2626"],
                  ].map(([n, v, c]) => (
                    <div
                      key={n as string}
                      title={`${n}: ${v}`}
                      style={{
                        width: `${((v as number) / total) * 100}%`,
                        background: c as string,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs">
                  <span>
                    <Dot color="#16a34a" />
                    Strong (40+): <b>{s.strong}</b>
                  </span>
                  <span>
                    <Dot color="#d97706" />
                    Average (20-39): <b>{s.average}</b>
                  </span>
                  <span>
                    <Dot color="#dc2626" />
                    Weak (under 20): <b>{s.weak}</b>
                  </span>
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-500">
                Anchor text (the clickable words)
              </div>
              <div className="space-y-1.5">
                {ANCHORS.map(([k, n, c]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0">
                      <Dot color={c} />
                      {n}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${((s.anchors[k] ?? 0) / anchorTotal) * 100}%`,
                          background: c,
                        }}
                      />
                    </div>
                    <b className="w-6 text-right">{s.anchors[k] ?? 0}</b>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                A healthy profile is mostly brand name and web address. Too many
                keyword anchors can look unnatural to Google.
              </p>
            </div>
          </div>

          {s.verified > 0 &&
            (Object.values(s.placements).some((n) => n > 0) ||
              s.topPages.length > 0) && (
              <div className="mb-4 grid gap-5 md:grid-cols-2">
                {Object.values(s.placements).some((n) => n > 0) && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-slate-500">
                      Where the links sit on the page
                    </div>
                    <div className="space-y-1.5">
                      {PLACES.map(([k, n, c]) => (
                        <div
                          key={k}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-44 shrink-0">
                            <Dot color={c} />
                            {n}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${((s.placements[k] ?? 0) / Math.max(s.verified, 1)) * 100}%`,
                                background: c,
                              }}
                            />
                          </div>
                          <b className="w-6 text-right">
                            {s.placements[k] ?? 0}
                          </b>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Links inside real content count fully. Footer, menu and
                      comment links count less in the Power column.
                    </p>
                  </div>
                )}
                {s.topPages.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-slate-500">
                      Most linked pages of your site
                    </div>
                    <ul className="space-y-1 text-xs">
                      {s.topPages.slice(0, 6).map((p) => (
                        <li
                          key={p.url}
                          className="flex items-center justify-between gap-3"
                        >
                          <a
                            className="truncate hover:underline"
                            href={p.url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {shortPath(p.url)}
                          </a>
                          <b className="shrink-0">
                            {p.links} {p.links === 1 ? "link" : "links"}
                          </b>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          {s.blocked > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {s.blocked} pages blocked our check (bot protection), so any links
              on them could not be confirmed.
            </p>
          )}

          <div className="mb-2 flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800 sm:w-fit">
            {(
              [
                ["verified", `Real links (${s.verified})`],
                ["strong", "Strong only"],
                ["mentions", `Mentions, no link (${s.mentionsOnly})`],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setOnly(k)}
                className={`rounded-md px-2.5 py-1 ${only === k ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-500"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {only === "mentions" && s.unlinkedMentions > 0 && (
            <p className="mb-2 text-xs text-slate-500">
              <b>{s.unlinkedMentions}</b> pages wrote your name but did not
              link. Ask them to add a link: the copy button writes the email for
              you.
            </p>
          )}
          {table(
            rows,
            only === "mentions",
            only === "strong"
              ? "No strong backlinks in this sample."
              : only === "mentions"
                ? "No mentions without a link."
                : "No linking pages found. New or small sites often have few links Google has indexed.",
          )}
          {bl.lost.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-500">
                {bl.lost.length} links from the last check were not seen this
                time
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-slate-500">
                {bl.lost.map((l) => (
                  <li key={l.url} className="truncate">
                    <a
                      className="hover:underline"
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {l.url}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">
                They may be gone, or Google simply did not show them this time.
              </p>
            </details>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            {bl.indexUsed
              ? "The list is built from a large link index plus pages we checked ourselves."
              : "This is a sample (up to 90 pages), so the real total is higher."}{" "}
            Power = authority, reduced for nofollow links, footer / menu /
            comment links and pages with hundreds of outgoing links. Checked{" "}
            {new Date(bl.createdAt).toLocaleDateString([], {
              dateStyle: "medium",
            })}
            {bl.cached ? " · saved result" : ""}.
            {bl.notes.length > 0 && ` ${publicText(bl.notes.join(" · "))}`}
          </p>
        </>
      )}
      {crawl && (
        <p className="mt-3 text-[11px] text-slate-400">
          Crawl found {(crawl.internal ?? 0).toLocaleString()} internal and{" "}
          {(crawl.external ?? 0).toLocaleString()} outgoing links.
        </p>
      )}
        </>
      )}
    </Panel>
  );
}