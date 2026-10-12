import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import type { SectionInfo } from "../lib/exportreport";

/** Pop-up shown by "Download All": the user ticks the sections they want and only those go into the PDF. */
export default function ExportDialog({
  sections,
  onClose,
  onConfirm,
}: {
  sections: SectionInfo[];
  onClose: () => void;
  onConfirm: (ids: number[], toc: boolean) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(
    () => new Set(sections.map((s) => s.id)),
  );
  const [toc, setToc] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const ids = sections.filter((s) => sel.has(s.id)).map((s) => s.id);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose sections for the PDF"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-card border border-line bg-white shadow-panel dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-medium">Download report as PDF</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Choose the sections you want. Only these will be added to the PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-between px-5 pt-3 text-xs">
          <span className="text-slate-500">
            {ids.length} of {sections.length} selected
          </span>
          <span className="flex gap-3 font-medium text-indigo-600 dark:text-indigo-400">
            <button
              type="button"
              className="hover:underline"
              onClick={() => setSel(new Set(sections.map((s) => s.id)))}
            >
              Select all
            </button>
            <button
              type="button"
              className="hover:underline"
              onClick={() => setSel(new Set())}
            >
              Clear
            </button>
          </span>
        </div>
        <ul className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={sel.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span className="w-6 shrink-0 text-xs text-slate-400">
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="space-y-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={toc}
              onChange={(e) => setToc(e.target.checked)}
            />{" "}
            Add a table of contents with page numbers
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ids.length}
              onClick={() => onConfirm(ids, toc)}
            >
              <Download className="h-4 w-4" /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
