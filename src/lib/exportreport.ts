import { toPng } from "html-to-image";
import { BRAND } from "./brand";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

type Block = {
  id: number;
  title: string;
  el: HTMLElement;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type SectionInfo = { id: number; title: string };
export type ExportOptions = {
  /** ids from listSections(); when left out, every section is exported */
  include?: number[];
  /** add a "Contents" page with page numbers */
  toc?: boolean;
  onProgress?: (done: number, total: number) => void;
};

/** Every card (<section>) on the page, in reading order, with its title and position. Anything marked data-no-export is skipped. */
function collect(root: HTMLElement): Block[] {
  const rr = root.getBoundingClientRect();
  const found: Omit<Block, "id" | "title">[] = [];
  const visit = (el: HTMLElement) => {
    if (el.hasAttribute("data-no-export")) return;
    const r = el.getBoundingClientRect();
    if (r.height < 8 || r.width < 8) return;
    const isCard =
      el.tagName === "SECTION" || el.hasAttribute("data-export-block");
    if (isCard) {
      found.push({
        el,
        x: r.left - rr.left,
        y: r.top - rr.top,
        w: r.width,
        h: r.height,
      });
      return;
    }
    [...el.children].forEach((k) => k instanceof HTMLElement && visit(k));
  };
  [...root.children].forEach((k) => k instanceof HTMLElement && visit(k));
  found.sort((a, b) => a.y - b.y || a.x - b.x);
  return found.map((f, i) => {
    const t =
      f.el.getAttribute("data-export-title") ||
      f.el.querySelector("h1, h2, h3")?.textContent ||
      "";
    return {
      ...f,
      id: i,
      title: t.replace(/\s+/g, " ").trim() || `Section ${i + 1}`,
    };
  });
}

/** The list shown to the user so they can choose what goes into the PDF. */
export function listSections(root: HTMLElement): SectionInfo[] {
  return collect(root).map(({ id, title }) => ({ id, title }));
}

/** One PDF made from the chosen cards of the dashboard. Each card is captured on its own and placed on A4 pages, so cards are not cut in half
 *  (unless one card is taller than a page). Optional contents page, and a footer with the product name and page numbers on every page. */
export async function exportReport(
  root: HTMLElement,
  host: string,
  options: ExportOptions = {},
) {
  const { include, toc = false, onProgress } = options;
  const { jsPDF } = await import("jspdf");
  let bg = getComputedStyle(document.body).backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") bg = "#ffffff";
  const [r, g, b] = (() => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.fillStyle = bg;
    const v = c.fillStyle as string;
    const h = v.startsWith("#") ? v : "#ffffff";
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  })();
  const dark = r + g + b < 300;
  const ink: [number, number, number] = dark ? [240, 244, 250] : [30, 41, 59];
  const soft: [number, number, number] = [130, 140, 158];

  const opts = {
    pixelRatio: 1.8,
    backgroundColor: bg,
    cacheBust: true,
    filter: (n: Node) =>
      !(n instanceof HTMLElement && n.hasAttribute("data-no-export")),
  };
  const all = collect(root);
  const chosen = include ? all.filter((x) => include.includes(x.id)) : all;
  if (!chosen.length) throw new Error("No sections selected.");
  const rootW = Math.max(root.getBoundingClientRect().width, 1);

  // group cards that sit on the same row
  const rows: Block[][] = [];
  for (const bl of chosen) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - bl.y) < 6) last.push(bl);
    else rows.push([bl]);
  }

  const PW = 595,
    PH = 842,
    M = 28,
    CW = PW - M * 2,
    GAP = 10,
    BOT = PH - 36;
  const TOP = toc ? 0 : 84;
  const unit = CW / rootW; // pdf points per screen pixel
  const pdf = new jsPDF({ unit: "pt", format: [PW, PH], orientation: "p" });
  const paint = () => {
    if (dark) {
      pdf.setFillColor(r, g, b);
      pdf.rect(0, 0, PW, PH, "F");
    }
  };

  // cover header (page 1)
  paint();
  pdf.setFontSize(9);
  pdf.setTextColor(...soft);
  pdf.text(BRAND.name.toUpperCase(), M, 28);
  pdf.setFontSize(22);
  pdf.setTextColor(...ink);
  pdf.text("Website report", M, 52);
  pdf.setFontSize(10);
  pdf.setTextColor(...soft);
  pdf.text(`${host}  |  ${new Date().toLocaleString()}`, M, 68);

  let y = toc ? 0 : TOP;
  const newPage = () => {
    pdf.addPage([PW, PH], "p");
    paint();
    y = M;
  };
  if (toc) newPage(); // page 1 is kept for the contents, filled in at the end

  const startPage = new Map<number, number>();
  let n = 0;
  for (const row of rows) {
    const shots: { png: string; img: HTMLImageElement; blk: Block }[] = [];
    for (const blk of row) {
      onProgress?.(n++, chosen.length);
      let png: string;
      try {
        png = await toPng(blk.el, opts);
      } catch {
        png = await toPng(blk.el, { ...opts, skipFonts: true });
      }
      shots.push({ png, img: await loadImg(png), blk });
    }
    const left = Math.min(...row.map((x) => x.x));
    const rowH = Math.max(...shots.map((s) => s.blk.h * unit));
    const maxH = BOT - M;
    if (rowH <= maxH) {
      if (rowH > BOT - y) newPage();
      for (const s of shots) {
        pdf.addImage(
          s.png,
          "PNG",
          M + (s.blk.x - left) * unit,
          y,
          s.blk.w * unit,
          s.blk.h * unit,
        );
        startPage.set(s.blk.id, pdf.getNumberOfPages());
      }
      y += rowH + GAP;
      continue;
    }
    // one card taller than a page: cut it into slices
    for (const s of shots) {
      const w = s.blk.w * unit,
        scale = w / s.img.width;
      const sliceH = Math.floor(maxH / scale);
      for (let top = 0; top < s.img.height; top += sliceH) {
        if (top > 0 || BOT - y < 140) newPage();
        if (top === 0) startPage.set(s.blk.id, pdf.getNumberOfPages());
        const part = Math.min(sliceH, s.img.height - top);
        const c = document.createElement("canvas");
        c.width = s.img.width;
        c.height = part;
        c.getContext("2d")!.drawImage(
          s.img,
          0,
          top,
          s.img.width,
          part,
          0,
          0,
          s.img.width,
          part,
        );
        pdf.addImage(c.toDataURL("image/png"), "PNG", M, y, w, part * scale);
        y += part * scale + GAP;
      }
    }
  }
  onProgress?.(chosen.length, chosen.length);

  // contents page
  if (toc) {
    pdf.setPage(1);
    let ty = 108;
    pdf.setFontSize(14);
    pdf.setTextColor(...ink);
    pdf.text("Contents", M, ty);
    ty += 10;
    pdf.setDrawColor(...soft);
    pdf.setLineWidth(0.4);
    pdf.line(M, ty, PW - M, ty);
    ty += 20;
    const step = Math.min(20, (BOT - ty) / Math.max(chosen.length, 1));
    pdf.setFontSize(10.5);
    chosen.forEach((s, i) => {
      pdf.setTextColor(...ink);
      pdf.text(
        `${i + 1}.  ${s.title.length > 70 ? s.title.slice(0, 67) + "…" : s.title}`,
        M,
        ty,
      );
      pdf.setTextColor(...soft);
      pdf.text(String(startPage.get(s.id) ?? ""), PW - M, ty, {
        align: "right",
      });
      ty += step;
    });
  }

  // footer on every page
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(
      ...(dark
        ? ([70, 80, 100] as [number, number, number])
        : ([218, 224, 234] as [number, number, number])),
    );
    pdf.setLineWidth(0.5);
    pdf.line(M, PH - 26, PW - M, PH - 26);
    pdf.setFontSize(8);
    pdf.setTextColor(...soft);
    pdf.text(`${BRAND.name}  ·  ${host}`, M, PH - 13);
    pdf.text(`Page ${p} of ${pages}`, PW - M, PH - 13, { align: "right" });
  }
  pdf.save(
    `${[host, "report", new Date().toISOString().slice(0, 10)].map(slug).join("_")}.pdf`,
  );
}
