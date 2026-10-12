import { admin, HttpError } from "./utils.ts";
import { serviceToken } from "./gamanaged.ts";

export async function accessToken(websiteId: string): Promise<string> {
  const { data } = await admin()
    .from("integration_secrets")
    .select("secret")
    .eq("website_id", websiteId)
    .eq("provider", "google")
    .maybeSingle();
  const refresh = data?.secret?.refresh_token;
  if (!refresh)
    throw new HttpError(400, "Google is not connected for this website");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new HttpError(
      400,
      `Google token refresh failed: ${j.error_description ?? j.error}. Reconnect Google.`,
    );
  return j.access_token as string;
}

/** Token for one Google product. Websites with automatic (managed) Analytics read GA4 with the service account;
 *  Search Console, and Analytics connected through Google sign-in, use the user's own token. */
export async function tokenFor(
  websiteId: string,
  kind: "ga4" | "gsc",
): Promise<string> {
  if (kind === "ga4") {
    const { data } = await admin()
      .from("integrations")
      .select("config")
      .eq("website_id", websiteId)
      .eq("provider", "ga4")
      .maybeSingle();
    if (data?.config?.managed) return serviceToken();
  }
  return accessToken(websiteId);
}
