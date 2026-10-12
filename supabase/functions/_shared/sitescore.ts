// One final score (0-100) for a website, built from everything SEOPilot can see for free:
// the public store pages, the tracking codes on the home page and, when the owner connected Google,
// real Search Console + Analytics numbers. Rules only: no outside service, the same input always gives the same score.
// A part is skipped when its data is missing, and the score is scaled over the parts that exist.

type Tip = { priority: "high" | "medium" | "low"; title: string; detail: string };
type Part = { key: string; label: string; weight: number; score: number; note: string };

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
/** 0 at `lo`, 1 at `hi` (works for "lower is better" when lo > hi) */
const lin = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo));
const p = (v: number | null | undefined) => (v == null ? 0 : v / 100);

export function scoreSite(i: {
  shopify: any;
  tracking: any;
  ga: any;
  gsc: any;
  connected: boolean;
}) {
  const parts: Part[] = [];
  const tips: Tip[] = [];
  const s = i.shopify?.detected && !i.shopify?.blocked ? i.shopify : null;
  const add = (key: string, label: string, weight: number, ratio: number, note: string) =>
    parts.push({ key, label, weight, score: Math.round(clamp(ratio) * 100), note });
  const tip = (priority: Tip["priority"], title: string, detail: string) =>
    tips.push({ priority, title, detail });

  /* ------------------------------------------------ product page SEO (25) */
  const a = s?.pageAudit;
  if (a) {
    const r =
      0.32 * p(a.metaDesc) +
      0.28 * p(a.schema) +
      0.16 * p(a.titleOk) +
      0.16 * p(a.altOk) +
      0.08 * p(a.oneH1);
    add("product_seo", "Product page SEO", 25, r, `${a.checked} product pages checked`);
    if ((a.metaDesc ?? 100) < 90)
      tip(
        "high",
        "Add a meta description to every product page",
        `${100 - (a.metaDesc ?? 0)}% of the product pages we checked have no usable meta description. Google then picks random text for the search result, which lowers clicks. Write 120-155 characters per product, starting with the main keyword.`,
      );
    if ((a.schema ?? 100) < 80)
      tip(
        "high",
        "Add product structured data (schema)",
        `Only ${a.schema}% of the checked product pages carry Product schema. Without it Google cannot show price, stock and star ratings under your result. Most Shopify themes have a setting for it, or use a free schema app.`,
      );
    if ((a.titleOk ?? 100) < 70)
      tip(
        "medium",
        "Fix product page titles",
        `${100 - (a.titleOk ?? 0)}% of the checked titles are too short or too long. Keep them between 20 and 65 characters so Google shows them fully.`,
      );
    if (a.altOk != null && a.altOk < 90)
      tip(
        "medium",
        "Add alt text to product images",
        `${100 - a.altOk}% of the product images have no alt text. It helps image search and accessibility. Describe what is in the photo, for example "black 250W electric bike battery".`,
      );
    if ((a.oneH1 ?? 100) < 80)
      tip(
        "low",
        "Use exactly one main heading per product page",
        `${100 - (a.oneH1 ?? 0)}% of the checked pages have no H1 or more than one. The product name should be the single H1.`,
      );
    if (a.rated != null && a.rated < 40)
      tip(
        "medium",
        "Show customer reviews on product pages",
        `Only ${a.rated}% of the checked pages carry a star rating. Reviews build trust and make the result stand out in Google with stars.`,
      );
  }

  /* ------------------------------------------------ store trust (15) */
  const t = s?.trust;
  if (t) {
    const reviewsOn = (s.stack ?? []).some((x: string) => /review|trustpilot/i.test(x)) || (a?.rated ?? 0) > 0;
    const r =
      (t.contact ? 3 : 0) +
      (t.about ? 2 : 0) +
      (t.shipping ? 2 : 0) +
      (t.returns ? 3 : 0) +
      (t.privacy || t.terms ? 2 : 0) +
      (reviewsOn ? 3 : 0);
    add("trust", "Store trust", 15, r / 15, "contact, policies and reviews");
    if (!t.returns)
      tip("high", "Publish a returns / refund policy", "Shoppers look for it before buying and Google checks it for Shopping listings. Add it under Settings > Policies and link it in the footer.");
    if (!t.shipping)
      tip("high", "Publish a shipping policy", "Delivery time and cost are the first thing buyers look for. Add it under Settings > Policies and link it in the footer.");
    if (!t.contact)
      tip("high", "Add a contact page", "A contact page with an email or phone number is one of the strongest trust signals for a store.");
    if (!t.about)
      tip("low", "Add an About page", "Tell shoppers who you are. It supports trust and gives Google more context about the business.");
    if (!t.privacy && !t.terms)
      tip("medium", "Link privacy and terms pages in the footer", "They are required in many countries and visitors expect them.");
    if (!reviewsOn)
      tip("medium", "Install a reviews app", "No review tool was found on the store. Judge.me has a free plan and adds ratings to product pages.");
  }

  /* ------------------------------------------------ catalog health (15) */
  if (s) {
    const fresh = (s.updated30d ?? 0) > 0 || (s.content?.lastPost && Date.now() - +new Date(s.content.lastPost) < 60 * 86400_000);
    const r =
      (s.products > 0 ? 3 : 0) +
      (s.inStock == null ? 2 : lin(s.inStock, 40, 90) * 4) +
      ((s.collections ?? 0) >= 5 ? 3 : (s.collections ?? 0) >= 2 ? 1.5 : 0) +
      (fresh ? 3 : 0) +
      (s.priceMedian ? 2 : 0);
    add("catalog", "Catalog health", 15, r / 15, `${s.products} products, ${s.collections ?? 0} collections`);
    if (s.inStock != null && s.inStock < 70)
      tip("medium", "Too many products are sold out", `Only ${s.inStock}% of the checked products are in stock. Hide or redirect sold-out products you will not restock so visitors do not land on dead ends.`);
    if ((s.collections ?? 0) < 5)
      tip("low", "Group products into more collections", "Collection pages rank for broad searches such as \"electric bike batteries\". Add one for each product type or brand you sell.");
    if (!fresh)
      tip("low", "Update the store more often", "No product or blog update was found in the last 30-60 days. Fresh content tells Google the store is active.");
  }

  /* ------------------------------------------------ measurement (15) */
  const tr = i.tracking;
  if (tr) {
    const ga = (tr.ga4?.length ?? 0) + (tr.gtm?.length ?? 0) > 0 || !!i.ga;
    const pixel = !!tr.metaPixel || !!tr.tiktokPixel;
    const email = !!tr.klaviyo || (s?.stack ?? []).some((x: string) => /email/i.test(x));
    const r = (ga ? 6 : 0) + (pixel ? 3 : 0) + (tr.searchConsoleTag || i.gsc ? 3 : 0) + (email ? 3 : 0);
    add("tracking", "Measurement", 15, r / 15, "analytics, pixels, Search Console");
    if (!ga)
      tip("high", "Install Google Analytics 4", "No Google Analytics code was found on the home page, so visits, sources and sales cannot be measured. Create a free GA4 property and add it from Shopify > Online Store > Preferences.");
    if (!tr.searchConsoleTag && !i.gsc)
      tip("medium", "Verify the site in Google Search Console", "It is free and shows which searches bring visitors and which pages Google could not index.");
    if (!pixel)
      tip("low", "Add an ad pixel if you run ads", "No Meta or TikTok pixel was found. Without one, ads cannot track purchases or build retargeting audiences.");
    if (!email)
      tip("low", "Start collecting emails", "No email tool was found. A simple signup form with a welcome email is usually the cheapest source of repeat sales.");
  }

  /* ------------------------------------------------ content (10) */
  if (s?.content) {
    const c = s.content;
    const old = c.lastPost ? Date.now() - +new Date(c.lastPost) > 180 * 86400_000 : true;
    const r = (c.articles >= 1 ? 4 : 0) + (c.articles >= 10 ? 3 : c.articles >= 4 ? 1.5 : 0) + (c.articles && !old ? 3 : 0);
    add("content", "Content", 10, r / 10, `${c.articles} blog posts`);
    if (!c.articles)
      tip("medium", "Start a blog", "No blog posts were found. Guides such as \"how to choose a battery\" bring search visitors that product pages alone never reach.");
    else if (old)
      tip("medium", "Publish new blog posts", `The last post is from ${String(c.lastPost).slice(0, 10)}. Aim for at least one useful post a month.`);
  }

  /* ------------------------------------------------ search performance (20, only with Google connected) */
  if (i.gsc?.totals || i.ga?.totals) {
    let pts = 0,
      max = 0;
    const g = i.gsc?.totals,
      gp = i.gsc?.prev;
    if (g) {
      pts += lin(g.ctr, 0.005, 0.04) * 6;
      max += 6;
      pts += lin(g.position, 40, 8) * 6;
      max += 6;
      if (gp?.clicks) {
        const ch = (g.clicks - gp.clicks) / gp.clicks;
        pts += lin(ch, -0.3, 0.2) * 4;
        max += 4;
        if (ch < -0.1)
          tip("high", "Search clicks are falling", `Clicks from Google dropped ${Math.round(-ch * 100)}% compared with the 28 days before. Check the Pages table for the biggest losers and refresh their titles and content.`);
      }
      if (g.impressions > 500 && g.ctr < 0.015)
        tip("high", "Rewrite titles on pages that get views but no clicks", `Your pages were shown ${Math.round(g.impressions)} times but only ${(g.ctr * 100).toFixed(1)}% clicked. Make titles and descriptions more specific and add the price or a benefit.`);
      if (g.position > 20)
        tip("medium", "Most keywords rank on page 3 or lower", `The average position is ${g.position.toFixed(1)}. Pick the queries closest to page 1 in the Queries table and improve those pages first.`);
    }
    const x = i.ga?.totals;
    if (x && x.sessions > 0) {
      pts += lin(x.engagementRate, 0.35, 0.65) * 4;
      max += 4;
      if (x.engagementRate < 0.4)
        tip("medium", "Visitors leave quickly", `Only ${Math.round(x.engagementRate * 100)}% of visits are engaged. Check page speed on mobile and make sure the first screen answers what the visitor searched for.`);
    }
    if (max) add("search", "Search performance", 20, pts / max, "from your Google data");
  } else if (!i.connected) {
    tip("low", "Connect Google to unlock traffic and keyword scoring", "With Google connected this score also uses your real visits, search clicks and average ranking, and the tips become much more specific.");
  }

  /* ------------------------------------------------ home page basics */
  const hs = s?.homeSeo;
  if (hs) {
    if (!hs.descLen)
      tip("high", "Add a meta description to the home page", "The home page has none. Add 120-155 characters describing what you sell and who it is for (Online Store > Preferences).");
    if (hs.titleLen && (hs.titleLen < 20 || hs.titleLen > 65))
      tip("medium", "Fix the home page title length", `The title is ${hs.titleLen} characters. Keep it between 20 and 65 so it is not cut off in Google.`);
  }

  const wsum = parts.reduce((x, y) => x + y.weight, 0);
  if (parts.length < 2 || !wsum) return null;
  const score = Math.round(parts.reduce((x, y) => x + (y.score / 100) * y.weight, 0) / wsum * 100);
  const order = { high: 0, medium: 1, low: 2 } as const;
  return {
    score,
    label: score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs work" : "Weak",
    parts,
    tips: tips.sort((x, y) => order[x.priority] - order[y.priority]).slice(0, 8),
    covers: Math.round((wsum / 100) * 100),
  };
}