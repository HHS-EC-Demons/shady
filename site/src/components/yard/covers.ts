import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { atHome, floating, type Campus, type Cover } from '@/engine/campus';
import { insideRing, segmentDistance } from '@/engine/geometry';
import { at, frameOf } from '@/engine/sports';
import { Shell, cleanRing, insetRing, lift, outward, type Flat } from './models';

const SLAB = 0.3;
const BEVEL = 0.12;
const POST = 0.08;
const POST_GAP = 6;
const POST_EDGE = 8;
const POST_IN = 0.3;
const CORNER = (30 * Math.PI) / 180;
const PANEL_WIDE = 1.05;
const PANEL_LONG = 1.7;
const PANEL_GAP = 0.05;
const PANEL_LIMIT = 2500;
const ROOF = new THREE.Color('#e6e1d6');
const UNDER = new THREE.Color('#d3cfc6');
const STEEL = new THREE.Color('#56655f');
const PANEL = new THREE.Color('#3f4c5b');
const COPING = new THREE.Color('#ece9e1');
const COPING_WIDE = 0.45;
const DOOR = new THREE.Color('#66726f');
const TRIM = new THREE.Color('#e9e6de');
const DOOR_REACH = 2;
const COPING_HIGH = 0.06;

type Middle = [number, number];

function local(ring: [number, number][], middle: Middle): Flat {
  return cleanRing(ring.map(([x, y]): [number, number] => [x - middle[0], y - middle[1]]));
}

function area(ring: Flat): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    twice += ax * by - bx * ay;
  }
  return twice / 2;
}

function slab(shell: Shell, ring: Flat, height: number): void {
  const low = height - SLAB;
  const top = insetRing(ring, BEVEL);
  shell.flat(ring, low, UNDER, true);
  if (top) {
    shell.walls(ring, low, height - BEVEL, ROOF);
    shell.bevel(ring, top, height - BEVEL, height, ROOF);
    shell.cap(top, height, ROOF);
  } else {
    shell.walls(ring, low, height, ROOF);
    shell.cap(ring, height, ROOF);
  }
}

function postsOf(ring: Flat): [number, number][] {
  const spots: [number, number][] = [];
  const count = ring.length;
  for (let i = 0; i < count; i += 1) {
    const prev = ring[(i + count - 1) % count];
    const here = ring[i];
    const next = ring[(i + 1) % count];
    const ax = here[0] - prev[0];
    const ay = here[1] - prev[1];
    const bx = next[0] - here[0];
    const by = next[1] - here[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const bend = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (bend >= CORNER) {
      let nx = -ay / la - by / lb;
      let ny = ax / la + bx / lb;
      const size = Math.hypot(nx, ny);
      if (size > 1e-6) {
        nx /= size;
        ny /= size;
        const reach = Math.min(1.2, POST_IN / Math.max(0.3, Math.cos(bend / 2)));
        spots.push([here[0] + nx * reach, here[1] + ny * reach]);
      }
    }
    if (lb > POST_EDGE) {
      const pieces = Math.max(2, Math.round(lb / POST_GAP));
      const nx = -by / lb;
      const ny = bx / lb;
      for (let k = 1; k < pieces; k += 1) {
        const share = k / pieces;
        spots.push([here[0] + bx * share + nx * POST_IN, here[1] + by * share + ny * POST_IN]);
      }
    }
  }
  const kept: [number, number][] = [];
  for (const spot of spots) {
    if (kept.every((other) => Math.hypot(other[0] - spot[0], other[1] - spot[1]) > 2)) kept.push(spot);
  }
  return kept.slice(0, 400);
}

function panels(shell: Shell, cover: Cover, ring: Flat): void {
  const height = cover.height + 0.02;
  const frame = frameOf(ring);
  const filled = Math.abs(area(ring)) >= frame.long * frame.short * 0.85;
  if (!filled) {
    const inner = insetRing(ring, 0.35);
    if (inner) shell.cap(inner, height, PANEL);
    return;
  }
  const long = frame.long - 0.6;
  const short = frame.short - 0.6;
  const columns = Math.max(1, Math.floor(long / (PANEL_WIDE + PANEL_GAP)));
  const rows = Math.max(1, Math.floor(short / (PANEL_LONG + PANEL_GAP)));
  const each = columns * rows <= PANEL_LIMIT;
  const startU = (-columns * (PANEL_WIDE + PANEL_GAP)) / 2;
  const startV = (-rows * (PANEL_LONG + PANEL_GAP)) / 2;
  const quad = (u0: number, v0: number, u1: number, v1: number) => {
    const corners = [at(frame, u0, v0), at(frame, u1, v0), at(frame, u1, v1), at(frame, u0, v1)];
    shell.face(corners.map((point) => lift(point, height)), [0, 1, 0], PANEL);
  };
  for (let row = 0; row < rows; row += 1) {
    const v0 = startV + row * (PANEL_LONG + PANEL_GAP);
    if (!each) {
      quad(startU, v0, startU + columns * (PANEL_WIDE + PANEL_GAP) - PANEL_GAP, v0 + PANEL_LONG);
      continue;
    }
    for (let column = 0; column < columns; column += 1) {
      const u0 = startU + column * (PANEL_WIDE + PANEL_GAP);
      quad(u0, v0, u0 + PANEL_WIDE, v0 + PANEL_LONG);
    }
  }
}

export function buildCovers(campus: Campus, middle: Middle): THREE.BufferGeometry | null {
  const covers = campus.covers ?? [];
  if (covers.length === 0) return null;
  const shell = new Shell(true);
  for (const cover of covers) {
    const ring = local(cover.ring, middle);
    if (ring.length < 3 || Math.abs(area(ring)) < 2) continue;
    slab(shell, ring, cover.height);
    for (const [x, y] of postsOf(ring)) {
      const [sx, , sz] = lift([x, y], 0);
      shell.post(sx, sz, 0, cover.height - SLAB + 0.02, POST, 6, STEEL);
    }
    if (cover.solar) panels(shell, cover, ring);
  }
  return shell.positions.length > 0 ? shell.geometry() : null;
}

function box(shell: Shell, corners: [number, number][], low: number, high: number, color: THREE.Color): void {
  const ring = area(corners) < 0 ? [...corners].reverse() : corners;
  shell.walls(ring, low, high, color);
  shell.cap(ring, high, color);
  shell.flat(ring, low, color, true);
}

export function buildDoors(campus: Campus, middle: Middle): THREE.BufferGeometry | null {
  const shell = new Shell(true);
  for (const thing of campus.things ?? []) {
    if (thing.kind !== 'door' && thing.kind !== 'main door') continue;
    let best = DOOR_REACH;
    let pick: { ax: number; ay: number; bx: number; by: number; ring: [number, number][]; height: number } | null = null;
    for (const block of campus.blocks) {
      if (!block.home || block.stand || floating(block) || block.height < 3) continue;
      for (let i = 0; i < block.ring.length; i += 1) {
        const [ax, ay] = block.ring[i];
        const [bx, by] = block.ring[(i + 1) % block.ring.length];
        const gap = segmentDistance(thing.x, thing.y, ax, ay, bx, by);
        if (gap < best && Math.hypot(bx - ax, by - ay) > 2.5) {
          best = gap;
          pick = { ax, ay, bx, by, ring: block.ring, height: block.height };
        }
      }
    }
    if (!pick) continue;
    const length = Math.hypot(pick.bx - pick.ax, pick.by - pick.ay);
    const ux = (pick.bx - pick.ax) / length;
    const uy = (pick.by - pick.ay) / length;
    let nx = uy;
    let ny = -ux;
    const share = Math.max(0, Math.min(1, ((thing.x - pick.ax) * ux + (thing.y - pick.ay) * uy) / length));
    const px = pick.ax + ux * share * length;
    const py = pick.ay + uy * share * length;
    if (insideRing(pick.ring, px + nx * 0.3, py + ny * 0.3)) {
      nx = -nx;
      ny = -ny;
    }
    const main = thing.kind === 'main door';
    const half = Math.min((main ? 3.6 : 1.9) / 2, length / 2 - 0.3);
    if (half < 0.5) continue;
    const tall = Math.min(main ? 2.8 : 2.3, pick.height - 0.6);
    const x = px - middle[0];
    const y = py - middle[1];
    const at = (along: number, out: number): [number, number] => [x + ux * along + nx * out, y + uy * along + ny * out];
    box(shell, [at(-half, -0.02), at(half, -0.02), at(half, 0.04), at(-half, 0.04)], 0, tall, DOOR);
    for (const side of [-1, 1]) box(shell, [at(side * half - 0.09, -0.02), at(side * half + 0.09, -0.02), at(side * half + 0.09, 0.16), at(side * half - 0.09, 0.16)], 0, tall + 0.1, TRIM);
    const reach = main ? 1.9 : 1.1;
    const wide = half + (main ? 0.6 : 0.35);
    const lift = Math.min(tall + 0.35, pick.height - 0.3);
    box(shell, [at(-wide, -0.02), at(wide, -0.02), at(wide, reach), at(-wide, reach)], lift - 0.16, lift, TRIM);
  }
  return shell.positions.length > 0 ? shell.geometry() : null;
}

export function buildStructures(campus: Campus, middle: Middle): THREE.BufferGeometry | null {
  const parts = [buildCovers(campus, middle), buildCoping(campus, middle), buildDoors(campus, middle)].filter((part): part is THREE.BufferGeometry => part !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

export function buildCoping(campus: Campus, middle: Middle): THREE.BufferGeometry | null {
  const shell = new Shell(true);
  for (const patch of campus.patches) {
    if (patch.label !== 'Pool' || patch.surface !== 'water') continue;
    const [cx, cy] = patch.ring.reduce((sum, point) => [sum[0] + point[0] / patch.ring.length, sum[1] + point[1] / patch.ring.length], [0, 0]);
    if (!atHome(campus, cx, cy)) continue;
    const ring = local(patch.ring, middle);
    if (ring.length < 3) continue;
    const outer = insetRing(ring, -COPING_WIDE);
    if (!outer) continue;
    shell.band(outer, ring, COPING_HIGH, COPING, [0, 1, 0]);
    for (let i = 0; i < ring.length; i += 1) {
      const j = (i + 1) % ring.length;
      const side = outward(ring[i], ring[j]);
      shell.face([lift(ring[i], 0), lift(ring[j], 0), lift(ring[j], COPING_HIGH), lift(ring[i], COPING_HIGH)], [-side[0], 0, -side[2]], COPING);
      const away = outward(outer[i], outer[j]);
      shell.face([lift(outer[i], 0), lift(outer[j], 0), lift(outer[j], COPING_HIGH), lift(outer[i], COPING_HIGH)], away, COPING);
    }
  }
  return shell.positions.length > 0 ? shell.geometry() : null;
}
