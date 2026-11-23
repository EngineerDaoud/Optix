// Heading extraction that reads the page the way a browser (and Google) does, not with one regex over the raw text.
//
// Why: counting "<h1" in the raw HTML gave wrong answers on real sites:
//   * "More than one H1" when the second <h1> sits inside an HTML comment, a <script> / <template> / <noscript> block,
//     an SVG, or in a hidden copy of the header (mobile menu, popup, slider clone) that nobody ever sees
//   * "More than one H1" when a theme prints the SAME heading twice (desktop + mobile header)
//   * "No H1" when the H1 only holds the logo image (the alt text IS the heading) or uses role="heading" aria-level="1"
// One pass, no dependencies, linear time: safe inside an edge function on 800 KB pages.

export type Headings = {
  /** text of every visible H1 (duplicates removed), at most 5 */
  h1s: string[];
  /** how many distinct visible H1 headings the page has, INCLUDING image-only ones (use this for "no H1" / "more than one H1") */
  h1n: number;
  /** H1 elements that exist in the markup but are hidden (display:none, hidden attribute...). They are not counted in h1n. */
  h1Hidden: number;
  /** visible H2 / H3 counts */
  h2: number;
  h3: number;
  /** text of visible H2/H3 headings (max 120 characters each, first 12) */
  h2s: string[];
};

const SKIP = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "math",
  "textarea",
  "iframe",
  "object",
  "select",
  "canvas",
  "audio",
  "video",
  "datalist",
]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ENT: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: "...",
  copy: "(c)",
  reg: "(R)",
  trade: "TM",
};
export function decodeEntities(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENT[e.toLowerCase()] ?? " ";
  });
}

const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:doctype|DOCTYPE)[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE =
  /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const NEEDS_ATTRS = /hidden|hide|d-none|display|visib|invisible|role\s*=|alt\s*=|aria-label|title\s*=|no-display/i;

function attrsOf(raw: string) {
  const a: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw))) {
    const k = m[1].toLowerCase();
    if (!(k in a)) a[k] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return a;
}

// class names that hide an element for everybody (Bootstrap, Tailwind, WordPress, Shopify themes)
const HIDE_CLASS =
  /^(?:hidden|hide|d-none|is-hidden|u-hidden|display-none|display--none|visibility-hidden|invisible|no-display|screen-hidden|element-invisible-none)$/;
// a responsive class that shows it again on some screen sizes ("hidden md:block"): then it is a real element on desktop
const SHOW_CLASS =
  /^(?:(?:sm|md|lg|xl|2xl):(?:block|flex|grid|inline|inline-block|inline-flex|table)|d-(?:sm|md|lg|xl|xxl)-(?:block|flex|inline|inline-block|inline-flex|grid)|show|is-visible|visible)$/;

function isHidden(a: Record<string, string>) {
  if ("hidden" in a && a.hidden !== "until-found") return true;
  const st = a.style;
  if (st && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(st))
    return true;
  const cls = a.class;
  if (cls) {
    const parts = cls.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.some((c) => HIDE_CLASS.test(c)) && !parts.some((c) => SHOW_CLASS.test(c)))
      return true;
  }
  return false;
}

type Frame = { tag: string; hidden: boolean };
type Cap = {
  level: 1 | 2 | 3;
  depth: number; // stack length right after the heading element was pushed
  hidden: boolean;
  text: string;
  img: boolean; // an image / svg lives inside the heading
};

/** Reads H1/H2/H3 headings of one HTML document. */
export function extractHeadings(html: string): Headings {
  const out: Headings = { h1s: [], h1n: 0, h1Hidden: 0, h2: 0, h3: 0, h2s: [] };
  if (!html) return out;
  const seenH1 = new Set<string>();
  const stack: Frame[] = [];
  let cap: Cap | null = null;
  let inHead = false;
  let lower: string | null = null; // lower-case copy of the page, made once and only if a script/style block is met

  const finish = (c: Cap) => {
    const text = decodeEntities(c.text).replace(/\s+/g, " ").trim();
    if (c.level === 1) {
      if (!text && !c.img) return; // an empty <h1></h1> is not a heading
      if (c.hidden) {
        out.h1Hidden++;
        return;
      }
      const key = (text || "[image]").toLowerCase();
      if (seenH1.has(key)) return; // the same heading printed twice (desktop + mobile header) is one heading
      seenH1.add(key);
      out.h1n++;
      if (text && out.h1s.length < 5) out.h1s.push(text);
      return;
    }
    if (c.hidden) return;
    if (c.level === 2) out.h2++;
    else out.h3++;
    if (text && text.length <= 120 && out.h2s.length < 12) out.h2s.push(text);
  };

  const closeTo = (idx: number) => {
    // pop stack down to length idx, finishing the capture if its element closes
    while (stack.length > idx) {
      stack.pop();
      if (cap && stack.length < cap.depth) {
        finish(cap);
        cap = null;
      }
    }
  };

  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    // text before this tag
    if (cap && m.index > last) {
      const top = stack[stack.length - 1];
      const skipped = stack.some((f) => SKIP.has(f.tag));
      if (!skipped && !(top?.hidden && !cap.hidden)) cap.text += html.slice(last, m.index);
    }
    last = TAG_RE.lastIndex;
    if (!m[2]) continue; // comment / doctype / cdata: ignored completely
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (closing) {
      if (tag === "head") inHead = false;
      // find the matching open tag; an unmatched closing tag is ignored
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i >= 0) closeTo(i);
      continue;
    }

    if (tag === "body") inHead = false;
    if (tag === "head") {
      inHead = true;
      stack.push({ tag, hidden: false });
      continue;
    }

    const selfClose = m[3].endsWith("/");
    // attributes are parsed only for headings and for tags that carry a hiding / role hint (most tags need no parsing at all)
    const a =
      m[3] && (tag.length === 2 || NEEDS_ATTRS.test(m[3])) ? attrsOf(m[3]) : {};

    // contents of script/style/template... are never read: jump straight to the end tag
    if (SKIP.has(tag)) {
      if (cap && tag === "svg") cap.img = true;
      if (cap && (tag === "svg" || tag === "img")) {
        const label = a["aria-label"] || a.title;
        if (label && !stack.some((f) => f.hidden)) cap.text += ` ${label} `;
      }
      if (!selfClose) {
        lower ??= html.toLowerCase();
        const end = lower.indexOf(`</${tag}`, last);
        if (end < 0) break; // unterminated: stop reading, what was found so far is kept
        const close = html.indexOf(">", end);
        last = TAG_RE.lastIndex = close < 0 ? html.length : close + 1;
      }
      continue;
    }

    if (tag === "img") {
      if (cap) {
        cap.img = true;
        const alt = (a.alt ?? "").trim();
        if (alt && !stack.some((f) => f.hidden)) cap.text += ` ${alt} `;
      }
      continue;
    }
    if (VOID.has(tag) || selfClose) continue;
    if (inHead) continue;

    const parentHidden = stack.length ? stack[stack.length - 1].hidden : false;
    const hidden = parentHidden || isHidden(a);
    stack.push({ tag, hidden });

    // heading start
    let level: 0 | 1 | 2 | 3 = 0;
    if (tag === "h1") level = 1;
    else if (tag === "h2") level = 2;
    else if (tag === "h3") level = 3;
    else if ((a.role ?? "").toLowerCase() === "heading") {
      const lv = parseInt(a["aria-level"] ?? "2", 10);
      level = lv === 1 ? 1 : lv === 2 ? 2 : lv === 3 ? 3 : 0;
    }
    if (level) {
      if (cap) {
        finish(cap); // a heading opened inside an unclosed one: close the first
        cap = null;
      }
      cap = { level, depth: stack.length, hidden, text: "", img: false };
    }
  }
  if (cap) finish(cap);
  return out;
}

/** Visible text of the page: no comments, no <head>, no script/style/template/noscript/svg, no hidden blocks, no nav/footer. */
export function stripToBodyHtml(html: string) {
  return html.replace(
    /<!--[\s\S]*?-->|<head(?=[\s>])[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<template[\s\S]*?<\/template>|<svg[\s\S]*?<\/svg>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi,
    " ",
  );
}