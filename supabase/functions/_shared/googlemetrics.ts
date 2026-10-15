import { admin, daysAgo } from "./utils.ts";

/**
 * REAL numbers from the user's own Google account (Search Console + Analytics 4), used to strengthen the authority score.
 * They are measured by Google, not estimated, so they are the most trustworthy signals the app can have.
 * Only works when the user connected Google ("My Google"). Never throws: no account / no matching site / any Google error -> null,
 * and the authority score is built from the public signals exactly as before.
 */
export type VerifiedSignals = {
  sources: ("Search Console" | "Analytics")[];
  clicks28: number | null; // Google search clicks, last ~28 days
  impressions28: number | null;
  queries: number | null; // different search phrases people used (max 1000 read)
  top10Queries: number | null; // of those, how many the site shows in the top 10 on average
  avgPosition: number | null;
  organicSessions28: number | null; // Analytics: sessions from "Organic Search", last 28 days
};

const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
};
const related = (a: string, b: string) =>
  !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

async function token(userId: string): Promise<string | null> {
  const { data } = await admin()
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  return ((await r.json()).access_token as string) ?? null;
}

const post = async (url: string, tok: string, body: unknown) => {
  const r = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  return await r.json();
};

async function pickGscSite(tok: string, host: string): Promise<string | null> {
  const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${tok}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const sites: string[] = ((await r.json()).siteEntry ?? []).map(
    (s: { siteUrl: string }) => s.siteUrl,
  );
  const norm = (s: string) =>
    s.startsWith("sc-domain:") ? s.slice(10).toLowerCase() : hostOf(s);
  return (
    sites.find((s) => s === `sc-domain:${host}`) ??
    sites.find((s) => !s.startsWith("sc-domain:") && hostOf(s) === host) ??
    sites.find((s) => related(norm(s), host)) ??
    null
  );
}

export async function verifiedSignals(
  userId: string,
  host: string,
): Promise<VerifiedSignals | null> {
  try {
    const h = host.toLowerCase().replace(/^www\./, "");
    const tok = await token(userId);
    if (!tok) return null;

    // the matching Search Console site / GA4 property is remembered by "My Google" (google_site_map)
    const { data: map } = await admin()
      .from("google_site_map")
      .select("gsc_site, ga_property, ga_name")
      .eq("user_id", userId)
      .eq("host", h)
      .maybeSingle();
    const gsc = map?.gsc_site ?? (await pickGscSite(tok, h));
    const ga =
      map?.ga_property && !/^SEOPilot\s*[:\/]/.test(map.ga_name ?? "")
        ? String(map.ga_property)
        : null;

    const out: VerifiedSignals = {
      sources: [],
      clicks28: null,
      impressions28: null,
      queries: null,
      top10Queries: null,
      avgPosition: null,
      organicSessions28: null,
    };

    const jobs: Promise<void>[] = [];
    if (gsc) {
      const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gsc)}/searchAnalytics/query`;
      const range = { startDate: daysAgo(30), endDate: daysAgo(3) }; // Search Console lags about 2 days
      jobs.push(
        (async () => {
          const [tot, q] = await Promise.all([
            post(url, tok, range), // true totals (queries Google hides are included)
            post(url, tok, { ...range, dimensions: ["query"], rowLimit: 1000 }),
          ]);
          const t = tot.rows?.[0];
          const rows = (q.rows ?? []) as {
            clicks: number;
            impressions: number;
            position: number;
          }[];
          out.clicks28 = t ? Math.round(t.clicks) : 0;
          out.impressions28 = t ? Math.round(t.impressions) : 0;
          out.avgPosition = t ? Number(t.position.toFixed(1)) : null;
          out.queries = rows.length;
          out.top10Queries = rows.filter((r) => r.position <= 10).length;
          out.sources.push("Search Console");
        })().catch(() => {}),
      );
    }
    if (ga) {
      jobs.push(
        (async () => {
          const j = await post(
            `https://analyticsdata.googleapis.com/v1beta/properties/${ga}:runReport`,
            tok,
            {
              dateRanges: [{ startDate: daysAgo(28), endDate: daysAgo(1) }],
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
            },
          );
          const row = (j.rows ?? []).find(
            (r: { dimensionValues?: { value: string }[] }) =>
              r.dimensionValues?.[0]?.value === "Organic Search",
          );
          out.organicSessions28 = row
            ? Number(row.metricValues?.[0]?.value ?? 0)
            : 0;
          out.sources.push("Analytics");
        })().catch(() => {}),
      );
    }
    await Promise.all(jobs);
    return out.sources.length ? out : null;
  } catch {
    return null;
  }
}