import {
  admin,
  daysAgo,
  handle,
  HttpError,
  iso,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { get, isShared, parseInput, rootDomain } from "../_shared/siteinfo.ts";

// Traffic Checker for ANY website.
//  - Your own site (connected to Google Analytics, data saved in traffic_daily): REAL numbers, daily / weekly / monthly.
//  - Any other site: nobody gives real visits for free, so we use the public Tranco rank history (last 30 days per call),
//    save it in competitor_daily every time you check, and turn the rank into a rough monthly-visits estimate.
//    The saved history grows each time you check, so weekly and monthly views get better over time.

type Grain = "day" | "week" | "month";
type Pt = {
  period: string;
  visits: number;
  days: number;
  span: number;
  rank: number | null;
};

const SPAN_MONTH = 30;
const estMonthly = (rank: number) => Math.round(1.2e11 / rank); // same rough formula used by the Research page
const nice = (n: number) => {
  if (n < 20) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
};

const monday = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return iso(t);
};
const keyOf = (d: string, g: Grain) =>
  g === "day" ? d : g === "week" ? monday(d) : d.slice(0, 7) + "-01";
const spanOf = (p: string, g: Grain) => {
  if (g === "day") return 1;
  if (g === "week") return 7;
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function group(
  rows: { date: string; rank: number; monthly: number }[],
  g: Grain,
): Pt[] {
  const m = new Map<string, { sum: number; rank: number; n: number }>();
  for (const r of rows) {
    const k = keyOf(r.date, g);
    const e = m.get(k) ?? { sum: 0, rank: 0, n: 0 };
    e.sum += r.monthly;
    e.rank += r.rank;
    e.n++;
    m.set(k, e);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, e]) => {
      const span = spanOf(period, g);
      return {
        period,
        visits: Math.round((e.sum / e.n / SPAN_MONTH) * span),
        days: e.n,
        span,
        rank: Math.round(e.rank / e.n),
      };
    });
}

async function trancoHistory(domain: string) {
  const r = await get(
    `https://tranco-list.eu/api/ranks/domain/${domain}`,
    10000,
  );
  if (r.status === 429)
    throw new HttpError(
      429,
      "Tranco is busy right now. Wait a minute and try again.",
    );
  if (!r.ok)
    throw new HttpError(
      502,
      `Tranco rank service returned ${r.status}. Try again later.`,
    );
  const j = await r.json();
  return ((j?.ranks ?? []) as { date: string; rank: number }[]).filter(
    (x) =>
      typeof x.rank === "number" && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date)),
  );
}

// ---------- calibration: compare the rank formula with REAL Analytics numbers of your own sites ----------
// For each of your sites that has saved Analytics history, we compare real monthly visits with what the rank formula would say.
// With 3+ sites the typical ratio (and how much it varies) corrects the estimate for every other site, and sets an honest range.
async function calibrate(db: ReturnType<typeof admin>, userId: string) {
  const { data: sites } = await db
    .from("websites")
    .select("id, url")
    .eq("user_id", userId);
  const logs: number[] = [];
  for (const s of (sites ?? []).slice(0, 6)) {
    try {
      const h = rootDomain(
        new URL(
          s.url.startsWith("http") ? s.url : `https://${s.url}`,
        ).hostname.replace(/^www\./, ""),
      );
      const { data: t } = await db
        .from("traffic_daily")
        .select("date, sessions")
        .eq("website_id", s.id)
        .gte("date", daysAgo(31))
        .lt("date", iso(new Date()));
      const dates = new Set((t ?? []).map((r) => String(r.date)));
      if (dates.size < 20) continue; // need about 3 weeks of real data
      const monthly =
        ((t ?? []).reduce((a, r) => a + Number(r.sessions), 0) / dates.size) *
        30;
      if (monthly < 50) continue;
      let rank: number | null = null;
      const { data: c } = await db
        .from("competitor_daily")
        .select("tranco_rank")
        .eq("user_id", userId)
        .eq("host", h)
        .not("tranco_rank", "is", null)
        .order("date", { ascending: false })
        .limit(1);
      if (c?.length) rank = Number(c[0].tranco_rank);
      else {
        const hist = await trancoHistory(h);
        rank = hist.length ? hist[hist.length - 1].rank : null;
      }
      if (rank) logs.push(Math.log(monthly / estMonthly(rank)));
    } catch {
      /* skip this site */
    }
  }
  if (!logs.length) return { n: 0, mu: 0, sigma: 0 };
  const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sigma =
    logs.length > 1
      ? Math.sqrt(
          logs.reduce((a, b) => a + (b - mu) ** 2, 0) / (logs.length - 1),
        )
      : 0;
  return { n: logs.length, mu, sigma };
}

// ---------- best estimate: combine the signals we have and be honest about how sure we are ----------
function bestEstimate(
  latest: { monthly: number; low: number; high: number },
  seo: { mid: number } | null,
  cal: { n: number; mu: number; sigma: number } | null,
) {
  const reasons: string[] = [];
  let aM = latest.monthly,
    aL = latest.low,
    aH = latest.high;
  const calibrated = !!cal && cal.n >= 3;
  if (calibrated) {
    aM = nice(aM * Math.exp(cal!.mu));
    const k = Math.exp(1.28 * Math.max(cal!.sigma, 0.35)); // about an 80% band around the calibrated number
    aL = nice(aM / k);
    aH = nice(aM * k);
    reasons.push(
      `Rank formula corrected using ${cal!.n} of your own sites with real Analytics data`,
    );
  } else {
    reasons.push(
      cal && cal.n > 0
        ? `Only ${cal.n} of your sites have enough saved Analytics data; 3 are needed to correct the formula`
        : "Not corrected: connect Analytics and load history on 3+ of your sites to calibrate this",
    );
  }
  let lo = aL,
    hi = aH,
    mid = aM,
    agree = false;
  if (seo && seo.mid > 0) {
    // search is assumed to be 30% to 55% of all visits (same assumption as the Research page)
    const bL = seo.mid / 0.55,
      bH = seo.mid / 0.3,
      bM = Math.sqrt(bL * bH);
    const oLo = Math.max(aL, bL),
      oHi = Math.min(aH, bH);
    if (oLo <= oHi) {
      agree = true;
      lo = oLo;
      hi = oHi;
      mid = Math.min(Math.max(Math.sqrt(aM * bM), lo), hi);
      reasons.push(
        "Rank and keyword (SEO) estimates agree, so the range is narrower",
      );
    } else {
      lo = Math.min(aL, bL);
      hi = Math.max(aH, bH);
      mid = Math.sqrt(aM * bM);
      reasons.push(
        "Rank and keyword (SEO) estimates disagree, so the range is wide",
      );
    }
  } else {
    reasons.push(
      "No keyword (SEO) estimate yet: run Domain Research on this site to cross-check",
    );
  }
  // never High: no real visit data exists for this site
  const level =
    (calibrated && (agree || !seo)) || (agree && cal && cal.n > 0)
      ? "Medium"
      : "Low";
  return { low: nice(lo), mid: nice(mid), high: nice(hi), level, reasons };
}

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const u = parseInput(body.url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const root = rootDomain(host);
    const notes: string[] = [];
    const db = admin();

    if (isShared(host)) {
      return json({
        host,
        root,
        shared: true,
        estimate: null,
        real: null,
        seo: null,
        notes: [
          "This is a shared hosting address (vercel.app, github.io ...). Its traffic cannot be told apart from other sites on the same host.",
        ],
      });
    }

    // ---------- 1. rank history (free) -> saved in competitor_daily ----------
    let fetched = 0;
    try {
      const hist = await trancoHistory(root);
      if (hist.length) {
        fetched = hist.length;
        await db
          .from("competitor_sites")
          .upsert(
            {
              user_id: user.id,
              host: root,
              last_checked_at: new Date().toISOString(),
            },
            { onConflict: "user_id,host" },
          );
        await db.from("competitor_daily").upsert(
          hist.map((h) => ({
            user_id: user.id,
            host: root,
            date: h.date,
            tranco_rank: h.rank,
            est_monthly_visits: estMonthly(h.rank),
          })),
          { onConflict: "user_id,host,date" },
        );
      } else {
        notes.push(
          "This site is not in the Tranco top 1 million, so it is probably small. No honest free estimate exists for it.",
        );
      }
    } catch (e) {
      notes.push(
        (e as Error).message + " Showing the history already saved, if any.",
      );
    }

    const { data: saved } = await db
      .from("competitor_daily")
      .select("date, tranco_rank")
      .eq("user_id", user.id)
      .eq("host", root)
      .not("tranco_rank", "is", null)
      .order("date", { ascending: true })
      .limit(3000);
    const rows = (saved ?? []).map((r) => ({
      date: String(r.date),
      rank: Number(r.tranco_rank),
      monthly: estMonthly(Number(r.tranco_rank)),
    }));

    let estimate: unknown = null;
    if (rows.length) {
      const last = rows[rows.length - 1];
      const back = (n: number) => {
        const t = new Date(last.date + "T00:00:00Z");
        t.setUTCDate(t.getUTCDate() - n);
        const d = iso(t);
        return [...rows].reverse().find((r) => r.date <= d) ?? null;
      };
      const ch = (n: number) => {
        const b = back(n);
        return b && b.monthly ? (last.monthly - b.monthly) / b.monthly : null;
      };
      const rch = (n: number) => {
        const b = back(n);
        return b ? b.rank - last.rank : null;
      }; // positive = rank improved
      estimate = {
        latest: {
          date: last.date,
          rank: last.rank,
          monthly: nice(last.monthly),
          low: nice(last.monthly * 0.3),
          high: nice(last.monthly * 3),
        },
        change7: ch(7),
        change30: ch(30),
        rankChange7: rch(7),
        rankChange30: rch(30),
        storedDays: rows.length,
        firstDate: rows[0].date,
        fetched,
        day: group(rows, "day"),
        week: group(rows, "week"),
        month: group(rows, "month"),
      };
    }

    // ---------- 2. real numbers if this is one of YOUR sites with saved Google Analytics history ----------
    let real: unknown = null;
    try {
      const { data: sites } = await db
        .from("websites")
        .select("id, url, name")
        .eq("user_id", user.id);
      const mine = (sites ?? []).find((s) => {
        try {
          return (
            rootDomain(
              new URL(
                s.url.startsWith("http") ? s.url : `https://${s.url}`,
              ).hostname.replace(/^www\./, ""),
            ) === root
          );
        } catch {
          return false;
        }
      });
      if (mine) {
        const { data: first } = await db
          .from("traffic_daily")
          .select("date")
          .eq("website_id", mine.id)
          .order("date", { ascending: true })
          .limit(1);
        if (first?.length) {
          const from = String(first[0].date);
          const to = iso(new Date());
          const out: Record<string, unknown[]> = {};
          for (const g of ["day", "week", "month"] as Grain[]) {
            const { data, error } = await db.rpc("traffic_rollup", {
              p_website: mine.id,
              p_grain: g,
              p_from: from,
              p_to: to,
            });
            if (error) throw error;
            out[g] = (data ?? []).map((r: Record<string, unknown>) => ({
              period: String(r.period),
              visits: Number(r.sessions),
              users: Number(r.users),
              pageviews: Number(r.pageviews),
              organic: Number(r.organic),
              direct: Number(r.direct),
              referral: Number(r.referral),
              social: Number(r.social),
              paid: Number(r.paid),
              email: Number(r.email),
              gsc_clicks: Number(r.gsc_clicks),
            }));
          }
          real = { website: mine.name ?? mine.url, from, ...out };
        } else {
          notes.push(
            "This is your own site, but no Google Analytics history is saved yet. Open Integrations, connect Google Analytics, then load the full history to see REAL numbers here.",
          );
        }
      }
    } catch {
      /* traffic tables not created yet: only the estimate is shown */
    }

    // ---------- 3. latest SEO-based estimate from a Domain Research run, if you ran one ----------
    let seo: unknown = null;
    try {
      const { data } = await db
        .from("research_runs")
        .select("created_at, organic:result->traffic->seo->organic")
        .eq("user_id", user.id)
        .eq("host", host)
        .order("created_at", { ascending: false })
        .limit(5);
      const hit = (data ?? []).find(
        (r) => (r.organic as { mid?: number } | null)?.mid != null,
      );
      if (hit) seo = { ...(hit.organic as object), at: hit.created_at };
    } catch {
      /* optional */
    }

    let best: unknown = null;
    if (estimate) {
      let cal: { n: number; mu: number; sigma: number } | null = null;
      try {
        cal = await calibrate(db, user.id);
      } catch {
        /* optional */
      }
      best = bestEstimate(
        (estimate as { latest: { monthly: number; low: number; high: number } })
          .latest,
        seo as { mid: number } | null,
        cal,
      );
    }

    return json({
      host,
      root,
      shared: false,
      estimate,
      best,
      real,
      seo,
      notes,
    });
  }),
);
