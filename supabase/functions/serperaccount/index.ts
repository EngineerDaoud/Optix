// Admin only: how many Serper credits are left on the SERPER_API_KEY that the app uses.
// The key stays on the server (Supabase secret), the browser only gets the numbers.
import { admin, handle, HttpError, json, requireUser } from "../_shared/utils.ts";

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const { data: row } = await admin()
      .from("allowed_users")
      .select("role")
      .eq("email", (user.email ?? "").toLowerCase())
      .maybeSingle();
    if (row?.role !== "admin") throw new HttpError(403, "Admins only");

    const key = Deno.env.get("SERPER_API_KEY");
    if (!key) throw new HttpError(400, "SERPER_API_KEY is not set in the Supabase secrets");

    const r = await fetch("https://google.serper.dev/account", {
      headers: { "X-API-KEY": key },
    });
    if (r.status === 401 || r.status === 403)
      throw new HttpError(400, "Serper rejected the API key. Check SERPER_API_KEY.");
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try {
      j = JSON.parse(text);
    } catch {
      /* not json */
    }
    if (!r.ok)
      throw new HttpError(502, `Serper answered ${r.status}: ${text.slice(0, 160)}`);

    // Serper names the number "balance"; the other names are only a safety net
    const pick = (...names: string[]) => {
      for (const n of names) {
        const v = j[n];
        if (typeof v === "number") return v;
        if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
      }
      return null;
    };
    const balance = pick("balance", "credits", "remainingCredits", "remaining");
    const rateLimit = pick("rateLimit", "rate_limit", "qps");
    return json({ balance, rateLimit, checkedAt: new Date().toISOString() });
  }),
);