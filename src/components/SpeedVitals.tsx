import { publicText } from "../lib/clean";
import { useState } from "react";
import { Badge } from "./ui";
import { Ring } from "./dash";

type Vital = { name: string; text: string; t: string | null };
const rateText = (t: string | null) =>
  t === "green"
    ? "Good"
    : t === "amber"
      ? "Needs work"
      : t === "red"
        ? "Poor"
        : "No data";

/** Speed & Core Web Vitals: Mobile / Desktop toggle, four score rings and the vitals list. Shown inside a Box on the board. */
export default function SpeedVitals({
  speed,
  vitals,
  speedDesktop,
  vitalsDesktop,
  errMobile,
  errDesktop,
}: {
  speed: any;
  vitals: Vital[];
  speedDesktop?: any;
  vitalsDesktop?: Vital[];
  errMobile?: string;
  errDesktop?: string;
}) {
  // start on whichever device has data (mobile first)
  const [device, setDevice] = useState<"mobile" | "desktop">(
    speed || !speedDesktop ? "mobile" : "desktop",
  );
  const sp = device === "mobile" ? speed : speedDesktop;
  const vt = (device === "mobile" ? vitals : vitalsDesktop) ?? [];
  const err = device === "mobile" ? errMobile : errDesktop;

  const tab = (d: "mobile" | "desktop", label: string) => (
    <button
      type="button"
      onClick={() => setDevice(d)}
      className={`rounded-md px-3 py-1 text-xs font-medium transition ${device === d ? "bg-indigo-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {tab("mobile", "Mobile")}
          {tab("desktop", "Desktop")}
        </div>
        <span className="text-[11px] text-slate-400">
          {device === "mobile" ? "Mobile" : "Desktop"} lab test
        </span>
      </div>
      {!sp ? (
        <div className="text-sm text-slate-500">
          <p>
            {device === "mobile" ? "Mobile" : "Desktop"} speed scores are not
            available for this run. Press Re-run.
          </p>
          {err ? (
            <p className="mt-2 rounded-md bg-red-500/10 p-2 text-xs text-red-400">
              Reason: {publicText(err)}
            </p>
          ) : (
            <p className="mt-2 text-xs">
              This is an older saved report. Press Re-run to test again.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Ring value={sp.scores.performance} label="Performance" />
            <Ring value={sp.scores.seo} label="SEO" />
            <Ring value={sp.scores.accessibility} label="Accessibility" />
            <Ring value={sp.scores.bestPractices} label="Best practices" />
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {vt.map((v) => (
              <li
                key={v.name}
                className="flex items-center justify-between gap-2 py-2 text-xs"
              >
                <span className="text-slate-500">{v.name}</span>
                <span className="flex items-center gap-2">
                  <b className="text-sm">{v.text}</b>
                  <Badge tone={(v.t ?? "slate") as any}>{rateText(v.t)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
