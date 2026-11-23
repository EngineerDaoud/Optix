import {
  admin,
  handle,
  HttpError,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import { tokenFor } from "../_shared/google.ts";

// Live visitors of YOUR site, straight from Google Analytics 4 "Realtime" (last 30 minutes). Real numbers, not estimates.
// Works for both ways of connecting Analytics (automatic property or Google sign-in). Nothing is saved: every call asks Google.

const DATA = "https://analyticsdata.googleapis.com/v1beta/properties";

async function report(token: string, property: string, body: object) {
  const r = await fetch(`${DATA}/${property}:runRealtimeReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(j?.error?.message ?? `Google answered ${r.status}`);
    if (r.status === 403 || /permission|not enabled|disabled/i.test(msg))
      throw new HttpError(
        400,
        "Google Analytics did not allow this. Check that the Analytics Data API is enabled and that your Google account can read this property.",
      );
    throw new HttpError(502, msg);
  }
  return (j.rows ?? []) as {
    dimensionValues?: { value: string }[];
    metricValues: { value: string }[];
  }[];
}

const n = (v: string | undefined) => Number(v ?? 0) || 0;

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const { websiteId } = await req.json();
    const site = await ownedWebsite(user.id, String(websiteId ?? ""));
    const { data: ga } = await admin()
      .from("integrations")
      .select("config")
      .eq("website_id", site.id)
      .eq("provider", "ga4")
      .maybeSingle();
    const property = ga?.config?.propertyId as string | undefined;
    if (!property)
      throw new HttpError(
        400,
        "Google Analytics is not connected for this website yet. Connect it on the Integrations page.",
      );
    const token = await tokenFor(site.id, "ga4");
    const prop = property.startsWith("properties/")
      ? property.slice("properties/".length)
      : property;
    const P = `${prop}`;

    const [total, minutes, pages, countries, devices] = await Promise.all([
      report(token, P, { metrics: [{ name: "activeUsers" }] }),
      report(token, P, {
        dimensions: [{ name: "minutesAgo" }],
        metrics: [{ name: "activeUsers" }],
      }),
      report(token, P, {
        dimensions: [{ name: "unifiedScreenName" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 8,
      }),
      report(token, P, {
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 8,
      }),
      report(token, P, {
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
      }),
    ]);

    // GA4 only returns minutes that had visitors: fill the empty ones with 0 so the chart has all 30 minutes (0 = now, 29 = 29 minutes ago).
    const byMin = new Map(
      minutes.map((r) => [Number(r.dimensionValues?.[0]?.value), n(r.metricValues[0]?.value)]),
    );
    const series = Array.from({ length: 30 }, (_, i) => ({
      minutesAgo: 29 - i,
      users: byMin.get(29 - i) ?? 0,
    }));
    const pick = (rows: typeof pages) =>
      rows.map((r) => ({
        name: r.dimensionValues?.[0]?.value || "(not set)",
        users: n(r.metricValues[0]?.value),
      }));
    return json({
      checkedAt: new Date().toISOString(),
      // total is the number of distinct users in the last 30 minutes. Last 5 minutes is what most dashboards call "right now".
      last30: n(total[0]?.metricValues[0]?.value),
      last5: [...byMin.entries()]
        .filter(([m]) => m < 5)
        .reduce((a, [, v]) => a + v, 0),
      series,
      pages: pick(pages),
      countries: pick(countries),
      devices: pick(devices),
    });
  }),
);