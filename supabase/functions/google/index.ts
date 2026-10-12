import {
  admin,
  handle,
  HttpError,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import { accessToken } from "../_shared/google.ts";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/google`;
const b64 = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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

async function makeState(websiteId: string, userId: string) {
  const payload = b64(
    JSON.stringify({ w: websiteId, u: userId, t: Date.now() }),
  );
  return `${payload}.${await sign(payload)}`;
}

async function readState(state: string) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || (await sign(payload)) !== sig)
    throw new HttpError(400, "Invalid state");
  const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  if (Date.now() - data.t > 15 * 60 * 1000)
    throw new HttpError(400, "Connect link expired, try again");
  return data as { w: string; u: string };
}

const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { Location: to } });

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
          `${appUrl}/integrations?google_error=${encodeURIComponent(url.searchParams.get("error") ?? "cancelled")}`,
        );
      }
      const { w, u } = await readState(state);
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
          `${appUrl}/integrations?google_error=${encodeURIComponent(tok.error_description ?? "no_refresh_token")}`,
        );
      }
      await db.from("integration_secrets").upsert({
        website_id: w,
        provider: "google",
        secret: { refresh_token: tok.refresh_token },
        updated_at: new Date().toISOString(),
      });
      await db.from("integrations").upsert(
        [
          { website_id: w, user_id: u, provider: "gsc" },
          { website_id: w, user_id: u, provider: "ga4" },
        ],
        { onConflict: "website_id,provider", ignoreDuplicates: true },
      );
      return redirect(`${appUrl}/integrations?google=connected`);
    }

    // ---- Authenticated actions ----
    const user = await requireUser(req);
    const body = await req.json();
    const site = await ownedWebsite(user.id, body.website_id);

    if (body.action === "start") {
      const qs = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent",
        state: await makeState(site.id, user.id),
      });
      return json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${qs}`,
      });
    }

    if (body.action === "resources") {
      const token = await accessToken(site.id);
      const headers = { Authorization: `Bearer ${token}` };
      const [sc, ga] = await Promise.all([
        fetch("https://www.googleapis.com/webmasters/v3/sites", {
          headers,
        }).then((r) => r.json()),
        fetch(
          "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
          { headers },
        ).then((r) => r.json()),
      ]);
      const sites = (sc.siteEntry ?? []).map(
        (s: { siteUrl: string }) => s.siteUrl,
      );
      const properties = (ga.accountSummaries ?? []).flatMap(
        (a: {
          displayName: string;
          propertySummaries?: { property: string; displayName: string }[];
        }) =>
          (a.propertySummaries ?? []).map((p) => ({
            id: p.property.replace("properties/", ""),
            name: `${a.displayName} / ${p.displayName}`,
          })),
      );
      return json({
        sites,
        properties,
        errors: { gsc: sc.error?.message, ga4: ga.error?.message },
      });
    }

    if (body.action === "save") {
      if (body.siteUrl) {
        await db
          .from("integrations")
          .update({ config: { siteUrl: body.siteUrl } })
          .eq("website_id", site.id)
          .eq("provider", "gsc");
      }
      if (body.propertyId) {
        const { data: cur } = await db
          .from("integrations")
          .select("config")
          .eq("website_id", site.id)
          .eq("provider", "ga4")
          .maybeSingle();
        const keepManaged =
          cur?.config?.managed &&
          String(cur.config.propertyId) === String(body.propertyId);
        await db
          .from("integrations")
          .update({
            config: keepManaged ? cur!.config : { propertyId: body.propertyId },
          })
          .eq("website_id", site.id)
          .eq("provider", "ga4");
      }
      return json({ ok: true });
    }

    if (body.action === "disconnect") {
      // the automatic (managed) Analytics property is not tied to the user's Google sign-in, so it stays
      const { data: ga } = await db
        .from("integrations")
        .select("config")
        .eq("website_id", site.id)
        .eq("provider", "ga4")
        .maybeSingle();
      await db
        .from("integrations")
        .delete()
        .eq("website_id", site.id)
        .eq("provider", "gsc");
      if (ga && !ga.config?.managed)
        await db
          .from("integrations")
          .delete()
          .eq("website_id", site.id)
          .eq("provider", "ga4");
      await db.from("integration_secrets").delete().eq("website_id", site.id);
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown action");
  }),
);
