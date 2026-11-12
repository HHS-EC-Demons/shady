export type Point = [number, number];
export type Ring = Point[];
export type Box = { minX: number; maxX: number; minY: number; maxY: number };

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function lerp(a: number, b: number, share: number): number {
  return a + (b - a) * share;
}

export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
}

export function insideRing(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

export function boxOf(rings: Ring[]): Box {
  const box: Box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

export function grow(box: Box, by: number): Box {
  return { minX: box.minX - by, maxX: box.maxX + by, minY: box.minY - by, maxY: box.maxY + by };
}

export function centerOf(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}

export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const share = length > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * share), py - (ay + dy * share));
}

export function ringDistance(ring: Ring, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    best = Math.min(best, segmentDistance(x, y, ax, ay, bx, by));
  }
  return best;
}
