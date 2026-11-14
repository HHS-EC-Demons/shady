import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { insideRing, ringDistance, type Point } from '@/engine/geometry';
import { placesOf } from '@/engine/places';
import { CANOPY_FLATTEN, shadowShift, type Sail } from '@/engine/shade';
import type { Story } from '@/engine/story';
import { treeRadius } from '@/engine/growth';
import type { Yard } from '../yard/controller';
import { orientedBox } from '../yard/layout';
import { BLOB_LIFT, buildSail, treeTint } from '../yard/models';
import { Props, primeProps } from '../yard/props';
import { TIERS, chipName, keepFrame, powerChoice, quality, shortChip } from '../yard/quality';
import { Backdrop, Blocks, Ground, MappedTrees, Pulse, Sun, blobSize, primeBlocks, primeGround, sunReach, useBlob, useTree } from '../yard/Scene';
import { Prime, Stages } from '../yard/stages';
import type { Days } from './Film';
import { BEATS, film } from './state';

const LAST = BEATS - 1;
const SAPLING = treeRadius(1) / treeRadius(20);
const INK = '#12261c';
const CLOTH = '#8fb1ab';
const STEEL = '#56655f';
const MID_MORNING = 10 * 60;
const FACINGS = 72;
const SQUARE = 0.15;
const LOT_TILT = 0.3;
const BAND_TILT = 0.55;
const BAND_SKEW = 0.35;

function ease(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function ramp(value: number, from: number, to: number): number {
  return ease((value - from) / (to - from));
}

function heading(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function closest(angle: number, to: number): number {
  let value = angle;
  while (value - to > Math.PI) value -= Math.PI * 2;
  while (value - to < -Math.PI) value += Math.PI * 2;
  return value;
}

function across(dx: number, dz: number, toward: number): number {
  const one = heading(dx, dz) + Math.PI / 2;
  const two = one + Math.PI;
  return Math.abs(closest(one, toward) - toward) <= Math.abs(closest(two, toward) - toward) ? one : two;
}

type Pose = { x: number; z: number; y: number; distance: number; turn: number; tilt: number };

type Lens = { distance: number; tilt: number; half: number; aspect: number };

function rowsOf(yard: Yard, label: string, anchor: Point): number | null {
  let rows: number | null = null;
  let gap = Infinity;
  for (const patch of yard.campus.patches) {
    if (!patch.label || !label.startsWith(patch.label)) continue;
    const distance = insideRing(patch.ring, anchor[0], anchor[1]) ? 0 : ringDistance(patch.ring, anchor[0], anchor[1]);
    if (distance >= gap) continue;
    gap = distance;
    const box = orientedBox(patch.ring);
    rows = heading(box.ux, -box.uy);
  }
  return rows;
}

function foreground(yard: Yard, label: string, anchor: Point, lens: Lens, prefer: number): number {
  const place = placesOf(yard.campus, yard.ground).find((item) => item.label === label);
  if (!place) return prefer;
  const rows = rowsOf(yard, label, anchor);
  const grid = yard.ground.grid;
  const inside = new Uint8Array(grid.cols * grid.rows);
  for (const index of place.cells) inside[index] = 1;
  const hit = (x: number, y: number) => {
    const col = Math.floor((x - grid.minX) / grid.cell);
    const row = Math.floor((y - grid.minY) / grid.cell);
    return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows && inside[row * grid.cols + col] === 1;
  };
  const flat = lens.distance * Math.cos(lens.tilt);
  const high = lens.distance * Math.sin(lens.tilt);
  let best = prefer;
  let top = -Infinity;
  for (let step = 0; step < FACINGS; step += 1) {
    const turn = prefer + (step / FACINGS) * Math.PI * 2;
    const east = Math.sin(turn);
    const south = Math.cos(turn);
    let found = 0;
    let tried = 0;
    for (let row = 1; row <= 6; row += 1) {
      const dip = lens.tilt + (lens.half * row) / 6;
      const reach = high / Math.tan(dip);
      const back = flat - reach;
      const wide = (reach * Math.cos(lens.tilt) + high * Math.sin(lens.tilt)) * Math.tan(lens.half) * lens.aspect;
      for (let side = -3; side <= 3; side += 1) {
        const lateral = (wide * side) / 3;
        tried += 1;
        if (hit(anchor[0] + back * east + lateral * south, anchor[1] - back * south + lateral * east)) found += 1;
      }
    }
    const square = rows === null ? 0 : Math.cos(2 * (turn - rows)) ** 2;
    const score = found / tried - SQUARE * square - 0.02 * Math.abs(closest(turn, prefer) - prefer);
    if (score > top) {
      top = score;
      best = turn;
    }
  }
  return closest(best, prefer);
}

type Shared = { plant: number; grow: number; draw: number; move: number; sail: number; zoom: number };

function Trees({ yard, story, state }: { yard: Yard; story: Story; state: Shared }) {
  const model = useTree(true);
  const blob = useBlob();
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const blobs = useRef<THREE.InstancedMesh>(null);
  const seen = useRef({ plant: -1, grow: -1 });
  const tools = useMemo(() => ({ matrix: new THREE.Matrix4(), spin: new THREE.Quaternion(), flat: new THREE.Quaternion(), at: new THREE.Vector3(), size: new THREE.Vector3() }), []);
  const spots = useMemo(() => story.trees.map((tree) => yard.toScene(tree.x, tree.y)), [story, yard]);
  const count = story.trees.length;

  useLayoutEffect(() => {
    const mesh = crowns.current;
    if (!mesh) return;
    const shade = new THREE.Color();
    for (let index = 0; index < count; index += 1) mesh.setColorAt(index, treeTint(index, 1, shade));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, model]);

  useFrame(() => {
    if (!crowns.current || !trunks.current || !blobs.current) return;
    if (Math.abs(seen.current.plant - state.plant) < 0.0005 && Math.abs(seen.current.grow - state.grow) < 0.0005) return;
    seen.current.plant = state.plant;
    seen.current.grow = state.grow;
    const { matrix, spin, flat, at, size } = tools;
    for (let index = 0; index < count; index += 1) {
      const tree = story.trees[index];
      const pop = ease(state.plant * count - index);
      const scale = state.grow * pop;
      const tall = tree.radius * CANOPY_FLATTEN * scale;
      const high = tree.height * scale;
      spin.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, index * 1.7);
      at.set(spots[index][0], Math.max(0.01, high - tall), spots[index][2]);
      size.set(Math.max(0.001, tree.radius * scale), Math.max(0.001, tall), Math.max(0.001, tree.radius * scale));
      matrix.compose(at, spin, size);
      crowns.current.setMatrixAt(index, matrix);
      const trunk = Math.max(0.001, high - tall);
      const thick = Math.min(1.2, Math.max(0.45, tree.radius / 4.5)) * scale;
      at.set(spots[index][0], trunk / 2, spots[index][2]);
      size.set(Math.max(0.001, thick), trunk, Math.max(0.001, thick));
      matrix.compose(at, spin, size);
      trunks.current.setMatrixAt(index, matrix);
      const spread = Math.max(0.001, blobSize(tree.radius) * scale);
      at.set(spots[index][0], BLOB_LIFT, spots[index][2]);
      size.set(spread, 1, spread);
      matrix.compose(at, flat, size);
      blobs.current.setMatrixAt(index, matrix);
    }
    crowns.current.instanceMatrix.needsUpdate = true;
    trunks.current.instanceMatrix.needsUpdate = true;
    blobs.current.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <group name="trees">
      <instancedMesh ref={crowns} args={[model.crown, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[model.trunk, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={blobs} name="blobs" args={[blob.geometry, blob.material, count]} renderOrder={-1} frustumCulled={false} />
    </group>
  );
}

function sailParts(model: { cloth: THREE.BufferGeometry; posts: THREE.BufferGeometry }) {
  return (
    <>
      <mesh geometry={model.cloth} castShadow>
        <meshStandardMaterial color={CLOTH} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={model.posts} castShadow>
        <meshStandardMaterial color={STEEL} roughness={0.7} />
      </mesh>
    </>
  );
}

function SailModel({ yard, sail, state }: { yard: Yard; sail: Sail; state: Shared }) {
  const group = useRef<THREE.Group>(null);
  const seen = useRef(-1);
  const shape = useMemo(() => {
    const [a, , c] = sail.corners;
    const first = yard.toScene(a[0], a[1]);
    const third = yard.toScene(c[0], c[1]);
    return { x: (first[0] + third[0]) / 2, z: (first[2] + third[2]) / 2, wide: Math.abs(third[0] - first[0]), deep: Math.abs(third[2] - first[2]) };
  }, [yard, sail]);
  const model = useMemo(() => buildSail(Math.max(0.5, shape.wide), Math.max(0.5, shape.deep), sail.height), [shape, sail.height]);
  useEffect(
    () => () => {
      model.cloth.dispose();
      model.posts.dispose();
    },
    [model],
  );

  useFrame(() => {
    const node = group.current;
    if (!node || Math.abs(seen.current - state.sail) < 0.0005) return;
    seen.current = state.sail;
    const scale = Math.max(0.0001, state.sail);
    node.scale.set(scale, scale, scale);
  });

  return (
    <group ref={group} name="sail" position={[shape.x, 0, shape.z]} scale={0.0001}>
      {sailParts(model)}
    </group>
  );
}

function Walk({ yard, story, state }: { yard: Yard; story: Story; state: Shared }) {
  const bar = useRef<THREE.Mesh>(null);
  const near = useRef<THREE.Mesh>(null);
  const far = useRef<THREE.Mesh>(null);
  const points = useMemo(() => {
    const from = yard.toScene(story.anchor2[0], story.anchor2[1]);
    const before = yard.toScene(story.shade2Before[0], story.shade2Before[1]);
    const after = yard.toScene(story.shade2After[0], story.shade2After[1]);
    return { from, before, after };
  }, [yard, story]);
  const widest = Math.max(1.1, yard.radius * 0.006);

  useFrame(() => {
    if (!bar.current || !near.current || !far.current) return;
    const { from, before, after } = points;
    const wide = Math.min(widest, Math.max(0.3, state.zoom * 0.0105));
    const endX = before[0] + (after[0] - before[0]) * state.move;
    const endZ = before[2] + (after[2] - before[2]) * state.move;
    const tipX = from[0] + (endX - from[0]) * state.draw;
    const tipZ = from[2] + (endZ - from[2]) * state.draw;
    const length = Math.hypot(tipX - from[0], tipZ - from[2]);
    const visible = state.draw > 0.01;
    bar.current.visible = visible && length > 0.05;
    near.current.visible = visible;
    far.current.visible = visible && length > wide * 2;
    bar.current.position.set((from[0] + tipX) / 2, 0.3, (from[2] + tipZ) / 2);
    bar.current.rotation.y = -Math.atan2(tipZ - from[2], tipX - from[0]);
    bar.current.scale.set(Math.max(0.01, length), 1, wide);
    near.current.position.set(from[0], 0.32, from[2]);
    near.current.scale.set(wide, 1, wide);
    far.current.position.set(tipX, 0.32, tipZ);
    far.current.scale.set(wide, 1, wide);
  });

  return (
    <group>
      <mesh ref={bar} visible={false}>
        <boxGeometry args={[1, 0.12, 1]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      <mesh ref={near} visible={false}>
        <cylinderGeometry args={[1.6, 1.6, 0.14, 28]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      <mesh ref={far} visible={false}>
        <cylinderGeometry args={[1.6, 1.6, 0.14, 28]} />
        <meshBasicMaterial color={INK} />
      </mesh>
    </group>
  );
}

function Director({ yard, days, story, shared, onFrame }: { yard: Yard; days: Days; story: Story; shared: Shared; onFrame: () => void }) {
  const { camera, size, invalidate, gl } = useThree();
  const view = camera as THREE.PerspectiveCamera;
  const reach = sunReach(yard);
  const first = useRef(true);
  const look = useMemo(() => new THREE.Vector3(), []);
  const poses = useMemo<Pose[]>(() => {
    const half = (view.fov * Math.PI) / 360;
    const aspect = size.width / size.height;
    const narrow = aspect < 1;
    const span = Math.max(yard.radius * 0.95, reach * 1.05);
    const home = (span / Math.tan(half)) * (narrow ? 1.5 : 0.9);
    const fit = (meters: number) => Math.min(home, (Math.max(55, meters) / Math.tan(half)) * (narrow ? 1.9 : 1.15));
    const frame = (meters: number) => Math.min(home, meters / (2 * Math.tan(half) * Math.min(aspect, 1.6)));
    const one = yard.toScene(story.anchor[0], story.anchor[1]);
    const two = yard.toScene(story.anchor2[0], story.anchor2[1]);
    const shade = yard.toScene(story.shade2Before[0], story.shade2Before[1]);
    const three = yard.toScene(story.focus3[0], story.focus3[1]);
    const five = yard.toScene(story.anchor5[0], story.anchor5[1]);
    const [a, , c] = story.sail.corners;
    const noon = yard.sun(story.peak);
    const [sx, sy] = shadowShift(noon, story.sail.height);
    const sail = yard.toScene((a[0] + c[0]) / 2 + sx / 2, (a[1] + c[1]) / 2 + sy / 2);
    const cover = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(sx, sy);
    const third = (cover * (narrow ? 1.7 : 2.4)) / (2 * Math.tan(half) * Math.min(aspect, 1.6));
    const walk = Math.hypot(shade[0] - two[0], shade[2] - two[2]);
    const morning = yard.sun(story.early);
    const lot = frame(narrow ? 62 : 150);
    const band = frame(narrow ? 34 : 60);
    const core = [one, two, three, five];
    const wideX = core.reduce((sum, point) => sum + point[0], 0) / core.length / 2;
    const wideZ = core.reduce((sum, point) => sum + point[2], 0) / core.length / 2;

    const start = Math.atan2(-0.42, 0.86);
    const shadow = heading(-noon.x, noon.y);
    const turn1 = foreground(yard, story.place, story.anchor, { distance: lot, tilt: LOT_TILT, half, aspect }, start + 0.55);
    const turn2 = closest(across(shade[0] - two[0], shade[2] - two[2], shadow), turn1);
    const turn3 = closest(shadow + 0.75, turn2);
    const turn4 = closest(heading(-three[0], -three[2]) - 0.5, turn3);
    const long = heading(-morning.x, morning.y);
    const side = across(-morning.x, morning.y, turn4);
    const turn5 = closest(side + Math.sign(closest(long, side) - side) * BAND_SKEW, turn4);
    const turn6 = turn5 + 0.45;
    return [
      { x: wideX, z: wideZ, y: reach * 0.14, distance: home, turn: start, tilt: 0.575 },
      { x: one[0], z: one[2], y: 0, distance: lot, turn: turn1, tilt: LOT_TILT },
      { x: (two[0] + shade[0]) / 2, z: (two[2] + shade[2]) / 2, y: 0, distance: fit(Math.max(walk * 0.8, 60)), turn: turn2, tilt: 0.62 },
      { x: sail[0], z: sail[2], y: 1.5, distance: Math.max(18, third), turn: turn3, tilt: 0.36 },
      { x: three[0], z: three[2], y: 0, distance: fit(story.span3 * 0.62), turn: turn4, tilt: 0.62 },
      { x: five[0], z: five[2], y: 0, distance: band, turn: turn5, tilt: BAND_TILT },
      { x: wideX, z: wideZ, y: reach * 0.1, distance: home * 0.92, turn: turn6, tilt: 0.5 },
    ];
  }, [yard, story, reach, view, size.width, size.height]);

  useEffect(() => {
    film.wake = invalidate;
    view.near = 4;
    view.far = poses[0].distance * 12;
    if (size.width >= 1024) view.setViewOffset(size.width, size.height, -size.width * 0.07, -size.height * 0.02, size.width, size.height);
    else view.clearViewOffset();
    view.updateProjectionMatrix();
    invalidate();
    return () => {
      film.wake = () => {};
    };
  }, [invalidate, view, poses, size.width, size.height]);

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      document.querySelector('.film')?.setAttribute('data-mode', 'still');
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl]);

  useFrame((_, delta) => {
    const gap = film.target - film.current;
    film.current = Math.abs(gap) < 0.0002 ? film.target : film.current + gap * (1 - Math.exp(-Math.min(delta, 0.1) * 9));
    const at = film.current * LAST;
    const low = Math.min(LAST - 1, Math.floor(at));
    const share = ease(at - low);
    const a = poses[low];
    const b = poses[low + 1];
    const distance = a.distance + (b.distance - a.distance) * share;
    const turn = a.turn + (b.turn - a.turn) * share;
    const tilt = a.tilt + (b.tilt - a.tilt) * share;
    look.set(a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share, a.z + (b.z - a.z) * share);
    view.position.set(look.x + Math.sin(turn) * Math.cos(tilt) * distance, look.y + Math.sin(tilt) * distance, look.z + Math.cos(turn) * Math.cos(tilt) * distance);
    view.lookAt(look);
    shared.zoom = distance;

    const dawn = yard.sunrise + 55;
    const peak = yard.peak;
    const early = story.early;
    const late = Math.max(early, MID_MORNING);
    let minute = peak;
    if (at < 1) minute = dawn + (peak - dawn) * ramp(at, 0.05, 0.95);
    else if (at >= 4 && at < 5) minute = peak + (early - peak) * ramp(at, 4.1, 4.95);
    else if (at >= 5) minute = early + (late - early) * ramp(at, 5.1, 5.95);

    shared.draw = ramp(at, 1.3, 1.95) * (1 - ramp(at, 2.82, 2.98));
    shared.move = ramp(at, 2.4, 2.95);
    shared.sail = ramp(at, 2.05, 2.6);
    shared.plant = ramp(at, 3.1, 3.62);
    shared.grow = SAPLING + (1 - SAPLING) * ramp(at, 3.6, 3.95);
    const before = yard.frame;
    if (at < 3 || !days.sail) {
      yard.setBase(yard.bare);
      yard.setBlend(days.sail, ramp(at, 2.15, 2.85));
    } else {
      yard.setBase(days.sail);
      yard.setBlend(days.full, shared.plant * shared.grow * shared.grow);
    }
    yard.setMinute(minute);

    if (film.current !== film.target || yard.frame !== before) invalidate();
    if (first.current) {
      first.current = false;
      onFrame();
    }
  });

  return null;
}

type Props = { yard: Yard; days: Days; story: Story; onFrame: () => void; debug: boolean };

const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;
const PARTS = new Set(['ground', 'shade', 'backdrop', 'sun', 'blocks', 'trees', 'props', 'blobs', 'sail']);
const KEEP_FRAMES = 8192;

type Tally = { ms: number; calls: number; tris: number };
type Batch = { shadow: WebGLQuery | null; main: WebGLQuery | null };

class Clock {
  totals = new Map<string, Tally>();
  frames = 0;
  lost = 0;
  totalsByFrame = new Float32Array(KEEP_FRAMES);
  shadowByFrame = new Float32Array(KEEP_FRAMES);
  private free: WebGLQuery[] = [];
  private waiting: Batch[] = [];
  private spare: Batch[] = [];
  private batch: Batch | null = null;
  private calls = 0;
  private tris = 0;

  constructor(
    private context: WebGL2RenderingContext,
    private info: THREE.WebGLInfo,
  ) {}

  private tally(key: string): Tally {
    let entry = this.totals.get(key);
    if (!entry) {
      entry = { ms: 0, calls: 0, tris: 0 };
      this.totals.set(key, entry);
    }
    return entry;
  }

  private query(): WebGLQuery {
    const query = this.free.pop() ?? this.context.createQuery();
    this.context.beginQuery(TIME_ELAPSED, query);
    return query;
  }

  frameStart(): void {
    this.batch = this.spare.pop() ?? { shadow: null, main: null };
    this.batch.shadow = this.query();
    this.batch.main = null;
  }

  between(): void {
    if (!this.batch || this.batch.main) return;
    this.context.endQuery(TIME_ELAPSED);
    this.batch.main = this.query();
  }

  frameEnd(): void {
    if (!this.batch) return;
    this.context.endQuery(TIME_ELAPSED);
    this.waiting.push(this.batch);
    this.batch = null;
  }

  enter(): void {
    this.calls = this.info.render.calls;
    this.tris = this.info.render.triangles;
  }

  leave(pass: 'shadow' | 'main', part: string): void {
    const entry = this.tally(`${pass}:${part}`);
    entry.calls += this.info.render.calls - this.calls;
    entry.tris += this.info.render.triangles - this.tris;
  }

  private read(query: WebGLQuery | null, disjoint: boolean): number {
    if (!query) return 0;
    const ms = disjoint ? 0 : Number(this.context.getQueryParameter(query, this.context.QUERY_RESULT)) / 1e6;
    this.free.push(query);
    return ms;
  }

  collect(): void {
    const gl = this.context;
    const disjoint = Boolean(gl.getParameter(GPU_DISJOINT));
    while (this.waiting.length > 0) {
      const batch = this.waiting[0];
      const last = batch.main ?? batch.shadow;
      if (last && !gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) return;
      const shadow = this.read(batch.shadow, disjoint);
      const main = batch.main ? this.read(batch.main, disjoint) : 0;
      batch.shadow = null;
      batch.main = null;
      this.waiting.shift();
      this.spare.push(batch);
      if (disjoint) {
        this.lost += 1;
        continue;
      }
      this.tally('shadow').ms += shadow;
      this.tally('main').ms += main;
      this.totalsByFrame[this.frames % KEEP_FRAMES] = shadow + main;
      this.shadowByFrame[this.frames % KEEP_FRAMES] = shadow;
      this.frames += 1;
    }
  }

  report(): string {
    const parts: Record<string, Tally> = {};
    for (const [key, value] of this.totals) parts[key] = value;
    const count = Math.min(this.frames, KEEP_FRAMES);
    return JSON.stringify({ frames: this.frames, lost: this.lost, parts, perFrame: Array.from(this.totalsByFrame.subarray(0, count)), shadowPerFrame: Array.from(this.shadowByFrame.subarray(0, count)) });
  }
}

function partOf(object: THREE.Object3D): string {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (PARTS.has(node.name)) return node.name;
    node = node.parent;
  }
  return 'other';
}

function useClock(box: HTMLElement | null): void {
  const { gl, scene } = useThree();
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const timed = search?.get('perf') === 'gpu';
  const hide = search?.get('hide') ?? '';
  const conceal = useMemo(() => {
    const names = new Set(hide.split(',').filter(Boolean));
    return (object: THREE.Object3D) => {
      if (names.has(object.name)) object.visible = false;
    };
  }, [hide]);
  useFrame(() => {
    if (hide) scene.traverse(conceal);
  });
  useEffect(() => {
    if (!timed || !box) return;
    const context = gl.getContext() as WebGL2RenderingContext;
    if (!context.getExtension('EXT_disjoint_timer_query_webgl2')) return;
    const clock = new Clock(context, gl.info);
    const render = gl.render;
    const shadows = gl.shadowMap.render;
    const hidden = new Set(hide.split(',').filter(Boolean));
    const hooked = new WeakSet<THREE.Object3D>();
    const hook = (object: THREE.Object3D) => {
      if (hidden.has('other') && partOf(object) === 'other' && (object as THREE.Mesh).isMesh) object.visible = false;
      if (hooked.has(object)) return;
      hooked.add(object);
      const part = partOf(object);
      const beforeRender = object.onBeforeRender;
      const afterRender = object.onAfterRender;
      const beforeShadow = object.onBeforeShadow;
      const afterShadow = object.onAfterShadow;
      object.onBeforeRender = (...args) => {
        beforeRender.apply(object, args);
        clock.enter();
      };
      object.onAfterRender = (...args) => {
        clock.leave('main', part);
        afterRender.apply(object, args);
      };
      object.onBeforeShadow = (...args) => {
        beforeShadow.apply(object, args);
        clock.enter();
      };
      object.onAfterShadow = (...args) => {
        clock.leave('shadow', part);
        afterShadow.apply(object, args);
      };
    };
    let since = 0;
    gl.shadowMap.render = (lights, target, camera) => {
      shadows.call(gl.shadowMap, lights, target, camera);
      clock.between();
    };
    gl.render = (target, camera) => {
      const now = performance.now();
      if (now - since > 400) {
        since = now;
        scene.traverse(hook);
        box.dataset.gpu = clock.report();
      }
      clock.collect();
      clock.frameStart();
      render.call(gl, target, camera);
      clock.frameEnd();
    };
    return () => {
      gl.render = render;
      gl.shadowMap.render = shadows;
    };
  }, [gl, scene, box, timed, hide]);
}

function Meter() {
  const gl = useThree((state) => state.gl);
  const box = useMemo(() => document.querySelector<HTMLElement>('[data-perf]'), []);
  const chip = useMemo(() => shortChip(chipName(gl.getContext())), [gl]);
  const frames = useRef({ count: 0, since: performance.now(), worst: 0, last: performance.now() });
  useClock(box);
  useFrame(() => {
    const now = performance.now();
    const log = frames.current;
    log.worst = Math.max(log.worst, now - log.last);
    log.last = now;
    log.count += 1;
    if (now - log.since < 500 || !box) return;
    const fps = Math.round((log.count * 1000) / (now - log.since));
    box.textContent = `${fps} fps, worst ${Math.round(log.worst)} ms, ${gl.info.render.calls} calls, ${Math.round(gl.info.render.triangles / 1000)}k tris, dpr ${gl.getPixelRatio().toFixed(2)}, ${quality.tier}, ${chip}`;
    log.count = 0;
    log.since = now;
    log.worst = 0;
  });
  return null;
}

export default function FilmScene({ yard, days, story, onFrame, debug }: Props) {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  const shared = useMemo<Shared>(() => ({ plant: 0, grow: SAPLING, draw: 0, move: 0, sail: 0, zoom: 1000 }), []);
  const [ready, setReady] = useState(false);
  const reach = sunReach(yard);
  return (
    <Canvas
      shadows
      flat
      frameloop={ready ? 'demand' : 'never'}
      dpr={[1, TIERS[tier].dpr]}
      camera={{ fov: 30, near: 5, far: 9000, position: [-300, 420, 600] }}
      gl={{ antialias: true, stencil: true, preserveDrawingBuffer: keepFrame(), powerPreference: powerChoice() }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <Stages onReady={() => setReady(true)}>
        <PerformanceMonitor onDecline={() => quality.lower()} />
        <Backdrop yard={yard} />
        <Pulse yard={yard} />
        <Prime run={() => yard.readyCells()} />
        <Prime run={(gl) => primeGround(yard, gl)} />
        <Ground yard={yard} texture={TIERS[tier].texture} grain={TIERS[tier].grain} inert />
        <Prime run={() => primeBlocks(yard)} />
        <Blocks yard={yard} />
        <MappedTrees yard={yard} most={TIERS[tier].standing} grounded={tier === 'high'} />
        <Prime run={() => primeProps(yard, TIERS[tier].props)} />
        <Props yard={yard} level={TIERS[tier].props} />
        <Trees yard={yard} story={story} state={shared} />
        <SailModel yard={yard} sail={story.sail} state={shared} />
        <Walk yard={yard} story={story} state={shared} />
        <Sun yard={yard} reach={reach} shadow={TIERS[tier].shadow} locked />
        <Director yard={yard} days={days} story={story} shared={shared} onFrame={onFrame} />
        {debug && <Meter />}
      </Stages>
    </Canvas>
  );
}
