/**
 * Procedural nature backdrops (no photos): layered terrain with atmospheric perspective,
 * soft sun, film grain. Deterministic, ~3 kB of markup each, crisp at any size.
 */
import { useId, type ReactNode } from "react";
import { rand } from "./geometry";

type Variant = "meadow" | "coast" | "forest" | "dawn";

const PALETTES: Record<Variant, { sky: [string, string, string]; sun: string; layers: string[] }> = {
  meadow: { sky: ["#f2d6c4", "#f6ece0", "#e8e6d6"], sun: "#ffd9b8", layers: ["#c9cdb8", "#a9b38e", "#7f8f5e", "#5c6e3f"] },
  coast: { sky: ["#e7b9a1", "#f3dccd", "#efe7dc"], sun: "#ffe0c4", layers: ["#c8b8ab", "#9fb2b8", "#7d9aa3", "#5f7f8a"] },
  forest: { sky: ["#dfe3d6", "#eef0e6", "#e5e8dc"], sun: "#fff4dc", layers: ["#c4ccbc", "#9fac97", "#75876c", "#4e6047"] },
  dawn: { sky: ["#e9a98d", "#f4d2bd", "#f8ece0"], sun: "#fff0dc", layers: ["#d8b4a2", "#c09685", "#9f7a6c", "#7d5e54"] },
};

/** A ridge line made of a few summed sines, closed to the bottom of the frame. */
function ridge(y: number, amp: number, seed: number, w = 400, h = 500, step = 8): string {
  const f1 = 0.008 + rand(seed) * 0.01, f2 = 0.02 + rand(seed + 1) * 0.02, ph = rand(seed + 2) * 6;
  let d = `M0,${h} L0,${y}`;
  for (let x = 0; x <= w; x += step) {
    const yy = y + Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 + ph * 2) * amp * 0.35;
    d += ` L${x},${yy.toFixed(1)}`;
  }
  return `${d} L${w},${h} Z`;
}

function pines(baseY: number, count: number, seed: number, color: string, scale: number): ReactNode {
  return Array.from({ length: count }, (_, i) => {
    const x = (i / count) * 420 - 10 + rand(seed + i) * 18;
    const hh = (40 + rand(seed + i * 3) * 50) * scale;
    const ww = hh * 0.36;
    const y = baseY + rand(seed + i * 7) * 12;
    return <path key={i} d={`M${x},${y - hh} L${x + ww / 2},${y} L${x - ww / 2},${y} Z`} fill={color} />;
  });
}

export function NatureBackdrop({ variant }: { variant: Variant }) {
  const id = useId().replace(/:/g, "");
  const p = PALETTES[variant];
  const flowers = variant === "meadow" || variant === "dawn";
  return (
    <svg className="backdrop" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="0.55" stopColor={p.sky[1]} />
          <stop offset="1" stopColor={p.sky[2]} />
        </linearGradient>
        <radialGradient id={`sun-${id}`} cx="0.72" cy="0.26" r="0.5">
          <stop offset="0" stopColor={p.sun} stopOpacity="0.95" />
          <stop offset="1" stopColor={p.sun} stopOpacity="0" />
        </radialGradient>
        <filter id={`grain-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" />
        </filter>
        <filter id={`haze-${id}`}><feGaussianBlur stdDeviation="1.6" /></filter>
        <filter id={`soft-${id}`}><feGaussianBlur stdDeviation="0.6" /></filter>
      </defs>
      <rect width="400" height="500" fill={`url(#sky-${id})`} />
      <rect width="400" height="500" fill={`url(#sun-${id})`} />
      {variant !== "forest" && Array.from({ length: 5 }, (_, i) => (
        <ellipse key={i} cx={40 + rand(i + 40) * 320} cy={50 + rand(i + 50) * 110} rx={50 + rand(i) * 60} ry={7 + rand(i + 9) * 8}
          fill="#fff" opacity={0.35 + rand(i + 3) * 0.3} filter={`url(#haze-${id})`} />
      ))}

      {variant === "coast" ? (
        <>
          <path d={ridge(250, 14, 11)} fill={p.layers[0]} filter={`url(#haze-${id})`} />
          <rect y="292" width="400" height="208" fill={p.layers[2]} />
          {Array.from({ length: 26 }, (_, i) => (
            <rect key={i} x={rand(i + 70) * 360} y={300 + i * 7.5} width={20 + rand(i + 90) * 80} height="1.2" fill="#fff" opacity={0.18 + rand(i) * 0.3} />
          ))}
          <path d={ridge(400, 10, 21)} fill={p.layers[3]} />
        </>
      ) : variant === "forest" ? (
        <>
          <path d={ridge(250, 16, 31)} fill={p.layers[0]} filter={`url(#haze-${id})`} />
          <g filter={`url(#haze-${id})`}>{pines(300, 26, 5, p.layers[1], 0.8)}</g>
          <rect y="300" width="400" height="200" fill={p.layers[1]} />
          <g filter={`url(#soft-${id})`}>{pines(360, 18, 17, p.layers[2], 1.15)}</g>
          <rect y="360" width="400" height="140" fill={p.layers[2]} />
          {pines(440, 10, 29, p.layers[3], 1.7)}
          <rect y="440" width="400" height="60" fill={p.layers[3]} />
          <rect y="250" width="400" height="90" fill="#fff" opacity="0.28" filter={`url(#haze-${id})`} />
        </>
      ) : (
        <>
          <path d={ridge(275, 18, 1)} fill={p.layers[0]} filter={`url(#haze-${id})`} />
          <path d={ridge(320, 22, 2)} fill={p.layers[1]} filter={`url(#soft-${id})`} />
          <path d={ridge(380, 16, 3)} fill={p.layers[2]} />
          <path d={ridge(440, 12, 4)} fill={p.layers[3]} />
        </>
      )}

      {flowers && Array.from({ length: 90 }, (_, i) => {
        const y = 400 + rand(i * 3) * 100;
        const near = (y - 400) / 100;
        const colors = ["#fbf3e6", "#f1c4a4", "#e8a07c", "#f4e3a8"];
        return <circle key={i} cx={rand(i * 7) * 400} cy={y} r={0.9 + near * 2.4} fill={colors[i % 4]} opacity={0.75 + near * 0.25} />;
      })}
      {flowers && Array.from({ length: 70 }, (_, i) => {
        const x = rand(i * 11) * 400, y = 430 + rand(i * 13) * 70;
        return <path key={i} d={`M${x},500 Q${x + 2},${y + 20} ${x + (rand(i) - 0.5) * 8},${y}`} stroke={p.layers[3]} strokeWidth="0.8" fill="none" opacity="0.8" />;
      })}
      <rect width="400" height="500" filter={`url(#grain-${id})`} />
    </svg>
  );
}
