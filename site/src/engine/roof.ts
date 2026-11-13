import type { Campus } from './campus';

type Flat = [number, number][];

export type RoofUnit = { block: number; x: number; y: number; ux: number; uy: number; long: number; wide: number; tall: number; fans: number };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function inside(ring: Flat, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function nearEdge(ring: Flat, x: number, y: number, limit: number): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / span) : 0;
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < limit) return true;
  }
  return false;
}

function tidy(ring: Flat): Flat {
  const out: Flat = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-6) out.push(point);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

export function roofUnits(rings: Flat[]): RoofUnit[] {
  const units: RoofUnit[] = [];
  rings.forEach((raw, block) => {
    const ring = tidy(raw);
    if (ring.length < 3) return;
    let twice = 0;
    let sumX = 0;
    let sumY = 0;
    let longest = 0;
    let ux = 1;
    let uy = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const cross = ax * by - bx * ay;
      twice += cross;
      sumX += (ax + bx) * cross;
      sumY += (ay + by) * cross;
      const length = Math.hypot(bx - ax, by - ay);
      if (length > longest) {
        longest = length;
        ux = (bx - ax) / length;
        uy = (by - ay) / length;
      }
    }
    const area = Math.abs(twice) / 2;
    if (area < 500) return;
    const wanted = Math.min(14, Math.max(1, Math.round(area / 700)));
    const midX = Math.abs(twice) > 1e-9 ? sumX / (3 * twice) : ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
    const midY = Math.abs(twice) > 1e-9 ? sumY / (3 * twice) : ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    const vx = -uy;
    const vy = ux;
    let lowU = Infinity;
    let highU = -Infinity;
    let lowV = Infinity;
    let highV = -Infinity;
    for (const [x, y] of ring) {
      const u = (x - midX) * ux + (y - midY) * uy;
      const v = (x - midX) * vx + (y - midY) * vy;
      lowU = Math.min(lowU, u);
      highU = Math.max(highU, u);
      lowV = Math.min(lowV, v);
      highV = Math.max(highV, v);
    }
    const random = seeded(Math.round(area * 13) ^ Math.round(ring[0][0] * 97) ^ Math.round(ring[0][1] * 31));
    const stepU = 7;
    const stepV = 5.5;
    const columns = Math.floor((highU - lowU) / stepU);
    const rows = Math.floor((highV - lowV) / stepV);
    const startU = (lowU + highU) / 2 - (columns * stepU) / 2;
    const startV = (lowV + highV) / 2 - (rows * stepV) / 2;
    type Option = { u: number; v: number; long: number; wide: number; tall: number; fans: number; rank: number };
    const options: Option[] = [];
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const long = 2 + random() * 2;
        const wide = 1.5 + random() * 1;
        const tall = 1 + random() * 0.6;
        const fans = long > 3.1 ? 2 : random() > 0.45 ? 1 : 0;
        const u = startU + column * stepU + (random() - 0.5) * 1.2;
        const v = startV + row * stepV + (random() - 0.5) * 0.6;
        let fits = true;
        probing: for (const su of [-1, 0, 1]) {
          for (const sv of [-1, 0, 1]) {
            const pu = u + su * long * 0.5;
            const pv = v + sv * wide * 0.5;
            const x = midX + pu * ux + pv * vx;
            const y = midY + pu * uy + pv * vy;
            if (!inside(ring, x, y) || nearEdge(ring, x, y, 4)) {
              fits = false;
              break probing;
            }
          }
        }
        if (fits) options.push({ u, v, long, wide, tall, fans, rank: Math.hypot(u, v * 1.4) + random() * 2 });
      }
    }
    options.sort((a, b) => a.rank - b.rank);
    for (const unit of options.slice(0, wanted)) {
      units.push({ block, x: midX + unit.u * ux + unit.v * vx, y: midY + unit.u * uy + unit.v * vy, ux, uy, long: unit.long, wide: unit.wide, tall: unit.tall, fans: unit.fans });
    }
  });
  return units;
}

export function roofOf(campus: Campus): RoofUnit[] {
  return roofUnits(campus.blocks.filter((block) => block.home).map((block) => (block.stand || (block.roof && block.roof !== 'flat') ? [] : block.ring)));
}
