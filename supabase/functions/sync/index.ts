import { handle, json, ownedWebsite, requireUser } from "../_shared/utils.ts";
import { syncWebsite } from "../_shared/sync.ts";

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const { website_id, mode } = await req.json();
    const site = await ownedWebsite(user.id, website_id);
    return json({
      result: await syncWebsite(site.id, { backfill: mode === "backfill" }),
    });
  }),
);
