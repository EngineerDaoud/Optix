import { admin, handle, HttpError, json } from "../_shared/utils.ts";
import { rangeFor } from "../_shared/kpi.ts";
import { createReport } from "../_shared/report.ts";
import { syncWebsite } from "../_shared/sync.ts";
import { refreshAll } from "../competitor/index.ts";

const MIN_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 24 * 6.5,
  fifteen: 24 * 14.5,
  monthly: 24 * 29.5,
};

async function sendEmail(to: string[], subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !to.length) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:
        Deno.env.get("REPORT_FROM_EMAIL") ?? "SEOPilot <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  return r.ok;
}

Deno.serve(
  handle(async (req) => {
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET"))
      throw new HttpError(401, "Unauthorized");
    const db = admin();
    const log: string[] = [];

    // 1) Daily data sync for every website that has Google connected
    const { data: ints } = await db.from("integrations").select("website_id");
    const ids = [...new Set((ints ?? []).map((i) => i.website_id as string))];
    const now = new Date();
    if (now.getUTCHours() === 2) {
      for (const id of ids) {
        try {
          await syncWebsite(id);
          log.push(`synced ${id}`);
        } catch (e) {
          log.push(`sync failed ${id}: ${(e as Error).message}`);
        }
      }
    }

    // 1b) Free competitor traffic estimates (Tranco rank of every tracked website), once a day
    if (now.getUTCHours() === 3) {
      try {
        log.push(...(await refreshAll()).slice(0, 50));
      } catch (e) {
        log.push(`competitors failed: ${(e as Error).message}`);
      }
    }

    // 2) Scheduled reports that are due
    const { data: schedules } = await db
      .from("report_schedules")
      .select("*, websites(id,url,name)")
      .eq("active", true);
    for (const s of schedules ?? []) {
      const hoursSince = s.last_run
        ? (now.getTime() - Date.parse(s.last_run)) / 3600000
        : Infinity;
      if (
        now.getUTCHours() < s.hour_utc ||
        hoursSince < (MIN_HOURS[s.frequency] ?? 24)
      )
        continue;
      try {
        const { from, to } = rangeFor(s.frequency);
        const site = s.websites as {
          id: string;
          url: string;
          name: string | null;
        };
        const report = await createReport({
          site,
          userId: s.user_id,
          type: s.frequency,
          from,
          to,
          sections: s.sections,
        });
        const sent = await sendEmail(
          s.recipients,
          `${site.name || site.url}: ${s.frequency} report (${from} to ${to})`,
          report.html,
        );
        await db
          .from("report_schedules")
          .update({ last_run: now.toISOString() })
          .eq("id", s.id);
        log.push(`report ${s.id} created${sent ? " and emailed" : ""}`);
      } catch (e) {
        log.push(`report ${s.id} failed: ${(e as Error).message}`);
      }
    }
    return json({ log });
  }),
);
