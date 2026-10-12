// JavaScript rendering for sites that build their pages in the browser (React, Vue, Angular, Next client pages).
// Supabase Edge Functions cannot run Chrome, so this calls a rendering service:
//   1) BROWSERLESS_TOKEN set  -> Browserless /content first (real Chrome, best quality)
//   2) if Browserless fails or its free units run out, or no token is set -> Jina Reader (r.jina.ai), free;
//      JINA_API_KEY is optional and raises the rate limit
// Set CRAWL_RENDER=off to turn rendering off completely.

const SPA_MARK =
  /<div[^>]+id=["'](?:root|app|__next|__nuxt|___gatsby)["']|__NEXT_DATA__|__NUXT__|ng-version|data-reactroot|window\.__INITIAL_STATE__/i;

export const renderEnabled = () =>
  (Deno.env.get("CRAWL_RENDER") ?? "on").toLowerCase() !== "off";

/** True when the raw HTML is probably an empty shell that JavaScript fills in later. */
export function looksJsRendered(
  html: string,
  words: number,
  internalLinks: number,
): boolean {
  if (words >= 150 && internalLinks >= 3) return false;
  if (SPA_MARK.test(html)) return true;
  return words < 40 && /<script/i.test(html);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Render services allow only a few requests at once (Jina free: about 20 per minute). The crawl opens 6 pages in parallel,
// which made most renders fail with 429. This queue lets only 2 renders run at a time, and spaces them out a little.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((res) => waiting.push(res));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// remember a dead service for a while so the crawl does not wait on it for every page
const blockedUntil: Record<string, number> = {};
const blocked = (name: string) => (blockedUntil[name] ?? 0) > Date.now();

async function viaBrowserless(url: string): Promise<string | null> {
  const token = Deno.env.get("BROWSERLESS_TOKEN");
  if (!token || blocked("browserless")) return null;
  try {
    const r = await fetch(
      `https://production-sfo.browserless.io/content?token=${token}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
        }),
      },
    );
    if (r.status === 401 || r.status === 402 || r.status === 403) {
      blockedUntil.browserless = Date.now() + 10 * 60_000;
      return null;
    } // bad token or free units used up
    if (!r.ok) return null; // busy: let the caller fall back
    const html = (await r.text()).slice(0, 800_000);
    return html.length > 200 ? html : null;
  } catch {
    return null;
  }
}

async function viaJina(url: string): Promise<string | null> {
  if (blocked("jina")) return null;
  const key = Deno.env.get("JINA_API_KEY");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://r.jina.ai/${url}`, {
        signal: AbortSignal.timeout(35000),
        headers: {
          "X-Return-Format": "html",
          "X-Timeout": "25",
          "X-Wait-For-Selector": "h1, main, #root *, #app *", // wait until the app has really drawn something
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
      });
      if (r.status === 429) {
        await sleep(3000 * (attempt + 1));
        continue;
      } // rate limited: wait and retry
      if (r.status === 401 || r.status === 402 || r.status === 403) {
        blockedUntil.jina = Date.now() + 10 * 60_000;
        return null;
      }
      if (!r.ok) {
        await sleep(1500);
        continue;
      }
      const html = (await r.text()).slice(0, 800_000);
      if (html.length > 200) return html;
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

/** Browserless first (when a token is set), then Jina Reader as the free fallback. Max 2 renders at the same time. */
export function renderHtml(url: string): Promise<string | null> {
  return slot(async () => (await viaBrowserless(url)) ?? (await viaJina(url)));
}
