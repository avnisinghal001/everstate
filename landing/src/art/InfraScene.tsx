/**
 * Infrastructure diagram: the Everstate engine (black box) with its Google Cloud
 * backends on one side and bring-your-own backends on the other. Line-art isometric.
 */
import { box, poly, type P } from "./geometry";

function Bx({ o, w, d, h, tone = "line" }: { o: P; w: number; d: number; h: number; tone?: "line" | "ink" | "clay" }) {
  const f = box(0, 0, 0, w, d, h, o);
  return (
    <g className={`bx bx-${tone}`}>
      <polygon className="f-left" points={poly(f.left)} />
      <polygon className="f-right" points={poly(f.right)} />
      <polygon className="f-top" points={poly(f.top)} />
    </g>
  );
}

const GCP: Array<[string, string, P]> = [
  ["Cloud Spanner", "system of record · ANN", [250, 70]],
  ["Memorystore", "serving tier · cache", [250, 190]],
  ["BigQuery", "event log · analytics", [250, 310]],
  ["Vertex AI", "embeddings · Gemini", [410, 380]],
];
const BYO: Array<[string, string, P]> = [
  ["Redis 8 / Valkey", "everything in one", [820, 70]],
  ["Qdrant · Pinecone", "managed vectors", [820, 190]],
  ["Firestore", "serverless store", [820, 310]],
  ["Ollama", "local EmbeddingGemma", [680, 380]],
];
const CORE: P = [560, 150];

export function InfraScene() {
  const core: P = [CORE[0] + 10, CORE[1] + 60];
  return (
    <svg viewBox="0 0 1120 470" role="img" aria-label="Everstate engine connected to Google Cloud and other backends">
      {[...GCP, ...BYO].map(([n, , o], i) => (
        <path key={n} d={`M${core[0]},${core[1]} C ${(core[0] + o[0]) / 2},${core[1]} ${(core[0] + o[0]) / 2},${o[1] + 20} ${o[0] + (o[0] < core[0] ? 70 : -10)},${o[1] + 20}`}
          className={`wire ${i < GCP.length ? "wire-hot" : ""}`} />
      ))}
      {[...GCP, ...BYO].map(([n, r, o], i) => (
        <g key={n}>
          <Bx o={[o[0] + 28, o[1] - 6]} w={44} d={30} h={14} tone={i < GCP.length ? "clay" : "line"} />
          <text x={o[0] + (o[0] < CORE[0] ? -24 : 76)} y={o[1] + 14} textAnchor={o[0] < CORE[0] ? "end" : "start"} className="n">{n}</text>
          <text x={o[0] + (o[0] < CORE[0] ? -24 : 76)} y={o[1] + 30} textAnchor={o[0] < CORE[0] ? "end" : "start"} className="r">{r}</text>
        </g>
      ))}
      <Bx o={CORE} w={70} d={60} h={96} tone="ink" />
      <text x={CORE[0] + 6} y={CORE[1] + 170} textAnchor="middle" className="n">Everstate engine</text>
      <text x={CORE[0] + 6} y={CORE[1] + 186} textAnchor="middle" className="r">7 ports · pipelines · laws</text>
      <text x="40" y="455" className="r">GOOGLE CLOUD (profile = gcp)</text>
      <text x="1080" y="455" textAnchor="end" className="r">BRING YOUR OWN (profile = redis · local)</text>
    </svg>
  );
}
