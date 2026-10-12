import Select from "../components/Select";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Mail } from "lucide-react";
import { fn, supabase } from "../lib/supabase";
import { useSite } from "../context/Site";
import { useAuth } from "../context/Auth";
import { daysAgo } from "../lib/format";
import { Empty, ErrorNote, PageHeader, Spinner } from "../components/ui";

const TYPES = [
  ["daily", "Daily"],
  ["weekly", "Weekly (7 days)"],
  ["fifteen", "15 days"],
  ["monthly", "Monthly (30 days)"],
  ["custom", "Custom range"],
];
const SECTIONS = [
  ["seo", "Search performance"],
  ["traffic", "Traffic"],
  ["sales", "Sales"],
  ["speed", "Site health"],
  ["ai", "Summary"],
];

export default function Reports() {
  const { current } = useSite();
  const { session } = useAuth();
  const myEmail = session?.user?.email ?? "";
  const frame = useRef<HTMLIFrameElement>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailNote, setMailNote] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [type, setType] = useState("weekly");
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(1));
  const [sections, setSections] = useState(SECTIONS.map(([k]) => k));
  const [html, setHtml] = useState<string | null>(null);
  const [past, setPast] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [freq, setFreq] = useState("weekly");
  const [hour, setHour] = useState(5);
  const [recipients, setRecipients] = useState("");
  const [active, setActive] = useState(true);
  const [hasSchedule, setHasSchedule] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const [r, s] = await Promise.all([
      supabase
        .from("reports")
        .select("id,type,range_from,range_to,created_at")
        .eq("website_id", current.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("report_schedules")
        .select("*")
        .eq("website_id", current.id)
        .maybeSingle(),
    ]);
    setPast(r.data ?? []);
    setHasSchedule(!!s.data);
    if (!s.data) setRecipients((v) => v || myEmail);
    if (s.data) {
      setFreq(s.data.frequency);
      setHour(s.data.hour_utc);
      setRecipients((s.data.recipients ?? []).join(", "));
      setActive(s.data.active);
    }
  }, [current, myEmail]);
  useEffect(() => {
    setHtml(null);
    setReportId(null);
    setMailNote(null);
    load();
  }, [load]);

  const generate = async () => {
    if (!current) return;
    setBusy("gen");
    setError(null);
    try {
      const r = await fn("report", {
        website_id: current.id,
        type,
        from,
        to,
        sections,
      });
      setHtml(r.report.html);
      setReportId(r.report.id);
      setMailNote(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  const open = async (id: string) => {
    const { data } = await supabase
      .from("reports")
      .select("html")
      .eq("id", id)
      .single();
    if (data) {
      setHtml(data.html);
      setReportId(id);
      setMailNote(null);
    }
  };

  const emailReport = async () => {
    if (!reportId) return;
    setBusy("mail");
    setMailNote(null);
    try {
      const r = await fn("report", {
        action: "email",
        report_id: reportId,
        email_to: mailTo.trim() || myEmail,
      });
      const m = r.email;
      setMailNote(
        m?.sent
          ? { ok: true, text: `Report sent to ${(m.to ?? []).join(", ")}.` }
          : { ok: false, text: m?.error ?? "The email could not be sent." },
      );
    } catch (e) {
      setMailNote({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  };

  const saveSchedule = async () => {
    if (!current) return;
    setBusy("sched");
    setError(null);
    setNote(null);
    const list = recipients
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("report_schedules")
      .upsert(
        {
          website_id: current.id,
          frequency: freq,
          hour_utc: hour,
          recipients: list,
          sections,
          active,
        },
        { onConflict: "website_id" },
      );
    if (error) setError(error.message);
    else {
      setNote("Schedule saved.");
      setHasSchedule(true);
    }
    setBusy(null);
  };

  const toggleSection = (k: string) =>
    setSections((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <>
      <PageHeader
        title="Reports"
        sub="Generate a report now, or schedule it to be created and emailed automatically."
      />
      <ErrorNote message={error} />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-semibold">Create a report</h2>
            <div>
              <label htmlFor="rtype" className="mb-1 block text-sm font-medium">
                Period
              </label>
              <Select
                id="rtype"
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            {type === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="from"
                    className="mb-1 block text-sm font-medium"
                  >
                    From
                  </label>
                  <input
                    id="from"
                    type="date"
                    className="input"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="to"
                    className="mb-1 block text-sm font-medium"
                  >
                    To
                  </label>
                  <input
                    id="to"
                    type="date"
                    className="input"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
            )}
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Include</legend>
              {SECTIONS.map(([k, l]) => (
                <label
                  key={k}
                  className="flex items-center gap-2 py-0.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={sections.includes(k)}
                    onChange={() => toggleSection(k)}
                  />{" "}
                  {l}
                </label>
              ))}
            </fieldset>
            <button className="btn w-full" onClick={generate} disabled={!!busy}>
              {busy === "gen" && <Spinner />} Generate report
            </button>
          </div>

          <div className="card space-y-3">
            <h2 className="font-semibold">Schedule</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="freq"
                  className="mb-1 block text-sm font-medium"
                >
                  How often
                </label>
                <Select
                  id="freq"
                  className="input"
                  value={freq}
                  onChange={(e) => setFreq(e.target.value)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="fifteen">Every 15 days</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </div>
              <div>
                <label
                  htmlFor="hour"
                  className="mb-1 block text-sm font-medium"
                >
                  Hour (UTC)
                </label>
                <Select
                  id="hour"
                  className="input"
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <label htmlFor="rec" className="mb-1 block text-sm font-medium">
                Send to (emails, comma separated)
              </label>
              <input
                id="rec"
                className="input"
                placeholder="you@company.com, client@company.com"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{" "}
              Schedule is on
            </label>
            <button
              className="btn-ghost w-full"
              onClick={saveSchedule}
              disabled={!!busy}
            >
              {busy === "sched" && <Spinner />}{" "}
              {hasSchedule ? "Update schedule" : "Save schedule"}
            </button>
            {note && <p className="text-sm text-green-600">{note}</p>}
          </div>

          <div className="card">
            <h2 className="mb-2 font-semibold">Past reports</h2>
            {!past.length && (
              <p className="text-sm text-slate-500">Nothing here yet.</p>
            )}
            <ul className="space-y-1">
              {past.map((p) => (
                <li key={p.id}>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => open(p.id)}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="flex-1">
                      {p.type} · {p.range_from} to {p.range_to}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0">
          {html ? (
            <div className="card !p-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                <span className="text-sm font-medium">Preview</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Send the report to this email"
                    className="input !h-9 !w-56 max-w-full"
                    type="email"
                    placeholder={myEmail || "you@company.com"}
                    value={mailTo}
                    onChange={(e) => setMailTo(e.target.value)}
                  />
                  <button
                    className="btn-ghost"
                    onClick={emailReport}
                    disabled={!!busy || !reportId}
                  >
                    {busy === "mail" ? (
                      <Spinner />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}{" "}
                    Email report
                  </button>
                  <button
                    className="btn"
                    onClick={() => frame.current?.contentWindow?.print()}
                  >
                    <Download className="h-4 w-4" /> Download PDF
                  </button>
                </div>
                {mailNote && (
                  <p
                    className={`w-full text-sm ${mailNote.ok ? "text-green-600" : "text-red-600"}`}
                  >
                    {mailNote.text}
                  </p>
                )}
              </div>
              <iframe
                ref={frame}
                title="Report preview"
                srcDoc={html}
                className="h-[75vh] w-full bg-white"
              />
            </div>
          ) : (
            <Empty
              title="Your report appears here"
              text="Choose a period and sections, then generate. Use Download PDF and pick “Save as PDF” in the print window."
            />
          )}
        </div>
      </div>
    </>
  );
}