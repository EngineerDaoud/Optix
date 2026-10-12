import { admin } from "./utils.ts";
import { loadKpis, Row } from "./kpi.ts";
import { claude } from "./ai.ts";

type Kpis = ReturnType<typeof import("./kpi.ts").aggregate>;
type Site = { id: string; url: string; name: string | null };
type Item = {
  key: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  sessions?: number;
  orders?: number;
  revenue?: number;
};

const n = (v: number, d = 0) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: d }).format(v);
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

export async function loadContext(websiteId: string, from: string, to: string) {
  const db = admin();
  const k = await loadKpis(websiteId, from, to);
  const bucket = k.days <= 7 ? 7 : k.days <= 15 ? 15 : 30;
  const { data: bd } = await db
    .from("breakdowns")
    .select("kind,rows")
    .eq("website_id", websiteId)
    .in("kind", [`queries_${bucket}`, `pages_${bucket}`, `channels_${bucket}`]);
  const get = (p: string) =>
    (bd?.find((b) => b.kind === `${p}_${bucket}`)?.rows ?? []) as Item[];
  const { data: audit } = await db
    .from("audits")
    .select("scores,issues,created_at")
    .eq("website_id", websiteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    ...k,
    queries: get("queries"),
    pages: get("pages"),
    channels: get("channels"),
    audit,
  };
}

const change = (cur: number, prev: number, invert = false) => {
  if (!prev) return `<span class="m">no previous data</span>`;
  const d = (cur - prev) / prev;
  const good = invert ? d < 0 : d > 0;
  return `<span style="color:${good ? "#15803d" : "#b91c1c"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)}%</span>`;
};

type View = "day" | "week" | "month";
const DAY_MS = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDay = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const weekdayDay = (d: string) =>
  `${new Date(d + "T00:00:00Z").toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })} ${shortDay(d)}`;
// Daily = last 14 days, one bar per day · Weekly = last 7 days, one bar per day (weekday + date) · Monthly = last 30 days, one bar per 5-day block
const SPAN: Record<View, [number, number]> = {
  day: [14, 1],
  week: [7, 1],
  month: [30, 5],
};

/** the days of each bar, ending on the report's last day, all summed from the daily_metrics table */
function bucket(rows: Row[], to: string, src: string, key: string, view: View) {
  const val = new Map<string, number>();
  for (const r of rows)
    if (r.source === src && r.date <= to)
      val.set(r.date, (val.get(r.date) ?? 0) + (r.data[key] ?? 0));
  const [days, step] = SPAN[view];
  const pts: { label: string; v: number }[] = [];
  for (let k = 0; k < days / step; k++) {
    const last = iso(Date.parse(to) - (days - (k + 1) * step) * DAY_MS);
    const first = iso(Date.parse(last) - (step - 1) * DAY_MS);
    let v = 0;
    for (let t = Date.parse(first); t <= Date.parse(last); t += DAY_MS)
      v += val.get(iso(t)) ?? 0;
    const label =
      step === 1
        ? view === "week"
          ? weekdayDay(last)
          : shortDay(last)
        : first.slice(5, 7) === last.slice(5, 7)
          ? `${shortDay(first)}–${Number(last.slice(8))}`
          : `${shortDay(first)}–${shortDay(last)}`;
    pts.push({ label, v });
  }
  return pts;
}

function bars(
  pts: { label: string; v: number }[],
  color: string,
  caption: string,
  money = false,
) {
  const total = pts.reduce((a, p) => a + p.v, 0);
  if (!total) return `<p class="m">${caption}: no data yet for this view.</p>`;
  const w = 760,
    h = 150,
    padB = 18,
    max = Math.max(...pts.map((p) => p.v), 1);
  const bw = w / pts.length,
    step = pts.length <= 8 ? 1 : 2;
  const rects = pts
    .map((p, i) => {
      const bh = (p.v / max) * (h - padB - 8);
      return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(h - padB - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"><title>${esc(p.label)}: ${n(p.v, money ? 2 : 0)}</title></rect>`;
    })
    .join("");
  const labels = pts
    .map((p, i) =>
      i % step === 0
        ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 4}" font-size="10" text-anchor="middle" fill="#64748b">${esc(p.label)}</text>`
        : "",
    )
    .join("");
  return `<div class="m">${caption} · total ${n(total, money ? 2 : 0)} · highest ${n(max, money ? 2 : 0)}</div><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">${rects}${labels}</svg>`;
}

/** Tab buttons + one block per tab. The buttons work inside the report preview; Print / Save as PDF keeps the tab that is selected. */
function tabs(id: string, items: [string, string, string][]) {
  const btn = items
    .map(
      ([k, l], i) =>
        `<button type="button" data-p="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`,
    )
    .join("");
  const views = items
    .map(
      ([k, , html], i) =>
        `<div class="pv" data-chart="${id}" data-p="${k}"${i === 0 ? "" : ' style="display:none"'}>${html}</div>`,
    )
    .join("");
  return `<div class="tabs" data-chart="${id}">${btn}</div>${views}`;
}

function periodChart(
  id: string,
  rows: Row[],
  to: string,
  src: string,
  key: string,
  color: string,
  money = false,
) {
  const back = (d: number) => shortDay(iso(Date.parse(to) - d * DAY_MS));
  const cap: Record<View, string> = {
    day: `Daily · ${back(13)} to ${shortDay(to)}`,
    week: `Weekly · ${back(6)} to ${shortDay(to)}, day by day`,
    month: `Monthly · ${back(29)} to ${shortDay(to)}, in 5-day blocks`,
  };
  return tabs(
    id,
    (["day", "week", "month"] as View[]).map(
      (v) =>
        [
          v,
          v === "day" ? "Daily" : v === "week" ? "Weekly" : "Monthly",
          bars(bucket(rows, to, src, key, v), color, cap[v], money),
        ] as [string, string, string],
    ),
  );
}

const kpi = (label: string, value: string, chg: string) =>
  `<div class="k"><div class="m">${label}</div><div class="v">${value}</div><div class="c">${chg}</div></div>`;

const table = (head: string[], rows: string[][]) =>
  rows.length
    ? `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`
    : `<p class="m">No data yet.</p>`;

const path = (u: string) => {
  try {
    return new URL(u).pathname || "/";
  } catch {
    return u;
  }
};

function fallbackSummary(c: Kpis, p: Kpis) {
  const pc = (a: number, b: number) =>
    b
      ? `${a >= b ? "up" : "down"} ${Math.abs(((a - b) / b) * 100).toFixed(0)}%`
      : "no previous data";
  return `Organic clicks: ${n(c.clicks)} (${pc(c.clicks, p.clicks)}). Sessions: ${n(c.sessions)} (${pc(c.sessions, p.sessions)}). Orders: ${n(c.orders)} (${pc(c.orders, p.orders)}).`;
}

const TAB_SCRIPT =
  "document.querySelectorAll('.tabs').forEach(function(t){t.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var id=t.getAttribute('data-chart'),p=b.getAttribute('data-p');t.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});document.querySelectorAll('.pv[data-chart=\"'+id+'\"]').forEach(function(v){v.style.display=v.getAttribute('data-p')===p?'':'none'})})});";

export async function createReport(o: {
  site: Site;
  userId: string;
  type: string;
  from: string;
  to: string;
  sections: string[];
}) {
  const ctx = await loadContext(o.site.id, o.from, o.to);
  const c = ctx.current,
    p = ctx.previous;
  // the last 30 days for the Daily / Weekly / Monthly views, read from the same daily_metrics table
  const { data: wideRows } = await admin()
    .from("daily_metrics")
    .select("date,source,data")
    .eq("website_id", o.site.id)
    .gte("date", iso(Date.parse(o.to) - 45 * DAY_MS))
    .lte("date", o.to)
    .limit(5000);
  const wide = (wideRows ?? ctx.rows) as Row[];
  const has = (s: string) => o.sections.includes(s);

  let summary = "";
  if (has("ai")) {
    try {
      summary = await claude(
        "You write the executive summary of a website performance report for a business owner. Plain text, no markdown, max 110 words. Mention the biggest win, the biggest problem and one action. Use only the numbers given.",
        JSON.stringify({
          site: o.site.url,
          from: o.from,
          to: o.to,
          current: c,
          previous: p,
          topQueries: ctx.queries.slice(0, 5),
          channels: ctx.channels,
          auditIssues: (ctx.audit?.issues ?? []).slice(0, 5),
        }),
        500,
      );
    } catch {
      summary = fallbackSummary(c, p);
    }
  }

  const parts: string[] = [];
  if (summary) parts.push(`<h2>Summary</h2><p>${esc(summary)}</p>`);
  if (has("seo")) {
    parts.push(
      `<h2>Search performance</h2><div class="g">${kpi("Clicks", n(c.clicks), change(c.clicks, p.clicks))}${kpi("Impressions", n(c.impressions), change(c.impressions, p.impressions))}${kpi("CTR", (c.ctr * 100).toFixed(2) + "%", change(c.ctr, p.ctr))}${kpi("Avg. position", c.position ? c.position.toFixed(1) : "–", change(c.position, p.position, true))}</div>` +
        periodChart("clicks", wide, o.to, "gsc", "clicks", "#4f4fe0") +
        `<h3>Top queries</h3>` +
        table(
          ["Query", "Clicks", "Impr.", "Pos."],
          ctx.queries
            .slice(0, 10)
            .map((r) => [
              esc(r.key),
              n(r.clicks ?? 0),
              n(r.impressions ?? 0),
              (r.position ?? 0).toFixed(1),
            ]),
        ) +
        `<h3>Top pages</h3>` +
        table(
          ["Page", "Clicks", "Impr."],
          ctx.pages
            .slice(0, 10)
            .map((r) => [
              esc(path(r.key)),
              n(r.clicks ?? 0),
              n(r.impressions ?? 0),
            ]),
        ),
    );
  }
  if (has("traffic")) {
    parts.push(
      `<h2>Traffic</h2><div class="g">${kpi("Sessions", n(c.sessions), change(c.sessions, p.sessions))}${kpi("Users", n(c.users), change(c.users, p.users))}</div>` +
        periodChart("sessions", wide, o.to, "ga4", "sessions", "#0f766e") +
        `<h3>By channel</h3>` +
        table(
          ["Channel", "Sessions", "Orders"],
          ctx.channels.map((r) => [
            esc(r.key),
            n(r.sessions ?? 0),
            n(r.orders ?? 0),
          ]),
        ),
    );
  }
  if (has("sales")) {
    parts.push(
      `<h2>Sales</h2><div class="g">${kpi("Orders", n(c.orders), change(c.orders, p.orders))}${kpi("Revenue", n(c.revenue, 2), change(c.revenue, p.revenue))}${kpi("Conversion rate", (c.convRate * 100).toFixed(2) + "%", change(c.convRate, p.convRate))}</div>` +
        periodChart("revenue", wide, o.to, "ga4", "revenue", "#b45309", true),
    );
  }
  if (
    has("speed") &&
    (ctx.audit?.scores?.mobile || ctx.audit?.scores?.desktop)
  ) {
    const card = (sc: {
      performance: number;
      seo: number;
      accessibility: number;
      bestPractices: number;
    }) =>
      `<div class="g">${kpi("Performance", String(sc.performance ?? "–"), "")}${kpi("SEO", String(sc.seo ?? "–"), "")}${kpi("Accessibility", String(sc.accessibility ?? "–"), "")}${kpi("Best practices", String(sc.bestPractices ?? "–"), "")}</div>`;
    const dev: [string, string, string][] = [];
    if (ctx.audit.scores.mobile)
      dev.push(["mobile", "Mobile", card(ctx.audit.scores.mobile)]);
    if (ctx.audit.scores.desktop)
      dev.push(["desktop", "Desktop", card(ctx.audit.scores.desktop)]);
    parts.push(
      `<h2>Site health</h2>${tabs("speed", dev)}` +
        table(
          ["Issue", "Severity", "Count"],
          (ctx.audit.issues ?? [])
            .slice(0, 8)
            .map((i: { title: string; severity: string; count: number }) => [
              esc(i.title),
              i.severity,
              String(i.count),
            ]),
        ),
    );
  }

  const title = o.site.name || o.site.url;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} report</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:820px;margin:0 auto;padding:32px;line-height:1.5}
  h1{font-size:24px;margin:0}h2{font-size:17px;margin:28px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}h3{font-size:14px;margin:18px 0 6px}
  .m{color:#64748b;font-size:12px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px}
  .k{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}.v{font-size:22px;font-weight:700}.c{font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#64748b;font-weight:600}td,th{padding:6px 8px;border-bottom:1px solid #f1f5f9}
  .tabs{display:inline-flex;gap:2px;background:#f1f5f9;border-radius:6px;padding:2px;margin:6px 0}.tabs button{border:0;background:none;padding:3px 12px;font-size:12px;border-radius:4px;cursor:pointer;color:#64748b}.tabs button.on{background:#4f46e5;color:#fff}
  @media print{.tabs{display:none}}
  @page{margin:16mm}</style><noscript><style>.tabs{display:none}</style></noscript></head><body>
  <h1>${esc(title)}</h1><div class="m">${o.type} report · ${o.from} to ${o.to} · compared with the previous ${ctx.days} days</div>
  ${parts.join("\n") || "<p>No sections selected.</p>"}
  <script>${TAB_SCRIPT}</script></body></html>`;

  const { data, error } = await admin()
    .from("reports")
    .insert({
      website_id: o.site.id,
      user_id: o.userId,
      type: o.type,
      range_from: o.from,
      range_to: o.to,
      summary,
      html,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
