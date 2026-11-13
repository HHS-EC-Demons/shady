import { Edges, Line, OrbitControls } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { animate } from 'motion/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { atHome, type Block, type Campus, type Tree } from '@/engine/campus';
import { TONES } from '@/engine/detail';
import { centerOf, type Point } from '@/engine/geometry';
import { CANOPY_FLATTEN, type Sail } from '@/engine/shade';
import { probeHeight, sunReach, treeHeight, treeRadius, type PlanTree, type Yard } from './controller';
import { Ground, primeGround } from './ground';
import { BLOB_LIFT, buildBlob, buildBlock, buildCone, buildRoofUnits, buildSail, buildTree, enhanceWalls, treeTint, type BlockLook, type BlockModel } from './models';
import { buildStructures } from './covers';
import { Props, primeProps } from './props';
import { TIERS, type PropLevel } from './quality';
import { Prime, Stages, keep, take } from './stages';

const INK = '#12261c';
const LEAF = '#2f6243';
const WALL = '#eceeea';
const NEIGHBORS = ['#e4ddd5', '#d6dee0', '#dfe3d4', '#e7ddd0'].map((hex) => new THREE.Color(hex));
const PAPER = '#e3eaec';
const HEAT = '#dd5a34';
const CLOTH = '#8fb1ab';
const CLOTH_CHOSEN = '#a9c6c1';
const STEEL = '#56655f';
const SKY = '#f1f7fb';
const BOUNCE = '#d2cabb';
const SUN_LOW = new THREE.Color('#ffe6c8');
const SUN_HIGH = new THREE.Color('#fff7ec');
const MAPPED_LIFT = 1.12;
const BLOB_SPREAD = 1.9;
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const spot = new THREE.Vector3();

function useYard(yard: Yard): number {
  return useSyncExternalStore(yard.subscribe, yard.snapshot, yard.snapshot);
}

function groundPoint(event: ThreeEvent<PointerEvent>): THREE.Vector3 | null {
  return event.ray.intersectPlane(FLOOR, spot);
}

export { Ground, primeGround } from './ground';

const HOME_WALL = new THREE.Color(WALL);

function standAway(campus: Campus, block: Block): [number, number] | undefined {
  const [cx, cy] = centerOf(block.ring);
  let best = Infinity;
  let away: [number, number] | undefined;
  const consider = (line: Point[], closed: boolean) => {
    const count = closed ? line.length : line.length - 1;
    for (let i = 0; i < count; i += 1) {
      const [ax, ay] = line[i];
      const [bx, by] = line[(i + 1) % line.length];
      const dx = bx - ax;
      const dy = by - ay;
      const length = dx * dx + dy * dy;
      const share = length > 0 ? Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / length)) : 0;
      const px = ax + dx * share;
      const py = ay + dy * share;
      const gap = Math.hypot(cx - px, cy - py);
      if (gap < best && gap > 0.5) {
        best = gap;
        away = [(cx - px) / gap, (cy - py) / gap];
      }
    }
  };
  for (const patch of campus.patches) {
    if (patch.sport || patch.label === 'Track' || /field|court/i.test(patch.label ?? '')) consider(patch.ring, true);
  }
  for (const strip of campus.strips) if (strip.surface === 'track') consider(strip.line, false);
  return best < 120 ? away : undefined;
}

function prism(yard: Yard, block: Block, tint: THREE.Color): BlockModel {
  const footprint = block.ring.map(([x, y]): [number, number] => [x - yard.middle[0], y - yard.middle[1]]);
  const look: BlockLook = { home: block.home, tint };
  const top = block.top ?? block.tone;
  if (top) look.top = new THREE.Color(TONES[top]);
  if (block.min !== undefined) look.min = block.min;
  if (block.roof) look.roof = block.roof;
  if (block.rise !== undefined) look.rise = block.rise;
  if (block.across) look.across = true;
  if (block.slope !== undefined) look.slope = block.slope;
  if (block.levels) look.levels = block.levels;
  if (block.stand) {
    const away = standAway(yard.campus, block);
    if (away) look.stand = away;
  }
  return buildBlock(footprint, block.height, look);
}

function shellsOf(yard: Yard) {
  const mine = yard.campus.blocks
    .map((block, index) => ({ block, index }))
    .filter((item) => item.block.home)
    .map((item) => ({ ...item, ...prism(yard, item.block, item.block.wall ? new THREE.Color(TONES[item.block.wall]) : HOME_WALL) }));
  const others = yard.campus.blocks
    .map((block, index) => ({ block, index }))
    .filter((item) => !item.block.home)
    .map(({ block, index }) => prism(yard, block, block.wall ? new THREE.Color(TONES[block.wall]) : NEIGHBORS[index % NEIGHBORS.length]).geometry);
  const merged = others.length > 0 ? mergeGeometries(others) : null;
  for (const other of others) other.dispose();
  return { home: mine, away: merged, built: buildStructures(yard.campus, yard.middle) };
}

export function primeBlocks(yard: Yard): void {
  keep(yard, 'shells', () => shellsOf(yard));
}

export function Blocks({ yard }: { yard: Yard }) {
  const { home, away, built } = useMemo(() => take(yard, 'shells', () => shellsOf(yard)), [yard]);
  useEffect(
    () => () => {
      for (const item of home) item.geometry.dispose();
      away?.dispose();
      built?.dispose();
    },
    [home, away, built],
  );
  const walls = useMemo(() => {
    const mine = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, metalness: 0 });
    const others = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, metalness: 0 });
    enhanceWalls(mine);
    enhanceWalls(others);
    return { mine, others };
  }, []);
  useEffect(
    () => () => {
      walls.mine.dispose();
      walls.others.dispose();
    },
    [walls],
  );
  const units = useMemo(
    () =>
      buildRoofUnits(
        home.map((item) => ({ ring: item.block.ring, height: item.roof })),
        (x, y) => yard.toScene(x, y),
        yard.roof,
      ),
    [yard, home],
  );
  useEffect(() => () => units?.dispose(), [units]);
  const press = useRef<{ x: number; y: number; at: number; index: number } | null>(null);
  return (
    <group name="blocks">
      {home.map(({ block, geometry, index }) => (
        <mesh
          key={`${block.id} ${index}`}
          geometry={geometry}
          material={walls.mine}
          castShadow
          receiveShadow
          onPointerDown={(event) => {
            if (event.button !== 0 || yard.tool !== 'look') return;
            event.stopPropagation();
            press.current = { x: event.clientX, y: event.clientY, at: performance.now(), index };
          }}
          onPointerUp={(event) => {
            const pressed = press.current;
            press.current = null;
            if (!pressed || pressed.index !== index || yard.tool !== 'look') return;
            event.stopPropagation();
            if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 6 && performance.now() - pressed.at < 450) yard.pickBlock(index);
          }}
        >
          <Edges threshold={50} color="#7d8e88" />
        </mesh>
      ))}
      {away && <mesh geometry={away} material={walls.others} castShadow receiveShadow />}
      {built && (
        <mesh name="covers" geometry={built} castShadow receiveShadow raycast={() => null}>
          <meshStandardMaterial vertexColors color="#ffffff" roughness={0.92} metalness={0} />
        </mesh>
      )}
      {units && (
        <mesh geometry={units} castShadow receiveShadow raycast={() => null}>
          <meshStandardMaterial color="#dfe5e4" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

type TreeModel = { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry };

export function useTree(light = false, low = false): TreeModel {
  const model = useMemo(() => buildTree({ light, low }), [light, low]);
  useEffect(
    () => () => {
      model.crown.dispose();
      model.trunk.dispose();
    },
    [model],
  );
  return model;
}

export function useCanopy(): THREE.BufferGeometry {
  const crown = useMemo(() => {
    const model = buildTree();
    model.trunk.dispose();
    return model.crown;
  }, []);
  useEffect(() => () => crown.dispose(), [crown]);
  return crown;
}

type Blob = ReturnType<typeof buildBlob>;

export function useBlob(): Blob {
  const blob = useMemo(buildBlob, []);
  useEffect(
    () => () => {
      blob.geometry.dispose();
      blob.material.dispose();
    },
    [blob],
  );
  return blob;
}

export function blobSize(radius: number): number {
  return radius * BLOB_SPREAD;
}

function girth(radius: number): number {
  return Math.min(1.2, Math.max(0.45, radius / 4.5));
}

function spotKey(tree: Tree): number {
  return Math.round(tree.x * 10) * 73856093 + Math.round(tree.y * 10) * 19349663;
}

export function shownTrees(campus: Campus, most: number): Tree[] {
  if (campus.trees.length <= most) return campus.trees;
  return campus.trees
    .map((tree, order) => ({ tree, order, home: atHome(campus, tree.x, tree.y) }))
    .sort((a, b) => Number(b.home) - Number(a.home) || b.tree.radius - a.tree.radius || a.order - b.order)
    .slice(0, most)
    .map((item) => item.tree);
}

export function MappedTrees({ yard, most = TIERS.high.standing, grounded = true }: { yard: Yard; most?: number; grounded?: boolean }) {
  const model = useTree(true, true);
  const blob = useBlob();
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const blobs = useRef<THREE.InstancedMesh>(null);
  const trees = useMemo(() => shownTrees(yard.campus, most), [yard.campus, most]);
  const needles = useMemo(() => trees.filter((tree) => tree.needle), [trees]);
  const broad = useMemo(() => trees.filter((tree) => !tree.needle), [trees]);
  const cones = useRef<THREE.InstancedMesh>(null);
  const firs = useMemo(() => (needles.length > 0 ? buildCone() : null), [needles.length > 0]);
  useEffect(() => () => firs?.dispose(), [firs]);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const flat = new THREE.Quaternion();
    const shade = new THREE.Color();
    let crown = 0;
    let fir = 0;
    trees.forEach((tree, index) => {
      const [x, , z] = yard.toScene(tree.x, tree.y);
      const tall = tree.needle ? tree.height * 0.82 : tree.radius * CANOPY_FLATTEN;
      const key = spotKey(tree);
      turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (key % 3600) / 573);
      if (tree.needle) {
        const wide = Math.min(tree.radius, tree.height * 0.32);
        matrix.compose(new THREE.Vector3(x, tree.height - tall, z), turn, new THREE.Vector3(wide, tall, wide));
        cones.current?.setMatrixAt(fir, matrix);
        cones.current?.setColorAt(fir, treeTint(key, MAPPED_LIFT, shade));
        fir += 1;
      } else {
        matrix.compose(new THREE.Vector3(x, tree.height - tall, z), turn, new THREE.Vector3(tree.radius, tall, tree.radius));
        crowns.current?.setMatrixAt(crown, matrix);
        crowns.current?.setColorAt(crown, treeTint(key, MAPPED_LIFT, shade));
        crown += 1;
      }
      const trunk = Math.max(0.5, tree.height - tall);
      const thick = girth(tree.radius);
      matrix.compose(new THREE.Vector3(x, trunk / 2, z), turn, new THREE.Vector3(thick, trunk, thick));
      trunks.current?.setMatrixAt(index, matrix);
      const spread = blobSize(tree.radius);
      matrix.compose(new THREE.Vector3(x, BLOB_LIFT, z), flat, new THREE.Vector3(spread, 1, spread));
      blobs.current?.setMatrixAt(index, matrix);
    });
    for (const mesh of [crowns.current, cones.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (trunks.current) {
      trunks.current.instanceMatrix.needsUpdate = true;
      trunks.current.computeBoundingSphere();
    }
    if (blobs.current) {
      blobs.current.instanceMatrix.needsUpdate = true;
      blobs.current.computeBoundingSphere();
    }
  }, [trees, yard, model, blob, grounded, firs]);
  if (trees.length === 0) return null;
  return (
    <group name="trees">
      {broad.length > 0 && (
        <instancedMesh ref={crowns} args={[model.crown, undefined, broad.length]} castShadow raycast={() => null}>
          <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
        </instancedMesh>
      )}
      {firs && (
        <instancedMesh ref={cones} args={[firs, undefined, needles.length]} castShadow raycast={() => null}>
          <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
        </instancedMesh>
      )}
      <instancedMesh ref={trunks} args={[model.trunk, undefined, trees.length]} raycast={() => null}>
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </instancedMesh>
      {grounded && <instancedMesh ref={blobs} name="blobs" args={[blob.geometry, blob.material, trees.length]} renderOrder={-1} raycast={() => null} />}
    </group>
  );
}

function PlantedTree({ yard, tree, chosen, model, blob }: { yard: Yard; tree: PlanTree; chosen: boolean; model: TreeModel; blob: Blob }) {
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((state) => state.invalidate);
  const mode = useRef<'move' | null>(null);
  const [x, , z] = yard.toScene(tree.x, tree.y);
  const tall = tree.radius * CANOPY_FLATTEN;
  const trunk = Math.max(0.6, tree.height - tall);
  const thick = girth(tree.radius);
  const spread = blobSize(tree.radius);
  const tint = useMemo(() => `#${treeTint(tree.id).getHexString()}`, [tree.id]);
  const body = useRef<THREE.Group>(null);
  useEffect(() => {
    const group = body.current;
    if (!group) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      group.scale.setScalar(1);
      return;
    }
    const grow = animate(0.05, 1, {
      type: 'spring',
      stiffness: 260,
      damping: 17,
      onUpdate: (value) => {
        group.scale.setScalar(value);
        invalidate();
      },
    });
    return () => grow.stop();
  }, []);

  const begin = (kind: 'move') => (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || yard.tool === 'sail') return;
    event.stopPropagation();
    mode.current = kind;
    yard.select(tree.id);
    yard.setBusy(true);
    if (controls) controls.enabled = false;
    (event.target as Element).setPointerCapture(event.pointerId);
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (!mode.current) return;
    event.stopPropagation();
    const point = groundPoint(event);
    if (!point) return;
    const [px, py] = yard.fromScene(point.x, point.z);
    yard.moveTree(tree.id, px, py);
  };
  const end = (event: ThreeEvent<PointerEvent>) => {
    if (!mode.current) return;
    event.stopPropagation();
    mode.current = null;
    yard.setBusy(false);
    yard.commit();
    if (controls) controls.enabled = true;
    (event.target as Element).releasePointerCapture(event.pointerId);
  };

  return (
    <group position={[x, 0, z]}>
      <group ref={body} scale={0.05}>
      <mesh
        geometry={model.trunk}
        position-y={trunk / 2}
        scale={[thick, trunk, thick]}
        rotation-y={tree.id * 1.7}
        castShadow
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
      >
        <meshStandardMaterial vertexColors color="#ffffff" roughness={1} />
      </mesh>
      <mesh
        geometry={model.crown}
        position-y={tree.height - tall}
        scale={[tree.radius, tall, tree.radius]}
        rotation-y={tree.id * 1.7}
        castShadow
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerOver={() => (document.body.style.cursor = 'grab')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <meshStandardMaterial vertexColors color={tint} roughness={1} />
      </mesh>
      <mesh geometry={blob.geometry} material={blob.material} position-y={BLOB_LIFT} scale={[spread, 1, spread]} renderOrder={-1} raycast={() => null} />
      </group>
      {chosen && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.12} raycast={() => null}>
          <ringGeometry args={[tree.radius + 0.5, tree.radius + 0.95, 72]} />
          <meshBasicMaterial color={INK} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}

function SailMesh({ yard, sail, chosen }: { yard: Yard; sail: Sail; chosen: boolean }) {
  const [a, , c] = sail.corners.map(([x, y]) => yard.toScene(x, y));
  const middleX = (a[0] + c[0]) / 2;
  const middleZ = (a[2] + c[2]) / 2;
  const wide = Math.max(0.5, Math.round(Math.abs(c[0] - a[0]) * 10) / 10);
  const deep = Math.max(0.5, Math.round(Math.abs(c[2] - a[2]) * 10) / 10);
  const height = Math.round(sail.height * 10) / 10;
  const model = useMemo(() => buildSail(wide, deep, height), [wide, deep, height]);
  useEffect(
    () => () => {
      model.cloth.dispose();
      model.posts.dispose();
    },
    [model],
  );
  return (
    <group position={[middleX, 0, middleZ]}>
      <mesh
        geometry={model.cloth}
        castShadow
        onPointerDown={(event) => {
          if (yard.tool === 'sail') return;
          event.stopPropagation();
          yard.select(sail.id);
        }}
      >
        <meshStandardMaterial color={chosen ? CLOTH_CHOSEN : CLOTH} roughness={1} side={THREE.DoubleSide} />
        <Edges color={INK} />
      </mesh>
      <mesh geometry={model.posts} castShadow raycast={() => null}>
        <meshStandardMaterial color={STEEL} roughness={0.7} />
      </mesh>
    </group>
  );
}

function Plan({ yard }: { yard: Yard }) {
  useYard(yard);
  const ghost = yard.ghost;
  const [grown, setGrown] = useState(false);
  if (!grown && (yard.trees.length > 0 || (ghost !== null && yard.tool === 'tree'))) setGrown(true);
  const model = useMemo(() => (grown ? buildTree() : null), [grown]);
  useEffect(
    () => () => {
      model?.crown.dispose();
      model?.trunk.dispose();
    },
    [model],
  );
  const blob = useBlob();
  return (
    <group>
      {model &&
        yard.trees.map((tree) => (
          <PlantedTree key={tree.id} yard={yard} tree={tree} chosen={yard.selected === tree.id} model={model} blob={blob} />
        ))}
      {yard.sails.map((sail) => (
        <SailMesh key={sail.id} yard={yard} sail={sail} chosen={yard.selected === sail.id} />
      ))}
      {model && ghost && yard.tool === 'tree' && !yard.busy && (
        <mesh
          geometry={model.crown}
          position={[yard.toScene(ghost.x, ghost.y)[0], treeHeight(yard.years) - treeRadius(yard.years) * CANOPY_FLATTEN, yard.toScene(ghost.x, ghost.y)[2]]}
          scale={[treeRadius(yard.years), treeRadius(yard.years) * CANOPY_FLATTEN, treeRadius(yard.years)]}
          raycast={() => null}
        >
          <meshBasicMaterial color={ghost.ok ? LEAF : '#6d7f78'} transparent opacity={ghost.ok ? 0.55 : 0.25} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export function Sun({ yard, reach, locked = false, shadow = TIERS.high.shadow }: { yard: Yard; reach: number; locked?: boolean; shadow?: number }) {
  const { camera, pointer, scene } = useThree();
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const ball = useRef<THREE.Group>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  const held = useRef(false);
  const path = useMemo(() => {
    const samples: { minute: number; at: THREE.Vector3 }[] = [];
    for (let minute = yard.sunrise; minute <= yard.sunset; minute += 4) {
      const ray = yard.sun(minute);
      samples.push({ minute, at: new THREE.Vector3(ray.x * reach, ray.z * reach, -ray.y * reach) });
    }
    const hours: { minute: number; at: THREE.Vector3 }[] = [];
    for (let minute = Math.ceil((yard.sunrise + 40) / 180) * 180; minute <= yard.sunset - 40; minute += 180) {
      const ray = yard.sun(minute);
      hours.push({ minute, at: new THREE.Vector3(ray.x * reach, ray.z * reach, -ray.y * reach) });
    }
    return { samples, hours };
  }, [yard, reach]);
  const flat = useMemo(() => path.samples.map((sample) => sample.at), [path]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(
    () => ({ focus: new THREE.Vector3(), look: new THREE.Vector3(), toward: new THREE.Vector3(), unit: new THREE.Vector3(), across: new THREE.Vector3(), lift: new THREE.Vector3(), span: 0, size: 0 }),
    [],
  );

  useEffect(() => {
    const lamp = light.current;
    if (!lamp) return;
    scene.add(lamp.target);
    return () => {
      scene.remove(lamp.target);
    };
  }, [scene]);

  useFrame((state) => {
    const ray = yard.sun();
    const up = Math.max(0, ray.z);
    if (ball.current) {
      ball.current.position.set(ray.x * reach, ray.z * reach, -ray.y * reach);
      ball.current.visible = ray.z > -0.02;
    }
    const lamp = light.current;
    if (lamp) {
      const { focus, look, toward, unit, across, lift } = aim;
      const orbit = state.controls as OrbitControlsImpl | null;
      const view = state.camera;
      if (orbit) focus.copy(orbit.target);
      else {
        view.getWorldDirection(look);
        if (look.y < -1e-6) focus.copy(view.position).addScaledVector(look, -view.position.y / look.y);
        else focus.set(0, 0, 0);
      }
      const top = yard.radius * 1.25;
      const low = Math.min(60, top);
      const wanted = Math.min(top, Math.max(low, view.position.distanceTo(focus) * 0.8));
      const steps = Math.max(0, Math.ceil(Math.log(wanted / low) / Math.log(1.15) - 1e-6));
      const span = Math.min(top, low * 1.15 ** steps);
      const size = lamp.shadow.mapSize.x;
      if (span !== aim.span || size !== aim.size) {
        aim.span = span;
        aim.size = size;
        const box = lamp.shadow.camera;
        box.left = -span;
        box.right = span;
        box.top = span;
        box.bottom = -span;
        box.updateProjectionMatrix();
        lamp.shadow.normalBias = ((2 * span) / size) * 1.6;
      }
      toward.set(ray.x, Math.max(ray.z, 0.03), -ray.y);
      unit.copy(toward).normalize();
      across.set(unit.z, 0, -unit.x);
      if (across.lengthSq() < 1e-12) across.set(1, 0, 0);
      else across.normalize();
      lift.crossVectors(unit, across);
      const texel = (2 * span) / size;
      const a = Math.round(focus.dot(across) / texel) * texel;
      const b = Math.round(focus.dot(lift) / texel) * texel;
      const c = focus.dot(unit);
      focus.copy(across).multiplyScalar(a).addScaledVector(lift, b).addScaledVector(unit, c);
      lamp.position.copy(focus).addScaledVector(toward, reach * 3);
      lamp.target.position.copy(focus);
      lamp.target.updateMatrixWorld();
      lamp.intensity = 1.17 * Math.min(1, up * 6);
      lamp.color.copy(SUN_LOW).lerp(SUN_HIGH, Math.min(1, Math.max(0, (ray.z - 0.1) / 0.5)));
    }
    if (fill.current) fill.current.intensity = 1.8 + 0.6 * Math.min(1, up * 5);
  });

  const drag = (event: ThreeEvent<PointerEvent>) => {
    if (!held.current) return;
    event.stopPropagation();
    let best = 0;
    let nearest = Infinity;
    path.samples.forEach((sample, index) => {
      projected.copy(sample.at).project(camera);
      const distance = Math.hypot(projected.x - pointer.x, projected.y - pointer.y);
      if (distance < nearest) {
        nearest = distance;
        best = index;
      }
    });
    yard.setMinute(path.samples[best].minute);
  };

  const size = reach * 0.045;
  return (
    <group name="sun">
      <hemisphereLight ref={fill} args={[SKY, BOUNCE, 1.8]} />
      <directionalLight
        ref={light}
        castShadow
        shadow-mapSize={[shadow, shadow]}
        shadow-bias={-0.0002}
        shadow-radius={2}
        shadow-camera-near={1}
        shadow-camera-far={reach * 8}
      />
      {flat.length > 1 && <Line points={flat} color={INK} lineWidth={1.4} transparent opacity={0.45} />}
      {path.hours.map((hour) => (
        <group key={hour.minute} position={hour.at}>
          <mesh raycast={() => null}>
            <sphereGeometry args={[size * 0.16, 10, 8]} />
            <meshBasicMaterial color={INK} />
          </mesh>
        </group>
      ))}
      <group ref={ball} name="sun ball" userData={{ size }}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[size, 40, 28]} />
          <meshBasicMaterial color={HEAT} />
        </mesh>
        <mesh
          {...(locked ? { raycast: () => null } : {})}
          onPointerDown={(event) => {
            event.stopPropagation();
            held.current = true;
            yard.setBusy(true);
            if (controls) controls.enabled = false;
            (event.target as Element).setPointerCapture(event.pointerId);
            document.body.style.cursor = 'grabbing';
          }}
          onPointerMove={drag}
          onPointerUp={(event) => {
            event.stopPropagation();
            held.current = false;
            yard.setBusy(false);
            if (controls) controls.enabled = true;
            (event.target as Element).releasePointerCapture(event.pointerId);
            document.body.style.cursor = '';
          }}
          onPointerOver={() => !held.current && (document.body.style.cursor = 'grab')}
          onPointerOut={() => !held.current && (document.body.style.cursor = '')}
        >
          <sphereGeometry args={[size * 2.6, 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function ProbeMark({ yard }: { yard: Yard }) {
  useYard(yard);
  const probe = yard.probe;
  if (!probe || !probe.home || probe.surface === 'roof') return null;
  const [x, , z] = yard.toScene(probe.x, probe.y);
  const tall = probeHeight(yard);
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={tall / 2} raycast={() => null}>
        <cylinderGeometry args={[0.14, 0.14, tall, 6]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} raycast={() => null}>
        <ringGeometry args={[1.5, 1.9, 40]} />
        <meshBasicMaterial color={INK} />
      </mesh>
    </group>
  );
}

export { probeHeight, sunReach } from './controller';

const pin = new THREE.Vector3();
const disc = new THREE.Vector3();
const rim = new THREE.Vector3();
const CLEAR_TOP = 124;
const LABEL_HALF = [24, 10];

function Pins({ layer }: { layer: RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size, scene }) => {
    const root = layer.current;
    if (!root) return;
    const sun = scene.getObjectByName('sun ball');
    let sunX = 0;
    let sunY = 0;
    let sunR = -1;
    if (sun?.visible) {
      sun.getWorldPosition(disc);
      rim.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(Number(sun.userData.size) || 0).add(disc).project(camera);
      disc.project(camera);
      sunX = ((disc.x + 1) / 2) * size.width;
      sunY = ((1 - disc.y) / 2) * size.height;
      sunR = Math.abs(rim.x - disc.x) * 0.5 * size.width;
    }
    for (const node of Array.from(root.children)) {
      const item = node as HTMLElement;
      const at = item.dataset.at;
      if (!at) continue;
      const [x, y, z] = at.split(' ').map(Number);
      pin.set(x, y, z).project(camera);
      const left = ((pin.x + 1) / 2) * size.width;
      const top = ((1 - pin.y) / 2) * size.height;
      item.style.visibility = pin.z < 1 ? 'visible' : 'hidden';
      if (item.dataset.hour !== undefined) {
        const covered = sunR >= 0 && Math.abs(left - sunX) < sunR + LABEL_HALF[0] && Math.abs(top - sunY) < sunR + LABEL_HALF[1];
        item.style.opacity = top < CLEAR_TOP || covered ? '0' : '';
      }
      item.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
  });
  return null;
}

function Rig({ yard, reach }: { yard: Yard; reach: number }) {
  const { camera, size, invalidate } = useThree();
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const fitted = useRef(false);
  const home = useRef(1000);
  const turn = useRef(0);
  const glide = useRef<{ stop: () => void } | null>(null);
  const view = camera as THREE.PerspectiveCamera;
  const half = (view.fov * Math.PI) / 360;

  useEffect(() => {
    const narrow = size.width / size.height < 1;
    const span = Math.max(yard.radius * 0.95, reach * 1.05);
    const distance = (span / Math.tan(half)) * (narrow ? 1.5 : 0.9);
    const before = home.current;
    home.current = distance;
    if (fitted.current && controls && Math.abs(view.position.distanceTo(controls.target) - before) < before * 0.07) {
      const offset = view.position.clone().sub(controls.target).setLength(distance);
      view.position.copy(controls.target).add(offset);
    }
    if (!fitted.current) {
      const direction = new THREE.Vector3(-0.42, 0.62, 0.86).normalize();
      view.position.set(0, reach * 0.14, 0).add(direction.multiplyScalar(distance));
      fitted.current = true;
    }
    if (import.meta.env.DEV) (window as unknown as { view: THREE.Camera }).view = view;
    view.near = 4;
    view.far = distance * 12;
    if (size.width >= 1024) view.setViewOffset(size.width, size.height, -size.width * 0.07, -size.height * 0.02, size.width, size.height);
    else view.clearViewOffset();
    view.updateProjectionMatrix();
    invalidate();
  }, [view, half, size.width, size.height, yard, reach]);

  const shown = useRef(1);
  useEffect(
    () => () => {
      const heading = document.querySelector<HTMLElement>('[data-heading]');
      if (heading) heading.style.opacity = '';
    },
    [],
  );

  const seen = useRef(yard);

  useFrame(() => {
    if (seen.current !== yard) {
      seen.current = yard;
      turn.current = yard.focusTurn;
    }
    if (controls && fitted.current) {
      const near = view.position.distanceTo(controls.target) / home.current;
      const opacity = Math.min(1, Math.max(0, (near - 0.74) / 0.18));
      if (Math.abs(opacity - shown.current) > 0.004) {
        shown.current = opacity;
        const heading = document.querySelector<HTMLElement>('[data-heading]');
        if (heading) heading.style.opacity = String(opacity);
      }
    }
    if (!controls || turn.current === yard.focusTurn) return;
    turn.current = yard.focusTurn;
    const goal = yard.focus;
    const fromTarget = controls.target.clone();
    const offset = view.position.clone().sub(controls.target);
    const fromLength = offset.length();
    const toTarget = goal ? new THREE.Vector3(...yard.toScene(goal.x, goal.y)) : new THREE.Vector3(0, reach * 0.14, 0);
    const toLength = goal ? Math.min(home.current, Math.max(90, (goal.span / Math.tan(half)) * 1.25)) : home.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    glide.current?.stop();
    glide.current = animate(0, 1, {
      duration: still ? 0 : 1.2,
      ease: [0.3, 0, 0.15, 1],
      onUpdate: (share) => {
        controls.target.lerpVectors(fromTarget, toTarget, share);
        view.position.copy(controls.target).add(offset.clone().setLength(fromLength + (toLength - fromLength) * share));
        invalidate();
      },
    });
  });

  return (
    <OrbitControls
      makeDefault
      target={[0, reach * 0.14, 0]}
      enablePan
      screenSpacePanning={false}
      zoomToCursor
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={1.25}
      minDistance={45}
      maxDistance={yard.radius * 6}
      minPolarAngle={0.12}
      maxPolarAngle={1.42}
      onStart={() => glide.current?.stop()}
    />
  );
}

export function Backdrop({ yard }: { yard: Yard }) {
  const stacked = useThree((state) => state.gl.getContextAttributes()?.stencil === true);
  return (
    <>
      <color attach="background" args={['#e9eff1']} />
      <fog attach="fog" args={['#e9eff1', yard.radius * 4, yard.radius * 9]} />
      <mesh name="backdrop" rotation-x={-Math.PI / 2} position-y={-0.3} renderOrder={stacked ? 2 : -2} raycast={() => null}>
        <circleGeometry args={[yard.radius * 12, 64]} />
        <meshBasicMaterial color={PAPER} stencilWrite={stacked} stencilWriteMask={0} stencilRef={1} stencilFunc={THREE.NotEqualStencilFunc} />
      </mesh>
    </>
  );
}

export function Pulse({ yard }: { yard: Yard }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
    return yard.subscribe(() => invalidate());
  }, [yard, invalidate]);
  useFrame(() => {
    yard.tick(performance.now());
    if (yard.working()) invalidate();
  });
  return null;
}

type SceneProps = { yard: Yard; layer: RefObject<HTMLDivElement | null>; shadow?: number; texture?: number; props?: PropLevel; standing?: number; onReady: () => void };

export function Scene({ yard, layer, shadow = TIERS.high.shadow, texture = TIERS.high.texture, props = TIERS.high.props, standing = TIERS.high.standing, onReady }: SceneProps) {
  const reach = sunReach(yard);
  return (
    <Stages onReady={onReady}>
      <Backdrop yard={yard} />
      <Pulse yard={yard} />
      <Prime run={() => yard.readyCells()} />
      <Prime run={(gl) => primeGround(yard, gl)} />
      <Ground yard={yard} texture={texture} />
      <Prime run={() => primeBlocks(yard)} />
      <Blocks yard={yard} />
      <MappedTrees yard={yard} most={standing} grounded={props !== null && !props.light} />
      <Prime run={() => primeProps(yard, props)} />
      <Props yard={yard} level={props} />
      <Plan yard={yard} />
      <Sun yard={yard} reach={reach} shadow={shadow} />
      <ProbeMark yard={yard} />
      <Rig yard={yard} reach={reach} />
      <Pins layer={layer} />
    </Stages>
  );
}
