import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/* ---------- colourful smoke (like ink in water), made in code: no image files needed ---------- */

function hash(ix: number, iy: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x: number, y: number, seed: number) {
  let v = 0;
  let amp = 0.5;
  for (let o = 0; o < 5; o++) {
    v += amp * vnoise(x, y, seed + o * 17);
    x = x * 2.03 + 11.7;
    y = y * 2.03 + 3.1;
    amp *= 0.5;
  }
  return v;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

type RGB = [number, number, number];
/** One soft, wispy smoke cloud (transparent background) going from colour c1 (top) to c2 (bottom). */
function makeSmokeSprite(size: number, seed: number, c1: RGB, c2: RGB) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const out = img.data;
  const S = 2.2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 2 - 1;
      const y = ((py + 0.5) / size) * 2 - 1;
      const q1 = fbm(x * S, y * S, seed);
      const q2 = fbm(x * S + 5.2, y * S + 1.3, seed);
      const w = fbm(x * S + 2.2 * q1, y * S + 2.2 * q2, seed + 7);
      const d = smooth(0.28, 0.74, w) * smooth(1.0, 0.2, Math.hypot(x, y));
      const t = Math.min(1, Math.max(0, ((y + 1) / 2) * 0.6 + (w - 0.3) * 0.9));
      const i = (py * size + px) * 4;
      out[i] = c1[0] + (c2[0] - c1[0]) * t;
      out[i + 1] = c1[1] + (c2[1] - c1[1]) * t;
      out[i + 2] = c1[2] + (c2[2] - c1[2]) * t;
      out[i + 3] = 255 * Math.pow(d, 1.1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// teal -> blue -> violet -> pink, like the reference smoke picture
const PALETTE: [RGB, RGB][] = [
  [[45, 212, 191], [96, 165, 250]],
  [[96, 165, 250], [139, 92, 246]],
  [[139, 92, 246], [236, 72, 153]],
  [[236, 72, 153], [251, 113, 133]],
];
let SPRITES: HTMLCanvasElement[] | null = null;
const getSprites = () =>
  (SPRITES ??= PALETTE.map((p, i) => makeSmokeSprite(192, 11 + i * 31, p[0], p[1])));

const SMOKE_LIFE = 2; // seconds a smoke cloud lives: it blurs and fades away completely in this time
const SMOKE_EVERY = 0.035; // many small, soft clouds = one smooth stream (no jerks) // a new cloud leaves the rocket this often (seconds)

type Puff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  born: number;
  sprite: HTMLCanvasElement;
};

/**
 * "Your result is on the way" panel. Placed INSIDE the results area (not over the whole screen): the area is blurred,
 * the rocket flies slowly round the ring, colourful smoke keeps coming out of its back and spreads over the whole
 * panel while it fades away, and a bar shows how much of the check is done. The parent must wrap the results area in
 * a `relative` element. The panel disappears the moment the result arrives (the parent stops rendering it).
 */
export default function AnalyzingOverlay({
  progress,
  percent,
  onCancel,
  title = "Your website result is on the way",
}: {
  progress?: string;
  percent?: number; // 0-100; leave out when the length of the wait is not known
  onCancel?: () => void;
  title?: string;
}) {
  const known = typeof percent === "number";
  const pct = known ? Math.max(1, Math.min(100, Math.round(percent!))) : 0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rocketRef = useRef<HTMLDivElement>(null);

  // smoke: every frame we look where the rocket is NOW (so it always matches the CSS flight) and leave a cloud at its tail
  useEffect(() => {
    const canvas = canvasRef.current;
    const ring = ringRef.current;
    const rocket = rocketRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ring || !rocket || !ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const sprites = getSprites();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const puffs: Puff[] = [];
    let spawned = 0;
    let acc = 0;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cr = canvas.getBoundingClientRect();
      const rr = rocket.getBoundingClientRect();
      const gr = ring.getBoundingClientRect();
      const cx = gr.left + gr.width / 2 - cr.left;
      const cy = gr.top + gr.height / 2 - cr.top;
      const px = rr.left + rr.width / 2 - cr.left;
      const py = rr.top + rr.height / 2 - cr.top;
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.hypot(dx, dy) || 1;
      const tx = -dy / len; // flight direction (clockwise)
      const ty = dx / len;

      acc += dt;
      while (acc > SMOKE_EVERY) {
        acc -= SMOKE_EVERY;
        const colour = Math.floor(spawned / 4) % sprites.length; // colour slowly changes along the trail
        spawned++;
        puffs.push({
          x: px - tx * 20,
          y: py - ty * 20,
          vx: -tx * 6,
          vy: -ty * 6,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.2,
          born: now,
          sprite: sprites[colour],
        });
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const maxSize = 110; // a cloud only grows a little: the smoke stays right behind the rocket
      const canBlur = "filter" in ctx;
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        const sec = (now - p.born) / 1000;
        const age = sec / SMOKE_LIFE;
        if (age >= 1) {
          puffs.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const size = 30 + (maxSize - 30) * Math.pow(age, 0.8);
        const fadeIn = smooth(0, 0.35, sec); // starts very softly, so nothing "pops" out of the rocket
        ctx.globalAlpha = fadeIn * 0.32 * Math.pow(1 - age, 1.5);
        if (canBlur) ctx.filter = `blur(${(2 + age * 6).toFixed(1)}px)`; // always soft, blurrier while it disappears
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(p.sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (canBlur) ctx.filter = "none";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fade-in absolute inset-0 z-30 overflow-hidden rounded-card bg-white/60 backdrop-blur-md dark:bg-slate-950/65"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {/* sticky: stays in view even when the old report under the blur is long */}
      <div className="sticky top-[10vh] mx-auto flex max-w-md flex-col items-center px-4 pb-10 pt-6 text-center">
        {/* the ring and the rocket share one centre, so the rocket always sits ON the ring line */}
        <div ref={ringRef} className="relative mb-6 h-56 w-56">
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-brand-500/30" />
          {/* centre circle: soft pulsing glow behind, "Optix" text on top (text does not pulse) */}
          <div className="absolute inset-[4.25rem] flex items-center justify-center">
            <div className="rocket-glow absolute inset-0 rounded-full bg-brand-500/20" />
            <span className="relative text-xl font-extrabold tracking-tight text-brand-700 dark:text-brand-300">
              Optix
            </span>
          </div>
          <div className="rocket-orbit absolute inset-0">
            <div ref={rocketRef} className="absolute left-1/2 top-0 -ml-6 -mt-6 h-12 w-12">
              <img
                src="/favicon.png"
                alt=""
                draggable={false}
                className="rocket-nose h-12 w-12 select-none drop-shadow-lg"
              />
            </div>
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          {title}
          <span className="loading-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </h2>
        {known && (
          <div className="mt-4 w-full max-w-xs">
            <div className="mb-1 flex items-baseline justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Progress</span>
              <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
                {pct}%
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-brand-500/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        <p className="mt-3 min-h-[2.5rem] text-sm text-slate-600 dark:text-slate-300">
          {progress || "Getting things ready"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Big sites take a few minutes. You can open other pages, the check keeps
          running.
        </p>
        {onCancel && (
          <button
            type="button"
            className="btn-ghost mt-5 !border-red-200 !px-5 !py-2 !text-red-600 hover:!bg-red-50 dark:!border-red-500/40 dark:!text-red-400 dark:hover:!bg-red-500/10"
            onClick={onCancel}
          >
            <X className="h-4 w-4" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}