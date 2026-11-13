import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { atHome, type Campus } from '@/engine/campus';
import type { Yard } from './controller';
import { along, axisHeading, bandPads, courts, fields, lightPoles, onRoof, parkingStalls, thin, walkers, type Area } from './layout';
import { BLOB_LIFT, buildBlob } from './models';
import { TIERS, type PropLevel } from './quality';
import { keep, take } from './stages';

type Vec = [number, number, number];
type Placement = { x: number; y: number; heading: number; stretch?: number; color?: THREE.Color };
type Kind = 'cars' | 'poles' | 'nets' | 'posts' | 'goals' | 'people';
type Model = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial };

const CAR_SHARE = 0.52;
const CAR_LONG = 4.4;
const SMALLEST_PIXELS = 3;
const CAR_JITTER = 0.15;
const CAR_YAW = 0.035;
const CAR_BLOB_LONG = 5.2;
const CAR_BLOB_WIDE = 2.5;
const POLE_CAP = 60;
const NET_WIDTH = 12.8;
const NET_POST = 0.914;
const BAND_FILES = 10;
const BAND_ROWS = 6;
const BAND_GAP = 2.3;
const COURT_EVERY = 3;
const FIELD_PLAYERS = 22;
const CARS = ['#eeeeea', '#c8ced1', '#454d53', '#8ea2b6', '#b8a78f', '#a65f54', '#74917f'];
const CAR_WEIGHTS = [0.24, 0.22, 0.2, 0.09, 0.09, 0.08, 0.08];
const CLAY = ['#f3f1ea', '#e6d5c3', '#c3d0dc', '#bfd5d0', '#e2b7ae', '#d9d2c0'];
const BAND_UNIFORM = CLAY[2];
const BAND_FRONT = CLAY[0];
const TEAM_HOME = CLAY[0];
const TEAM_AWAY = CLAY[4];
const STEEL = '#56655f';
const NET = '#e8ece9';
const NET_PANEL = '#f2f4f1';
const NET_OPACITY = 0.42;
const GOAL = '#e3d59a';
const TYRE = 0.3;
const SILL = 0.62;
const GLASS: Vec = [0.3, 0.335, 0.37];
const KINDS: Kind[] = ['cars', 'poles', 'nets', 'posts', 'goals', 'people'];

function hash(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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

function pick(list: string[], weights: number[], share: number): string {
  let total = 0;
  for (const weight of weights) total += weight;
  let left = share * total;
  for (let index = 0; index < list.length; index += 1) {
    left -= weights[index] ?? 0;
    if (left < 0) return list[index];
  }
  return list[list.length - 1];
}

function facing(points: Vec[], centre: Vec): Vec | undefined {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay, az] = points[index];
    const [bx, by, bz] = points[(index + 1) % points.length];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
    mx += ax;
    my += ay;
    mz += az;
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return undefined;
  const count = points.length;
  const outward = nx * (mx / count - centre[0]) + ny * (my / count - centre[1]) + nz * (mz / count - centre[2]) >= 0 ? 1 : -1;
  return [(nx / length) * outward, (ny / length) * outward, (nz / length) * outward];
}

class Clay {
  positions: number[] = [];
  shades: number[] = [];
  normals: (Vec | undefined)[] = [];
  indices: number[] = [];

  vertex(point: Vec, shade: Vec, normal?: Vec): number {
    this.positions.push(point[0], point[1], point[2]);
    this.shades.push(shade[0], shade[1], shade[2]);
    this.normals.push(normal);
    return this.positions.length / 3 - 1;
  }

  private at(index: number): Vec {
    return [this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2]];
  }

  triangle(a: number, b: number, c: number, centre: Vec): void {
    const [ax, ay, az] = this.at(a);
    const [bx, by, bz] = this.at(b);
    const [cx, cy, cz] = this.at(c);
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const fx = cx - ax;
    const fy = cy - ay;
    const fz = cz - az;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const ox = (ax + bx + cx) / 3 - centre[0];
    const oy = (ay + by + cy) / 3 - centre[1];
    const oz = (az + bz + cz) / 3 - centre[2];
    if (nx * ox + ny * oy + nz * oz >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  face(points: Vec[], shade: number | Vec, centre: Vec): void {
    const tone: Vec = typeof shade === 'number' ? [shade, shade, shade] : shade;
    const normal = facing(points, centre);
    const ids = points.map((point) => this.vertex(point, tone, normal));
    for (let index = 1; index + 1 < ids.length; index += 1) this.triangle(ids[0], ids[index], ids[index + 1], centre);
  }

  loft(rings: Vec[][], shade: (segment: number, edge: number) => number | Vec, centre: Vec): void {
    for (let segment = 0; segment + 1 < rings.length; segment += 1) {
      const from = rings[segment];
      const to = rings[segment + 1];
      for (let edge = 0; edge < from.length; edge += 1) {
        const next = (edge + 1) % from.length;
        this.face([from[edge], from[next], to[next], to[edge]], shade(segment, edge), centre);
      }
    }
  }

  box(low: Vec, high: Vec, shade: number | Vec): void {
    const [x0, y0, z0] = low;
    const [x1, y1, z1] = high;
    const bottom: Vec[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    const top: Vec[] = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const centre: Vec = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.loft([bottom, top], () => shade, centre);
    this.face(bottom, shade, centre);
    this.face(top, shade, centre);
  }

  tube(from: Vec, to: Vec, radius: number, sides: number, shade: number | Vec): void {
    const axis = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const other = new THREE.Vector3().crossVectors(axis, side).normalize();
    const ring = (base: Vec): Vec[] =>
      Array.from({ length: sides }, (_, step) => {
        const angle = (step / sides) * Math.PI * 2;
        const c = Math.cos(angle) * radius;
        const s = Math.sin(angle) * radius;
        return [base[0] + side.x * c + other.x * s, base[1] + side.y * c + other.y * s, base[2] + side.z * c + other.z * s];
      });
    const start = ring(from);
    const end = ring(to);
    const centre: Vec = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    this.loft([start, end], () => shade, centre);
    this.face(start, shade, centre);
    this.face(end, shade, centre);
  }

  lathe(profile: [number, number][], sides: number, depth: number, shade: number): void {
    const tone: Vec = [shade, shade, shade];
    let low = Infinity;
    let high = -Infinity;
    for (const [y] of profile) {
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    const centre: Vec = [0, (low + high) / 2, 0];
    const rows = profile.map(([y, radius]) => {
      if (radius <= 0) return [this.vertex([0, y, 0], tone)];
      return Array.from({ length: sides }, (_, step) => {
        const angle = ((step + 0.5) / sides) * Math.PI * 2;
        return this.vertex([Math.cos(angle) * radius * depth, y, Math.sin(angle) * radius], tone);
      });
    });
    for (let row = 0; row + 1 < rows.length; row += 1) {
      const a = rows[row];
      const b = rows[row + 1];
      for (let step = 0; step < sides; step += 1) {
        const next = (step + 1) % sides;
        if (a.length === 1) this.triangle(a[0], b[step], b[next], centre);
        else if (b.length === 1) this.triangle(a[step], a[next], b[0], centre);
        else {
          this.triangle(a[step], a[next], b[next], centre);
          this.triangle(a[step], b[next], b[step], centre);
        }
      }
    }
  }

  geometry(colored: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (colored) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.shades, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal');
    this.normals.forEach((flat, index) => {
      if (flat) normal.setXYZ(index, flat[0], flat[1], flat[2]);
    });
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

function section(x: number, half: number, top: number, bottom: number): Vec[] {
  return [
    [x, bottom, -half * 0.93],
    [x, 0.42, -half],
    [x, top, -(half - 0.1)],
    [x, top, half - 0.1],
    [x, 0.42, half],
    [x, bottom, half * 0.93],
  ];
}

function rectangle(y: number, back: number, front: number, half: number): Vec[] {
  return [
    [back, y, -half],
    [front, y, -half],
    [front, y, half],
    [back, y, half],
  ];
}

function buildCar(): THREE.BufferGeometry {
  const clay = new Clay();
  const rings = [
    section(-2.2, 0.8, 0.76, 0.18),
    section(-2.1, 0.9, 0.86, 0.08),
    section(-1.72, 0.9, 0.88, 0.07),
    section(-0.98, 0.9, 0.88, 0.07),
    section(0.98, 0.9, 0.88, 0.07),
    section(1.72, 0.9, 0.82, 0.07),
    section(2.1, 0.9, 0.74, 0.08),
    section(2.2, 0.8, 0.66, 0.2),
  ];
  const middle: Vec = [0, 0.5, 0];
  clay.loft(
    rings,
    (segment, edge) => {
      if (edge === 5) return TYRE;
      if (edge === 0 || edge === 4) return segment === 2 || segment === 4 ? TYRE : SILL;
      return 1;
    },
    middle,
  );
  for (const ring of [rings[0], rings[rings.length - 1]]) {
    clay.face([ring[0], ring[1], ring[4], ring[5]], SILL, middle);
    clay.face([ring[1], ring[2], ring[3], ring[4]], 1, middle);
  }
  const sill = rectangle(0.86, -1.62, 0.98, 0.8);
  const belt = rectangle(1.29, -1.32, 0.3, 0.68);
  const roof = rectangle(1.45, -1.24, 0.2, 0.62);
  const cabin: Vec = [-0.4, 1.15, 0];
  clay.loft([sill, belt], () => GLASS, cabin);
  clay.face(sill, GLASS, cabin);
  clay.loft([belt, roof], () => 1, cabin);
  clay.face(roof, 1, cabin);
  return clay.geometry(true);
}

function buildPole(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.tube([0, 0, 0], [0, 7.5, 0], 0.09, 6, 1);
  clay.box([0, 7.26, -0.035], [1.25, 7.34, 0.035], 1);
  clay.box([0.85, 7.16, -0.17], [1.6, 7.28, 0.17], 1);
  return clay.geometry(false);
}

function slab(clay: Clay, from: number, to: number, low: (z: number) => number, high: (z: number) => number, thick: number, shade: number): void {
  const ring = (z: number): Vec[] => [
    [-thick, low(z), z],
    [thick, low(z), z],
    [thick, high(z), z],
    [-thick, high(z), z],
  ];
  const start = ring(from);
  const end = ring(to);
  const centre: Vec = [0, (low(from) + high(from) + low(to) + high(to)) / 4, (from + to) / 2];
  clay.loft([start, end], () => shade, centre);
  clay.face(start, shade, centre);
  clay.face(end, shade, centre);
}

const NET_HALF = NET_WIDTH / 2;
const NET_EDGE = NET_HALF - 0.04;
const NET_HALVES = [
  [-NET_EDGE, 0],
  [0, NET_EDGE],
];

function netTop(z: number): number {
  return 0.914 + (1.07 - 0.914) * Math.abs(z / NET_HALF);
}

function netTape(z: number): number {
  return netTop(z) - 0.06;
}

function buildNetPanel(): THREE.BufferGeometry {
  const clay = new Clay();
  for (const [from, to] of NET_HALVES) slab(clay, from, to, () => 0.03, netTape, 0.02, 1);
  return clay.geometry(false);
}

function buildNetFrame(): THREE.BufferGeometry {
  const clay = new Clay();
  for (const [from, to] of NET_HALVES) slab(clay, from, to, netTape, netTop, 0.025, 1);
  clay.tube([0, 0, -NET_HALF], [0, 1.07, -NET_HALF], 0.04, 6, 0.86);
  clay.tube([0, 0, NET_HALF], [0, 1.07, NET_HALF], 0.04, 6, 0.86);
  return clay.geometry(true);
}

function buildGoal(): THREE.BufferGeometry {
  const clay = new Clay();
  const radius = 0.07;
  clay.tube([0, 0, 0], [0, 3, 0], radius, 6, 1);
  clay.tube([0, 3, -2.8], [0, 3, 2.8], radius, 6, 1);
  clay.tube([0, 3, -2.8], [0, 9, -2.8], radius, 6, 1);
  clay.tube([0, 3, 2.8], [0, 9, 2.8], radius, 6, 1);
  return clay.geometry(false);
}

function buildPerson(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.lathe(
    [
      [0, 0],
      [0.02, 0.11],
      [0.82, 0.155],
      [1.3, 0.205],
      [1.42, 0.12],
      [1.47, 0],
    ],
    6,
    0.62,
    1,
  );
  const head = 1.585;
  const size = 0.115;
  clay.lathe(
    [
      [head - size, 0],
      [head - size * 0.5, size * 0.87],
      [head + size * 0.5, size * 0.87],
      [head + size, 0],
    ],
    6,
    0.92,
    1,
  );
  return clay.geometry(false);
}

function material(color: string, shaded: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, vertexColors: shaded, roughness: 0.95, metalness: 0 });
}

function sheer(color: string, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, roughness: 0.95, metalness: 0 });
}

function buildModels(): Record<Kind, Model> {
  return {
    cars: { geometry: buildCar(), material: material('#ffffff', true) },
    poles: { geometry: buildPole(), material: material(STEEL, false) },
    nets: { geometry: buildNetPanel(), material: sheer(NET_PANEL, NET_OPACITY) },
    posts: { geometry: buildNetFrame(), material: material(NET, true) },
    goals: { geometry: buildGoal(), material: material(GOAL, false) },
    people: { geometry: buildPerson(), material: material('#ffffff', false) },
  };
}

function courtLines(court: Area): { half: number; side: number } | null {
  const half = Math.min(11.89, court.long / 2 - 2.5);
  const side = Math.min(5.49, court.short / 2 - 1.5);
  return half < 4 || side < 2 ? null : { half, side };
}

function fieldEnds(field: Area): number | null {
  const half = Math.min(field.long / 2 - 1, 54.86);
  const side = Math.min(field.short / 2 - 1, 24.38);
  return half < 20 || side < 10 ? null : half;
}

function free(campus: Campus, x: number, y: number): boolean {
  return atHome(campus, x, y) && !onRoof(campus, x, y);
}

function homeAreas(campus: Campus, list: Area[]): Area[] {
  return list.filter((area) => free(campus, area.x, area.y));
}

function clayTone(random: () => number): THREE.Color {
  return new THREE.Color(CLAY[Math.floor(random() * CLAY.length) % CLAY.length]);
}

function placeCars(yard: Yard, cap: number): Placement[] {
  const chosen = parkingStalls(yard.campus)
    .map((stall) => ({ stall, roll: hash(Math.round(stall.x * 8), Math.round(stall.y * 8), 11) }))
    .filter((item) => item.roll < CAR_SHARE && free(yard.campus, item.stall.x, item.stall.y))
    .sort((a, b) => a.roll - b.roll)
    .slice(0, cap);
  return chosen.map(({ stall }) => {
    const random = seeded(Math.round(stall.x * 8) * 7919 + Math.round(stall.y * 8) * 104729);
    const turn = random() * Math.PI * 2;
    const reach = random() * CAR_JITTER;
    const flip = random() < 0.5 ? Math.PI : 0;
    return {
      x: stall.x + Math.cos(turn) * reach,
      y: stall.y + Math.sin(turn) * reach,
      heading: stall.heading + flip + (random() * 2 - 1) * CAR_YAW,
      color: new THREE.Color(pick(CARS, CAR_WEIGHTS, random())),
    };
  });
}

function placePoles(yard: Yard): Placement[] {
  const poles = lightPoles(yard.campus).filter((pole) => free(yard.campus, pole.x, pole.y));
  return thin(poles, POLE_CAP).map((pole, index) => ({ x: pole.x, y: pole.y, heading: pole.heading + (index % 2 === 0 ? 0 : Math.PI) }));
}

function placeNets(yard: Yard): Placement[] {
  const result: Placement[] = [];
  for (const court of homeAreas(yard.campus, courts(yard.campus))) {
    const lines = courtLines(court);
    if (!lines) continue;
    const width = Math.min(NET_WIDTH, 2 * (lines.side + NET_POST));
    result.push({ x: court.x, y: court.y, heading: axisHeading(court), stretch: width / NET_WIDTH });
  }
  return result;
}

function placeGoals(yard: Yard): Placement[] {
  const result: Placement[] = [];
  for (const field of homeAreas(yard.campus, fields(yard.campus))) {
    const half = fieldEnds(field);
    if (half === null) continue;
    for (const end of [-1, 1]) {
      const [x, y] = along(field, end * half, 0);
      if (free(yard.campus, x, y)) result.push({ x, y, heading: axisHeading(field) });
    }
  }
  return result;
}

function placePeople(yard: Yard, light: boolean): Placement[] {
  const result: Placement[] = [];
  const campus = yard.campus;
  const add = (x: number, y: number, heading: number, color: THREE.Color) => {
    if (free(campus, x, y)) result.push({ x, y, heading, color });
  };
  homeAreas(campus, bandPads(campus)).forEach((pad, padIndex) => {
    const rows = light ? BAND_ROWS / 2 : BAND_ROWS;
    if (pad.long < (BAND_FILES - 1) * BAND_GAP + 2 || pad.short < (BAND_ROWS - 1) * BAND_GAP + 2) return;
    const random = seeded(4049 + padIndex * 31);
    const facing = axisHeading(pad) + Math.PI / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let file = 0; file < BAND_FILES; file += 1) {
        const [x, y] = along(pad, (file - (BAND_FILES - 1) / 2) * BAND_GAP, (row - (rows - 1) / 2) * BAND_GAP);
        add(x, y, facing + (random() * 2 - 1) * 0.05, new THREE.Color(row === rows - 1 ? BAND_FRONT : BAND_UNIFORM));
      }
    }
  });
  homeAreas(campus, courts(campus)).forEach((court, courtIndex) => {
    if (courtIndex % COURT_EVERY !== 0) return;
    const lines = courtLines(court);
    if (!lines) return;
    const random = seeded(7331 + courtIndex * 97);
    const players = light ? [1] : [-1, 1];
    for (const end of players) {
      const u = end * lines.half * (0.72 + random() * 0.14);
      const v = (random() * 2 - 1) * lines.side * 0.55;
      const [x, y] = along(court, u, v);
      add(x, y, axisHeading(court) + (end > 0 ? Math.PI : 0), clayTone(random));
    }
  });
  homeAreas(campus, fields(campus)).forEach((field, fieldIndex) => {
    const random = seeded(9157 + fieldIndex * 131);
    const count = light ? FIELD_PLAYERS / 2 : FIELD_PLAYERS;
    const spots: [number, number][] = [];
    for (let player = 0; player < count; player += 1) {
      const team = player % 2 === 0 ? -1 : 1;
      let u = 0;
      let v = 0;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        u = team * (1.6 + random() * 6.5);
        v = (random() * 2 - 1) * 11;
        if (spots.every(([su, sv]) => Math.hypot(su - u, sv - v) > 1.6)) break;
      }
      spots.push([u, v]);
      const [x, y] = along(field, u, v);
      add(x, y, axisHeading(field) + (team > 0 ? Math.PI : 0) + (random() * 2 - 1) * 0.6, new THREE.Color(team > 0 ? TEAM_HOME : TEAM_AWAY));
    }
  });
  walkers(campus, (x, y) => free(campus, x, y)).forEach((walker, index) => {
    if (light && index % 2 === 1) return;
    const random = seeded(12011 + index * 53);
    add(walker.x, walker.y, walker.heading + (index % 3 === 0 ? Math.PI : 0), clayTone(random));
  });
  return result;
}

function instanced(yard: Yard, model: Model, items: Placement[], shadows: boolean): THREE.InstancedMesh | null {
  if (items.length === 0) return null;
  const mesh = new THREE.InstancedMesh(model.geometry, model.material, items.length);
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const spot = new THREE.Vector3();
  const size = new THREE.Vector3();
  items.forEach((item, index) => {
    const [x, , z] = yard.toScene(item.x, item.y);
    spot.set(x, 0, z);
    turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.heading);
    size.set(1, 1, item.stretch ?? 1);
    matrix.compose(spot, turn, size);
    mesh.setMatrixAt(index, matrix);
    if (item.color) mesh.setColorAt(index, item.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

function blobs(yard: Yard, blob: ReturnType<typeof buildBlob>, cars: Placement[]): THREE.InstancedMesh | null {
  if (cars.length === 0) return null;
  const mesh = new THREE.InstancedMesh(blob.geometry, blob.material, cars.length);
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const spot = new THREE.Vector3();
  const size = new THREE.Vector3(CAR_BLOB_LONG, 1, CAR_BLOB_WIDE);
  cars.forEach((car, index) => {
    const [x, , z] = yard.toScene(car.x, car.y);
    spot.set(x, BLOB_LIFT, z);
    turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, car.heading);
    matrix.compose(spot, turn, size);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = -1;
  mesh.name = 'blobs';
  mesh.matrixAutoUpdate = false;
  mesh.computeBoundingSphere();
  return mesh;
}

function placeAll(yard: Yard, level: NonNullable<PropLevel>): Record<Kind, Placement[]> {
  const nets = placeNets(yard);
  return {
    cars: placeCars(yard, level.cars),
    poles: placePoles(yard),
    nets,
    posts: nets,
    goals: placeGoals(yard),
    people: thin(placePeople(yard, level.light), level.people),
  };
}

function placedKey(level: NonNullable<PropLevel>): string {
  return `props ${level.cars} ${level.people} ${level.light}`;
}

export function primeProps(yard: Yard, level: PropLevel = TIERS.high.props): void {
  if (level) keep(yard, placedKey(level), () => placeAll(yard, level));
}

export function Props({ yard, level = TIERS.high.props }: { yard: Yard; level?: PropLevel }) {
  const models = useMemo(buildModels, []);
  const blob = useMemo(buildBlob, []);
  useEffect(
    () => () => {
      for (const kind of KINDS) {
        models[kind].geometry.dispose();
        models[kind].material.dispose();
      }
      blob.geometry.dispose();
      blob.material.dispose();
    },
    [models, blob],
  );
  const meshes = useMemo(() => {
    if (!level) return [];
    const placed = take(yard, placedKey(level), () => placeAll(yard, level));
    const shades = blobs(yard, blob, placed.cars);
    return [
      ...KINDS.flatMap((kind) => {
        const mesh = instanced(yard, models[kind], placed[kind], level.shadows);
        if (mesh && models[kind].material.transparent) mesh.renderOrder = 2;
        return mesh ? [{ kind: kind as string, mesh }] : [];
      }),
      ...(shades ? [{ kind: 'car shades', mesh: shades }] : []),
    ];
  }, [yard, level, models, blob]);
  useEffect(
    () => () => {
      for (const { mesh } of meshes) mesh.dispose();
    },
    [meshes],
  );
  const reach = useMemo(() => {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) {
      if (!mesh.boundingBox) mesh.computeBoundingBox();
      if (mesh.boundingBox) box.union(mesh.boundingBox);
    }
    return { box, shown: true };
  }, [meshes]);
  useFrame((state) => {
    if (meshes.length === 0) return;
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 30;
    const zoom = camera.isPerspectiveCamera ? camera.zoom : 1;
    const distance = Math.max(reach.box.distanceToPoint(camera.position), 1e-3);
    const pixels = (CAR_LONG * state.gl.domElement.height * zoom) / (2 * Math.tan((fov * Math.PI) / 360) * distance);
    const shown = pixels >= SMALLEST_PIXELS;
    if (shown === reach.shown) return;
    reach.shown = shown;
    for (const { mesh } of meshes) mesh.visible = shown;
  });
  if (!level) return null;
  return (
    <group name="props">
      {meshes.map(({ kind, mesh }) => (
        <primitive key={kind} object={mesh} raycast={() => null} />
      ))}
    </group>
  );
}
