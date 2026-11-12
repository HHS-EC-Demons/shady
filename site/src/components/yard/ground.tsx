import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SURFACES, type Patch, type Strip, type Surface } from '@/engine/campus';
import { insideRing, ringArea, ringDistance, type Point, type Ring } from '@/engine/geometry';
import { rampTable } from '@/engine/heat';
import { makeGrid, polygonSpans } from '@/engine/raster';
import type { Yard } from './controller';

const SHADOW = '#2b4450';
const PAPER = '#e3eaec';
const ROAD = '#d6dee1';
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const spot = new THREE.Vector3();
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
const MASK_LIMIT = 2048;
const CONTACT_LIMIT = 1024;
const CONTACT_REACH = 2.5;
const CONTACT_PASSES = 3;
const SPORTS = /field|pitch|diamond/i;
const BEVEL = 0.35;
const STEP = 0.5;
const GROUP = 3;
const STRIDE = 16;
const PROBE = 0.3;
const BUCKET = 16;
const BEND = Math.PI / 8;
const RELIEF: Partial<Record<Surface, number>> = { grass: 1, soil: 1, concrete: 1, court: 1, track: 1, turf: 1, asphalt: -1 };

const VERTEX = `
attribute float aRise;
attribute float aPaved;
attribute float aLine;
attribute vec2 aOut;
attribute float aHalf;
attribute float aKind;
attribute vec2 aAlong;
attribute float aPhase;
attribute vec3 aBevel;
uniform vec4 uGrid;
uniform vec2 uMiddle;
uniform float uPixel;
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
varying vec2 vWorld;
varying float vKind;
varying vec3 vAlong;
varying vec3 vBevel;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float shade = 0.0;
  if (aLine > 0.5) {
    float perPixel = distance(world.xyz, cameraPosition) * uPixel;
    float wide = max(aHalf, 0.65 * perPixel);
    world.xz += aOut * wide;
    shade = aLine * clamp(aHalf / wide * 1.5, 0.3, 1.0);
  }
  vec2 campus = vec2(world.x + uMiddle.x, uMiddle.y - world.z);
  vUv = (campus - uGrid.xy) / uGrid.zw;
  vRise = aRise;
  vPaved = aPaved;
  vLine = shade;
  vWorld = world.xz;
  vKind = aKind;
  vAlong = vec3(aAlong, dot(world.xz, aAlong) - aPhase);
  vBevel = aBevel;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = `
uniform sampler2D uHeat;
uniform sampler2D uHome;
uniform sampler2D uRamp;
uniform sampler2D uContact;
uniform float uAir;
uniform vec3 uPaper;
uniform vec3 uRoad;
uniform vec3 uSun;
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
varying vec2 vWorld;
varying float vKind;
varying vec3 vAlong;
varying vec3 vBevel;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

float keep(float size, float pixel) {
  return 1.0 - smoothstep(size * 0.15, size * 0.5, pixel);
}

float joint(float coord, float pixel) {
  float d = abs(fract(coord / 1.5 + 0.5) - 0.5) * 1.5;
  float w = max(pixel, 0.001);
  return max(min(0.015, d + 0.5 * w) - max(-0.015, d - 0.5 * w), 0.0) / w;
}

float mown(vec2 p, float pixel) {
  float stripe = smoothstep(-0.3, 0.3, sin(3.14159265 * vAlong.z / 4.572)) * 2.0 - 1.0;
  return 0.035 * stripe + 0.02 * noise(p / 0.1) * keep(0.1, pixel);
}

float grain(vec2 p, vec2 fw, float pixel) {
  float kind = floor(vKind + 0.5);
  bool aligned = dot(vAlong.xy, vAlong.xy) > 0.25;
  vec2 r = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
  if (kind < 0.5) {
    if (aligned) return mown(p, pixel);
    return 0.015 * noise(p / 0.7) * keep(0.7, pixel) + 0.035 * noise(r / 5.0 + 19.7) * keep(5.0, pixel);
  }
  if (kind < 1.5) {
    return 0.03 * noise(p / 0.18) * keep(0.18, pixel) - 0.03 * smoothstep(-0.2, 0.7, noise(r / 3.5 + 7.3)) * keep(3.5, pixel);
  }
  if (kind < 2.5) {
    float seam = max(joint(p.x, fw.x), joint(p.y, fw.y));
    return -0.07 * seam * keep(1.5, pixel) + 0.02 * noise(p / 0.8 + 3.1) * keep(0.8, pixel);
  }
  if (kind < 3.5) return mown(p, pixel);
  if (kind < 4.5) {
    vec2 q = aligned ? vec2(dot(p, vAlong.xy) / 9.0, dot(p, vec2(-vAlong.y, vAlong.x)) / 3.0) : p / 6.0;
    return 0.015 * noise(q + 11.0);
  }
  if (kind < 5.5) return 0.03 * noise(p / 0.12) * keep(0.12, pixel);
  if (kind < 6.5) {
    return 0.025 * noise(p / 0.4 + 5.0) * keep(0.4, pixel) + 0.035 * noise(p / 2.0 + 13.0) * keep(2.0, pixel);
  }
  return 0.0;
}

float relief(float pixel) {
  float spread = dot(vBevel.xz, vBevel.xz);
  if (spread < 0.04) return 0.0;
  vec2 outward = vBevel.xz * inversesqrt(spread) * sign(vBevel.y);
  vec3 tilted = vec3(outward.x * 0.6428, 0.7660, outward.y * 0.6428);
  float level = max(uSun.y, 0.02);
  float change = clamp((max(dot(tilted, uSun), 0.0) / level - 1.0) * 2.2, -1.0, 1.0);
  float profile = smoothstep(0.0, 0.6, abs(vBevel.y));
  float low = smoothstep(0.02, 0.22, uSun.y);
  float far = 1.0 - smoothstep(${(BEVEL / 7).toFixed(4)}, ${(BEVEL / 2).toFixed(4)}, pixel);
  return 0.14 * change * profile * low * far;
}

void main() {
  float home = smoothstep(0.35, 0.65, texture2D(uHome, vUv).r);
  float degrees = uAir + vRise * texture2D(uHeat, vUv).r * 1.275;
  float place = clamp((degrees - 30.0) * 1.25 / 255.0, 0.0, 1.0);
  vec3 hot = texture2D(uRamp, vec2(place, 0.5)).rgb;
  hot = mix(hot, vec3(0.98, 0.985, 0.97), vLine * home * 0.55);
  vec2 fw = fwidth(vWorld);
  float pixel = max(fw.x, fw.y);
  float near = 1.0 - smoothstep(0.08, 0.25, pixel);
  if (near > 0.0 && home > 0.0) {
    float tone = clamp(1.0 + grain(vWorld, fw, pixel) * near, 0.9, 1.06);
    hot *= pow(tone * (1.0 + relief(pixel)), 2.2);
  }
  vec3 away = mix(uPaper, uRoad, vPaved);
  vec3 colour = mix(away, hot, home);
  float contact = smoothstep(0.03, 0.55, texture2D(uContact, vUv).r);
  colour = mix(colour, colour * vec3(0.80, 0.86, 0.88), 0.30 * contact);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

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

function build(yard: Yard): THREE.BufferGeometry {
  const grid = yard.ground.grid;
  const [middleX, middleY] = yard.middle;
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
    const contour = points.map(([x, y]) => new THREE.Vector2(x, y));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
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
  const { patches, strips } = yard.campus;
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
      vertex(oax, oay, 0, 0, 0, 0, nx, ny, lift);
      vertex(obx, oby, 0, 0, 0, 0, nx, ny, lift);
      vertex(ibx, iby, 0, 0, 0, 0, nx, ny, 0);
      vertex(oax, oay, 0, 0, 0, 0, nx, ny, lift);
      vertex(ibx, iby, 0, 0, 0, 0, nx, ny, 0);
      vertex(iax, iay, 0, 0, 0, 0, nx, ny, 0);
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
      vertex(x + ca * outer, y + sa * outer, 0, 0, 0, 0, ca, sa, lift);
      vertex(x + cb * outer, y + sb * outer, 0, 0, 0, 0, cb, sb, lift);
      vertex(x + cb * inner, y + sb * inner, 0, 0, 0, 0, cb, sb, 0);
      vertex(x + ca * outer, y + sa * outer, 0, 0, 0, 0, ca, sa, lift);
      vertex(x + cb * inner, y + sb * inner, 0, 0, 0, 0, cb, sb, 0);
      vertex(x + ca * inner, y + sa * inner, 0, 0, 0, 0, ca, sa, 0);
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

  const geometry = new THREE.BufferGeometry();
  const packed = new THREE.InterleavedBuffer(values.slice(0, used), STRIDE);
  const layout: [string, number, number][] = [
    ['position', 3, 0],
    ['aRise', 1, 3],
    ['aPaved', 1, 4],
    ['aLine', 1, 5],
    ['aOut', 2, 6],
    ['aHalf', 1, 8],
    ['aKind', 1, 9],
    ['aAlong', 2, 10],
    ['aPhase', 1, 12],
    ['aBevel', 3, 13],
  ];
  for (const [name, size, offset] of layout) geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(packed, size, offset));
  geometry.computeBoundingSphere();
  return geometry;
}

function homeMask(yard: Yard, limit: number): THREE.CanvasTexture {
  const grid = yard.ground.grid;
  const width = grid.cols * grid.cell;
  const depth = grid.rows * grid.cell;
  const scale = Math.min(limit, MASK_LIMIT) / Math.max(width, depth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(depth * scale));
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const open = yard.campus.boundary.length === 0;
  context.fillStyle = open ? '#ffffff' : '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / width;
  const sy = canvas.height / depth;
  context.setTransform(sx, 0, 0, -sy, -grid.minX * sx, (grid.minY + depth) * sy);
  context.fillStyle = '#ffffff';
  for (const ring of yard.campus.boundary) {
    context.beginPath();
    ring.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function boxBlur(source: Float32Array, target: Float32Array, cols: number, rows: number, radius: number, across: boolean): void {
  const lines = across ? rows : cols;
  const length = across ? cols : rows;
  const step = across ? 1 : cols;
  const jump = across ? cols : 1;
  const width = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const start = line * jump;
    let sum = 0;
    for (let at = 0; at <= Math.min(radius, length - 1); at += 1) sum += source[start + at * step];
    for (let at = 0; at < length; at += 1) {
      target[start + at * step] = sum / width;
      const enter = at + radius + 1;
      const leave = at - radius;
      if (enter < length) sum += source[start + enter * step];
      if (leave >= 0) sum -= source[start + leave * step];
    }
  }
}

function contactMask(yard: Yard): THREE.DataTexture {
  const heat = yard.ground.grid;
  const width = heat.cols * heat.cell;
  const depth = heat.rows * heat.cell;
  const cell = Math.max(1, Math.max(width, depth) / CONTACT_LIMIT);
  const shape = makeGrid({ minX: heat.minX, minY: heat.minY, maxX: heat.minX + width, maxY: heat.minY + depth }, cell);
  const grid = { ...shape, cols: Math.min(CONTACT_LIMIT, shape.cols), rows: Math.min(CONTACT_LIMIT, shape.rows) };
  const { cols, rows } = grid;
  const field = new Float32Array(cols * rows);
  const spare = new Float32Array(cols * rows);
  for (const block of yard.campus.blocks) {
    polygonSpans(grid, block.ring, (row, from, to) => field.fill(255, row * cols + from, row * cols + to + 1));
  }
  const radius = Math.max(1, Math.round(CONTACT_REACH / cell));
  for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
    boxBlur(field, spare, cols, rows, radius, true);
    boxBlur(spare, field, cols, rows, radius, false);
  }
  const fade = radius * CONTACT_PASSES;
  const data = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const edgeRow = Math.min(row, rows - 1 - row);
    for (let col = 0; col < cols; col += 1) {
      const edge = Math.min(edgeRow, col, cols - 1 - col);
      const keep = Math.min(1, edge / fade);
      data[row * cols + col] = Math.round(Math.min(255, field[row * cols + col] * keep));
    }
  }
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function groundPoint(event: ThreeEvent<PointerEvent>): THREE.Vector3 | null {
  return event.ray.intersectPlane(FLOOR, spot);
}

export function Ground({ yard, texture = 4096, inert = false }: { yard: Yard; texture?: number; inert?: boolean }) {
  const grid = yard.ground.grid;
  const width = grid.cols * grid.cell;
  const depth = grid.rows * grid.cell;
  const heat = useMemo(() => {
    const data = new Uint8Array(grid.cols * grid.rows);
    const map = new THREE.DataTexture(data, grid.cols, grid.rows, THREE.RedFormat, THREE.UnsignedByteType);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return { data, texture: map };
  }, [grid]);
  useEffect(() => () => heat.texture.dispose(), [heat]);
  const geometry = useMemo(() => build(yard), [yard]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const contact = useMemo(() => contactMask(yard), [yard]);
  useEffect(() => () => contact.dispose(), [contact]);
  const material = useMemo(() => {
    const ramp = new THREE.DataTexture(rampTable(), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    ramp.colorSpace = THREE.SRGBColorSpace;
    ramp.magFilter = THREE.LinearFilter;
    ramp.minFilter = THREE.LinearFilter;
    ramp.needsUpdate = true;
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uHeat: { value: heat.texture },
        uHome: { value: homeMask(yard, texture) },
        uRamp: { value: ramp },
        uContact: { value: contact },
        uAir: { value: 90 },
        uPaper: { value: new THREE.Color(PAPER) },
        uRoad: { value: new THREE.Color(ROAD) },
        uGrid: { value: new THREE.Vector4(grid.minX, grid.minY, width, depth) },
        uMiddle: { value: new THREE.Vector2(yard.middle[0], yard.middle[1]) },
        uPixel: { value: 0.001 },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
      },
    });
  }, [yard, grid, heat, contact, texture, width, depth]);
  useEffect(
    () => () => {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture && uniform.value !== heat.texture && uniform.value !== contact) uniform.value.dispose();
      }
      material.dispose();
    },
    [material, heat, contact],
  );
  const seen = useRef(-1);
  const drag = useRef<{ kind: 'tree' | 'sail'; id: number } | null>(null);
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const owner = useRef<THREE.ShaderMaterial | null>(null);
  const sunMinute = useRef(Number.NaN);
  const sunOwner = useRef<THREE.ShaderMaterial | null>(null);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 30;
    const zoom = camera.isPerspectiveCamera ? camera.zoom : 1;
    material.uniforms.uPixel.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, state.gl.domElement.height * zoom);
    if (sunMinute.current !== yard.minute || sunOwner.current !== material) {
      sunMinute.current = yard.minute;
      sunOwner.current = material;
      const ray = yard.sun();
      (material.uniforms.uSun.value as THREE.Vector3).set(ray.x, ray.z, -ray.y);
    }
    if (seen.current === yard.frame && owner.current === material) return;
    seen.current = yard.frame;
    owner.current = material;
    material.uniforms.uAir.value = yard.fillHeat(heat.data);
    heat.texture.needsUpdate = true;
  });

  const [cx, , cz] = yard.toScene(grid.minX + width / 2, grid.minY + depth / 2);

  const down = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || yard.tool === 'look') {
      if (event.button === 0) {
        yard.select(null);
        press.current = { x: event.clientX, y: event.clientY, at: performance.now() };
      }
      return;
    }
    const point = groundPoint(event);
    if (!point) return;
    event.stopPropagation();
    const [x, y] = yard.fromScene(point.x, point.z);
    if (yard.tool === 'measure') {
      yard.ask(x, y);
      return;
    }
    const kind = yard.tool;
    const id = kind === 'tree' ? yard.plant(x, y) : yard.startSail(x, y);
    if (id === null) return;
    drag.current = { kind, id };
    yard.setBusy(true);
    if (controls) controls.enabled = false;
    (event.target as Element).setPointerCapture(event.pointerId);
  };

  const move = (event: ThreeEvent<PointerEvent>) => {
    const point = groundPoint(event);
    if (!point) return;
    event.stopPropagation();
    const [x, y] = yard.fromScene(point.x, point.z);
    if (drag.current) {
      if (drag.current.kind === 'tree') yard.moveTree(drag.current.id, x, y);
      else yard.stretchSail(drag.current.id, x, y);
      yard.probeAt(x, y);
      return;
    }
    if (yard.busy) return;
    if (yard.tool === 'tree') yard.hint(x, y);
    yard.probeAt(x, y);
  };

  const up = (event: ThreeEvent<PointerEvent>) => {
    const pressed = press.current;
    press.current = null;
    if (!drag.current && pressed && yard.tool === 'look') {
      const still = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 6 && performance.now() - pressed.at < 450;
      const point = still ? groundPoint(event) : null;
      if (point) {
        const [x, y] = yard.fromScene(point.x, point.z);
        yard.pickPatch(x, y);
      }
      return;
    }
    if (!drag.current) return;
    event.stopPropagation();
    if (drag.current.kind === 'sail') yard.endSail(drag.current.id);
    else yard.commit();
    drag.current = null;
    yard.setBusy(false);
    if (controls) controls.enabled = true;
    (event.target as Element).releasePointerCapture(event.pointerId);
  };

  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} raycast={() => null} />
      <group position={[cx, 0, cz]}>
        <mesh {...(inert ? { raycast: () => null } : {})} rotation-x={-Math.PI / 2} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => !drag.current && yard.clearProbe()}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.05} receiveShadow raycast={() => null}>
          <planeGeometry args={[width, depth]} />
          <shadowMaterial color={SHADOW} opacity={0.26} />
        </mesh>
      </group>
    </group>
  );
}
