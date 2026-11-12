import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { CANOPY_FLATTEN, shadowShift, type Sail } from '@/engine/shade';
import type { Story } from '@/engine/story';
import { treeRadius } from '@/engine/growth';
import type { Yard } from '../yard/controller';
import { TIERS, quality } from '../yard/quality';
import { buildSail, treeTint } from '../yard/models';
import { Backdrop, Blocks, Ground, MappedTrees, Pulse, Sun, sunReach, useTree } from '../yard/Scene';
import type { Days } from './Film';
import { BEATS, film } from './state';

const LAST = BEATS - 1;
const SAPLING = treeRadius(1) / treeRadius(20);
const INK = '#12261c';
const CLOTH = '#8fb1ab';
const STEEL = '#56655f';
const MID_MORNING = 10 * 60;

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

type Shared = { plant: number; grow: number; draw: number; move: number; sail: number; zoom: number };

function Trees({ yard, story, state }: { yard: Yard; story: Story; state: Shared }) {
  const model = useTree(true);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const seen = useRef({ plant: -1, grow: -1 });
  const tools = useMemo(() => ({ matrix: new THREE.Matrix4(), spin: new THREE.Quaternion(), at: new THREE.Vector3(), size: new THREE.Vector3() }), []);
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
    if (!crowns.current || !trunks.current) return;
    if (Math.abs(seen.current.plant - state.plant) < 0.0005 && Math.abs(seen.current.grow - state.grow) < 0.0005) return;
    seen.current.plant = state.plant;
    seen.current.grow = state.grow;
    const { matrix, spin, at, size } = tools;
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
    }
    crowns.current.instanceMatrix.needsUpdate = true;
    trunks.current.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <group>
      <instancedMesh ref={crowns} args={[model.crown, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[model.trunk, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </instancedMesh>
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
    node.visible = state.sail > 0.001;
  });

  return (
    <group ref={group} position={[shape.x, 0, shape.z]} visible={false}>
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
    const one = yard.toScene(story.anchor[0], story.anchor[1]);
    const two = yard.toScene(story.anchor2[0], story.anchor2[1]);
    const shade = yard.toScene(story.shade2Before[0], story.shade2Before[1]);
    const three = yard.toScene(story.focus3[0], story.focus3[1]);
    const [a, , c] = story.sail.corners;
    const noon = yard.sun(story.peak);
    const [sx, sy] = shadowShift(noon, story.sail.height);
    const sail = yard.toScene((a[0] + c[0]) / 2 + sx / 2, (a[1] + c[1]) / 2 + sy / 2);
    const cover = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(sx, sy);
    const third = (cover * (narrow ? 1.7 : 2.4)) / (2 * Math.tan(half) * Math.min(aspect, 1.6));
    const walk = Math.hypot(shade[0] - two[0], shade[2] - two[2]);
    const morning = yard.sun(story.early);

    const start = Math.atan2(-0.42, 0.86);
    const shadow = heading(-noon.x, noon.y);
    const turn1 = start + 0.55;
    const turn2 = closest(across(shade[0] - two[0], shade[2] - two[2], shadow), turn1);
    const turn3 = closest(shadow + 0.75, turn2);
    const turn4 = closest(heading(-three[0], -three[2]) - 0.5, turn3);
    const turn5 = closest(across(-morning.x, morning.y, turn1 + Math.PI), turn4);
    const turn6 = turn5 + 0.45;
    return [
      { x: 0, z: 0, y: reach * 0.14, distance: home, turn: start, tilt: 0.575 },
      { x: one[0], z: one[2], y: 0, distance: fit(70), turn: turn1, tilt: 0.4 },
      { x: (two[0] + shade[0]) / 2, z: (two[2] + shade[2]) / 2, y: 0, distance: fit(Math.max(walk * 0.8, 60)), turn: turn2, tilt: 0.62 },
      { x: sail[0], z: sail[2], y: 1.5, distance: Math.max(18, third), turn: turn3, tilt: 0.36 },
      { x: three[0], z: three[2], y: 0, distance: fit(story.span3 * 0.62), turn: turn4, tilt: 0.62 },
      { x: one[0], z: one[2], y: 0, distance: fit(85), turn: turn5, tilt: 0.44 },
      { x: 0, z: 0, y: reach * 0.1, distance: home * 0.92, turn: turn6, tilt: 0.5 },
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
    if (at < 3) {
      yard.setBase(yard.bare);
      yard.setBlend(days.sail, ramp(at, 2.15, 2.85));
    } else {
      yard.setBase(days.sail);
      yard.setBlend(days.full, shared.plant * shared.grow * shared.grow);
    }
    yard.setMinute(minute);

    if (film.current !== film.target) invalidate();
    if (first.current) {
      first.current = false;
      onFrame();
    }
  });

  return null;
}

type Props = { yard: Yard; days: Days; story: Story; onFrame: () => void; debug: boolean };

function Meter() {
  const gl = useThree((state) => state.gl);
  const box = useMemo(() => document.querySelector<HTMLElement>('[data-perf]'), []);
  const frames = useRef({ count: 0, since: performance.now(), worst: 0, last: performance.now() });
  useFrame(() => {
    const now = performance.now();
    const log = frames.current;
    log.worst = Math.max(log.worst, now - log.last);
    log.last = now;
    log.count += 1;
    if (now - log.since < 500 || !box) return;
    const fps = Math.round((log.count * 1000) / (now - log.since));
    box.textContent = `${fps} fps, worst ${Math.round(log.worst)} ms, ${gl.info.render.calls} calls, ${Math.round(gl.info.render.triangles / 1000)}k tris, dpr ${gl.getPixelRatio().toFixed(2)}, ${quality.tier}`;
    log.count = 0;
    log.since = now;
    log.worst = 0;
  });
  return null;
}

export default function FilmScene({ yard, days, story, onFrame, debug }: Props) {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  const shared = useMemo<Shared>(() => ({ plant: 0, grow: SAPLING, draw: 0, move: 0, sail: 0, zoom: 1000 }), []);
  const reach = sunReach(yard);
  return (
    <Canvas
      shadows
      flat
      frameloop="demand"
      dpr={[1, TIERS[tier].dpr]}
      camera={{ fov: 30, near: 5, far: 9000, position: [-300, 420, 600] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => quality.lower()} />
      <Backdrop yard={yard} />
      <Pulse yard={yard} />
      <Ground yard={yard} texture={TIERS[tier].texture} inert />
      <Blocks yard={yard} />
      <MappedTrees yard={yard} />
      <Trees yard={yard} story={story} state={shared} />
      <SailModel yard={yard} sail={story.sail} state={shared} />
      <Walk yard={yard} story={story} state={shared} />
      <Sun yard={yard} reach={reach} shadow={TIERS[tier].shadow} locked />
      <Director yard={yard} days={days} story={story} shared={shared} onFrame={onFrame} />
      {debug && <Meter />}
    </Canvas>
  );
}
