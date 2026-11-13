import { ShapeUtils, Vector2 } from 'three';
import { SURFACES, type Campus, type Patch, type Strip, type Surface } from './campus';
import { insideRing, ringArea, ringDistance, type Point, type Ring } from './geometry';
import type { Grid } from './raster';

const FIELD_SPORTS = ['Football field', 'Soccer field', 'Field'];
const ROUND = 10;
const LANES = 8;
const LANE_HALF = 0.06;
const FIELD_HALF = 0.07;
const COURT_HALF = 0.04;
const STALL_HALF = 0.05;
const YARD_LINE = 9.144;
const BAY = 18.3;
const STALL = 2.75;
const STALL_DEPTH = 5.5;
const STALL_LIMIT = 1500;
const SPORTS = /field|pitch|diamond/i;
export const BEVEL = 0.35;
const STEP = 0.5;
const GROUP = 3;
export const STRIDE = 16;
const PROBE = 0.3;
const BUCKET = 16;
const BEND = Math.PI / 8;
const RELIEF: Partial<Record<Surface, number>> = { grass: 1, soil: 1, concrete: 1, court: 1, track: 1, turf: 1, asphalt: -1 };

type Box = { cx: number; cy: number; ux: number; uy: number; long: number; short: number };

function boxAround(ring: Ring): Box {
  let best = 0;
  let ux = 1;
  let uy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
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
  for (const [x, y] of ring) {
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

function along(box: Box, u: number, v: number): Point {
  return [box.cx + u * box.ux - v * box.uy, box.cy + u * box.uy + v * box.ux];
}

function tidy(points: Ring): { points: Point[]; closed: boolean } {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-3) kept.push(point);
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  const closed = kept.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-3;
  if (closed) kept.pop();
  return { points: kept, closed };
}

function normal(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return length > 0 ? [-dy / length, dx / length] : [0, 0];
}

function joins(points: Point[], closed: boolean): Point[] {
  const count = points.length;
  const result: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const prev = i > 0 ? i - 1 : closed ? count - 1 : -1;
    const next = i < count - 1 ? i + 1 : closed ? 0 : -1;
    const a = prev >= 0 ? normal(points[prev], points[i]) : null;
    const b = next >= 0 ? normal(points[i], points[next]) : null;
    if (a && b) {
      const sx = a[0] + b[0];
      const sy = a[1] + b[1];
      const length = Math.hypot(sx, sy);
      if (length < 1e-6) {
        result.push(a);
        continue;
      }
      const mx = sx / length;
      const my = sy / length;
      const stretch = 1 / Math.max(0.5, mx * a[0] + my * a[1]);
      result.push([mx * stretch, my * stretch]);
    } else {
      result.push(a ?? b ?? [0, 0]);
    }
  }
  return result;
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

type Layer = { surface: Surface; patch?: Patch; strip?: Strip };
type Cover = { kind: number; minX: number; minY: number; maxX: number; maxY: number; ring: Point[] | null; ax: number; ay: number; bx: number; by: number; radius: number };

function mown(patch: Patch): boolean {
  return patch.surface === 'turf' || patch.surface === 'court' || (patch.surface === 'grass' && SPORTS.test(patch.label ?? ''));
}


export function groundValues(campus: Campus, grid: Grid, middle: Point): Float32Array {
  const [middleX, middleY] = middle;
  let values = new Float32Array(STRIDE * 65536);
  let used = 0;
  let rise = 0;
  let hard = 0;
  let kind = 0;
  let alongX = 0;
  let alongZ = 0;
  let phase = 0;

  const use = (surface: Surface, patch?: Patch) => {
    rise = SURFACES[surface].rise;
    hard = surface === 'asphalt' || surface === 'concrete' ? 1 : 0;
    kind = SURFACES[surface].code;
    alongX = 0;
    alongZ = 0;
    phase = 0;
    if (patch && mown(patch)) {
      const box = boxAround(tidy(patch.ring).points);
      alongX = box.ux;
      alongZ = -box.uy;
      phase = (box.cx - middleX) * alongX + (middleY - box.cy) * alongZ;
    }
  };
  const vertex = (x: number, y: number, ox: number, oy: number, half: number, mark: number, nx = 0, ny = 0, lift = 0) => {
    if (used + STRIDE > values.length) {
      const grown = new Float32Array(values.length * 2);
      grown.set(values);
      values = grown;
    }
    values[used] = x - middleX;
    values[used + 2] = middleY - y;
    values[used + 3] = rise;
    values[used + 4] = hard;
    values[used + 5] = mark;
    values[used + 6] = ox;
    values[used + 7] = -oy;
    values[used + 8] = half;
    values[used + 9] = kind;
    values[used + 10] = alongX;
    values[used + 11] = alongZ;
    values[used + 12] = phase;
    values[used + 13] = nx;
    values[used + 14] = lift;
    values[used + 15] = -ny;
    used += STRIDE;
  };
  const triangle = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    vertex(ax, ay, 0, 0, 0, 0);
    vertex(bx, by, 0, 0, 0, 0);
    vertex(cx, cy, 0, 0, 0, 0);
  };

  const fill = (ring: Ring) => {
    const { points } = tidy(ring);
    if (points.length < 3 || ringArea(points) < 1e-6) return;
    const contour = points.map(([x, y]) => new Vector2(x, y));
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      triangle(contour[a].x, contour[a].y, contour[b].x, contour[b].y, contour[c].x, contour[c].y);
    }
  };

  const disc = (x: number, y: number, radius: number) => {
    for (let step = 0; step < ROUND; step += 1) {
      const from = (step / ROUND) * Math.PI * 2;
      const to = ((step + 1) / ROUND) * Math.PI * 2;
      triangle(x, y, x + Math.cos(from) * radius, y + Math.sin(from) * radius, x + Math.cos(to) * radius, y + Math.sin(to) * radius);
    }
  };

  const band = (strip: Strip) => {
    const points = strip.line;
    if (points.length < 2 || strip.width <= 0) return;
    const radius = strip.width / 2;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const [nx, ny] = normal(points[i], points[i + 1]);
      if (nx === 0 && ny === 0) continue;
      const ox = nx * radius;
      const oy = ny * radius;
      triangle(ax + ox, ay + oy, ax - ox, ay - oy, bx - ox, by - oy);
      triangle(ax + ox, ay + oy, bx - ox, by - oy, bx + ox, by + oy);
    }
    for (const [x, y] of points) disc(x, y, radius);
  };

  const ribbon = (points: Point[], closed: boolean, half: number) => {
    const count = points.length;
    if (count < 2) return;
    const out = joins(points, closed);
    const segments = closed ? count : count - 1;
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % count;
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      const [px, py] = out[i];
      const [qx, qy] = out[j];
      vertex(ax, ay, px, py, half, 1);
      vertex(ax, ay, -px, -py, half, 1);
      vertex(bx, by, -qx, -qy, half, 1);
      vertex(ax, ay, px, py, half, 1);
      vertex(bx, by, -qx, -qy, half, 1);
      vertex(bx, by, qx, qy, half, 1);
    }
  };

  const segment = (from: Point, to: Point, half: number) => ribbon([from, to], false, half);

  const lanes = (strip: Strip) => {
    const { points, closed } = tidy(strip.line);
    if (points.length < 2) return;
    const out = joins(points, closed);
    for (let lane = 0; lane <= LANES; lane += 1) {
      const offset = -strip.width / 2 + (strip.width * lane) / LANES;
      const shifted = points.map(([x, y], index): Point => [x + out[index][0] * offset, y + out[index][1] * offset]);
      ribbon(shifted, closed, LANE_HALF);
    }
  };

  const field = (patch: Patch) => {
    const box = boxAround(tidy(patch.ring).points);
    const half = Math.min(box.long / 2 - 1, 54.86);
    const side = Math.min(box.short / 2 - 1, 24.38);
    if (half < 20 || side < 10) return;
    ribbon([along(box, -half, -side), along(box, half, -side), along(box, half, side), along(box, -half, side)], true, FIELD_HALF);
    const steps = Math.floor(half / YARD_LINE);
    for (let step = -steps; step <= steps; step += 1) {
      const u = step * YARD_LINE;
      if (Math.abs(u) < half - 0.01) segment(along(box, u, -side), along(box, u, side), FIELD_HALF);
    }
  };

  const court = (patch: Patch) => {
    const box = boxAround(tidy(patch.ring).points);
    const half = Math.min(11.89, box.long / 2 - 2.5);
    const side = Math.min(5.49, box.short / 2 - 1.5);
    if (half < 4 || side < 2) return;
    const single = side * 0.75;
    const service = half * 0.54;
    ribbon([along(box, -half, -side), along(box, half, -side), along(box, half, side), along(box, -half, side)], true, COURT_HALF);
    segment(along(box, 0, -side), along(box, 0, side), COURT_HALF);
    segment(along(box, -half, -single), along(box, half, -single), COURT_HALF);
    segment(along(box, -half, single), along(box, half, single), COURT_HALF);
    segment(along(box, -service, -single), along(box, -service, single), COURT_HALF);
    segment(along(box, service, -single), along(box, service, single), COURT_HALF);
    segment(along(box, -service, 0), along(box, service, 0), COURT_HALF);
  };

  const parking = (patch: Patch) => {
    const ring = tidy(patch.ring).points;
    if (ring.length < 3 || ringArea(ring) < 1e-6) return;
    const box = boxAround(ring);
    const fits = (point: Point) => insideRing(ring, point[0], point[1]) && ringDistance(ring, point[0], point[1]) >= 1;
    const bays = Math.max(1, Math.round(box.short / BAY));
    const firstV = (-(bays - 1) / 2) * BAY;
    const extra = Math.ceil(box.short / BAY) + 1;
    const stalls = Math.max(1, Math.ceil(box.long / STALL));
    const firstU = (-stalls / 2) * STALL;
    let count = 0;
    for (let bay = -extra; bay < bays + extra && count < STALL_LIMIT; bay += 1) {
      const v = firstV + bay * BAY;
      if (Math.abs(v) > box.short / 2 + STALL_DEPTH) continue;
      let run: Point | null = null;
      let runEnd: Point | null = null;
      for (let index = 0; index <= stalls; index += 1) {
        const u = firstU + index * STALL;
        const base = along(box, u, v);
        const good = fits(base);
        if (good && count < STALL_LIMIT) {
          for (const way of [-1, 1]) {
            if (count >= STALL_LIMIT) break;
            const tip = along(box, u, v + way * STALL_DEPTH);
            if (!fits(tip)) continue;
            segment(base, tip, STALL_HALF);
            count += 1;
          }
        }
        if (good) {
          if (!run) run = base;
          runEnd = base;
        }
        if ((!good || index === stalls) && run && runEnd) {
          if (run !== runEnd) segment(run, runEnd, STALL_HALF);
          run = null;
          runEnd = null;
        }
      }
    }
  };

  const soft = (surface: Surface) => surface === 'grass' || surface === 'soil';
  const paving = (surface: Surface) => surface === 'asphalt' || surface === 'concrete';
  const { patches, strips } = campus;
  const right = grid.minX + grid.cols * grid.cell;
  const top = grid.minY + grid.rows * grid.cell;

  const layers: Layer[] = [
    ...patches.filter((patch) => soft(patch.surface)).map((patch) => ({ surface: patch.surface, patch })),
    ...strips.filter((strip) => strip.surface !== 'track').map((strip) => ({ surface: strip.surface, strip })),
    ...patches.filter((patch) => paving(patch.surface)).map((patch) => ({ surface: patch.surface, patch })),
    ...strips.filter((strip) => strip.surface === 'track').map((strip) => ({ surface: strip.surface, strip })),
    ...patches.filter((patch) => !soft(patch.surface) && !paving(patch.surface)).map((patch) => ({ surface: patch.surface, patch })),
  ];

  const covers: Cover[] = [];
  const buckets = new Map<number, number[]>();
  const slot = (value: number) => Math.floor(value / BUCKET) + 8192;
  const cover = (item: Cover) => {
    const index = covers.length;
    covers.push(item);
    for (let gx = slot(item.minX); gx <= slot(item.maxX); gx += 1) {
      for (let gy = slot(item.minY); gy <= slot(item.maxY); gy += 1) {
        const key = gx * 16384 + gy;
        const list = buckets.get(key);
        if (list) list.push(index);
        else buckets.set(key, [index]);
      }
    }
  };
  for (const layer of layers) {
    const code = SURFACES[layer.surface].code;
    if (layer.patch) {
      const { points } = tidy(layer.patch.ring);
      if (points.length < 3 || ringArea(points) < 1e-6) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      cover({ kind: code, minX, minY, maxX, maxY, ring: points, ax: 0, ay: 0, bx: 0, by: 0, radius: 0 });
    } else if (layer.strip && layer.strip.width > 0) {
      const radius = layer.strip.width / 2;
      const line = layer.strip.line;
      for (let i = 0; i + 1 < line.length; i += 1) {
        const [ax, ay] = line[i];
        const [bx, by] = line[i + 1];
        cover({ kind: code, minX: Math.min(ax, bx) - radius, minY: Math.min(ay, by) - radius, maxX: Math.max(ax, bx) + radius, maxY: Math.max(ay, by) + radius, ring: null, ax, ay, bx, by, radius });
      }
    }
  }
  const onStrip = (item: Cover, x: number, y: number) => {
    const dx = item.bx - item.ax;
    const dy = item.by - item.ay;
    const length = dx * dx + dy * dy;
    const share = length > 0 ? Math.min(1, Math.max(0, ((x - item.ax) * dx + (y - item.ay) * dy) / length)) : 0;
    const ex = x - item.ax - dx * share;
    const ey = y - item.ay - dy * share;
    return ex * ex + ey * ey <= item.radius * item.radius;
  };
  const topKind = (x: number, y: number): number => {
    const list = buckets.get(slot(x) * 16384 + slot(y));
    if (list) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const item = covers[list[i]];
        if (x < item.minX || x > item.maxX || y < item.minY || y > item.maxY) continue;
        if (item.ring ? insideRing(item.ring, x, y) : onStrip(item, x, y)) return item.kind;
      }
    }
    return x >= grid.minX && x <= right && y >= grid.minY && y <= top ? SURFACES.grass.code : -1;
  };

  const quad = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, anx: number, any: number, bnx: number, bny: number, lift: number) => {
    const mx = (ax + bx + cx + dx) / 4;
    const my = (ay + by + cy + dy) / 4;
    const reach = Math.max(Math.hypot(ax - mx, ay - my), Math.hypot(bx - mx, by - my), Math.hypot(cx - mx, cy - my), Math.hypot(dx - mx, dy - my));
    vertex(ax, ay, mx - ax, my - ay, reach, 0, anx, any, lift);
    vertex(bx, by, mx - bx, my - by, reach, 0, bnx, bny, lift);
    vertex(cx, cy, mx - cx, my - cy, reach, 0, bnx, bny, 0);
    vertex(ax, ay, mx - ax, my - ay, reach, 0, anx, any, lift);
    vertex(cx, cy, mx - cx, my - cy, reach, 0, bnx, bny, 0);
    vertex(dx, dy, mx - dx, my - dy, reach, 0, anx, any, 0);
  };

  const rim = (ax: number, ay: number, bx: number, by: number, ix: number, iy: number, jx: number, jy: number, nx: number, ny: number, lift: number) => {
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-3) return;
    const count = Math.max(1, Math.ceil(length / STEP));
    const piece = (from: number, to: number) => {
      const oax = ax + (bx - ax) * from;
      const oay = ay + (by - ay) * from;
      const obx = ax + (bx - ax) * to;
      const oby = ay + (by - ay) * to;
      const iax = ix + (jx - ix) * from;
      const iay = iy + (jy - iy) * from;
      const ibx = ix + (jx - ix) * to;
      const iby = iy + (jy - iy) * to;
      quad(oax, oay, obx, oby, ibx, iby, iax, iay, nx, ny, nx, ny, lift);
    };
    const probe = (step: number) => {
      const share = (step + 0.5) / count;
      return topKind(ax + (bx - ax) * share + nx * PROBE, ay + (by - ay) * share + ny * PROBE) !== kind;
    };
    const groups = Math.ceil(count / GROUP);
    const coarse: boolean[] = [];
    for (let group = 0; group < groups; group += 1) coarse.push(probe(Math.min(count - 1, group * GROUP + (GROUP >> 1))));
    let start = -1;
    const mark = (step: number, show: boolean) => {
      if (show && start < 0) start = step;
      if (!show && start >= 0) {
        piece(start / count, step / count);
        start = -1;
      }
    };
    for (let group = 0; group < groups; group += 1) {
      const first = group * GROUP;
      const settled = (group === 0 || coarse[group - 1] === coarse[group]) && (group === groups - 1 || coarse[group + 1] === coarse[group]);
      if (settled) mark(first, coarse[group]);
      else for (let step = first; step < Math.min(count, first + GROUP); step += 1) mark(step, probe(step));
    }
    mark(count, false);
  };

  const arc = (x: number, y: number, fromX: number, fromY: number, sweep: number, outer: number, inner: number, lift: number) => {
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / BEND));
    const start = Math.atan2(fromY, fromX);
    for (let step = 0; step < steps; step += 1) {
      const a = start + (sweep * step) / steps;
      const b = start + (sweep * (step + 1)) / steps;
      const middle = (a + b) / 2;
      if (topKind(x + Math.cos(middle) * (outer + PROBE), y + Math.sin(middle) * (outer + PROBE)) === kind) continue;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      quad(x + ca * outer, y + sa * outer, x + cb * outer, y + sb * outer, x + cb * inner, y + sb * inner, x + ca * inner, y + sa * inner, ca, sa, cb, sb, lift);
    }
  };

  const patchRims = (patch: Patch) => {
    const lift = RELIEF[patch.surface];
    if (!lift) return;
    const { points } = tidy(patch.ring);
    if (points.length < 3 || ringArea(points) < 1e-6) return;
    const flip = signedArea(points) > 0 ? -1 : 1;
    const miter = joins(points, true);
    const count = points.length;
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      const [nx, ny] = normal(points[i], points[j]);
      if (nx === 0 && ny === 0) continue;
      const ix = ax - miter[i][0] * flip * BEVEL;
      const iy = ay - miter[i][1] * flip * BEVEL;
      const jx = bx - miter[j][0] * flip * BEVEL;
      const jy = by - miter[j][1] * flip * BEVEL;
      rim(ax, ay, bx, by, ix, iy, jx, jy, nx * flip, ny * flip, lift);
    }
  };

  const stripRims = (strip: Strip) => {
    const lift = RELIEF[strip.surface];
    const points = strip.line;
    if (!lift || points.length < 2 || strip.width <= 0) return;
    const outer = strip.width / 2;
    const inner = outer - Math.min(BEVEL, outer * 0.5);
    const runs: { from: number; nx: number; ny: number }[] = [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [nx, ny] = normal(points[i], points[i + 1]);
      if (nx === 0 && ny === 0) continue;
      runs.push({ from: i, nx, ny });
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      for (const side of [1, -1]) {
        const ox = nx * side;
        const oy = ny * side;
        rim(ax + ox * outer, ay + oy * outer, bx + ox * outer, by + oy * outer, ax + ox * inner, ay + oy * inner, bx + ox * inner, by + oy * inner, ox, oy, lift);
      }
    }
    const turn = (before: { nx: number; ny: number }, after: { nx: number; ny: number }, at: Point) => {
      const cross = before.nx * after.ny - before.ny * after.nx;
      const sweep = Math.atan2(cross, before.nx * after.nx + before.ny * after.ny);
      if (Math.abs(sweep) < 0.01) return;
      const side = cross > 0 ? -1 : 1;
      arc(at[0], at[1], before.nx * side, before.ny * side, sweep, outer, inner, lift);
    };
    for (let k = 1; k < runs.length; k += 1) turn(runs[k - 1], runs[k], points[runs[k].from]);
    const first = points[0];
    const last = points[points.length - 1];
    if (runs.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-3) turn(runs[runs.length - 1], runs[0], first);
  };

  use('grass');
  triangle(grid.minX, grid.minY, right, grid.minY, right, top);
  triangle(grid.minX, grid.minY, right, top, grid.minX, top);
  for (const layer of layers) {
    use(layer.surface, layer.patch);
    if (layer.patch) {
      fill(layer.patch.ring);
      patchRims(layer.patch);
    } else if (layer.strip) {
      band(layer.strip);
      stripRims(layer.strip);
    }
  }
  for (const strip of strips) {
    if (strip.surface !== 'track') continue;
    use(strip.surface);
    lanes(strip);
  }
  for (const patch of patches) {
    use(patch.surface, patch);
    if (patch.surface === 'court') court(patch);
    else if (FIELD_SPORTS.includes(patch.label ?? '')) field(patch);
    else if (patch.label === 'Parking lot') parking(patch);
  }

  return values.slice(0, used);
}
