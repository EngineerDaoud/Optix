import { toPng } from "html-to-image";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Takes a picture of one dashboard card and downloads it as a PDF or PNG. Buttons marked data-no-export are left out. */
export async function exportBox(
  node: HTMLElement,
  title: string,
  host: string | undefined,
  kind: "pdf" | "png",
) {
  let bg = getComputedStyle(node).backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") bg = "#ffffff";
  const opts = {
    pixelRatio: 2,
    backgroundColor: bg,
    cacheBust: true,
    filter: (n: Node) =>
      !(n instanceof HTMLElement && n.hasAttribute("data-no-export")),
  };
  let png: string;
  try {
    png = await toPng(node, opts);
  } catch {
    png = await toPng(node, { ...opts, skipFonts: true });
  } // retry without web fonts if the browser blocks reading them
  const file = [host, title, new Date().toISOString().slice(0, 10)]
    .filter(Boolean)
    .map((x) => slug(String(x)))
    .join("_");

  if (kind === "png") {
    const a = document.createElement("a");
    a.href = png;
    a.download = `${file}.png`;
    a.click();
    return;
  }
  const { jsPDF } = await import("jspdf");
  const w = node.offsetWidth,
    h = node.offsetHeight,
    pad = 24,
    head = 44;
  const pw = w + pad * 2,
    ph = h + pad * 2 + head;
  const pdf = new jsPDF({
    unit: "px",
    format: [pw, ph],
    orientation: pw > ph ? "l" : "p",
    hotfixes: ["px_scaling"],
  });
  pdf.setFontSize(16);
  pdf.setTextColor(30, 41, 59);
  pdf.text(title, pad, pad + 12);
  pdf.setFontSize(10);
  pdf.setTextColor(120, 130, 150);
  pdf.text(
    `${host ? `${host} · ` : ""}${new Date().toLocaleString()}`,
    pad,
    pad + 30,
  );
  pdf.addImage(png, "PNG", pad, pad + head, w, h);
  pdf.save(`${file}.pdf`);
}
