/**
 * Line-art brain (side view, frontal lobe left) with a neuron network inside.
 * Each first principle maps to a region; the active one lights up in clay, and the
 * consolidation arc (hippocampus → neocortex, i.e. what happens in sleep) is always drawn.
 */
import { rand, type P } from "./geometry";

export type RegionKey = "hippocampus" | "sleep" | "neocortex" | "prefrontal" | "plasticity" | "forgetting" | "cerebellum";

interface Region { label: string; center: P; radius: number; labelAt: P; anchor?: "start" | "end" }

export const REGIONS: Record<Exclude<RegionKey, "sleep" | "forgetting">, Region> = {
  prefrontal: { label: "prefrontal · rules", center: [165, 150], radius: 62, labelAt: [36, 70], anchor: "start" },
  neocortex: { label: "neocortex · knowledge", center: [370, 115], radius: 70, labelAt: [470, 40], anchor: "start" },
  hippocampus: { label: "hippocampus · sessions", center: [318, 244], radius: 34, labelAt: [214, 392], anchor: "start" },
  plasticity: { label: "basal ganglia · feedback", center: [252, 206], radius: 36, labelAt: [28, 330], anchor: "start" },
  cerebellum: { label: "cerebellum · procedures", center: [430, 332], radius: 40, labelAt: [480, 404], anchor: "start" },
};

const CEREBRUM = "M92,232 C70,150 122,70 212,48 C272,30 344,30 404,54 C474,80 524,132 518,198 C514,244 490,272 454,288 C428,300 400,302 380,294 C350,316 300,322 260,306 C218,322 160,312 130,288 C104,270 96,252 92,232 Z";
const CEREBELLUM = "M382,294 C424,300 474,302 484,332 C486,358 452,372 416,364 C386,356 372,322 382,294 Z";
const STEM = "M356,304 C364,342 372,382 368,414 M394,306 C396,346 396,382 392,414";
const FOLDS = [
  "M302,44 C288,92 312,130 284,182",
  "M168,252 C230,226 300,232 364,214",
  "M226,64 C214,104 236,132 214,170",
  "M378,62 C392,104 366,140 392,178",
  "M120,170 C150,160 168,180 196,172",
  "M430,110 C452,130 446,160 470,180",
  "M240,280 C262,266 286,276 300,262",
  "M410,316 C430,324 452,322 470,330",
  "M402,338 C424,346 446,344 462,350",
];

function inside([x, y]: P): boolean {
  const a = ((x - 302) / 206) ** 2 + ((y - 178) / 124) ** 2 < 0.92 && y < 300;
  const b = ((x - 430) / 46) ** 2 + ((y - 333) / 28) ** 2 < 0.85;
  return a || b;
}

const NEURONS: P[] = (() => {
  const pts: P[] = [];
  for (let i = 0; i < 520 && pts.length < 150; i++) {
    const p: P = [96 + rand(i * 3 + 1) * 420, 46 + rand(i * 5 + 2) * 330];
    if (inside(p) && pts.every((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 > 380)) pts.push(p);
  }
  return pts;
})();

const SYNAPSES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  NEURONS.forEach((p, i) => {
    const near = NEURONS.map((q, j) => [j, (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2] as const)
      .filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 2);
    near.forEach(([j, d]) => { if (d < 2600 && i < j) out.push([i, j]); });
  });
  return out;
})();

const inRegion = (p: P, r: Region) => (p[0] - r.center[0]) ** 2 + (p[1] - r.center[1]) ** 2 < r.radius ** 2;

export function Brain({ active }: { active: RegionKey }) {
  const region = active in REGIONS ? REGIONS[active as keyof typeof REGIONS] : null;
  const lit = (p: P) => (region ? inRegion(p, region) : false);
  const hippo = REGIONS.hippocampus.center, neo = REGIONS.neocortex.center;
  return (
    <svg viewBox="0 0 640 430" role="img" aria-label={`Brain diagram, ${active} highlighted`}>
      <path d={CEREBRUM} className="lobe" />
      <path d={CEREBELLUM} className="lobe" />
      <path d={STEM} className="lobe" />
      {FOLDS.map((d) => <path key={d} d={d} className="fold" />)}

      {SYNAPSES.map(([i, j]) => {
        const on = lit(NEURONS[i]) && lit(NEURONS[j]);
        return <line key={`${i}-${j}`} x1={NEURONS[i][0]} y1={NEURONS[i][1]} x2={NEURONS[j][0]} y2={NEURONS[j][1]}
          className="syn" style={on ? { stroke: "var(--clay)", strokeOpacity: 0.8 } : undefined} />;
      })}
      {NEURONS.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={lit(p) ? 2.6 : 1.6} className={`neuron ${lit(p) ? "pulse" : ""}`}
          style={lit(p) ? { fill: "var(--clay)", animationDelay: `${(i % 7) * 0.3}s` } : { opacity: 0.55 }} />
      ))}

      {/* consolidation: hippocampus → neocortex (what sleep does) */}
      <path d={`M${hippo[0]},${hippo[1]} C ${hippo[0] + 40},${hippo[1] - 90} ${neo[0] - 40},${neo[1] + 60} ${neo[0]},${neo[1]}`}
        fill="none" stroke="var(--clay)" strokeWidth={active === "sleep" ? 2.2 : 1.2} strokeDasharray="4 5"
        style={{ animation: "flow 1.4s linear infinite" }} opacity={active === "sleep" ? 1 : 0.55} />
      <text x={hippo[0] + 52} y={hippo[1] - 64} className={`lbl ${active === "sleep" ? "lbl-on" : ""}`}>sleep · consolidation</text>

      {(Object.entries(REGIONS) as Array<[RegionKey, Region]>).map(([k, r]) => {
        const on = k === active || (active === "forgetting" && k === "hippocampus");
        return (
          <g key={k} opacity={on ? 1 : 0.7}>
            <line x1={r.center[0]} y1={r.center[1]} x2={r.labelAt[0] + (r.anchor === "end" ? 4 : -4)} y2={r.labelAt[1] - 4}
              className="lead" strokeOpacity={on ? 0.9 : 0.25} />
            <circle cx={r.center[0]} cy={r.center[1]} r={on ? 4 : 2.5} fill="var(--clay)" />
            <text x={r.labelAt[0]} y={r.labelAt[1]} textAnchor={r.anchor} className={`lbl ${on ? "lbl-on" : ""}`}>{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
