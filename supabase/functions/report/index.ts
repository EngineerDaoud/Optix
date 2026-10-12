import {
  handle,
  HttpError,
  json,
  ownedWebsite,
  requireUser,
} from "../_shared/utils.ts";
import { rangeFor } from "../_shared/kpi.ts";
import { createReport } from "../_shared/report.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(
  handle(async (req) => {
    const user = await requireUser(req);
    const b = await req.json();
    const site = await ownedWebsite(user.id, b.website_id);
    let { from, to } = rangeFor(b.type);
    if (b.type === "custom") {
      if (!DATE.test(b.from) || !DATE.test(b.to) || b.from > b.to)
        throw new HttpError(400, "Pick a valid date range");
      from = b.from;
      to = b.to;
    }
    const report = await createReport({
      site,
      userId: user.id,
      type: b.type,
      from,
      to,
      sections: Array.isArray(b.sections)
        ? b.sections
        : ["seo", "traffic", "sales", "speed", "ai"],
    });
    return json({ report });
  }),
);
