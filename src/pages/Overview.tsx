import AnalyzingOverlay from "../components/AnalyzingOverlay";
import { FormEvent, ReactNode, useState } from "react";
import { fn } from "../lib/supabase";
import {
  Badge,
  ErrorNote,
  PageHeader,
  ScoreRing,
  Spinner,
} from "../components/ui";

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="card">
    <h2 className="mb-3 text-base font-semibold">{title}</h2>
    {children}
  </section>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-right font-medium">{children}</span>
  </div>
);

const yes = (ok: boolean, good = "Yes", bad = "No") => (
  <Badge tone={ok ? "green" : "amber"}>{ok ? good : bad}</Badge>
);
const sec = (ms: number | null | undefined) =>
  ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`;

export default function Overview() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      setData(await fn("overview", { url }));
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const p = data?.page;
  const sp = device === "mobile" ? data?.speed : data?.speedDesktop;
  const fieldNow =
    device === "mobile" ? data?.field : data?.speedDesktop?.field;
  const titleOk = p && p.titleLength >= 20 && p.titleLength <= 65;
  const descOk = p && p.descriptionLength >= 70 && p.descriptionLength <= 165;

  return (
    <>
      <PageHeader
        title="Competitor check"
        sub="Paste any public website. Free data only: speed, on-page SEO, tech, authority and keyword ideas."
      />

      <form onSubmit={run} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="btn sm:w-48" disabled={loading}>
          {loading && <Spinner />} Analyze
        </button>
      </form>
      <ErrorNote message={error} />
      {loading && (
        <AnalyzingOverlay progress="Checking the site. This can take up to a minute." />
      )}

      {data && (
        <div className="grid gap-4">
          <Card title={`${data.host}${data.shared ? " (shared hosting)" : ""}`}>
            <Row label="Status">
              {data.status === 200 ? (
                <Badge tone="green">200 OK</Badge>
              ) : (
                <Badge tone="amber">{data.status}</Badge>
              )}
            </Row>
            <Row label="Domain age">
              {data.age
                ? `Since ${data.age.since} (${data.age.source})`
                : data.shared
                  ? "Not available for shared hosting"
                  : "Not found"}
            </Row>
            <Row label="Tranco rank (top 1M sites)">
              {data.authority?.trancoRank
                ? `#${data.authority.trancoRank.toLocaleString()}`
                : "Not in the top 1M"}
            </Row>
            {data.authority?.openPageRank && (
              <Row label="Open PageRank">
                {data.authority.openPageRank.score} / 10
              </Row>
            )}
            {data.tech.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.tech.map((t: string) => (
                  <Badge key={t} tone="brand">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {(data.speed || data.speedDesktop) && (
            <Card title="Speed">
              <div className="mb-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(["mobile", "desktop"] as const).map((dv) => (
                  <button
                    key={dv}
                    type="button"
                    onClick={() => setDevice(dv)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${device === dv ? "bg-indigo-500 text-white" : "text-slate-500"}`}
                  >
                    {dv === "mobile" ? "Mobile" : "Desktop"}
                  </button>
                ))}
              </div>
              {sp ? (
                <>
                  <div className="flex flex-wrap justify-around gap-4">
                    <ScoreRing
                      value={sp.scores.performance}
                      label="Performance"
                    />
                    <ScoreRing value={sp.scores.seo} label="SEO" />
                    <ScoreRing
                      value={sp.scores.accessibility}
                      label="Accessibility"
                    />
                    <ScoreRing
                      value={sp.scores.bestPractices}
                      label="Best practices"
                    />
                  </div>
                  <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                    Lab test: LCP {sec(sp.vitals.lcp)} · CLS{" "}
                    {sp.vitals.cls?.toFixed(2) ?? "–"} · TBT{" "}
                    {sp.vitals.tbt != null
                      ? Math.round(sp.vitals.tbt) + " ms"
                      : "–"}
                    {fieldNow && (
                      <>
                        <br />
                        Real users (Chrome, 75th percentile): LCP{" "}
                        {sec(fieldNow.lcp)} · CLS {fieldNow.cls ?? "–"} · INP{" "}
                        {fieldNow.inp != null ? fieldNow.inp + " ms" : "–"}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  {device === "mobile" ? "Mobile" : "Desktop"} speed scores are
                  not available for this run. See the note at the bottom of the
                  page for the reason.
                </p>
              )}
            </Card>
          )}

          <Card title="On-page SEO (homepage)">
            <Row label="Title">
              {p.title || "Missing"}{" "}
              {p.title &&
                yes(
                  titleOk,
                  `${p.titleLength} chars`,
                  `${p.titleLength} chars`,
                )}
            </Row>
            <Row label="Meta description">
              {p.description ? (
                <span className="max-w-md">{p.description}</span>
              ) : (
                "Missing"
              )}{" "}
              {p.description &&
                yes(
                  descOk,
                  `${p.descriptionLength} chars`,
                  `${p.descriptionLength} chars`,
                )}
            </Row>
            <Row label="H1 headings">
              {p.h1s.length ? p.h1s.join(" | ") : "Missing"}{" "}
              {yes(p.h1s.length === 1, "1 H1", `${p.h1s.length} H1`)}
            </Row>
            <Row label="H2 headings">{p.h2Count}</Row>
            <Row label="Words on page">{p.wordCount.toLocaleString()}</Row>
            <Row label="Canonical tag">{yes(p.canonical)}</Row>
            <Row label="Indexable">
              {yes(!p.noindex, "Yes", "Blocked (noindex)")}
            </Row>
            <Row label="Mobile viewport">{yes(p.viewport)}</Row>
            <Row label="Open Graph / Twitter card">
              {yes(p.openGraph)} {yes(p.twitterCard)}
            </Row>
            <Row label="Structured data">
              {p.schema.length ? p.schema.join(", ") : "None found"}
            </Row>
            <Row label="Images without alt text">
              {p.imagesNoAlt} of {p.images}
            </Row>
            <Row label="Links (internal / external)">
              {p.internalLinks} / {p.externalLinks}
            </Row>
          </Card>

          {data.crawl && (
            <Card title="Crawl files">
              <Row label="robots.txt">
                {yes(data.crawl.robotsOk, "Found", "Not found")}
              </Row>
              <Row label="Sitemap">
                {yes(data.crawl.sitemapOk, "Found", "Not found")}
              </Row>
              {data.crawl.sitemapOk && (
                <Row label="Pages in sitemap">
                  {data.crawl.urls.toLocaleString()}
                  {data.crawl.partial ? "+ (first 3 sitemaps counted)" : ""}
                </Row>
              )}
            </Card>
          )}

          <Card title="Keywords they use">
            <div className="flex flex-wrap gap-2">
              {p.keywords.map((k: any) => (
                <Badge key={k.word}>
                  {k.word} · {k.count}
                </Badge>
              ))}
              {!p.keywords.length && (
                <span className="text-sm text-slate-500">
                  No readable text found.
                </span>
              )}
            </div>
            {data.ideas.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {data.ideas.map((i: any) => (
                  <div key={i.seed}>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Google suggests for "{i.seed}"
                    </div>
                    <ul className="space-y-1 text-sm">
                      {i.suggestions.map((s: string) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {data.notes.length > 0 && (
            <p className="text-xs text-slate-500">
              Skipped: {data.notes.join(" · ")}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Clicks, search queries, traffic and sales are private to the site
            owner (Search Console and Analytics), so they cannot be shown for
            other websites. Connect your own sites in Integrations for that.
          </p>
        </div>
      )}
    </>
  );
}