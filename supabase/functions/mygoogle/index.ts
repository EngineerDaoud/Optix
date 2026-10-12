// "My Google": connect your Google account ONCE, then for any website you analyze SEOPilot finds the
// matching Google Analytics 4 property and Search Console site that your account can access and shows the real data.
// Only reads data (analytics.readonly + webmasters.readonly). It cannot see sites your Google account has no access to.
import {
  admin,
  daysAgo,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { detectShopify } from "../_shared/shopify.ts";
import { serviceToken } from "../_shared/gamanaged.ts";
import { scoreSite } from "../_shared/sitescore.ts";

// the store check opens a few dozen public pages: keep the answer for 30 minutes so reloading does not hit the store again
const shopCache = new Map<string, { t: number; v: unknown }>();
async function shopifyCached(
  host: string,
  home: { html: string; shopHeader: boolean } | null,
  fresh: boolean,
) {
  const hit = shopCache.get(host);
  if (!fresh && hit && Date.now() - hit.t < 30 * 60_000) return hit.v;
  const v = await detectShopify(host, home);
  if ((v as any)?.detected) shopCache.set(host, { t: Date.now(), v });
  return v;
}

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

const redirectUri = () =>
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/mygoogle`;
const b64 = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { Location: to } });

async function sign(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("STATE_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64(String.fromCharCode(...new Uint8Array(sig)));
}
async function makeState(userId: string) {
  const payload = b64(JSON.stringify({ u: userId, t: Date.now() }));
  return `${payload}.${await sign(payload)}`;
}
async function readState(state: string) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || (await sign(payload)) !== sig)
    throw new HttpError(400, "Invalid state");
  const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  if (Date.now() - data.t > 15 * 60 * 1000)
    throw new HttpError(400, "Connect link expired, try again");
  return data as { u: string };
}

const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
};
/** a === b, or one is a sub-domain of the other (shop.example.com vs example.com) */
const related = (a: string, b: string) =>
  !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

async function accessToken(userId: string): Promise<string> {
  const { data } = await admin()
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.refresh_token)
    throw new HttpError(400, "Google is not connected yet");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(
      400,
      `Google sign-in expired (${j.error_description ?? j.error}). Press "Connect Google" again.`,
    );
  return j.access_token as string;
}

const gget = async (url: string, token: string) => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok)
    throw new Error(j?.error?.message ?? `Google returned ${r.status}`);
  return j;
};
const gpost = async (url: string, token: string, body: unknown) => {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok)
    throw new Error(j?.error?.message ?? `Google returned ${r.status}`);
  return j;
};

/* ------------------------------------------------------------ matching */
async function listGscSites(token: string): Promise<string[]> {
  const j = await gget("https://www.googleapis.com/webmasters/v3/sites", token);
  return (j.siteEntry ?? []).map((s: { siteUrl: string }) => s.siteUrl);
}
function pickGscSite(sites: string[], host: string): string | null {
  const norm = (s: string) =>
    s.startsWith("sc-domain:") ? s.slice(10).toLowerCase() : hostOf(s);
  const exactDomain = sites.find((s) => s === `sc-domain:${host}`);
  if (exactDomain) return exactDomain;
  const exactPrefix = sites.filter(
    (s) => !s.startsWith("sc-domain:") && hostOf(s) === host,
  );
  if (exactPrefix.length)
    return exactPrefix.find((s) => s.startsWith("https://")) ?? exactPrefix[0];
  return sites.find((s) => related(norm(s), host)) ?? null;
}

async function listGaProperties(
  token: string,
): Promise<{ id: string; name: string }[]> {
  const j = await gget(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
    token,
  );
  return (j.accountSummaries ?? []).flatMap(
    (a: {
      displayName: string;
      propertySummaries?: { property: string; displayName: string }[];
    }) =>
      (a.propertySummaries ?? []).map((p) => ({
        id: p.property.replace("properties/", ""),
        name: `${a.displayName} / ${p.displayName}`,
      })),
  );
}
const isManaged = (name: string) => /^SEOPilot\s*[:\/]/.test(name); // empty properties SEOPilot created itself (no tracking code on the real site)

/** Automatic Analytics: the GA4 property SEOPilot created for this user's website. It lives in SEOPilot's own
 *  Analytics account, so the user's Google sign-in can never see it. It is read with the service account instead. */
async function managedGa(
  db: ReturnType<typeof admin>,
  userId: string,
  host: string,
) {
  const { data: sites } = await db
    .from("websites")
    .select("id,url")
    .eq("user_id", userId);
  const site = (sites ?? []).find((w: any) => hostOf(String(w.url)) === host);
  if (!site) return null;
  const { data } = await db
    .from("integrations")
    .select("config")
    .eq("website_id", site.id)
    .eq("provider", "ga4")
    .maybeSingle();
  const c = data?.config as { managed?: boolean; propertyId?: string } | null;
  if (!c?.managed || !c.propertyId) return null;
  return { id: String(c.propertyId), name: `SEOPilot: ${host}` };
}

async function findGaProperty(
  token: string,
  props: { id: string; name: string }[],
  host: string,
) {
  // 1) the website address saved inside each property's web data stream
  const hit = async (p: { id: string; name: string }) => {
    try {
      const j = await gget(
        `https://analyticsadmin.googleapis.com/v1beta/properties/${p.id}/dataStreams?pageSize=50`,
        token,
      );
      const ok = (j.dataStreams ?? []).some(
        (s: { webStreamData?: { defaultUri?: string } }) =>
          related(hostOf(s.webStreamData?.defaultUri ?? ""), host),
      );
      return ok ? p : null;
    } catch {
      return null;
    }
  };
  const search = async (list: { id: string; name: string }[]) => {
    const slice = list.slice(0, 80);
    for (let i = 0; i < slice.length; i += 10) {
      const found = (await Promise.all(slice.slice(i, i + 10).map(hit))).find(
        Boolean,
      );
      if (found) return found;
    }
    return null;
  };
  // real properties first, SEOPilot's own empty ones only as a last resort
  const real = props.filter((p) => !isManaged(p.name));
  const own = props.filter((p) => isManaged(p.name));
  const byStream = (await search(real)) ?? null;
  if (byStream) return byStream;
  // 2) a real property whose name contains the domain (e.g. "example.com")
  const base = host.split(".")[0];
  const byName =
    real.find((p) => p.name.toLowerCase().includes(host)) ??
    real.find((p) => base.length > 3 && p.name.toLowerCase().includes(base));
  if (byName) return byName;
  return (
    (await search(own)) ??
    own.find((p) => p.name.toLowerCase().includes(host)) ??
    null
  );
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; SEOPilot/1.0)" };

async function fetchHome(
  host: string,
): Promise<{ html: string; shopHeader: boolean } | null> {
  try {
    const r = await fetch(`https://${host}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: UA,
    });
    const shopHeader = !!(
      r.headers.get("x-shopid") ||
      r.headers.get("x-shopify-stage") ||
      r.headers.get("powered-by")?.toLowerCase().includes("shopify")
    );
    return { html: (await r.text()).slice(0, 800_000), shopHeader };
  } catch {
    return null;
  }
}

/** Looks at the website's home page for tracking codes: tells you what the site uses, even without access to its data. */
function detectTracking(html: string | null) {
  if (!html) return null;
  const uniq = (re: RegExp) =>
    [...new Set([...html.matchAll(re)].map((m) => m[0]))].slice(0, 4);
  const one = (re: RegExp) => html.match(re)?.[1] ?? null;
  return {
    ga4: uniq(/\bG-[A-Z0-9]{6,12}\b/g),
    gtm: uniq(/\bGTM-[A-Z0-9]{4,10}\b/g),
    universal: uniq(/\bUA-\d{4,10}-\d{1,3}\b/g),
    metaPixel: one(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/),
    tiktokPixel: one(/ttq\.load\(\s*['"]([A-Za-z0-9]{8,30})['"]/),
    klaviyo: /klaviyo/i.test(html),
    searchConsoleTag: /name=["']google-site-verification["']/i.test(html),
  };
}

/* ------------------------------------------------------------ GA4 */
const mv = (row: any, i: number) => Number(row?.metricValues?.[i]?.value ?? 0);
const dv = (row: any, i = 0) => String(row?.dimensionValues?.[i]?.value ?? "");

async function ga4Report(
  token: string,
  property: string,
  start: string,
  end: string,
  pStart: string,
  pEnd: string,
) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`;
  const range = { startDate: start, endDate: end };
  const metricsTotals = [
    "sessions",
    "totalUsers",
    "newUsers",
    "engagedSessions",
    "engagementRate",
    "screenPageViews",
    "averageSessionDuration",
    "bounceRate",
  ].map((name) => ({ name }));
  const [tot, daily, ch, co, pg, dev] = await Promise.all([
    gpost(url, token, {
      dateRanges: [range, { startDate: pStart, endDate: pEnd }],
      metrics: metricsTotals,
    }),
    gpost(url, token, {
      dateRanges: [range],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 100,
    }),
    gpost(url, token, {
      dateRanges: [range],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    gpost(url, token, {
      dateRanges: [range],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    gpost(url, token, {
      dateRanges: [range],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    }),
    gpost(url, token, {
      dateRanges: [range],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5,
    }),
  ]);
  const rowFor = (label: string) =>
    (tot.rows ?? []).find((r: any) => dv(r) === label);
  const shape = (r: any) => ({
    sessions: mv(r, 0),
    users: mv(r, 1),
    newUsers: mv(r, 2),
    engagedSessions: mv(r, 3),
    engagementRate: mv(r, 4),
    pageviews: mv(r, 5),
    avgDuration: mv(r, 6),
    bounceRate: mv(r, 7),
  });
  return {
    totals: shape(rowFor("date_range_0")),
    prev: shape(rowFor("date_range_1")),
    daily: (daily.rows ?? []).map((r: any) => ({
      date: `${dv(r).slice(0, 4)}-${dv(r).slice(4, 6)}-${dv(r).slice(6, 8)}`,
      sessions: mv(r, 0),
      users: mv(r, 1),
    })),
    channels: (ch.rows ?? []).map((r: any) => ({
      key: dv(r),
      value: mv(r, 0),
    })),
    countries: (co.rows ?? []).map((r: any) => ({
      key: dv(r),
      value: mv(r, 0),
      users: mv(r, 1),
    })),
    pages: (pg.rows ?? []).map((r: any) => ({
      key: dv(r),
      views: mv(r, 0),
      users: mv(r, 1),
    })),
    devices: (dev.rows ?? []).map((r: any) => ({
      key: dv(r),
      value: mv(r, 0),
    })),
  };
}

/* ------------------------------------------------------------ Search Console */
async function gscReport(
  token: string,
  site: string,
  start: string,
  end: string,
  pStart: string,
  pEnd: string,
) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const q = (dimensions: string[], limit: number, s = start, e = end) =>
    gpost(url, token, {
      startDate: s,
      endDate: e,
      dimensions,
      rowLimit: limit,
    });
  const [daily, queries, pages, countries, devices, prev] = await Promise.all([
    q(["date"], 100),
    q(["query"], 15),
    q(["page"], 10),
    q(["country"], 8),
    q(["device"], 3),
    q([], 1, pStart, pEnd),
  ]);
  const dRows = (daily.rows ?? []).map((r: any) => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position,
  }));
  const clicks = dRows.reduce((a: number, r: any) => a + r.clicks, 0);
  const impressions = dRows.reduce((a: number, r: any) => a + r.impressions, 0);
  const position = impressions
    ? dRows.reduce((a: number, r: any) => a + r.position * r.impressions, 0) /
      impressions
    : 0;
  const p = prev.rows?.[0];
  const list = (j: any) =>
    (j.rows ?? []).map((r: any) => ({
      key: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));
  return {
    totals: {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position,
    },
    prev: p
      ? {
          clicks: p.clicks,
          impressions: p.impressions,
          ctr: p.ctr,
          position: p.position,
        }
      : null,
    daily: dRows.map((r: any) => ({
      date: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
    })),
    queries: list(queries),
    pages: list(pages),
    countries: list(countries),
    devices: list(devices),
  };
}

/* ------------------------------------------------------------ server */
Deno.serve(
  handle(async (req) => {
    const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
    const db = admin();

    // ---- OAuth callback (browser redirect from Google, no JWT) ----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error") || !code || !state) {
        return redirect(
          `${appUrl}/dashboard?mygoogle_error=${encodeURIComponent(url.searchParams.get("error") ?? "cancelled")}`,
        );
      }
      const { u } = await readState(state);
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
          client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
        }),
      });
      const tok = await r.json();
      if (!r.ok || !tok.refresh_token) {
        return redirect(
          `${appUrl}/dashboard?mygoogle_error=${encodeURIComponent(tok.error_description ?? "no_refresh_token")}`,
        );
      }
      let email: string | null = null;
      try {
        email =
          JSON.parse(
            atob(
              String(tok.id_token)
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          ).email ?? null;
      } catch {
        /* optional */
      }
      await db
        .from("google_accounts")
        .upsert({
          user_id: u,
          refresh_token: tok.refresh_token,
          email,
          updated_at: new Date().toISOString(),
        });
      await db.from("google_site_map").delete().eq("user_id", u); // re-match everything with the new account
      return redirect(`${appUrl}/dashboard?mygoogle=connected`);
    }

    // ---- authenticated actions ----
    const user = await requireUser(req);
    const body = await req.json();

    if (body.action === "status") {
      const { data } = await db
        .from("google_accounts")
        .select("email")
        .eq("user_id", user.id)
        .maybeSingle();
      return json({ connected: !!data, email: data?.email ?? null });
    }

    if (body.action === "start") {
      const qs = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent select_account",
        state: await makeState(user.id),
      });
      return json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${qs}`,
      });
    }

    if (body.action === "disconnect") {
      await db.from("google_accounts").delete().eq("user_id", user.id);
      await db.from("google_site_map").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    if (body.action === "report") {
      const host = hostOf(String(body.url ?? ""));
      if (!host) throw new HttpError(400, "Enter a valid website address");
      // Google is optional: without a connected account the public facts (store data, tracking) are still returned.
      const { data: acct } = await db
        .from("google_accounts")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const token = acct ? await accessToken(user.id) : null;

      // 1) which GA4 property and Search Console site belong to this host?
      const { data: cached } = await db
        .from("google_site_map")
        .select("*")
        .eq("user_id", user.id)
        .eq("host", host)
        .maybeSingle();
      const fresh =
        cached &&
        Date.now() - new Date(cached.checked_at).getTime() < 24 * 3600 * 1000 &&
        (cached.gsc_site || cached.ga_property);
      let gscSite: string | null = cached?.gsc_site ?? null;
      let gaId: string | null = cached?.ga_property ?? null;
      let gaName: string | null = cached?.ga_name ?? null;
      const counts = { sites: 0, properties: 0 };
      const errors: { gsc?: string; ga4?: string } = {};

      if (token && (!fresh || body.rematch)) {
        const [sitesR, propsR] = await Promise.allSettled([
          listGscSites(token),
          listGaProperties(token),
        ]);
        if (sitesR.status === "fulfilled") {
          counts.sites = sitesR.value.length;
          gscSite = pickGscSite(sitesR.value, host);
        } else errors.gsc = (sitesR.reason as Error).message;
        if (propsR.status === "fulfilled") {
          counts.properties = propsR.value.length;
          const p = await findGaProperty(token, propsR.value, host);
          gaId = p?.id ?? null;
          gaName = p?.name ?? null;
        } else errors.ga4 = (propsR.reason as Error).message;
        if (!errors.gsc && !errors.ga4) {
          await db
            .from("google_site_map")
            .upsert({
              user_id: user.id,
              host,
              gsc_site: gscSite,
              ga_property: gaId,
              ga_name: gaName,
              checked_at: new Date().toISOString(),
            });
        }
      }

      // 1b) no property of the user's own Google account? use the automatic one SEOPilot created for this site
      let gaTok: string | null = token;
      if (!gaId || isManaged(gaName ?? "")) {
        const m = await managedGa(db, user.id, host);
        if (m) {
          gaId = m.id;
          gaName = m.name;
          try {
            gaTok = await serviceToken();
          } catch (e) {
            gaTok = null;
            errors.ga4 = (e as Error).message;
          }
        }
      }

      // 2) pull the numbers (last 28 full days vs the 28 days before)
      const start = daysAgo(28),
        end = daysAgo(1),
        pStart = daysAgo(56),
        pEnd = daysAgo(29);
      const gscEnd = daysAgo(3),
        gscStart = daysAgo(30),
        gscPStart = daysAgo(58),
        gscPEnd = daysAgo(31); // Search Console data lags ~2 days
      const home = await fetchHome(host);
      const [shopify, ga, gs] = await Promise.all([
        shopifyCached(host, home, !!body.rematch),
        gaTok && gaId
          ? ga4Report(gaTok, gaId, start, end, pStart, pEnd).catch((e) => {
              errors.ga4 = (e as Error).message;
              return null;
            })
          : null,
        token && gscSite
          ? gscReport(
              token,
              gscSite,
              gscStart,
              gscEnd,
              gscPStart,
              gscPEnd,
            ).catch((e) => {
              errors.gsc = (e as Error).message;
              return null;
            })
          : null,
      ]);

      const tracking = detectTracking(home?.html ?? null);
      const score = scoreSite({
        shopify,
        tracking,
        ga,
        gsc: gs,
        connected: !!(token || gaTok),
      });

      return json({
        host,
        score,
        ga4: ga
          ? {
              property: gaId,
              name: gaName,
              managed: isManaged(gaName ?? ""),
              from: start,
              to: end,
              ...ga,
            }
          : null,
        gsc: gs ? { site: gscSite, from: gscStart, to: gscEnd, ...gs } : null,
        matched: { ga4: !!gaId, gsc: !!gscSite },
        tracking,
        shopify,
        v: 6,
        connected: !!token,
        counts,
        errors,
      });
    }

    throw new HttpError(400, "Unknown action");
  }),
);