// Removes repeated rows from a report so every list on screen shows each item once.

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const normUrl = (u: unknown) => norm(u).replace(/#.*$/, "").replace(/\/+$/, "");

/** Keeps the first row for each key. If `better` says a later row is better, that one is kept instead (in the first row's place). */
export function uniqBy<T>(
  rows: T[] | undefined | null,
  key: (r: T) => string,
  better?: (a: T, b: T) => boolean,
): T[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    const k = key(r);
    if (!k) {
      out.push(r);
      continue;
    }
    const at = seen.get(k);
    if (at === undefined) {
      seen.set(k, out.length);
      out.push(r);
    } else if (better && better(r, out[at])) out[at] = r;
  }
  return out;
}

const bestPos = (a: any, b: any) =>
  typeof a?.position === "number" &&
  (typeof b?.position !== "number" || a.position < b.position);
const byKey = (r: any) => norm(r?.key);

export function cleanReport<T = any>(d: T): T {
  if (!d || typeof d !== "object") return d;
  const x: any = { ...(d as any) };
  const when = (k: string, fn: (v: any) => any) => {
    if (Array.isArray(x[k])) x[k] = fn(x[k]);
  };

  when("rankings", (v) => uniqBy(v, (r: any) => norm(r?.keyword), bestPos));
  when("keywordTable", (v) =>
    uniqBy(
      v,
      (r: any) => norm(r?.keyword),
      (a: any, b: any) => (a?.visits ?? 0) > (b?.visits ?? 0),
    ),
  );
  when("competitors", (v) => uniqBy(v, (r: any) => norm(r?.domain)));
  when("platforms", (v) => uniqBy(v, (r: any) => norm(r?.domain)));
  when("gaps", (v) =>
    uniqBy(v, (r: any) => norm(r?.keyword)).map((g: any) => ({
      ...g,
      top: uniqBy(g?.top, (t: any) => normUrl(t?.url)),
    })),
  );
  when("ideas", (v) => uniqBy(v, (s: any) => norm(s)));
  when("terms", (v) => uniqBy(v, (t: any) => norm(t?.word)));
  when("pages", (v) => uniqBy(v, (p: any) => normUrl(p?.url)));
  when("issues", (v) =>
    uniqBy(v, (i: any) => norm(i?.id ?? i?.label)).map((i: any) =>
      Array.isArray(i?.examples)
        ? { ...i, examples: uniqBy(i.examples, (u: any) => normUrl(u)) }
        : i,
    ),
  );
  when("plan", (v) =>
    uniqBy(v, (t: any) => norm(t?.id ?? t?.title ?? t?.task)),
  );
  when("shareOfVoice", (v) => uniqBy(v, (r: any) => norm(r?.domain)));
  when("brokenLinks", (v) => uniqBy(v, (b: any) => normUrl(b?.url ?? b?.to)));

  const tr = x.traffic;
  if (tr && typeof tr === "object") {
    const t: any = { ...tr };
    for (const side of ["ga4", "gsc"]) {
      const s = t.own?.[side];
      if (!s) continue;
      t.own = { ...t.own, [side]: { ...s } };
      for (const k of [
        "countries",
        "channels",
        "sources",
        "devices",
        "queries",
        "pages",
      ]) {
        if (Array.isArray(s[k])) t.own[side][k] = uniqBy(s[k], byKey);
      }
    }
    if (t.seo?.countries)
      t.seo = {
        ...t.seo,
        countries: uniqBy(t.seo.countries, (r: any) => norm(r?.country)),
      };
    x.traffic = t;
  }
  return x as T;
}
