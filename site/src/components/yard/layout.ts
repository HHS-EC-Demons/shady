import type { Campus, Patch } from '@/engine/campus';
import { boxOf, insideRing, ringArea, ringDistance, type Box, type Point, type Ring } from '@/engine/geometry';

export type OrientedBox = { x: number; y: number; ux: number; uy: number; long: number; short: number };
export type Area = OrientedBox & { ring: Ring };
export type Spot = { x: number; y: number; heading: number };

export const FIELD_SPORTS = ['Football field', 'Soccer field', 'Field'];
export const BAY = 18.3;
export const STALL = 2.75;
export const STALL_DEPTH = 5.5;
export const STALL_LIMIT = 1500;
export const POLE_GAP = 27.5;
export const WALKER_GAP = 26;
export const WALKER_SIDE = 0.6;
export const WALKER_LIMIT = 40;

export function tidy(ring: Ring): Ring {
  const kept: Point[] = [];
  for (const point of ring) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-3) kept.push(point);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (kept.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-3) kept.pop();
  return kept;
}

export function orientedBox(ring: Ring): OrientedBox {
  const points = tidy(ring);
  let best = 0;
  let ux = 1;
  let uy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > best) {
      best = length;
      ux = (bx - ax) / length;
      uy = (by - ay) / length;
    }
  }
  let lowU = Infinity;
  let highU = -Infinity;
  let lowV = Infinity;
  let highV = -Infinity;
  for (const [x, y] of points) {
    const u = x * ux + y * uy;
    const v = -x * uy + y * ux;
    lowU = Math.min(lowU, u);
    highU = Math.max(highU, u);
    lowV = Math.min(lowV, v);
    highV = Math.max(highV, v);
  }
  const midU = (lowU + highU) / 2;
  const midV = (lowV + highV) / 2;
  return { x: midU * ux - midV * uy, y: midU * uy + midV * ux, ux, uy, long: highU - lowU, short: highV - lowV };
}

export function along(box: OrientedBox, u: number, v: number): Point {
  return [box.x + u * box.ux - v * box.uy, box.y + u * box.uy + v * box.ux];
}

export function axisHeading(box: OrientedBox): number {
  return Math.atan2(box.uy, box.ux);
}

type Lot = { stalls: Spot[]; spines: [Point, Point][] };

function lotOf(patch: Patch): Lot {
  const stalls: Spot[] = [];
  const spines: [Point, Point][] = [];
  const ring = tidy(patch.ring);
  if (ring.length < 3 || ringArea(ring) < 1e-6) return { stalls, spines };
  const box = orientedBox(ring);
  const fits = (point: Point) => insideRing(ring, point[0], point[1]) && ringDistance(ring, point[0], point[1]) >= 1;
  const bays = Math.max(1, Math.round(box.short / BAY));
  const firstV = (-(bays - 1) / 2) * BAY;
  const extra = Math.ceil(box.short / BAY) + 1;
  const count = Math.max(1, Math.ceil(box.long / STALL));
  const firstU = (-count / 2) * STALL;
  const ways = [-1, 1];
  let drawn = 0;
  for (let bay = -extra; bay < bays + extra && drawn < STALL_LIMIT; bay += 1) {
    const v = firstV + bay * BAY;
    if (Math.abs(v) > box.short / 2 + STALL_DEPTH) continue;
    const painted = ways.map(() => new Uint8Array(count + 1));
    let run: Point | null = null;
    let runEnd: Point | null = null;
    for (let index = 0; index <= count; index += 1) {
      const u = firstU + index * STALL;
      const base = along(box, u, v);
      const good = fits(base);
      if (good && drawn < STALL_LIMIT) {
        for (let side = 0; side < ways.length; side += 1) {
          if (drawn >= STALL_LIMIT) break;
          if (!fits(along(box, u, v + ways[side] * STALL_DEPTH))) continue;
          painted[side][index] = 1;
          drawn += 1;
        }
      }
      if (good) {
        if (!run) run = base;
        runEnd = base;
      }
      if ((!good || index === count) && run && runEnd) {
        if (run !== runEnd) spines.push([run, runEnd]);
        run = null;
        runEnd = null;
      }
    }
    ways.forEach((way, side) => {
      const heading = Math.atan2(way * box.ux, -way * box.uy);
      for (let index = 0; index < count; index += 1) {
        if (!painted[side][index] || !painted[side][index + 1]) continue;
        const [x, y] = along(box, firstU + index * STALL + STALL / 2, v + (way * STALL_DEPTH) / 2);
        stalls.push({ x, y, heading });
      }
    });
  }
  return { stalls, spines };
}

function lots(campus: Campus): Lot[] {
  return campus.patches.filter((patch) => patch.surface !== 'court' && !FIELD_SPORTS.includes(patch.label ?? '') && patch.label === 'Parking lot').map(lotOf);
}

export function parkingStalls(campus: Campus): Spot[] {
  return lots(campus).flatMap((lot) => lot.stalls);
}

function spaced(from: Point, to: Point, gap: number): Spot[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [];
  const heading = Math.atan2(dy, dx);
  const count = Math.floor(length / gap) + 1;
  const start = (length - (count - 1) * gap) / 2;
  const result: Spot[] = [];
  for (let step = 0; step < count; step += 1) {
    const share = (start + step * gap) / length;
    result.push({ x: from[0] + dx * share, y: from[1] + dy * share, heading });
  }
  return result;
}

export function lightPoles(campus: Campus): Spot[] {
  return lots(campus).flatMap((lot) => lot.spines.flatMap(([from, to]) => spaced(from, to, POLE_GAP)));
}

function areas(campus: Campus, keep: (patch: Patch) => boolean): Area[] {
  return campus.patches.filter((patch) => keep(patch) && tidy(patch.ring).length >= 3).map((patch) => ({ ...orientedBox(patch.ring), ring: patch.ring }));
}

export function courts(campus: Campus): Area[] {
  return areas(campus, (patch) => patch.surface === 'court');
}

export function fields(campus: Campus): Area[] {
  return areas(campus, (patch) => patch.surface !== 'court' && FIELD_SPORTS.includes(patch.label ?? ''));
}

export function bandPads(campus: Campus): Area[] {
  return areas(campus, (patch) => patch.label === 'Band pad');
}

export function thin<T>(list: T[], limit: number): T[] {
  if (list.length <= limit) return list;
  const kept: T[] = [];
  for (let index = 0; index < limit; index += 1) kept.push(list[Math.floor((index * list.length) / limit)]);
  return kept;
}

export function walkers(campus: Campus, keep: (x: number, y: number) => boolean = () => true): Spot[] {
  const found: Spot[] = [];
  for (const strip of campus.strips) {
    if (strip.label !== 'Walkway') continue;
    const points = strip.line;
    let walked = 0;
    let next = WALKER_GAP / 2;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      while (next <= walked + length) {
        const at = next - walked;
        const x = ax + ux * at - uy * WALKER_SIDE;
        const y = ay + uy * at + ux * WALKER_SIDE;
        if (keep(x, y)) found.push({ x, y, heading: Math.atan2(uy, ux) });
        next += WALKER_GAP;
      }
      walked += length;
    }
  }
  return thin(found, WALKER_LIMIT);
}

const BOX_SLACK = 1e-6;
const ringBoxes = new WeakMap<Ring, Box>();

function ringBox(ring: Ring): Box {
  let box = ringBoxes.get(ring);
  if (!box) {
    box = boxOf([ring]);
    ringBoxes.set(ring, box);
  }
  return box;
}

export function onRoof(campus: Campus, x: number, y: number): boolean {
  return campus.blocks.some((block) => {
    const box = ringBox(block.ring);
    if (y < box.minY || y >= box.maxY || x < box.minX - BOX_SLACK || x > box.maxX + BOX_SLACK) return false;
    return insideRing(block.ring, x, y);
  });
}
