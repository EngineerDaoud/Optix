/** Position over time, drawn upside down: #1 is at the top, a gap in the line means "not ranking" on that check. */
export default function PosSpark({ series }: { series: (number | null)[] }) {
  const w = 96,
    h = 28,
    pad = 3;
  const real = series.filter((p): p is number => p != null);
  if (series.length < 2 || !real.length)
    return (
      <span className="text-xs text-slate-400">
        {series.length ? "1 check" : "–"}
      </span>
    );
  const max = Math.max(10, ...real);
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (p: number) =>
    pad + ((p - 1) / Math.max(1, max - 1)) * (h - pad * 2);
  const segs: string[] = [];
  let cur = "";
  series.forEach((p, i) => {
    if (p == null) {
      if (cur) segs.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)} `;
  });
  if (cur) segs.push(cur);
  const last = series[series.length - 1];
  const first = real[0];
  const color = last != null && last <= first ? "#16a34a" : "#dc2626";
  return (
    <svg width={w} height={h} role="img" aria-label="Position trend">
      {segs.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last != null && (
        <circle cx={x(series.length - 1)} cy={y(last)} r={2.6} fill={color} />
      )}
    </svg>
  );
}
