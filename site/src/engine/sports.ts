import type { Campus, Edge, Patch } from './campus';
import { insideRing, ringArea, segmentDistance, type Point, type Ring } from './geometry';

export type Frame = { cx: number; cy: number; ux: number; uy: number; long: number; short: number };
export type Mark = { points: Point[]; closed: boolean; half: number };
export type GearKind = 'tennis net' | 'hoop' | 'volley net' | 'pickle net' | 'soccer goal' | 'uprights' | 'backstop';
export type Gear = { kind: GearKind; x: number; y: number; heading: number; size: number };
export type Layout = { marks: Mark[]; gear: Gear[] };
export type Diamond = { home: Point; toward: Point; first: Point; third: Point; base: number; pitch: number; sport: 'baseball' | 'softball'; behind: number };

const DRAWN = ['tennis', 'basketball', 'volleyball', 'pickleball', 'soccer', 'american_football', 'baseball', 'softball'];
const ALIAS: Record<string, string> = { football: 'soccer', beachvolleyball: 'volleyball', 'association_football': 'soccer' };
const OTHERS = [
  'skateboard',
  'handball',
  'futsal',
  'netball',
  'padel',
  'squash',
  'racquet',
  'cricket',
  'rugby',
  'rugby_union',
  'rugby_league',
  'lacrosse',
  'field_hockey',
  'hockey',
  'multi',
  'athletics',
  'running',
  'gaelic_games',
  'australian_football',
  'golf',
  'table_tennis',
  'badminton',
  'four_square',
  'shuffleboard',
  'boules',
  'marching_band',
  'kickball',
  'ultimate',
];
const LABELS: Record<string, string> = {
  'Tennis court': 'tennis',
  'Basketball court': 'basketball',
  'Volleyball court': 'volleyball',
  'Pickleball court': 'pickleball',
  'Soccer field': 'soccer',
  'Football field': 'american_football',
};
const COURT_HALF = 0.04;
const FIELD_HALF = 0.06;
const HEAVY_HALF = 0.075;
const BASE_HALF = 0.05;
const ARC_STEP = Math.PI / 24;
const FEET = 0.3048;

export function sportOf(value: string | undefined): string | undefined {
  const list = (value ?? '')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .map((item) => ALIAS[item] ?? item)
    .filter((item) => item !== '');
  if (list.includes('american_football')) return 'american_football';
  return list.find((item) => DRAWN.includes(item) || OTHERS.includes(item));
}

export function playedOn(patch: Patch): string | undefined {
  if (patch.sport) return patch.sport;
  return LABELS[patch.label ?? ''];
}

export function drawn(sport: string | undefined): boolean {
  return sport !== undefined && DRAWN.includes(sport);
}

function tidy(ring: Ring): Point[] {
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

export function frameOf(ring: Ring): Frame {
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
  return { cx: midU * ux - midV * uy, cy: midU * uy + midV * ux, ux, uy, long: highU - lowU, short: highV - lowV };
}

export function at(frame: Frame, u: number, v: number): Point {
  return [frame.cx + u * frame.ux - v * frame.uy, frame.cy + u * frame.uy + v * frame.ux];
}

function heading(frame: Frame, flip = false): number {
  const angle = Math.atan2(frame.uy, frame.ux);
  return flip ? angle + Math.PI : angle;
}

function rect(frame: Frame, u0: number, v0: number, u1: number, v1: number, half: number): Mark {
  return { points: [at(frame, u0, v0), at(frame, u1, v0), at(frame, u1, v1), at(frame, u0, v1)], closed: true, half };
}

function line(frame: Frame, u0: number, v0: number, u1: number, v1: number, half: number): Mark {
  return { points: [at(frame, u0, v0), at(frame, u1, v1)], closed: false, half };
}

function arc(frame: Frame, u: number, v: number, radius: number, from: number, to: number, half: number): Mark {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP));
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    points.push(at(frame, u + Math.cos(angle) * radius, v + Math.sin(angle) * radius));
  }
  const full = Math.abs(Math.abs(to - from) - Math.PI * 2) < 1e-6;
  if (full) points.pop();
  return { points, closed: full, half };
}

function circle(frame: Frame, u: number, v: number, radius: number, half: number): Mark {
  return arc(frame, u, v, radius, 0, Math.PI * 2, half);
}

function tennis(frame: Frame): Layout | null {
  const half = Math.min(11.89, frame.long / 2 - 2.5);
  const side = Math.min(5.49, frame.short / 2 - 1.5);
  if (half < 4 || side < 2) return null;
  const single = side * 0.75;
  const service = half * 0.54;
  const marks = [
    rect(frame, -half, -side, half, side, COURT_HALF),
    line(frame, 0, -side, 0, side, COURT_HALF),
    line(frame, -half, -single, half, -single, COURT_HALF),
    line(frame, -half, single, half, single, COURT_HALF),
    line(frame, -service, -single, -service, single, COURT_HALF),
    line(frame, service, -single, service, single, COURT_HALF),
    line(frame, -service, 0, service, 0, COURT_HALF),
  ];
  const width = Math.min(12.8, 2 * (side + 0.914));
  return { marks, gear: [{ kind: 'tennis net', ...point(frame, 0, 0), heading: heading(frame), size: width / 12.8 }] };
}

function point(frame: Frame, u: number, v: number): { x: number; y: number } {
  const [x, y] = at(frame, u, v);
  return { x, y };
}

function basketball(frame: Frame): Layout | null {
  const length = 25.6;
  const width = 15.24;
  const halfCourt = frame.long < 18;
  const roomLong = frame.long - 2;
  const roomShort = frame.short - 2;
  const scale = Math.min(1, roomShort / width, halfCourt ? roomLong / 9 : roomLong / length);
  if (scale < 0.45) return null;
  const w = (width / 2) * scale;
  const marks: Mark[] = [];
  const gear: Gear[] = [];
  const end = (sign: number, baseline: number) => {
    const basket = baseline - sign * 1.6 * scale;
    const free = baseline - sign * 5.79 * scale;
    const lane = 1.83 * scale;
    const radius = 6.02 * scale;
    marks.push({ points: [at(frame, baseline, -lane), at(frame, free, -lane), at(frame, free, lane), at(frame, baseline, lane)], closed: false, half: COURT_HALF });
    marks.push(circle(frame, free, 0, 1.83 * scale, COURT_HALF));
    const inward = sign > 0 ? Math.PI : 0;
    const three = arc(frame, basket, 0, radius, inward - Math.PI / 2, inward + Math.PI / 2, COURT_HALF);
    marks.push({ points: [at(frame, baseline, radius * Math.sin(inward - Math.PI / 2)), ...three.points, at(frame, baseline, radius * Math.sin(inward + Math.PI / 2))], closed: false, half: COURT_HALF });
    gear.push({ kind: 'hoop', ...point(frame, baseline + sign * 0.6, 0), heading: heading(frame, sign > 0), size: 1 });
  };
  if (halfCourt) {
    const near = -frame.long / 2 + 1;
    const far = frame.long / 2 - 1;
    marks.push(rect(frame, near, -w, far, w, COURT_HALF));
    end(-1, near);
  } else {
    const h = (length / 2) * scale;
    marks.push(rect(frame, -h, -w, h, w, COURT_HALF));
    marks.push(line(frame, 0, -w, 0, w, COURT_HALF));
    marks.push(circle(frame, 0, 0, 1.83 * scale, COURT_HALF));
    end(-1, -h);
    end(1, h);
  }
  return { marks, gear };
}

function volleyball(frame: Frame): Layout | null {
  const scale = Math.min(1, (frame.long - 2) / 18, (frame.short - 2) / 9);
  if (scale < 0.5) return null;
  const h = 9 * scale;
  const w = 4.5 * scale;
  const attack = 3 * scale;
  return {
    marks: [rect(frame, -h, -w, h, w, COURT_HALF), line(frame, 0, -w, 0, w, COURT_HALF), line(frame, -attack, -w, -attack, w, COURT_HALF), line(frame, attack, -w, attack, w, COURT_HALF)],
    gear: [{ kind: 'volley net', ...point(frame, 0, 0), heading: heading(frame), size: scale }],
  };
}

function pickleball(frame: Frame): Layout | null {
  const scale = Math.min(1, (frame.long - 2) / 13.41, (frame.short - 2) / 6.1);
  if (scale < 0.6) return null;
  const h = 6.705 * scale;
  const w = 3.05 * scale;
  const kitchen = 2.13 * scale;
  return {
    marks: [
      rect(frame, -h, -w, h, w, COURT_HALF),
      line(frame, 0, -w, 0, w, COURT_HALF),
      line(frame, -kitchen, -w, -kitchen, w, COURT_HALF),
      line(frame, kitchen, -w, kitchen, w, COURT_HALF),
      line(frame, -h, 0, -kitchen, 0, COURT_HALF),
      line(frame, kitchen, 0, h, 0, COURT_HALF),
    ],
    gear: [{ kind: 'pickle net', ...point(frame, 0, 0), heading: heading(frame), size: scale }],
  };
}

function soccer(frame: Frame): Layout | null {
  const length = Math.min(frame.long - 2, 110);
  const width = Math.min(frame.short - 2, 70);
  if (length < 30 || width < 18) return null;
  const scale = Math.min(1, length / 100, width / 64);
  const h = length / 2;
  const w = width / 2;
  const marks: Mark[] = [rect(frame, -h, -w, h, w, FIELD_HALF), line(frame, 0, -w, 0, w, FIELD_HALF), circle(frame, 0, 0, 9.15 * scale, FIELD_HALF), circle(frame, 0, 0, 0.12, 0.08)];
  const gear: Gear[] = [];
  for (const sign of [-1, 1]) {
    const goal = sign * h;
    const box = Math.min(20.16 * scale, w - 1);
    const small = Math.min(9.16 * scale, w - 1);
    const deep = 16.5 * scale;
    const spot = goal - sign * 11 * scale;
    marks.push({ points: [at(frame, goal, -box), at(frame, goal - sign * deep, -box), at(frame, goal - sign * deep, box), at(frame, goal, box)], closed: false, half: FIELD_HALF });
    marks.push({ points: [at(frame, goal, -small), at(frame, goal - sign * 5.5 * scale, -small), at(frame, goal - sign * 5.5 * scale, small), at(frame, goal, small)], closed: false, half: FIELD_HALF });
    marks.push(circle(frame, spot, 0, 0.11, 0.08));
    const reach = Math.acos(Math.min(1, (16.5 - 11) / 9.15));
    const inward = sign > 0 ? Math.PI : 0;
    marks.push(arc(frame, spot, 0, 9.15 * scale, inward - reach, inward + reach, FIELD_HALF));
    for (const side of [-1, 1]) {
      const from = Math.atan2(0, -sign);
      let turn = Math.atan2(-side, 0) - from;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn <= -Math.PI) turn += Math.PI * 2;
      marks.push(arc(frame, goal, side * w, 1 * scale, from, from + turn, FIELD_HALF));
    }
    gear.push({ kind: 'soccer goal', ...point(frame, goal, 0), heading: heading(frame, sign > 0), size: Math.max(0.65, scale) });
  }
  return { marks, gear };
}

function football(frame: Frame): Layout | null {
  const length = 109.73;
  const width = 48.77;
  const scale = Math.min(1, (frame.long - 1) / length, (frame.short - 1) / width);
  if (scale < 0.4) return null;
  const h = (length / 2) * scale;
  const w = (width / 2) * scale;
  const goal = 45.72 * scale;
  const yard = 0.9144 * scale;
  const marks: Mark[] = [rect(frame, -h, -w, h, w, HEAVY_HALF), line(frame, -goal, -w, -goal, w, HEAVY_HALF), line(frame, goal, -w, goal, w, HEAVY_HALF)];
  for (let step = -9; step <= 9; step += 1) {
    const u = step * 5 * yard;
    marks.push(line(frame, u, -w, u, w, step % 2 === 0 ? HEAVY_HALF : FIELD_HALF));
  }
  const hash = w - 16.26 * scale;
  const tick = 0.61 * scale;
  for (let mark = -49; mark <= 49; mark += 1) {
    if (mark % 5 === 0) continue;
    const u = mark * yard;
    for (const row of [-hash, hash]) marks.push(line(frame, u, row - tick / 2, u, row + tick / 2, 0.05));
    for (const edge of [-1, 1]) marks.push(line(frame, u, edge * (w - 0.3 * scale), u, edge * (w - 0.3 * scale - tick), 0.05));
  }
  return {
    marks,
    gear: [
      { kind: 'uprights', ...point(frame, -h, 0), heading: heading(frame), size: 1 },
      { kind: 'uprights', ...point(frame, h, 0), heading: heading(frame), size: 1 },
    ],
  };
}

function oldField(frame: Frame): Layout | null {
  const half = Math.min(frame.long / 2 - 1, 54.86);
  const side = Math.min(frame.short / 2 - 1, 24.38);
  if (half < 20 || side < 10) return null;
  const marks: Mark[] = [rect(frame, -half, -side, half, side, 0.07)];
  const steps = Math.floor(half / 9.144);
  for (let step = -steps; step <= steps; step += 1) {
    const u = step * 9.144;
    if (Math.abs(u) < half - 0.01) marks.push(line(frame, u, -side, u, side, 0.07));
  }
  return {
    marks,
    gear: [
      { kind: 'uprights', ...point(frame, -half, 0), heading: heading(frame), size: 1 },
      { kind: 'uprights', ...point(frame, half, 0), heading: heading(frame), size: 1 },
    ],
  };
}

function simplify(ring: Ring): Point[] {
  let points = tidy(ring);
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[i];
      const c = points[(i + 1) % points.length];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const vx = c[0] - b[0];
      const vy = c[1] - b[1];
      const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
      if (turn < (8 * Math.PI) / 180) {
        points = [...points.slice(0, i), ...points.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return points;
}

function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

export function homeCorners(ring: Ring): { at: Point; along: Point; back: Point }[] {
  const points = simplify(ring);
  const count = points.length;
  if (count < 3 || ringArea(points) < 400) return [];
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % count];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const sorted = [...lengths].sort((a, b) => b - a);
  const second = sorted[1] ?? 0;
  const least = Math.max(18, second * 0.9);
  const gap = Math.max(25, second * 0.3);
  const turning = Math.sign(signedArea(points));
  const long = lengths.map((length) => length >= least);
  const found: { at: Point; along: Point; back: Point }[] = [];
  for (let a = 0; a < count; a += 1) {
    if (!long[a]) continue;
    let b = (a + 1) % count;
    let between = 0;
    while (!long[b] && b !== a) {
      between += lengths[b];
      b = (b + 1) % count;
    }
    if (b === a || between > gap) continue;
    const a0 = points[a];
    const a1 = points[(a + 1) % count];
    const b0 = points[b];
    const b1 = points[(b + 1) % count];
    const ux = (a1[0] - a0[0]) / lengths[a];
    const uy = (a1[1] - a0[1]) / lengths[a];
    const vx = (b1[0] - b0[0]) / lengths[b];
    const vy = (b1[1] - b0[1]) / lengths[b];
    const cross = ux * vy - uy * vx;
    if (Math.sign(cross) !== turning || Math.abs(cross) < 1e-6) continue;
    const angle = (Math.acos(Math.max(-1, Math.min(1, -(ux * vx + uy * vy)))) * 180) / Math.PI;
    if (angle < 70 || angle > 110) continue;
    const t = ((b0[0] - a0[0]) * vy - (b0[1] - a0[1]) * vx) / cross;
    const corner: Point = [a0[0] + ux * t, a0[1] + uy * t];
    found.push({ at: corner, along: [vx, vy], back: [-ux, -uy] });
  }
  return found;
}

function crossing(ring: Ring, from: Point, direction: Point, after: number): { t: number; edge: Point } | null {
  const points = tidy(ring);
  let best: { t: number; edge: Point } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = direction[0] * ey - direction[1] * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    const t = ((ax - from[0]) * ey - (ay - from[1]) * ex) / denominator;
    const s = ((ax - from[0]) * direction[1] - (ay - from[1]) * direction[0]) / denominator;
    if (t > after && s >= 0 && s <= 1 && (!best || t < best.t)) {
      const length = Math.hypot(ex, ey);
      best = { t, edge: [ex / length, ey / length] };
    }
  }
  return best;
}

export function diamondOf(ring: Ring, sport: 'baseball' | 'softball'): Diamond | null {
  const found: Diamond[] = [];
  for (const { at: corner, along, back } of homeCorners(ring)) {
    let tx = along[0] + back[0];
    let ty = along[1] + back[1];
    const size = Math.hypot(tx, ty);
    if (size < 1e-6) continue;
    tx /= size;
    ty /= size;
    const toward: Point = [tx, ty];
    const enter = insideRing(ring, corner[0] + tx * 0.05, corner[1] + ty * 0.05) ? 0 : (crossing(ring, corner, toward, -0.01)?.t ?? Infinity);
    if (!Number.isFinite(enter) || enter > 25) continue;
    const reach = enter + (sport === 'baseball' ? 10 : 8);
    const home: Point = [corner[0] + tx * reach, corner[1] + ty * reach];
    if (!insideRing(ring, home[0], home[1])) continue;
    const far = crossing(ring, home, toward, 1);
    if (!far || Math.abs(far.edge[0] * tx + far.edge[1] * ty) > 0.5) continue;
    const c = Math.SQRT1_2;
    const left: Point = [tx * c - ty * c, tx * c + ty * c];
    const right: Point = [tx * c + ty * c, -tx * c + ty * c];
    const leftCloser = left[0] * along[0] + left[1] * along[1] >= right[0] * along[0] + right[1] * along[1];
    const base = sport === 'baseball' ? 90 * FEET : 60 * FEET;
    const pitch = sport === 'baseball' ? 60.5 * FEET : 43 * FEET;
    if (far.t < base * Math.SQRT2 + 3) continue;
    found.push({ home, toward, first: leftCloser ? left : right, third: leftCloser ? right : left, base, pitch, sport, behind: reach - 0.5 });
  }
  return found.length === 1 ? found[0] : null;
}

function offset(origin: Point, direction: Point, distance: number): Point {
  return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
}

function exit(ring: Ring, from: Point, direction: Point): number {
  let best = Infinity;
  const points = tidy(ring);
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = direction[0] * ey - direction[1] * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    const t = ((ax - from[0]) * ey - (ay - from[1]) * ex) / denominator;
    const s = ((ax - from[0]) * direction[1] - (ay - from[1]) * direction[0]) / denominator;
    if (t > 0.5 && s >= 0 && s <= 1 && t < best) best = t;
  }
  return best;
}

function circleAround(center: Point, radius: number, from: number, to: number): Point[] {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP));
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    points.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
  }
  return points;
}

function angleOf(direction: Point): number {
  return Math.atan2(direction[1], direction[0]);
}

function sweepBetween(from: number, to: number, through: number): [number, number] {
  let end = to;
  while (end <= from) end += Math.PI * 2;
  let mid = through;
  while (mid < from) mid += Math.PI * 2;
  if (mid <= end) return [from, end];
  return [from, end - Math.PI * 2];
}

function foulReach(diamond: Diamond, radius: number): number {
  const along = diamond.pitch * Math.SQRT1_2;
  return along + Math.sqrt(along * along - diamond.pitch * diamond.pitch + radius * radius);
}

export function infieldPatches(diamond: Diamond): Patch[] {
  const { home, toward, first, third, base, pitch, sport } = diamond;
  const mound = offset(home, toward, pitch);
  const radius = sport === 'baseball' ? 95 * FEET : 60 * FEET;
  const circle = sport === 'baseball' ? 13 * FEET : 10 * FEET;
  const reach = foulReach(diamond, radius);
  const firstFar = offset(home, first, reach);
  const thirdFar = offset(home, third, reach);
  const [outFrom, outTo] = sweepBetween(Math.atan2(firstFar[1] - mound[1], firstFar[0] - mound[0]), Math.atan2(thirdFar[1] - mound[1], thirdFar[0] - mound[0]), angleOf(toward));
  const [backFrom, backTo] = sweepBetween(angleOf(third), angleOf(first), angleOf(toward) + Math.PI);
  const skin: Point[] = [offset(home, first, circle), firstFar, ...circleAround(mound, radius, outFrom, outTo).slice(1, -1), thirdFar, offset(home, third, circle), ...circleAround(home, circle, backFrom, backTo).slice(1, -1)];
  const patches: Patch[] = [{ surface: 'soil', ring: skin, label: 'Ball field' }];
  if (sport === 'baseball') {
    const inset = 3 * FEET;
    const cut = circle * Math.SQRT2;
    const spot = (a: number, c: number): Point => [home[0] + first[0] * a + third[0] * c, home[1] + first[1] * a + third[1] * c];
    patches.push({
      surface: 'grass',
      ring: [spot(cut - inset, inset), spot(base - inset, inset), spot(base - inset, base - inset), spot(inset, base - inset), spot(inset, cut - inset)],
      label: 'Ball field',
    });
    patches.push({ surface: 'soil', ring: circleAround(mound, 9 * FEET, 0, Math.PI * 2).slice(0, -1), label: 'Ball field' });
  }
  return patches;
}

function square(center: Point, along: Point, size: number, half: number): Mark {
  const across: Point = [-along[1], along[0]];
  const s = size / 2;
  return {
    points: [
      [center[0] - along[0] * s - across[0] * s, center[1] - along[1] * s - across[1] * s],
      [center[0] + along[0] * s - across[0] * s, center[1] + along[1] * s - across[1] * s],
      [center[0] + along[0] * s + across[0] * s, center[1] + along[1] * s + across[1] * s],
      [center[0] - along[0] * s + across[0] * s, center[1] - along[1] * s + across[1] * s],
    ],
    closed: true,
    half,
  };
}

function diamondLayout(ring: Ring, sport: 'baseball' | 'softball'): Layout | null {
  const diamond = diamondOf(ring, sport);
  if (!diamond) return null;
  const { home, toward, first, third, base, pitch } = diamond;
  const marks: Mark[] = [];
  for (const direction of [first, third]) {
    const reach = exit(ring, home, direction);
    if (Number.isFinite(reach)) marks.push({ points: [home, offset(home, direction, reach - 0.3)], closed: false, half: BASE_HALF });
  }
  const firstBase = offset(home, first, base);
  const thirdBase = offset(home, third, base);
  const secondBase = offset(home, toward, base * Math.SQRT2);
  marks.push({ points: [firstBase, secondBase, thirdBase], closed: false, half: 0.03 });
  const plate = 0.38;
  marks.push(square(offset(firstBase, toward, 0), toward, plate * 0.5, plate * 0.25));
  marks.push(square(secondBase, toward, plate * 0.5, plate * 0.25));
  marks.push(square(thirdBase, toward, plate * 0.5, plate * 0.25));
  marks.push(square(home, toward, 0.22, 0.11));
  const across: Point = [-toward[1], toward[0]];
  for (const side of [-1, 1]) {
    const middle = offset(offset(home, across, side * (0.22 + 0.15 + 0.61)), toward, 0);
    const box = square(middle, toward, 1, 0.03);
    const a = 0.61;
    const b = 0.915;
    box.points = [
      [middle[0] - toward[0] * b - across[0] * a, middle[1] - toward[1] * b - across[1] * a],
      [middle[0] + toward[0] * b - across[0] * a, middle[1] + toward[1] * b - across[1] * a],
      [middle[0] + toward[0] * b + across[0] * a, middle[1] + toward[1] * b + across[1] * a],
      [middle[0] - toward[0] * b + across[0] * a, middle[1] - toward[1] * b + across[1] * a],
    ];
    marks.push(box);
  }
  const mound = offset(home, toward, pitch);
  marks.push({ points: [offset(mound, across, -0.3), offset(mound, across, 0.3)], closed: false, half: 0.08 });
  if (sport === 'softball') marks.push({ points: circleAround(mound, 8 * FEET, 0, Math.PI * 2).slice(0, -1), closed: true, half: BASE_HALF });
  const radius = Math.max(3, Math.min(sport === 'baseball' ? 8.5 : 6.5, diamond.behind / 1.4));
  return { marks, gear: [{ kind: 'backstop', x: home[0], y: home[1], heading: angleOf(toward), size: radius }] };
}

export function layoutOf(patch: Patch, others: Patch[] = []): Layout | null {
  const points = tidy(patch.ring);
  if (points.length < 3 || ringArea(points) < 1) return null;
  const sport = playedOn(patch);
  if (sport === 'baseball' || sport === 'softball') return diamondLayout(points, sport);
  const frame = frameOf(points);
  if (sport === 'soccer' && others.some((other) => other !== patch && playedOn(other) === 'american_football' && insideRing(other.ring, frame.cx, frame.cy))) return null;
  if (sport === 'tennis') return tennis(frame);
  if (sport === 'basketball') return basketball(frame);
  if (sport === 'volleyball') return volleyball(frame);
  if (sport === 'pickleball') return pickleball(frame);
  if (sport === 'soccer') return soccer(frame);
  if (sport === 'american_football') return football(frame);
  if (sport !== undefined) return null;
  if (patch.surface === 'court') {
    const lines = tennis(frame);
    return lines ? { marks: lines.marks, gear: [] } : null;
  }
  if (patch.label === 'Field') return oldField(frame);
  return null;
}

const TENNIS_LONG = 18.29;
const TENNIS_SHORT = 9.14;

function tennisPen(ring: Ring): { frame: Frame; ring: Ring } {
  const frame = frameOf(ring);
  const long = Math.max(frame.long / 2, TENNIS_LONG);
  const short = Math.max(frame.short / 2, TENNIS_SHORT);
  return { frame, ring: [at(frame, -long, -short), at(frame, long, -short), at(frame, long, short), at(frame, -long, short)] };
}

export function tennisGroups(campus: Campus): Ring[][] {
  const pens = campus.patches
    .filter((patch) => playedOn(patch) === 'tennis' && tidy(patch.ring).length >= 3)
    .map((patch) => tennisPen(tidy(patch.ring)));
  const parent = pens.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < pens.length; i += 1) {
    for (let j = i + 1; j < pens.length; j += 1) {
      if (touching(pens[i].ring, pens[j].ring, 1)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, { frame: Frame; ring: Ring }[]>();
  pens.forEach((pen, index) => {
    const root = find(index);
    const list = groups.get(root);
    if (list) list.push(pen);
    else groups.set(root, [pen]);
  });
  return [...groups.values()].map((group) => {
    const axis = group[0].frame;
    const parallel = group.every((pen) => Math.abs(pen.frame.ux * axis.uy - pen.frame.uy * axis.ux) < 0.09);
    if (!parallel) return group.map((pen) => pen.ring);
    let lowU = Infinity;
    let highU = -Infinity;
    let lowV = Infinity;
    let highV = -Infinity;
    for (const pen of group) {
      for (const [x, y] of pen.ring) {
        const u = (x - axis.cx) * axis.ux + (y - axis.cy) * axis.uy;
        const v = -(x - axis.cx) * axis.uy + (y - axis.cy) * axis.ux;
        lowU = Math.min(lowU, u);
        highU = Math.max(highU, u);
        lowV = Math.min(lowV, v);
        highV = Math.max(highV, v);
      }
    }
    return [[at(axis, lowU, lowV), at(axis, highU, lowV), at(axis, highU, highV), at(axis, lowU, highV)]];
  });
}

function touching(a: Ring, b: Ring, gap: number): boolean {
  for (const [x, y] of a) {
    if (insideRing(b, x, y) || ringGap(b, x, y) <= gap) return true;
  }
  for (const [x, y] of b) {
    if (insideRing(a, x, y) || ringGap(a, x, y) <= gap) return true;
  }
  return false;
}

function ringGap(ring: Ring, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    best = Math.min(best, segmentDistance(x, y, ax, ay, bx, by));
  }
  return best;
}

export function outerEdges(rings: Ring[]): [Point, Point][] {
  const edges: [Point, Point][] = [];
  rings.forEach((ring, index) => {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.5) continue;
      const nx = -(b[1] - a[1]) / length;
      const ny = (b[0] - a[0]) / length;
      const shared = rings.some((other, at) => at !== index && (insideRing(other, mx + nx * 1.2, my + ny * 1.2) || insideRing(other, mx - nx * 1.2, my - ny * 1.2) || ringGap(other, mx, my) < 1.2));
      if (!shared) edges.push([a, b]);
    }
  });
  return edges;
}

export function courtFences(campus: Campus, mapped: Edge[] = campus.edges ?? []): [Point, Point][] {
  const fences: [Point, Point][] = [];
  for (const group of tennisGroups(campus)) {
    const edges = outerEdges(group);
    const near = mapped.some((edge) => {
      for (let i = 0; i + 1 < edge.line.length; i += 1) {
        const [ax, ay] = edge.line[i];
        const [bx, by] = edge.line[i + 1];
        for (const [a, b] of edges) {
          for (const share of [0, 0.25, 0.5, 0.75, 1]) {
            const x = a[0] + (b[0] - a[0]) * share;
            const y = a[1] + (b[1] - a[1]) * share;
            if (segmentDistance(x, y, ax, ay, bx, by) <= 4) return true;
          }
        }
      }
      return false;
    });
    if (!near) fences.push(...edges);
  }
  return fences;
}
