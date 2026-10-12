import {
  admin,
  handle,
  HttpError,
  json,
  requireUser,
} from "../_shared/utils.ts";
import { get, parseInput, rootDomain } from "../_shared/siteinfo.ts";

// Free traffic tracker for any website. Real visits of other people's sites are private, so this is an ESTIMATE:
// Tranco (free public list, rank of every site on each of the last 30 days) -> rough monthly visits.
//   visits per month  ~  12,000,000 * (10,000 / rank) ^ 0.95     (calibrated on typical public figures, deliberately rough)
// Sites outside the top 1,000,000 have no rank, so no estimate is made for them.

export const estimateFromRank = (rank: number | null) =>
  rank ? Math.round(12_000_000 * Math.pow(10_000 / rank, 0.95)) : null;

async function history(domain: string) {
  const r = await get(
    `https://tranco-list.eu/api/ranks/domain/${domain}`,
    10000,
  );
  if (!r.ok)
    throw new HttpError(
      502,
      `Tranco did not answer (status ${r.status}). Try again in a minute.`,
    );
  const j = await r.json();
  return ((j.ranks ?? []) as { date: string; rank: number }[]).filter(
    (x) => x.date && typeof x.rank === "number",
  );
}

/** Reads the last 30 days of ranks and saves one row per day. Returns how many days had a rank. */
async function refresh(userId: string, host: string) {
  const db = admin();
  const ranks = await history(rootDomain(host));
  const byDate = new Map(ranks.map((x) => [x.date, x.rank]));
  // Tranco returns only the days the site was listed. Fill the missing days of the last 30 as "not ranked".
  const rows = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const rank = byDate.get(date) ?? null;
    rows.push({
      user_id: userId,
      host,
      date,
      tranco_rank: rank,
      est_monthly_visits: estimateFromRank(rank),
    });
  }
  // Only fill a missing day with "not ranked" when the site has at least one ranked day (the list for the newest day may not be published yet).
  const keep = ranks.length ? rows : [];
  if (keep.length) {
    const { error } = await db.from("competitor_daily").upsert(keep);
    if (error) throw new HttpError(500, error.message);
  }
  await db
    .from("competitor_sites")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("host", host);
  return ranks.length;
}

export async function refreshAll(userId?: string) {
  const db = admin();
  let q = db.from("competitor_sites").select("user_id,host");
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const log: string[] = [];
  for (const s of data ?? []) {
    try {
      await refresh(s.user_id, s.host);
      log.push(`ok ${s.host}`);
    } catch (e) {
      log.push(`failed ${s.host}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1200)); // be gentle with the free Tranco service
  }
  return log;
}

if (import.meta.main) {
  Deno.serve(
    handle(async (req) => {
      const user = await requireUser(req);
      const body = await req.json();
      const db = admin();

      if (body.action === "add") {
        const host = rootDomain(
          parseInput(body.host).hostname.replace(/^www\./, ""),
        );
        const { count } = await db
          .from("competitor_sites")
          .select("host", { count: "exact", head: true })
          .eq("user_id", user.id);
        if ((count ?? 0) >= 50)
          throw new HttpError(400, "You can track up to 50 websites.");
        await db
          .from("competitor_sites")
          .upsert(
            { user_id: user.id, host },
            { onConflict: "user_id,host", ignoreDuplicates: true },
          );
        const days = await refresh(user.id, host);
        return json({ host, rankedDays: days });
      }
      if (body.action === "refresh") {
        if (body.host) {
          const days = await refresh(user.id, String(body.host));
          return json({ rankedDays: days });
        }
        return json({ log: await refreshAll(user.id) });
      }
      if (body.action === "remove") {
        await db
          .from("competitor_daily")
          .delete()
          .eq("user_id", user.id)
          .eq("host", body.host);
        await db
          .from("competitor_sites")
          .delete()
          .eq("user_id", user.id)
          .eq("host", body.host);
        return json({ ok: true });
      }
      throw new HttpError(400, "Unknown action");
    }),
  );
}
