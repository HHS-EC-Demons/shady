import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FRAME_SIDE, HOURS, hourPlace, type Status, type Summary } from '@/engine/district';
import { rampTable } from '@/engine/heat';
import { sunAt, utcFor } from '@/engine/sun';
import type { Weather } from '@/engine/weather';
import { TIERS, keepFrame, powerChoice, quality, type Tier } from '../yard/quality';

export type Tile = { key: string; slot: number; status: Status; summary?: Summary; busy: boolean };

type Props = {
  tiles: Tile[];
  slots: number;
  minute: number;
  weather: Weather | null;
  center: { lat: number; lon: number };
  tier: Tier;
  active: string | null;
  onHover: (key: string | null) => void;
  onOpen: (key: string) => void;
  label: RefObject<HTMLDivElement | null>;
  insets: { top: number; bottom: number };
  onReady: () => void;
};

const TILE = 10;
const GAP = 2.2;
const THICK = 1.2;
const ROUND = 0.5;
const FLAT = TILE - ROUND * 2;
const INNER = FLAT - 0.5;
const LIFT = 0.9;
const HOP = 2.6;
const MOVE_MS = 650;
const FILL_MS = 520;
const PITCH = (54 * Math.PI) / 180;
const PULSE_MS = 2000;
const PULSE = 0.7;
const LAYERS = HOURS + 1;
const BACKGROUND = '#e9eff1';
const FLOOR = '#e9eff1';
const CLAY = '#eef2f0';
const BLANK = '#f2f5f4';
const GONE = '#d9e1e2';
const WALL = '#eceeea';
const SHADOW = '#2b4450';
const SKY = '#f1f7fb';
const BOUNCE = '#d2cabb';

type Motion = { x: number; z: number; fromX: number; fromZ: number; toX: number; toZ: number; start: number; lift: number; fill: number; placed: boolean; done: boolean; gone: boolean; busy: boolean; rising: boolean };

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function columnsFor(count: number, width: number, height: number): number {
  let best = 1;
  let size = 0;
  const depth = Math.sin(PITCH);
  for (let cols = 1; cols <= Math.max(1, count); cols += 1) {
    const rows = Math.ceil(count / cols);
    const wide = cols * (TILE + GAP) - GAP;
    const deep = rows * (TILE + GAP) - GAP;
    const scale = Math.min(width / wide, height / (deep * depth + THICK));
    if (scale > size * 1.0001) {
      size = scale;
      best = cols;
    }
  }
  return best;
}

function spot(index: number, cols: number, rows: number): [number, number] {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [(col - (cols - 1) / 2) * (TILE + GAP), (row - (rows - 1) / 2) * (TILE + GAP)];
}

const VERTEX = `
#include <common>
#include <shadowmap_pars_vertex>
attribute float aSlot;
attribute vec2 aFit;
attribute vec2 aSize;
attribute float aFill;
attribute float aGone;
varying vec2 vUv;
varying float vSlot;
varying vec2 vFit;
varying vec2 vSize;
varying float vFill;
varying float vGone;
void main() {
  vUv = uv;
  vSlot = aSlot;
  vFit = aFit;
  vSize = aSize;
  vFill = aFill;
  vGone = aGone;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * vec4( world.xyz + vec3( 0.0, directionalLightShadows[ i ].shadowNormalBias, 0.0 ), 1.0 );
    }
    #pragma unroll_loop_end
  #endif
}
`;

const FRAGMENT = `
#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2DArray uFrames;
uniform sampler2D uRamp;
uniform float uHour;
uniform vec3 uBlank;
uniform vec3 uGone;
uniform vec3 uShade;
varying vec2 vUv;
varying float vSlot;
varying vec2 vFit;
varying vec2 vSize;
varying float vFill;
varying float vGone;
void main() {
  vec3 blank = mix(uBlank, uGone, vGone);
  vec3 colour = blank;
  if (vFill > 0.001) {
    vec2 local = (vUv - 0.5) / max(vFit, vec2(0.001)) + 0.5;
    vec2 edge = step(vec2(0.0), local) * step(local, vec2(1.0));
    vec2 at = clamp(local, 0.0, 1.0) * vSize;
    float base = floor(vSlot + 0.5) * ${LAYERS.toFixed(1)};
    float low = floor(uHour);
    float high = min(low + 1.0, ${(HOURS - 1).toFixed(1)});
    float a = texture(uFrames, vec3(at, base + low)).r;
    float b = texture(uFrames, vec3(at, base + high)).r;
    float inside = texture(uFrames, vec3(at, base + ${HOURS.toFixed(1)})).r;
    float value = mix(a, b, uHour - low);
    vec3 hot = texture2D(uRamp, vec2((value * 255.0 + 0.5) / 256.0, 0.5)).rgb;
    float home = smoothstep(0.35, 0.65, inside) * edge.x * edge.y;
    colour = mix(blank, hot, home * vFill);
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
  float shaded = 0.26 * (1.0 - getShadowMask());
  if (shaded > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uShade, 1.0)).rgb, shaded);
}
`;

const STAND_SHARE = 0.55;
const COVER_THICK = 0.35;

function prismOf(ring: number[], summary: Summary, scale: number, bottom: number, top: number): THREE.BufferGeometry | null {
  const points: THREE.Vector2[] = [];
  for (let index = 0; index + 1 < ring.length; index += 2) {
    points.push(new THREE.Vector2((ring[index] - summary.width / 2) * scale, (ring[index + 1] - summary.depth / 2) * scale));
  }
  if (points.length < 3) return null;
  const prism = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: Math.max(0.015, (top - bottom) * scale), bevelEnabled: false, steps: 1 });
  prism.rotateX(-Math.PI / 2);
  prism.translate(0, bottom * scale, 0);
  prism.deleteAttribute('uv');
  return prism;
}

function blocksOf(summary: Summary): THREE.BufferGeometry | null {
  const scale = INNER / Math.max(summary.width, summary.depth, 1);
  const parts: THREE.BufferGeometry[] = [];
  for (const block of summary.blocks) {
    const top = block.stand ? block.height * STAND_SHARE : block.height;
    const prism = prismOf(block.ring, summary, scale, Math.min(block.min ?? 0, top), top);
    if (prism) parts.push(prism);
  }
  for (const cover of summary.covers ?? []) {
    const prism = prismOf(cover.ring, summary, scale, Math.max(0, cover.height - COVER_THICK), cover.height);
    if (prism) parts.push(prism);
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

function Tiles({ tiles, slots, minute, active, onHover, onOpen, label, cols }: Props & { cols: number }) {
  const invalidate = useThree((state) => state.invalidate);
  const slabs = useRef<THREE.InstancedMesh>(null);
  const tops = useRef<THREE.InstancedMesh>(null);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const motion = useRef<Motion[]>([]);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);

  const slab = useMemo(() => {
    const geometry = new RoundedBoxGeometry(TILE, THICK, TILE, 3, ROUND);
    geometry.translate(0, THICK / 2, 0);
    return geometry;
  }, []);
  useEffect(() => () => slab.dispose(), [slab]);

  const top = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(FLAT, FLAT);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, THICK + 0.012, 0);
    const count = Math.max(1, slots);
    const attribute = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
    geometry.setAttribute('aSlot', attribute(1));
    geometry.setAttribute('aFit', attribute(2));
    geometry.setAttribute('aSize', attribute(2));
    geometry.setAttribute('aFill', attribute(1));
    geometry.setAttribute('aGone', attribute(1));
    const slot = geometry.getAttribute('aSlot') as THREE.InstancedBufferAttribute;
    for (let index = 0; index < count; index += 1) slot.setX(index, index);
    return geometry;
  }, [slots]);
  useEffect(() => () => top.dispose(), [top]);

  const frames = useMemo(() => {
    const depth = Math.max(1, slots) * LAYERS;
    const texture = new THREE.DataArrayTexture(new Uint8Array(FRAME_SIDE * FRAME_SIDE * depth), FRAME_SIDE, FRAME_SIDE, depth);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }, [slots]);
  useEffect(() => () => frames.dispose(), [frames]);

  const materials = useMemo(() => {
    const ramp = new THREE.DataTexture(rampTable(), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    ramp.colorSpace = THREE.SRGBColorSpace;
    ramp.magFilter = THREE.LinearFilter;
    ramp.minFilter = THREE.LinearFilter;
    ramp.needsUpdate = true;
    const heat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      lights: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
        uFrames: { value: frames },
        uRamp: { value: ramp },
        uHour: { value: 0 },
        uBlank: { value: new THREE.Color(BLANK) },
        uGone: { value: new THREE.Color(GONE) },
        uShade: { value: new THREE.Color(SHADOW) },
      },
    });
    const clay = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.95, metalness: 0 });
    const walls = new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.92, metalness: 0 });
    return { heat, clay, walls, ramp };
  }, [frames]);
  useEffect(
    () => () => {
      materials.heat.dispose();
      materials.clay.dispose();
      materials.walls.dispose();
      materials.ramp.dispose();
    },
    [materials],
  );

  const batch = useMemo(() => {
    const mesh = new THREE.BatchedMesh(Math.max(1, slots), 4096, 0, materials.walls);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    mesh.raycast = () => undefined;
    return { mesh, ids: new Map<number, { instance: number; geometry: number; summary: Summary }>(), vertices: 4096, used: 0 };
  }, [slots, materials]);
  useEffect(() => () => batch.mesh.dispose(), [batch]);

  const written = useRef(new Map<number, Summary>());
  useEffect(() => {
    written.current.clear();
  }, [frames]);

  useEffect(() => {
    const fit = top.getAttribute('aFit') as THREE.InstancedBufferAttribute;
    const size = top.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    const data = frames.image.data as Uint8Array;
    const layer = FRAME_SIDE * FRAME_SIDE;
    let changed = false;
    for (const tile of tiles) {
      const summary = tile.summary;
      if (!summary || written.current.get(tile.slot) === summary) continue;
      written.current.set(tile.slot, summary);
      const scale = INNER / Math.max(summary.width, summary.depth, 1);
      fit.setXY(tile.slot, (summary.width * scale) / FLAT, (summary.depth * scale) / FLAT);
      size.setXY(tile.slot, summary.cols / FRAME_SIDE, summary.rows / FRAME_SIDE);
      const cells = summary.cols * summary.rows;
      for (let hour = 0; hour < LAYERS; hour += 1) {
        const target = (tile.slot * LAYERS + hour) * layer;
        data.fill(0, target, target + layer);
        const source = hour < HOURS ? summary.frames.subarray(hour * cells, (hour + 1) * cells) : summary.mask;
        for (let row = 0; row < summary.rows; row += 1) data.set(source.subarray(row * summary.cols, (row + 1) * summary.cols), target + row * FRAME_SIDE);
        frames.addLayerUpdate(tile.slot * LAYERS + hour);
      }
      const known = batch.ids.get(tile.slot);
      if (!known || known.summary.blocks !== summary.blocks || known.summary.covers !== summary.covers) {
        const geometry = blocksOf(summary);
        if (known) {
          batch.mesh.deleteInstance(known.instance);
          batch.mesh.deleteGeometry(known.geometry);
          batch.ids.delete(tile.slot);
        }
        if (geometry) {
          const need = geometry.getAttribute('position').count;
          if (batch.used + need > batch.vertices) {
            batch.vertices = Math.max(batch.vertices * 2, batch.used + need);
            batch.mesh.setGeometrySize(batch.vertices, 0);
          }
          const id = batch.mesh.addGeometry(geometry);
          batch.used += need;
          batch.ids.set(tile.slot, { instance: batch.mesh.addInstance(id), geometry: id, summary });
          geometry.dispose();
        }
      } else {
        known.summary = summary;
      }
      changed = true;
    }
    if (changed) {
      fit.needsUpdate = true;
      size.needsUpdate = true;
      frames.needsUpdate = true;
    }
    const now = performance.now();
    const list = motion.current;
    for (let index = 0; index < Math.max(1, slots); index += 1) {
      if (!list[index]) list[index] = { x: 0, z: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0, start: 0, lift: 0, fill: 0, placed: false, done: false, gone: false, busy: false, rising: false };
    }
    tiles.forEach((tile, place) => {
      const state = list[tile.slot];
      const [x, z] = spot(place, cols, rows);
      state.done = tile.status === 'done' && Boolean(tile.summary);
      state.gone = tile.status === 'failed' || tile.status === 'unmapped';
      state.busy = tile.busy;
      if (!state.placed) {
        state.x = state.toX = state.fromX = x;
        state.z = state.toZ = state.fromZ = z;
        state.placed = true;
      } else if (state.toX !== x || state.toZ !== z) {
        state.rising = z < state.z - 0.01 || (Math.abs(z - state.z) <= 0.01 && x < state.x);
        state.fromX = state.x;
        state.fromZ = state.z;
        state.toX = x;
        state.toZ = z;
        state.start = now;
      }
    });
    invalidate();
  }, [tiles, cols, rows, slots, top, frames, batch, invalidate]);

  useEffect(() => {
    materials.heat.uniforms.uHour.value = hourPlace(minute);
    invalidate();
  }, [minute, materials, invalidate]);

  useEffect(() => {
    invalidate();
  }, [active, invalidate]);

  const keys = useMemo(() => {
    const map = new Map<number, string>();
    for (const tile of tiles) map.set(tile.slot, tile.key);
    return map;
  }, [tiles]);

  const last = useRef(performance.now());
  useFrame(({ camera, size }) => {
    const now = performance.now();
    const step = Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    let moving = false;
    const fill = top.getAttribute('aFill') as THREE.InstancedBufferAttribute;
    const gone = top.getAttribute('aGone') as THREE.InstancedBufferAttribute;
    const list = motion.current;
    let activeSlot = -1;
    const pulse = PULSE * (0.5 - 0.5 * Math.cos((now / PULSE_MS) * Math.PI * 2));
    for (let slot = 0; slot < Math.max(1, slots); slot += 1) {
      const state = list[slot];
      if (!state || !state.placed || !keys.has(slot)) {
        matrix.makeScale(0, 0, 0);
        slabs.current?.setMatrixAt(slot, matrix);
        tops.current?.setMatrixAt(slot, matrix);
        const hidden = batch.ids.get(slot);
        if (hidden) batch.mesh.setMatrixAt(hidden.instance, matrix);
        continue;
      }
      const travelling = state.x !== state.toX || state.z !== state.toZ;
      if (travelling) {
        const share = Math.min(1, (now - state.start) / MOVE_MS);
        const eased = ease(share);
        state.x = share >= 1 ? state.toX : state.fromX + (state.toX - state.fromX) * eased;
        state.z = share >= 1 ? state.toZ : state.fromZ + (state.toZ - state.fromZ) * eased;
        moving = true;
      }
      const isActive = keys.get(slot) === active && active !== null;
      if (isActive) activeSlot = slot;
      const liftTo = (isActive ? LIFT : 0) + (travelling && state.rising ? HOP : 0);
      if (Math.abs(state.lift - liftTo) > 0.002) {
        state.lift += (liftTo - state.lift) * Math.min(1, step * 14);
        moving = true;
      } else state.lift = liftTo;
      const fillTo = state.done ? 1 : 0;
      if (state.fill !== fillTo) {
        const change = (step * 1000) / FILL_MS;
        state.fill = fillTo > state.fill ? Math.min(fillTo, state.fill + change) : Math.max(fillTo, state.fill - change);
        moving = true;
      }
      matrix.makeTranslation(state.x, state.lift, state.z);
      slabs.current?.setMatrixAt(slot, matrix);
      tops.current?.setMatrixAt(slot, matrix);
      fill.setX(slot, state.fill);
      gone.setX(slot, state.gone ? 1 : state.busy ? pulse : 0);
      if (state.busy) moving = true;
      const built = batch.ids.get(slot);
      if (built) {
        const rise = Math.max(0.001, ease(state.fill));
        matrix.makeScale(1, rise, 1).setPosition(state.x, state.lift + THICK, state.z);
        batch.mesh.setMatrixAt(built.instance, matrix);
      }
    }
    if (slabs.current) {
      slabs.current.instanceMatrix.needsUpdate = true;
      slabs.current.computeBoundingSphere();
    }
    if (tops.current) {
      tops.current.instanceMatrix.needsUpdate = true;
      tops.current.computeBoundingSphere();
    }
    fill.needsUpdate = true;
    gone.needsUpdate = true;
    const tag = label.current;
    if (tag) {
      const state = activeSlot >= 0 ? list[activeSlot] : null;
      if (state) {
        anchor.set(state.x, state.lift + THICK, state.z - FLAT / 2).project(camera);
        tag.style.visibility = 'visible';
        tag.style.transform = `translate3d(${((anchor.x + 1) / 2) * size.width}px, ${((1 - anchor.y) / 2) * size.height}px, 0)`;
      } else tag.style.visibility = 'hidden';
    }
    if (moving) invalidate();
  });

  const count = Math.max(1, slots);
  return (
    <group>
      <instancedMesh
        ref={slabs}
        args={[slab, materials.clay, count]}
        castShadow
        receiveShadow
        onPointerMove={(event) => {
          if (event.instanceId === undefined) return;
          event.stopPropagation();
          const key = keys.get(event.instanceId) ?? null;
          if (key !== active) onHover(key);
          document.body.style.cursor = key ? 'pointer' : '';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = '';
        }}
        onClick={(event) => {
          if (event.instanceId === undefined) return;
          const key = keys.get(event.instanceId);
          if (key) onOpen(key);
        }}
      />
      <instancedMesh ref={tops} args={[top, materials.heat, count]} raycast={() => null} frustumCulled={false} receiveShadow />
      <primitive object={batch.mesh} />
    </group>
  );
}

function Sun({ minute, weather, center, shadow, reach }: { minute: number; weather: Weather | null; center: { lat: number; lon: number }; shadow: number; reach: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const lamp = light.current;
    if (!lamp) return;
    scene.add(lamp.target);
    return () => {
      scene.remove(lamp.target);
    };
  }, [scene]);
  useEffect(() => {
    const lamp = light.current;
    if (!lamp) return;
    const ray = weather ? sunAt(center.lat, center.lon, utcFor(weather.date, minute, weather.offset)) : { x: -0.35, y: -0.45, z: 0.82 };
    const up = Math.max(0.08, ray.z);
    const toward = new THREE.Vector3(ray.x, up, -ray.y).normalize();
    lamp.position.copy(toward).multiplyScalar(reach * 2);
    lamp.target.position.set(0, 0, 0);
    lamp.target.updateMatrixWorld();
    lamp.intensity = 1.17 * Math.min(1, ray.z * 6 + 0.2);
    const box = lamp.shadow.camera;
    box.left = -reach;
    box.right = reach;
    box.top = reach;
    box.bottom = -reach;
    box.near = 1;
    box.far = reach * 4;
    box.updateProjectionMatrix();
    lamp.shadow.normalBias = ((2 * reach) / shadow) * 1.2;
    if (fill.current) fill.current.intensity = 1.8 + 0.6 * Math.min(1, Math.max(0, ray.z) * 5);
    invalidate();
  }, [minute, weather, center, reach, shadow, invalidate]);
  return (
    <>
      <hemisphereLight ref={fill} args={[SKY, BOUNCE, 2.2]} />
      <directionalLight ref={light} castShadow shadow-mapSize={[shadow, shadow]} shadow-bias={-0.0004} shadow-radius={2} />
    </>
  );
}

function Rig({ wide, deep, insets }: { wide: number; deep: number; insets: { top: number; bottom: number } }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const side = Math.min(48, size.width * 0.05);
    const roomW = Math.max(40, size.width - side * 2);
    const roomH = Math.max(40, size.height - insets.top - insets.bottom);
    const direction = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const corners: THREE.Vector3[] = [];
    for (const x of [-wide / 2, wide / 2]) for (const y of [0, THICK + LIFT]) for (const z of [-deep / 2, deep / 2]) corners.push(new THREE.Vector3(x, y, z));
    const point = new THREE.Vector3();
    camera.clearViewOffset();
    camera.aspect = size.width / size.height;
    const measure = (distance: number) => {
      camera.position.copy(direction).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      camera.near = Math.max(0.5, distance * 0.2);
      camera.far = distance * 4;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const corner of corners) {
        point.copy(corner).project(camera);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      return { minX, maxX, minY, maxY };
    };
    let low = 5;
    let high = 4000;
    for (let step = 0; step < 40; step += 1) {
      const middle = (low + high) / 2;
      const box = measure(middle);
      const fits = ((box.maxX - box.minX) / 2) * size.width <= roomW && ((box.maxY - box.minY) / 2) * size.height <= roomH;
      if (fits) high = middle;
      else low = middle;
    }
    const box = measure(high);
    const nowX = ((box.minX + box.maxX) / 2 + 1) * 0.5 * size.width;
    const nowY = (1 - (box.minY + box.maxY) / 2) * 0.5 * size.height;
    const wantY = insets.top + roomH / 2;
    camera.setViewOffset(size.width, size.height, nowX - size.width / 2, nowY - wantY, size.width, size.height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, wide, deep, insets.top, insets.bottom, invalidate]);
  return null;
}

function Ready({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    window.requestAnimationFrame(() => onReady());
  });
  return null;
}

function Board(props: Props) {
  const size = useThree((state) => state.size);
  const count = Math.max(1, props.tiles.length);
  const roomH = Math.max(40, size.height - props.insets.top - props.insets.bottom);
  const cols = columnsFor(count, size.width, roomH);
  const rows = Math.ceil(count / cols);
  const wide = cols * (TILE + GAP) - GAP;
  const deep = rows * (TILE + GAP) - GAP;
  const reach = Math.hypot(wide, deep) / 2 + TILE;
  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <Sun minute={props.minute} weather={props.weather} center={props.center} shadow={TIERS[props.tier].shadow} reach={reach} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} raycast={() => null}>
        <planeGeometry args={[reach * 8, reach * 8]} />
        <meshBasicMaterial color={FLOOR} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0} receiveShadow raycast={() => null}>
        <planeGeometry args={[reach * 3, reach * 3]} />
        <shadowMaterial color={SHADOW} opacity={0.22} />
      </mesh>
      <Tiles {...props} cols={cols} />
      <Rig wide={wide} deep={deep} insets={props.insets} />
      <Ready onReady={props.onReady} />
    </>
  );
}

export default function Table(props: Props) {
  return (
    <Canvas
      shadows
      flat
      frameloop="demand"
      dpr={[1, TIERS[props.tier].dpr]}
      camera={{ fov: 30, near: 1, far: 4000, position: [0, 200, 150] }}
      gl={{ preserveDrawingBuffer: keepFrame(), powerPreference: powerChoice() }}
      style={{ position: 'absolute', inset: 0, touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => quality.lower()} />
      <Board {...props} />
    </Canvas>
  );
}
