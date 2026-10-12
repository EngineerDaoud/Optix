import {
  admin,
  daysAgo,
  handle,
  HttpError,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import { claude } from "../_shared/ai.ts";
import { loadContext } from "../_shared/report.ts";

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const { website_id } = await req.json();
    const site = await ownedWebsite(user.id, website_id);
    const ctx = await loadContext(site.id, daysAgo(30), daysAgo(1));
    if (!ctx.current.clicks && !ctx.current.sessions)
      throw new HttpError(400, "No data yet. Connect Google and sync first.");

    const text = await claude(
      `You are an SEO and ecommerce analyst. From the data, return ONLY a JSON array (no markdown) of 4 to 6 insights.
Each item: {"title": short headline with the real numbers, "detail": one or two plain sentences on why it matters, "priority": "high"|"medium"|"low", "action": one concrete task to do}.
Use only the numbers given. Do not invent data.`,
      JSON.stringify({
        site: site.url,
        last30days: ctx.current,
        previous30days: ctx.previous,
        topQueries: ctx.queries.slice(0, 10),
        topPages: ctx.pages.slice(0, 8),
        channels: ctx.channels,
        auditIssues: (ctx.audit?.issues ?? []).slice(0, 8),
      }),
      1500,
    );
    let items: unknown;
    try {
      items = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      throw new HttpError(
        502,
        "AI returned an unreadable answer, please try again",
      );
    }
    await admin()
      .from("insights")
      .upsert({
        website_id: site.id,
        items,
        created_at: new Date().toISOString(),
      });
    return json({ items });
  }),
);
