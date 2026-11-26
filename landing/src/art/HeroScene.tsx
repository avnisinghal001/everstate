/**
 * Hero illustration: input → everstate → memory → agent.
 * Scattered fragments (chats, email, docs, tool calls) and one user query flow into a black
 * Everstate box. It lifts the right memories out of a scoped memory field and hands a
 * cited answer to the agent. Line art; clay marks only what is relevant to the query.
 */
import { useEffect, useState, type ReactNode } from "react";
import { box, cubic, poly, project, rand, type P } from "./geometry";

const W = 1400;
const H = 600;

function useMotion() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return ok;
}

function Box({ f, tone = "line", className }: { f: ReturnType<typeof box>; tone?: "line" | "clay" | "ink"; className?: string }) {
  return (
    <g className={`bx bx-${tone} ${className ?? ""}`}>
      <polygon className="f-left" points={poly(f.left)} />
      <polygon className="f-right" points={poly(f.right)} />
      <polygon className="f-top" points={poly(f.top)} />
    </g>
  );
}

/* --------------------------------------------------------------- the learner box */
const LB: P = [560, 262];                 // origin of the Everstate box
const LW = 118, LD = 92, LH = 178;

function Learner() {
  const f = box(0, 0, 0, LW, LD, LH, LB);
  const dots: ReactNode[] = [];
  let k = 0;
  for (let u = 6; u < LW - 2; u += 7) {
    for (let v = 6; v < LH - 2; v += 7) {
      k++;
      const [sx, sy] = project(u, LD, v, LB);
      const n = rand(k);
      const hot = u > 70 && v < 70;                     // the "recall" region glows clay
      const r = hot ? 1.25 + n * 1.1 : 0.55 + n * 1.25;
      dots.push(<circle key={k} cx={sx} cy={sy} r={r} className={hot && n > 0.35 ? "dot-hot" : "dot"} opacity={hot ? 0.95 : 0.25 + n * 0.6} />);
    }
  }
  const pages: ReactNode[] = [];
  for (let y = 3; y < LD; y += 3.2) {
    const a = project(LW, y, 0, LB), b = project(LW, y, LH, LB);
    pages.push(<line key={y} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="page" />);
  }
  const hatch: ReactNode[] = [];
  for (let x = 6; x < LW; x += 6) {
    const a = project(x, 0, LH, LB), b = project(x, LD, LH, LB);
    hatch.push(<line key={x} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="hatch" />);
  }
  return (
    <g>
      <polygon className="learner-left" points={poly(f.left)} />
      <polygon className="learner-right" points={poly(f.right)} />
      {pages}
      <polygon className="learner-top" points={poly(f.top)} />
      {hatch}
      {dots}
      <polygon className="learner-edge" points={poly(f.left)} />
      <polygon className="learner-edge" points={poly(f.right)} />
      <polygon className="learner-edge" points={poly(f.top)} />
    </g>
  );
}

/* --------------------------------------------------------------- inputs */
const ENTRY = (i: number): P => project(10 + (i % 7) * 15, LD, 26 + (i * 37) % 128, LB);

interface Flow { id: string; d: string; p: [P, P, P, P]; hot: boolean }

function flows(): Flow[] {
  const out: Flow[] = [];
  for (let i = 0; i < 17; i++) {
    const sy = 120 + i * 24 + rand(i + 3) * 10;
    const s: P = [-10, sy];
    const e = ENTRY(i);
    const p: [P, P, P, P] = [s, [s[0] + 260, sy + (rand(i) - 0.5) * 40], [e[0] - 190, e[1] + (rand(i + 9) - 0.5) * 30], e];
    out.push({ id: `flow-${i}`, d: `M${s[0]},${s[1]} C${p[1][0]},${p[1][1]} ${p[2][0]},${p[2][1]} ${e[0]},${e[1]}`, p, hot: i === 5 || i === 11 });
  }
  return out;
}

function Fragment({ at, k, hot }: { at: P; k: number; hot: boolean }) {
  const w = 14 + rand(k) * 14, d = 5 + rand(k + 1) * 3;
  const f = box(0, 0, 0, w, d, 2, [at[0] - (w - d) * 0.43, at[1] - (w + d) * 0.25]);
  return <Box f={f} tone={hot ? "clay" : "line"} className="frag" />;
}

const GLYPHS: Array<[number, number, string]> = [[1, 0.28, "chat"], [3, 0.46, "email"], [8, 0.22, "doc"], [13, 0.38, "tool call"], [15, 0.55, "calendar"]];

/* --------------------------------------------------------------- memory field */
const MF: P = [900, 268];
const COLS = 8, ROWS = 6;
const HOT = new Set(["2,1", "5,3", "6,1"]);

function MemoryField() {
  const base = box(0, 0, 0, COLS * 40 + 14, ROWS * 36 + 14, 7, MF);
  const towers: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) towers.push({ i, j });
  towers.sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);
  return (
    <g>
      <Box f={base} className="platform" />
      {/* scope districts: hairlines on the platform */}
      {[2, 4, 6].map((i) => {
        const a = project(10 + i * 40, 4, 7, MF), b = project(10 + i * 40, ROWS * 36 + 10, 7, MF);
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="district" />;
      })}
      {towers.map(({ i, j }) => {
        const levels = 2 + Math.floor(rand(i * 13 + j * 7) * 5);
        const hot = HOT.has(`${i},${j}`);
        return (
          <g key={`${i}-${j}`}>
            {Array.from({ length: levels }, (_, l) => (
              <Box key={l} f={box(12 + i * 40, 12 + j * 36, 7 + l * 5.2, 26, 22, 3.6, MF)} tone={hot && l === levels - 1 ? "clay" : "line"} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function liftAt(i: number, j: number, z: number): P {
  return project(25 + i * 40, 23 + j * 36, z, MF);
}

/* --------------------------------------------------------------- scene */
export function HeroScene() {
  const motion = useMotion();
  const fl = flows();
  const lifts = [...HOT].map((s) => s.split(",").map(Number) as [number, number]);
  const gate: P = [1214, 232];
  const lifted = lifts.map(([i, j]) => ({ top: liftAt(i, j, 112), base: liftAt(i, j, 7 + 6 * 5.2) }));
  const learnerOut = project(LW, LD * 0.45, LH * 0.62, LB);

  return (
    <svg className="hero-scene" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Scattered inputs and a user query flow into the Everstate box, which lifts the relevant memories and hands a cited answer to the agent">
      <defs>
        {fl.filter((f) => f.hot).map((f) => <path key={f.id} id={f.id} d={f.d} />)}
        <path id="flow-query" d={`M232,138 C 360,138 420,214 ${ENTRY(9)[0]},${ENTRY(9)[1]}`} />
        <path id="flow-out" d={`M${learnerOut[0]},${learnerOut[1]} C 760,150 900,120 ${lifted[0].top[0]},${lifted[0].top[1]}`} />
      </defs>

      {/* input streams */}
      {fl.map((f) => <path key={f.id} d={f.d} className={f.hot ? "stream stream-hot" : "stream"} />)}
      {fl.map((f, n) => [0.18, 0.42, 0.66].map((t, m) => {
        if (rand(n * 5 + m) < 0.35) return null;
        return <Fragment key={`${n}-${m}`} at={cubic(...f.p, t + (rand(n + m) - 0.5) * 0.08)} k={n * 7 + m} hot={f.hot && m === 1} />;
      }))}
      {GLYPHS.map(([n, t, label]) => {
        const [x, y] = cubic(...fl[n].p, t);
        return <text key={label} x={x + 12} y={y - 9} className="tag">{label}</text>;
      })}

      {/* the user query */}
      <path d={`M232,138 C 360,138 420,214 ${ENTRY(9)[0]},${ENTRY(9)[1]}`} className="stream stream-query" />
      <g className="query-card">
        <rect x="24" y="96" width="210" height="84" rx="10" />
        <text x="40" y="120" className="tag tag-clay">user query</text>
        <text x="40" y="146" className="q-text">“Plan a team lunch</text>
        <text x="40" y="166" className="q-text">with Ada next week.”</text>
      </g>

      <Learner />

      {/* learner → memory */}
      <path d={`M${learnerOut[0]},${learnerOut[1]} C 760,150 900,120 ${lifted[0].top[0]},${lifted[0].top[1]}`} className="stream stream-hot" />

      <MemoryField />

      {/* recalled memories lift out of the field */}
      {lifted.map(({ top, base }, n) => (
        <g key={n} className={`lift lift-${n}`}>
          <line x1={top[0]} y1={top[1]} x2={base[0]} y2={base[1]} className="drop" />
          <Box f={box(0, 0, 0, 26, 22, 4, [top[0] - 3.5, top[1] - 21])} tone="clay" />
        </g>
      ))}
      <path d={`M${lifted[0].top[0]},${lifted[0].top[1]} Q ${(lifted[0].top[0] + lifted[2].top[0]) / 2},${lifted[0].top[1] - 40} ${lifted[2].top[0]},${lifted[2].top[1]}`} className="arc" />
      <path d={`M${lifted[2].top[0]},${lifted[2].top[1]} Q ${(lifted[2].top[0] + lifted[1].top[0]) / 2},${lifted[1].top[1] - 46} ${lifted[1].top[0]},${lifted[1].top[1]}`} className="arc" />
      <path d={`M${lifted[1].top[0]},${lifted[1].top[1]} L ${gate[0]},${gate[1] + 34}`} className="arc" />

      {/* context gate + context row */}
      <polygon points={poly([[gate[0], gate[1]], [gate[0] + 26, gate[1] - 15], [gate[0] + 26, gate[1] + 50], [gate[0], gate[1] + 65]])} className="gate" />
      {[0, 1, 2].map((n) => (
        <Box key={n} f={box(0, 0, 0, 22, 14, 4, [gate[0] + 44 + n * 30, gate[1] + 26 - n * 2])} tone="clay" className={`ctx ctx-${n}`} />
      ))}

      {/* the agent answers, with citations */}
      <g className="agent-card">
        <rect x="1100" y="28" width="288" height="148" rx="12" />
        <text x="1118" y="54" className="tag">agent · answer</text>
        <text x="1118" y="80" className="a-text">Booked Verde, Thursday 12:30.</text>
        <text x="1118" y="102" className="a-text">Ada is vegetarian and keeps</text>
        <text x="1118" y="124" className="a-text">afternoons for deep work.</text>
        <rect x="1118" y="142" width="96" height="20" rx="10" className="cite" />
        <text x="1128" y="156" className="cite-t">s-101 · diet</text>
        <rect x="1220" y="142" width="122" height="20" rx="10" className="cite" />
        <text x="1230" y="156" className="cite-t">s-117 · schedule</text>
      </g>
      <path d={`M${gate[0] + 128},${gate[1] + 18} C 1370,${gate[1] + 10} 1380,210 1330,176`} className="stream stream-hot" />

      {/* stage labels */}
      {[[24, "input"], [470, "everstate · learner"], [900, "memory · org ▸ team ▸ user ▸ session"], [1180, "context → agent"]].map(([x, l]) => (
        <text key={String(l)} x={Number(x)} y={H - 14} className="stage">{l}</text>
      ))}

      {motion && (
        <g className="packets">
          {fl.filter((f) => f.hot).concat([{ id: "flow-query" } as Flow, { id: "flow-out" } as Flow]).map((f, n) => (
            <rect key={f.id} width="9" height="4" rx="1" x="-4.5" y="-2" className="packet">
              <animateMotion dur={`${3.2 + n * 0.5}s`} begin={`${n * 0.7}s`} repeatCount="indefinite" rotate="auto">
                <mpath href={`#${f.id}`} />
              </animateMotion>
            </rect>
          ))}
        </g>
      )}
    </svg>
  );
}
