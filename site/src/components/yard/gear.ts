import * as THREE from 'three';
import { atHome, type Campus, type Patch, type Thing } from '@/engine/campus';
import { insideRing, ringArea, ringDistance, segmentDistance, type Point, type Ring } from '@/engine/geometry';
import { at, courtFences, frameOf, layoutOf, type Gear } from '@/engine/sports';
import { Clay, type Vec } from './clay';
import { onRoof } from './layout';

export type Furnished = { model: string; x: number; y: number; heading: number; scale?: Vec };
export type GearMeshes = { solid: THREE.BufferGeometry | null; sheer: THREE.BufferGeometry | null; uprights: Gear[]; nets: Gear[]; lamps: { x: number; y: number; heading: number }[]; furniture: Furnished[] };

type Middle = [number, number];
type Pair = { solid: THREE.BufferGeometry; sheer: THREE.BufferGeometry | null };

function tone(hex: string): Vec {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

const WHITE = tone('#f3f1ea');
const STEEL = tone('#56655f');
const RAIL = tone('#7c8984');
const RIM = tone('#d98a5f');
const SQUARE = tone('#8e9a96');
const NET = tone('#f2f4f1');
const CHAIN = tone('#b5bfbb');
const FLAG = tone('#c9796a');
const WOOD = tone('#d2b691');
const WALL = tone('#ddd5c6');
const HEDGE = tone('#62835e');
const HEDGE_TOP = tone('#749670');
const PLAY_RED = tone('#e2a99c');
const PLAY_BLUE = tone('#a9bfd3');
const PLAY_TEAL = tone('#9fc7be');
const PLAY_YELLOW = tone('#e8d48f');
const PLAY_SAND = tone('#e6d5c3');
const DARK = tone('#56605d');

const FENCE_POST_GAP = 3;
const COURT_FENCE = 3;
const MOST_POSTS = 3000;
const HOME_REACH = 4;
const PLAY_AREA = 120;
const PLAY_MOST = 6;

class Merger {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  private spot = new THREE.Vector3();
  private turn = new THREE.Matrix3();

  add(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const place = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    const index = geometry.getIndex();
    const base = this.positions.length / 3;
    if (matrix) this.turn.getNormalMatrix(matrix);
    for (let i = 0; i < place.count; i += 1) {
      this.spot.fromBufferAttribute(place, i);
      if (matrix) this.spot.applyMatrix4(matrix);
      this.positions.push(this.spot.x, this.spot.y, this.spot.z);
      this.spot.fromBufferAttribute(normal, i);
      if (matrix) this.spot.applyMatrix3(this.turn).normalize();
      this.normals.push(this.spot.x, this.spot.y, this.spot.z);
      if (color) this.colors.push(color.getX(i), color.getY(i), color.getZ(i));
      else this.colors.push(1, 1, 1);
    }
    if (index) for (let i = 0; i < index.count; i += 1) this.indices.push(index.getX(i) + base);
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

function ring(at: Vec, radius: number, steps: number, height: number, from: number, to: number): Vec[] {
  const points: Vec[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = from + ((to - from) * step) / steps;
    points.push([at[0] + Math.cos(angle) * radius, at[1] + height, at[2] + Math.sin(angle) * radius]);
  }
  return points;
}

function tubes(clay: Clay, points: Vec[], radius: number, sides: number, shade: Vec): void {
  for (let i = 0; i + 1 < points.length; i += 1) clay.tube(points[i], points[i + 1], radius, sides, shade, false);
}

function plate(clay: Clay, corners: Vec[], thick: number, shade: Vec): void {
  const [a, b, c] = corners;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const vz = c[2] - b[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const size = Math.hypot(nx, ny, nz) || 1;
  nx = (nx / size) * thick * 0.5;
  ny = (ny / size) * thick * 0.5;
  nz = (nz / size) * thick * 0.5;
  const front = corners.map((p): Vec => [p[0] + nx, p[1] + ny, p[2] + nz]);
  const back = corners.map((p): Vec => [p[0] - nx, p[1] - ny, p[2] - nz]);
  const centre: Vec = corners.reduce((sum, p) => [sum[0] + p[0] / corners.length, sum[1] + p[1] / corners.length, sum[2] + p[2] / corners.length], [0, 0, 0] as Vec);
  clay.loft([back, front], () => shade, centre);
  clay.face(front, shade, centre);
  clay.face(back, shade, centre);
}

function hoop(): Pair {
  const solid = new Clay();
  solid.tube([0, 0, 0], [0, 3.42, 0], 0.09, 8, STEEL);
  solid.box([-0.05, 3.28, -0.05], [1.8, 3.38, 0.05], STEEL);
  solid.box([1.78, 2.9, -0.915], [1.84, 3.97, 0.915], WHITE);
  for (const [z0, z1, y0, y1] of [
    [-0.3, 0.3, 3.03, 3.08],
    [-0.3, 0.3, 3.45, 3.5],
    [-0.3, -0.25, 3.03, 3.5],
    [0.25, 0.3, 3.03, 3.5],
  ]) {
    solid.box([1.845, y0, z0], [1.86, y1, z1], SQUARE);
  }
  const middle: Vec = [2.07 + 0.229, 0, 0];
  solid.box([1.84, 3.03, -0.06], [2.08, 3.06, 0.06], RIM);
  tubes(solid, ring(middle, 0.229, 10, 3.05, 0, Math.PI * 2), 0.018, 4, RIM);
  const sheer = new Clay();
  const top = ring(middle, 0.22, 8, 3.04, 0, Math.PI * 2).slice(0, 8);
  const bottom = ring(middle, 0.14, 8, 2.62, 0, Math.PI * 2).slice(0, 8);
  sheer.loft([top, bottom], () => NET, [middle[0], 2.85, 0]);
  return { solid: solid.geometry(true), sheer: sheer.geometry(true) };
}

function soccerGoal(): Pair {
  const solid = new Clay();
  const half = 3.66;
  const tall = 2.44;
  const deep = 2;
  const lean = 0.9;
  for (const z of [-half, half]) {
    solid.tube([0, 0, z], [0, tall, z], 0.06, 8, WHITE);
    tubes(solid, [[0, tall, z], [-lean, tall - 0.25, z], [-deep, 0.02, z]], 0.025, 4, WHITE);
    solid.tube([0, 0.02, z], [-deep, 0.02, z], 0.025, 4, WHITE, false);
  }
  solid.tube([0, tall, -half - 0.06], [0, tall, half + 0.06], 0.06, 8, WHITE);
  solid.tube([-deep, 0.02, -half], [-deep, 0.02, half], 0.025, 4, WHITE, false);
  const sheer = new Clay();
  sheer.face([[0, tall, -half], [0, tall, half], [-lean, tall - 0.25, half], [-lean, tall - 0.25, -half]], NET, [-1, 1, 0]);
  sheer.face([[-lean, tall - 0.25, -half], [-lean, tall - 0.25, half], [-deep, 0, half], [-deep, 0, -half]], NET, [-1, 1, 0]);
  for (const z of [-half, half]) sheer.face([[0, 0, z], [0, tall, z], [-lean, tall - 0.25, z], [-deep, 0, z]], NET, [-1, 1, 0]);
  return { solid: solid.geometry(true), sheer: sheer.geometry(true) };
}

function volleyNet(): Pair {
  const solid = new Clay();
  for (const z of [-5.5, 5.5]) solid.tube([0, 0, z], [0, 2.55, z], 0.05, 8, STEEL);
  solid.box([-0.012, 2.25, -4.75], [0.012, 2.3, 4.75], WHITE);
  solid.box([-0.008, 1.27, -4.75], [0.008, 1.3, 4.75], WHITE);
  for (const z of [-1, 1]) tubes(solid, [[0, 2.3, z * 4.75], [0, 2.4, z * 5.5]], 0.008, 3, WHITE);
  const sheer = new Clay();
  plate(sheer, [[0, 1.3, -4.75], [0, 1.3, 4.75], [0, 2.25, 4.75], [0, 2.25, -4.75]], 0.01, NET);
  return { solid: solid.geometry(true), sheer: sheer.geometry(true) };
}

function pickleNet(): Pair {
  const solid = new Clay();
  const half = 3.35;
  for (const z of [-half, half]) solid.tube([0, 0, z], [0, 0.95, z], 0.04, 6, STEEL);
  const top = (z: number) => 0.864 + (0.914 - 0.864) * Math.abs(z / half);
  const sheer = new Clay();
  for (const [from, to] of [
    [-half + 0.04, 0],
    [0, half - 0.04],
  ]) {
    solid.box([-0.02, top(from) - 0.05, from], [0.02, top(from), to], WHITE);
    plate(sheer, [[0, 0.04, from], [0, 0.04, to], [0, top(to) - 0.05, to], [0, top(from) - 0.05, from]], 0.01, NET);
  }
  return { solid: solid.geometry(true), sheer: sheer.geometry(true) };
}

function flagpole(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.tube([0, 0, 0], [0, 9, 0], 0.065, 8, WHITE);
  clay.lathe(
    [
      [-0.1, 0],
      [-0.05, 0.08],
      [0.05, 0.08],
      [0.1, 0],
    ],
    6,
    1,
    WHITE,
    [0, 9.05, 0],
  );
  clay.box([0.07, 7.75, -0.012], [1.57, 8.65, 0.012], FLAG);
  clay.lathe(
    [
      [0, 0.32],
      [0.25, 0.3],
      [0.3, 0],
    ],
    8,
    1,
    WALL,
  );
  return clay.geometry(true);
}

function bench(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.box([-0.9, 0.42, -0.2], [0.9, 0.47, 0.2], WOOD);
  clay.box([-0.9, 0.55, 0.18], [0.9, 0.85, 0.23], WOOD);
  for (const x of [-0.75, 0.75]) {
    clay.box([x - 0.03, 0, -0.18], [x + 0.03, 0.42, 0.18], STEEL);
    clay.box([x - 0.03, 0.42, 0.17], [x + 0.03, 0.86, 0.21], STEEL);
  }
  return clay.geometry(true);
}

function bikes(): THREE.BufferGeometry {
  const clay = new Clay();
  for (let index = 0; index < 5; index += 1) {
    const x = (index - 2) * 0.8;
    tubes(
      clay,
      [
        [x, 0, -0.32],
        [x, 0.72, -0.32],
        [x, 0.84, -0.2],
        [x, 0.84, 0.2],
        [x, 0.72, 0.32],
        [x, 0, 0.32],
      ],
      0.025,
      4,
      RAIL,
    );
  }
  return clay.geometry(true);
}

function lamp(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.tube([0, 0, 0], [0, 7.5, 0], 0.09, 6, STEEL);
  clay.box([0, 7.26, -0.035], [1.25, 7.34, 0.035], STEEL);
  clay.box([0.85, 7.16, -0.17], [1.6, 7.28, 0.17], STEEL);
  return clay.geometry(true);
}

function slideTower(): THREE.BufferGeometry {
  const clay = new Clay();
  const s = 0.75;
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ]) {
    clay.tube([x, 0, z], [x, 2.45, z], 0.06, 6, PLAY_BLUE);
  }
  clay.box([-s, 1.15, -s], [s, 1.25, s], PLAY_SAND);
  const roof: Vec[] = [
    [-s - 0.15, 2.45, -s - 0.15],
    [s + 0.15, 2.45, -s - 0.15],
    [s + 0.15, 2.45, s + 0.15],
    [-s - 0.15, 2.45, s + 0.15],
  ];
  const peak: Vec = [0, 3.05, 0];
  for (let i = 0; i < 4; i += 1) clay.face([roof[i], roof[(i + 1) % 4], peak], PLAY_RED, [0, 2.6, 0]);
  clay.face(roof, PLAY_RED, [0, 2.8, 0]);
  for (const z of [-s, s]) clay.box([-s, 1.25, z - 0.03], [s, 1.95, z + 0.03], PLAY_TEAL);
  const chute: Vec[] = [
    [s, 1.2, -0.3],
    [3.4, 0.3, -0.3],
    [3.4, 0.3, 0.3],
    [s, 1.2, 0.3],
  ];
  plate(clay, chute, 0.06, PLAY_YELLOW);
  for (const z of [-0.33, 0.33]) plate(clay, [[s, 1.2, z], [3.4, 0.3, z], [3.4, 0.5, z], [s, 1.4, z]], 0.04, PLAY_YELLOW);
  for (const z of [-0.3, 0.3]) clay.tube([-s, 1.2, z], [-1.9, 0, z], 0.035, 4, PLAY_BLUE);
  for (let step = 1; step <= 3; step += 1) {
    const share = step / 4;
    const x = -s + (-1.9 + s) * share;
    const y = 1.2 * (1 - share);
    clay.tube([x, y, -0.3], [x, y, 0.3], 0.025, 4, PLAY_BLUE, false);
  }
  return clay.geometry(true);
}

function swingSet(): THREE.BufferGeometry {
  const clay = new Clay();
  for (const z of [-1.9, 1.9]) {
    clay.tube([-1, 0, z], [0, 2.4, z], 0.055, 6, PLAY_BLUE);
    clay.tube([1, 0, z], [0, 2.4, z], 0.055, 6, PLAY_BLUE);
  }
  clay.tube([0, 2.4, -2], [0, 2.4, 2], 0.06, 6, PLAY_BLUE);
  for (const z of [-0.75, 0.75]) {
    for (const side of [-0.22, 0.22]) clay.tube([0, 2.38, z + side], [0, 0.5, z + side], 0.012, 3, DARK, false);
    clay.box([-0.12, 0.45, z - 0.25], [0.12, 0.5, z + 0.25], DARK);
  }
  return clay.geometry(true);
}

function dome(): THREE.BufferGeometry {
  const clay = new Clay();
  const radius = 1.8;
  for (let arch = 0; arch < 4; arch += 1) {
    const angle = (arch / 4) * Math.PI;
    const points: Vec[] = [];
    for (let step = 0; step <= 10; step += 1) {
      const t = (step / 10) * Math.PI;
      const flat = Math.cos(t) * radius;
      points.push([Math.cos(angle) * flat, Math.sin(t) * radius, Math.sin(angle) * flat]);
    }
    tubes(clay, points, 0.035, 4, arch % 2 === 0 ? PLAY_RED : PLAY_TEAL);
  }
  for (const lift of [0.75, 1.4]) {
    const flat = Math.sqrt(radius * radius - lift * lift);
    tubes(clay, ring([0, 0, 0], flat, 12, lift, 0, Math.PI * 2), 0.03, 4, PLAY_YELLOW);
  }
  return clay.geometry(true);
}

function springRider(): THREE.BufferGeometry {
  const clay = new Clay();
  clay.lathe(
    [
      [0, 0.18],
      [0.04, 0.18],
      [0.06, 0.07],
      [0.32, 0.07],
      [0.36, 0.1],
      [0.38, 0],
    ],
    8,
    1,
    STEEL,
  );
  clay.lathe(
    [
      [0, 0],
      [0.06, 0.12],
      [0.2, 0.17],
      [0.32, 0.12],
      [0.38, 0],
    ],
    8,
    2,
    PLAY_YELLOW,
    [0, 0.36, 0],
  );
  clay.lathe(
    [
      [0, 0],
      [0.05, 0.1],
      [0.17, 0.11],
      [0.24, 0],
    ],
    8,
    1,
    PLAY_YELLOW,
    [0.3, 0.6, 0],
  );
  clay.tube([0.18, 0.7, -0.16], [0.18, 0.7, 0.16], 0.02, 4, PLAY_RED);
  return clay.geometry(true);
}

type Models = {
  hoop: Pair;
  soccer: Pair;
  volley: Pair;
  pickle: Pair;
  flagpole: THREE.BufferGeometry;
  bench: THREE.BufferGeometry;
  bikes: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  play: THREE.BufferGeometry[];
};

let models: Models | null = null;

function modelsOf(): Models {
  if (!models) {
    models = {
      hoop: hoop(),
      soccer: soccerGoal(),
      volley: volleyNet(),
      pickle: pickleNet(),
      flagpole: flagpole(),
      bench: bench(),
      bikes: bikes(),
      lamp: lamp(),
      play: [slideTower(), swingSet(), dome(), springRider()],
    };
  }
  return models;
}

const PLAY_REACH = [2.6, 2.6, 2.1, 0.7];
const BIKE_STRETCH = 1.23;

export function playModel(kind: number, x: number, y: number): { model: string; turn: number } {
  if (kind === 0) return { model: 'play-slide', turn: Math.PI / 2 };
  if (kind === 1) return { model: 'play-swings', turn: 0 };
  if (kind === 2) {
    const mixed = Math.imul(Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(y * 10), 19349663), 0x45d9f3b);
    return { model: ((mixed ^ (mixed >>> 16)) >>> 0) % 2 === 1 ? 'play-monkeybars' : 'play-climber', turn: 0 };
  }
  return { model: 'play-seesaw', turn: 0 };
}
const PLAY_ORDER = [0, 1, 2, 3, 3, 3];

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

export function playPieces(patch: Patch, seed: number, avoid: Ring[] = []): { kind: number; x: number; y: number; heading: number }[] {
  const area = ringArea(patch.ring);
  const wanted = Math.min(PLAY_MOST, Math.floor(area / PLAY_AREA));
  if (wanted < 1) return [];
  const frame = frameOf(patch.ring);
  const random = seeded(seed);
  const spots: Point[] = [];
  for (let u = -frame.long / 2 + 1.5; u <= frame.long / 2 - 1.5; u += 1.5) {
    for (let v = -frame.short / 2 + 1.5; v <= frame.short / 2 - 1.5; v += 1.5) spots.push(at(frame, u, v));
  }
  for (let i = spots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const placed: { kind: number; x: number; y: number; heading: number }[] = [];
  const base = Math.atan2(frame.uy, frame.ux);
  for (const kind of PLAY_ORDER) {
    if (placed.length >= wanted) break;
    const reach = PLAY_REACH[kind];
    const spot = spots.find(
      ([x, y]) =>
        insideRing(patch.ring, x, y) &&
        ringDistance(patch.ring, x, y) >= reach + 1 &&
        avoid.every((ring) => !insideRing(ring, x, y) && ringDistance(ring, x, y) >= reach + 0.5) &&
        placed.every((other) => Math.hypot(other.x - x, other.y - y) >= reach + PLAY_REACH[other.kind] + 1),
    );
    if (!spot) continue;
    placed.push({ kind, x: spot[0], y: spot[1], heading: base + (random() < 0.5 ? 0 : Math.PI) + (random() < 0.5 ? 0 : Math.PI / 2) });
  }
  return placed;
}

function nearHome(campus: Campus, x: number, y: number): boolean {
  if (atHome(campus, x, y)) return true;
  return campus.boundary.some((edge) => ringDistance(edge, x, y) < HOME_REACH);
}

function fence(solid: Clay, sheer: Clay, line: Vec[], height: number, budget: { posts: number }): void {
  let next = 0;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, , az] = line[i];
    const [bx, , bz] = line[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.05) continue;
    while (next < length && budget.posts > 0) {
      const x = ax + ((bx - ax) * next) / length;
      const z = az + ((bz - az) * next) / length;
      solid.tube([x, 0, z], [x, height + 0.05, z], 0.04, 5, RAIL, false);
      budget.posts -= 1;
      next += FENCE_POST_GAP;
    }
    next -= length;
    solid.tube([ax, height, az], [bx, height, bz], 0.025, 4, RAIL, false);
    sheer.face(
      [
        [ax, 0.04, az],
        [bx, 0.04, bz],
        [bx, height, bz],
        [ax, height, az],
      ],
      CHAIN,
      [(ax + bx) / 2 + (bz - az), height / 2, (az + bz) / 2 - (bx - ax)],
    );
  }
  const [lx, , lz] = line[line.length - 1];
  if (budget.posts > 0 && next > 0.5) solid.tube([lx, 0, lz], [lx, height + 0.05, lz], 0.04, 5, RAIL, false);
}

function sweep(clay: Clay, line: Vec[], profile: [number, number][], shade: (index: number) => Vec, extend: number): void {
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, , az] = line[i];
    const [bx, , bz] = line[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.05) continue;
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const sx = ax - ux * extend;
    const sz = az - uz * extend;
    const ex = bx + ux * extend;
    const ez = bz + uz * extend;
    const nx = -uz;
    const nz = ux;
    const start = profile.map(([across, up]): Vec => [sx + nx * across, up, sz + nz * across]);
    const end = profile.map(([across, up]): Vec => [ex + nx * across, up, ez + nz * across]);
    const height = Math.max(...profile.map(([, up]) => up));
    const centre: Vec = [(sx + ex) / 2, height / 2, (sz + ez) / 2];
    clay.loft([start, end], (_segment, edge) => shade(edge), centre);
    clay.face(start, shade(0), centre);
    clay.face(end, shade(0), centre);
  }
}

function wallProfile(height: number): [number, number][] {
  const t = 0.16;
  return [
    [-t, 0],
    [t, 0],
    [t, height - 0.06],
    [t * 0.55, height],
    [-t * 0.55, height],
    [-t, height - 0.06],
  ];
}

function hedgeProfile(height: number): [number, number][] {
  const w = Math.min(1.2, Math.max(0.6, height * 0.75));
  return [
    [-0.4 * w, 0],
    [0.4 * w, 0],
    [0.5 * w, 0.4 * height],
    [0.44 * w, 0.82 * height],
    [0.24 * w, height],
    [-0.24 * w, height],
    [-0.44 * w, 0.82 * height],
    [-0.5 * w, 0.4 * height],
  ];
}

function headingFor(campus: Campus, thing: Thing): number {
  let best = Infinity;
  let heading = 0;
  const consider = (ax: number, ay: number, bx: number, by: number, reach: number) => {
    const gap = segmentDistance(thing.x, thing.y, ax, ay, bx, by);
    if (gap < reach && gap < best) {
      best = gap;
      heading = Math.atan2(by - ay, bx - ax);
    }
  };
  for (const strip of campus.strips) {
    if (strip.label !== 'Walkway' && thing.kind === 'bench') continue;
    for (let i = 0; i + 1 < strip.line.length; i += 1) consider(strip.line[i][0], strip.line[i][1], strip.line[i + 1][0], strip.line[i + 1][1], strip.width / 2 + 6);
  }
  if (thing.kind !== 'bench') {
    for (const block of campus.blocks) {
      if (!block.home) continue;
      for (let i = 0; i < block.ring.length; i += 1) {
        const [ax, ay] = block.ring[i];
        const [bx, by] = block.ring[(i + 1) % block.ring.length];
        consider(ax, ay, bx, by, 12);
      }
    }
  }
  return heading;
}

function matrixAt(spot: Vec, heading: number, stretch: Vec = [1, 1, 1]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...spot), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(...stretch));
}

export function buildGear(campus: Campus, middle: Middle, apart = false, furnished = false): GearMeshes {
  const toScene = (x: number, y: number): Vec => [x - middle[0], 0, -(y - middle[1])];
  const free = (x: number, y: number) => atHome(campus, x, y) && !onRoof(campus, x, y);
  const parts = modelsOf();
  const solid = new Merger();
  const sheer = new Merger();
  const loose = new Clay();
  const looseSheer = new Clay();
  const uprights: Gear[] = [];
  const nets: Gear[] = [];
  const lamps: { x: number; y: number; heading: number }[] = [];
  const furniture: Furnished[] = [];
  const lots = campus.patches.filter((patch) => patch.label === 'Parking lot');
  const pair = (model: Pair, spot: Vec, heading: number, stretch?: Vec) => {
    const matrix = matrixAt(spot, heading, stretch);
    solid.add(model.solid, matrix);
    if (model.sheer) sheer.add(model.sheer, matrix);
  };
  campus.patches.forEach((patch, index) => {
    const frame = frameOf(patch.ring);
    if (!free(frame.cx, frame.cy)) return;
    const layout = layoutOf(patch, campus.patches);
    for (const item of layout?.gear ?? []) {
      const spot = toScene(item.x, item.y);
      if (item.kind === 'uprights') uprights.push(item);
      else if (item.kind === 'tennis net') nets.push(item);
      else if (item.kind === 'hoop') pair(parts.hoop, spot, item.heading);
      else if (item.kind === 'soccer goal') pair(parts.soccer, spot, item.heading, [item.size, Math.min(1, item.size * 1.1), item.size]);
      else if (item.kind === 'volley net') pair(parts.volley, spot, item.heading, [1, 1, item.size]);
      else if (item.kind === 'pickle net') pair(parts.pickle, spot, item.heading, [1, 1, item.size]);
      else if (item.kind === 'backstop') backstop(loose, looseSheer, toScene, item);
    }
    if (patch.label === 'Playground') {
      const near = (ring: Ring) => ring.some(([x, y]) => Math.hypot(x - frame.cx, y - frame.cy) < frame.long + 40);
      const avoid = [
        ...campus.patches.filter((other) => other !== patch && (other.sport !== undefined || /court|field/i.test(other.label ?? ''))).map((other) => other.ring),
        ...campus.blocks.map((block) => block.ring),
      ].filter(near);
      for (const piece of playPieces(patch, 7919 + index * 104729, avoid)) {
        if (!furnished) solid.add(parts.play[piece.kind], matrixAt(toScene(piece.x, piece.y), piece.heading));
        else {
          const { model, turn } = playModel(piece.kind, piece.x, piece.y);
          furniture.push({ model, x: piece.x, y: piece.y, heading: piece.heading + turn });
        }
      }
    }
  });
  const budget = { posts: MOST_POSTS };
  for (const [a, b] of courtFences(campus)) {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    if (!atHome(campus, mx, my)) continue;
    fence(loose, looseSheer, [toScene(a[0], a[1]), toScene(b[0], b[1])], COURT_FENCE, budget);
  }
  for (const edge of campus.edges ?? []) {
    const kept: Point[][] = [];
    let run: Point[] = [];
    for (let i = 0; i + 1 < edge.line.length; i += 1) {
      const [ax, ay] = edge.line[i];
      const [bx, by] = edge.line[i + 1];
      if (nearHome(campus, (ax + bx) / 2, (ay + by) / 2)) {
        if (run.length === 0) run.push([ax, ay]);
        run.push([bx, by]);
      } else if (run.length > 0) {
        kept.push(run);
        run = [];
      }
    }
    if (run.length > 0) kept.push(run);
    for (const piece of kept) {
      const line = piece.map(([x, y]) => toScene(x, y));
      if (edge.kind === 'fence') fence(loose, looseSheer, line, edge.height, budget);
      else if (edge.kind === 'wall') sweep(loose, line, wallProfile(edge.height), () => WALL, 0.08);
      else sweep(loose, line, hedgeProfile(edge.height), (index) => (index >= 3 && index <= 5 ? HEDGE_TOP : HEDGE), 0.25);
    }
  }
  for (const thing of campus.things ?? []) {
    if (thing.kind === 'door' || thing.kind === 'main door' || !free(thing.x, thing.y)) continue;
    const spot = toScene(thing.x, thing.y);
    const heading = thing.kind === 'flagpole' ? 0 : headingFor(campus, thing);
    const inLot = thing.kind === 'lamp' && lots.some((lot) => insideRing(lot.ring, thing.x, thing.y));
    if (apart && inLot) {
      lamps.push({ x: thing.x, y: thing.y, heading });
      continue;
    }
    if (furnished && thing.kind === 'lamp' && !inLot) {
      furniture.push({ model: 'lamp-walkway', x: thing.x, y: thing.y, heading });
      continue;
    }
    if (furnished && thing.kind === 'bench') {
      furniture.push({ model: 'bench', x: thing.x, y: thing.y, heading: heading + Math.PI });
      continue;
    }
    if (furnished && thing.kind === 'bikes') {
      furniture.push({ model: 'bike-rack', x: thing.x, y: thing.y, heading, scale: [BIKE_STRETCH, 1, 1] });
      continue;
    }
    const model = thing.kind === 'flagpole' ? parts.flagpole : thing.kind === 'bench' ? parts.bench : thing.kind === 'bikes' ? parts.bikes : parts.lamp;
    solid.add(model, matrixAt(spot, heading));
  }
  if (loose.positions.length > 0) {
    const geometry = loose.geometry(true);
    solid.add(geometry);
    geometry.dispose();
  }
  if (looseSheer.positions.length > 0) {
    const geometry = looseSheer.geometry(true);
    sheer.add(geometry);
    geometry.dispose();
  }
  return { solid: solid.geometry(), sheer: sheer.geometry(), uprights, nets, lamps, furniture };
}

function backstop(solid: Clay, sheer: Clay, toScene: (x: number, y: number) => Vec, item: Gear): void {
  const home = toScene(item.x, item.y);
  const radius = item.size;
  const tall = radius > 7 ? 6 : 4.8;
  const facing = item.heading;
  const points: Vec[] = [];
  const steps = 6;
  for (let step = 0; step <= steps; step += 1) {
    const angle = facing + Math.PI + ((step / steps) * 2 - 1) * (Math.PI / 3);
    points.push([home[0] + Math.cos(angle) * radius, 0, home[2] - Math.sin(angle) * radius]);
  }
  for (const [x, , z] of points) solid.tube([x, 0, z], [x, tall + 0.05, z], 0.07, 6, RAIL, false);
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, , az] = points[i];
    const [bx, , bz] = points[i + 1];
    solid.tube([ax, tall, az], [bx, tall, bz], 0.04, 4, RAIL, false);
    solid.tube([ax, 1.2, az], [bx, 1.2, bz], 0.03, 4, RAIL, false);
    sheer.face(
      [
        [ax, 0.04, az],
        [bx, 0.04, bz],
        [bx, tall, bz],
        [ax, tall, az],
      ],
      CHAIN,
      [home[0], tall / 2, home[2]],
    );
  }
}

export function disposeGear(meshes: GearMeshes): void {
  meshes.solid?.dispose();
  meshes.sheer?.dispose();
}
