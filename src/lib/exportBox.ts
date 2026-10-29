import { toPng } from "html-to-image";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The page fonts come from Google Fonts (another website), and the browser does not let html-to-image read that stylesheet.
 * Without this the picture was taken with a plain fallback font, so the PDF looked different from the screen.
 * Here the stylesheet is downloaded once, only the latin letters are kept, and the font files are turned into data: URLs.
 */
let fontCss: Promise<string | null> | null = null;
function embeddedFonts(): Promise<string | null> {
  fontCss ??= (async () => {
    try {
      const link = document.querySelector<HTMLLinkElement>(
        'link[href*="fonts.googleapis.com/css"]',
      );
      if (!link) return null;
      const css = await (await fetch(link.href)).text();
      const faces = [
        ...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g),
      ]
        .filter((m) => m[1] === "latin")
        .map((m) => m[2]);
      if (!faces.length) return null;
      const toData = async (url: string) => {
        const blob = await (await fetch(url)).blob();
        return await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(r.error);
          r.readAsDataURL(blob);
        });
      };
      const out: string[] = [];
      for (const face of faces) {
        const m = face.match(/url\((https:[^)]+)\)/);
        out.push(m ? face.replace(m[1], await toData(m[1])) : face);
      }
      return out.join("\n");
    } catch {
      return null; // offline or blocked: html-to-image tries its own way (and then without web fonts)
    }
  })();
  return fontCss;
}

/**
 * Lists inside a card often scroll (max height + overflow), and a picture only shows what is visible.
 * For the picture, every scrolling part is opened to its full size, and put back afterwards.
 */
function openScrollers(root: HTMLElement) {
  const undo: (() => void)[] = [];
  const set = (el: HTMLElement, prop: string, value: string) => {
    const old = el.style.getPropertyValue(prop);
    const oldPrio = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, value, "important");
    undo.push(() =>
      old
        ? el.style.setProperty(prop, old, oldPrio)
        : el.style.removeProperty(prop),
    );
  };
  set(root, "animation", "none"); // the card fades in when it appears: never take the picture half faded
  set(root, "opacity", "1");
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    if (el.hasAttribute("data-no-export")) continue;
    const cs = getComputedStyle(el);
    if (
      /(auto|scroll|hidden)/.test(cs.overflowY) &&
      el.scrollHeight > el.clientHeight + 2 &&
      el.clientHeight > 0
    ) {
      set(el, "max-height", "none");
      set(el, "height", "auto");
      set(el, "overflow-y", "visible");
    }
    if (
      /(auto|scroll)/.test(cs.overflowX) &&
      el.scrollWidth > el.clientWidth + 2
    ) {
      set(el, "overflow-x", "visible");
    }
  }
  return () => undo.reverse().forEach((f) => f());
}

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Takes a picture of one dashboard card and downloads it as a PDF or PNG. Buttons marked data-no-export are left out. */
export async function exportBox(
  node: HTMLElement,
  title: string,
  host: string | undefined,
  kind: "pdf" | "png",
) {
  let bg = getComputedStyle(node).backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") bg = "#ffffff";
  const fonts = await embeddedFonts();
  try {
    await document.fonts?.ready;
  } catch {
    /* older browser: go on */
  }
  const restore = openScrollers(node);
  let png: string;
  let w = node.offsetWidth;
  let h = node.offsetHeight;
  try {
    await nextFrame();
    await nextFrame(); // let the page lay out the opened lists before measuring
    w = Math.max(node.offsetWidth, node.scrollWidth);
    h = Math.max(node.offsetHeight, node.scrollHeight);
    const opts = {
      pixelRatio: h > 4000 ? 1.5 : 2,
      backgroundColor: bg,
      cacheBust: true,
      width: w,
      height: h,
      ...(fonts ? { fontEmbedCSS: fonts } : {}),
      filter: (n: Node) =>
        !(
          n instanceof HTMLElement &&
          (n.hasAttribute("data-no-export") ||
            n.classList.contains("recharts-tooltip-wrapper")) // the hover box of a chart is not part of the card
        ),
    };
    try {
      png = await toPng(node, opts);
    } catch {
      png = await toPng(node, { ...opts, skipFonts: true });
    } // retry without web fonts if the browser blocks reading them
  } finally {
    restore();
  }
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
  const pad = 24,
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