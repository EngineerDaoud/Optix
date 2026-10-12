import { admin, HttpError } from "./utils.ts";

// Daily free limit per user for the actions that spend Serper / AI credits.
// Set with secrets (a number per day; 0 = no limit):  QUOTA_RESEARCH_PER_DAY, QUOTA_KEYWORDS_PER_DAY, QUOTA_BACKLINKS_PER_DAY
// ADMIN_EMAILS (comma list) are never limited. Saved results (cache and data bank) are answered before this is called, so they cost nothing.

const DEFAULTS = { research: 0, keywords: 0, backlinks: 0 } as const; // 0 = no limit
const LABEL = {
  research: "new website reports",
  keywords: "keyword lookups",
  backlinks: "backlink scans",
} as const;

export function isAdmin(user: { email?: string }) {
  const admins = (Deno.env.get("ADMIN_EMAILS") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return !!user.email && admins.includes(user.email.toLowerCase());
}

export async function takeQuota(
  user: { id: string; email?: string },
  kind: keyof typeof DEFAULTS,
) {
  const admins = (Deno.env.get("ADMIN_EMAILS") ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (user.email && admins.includes(user.email.toLowerCase())) return;
  const limit = Number(
    Deno.env.get(`QUOTA_${kind.toUpperCase()}_PER_DAY`) ?? DEFAULTS[kind],
  );
  if (!Number.isFinite(limit) || limit <= 0) return;
  const { data, error } = await admin().rpc("take_quota", {
    p_user: user.id,
    p_kind: kind,
    p_limit: limit,
  });
  if (error) {
    console.error("take_quota failed (run migration 009?):", error.message);
    return;
  } // never break the app because of the counter
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    throw new HttpError(
      429,
      `Daily free limit reached: ${limit} ${LABEL[kind]} per day. Saved results are still free, and the limit resets at midnight UTC.`,
    );
  }
}
