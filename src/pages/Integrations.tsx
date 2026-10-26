import Select from "../components/Select";
import { BRAND } from "../lib/brand";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fn, supabase } from "../lib/supabase";
import { useSite } from "../context/Site";
import { Badge, ErrorNote, PageHeader, Spinner } from "../components/ui";

type Track = {
  managed: boolean;
  other?: boolean;
  status?: "creating" | "ready";
  propertyId?: string | null;
  measurementId?: string | null;
  snippet?: string | null;
};
type Check = {
  installed: boolean;
  reason: string;
  activeUsers: number | null;
  receiving: boolean;
};

type Res = {
  sites: string[];
  properties: { id: string; name: string }[];
  errors: { gsc?: string; ga4?: string };
};

export default function Integrations() {
  const { current, reload } = useSite();
  const [params, setParams] = useSearchParams();
  const [ints, setInts] = useState<any[]>([]);
  const [res, setRes] = useState<Res | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const gsc = ints.find((i) => i.provider === "gsc");
  const ga4 = ints.find((i) => i.provider === "ga4");
  // "connected" = the user signed in with Google. The automatic (managed) Analytics property does not count as that.
  const connected = !!gsc || (!!ga4 && !ga4.config?.managed);
  const [track, setTrack] = useState<Track | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("website_id", current.id);
    setInts(data ?? []);
    setSiteUrl(data?.find((i) => i.provider === "gsc")?.config?.siteUrl ?? "");
    setPropertyId(
      data?.find((i) => i.provider === "ga4")?.config?.propertyId ?? "",
    );
  }, [current]);
  useEffect(() => {
    load();
  }, [load]);

  const loadTrack = useCallback(async () => {
    if (!current) return;
    setCheck(null);
    try {
      setTrack(
        await fn<Track>("gaprovision", {
          action: "status",
          website_id: current.id,
        }),
      );
    } catch {
      setTrack(null);
    }
  }, [current]);
  useEffect(() => {
    loadTrack();
  }, [loadTrack]);
  // the property is created in the background right after a site is added: refresh until it is ready
  useEffect(() => {
    if (track?.status !== "creating") return;
    const t = setTimeout(() => {
      loadTrack();
      load();
    }, 4000);
    return () => clearTimeout(t);
  }, [track, loadTrack, load]);

  useEffect(() => {
    if (!current || !connected) {
      setRes(null);
      return;
    }
    fn<Res>("google", { action: "resources", website_id: current.id })
      .then(setRes)
      .catch((e) => setError(e.message));
  }, [current, connected]);

  useEffect(() => {
    if (params.get("google_error"))
      setError(`Google connection failed: ${params.get("google_error")}`);
    if (params.get("google") === "connected")
      setNote(
        "Google connected. Now pick your Search Console site and Analytics property.",
      );
    if (params.toString()) setParams({}, { replace: true });
  }, []); // eslint-disable-line

  const act = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  const connect = () =>
    act("connect", async () => {
      const r = await fn<{ url: string }>("google", {
        action: "start",
        website_id: current!.id,
        return_to: window.location.origin,
      });
      window.location.href = r.url;
    });

  const save = () =>
    act("save", async () => {
      await fn("google", {
        action: "save",
        website_id: current!.id,
        siteUrl: siteUrl || undefined,
        propertyId: propertyId || undefined,
      });
      const r = await fn<{ result: Record<string, string> }>("sync", {
        website_id: current!.id,
      });
      const failed = Object.entries(r.result).filter(([, v]) => v !== "ok");
      setNote(
        failed.length ? null : "Saved and synced. Your dashboard now has data.",
      );
      if (failed.length)
        setError(
          failed.map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · "),
        );
      await load();
      await reload();
    });

  const syncNow = () =>
    act("sync", async () => {
      const r = await fn<{ result: Record<string, string> }>("sync", {
        website_id: current!.id,
      });
      const failed = Object.entries(r.result).filter(([, v]) => v !== "ok");
      if (failed.length)
        setError(
          failed.map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · "),
        );
      else setNote("Sync finished.");
      await reload();
    });

  const createTrack = () =>
    act("track", async () => {
      setTrack(
        await fn<Track>("gaprovision", {
          action: "create",
          website_id: current!.id,
        }),
      );
      await load();
    });

  const verifyTrack = () =>
    act("verify", async () => {
      setCheck(
        await fn<Check>("gaprovision", {
          action: "verify",
          website_id: current!.id,
        }),
      );
    });

  const copySnippet = async () => {
    if (!track?.snippet) return;
    await navigator.clipboard.writeText(track.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const disconnect = () =>
    act("disconnect", async () => {
      await fn("google", { action: "disconnect", website_id: current!.id });
      setNote(null);
      await load();
    });

  const soon = [
    [
      "Shopify",
      "Exact orders, refunds and customers. GA4 already covers sales for now.",
    ],
    ["Microsoft Clarity", "Heatmaps and session behavior."],
    ["ClickUp", "Send audit tasks straight to your ClickUp list."],
  ];

  return (
    <>
      <PageHeader
        title="Integrations"
        sub={current ? `Data sources for ${current.name || current.url}` : ""}
      />
      <ErrorNote message={error} />
      {note && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {note}
        </div>
      )}

      <div className="space-y-4">
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Automatic Analytics (no Google sign-in)
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {BRAND.name} creates the Analytics tracking for this website.
                Paste one code snippet into the site and the visits appear on
                your dashboard.
              </p>
            </div>
            <Badge
              tone={
                track?.managed && track.status === "ready" ? "green" : "slate"
              }
            >
              {track?.managed
                ? track.status === "creating"
                  ? "Creating..."
                  : "Ready"
                : "Not created"}
            </Badge>
          </div>

          {track?.other && (
            <p className="mt-4 text-sm text-slate-500">
              This website already uses your own Google Analytics (connected
              below), so automatic tracking is not needed.
            </p>
          )}

          {track && !track.managed && !track.other && (
            <button
              className="btn mt-4"
              onClick={createTrack}
              disabled={!!busy}
            >
              {busy === "track" && <Spinner />} Create tracking code
            </button>
          )}

          {track?.managed && track.status === "creating" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Creating the Analytics property...
            </div>
          )}

          {track?.managed && track.status === "ready" && track.snippet && (
            <div className="mt-4 space-y-3">
              <p className="text-sm">
                Paste this just before <code>&lt;/head&gt;</code> on every page
                (WordPress: a header-scripts plugin; Shopify: Online Store &gt;
                Themes &gt; Edit code &gt; <code>theme.liquid</code>; Wix and
                Squarespace: Custom code in Settings).
              </p>
              <pre className="max-h-56 overflow-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">
                {track.snippet}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={copySnippet}>
                  {copied ? "Copied" : "Copy code"}
                </button>
                <button
                  className="btn-ghost"
                  onClick={verifyTrack}
                  disabled={!!busy}
                >
                  {busy === "verify" && <Spinner />} Check installation
                </button>
                <button
                  className="btn-ghost"
                  onClick={syncNow}
                  disabled={!!busy}
                >
                  {busy === "sync" && <Spinner />} Sync now
                </button>
              </div>
              {check && (
                <div
                  className={`rounded-lg px-4 py-3 text-sm ${check.installed || check.receiving ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}
                >
                  {check.installed
                    ? "The code is on your home page."
                    : check.reason}
                  {check.activeUsers !== null &&
                    ` Visitors on the site right now: ${check.activeUsers}.`}
                </div>
              )}
              <p className="text-xs text-slate-500">
                Data counts from the moment the code is installed (nothing from
                before). Realtime shows within a minute; the dashboard fills in
                after the next sync, and Google can take up to 24 to 48 hours to
                finish a day's numbers.
              </p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Google Search Console and Analytics 4 (your own Google account)
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Rankings, clicks, search queries, traffic, orders and revenue.
                One Google sign-in covers both.
              </p>
            </div>
            <Badge tone={connected ? "green" : "slate"}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </div>

          {!connected ? (
            <button
              className="btn mt-4"
              onClick={connect}
              disabled={busy === "connect"}
            >
              {busy === "connect" && <Spinner />} Connect Google
            </button>
          ) : (
            <div className="mt-4 space-y-4">
              {!res ? (
                <Spinner />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="gsc"
                      className="mb-1 block text-sm font-medium"
                    >
                      Search Console site
                    </label>
                    <Select
                      id="gsc"
                      className="input"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                    >
                      <option value="">Skip</option>
                      {res.sites.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                    {res.errors.gsc && (
                      <p className="mt-1 text-xs text-red-600">
                        {res.errors.gsc}
                      </p>
                    )}
                    {!res.errors.gsc && res.sites.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        No Search Console sites found for this Google account.
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="ga4"
                      className="mb-1 block text-sm font-medium"
                    >
                      Analytics 4 property
                    </label>
                    <Select
                      id="ga4"
                      className="input"
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                    >
                      <option value="">Skip</option>
                      {res.properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    {res.errors.ga4 && (
                      <p className="mt-1 text-xs text-red-600">
                        {res.errors.ga4}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn"
                  onClick={save}
                  disabled={!!busy || (!siteUrl && !propertyId)}
                >
                  {busy === "save" && <Spinner />} Save and sync
                </button>
                {(gsc?.config?.siteUrl || ga4?.config?.propertyId) && (
                  <button
                    className="btn-ghost"
                    onClick={syncNow}
                    disabled={!!busy}
                  >
                    {busy === "sync" && <Spinner />} Sync now
                  </button>
                )}
                <button
                  className="btn-ghost"
                  onClick={disconnect}
                  disabled={!!busy}
                >
                  Disconnect
                </button>
                {current?.last_synced_at && (
                  <span className="text-xs text-slate-500">
                    Last synced{" "}
                    {new Date(current.last_synced_at).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Data syncs automatically every night once the scheduler is set
                up.
              </p>
            </div>
          )}
        </div>

        <div className="card flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Speed test and site crawler</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Built in. Runs from the Audit page, no sign-in needed.
            </p>
          </div>
          <Badge tone="green">Active</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {soon.map(([name, text]) => (
            <div
              key={name}
              className="card flex items-start justify-between gap-3 opacity-70"
            >
              <div>
                <h2 className="font-semibold">{name}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {text}
                </p>
              </div>
              <Badge>Coming soon</Badge>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}