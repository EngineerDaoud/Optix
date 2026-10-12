import {
  admin,
  handle,
  HttpError,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import {
  createManagedProperty,
  deleteManagedProperty,
  realtimeUsers,
  snippet,
} from "../_shared/gamanaged.ts";

// Automatic Google Analytics for every website a user adds. See _shared/gamanaged.ts for the one-time setup.
//   create : makes a GA4 property + web stream in YOUR Analytics account and returns the snippet to paste
//   status : returns the saved Measurement ID and snippet
//   verify : opens the site, looks for the Measurement ID in the page, and reads realtime visitors
//   remove : deletes the property again (used when the website is removed)

const perUserLimit = () =>
  Math.max(1, Number(Deno.env.get("MANAGED_GA_PER_USER") ?? 5) || 5);
const isAdmin = (email?: string) =>
  !!email &&
  (Deno.env.get("ADMIN_EMAILS") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(email.toLowerCase());

type Cfg = {
  managed?: boolean;
  status?: string;
  propertyId?: string;
  measurementId?: string;
  streamId?: string;
};

async function ga4Row(websiteId: string) {
  const { data } = await admin()
    .from("integrations")
    .select("config")
    .eq("website_id", websiteId)
    .eq("provider", "ga4")
    .maybeSingle();
  return data ? ((data.config ?? {}) as Cfg) : null;
}

const view = (c: Cfg) => ({
  managed: true,
  status: c.status === "creating" ? "creating" : "ready",
  propertyId: c.propertyId ?? null,
  measurementId: c.measurementId ?? null,
  snippet: c.measurementId ? snippet(c.measurementId) : null,
});

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const body = await req.json();
    const site = await ownedWebsite(user.id, String(body.website_id ?? ""));
    const db = admin();
    const action = String(body.action ?? "status");

    if (action === "status") {
      const c = await ga4Row(site.id);
      if (!c) return json({ managed: false, other: false });
      if (!c.managed) return json({ managed: false, other: true }); // user connected their own Analytics through Google sign-in
      return json(view(c));
    }

    if (action === "create") {
      const existing = await ga4Row(site.id);
      if (existing?.managed) return json(view(existing));
      if (existing)
        throw new HttpError(
          400,
          "This website already uses your own Google Analytics (connected with Google sign-in).",
        );

      if (!isAdmin(user.email)) {
        const { count } = await db
          .from("integrations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("provider", "ga4")
          .contains("config", { managed: true });
        if ((count ?? 0) >= perUserLimit())
          throw new HttpError(
            429,
            `Free plan limit: ${perUserLimit()} websites with automatic Analytics.`,
          );
      }

      // reserve the row first, so two quick clicks can never create two properties
      const { error: lockErr } = await db.from("integrations").insert({
        website_id: site.id,
        user_id: user.id,
        provider: "ga4",
        config: { managed: true, status: "creating" },
      });
      if (lockErr) {
        const c = await ga4Row(site.id);
        if (c?.managed) return json(view(c));
        throw new HttpError(409, "Could not start. Try again.");
      }
      try {
        const p = await createManagedProperty(site.url, site.name ?? site.url);
        const config: Cfg = {
          managed: true,
          propertyId: p.propertyId,
          measurementId: p.measurementId,
          streamId: p.streamId,
        };
        await db
          .from("integrations")
          .update({ config })
          .eq("website_id", site.id)
          .eq("provider", "ga4");
        return json(view(config));
      } catch (e) {
        await db
          .from("integrations")
          .delete()
          .eq("website_id", site.id)
          .eq("provider", "ga4"); // free the lock so it can be retried
        throw e;
      }
    }

    const c = await ga4Row(site.id);

    if (action === "verify") {
      if (!c?.managed || !c.measurementId || !c.propertyId)
        throw new HttpError(400, "Create the tracking code first.");
      let installed = false;
      let reason = "";
      try {
        const r = await fetch(site.url, {
          signal: AbortSignal.timeout(12000),
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SEOPilotBot/1.0)",
          },
        });
        const html = (await r.text()).slice(0, 2_000_000);
        installed = html.includes(c.measurementId);
        if (!installed)
          reason =
            "The code was not found in the home page source. If you added it through Google Tag Manager this check cannot see it, so look at Realtime instead.";
      } catch {
        reason = "Could not open the website to look for the code.";
      }
      const live = await realtimeUsers(c.propertyId);
      return json({
        installed,
        reason,
        activeUsers: live,
        receiving: (live ?? 0) > 0,
      });
    }

    if (action === "remove") {
      if (c?.managed) {
        if (c.propertyId) {
          try {
            await deleteManagedProperty(c.propertyId);
          } catch {
            /* already gone or no access: still remove our row */
          }
        }
        await db
          .from("integrations")
          .delete()
          .eq("website_id", site.id)
          .eq("provider", "ga4");
      }
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown action");
  }),
);
