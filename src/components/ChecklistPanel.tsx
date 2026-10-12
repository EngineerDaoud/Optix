import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

// SEO checklist (Technical / Content / Authority). Every row is a real check made by the research function
// (supabase/functions/_shared/checklist.ts). "Check manually" means the data needs a login or a paid tool.

type Status = "pass" | "warn" | "fail" | "manual";
export type CheckRow = {
  id: string;
  group: string;
  cadence: string;
  name: string;
  priority: "High" | "Med";
  benefit: string;
  status: Status;
  detail: string;
  fix: string;
};

const ST: Record<Status, { label: string; cls: string; dot: string }> = {
  pass: {
    label: "Passed",
    cls: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    dot: "#22c55e",
  },
  warn: {
    label: "Needs work",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    dot: "#f59e0b",
  },
  fail: {
    label: "Failed",
    cls: "bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
    dot: "#ec4899",
  },
  manual: {
    label: "Check manually",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    dot: "#94a3b8",
  },
};

const seqKey = (id: string) =>
  id
    .split(".")
    .map((n) => n.padStart(3, "0"))
    .join(".");

export default function ChecklistPanel({ items }: { items: CheckRow[] }) {
  // accordion: one row open at a time
  const [open, setOpen] = useState<string | null>(null);
  const [only, setOnly] = useState<Status | "all">("all");

  const groups = useMemo(() => {
    const m = new Map<string, { cadence: string; rows: CheckRow[] }>();
    for (const r of [...items].sort((a, b) =>
      seqKey(a.id).localeCompare(seqKey(b.id)),
    ))
      (
        m.get(r.group) ??
        m.set(r.group, { cadence: r.cadence, rows: [] }).get(r.group)!
      ).rows.push(r);
    return [...m.entries()];
  }, [items]);

  if (!items?.length) return null;
  const count = (s: Status) => items.filter((x) => x.status === s).length;
  const chip = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={chip(only === "all")}
          onClick={() => setOnly("all")}
        >
          All {items.length}
        </button>
        {(["fail", "warn", "manual", "pass"] as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            className={chip(only === s)}
            onClick={() => setOnly(only === s ? "all" : s)}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: ST[s].dot }}
            />
            {ST[s].label} {count(s)}
          </button>
        ))}
      </div>

      {groups.map(([group, g]) => {
        const rows = g.rows.filter((r) => only === "all" || r.status === only);
        if (!rows.length) return null;
        return (
          <section key={group}>
            <div className="mb-2 flex items-baseline gap-3">
              <h4 className="text-[13px] font-semibold">{group}</h4>
              <span className="text-xs text-slate-400">{g.cadence}</span>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line dark:divide-slate-800 dark:border-slate-800">
              {rows.map((r) => {
                const isOpen = open === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                      className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:grid-cols-[34px_minmax(0,1.1fr)_52px_minmax(0,1.6fr)_auto_auto]"
                    >
                      <span className="num text-xs text-slate-400">{r.id}</span>
                      <span className="truncate text-sm font-medium">
                        {r.name}
                      </span>
                      <span className="hidden text-xs text-slate-500 sm:block">
                        {r.priority}
                      </span>
                      <span className="hidden truncate text-xs text-slate-500 sm:block">
                        {r.benefit}
                      </span>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ST[r.status].cls}`}
                      >
                        {ST[r.status].label}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="space-y-2 bg-slate-50/60 px-3 pb-3 pl-[58px] pt-1 text-xs dark:bg-slate-800/30">
                        <p className="text-slate-500">{r.benefit}</p>
                        <p>
                          <b className="font-medium">What we found: </b>
                          <span className="text-slate-600 dark:text-slate-300">
                            {r.detail}
                          </span>
                        </p>
                        {r.fix && (
                          <p>
                            <b className="font-medium">What to do: </b>
                            <span className="text-slate-600 dark:text-slate-300">
                              {r.fix}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}