import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import atlas from "world-atlas/countries-110m.json";
import { countryByMapId, flag } from "../lib/countries";
import { compact, TipRow, useTip } from "./dash";

export type CountryRow = {
  a2: string;
  name: string;
  value: number;
  share: number;
  extra: { label: string; value: string }[];
};

const W = 960,
  H = 480;

// Geometry is built once (module level): Antarctica is dropped so the map is not squashed.
const features = (
  feature(atlas as any, (atlas as any).objects.countries) as any
).features.filter((f: any) => String(f.id) !== "010");
const projection = geoNaturalEarth1().fitExtent(
  [
    [6, 6],
    [W - 6, H - 6],
  ],
  { type: "FeatureCollection", features } as any,
);
const path = geoPath(projection);
const shapes = features.map((f: any) => {
  const c = countryByMapId(f.id);
  return {
    id: String(f.id ?? f.properties?.name),
    a2: c?.a2 ?? null,
    name: c?.name ?? f.properties?.name ?? "Unknown",
    d: path(f) ?? "",
    area: path.area(f),
    centroid: path.centroid(f) as [number, number],
  };
});

const lerp = (a: number[], b: number[], t: number) =>
  a.map((x, i) => Math.round(x + (b[i] - x) * t));
const LOW = [217, 238, 245],
  HIGH = [31, 138, 168];
const fill = (t: number) =>
  `rgb(${lerp(LOW, HIGH, Math.max(0, Math.min(1, t))).join(",")})`;

export default function WorldMap({
  rows,
  unit,
  active,
  onHover,
}: {
  rows: CountryRow[];
  unit: string;
  active?: string | null;
  onHover?: (a2: string | null) => void;
}) {
  const { ref, onMove, hide, node } = useTip();
  const [picked, setPicked] = useState<string | null>(null); // tap on mobile
  const byA2 = useMemo(() => new Map(rows.map((r) => [r.a2, r])), [rows]);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const current = active ?? picked;

  const content = (a2: string | null, name: string) => {
    const r = a2 ? byA2.get(a2) : undefined;
    return (
      <>
        <div className="mb-1.5 flex items-center gap-2 text-sm font-bold">
          {a2 && <span>{flag(a2)}</span>}
          {name}
        </div>
        {r ? (
          <>
            <TipRow
              label={unit}
              value={r.value.toLocaleString()}
              color="#5b38ee"
            />
            <TipRow label="Share" value={`${(r.share * 100).toFixed(1)}%`} />
            {r.extra.map((e) => (
              <TipRow key={e.label} label={e.label} value={e.value} />
            ))}
          </>
        ) : (
          <p className="text-slate-500">No traffic recorded</p>
        )}
      </>
    );
  };

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Traffic by country map"
        onMouseLeave={() => {
          hide();
          onHover?.(null);
        }}
      >
        <g>
          {shapes.map((s: any, i: number) => {
            const r = s.a2 ? byA2.get(s.a2) : undefined;
            const on = !!s.a2 && s.a2 === current;
            return (
              <path
                key={`${s.id}-${i}`}
                d={s.d}
                className={r ? "" : "fill-[#e5e9f2] dark:fill-slate-700"}
                style={
                  r
                    ? { fill: fill(0.18 + 0.82 * Math.sqrt(r.value / max)) }
                    : undefined
                }
                stroke={on ? "#3730a3" : "white"}
                strokeWidth={on ? 1.6 : 0.5}
                opacity={current && !on && r ? 0.75 : 1}
                onMouseMove={(e) => {
                  onMove(content(s.a2, s.name))(e);
                  onHover?.(s.a2);
                }}
                onClick={() => setPicked(s.a2 === picked ? null : s.a2)}
              />
            );
          })}
        </g>
      </svg>
      {node}
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Low</span>
        <span
          className="h-2 w-28 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${fill(0.18)}, ${fill(1)})`,
          }}
        />
        <span>High ({compact(max)})</span>
      </div>
    </div>
  );
}
