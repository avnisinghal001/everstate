/**
 * Isometric geometry for the line-art illustrations.
 * World (x, y, z) → screen with the classic 30° projection:
 *   sx = ox + (x − y)·cos30°,  sy = oy + (x + y)·sin30° − z
 * x runs down-right, y runs down-left, z is up.
 */
export type P = [number, number];

export const COS = Math.cos(Math.PI / 6);
export const SIN = 0.5;

export function project(x: number, y: number, z: number, o: P): P {
  return [o[0] + (x - y) * COS, o[1] + (x + y) * SIN - z];
}

export const poly = (ps: P[]) => ps.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

export interface BoxFaces {
  top: P[];
  left: P[];   // the face at y + d (faces down-left)
  right: P[];  // the face at x + w (faces down-right)
}

export function box(x: number, y: number, z: number, w: number, d: number, h: number, o: P): BoxFaces {
  const p = (X: number, Y: number, Z: number) => project(X, Y, Z, o);
  return {
    top: [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)],
    left: [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)],
    right: [p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)],
  };
}

/** Point on a cubic Bézier. */
export function cubic(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Deterministic pseudo-random in [0, 1) so illustrations are identical on every render. */
export function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
