import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

/* ---- activity log: every command a user runs is saved so the admin can see it ---- */
const SECRET_KEY = /(^|_)(token|secret|password|authorization|code|apikey|api_key)$/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object))
      out[k] = SECRET_KEY.test(k) ? "[hidden]" : redact(val, depth + 1);
    return out;
  }
  return v;
}
function clip(v: unknown, max: number): string {
  let s: string;
  try {
    s = JSON.stringify(redact(v)) ?? "";
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + " …[cut]" : s;
}
async function logActivity(row: {
  action: string;
  request: object;
  response?: unknown;
  ok: boolean;
  error?: string;
  ms: number;
}) {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data.session?.user;
    if (!u?.email) return;
    await supabase.from("activity_log").insert({
      user_id: u.id,
      email: u.email.toLowerCase(),
      action: row.action,
      request: clip(row.request, 4000),
      response: row.response === undefined ? null : clip(row.response, 20000),
      ok: row.ok,
      error: row.error ?? null,
      duration_ms: row.ms,
    });
  } catch {
    /* logging must never break the app */
  }
}

/** Call an edge function and surface the real error message. */
export async function fn<T = any>(
  name: string,
  body: object,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  const t0 = Date.now();
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    signal,
  });
  if (error) {
    let msg = error.message;
    const res = (error as any).context as Response | undefined;
    try {
      const j = await res?.clone().json();
      if (j?.error) msg = j.error;
      else if (j?.message) msg = j.message;
    } catch {
      /* body was not json */
    }
    const code = res?.status;
    // the server ran out of time/memory on a big site: try once more automatically (saved Google results make the 2nd run lighter)
    if (name === "research" && code === 546 && !retried && !signal?.aborted)
      return fn<T>(name, body, signal, true);
    if (code === 546 || code === 502 || code === 504)
      msg = `The server stopped this request (status ${code}: out of time or memory). Press the button again.`;
    else if (msg.startsWith("Edge Function returned") && code)
      msg = `${msg} (status ${code})`;
    logActivity({ action: name, request: body, ok: false, error: msg, ms: Date.now() - t0 });
    throw new Error(msg);
  }
  logActivity({ action: name, request: body, response: data, ok: true, ms: Date.now() - t0 });
  return data as T;
}