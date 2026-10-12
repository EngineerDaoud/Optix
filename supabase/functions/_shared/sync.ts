import { admin, daysAgo, HttpError } from "./utils.ts";
import { tokenFor } from "./google.ts";

const RANGES = [7, 15, 30];

async function gsc(token: string, site: string, body: Record<string, unknown>) {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Search Console error");
  return (j.rows ?? []) as {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
}

async function ga4(
  token: string,
  property: string,
  body: Record<string, unknown>,
) {
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Analytics error");
  return (j.rows ?? []) as {
    dimensionValues: { value: string }[];
    metricValues: { value: string }[];
  }[];
}

const GA_METRICS = [
  { name: "sessions" },
  { name: "totalUsers" },
  { name: "transactions" },
  { name: "purchaseRevenue" },
];
const gaVals = (r: { metricValues: { value: string }[] }) => ({
  sessions: Number(r.metricValues[0].value),
  users: Number(r.metricValues[1].value),
  orders: Number(r.metricValues[2].value),
  revenue: Number(r.metricValues[3].value),
});

async function syncGsc(websiteId: string, token: string, site: string) {
  const db = admin();
  const rows = await gsc(token, site, {
    startDate: daysAgo(60),
    endDate: daysAgo(1),
    dimensions: ["date"],
    rowLimit: 100,
  });
  if (rows.length) {
    await db.from("daily_metrics").upsert(
      rows.map((r) => ({
        website_id: websiteId,
        date: r.keys[0],
        source: "gsc",
        data: {
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        },
      })),
    );
  }
  const jobs = RANGES.flatMap((n) =>
    (["query", "page"] as const).map(async (dim) => {
      const out = await gsc(token, site, {
        startDate: daysAgo(n),
        endDate: daysAgo(1),
        dimensions: [dim],
        rowLimit: 25,
      });
      await db.from("breakdowns").upsert({
        website_id: websiteId,
        kind: `${dim === "query" ? "queries" : "pages"}_${n}`,
        rows: out.map((r) => ({
          key: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
        updated_at: new Date().toISOString(),
      });
    }),
  );
  await Promise.all(jobs);
}

async function syncGa4(websiteId: string, token: string, property: string) {
  const db = admin();
  const rows = await ga4(token, property, {
    dateRanges: [{ startDate: "60daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "date" }],
    metrics: GA_METRICS,
    limit: "100",
  });
  if (rows.length) {
    await db.from("daily_metrics").upsert(
      rows.map((r) => {
        const d = r.dimensionValues[0].value;
        return {
          website_id: websiteId,
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          source: "ga4",
          data: gaVals(r),
        };
      }),
    );
  }
  const jobs = RANGES.flatMap((n) =>
    (
      [
        ["channels", "sessionDefaultChannelGroup"],
        ["devices", "deviceCategory"],
      ] as const
    ).map(async ([kind, dim]) => {
      const out = await ga4(token, property, {
        dateRanges: [{ startDate: `${n}daysAgo`, endDate: "yesterday" }],
        dimensions: [{ name: dim }],
        metrics: GA_METRICS,
        limit: "10",
      });
      await db.from("breakdowns").upsert({
        website_id: websiteId,
        kind: `${kind}_${n}`,
        rows: out.map((r) => ({
          key: r.dimensionValues[0].value,
          ...gaVals(r),
        })),
        updated_at: new Date().toISOString(),
      });
    }),
  );
  await Promise.all(jobs);
}

const chunk = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
    a.slice(i * n, i * n + n),
  );
const gaDate = (d: string) =>
  `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** Stores every day of GA4 traffic (per channel) in traffic_daily, and Search Console clicks in daily_metrics.
 *  full = true  : the whole history (GA4 from the first day it has data, Search Console up to 16 months back)
 *  full = false : only the last 14 days (Google corrects recent numbers, so they are written again) */
async function syncTrafficHistory(
  websiteId: string,
  tokens: { ga: string; gsc: string },
  property: string | undefined,
  site: string | undefined,
  full: boolean,
) {
  const db = admin();
  const out: Record<string, string> = {};

  if (property) {
    try {
      const metrics = [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "engagedSessions" },
      ];
      const start = full ? "2015-08-14" : "14daysAgo"; // 2015-08-14 is the earliest date GA4 accepts
      let offset = 0;
      let total = 0;
      for (;;) {
        const rows = await ga4(tokens.ga, property, {
          dateRanges: [{ startDate: start, endDate: "yesterday" }],
          dimensions: [
            { name: "date" },
            { name: "sessionDefaultChannelGroup" },
          ],
          metrics,
          limit: "50000",
          offset: String(offset),
        });
        const mapped = rows.map((r) => ({
          website_id: websiteId,
          date: gaDate(r.dimensionValues[0].value),
          channel: r.dimensionValues[1].value || "Unassigned",
          sessions: Number(r.metricValues[0].value),
          users: Number(r.metricValues[1].value),
          new_users: Number(r.metricValues[2].value),
          pageviews: Number(r.metricValues[3].value),
          engaged_sessions: Number(r.metricValues[4].value),
        }));
        for (const part of chunk(mapped, 1000)) {
          const { error } = await db.from("traffic_daily").upsert(part);
          if (error) throw new Error(error.message);
        }
        total += mapped.length;
        if (rows.length < 50000) break;
        offset += 50000;
      }
      out.traffic = total >= 0 ? "ok" : "";
    } catch (e) {
      out.traffic = (e as Error).message;
    }
  }

  if (site && full) {
    try {
      const rows = await gsc(tokens.gsc, site, {
        startDate: daysAgo(480),
        endDate: daysAgo(1),
        dimensions: ["date"],
        rowLimit: 25000,
      });
      const mapped = rows.map((r) => ({
        website_id: websiteId,
        date: r.keys[0],
        source: "gsc",
        data: {
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        },
      }));
      for (const part of chunk(mapped, 1000))
        await db.from("daily_metrics").upsert(part);
    } catch (e) {
      out.gsc_history = (e as Error).message;
    }
  }

  // first day with a visit + mark the backfill as done
  const { data: first } = await db
    .from("traffic_daily")
    .select("date")
    .eq("website_id", websiteId)
    .gt("sessions", 0)
    .order("date")
    .limit(1);
  const patch: Record<string, unknown> = {
    traffic_start: first?.[0]?.date ?? null,
  };
  if (full && out.traffic === "ok")
    patch.traffic_backfilled_at = new Date().toISOString();
  await db.from("websites").update(patch).eq("id", websiteId);
  return out;
}

export async function syncWebsite(
  websiteId: string,
  opts: { backfill?: boolean } = {},
) {
  const db = admin();
  const { data: ints } = await db
    .from("integrations")
    .select("provider,config")
    .eq("website_id", websiteId);
  const site = ints?.find((i) => i.provider === "gsc")?.config?.siteUrl as
    string | undefined;
  const property = ints?.find((i) => i.provider === "ga4")?.config
    ?.propertyId as string | undefined;
  if (!site && !property)
    throw new HttpError(
      400,
      "Pick a Search Console site or Analytics property first",
    );

  const gaToken = property ? await tokenFor(websiteId, "ga4") : "";
  const gscToken = site ? await tokenFor(websiteId, "gsc") : "";
  const result: Record<string, string> = {};
  if (site) {
    try {
      await syncGsc(websiteId, gscToken, site);
      result.gsc = "ok";
    } catch (e) {
      result.gsc = (e as Error).message;
    }
  }
  if (property) {
    try {
      await syncGa4(websiteId, gaToken, property);
      result.ga4 = "ok";
    } catch (e) {
      result.ga4 = (e as Error).message;
    }
  }
  // History: the first sync (or "Load full history") stores everything, later syncs only refresh the last 14 days.
  const { data: w } = await db
    .from("websites")
    .select("traffic_backfilled_at")
    .eq("id", websiteId)
    .maybeSingle();
  const full = opts.backfill === true || !w?.traffic_backfilled_at;
  Object.assign(
    result,
    await syncTrafficHistory(
      websiteId,
      { ga: gaToken, gsc: gscToken },
      property,
      site,
      full,
    ),
  );
  await db
    .from("websites")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", websiteId);
  return result;
}
