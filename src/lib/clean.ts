/** Makes any message coming from the server safe and clear for the user: no service names, no setup instructions, no technical words. */
const SETUP =
  /_API_KEY|api key|secret|supabase|migration|db push|edge function|quota|rate limit|credit|ADMIN_EMAILS|\.sql\b|npx /i;

export function publicText(input: string): string;
export function publicText(
  input: string | null | undefined,
): string | undefined;
export function publicText(
  input: string | null | undefined,
): string | undefined {
  if (input == null) return undefined;
  let s = String(input);
  if (SETUP.test(s)) {
    // The visitor sees the friendly text; the real reason is kept in the browser console (F12) so it can be fixed.
    console.warn("[hidden error]", s);
    return "This feature is temporarily unavailable. Please try again in a little while.";
  }
  s = s
    .replace(
      /\b(Gemini|Groq|OpenAI|ChatGPT|Anthropic|Claude|LLM)\b/gi,
      "our analysis engine",
    )
    .replace(
      /\b(Serper|DataForSEO|Open ?PageRank|Tranco|PageSpeed( Insights)?|Lighthouse|CrUX|Semrush|Ahrefs|Moz|DuckDuckGo|Brave|Cloudflare|Wayback)\b/gi,
      "our data sources",
    )
    .replace(/\bAI\b/g, "automated")
    .replace(/\bestimates\b/gi, "approximate figures")
    .replace(/\bestimated\b/gi, "approximate")
    .replace(/\bestimate\b/gi, "approximate figure")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s;
}