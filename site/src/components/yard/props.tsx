import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { atHome, type Campus } from '@/engine/campus';
import type { Yard } from './controller';
import type { Gear } from '@/engine/sports';
import { along, axisHeading, bandPads, courts, fields, lightPoles, onRoof, parkingStalls, thin, walkers, type Area } from './layout';
import { Clay, type Vec } from './clay';
import { Crowd, buildCrowd, type CrowdOptions, type Member } from './crowd';
import { chooseCar, choosePerson, mix, type Role } from './forest';
import { buildGear, type GearMeshes } from './gear';
import type { Kind as ModelKind, Library } from './library';
import { BLOB_LIFT, buildBlob } from './models';
import { TIERS, type Levels, type PropLevel } from './quality';
import { keep, take, useCrowd, useSettled } from './stages';

type Placement = { x: number; y: number; heading: number; stretch?: number; color?: THREE.Color; kind?: string };
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
const CROWDED = new Map<Kind, ModelKind>([
  ['cars', 'cars'],
  ['poles', 'poles'],
  ['people', 'people'],
]);
const PROP_REFERENCE = 4.5;
const SIZES: Record<string, number> = { car: 4.5, person: 1.7, pole: 9 };

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

function buildModels(): Record<Kind, Model> & { gear: THREE.MeshStandardMaterial; mesh: THREE.MeshStandardMaterial } {
  const mesh = sheer('#ffffff', NET_OPACITY);
  mesh.vertexColors = true;
  mesh.side = THREE.DoubleSide;
  return {
    gear: material('#ffffff', true),
    mesh,
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
      kind: chooseCar(mix(Math.round(stall.x * 8), Math.round(stall.y * 8), 23)),
    };
  });
}

function placePoles(yard: Yard): Placement[] {
  const poles = lightPoles(yard.campus).filter((pole) => free(yard.campus, pole.x, pole.y));
  return thin(poles, POLE_CAP).map((pole, index) => ({ x: pole.x, y: pole.y, heading: pole.heading + (index % 2 === 0 ? 0 : Math.PI), kind: 'pole-lot-double' }));
}

function placeGear(gear: Gear[]): Placement[] {
  return gear.map((item) => ({ x: item.x, y: item.y, heading: item.heading, stretch: item.size }));
}

function placePeople(yard: Yard, light: boolean): Placement[] {
  const result: Placement[] = [];
  const campus = yard.campus;
  const add = (x: number, y: number, heading: number, color: THREE.Color, role: Role) => {
    if (free(campus, x, y)) result.push({ x, y, heading, color, kind: choosePerson(role, mix(Math.round(x * 8), Math.round(y * 8), 41)) });
  };
  homeAreas(campus, bandPads(campus)).forEach((pad, padIndex) => {
    const rows = light ? BAND_ROWS / 2 : BAND_ROWS;
    if (pad.long < (BAND_FILES - 1) * BAND_GAP + 2 || pad.short < (BAND_ROWS - 1) * BAND_GAP + 2) return;
    const random = seeded(4049 + padIndex * 31);
    const facing = axisHeading(pad) + Math.PI / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let file = 0; file < BAND_FILES; file += 1) {
        const [x, y] = along(pad, (file - (BAND_FILES - 1) / 2) * BAND_GAP, (row - (rows - 1) / 2) * BAND_GAP);
        add(x, y, facing + (random() * 2 - 1) * 0.05, new THREE.Color(row === rows - 1 ? BAND_FRONT : BAND_UNIFORM), 'band');
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
      add(x, y, axisHeading(court) + (end > 0 ? Math.PI : 0), clayTone(random), 'player');
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
      add(x, y, axisHeading(field) + (team > 0 ? Math.PI : 0) + (random() * 2 - 1) * 0.6, new THREE.Color(team > 0 ? TEAM_HOME : TEAM_AWAY), 'player');
    }
  });
  walkers(campus, (x, y) => free(campus, x, y)).forEach((walker, index) => {
    if (light && index % 2 === 1) return;
    const random = seeded(12011 + index * 53);
    add(walker.x, walker.y, walker.heading + (index % 3 === 0 ? Math.PI : 0), clayTone(random), 'walker');
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

type Placed = { lists: Record<Kind, Placement[]>; gear: GearMeshes };

export function propKinds(library: Library | null): string {
  return [...CROWDED.values()].filter((kind) => library?.kinds.has(kind)).join(' ');
}

function placeAll(yard: Yard, level: NonNullable<PropLevel>, kinds: string): Placed {
  const gear = buildGear(yard.campus, yard.middle, kinds.includes('poles'));
  const nets = placeGear(gear.nets);
  return {
    lists: {
      cars: placeCars(yard, level.cars),
      poles: [...placePoles(yard), ...gear.lamps.map((lamp) => ({ ...lamp, kind: 'pole-lot' }))],
      nets,
      posts: nets,
      goals: placeGear(gear.uprights).map((item) => ({ ...item, stretch: 1 })),
      people: thin(placePeople(yard, level.light), level.people),
    },
    gear,
  };
}

function placedKey(level: NonNullable<PropLevel>, kinds: string): string {
  return `props ${level.cars} ${level.people} ${level.light} ${kinds}`;
}

export function primeProps(yard: Yard, level: PropLevel = TIERS.high.props, kinds = ''): void {
  if (level) keep(yard, placedKey(level, kinds), () => placeAll(yard, level, kinds));
}

function sizeOf(kind: string): number {
  return SIZES[kind.slice(0, kind.indexOf('-'))] ?? PROP_REFERENCE;
}

type Crowded = { crowd: Crowd; box: THREE.Box3; kinds: string; object: THREE.Object3D; dispose: () => void };

function membersOf(yard: Yard, library: Library, lists: Record<Kind, Placement[]>): { members: Member[]; box: THREE.Box3 } {
  const members: Member[] = [];
  const box = new THREE.Box3();
  const spot = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const kind of CROWDED.keys()) {
    for (const item of lists[kind]) {
      if (!item.kind || !library.models.has(item.kind)) continue;
      const [x, , z] = yard.toScene(item.x, item.y);
      spot.set(x, 0, z);
      box.expandByPoint(spot);
      turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.heading + (kind === 'poles' ? 0 : Math.PI / 2));
      members.push({ model: item.kind, matrix: new THREE.Matrix4().compose(spot, turn, one), tint: item.color ?? null, size: sizeOf(item.kind) });
    }
  }
  return { members, box };
}

function wrap(crowd: Crowd, box: THREE.Box3, library: Library): Crowded {
  return { crowd, box, kinds: propKinds(library), object: crowd.object, dispose: () => crowd.dispose() };
}

function crowdOptions(levels: Levels, shadows: boolean, multi: boolean): CrowdOptions {
  return { edges: [levels.props], reference: PROP_REFERENCE, floor: shadows ? 1 : null, bulk: multi ? 1 : 0 };
}

const PROP_KINDS: readonly ModelKind[] = ['cars', 'poles', 'people'];

export function Props({ yard, level = TIERS.high.props, library: given = null, levels = TIERS.high.levels }: { yard: Yard; level?: PropLevel; library?: Library | null; levels?: Levels }) {
  const library = useSettled(given, PROP_KINDS);
  const models = useMemo(buildModels, []);
  const blob = useMemo(buildBlob, []);
  const multi = useThree((state) => state.gl.extensions.has('WEBGL_multi_draw'));
  useEffect(
    () => () => {
      for (const kind of KINDS) {
        models[kind].geometry.dispose();
        models[kind].material.dispose();
      }
      models.gear.dispose();
      models.mesh.dispose();
      blob.geometry.dispose();
      blob.material.dispose();
    },
    [models, blob],
  );
  const kinds = propKinds(library);
  const spread = useMemo(() => (level ? take(yard, placedKey(level, kinds), () => placeAll(yard, level, kinds)) : null), [yard, level, kinds]);
  const crowd = useCrowd(
    () => {
      if (!level || !spread || !library || !kinds) return null;
      const { members, box } = membersOf(yard, library, spread.lists);
      return wrap(new Crowd(library, members, crowdOptions(levels, level.shadows, multi)), box, library);
    },
    [yard, level, spread, library, levels, multi],
    async (pause) => {
      if (!level || !spread || !library || !kinds) return null;
      const { members, box } = membersOf(yard, library, spread.lists);
      return wrap(await buildCrowd(library, members, crowdOptions(levels, level.shadows, multi), pause), box, library);
    },
  );
  const drawn = crowd ? crowd.kinds : '';
  const meshes = useMemo(() => {
    if (!level || !spread) return [];
    const { lists: placed, gear } = spread;
    const modelled = (kind: Kind) => {
      const own = CROWDED.get(kind);
      return own !== undefined && drawn.includes(own);
    };
    const shades = blobs(yard, blob, placed.cars);
    const merged: { kind: string; mesh: THREE.Mesh }[] = [];
    if (gear.solid) {
      const mesh = new THREE.Mesh(gear.solid, models.gear);
      mesh.castShadow = level.shadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      merged.push({ kind: 'gear', mesh });
    }
    if (gear.sheer) {
      const mesh = new THREE.Mesh(gear.sheer, models.mesh);
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      merged.push({ kind: 'mesh', mesh });
    }
    const meshes = [
      ...KINDS.filter((kind) => !modelled(kind)).flatMap((kind) => {
        const mesh = instanced(yard, models[kind], placed[kind], level.shadows);
        if (mesh && models[kind].material.transparent) mesh.renderOrder = 2;
        return mesh ? [{ kind: kind as string, mesh: mesh as THREE.Mesh }] : [];
      }),
      ...merged,
      ...(shades ? [{ kind: 'car shades', mesh: shades as THREE.Mesh }] : []),
    ];
    return meshes;
  }, [yard, level, models, blob, spread, drawn]);
  useEffect(
    () => () => {
      for (const { mesh } of meshes) {
        if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
        else mesh.geometry.dispose();
      }
    },
    [meshes],
  );
  const reach = useMemo(() => {
    const box = new THREE.Box3();
    if (crowd) box.union(crowd.box);
    for (const { mesh } of meshes) {
      if (mesh instanceof THREE.InstancedMesh) {
        if (!mesh.boundingBox) mesh.computeBoundingBox();
        if (mesh.boundingBox) box.union(mesh.boundingBox);
      } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
      }
    }
    return { box, shown: true };
  }, [meshes, crowd]);
  useFrame((state) => {
    if (meshes.length === 0 && !crowd) return;
    if (crowd) {
      crowd.crowd.object.visible = reach.shown;
      crowd.crowd.update(state.camera, state.gl.domElement.height);
    }
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 30;
    const zoom = camera.isPerspectiveCamera ? camera.zoom : 1;
    const distance = Math.max(reach.box.distanceToPoint(camera.position), 1e-3);
    const pixels = (CAR_LONG * state.gl.domElement.height * zoom) / (2 * Math.tan((fov * Math.PI) / 360) * distance);
    const shown = pixels >= SMALLEST_PIXELS;
    if (shown === reach.shown) return;
    reach.shown = shown;
    for (const { mesh } of meshes) mesh.visible = shown;
    if (crowd) crowd.crowd.object.visible = shown;
  });
  if (!level) return null;
  return (
    <group name="props">
      {meshes.map(({ kind, mesh }) => (
        <primitive key={kind} object={mesh} raycast={() => null} />
      ))}
      {crowd && <primitive object={crowd.crowd.object} />}
    </group>
  );
}
