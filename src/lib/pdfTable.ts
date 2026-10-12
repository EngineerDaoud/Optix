import { jsPDF } from "jspdf";
import { BRAND } from "./brand";

export type Cell = string | number | null | undefined;

/** Turns rows (first row = column headings) into a clean A4 PDF table and downloads it.
 *  Used everywhere a "Download CSV" button used to be. Rows wrap inside their cells, the heading row repeats on every page,
 *  wide tables switch to landscape, and every page has the product name and page number in the footer. */
export function downloadPdf(
  fileName: string,
  rows: Cell[][],
  opts: { title?: string; subtitle?: string } = {},
) {
  if (!rows.length) return;
  const [head, ...body] = rows;
  const cols = head.length;
  const landscape = cols > 5;
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const usable = W - M * 2;
  const fs = cols > 8 ? 7 : 8.5;
  const lh = fs * 1.35;
  const padX = 5;
  const padY = 4;

  const text = (v: Cell) => (v == null ? "" : String(v));

  // column widths follow the longest content (capped), then are scaled to fit the page
  const weights = head.map((_, c) => {
    const longest = Math.max(
      text(head[c]).length,
      ...body.slice(0, 200).map((r) => Math.min(text(r[c]).length, 42)),
    );
    return Math.max(6, Math.min(longest, 42));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * usable);

  const title =
    opts.title ??
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());

  let y = M;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 17, 43);
  doc.text(title, M, y + 12);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(120, 116, 150);
  doc.text(
    `${opts.subtitle ? opts.subtitle + "  ·  " : ""}${body.length} row${body.length === 1 ? "" : "s"}  ·  ${new Date().toLocaleDateString()}`,
    M,
    y + 6,
  );
  y += 22;

  const drawHead = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fs);
    const lines = head.map((h, c) =>
      doc.splitTextToSize(text(h), widths[c] - padX * 2),
    );
    const h = Math.max(...lines.map((l) => l.length)) * lh + padY * 2;
    doc.setFillColor(108, 71, 255);
    doc.rect(M, y, usable, h, "F");
    doc.setTextColor(255, 255, 255);
    let x = M;
    lines.forEach((l, c) => {
      doc.text(l, x + padX, y + padY + fs);
      x += widths[c];
    });
    y += h;
  };

  drawHead();
  body.forEach((r, i) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fs);
    const lines = head.map((_, c) =>
      doc.splitTextToSize(text(r[c]), widths[c] - padX * 2).slice(0, 4),
    );
    const h = Math.max(...lines.map((l) => l.length), 1) * lh + padY * 2;
    if (y + h > H - M - 14) {
      doc.addPage();
      y = M;
      drawHead();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fs);
    }
    if (i % 2 === 1) {
      doc.setFillColor(246, 244, 255);
      doc.rect(M, y, usable, h, "F");
    }
    doc.setTextColor(40, 40, 60);
    let x = M;
    lines.forEach((l, c) => {
      doc.text(l, x + padX, y + padY + fs);
      x += widths[c];
    });
    y += h;
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 146, 175);
    doc.text(BRAND.name, M, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: "right" });
  }

  doc.save(/\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`);
}