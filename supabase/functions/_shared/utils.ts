import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// supabase-js never throws when a save fails, it returns { error }. Many saves in the data bank are "best effort"
// (wrapped in try/catch), so a failed write used to vanish without a trace. This logs every failed database
// write, and every missing table, to Supabase > Edge Functions > (function) > Logs. It changes nothing else.
const loggingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!res.ok) {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const read = method === "GET" || method === "HEAD";
      if (url.includes("/rest/v1/") && (!read || res.status === 404 || res.status >= 500)) {
        const what = (url.split("/rest/v1/")[1] ?? "").split("?")[0];
        const msg = await res.clone().text().catch(() => "");
        console.error(
          `[db ${read ? "read" : "write"} failed] ${method} ${what} -> ${res.status} ${msg.slice(0, 300)}`,
        );
      }
    } catch {
      /* logging must never break a request */
    }
  }
  return res;
};

export const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
      global: { fetch: loggingFetch },
    },
  );

export const handle =
  (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: (e as Error).message }, status);
    }
  };

export async function requireUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again");
  // Only approved emails may use the app (list lives in the allowed_users table).
  const email = (data.user.email ?? "").toLowerCase();
  const { data: row } = await admin()
    .from("allowed_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (!row) throw new HttpError(403, "This account is not approved for access");
  return data.user;
}

export async function ownedWebsite(userId: string, websiteId: string) {
  const { data } = await admin()
    .from("websites")
    .select("*")
    .eq("id", websiteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Website not found");
  return data as {
    id: string;
    user_id: string;
    url: string;
    name: string | null;
  };
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};