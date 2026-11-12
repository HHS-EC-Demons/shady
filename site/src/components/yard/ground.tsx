import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SURFACES, type Patch, type Strip, type Surface } from '@/engine/campus';
import { insideRing, ringArea, ringDistance, type Point, type Ring } from '@/engine/geometry';
import { rampTable } from '@/engine/heat';
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

const VERTEX = `
attribute float aRise;
attribute float aPaved;
attribute float aLine;
attribute vec2 aOut;
attribute float aHalf;
uniform vec4 uGrid;
uniform vec2 uMiddle;
uniform float uPixel;
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
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
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = `
uniform sampler2D uHeat;
uniform sampler2D uHome;
uniform sampler2D uRamp;
uniform float uAir;
uniform vec3 uPaper;
uniform vec3 uRoad;
varying vec2 vUv;
varying float vRise;
varying float vPaved;
varying float vLine;
void main() {
  float home = smoothstep(0.35, 0.65, texture2D(uHome, vUv).r);
  float degrees = uAir + vRise * texture2D(uHeat, vUv).r * 1.275;
  float place = clamp((degrees - 30.0) * 1.25 / 255.0, 0.0, 1.0);
  vec3 hot = texture2D(uRamp, vec2(place, 0.5)).rgb;
  hot = mix(hot, vec3(0.98, 0.985, 0.97), vLine * home * 0.55);
  vec3 away = mix(uPaper, uRoad, vPaved);
  gl_FragColor = vec4(mix(away, hot, home), 1.0);
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

function build(yard: Yard): THREE.BufferGeometry {
  const grid = yard.ground.grid;
  const [middleX, middleY] = yard.middle;
  const position: number[] = [];
  const rises: number[] = [];
  const paved: number[] = [];
  const lines: number[] = [];
  const outs: number[] = [];
  const halves: number[] = [];
  let rise = 0;
  let hard = 0;

  const use = (surface: Surface) => {
    rise = SURFACES[surface].rise;
    hard = surface === 'asphalt' || surface === 'concrete' ? 1 : 0;
  };
  const vertex = (x: number, y: number, ox: number, oy: number, half: number, mark: number) => {
    position.push(x - middleX, 0, middleY - y);
    rises.push(rise);
    paved.push(hard);
    lines.push(mark);
    outs.push(ox, -oy);
    halves.push(half);
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

  use('grass');
  const right = grid.minX + grid.cols * grid.cell;
  const top = grid.minY + grid.rows * grid.cell;
  triangle(grid.minX, grid.minY, right, grid.minY, right, top);
  triangle(grid.minX, grid.minY, right, top, grid.minX, top);
  for (const patch of patches) {
    if (!soft(patch.surface)) continue;
    use(patch.surface);
    fill(patch.ring);
  }
  for (const strip of strips) {
    if (strip.surface === 'track') continue;
    use(strip.surface);
    band(strip);
  }
  for (const patch of patches) {
    if (!paving(patch.surface)) continue;
    use(patch.surface);
    fill(patch.ring);
  }
  for (const strip of strips) {
    if (strip.surface !== 'track') continue;
    use(strip.surface);
    band(strip);
  }
  for (const patch of patches) {
    if (soft(patch.surface) || paving(patch.surface)) continue;
    use(patch.surface);
    fill(patch.ring);
  }
  for (const strip of strips) {
    if (strip.surface !== 'track') continue;
    use(strip.surface);
    lanes(strip);
  }
  for (const patch of patches) {
    use(patch.surface);
    if (patch.surface === 'court') court(patch);
    else if (FIELD_SPORTS.includes(patch.label ?? '')) field(patch);
    else if (patch.label === 'Parking lot') parking(patch);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('aRise', new THREE.Float32BufferAttribute(rises, 1));
  geometry.setAttribute('aPaved', new THREE.Float32BufferAttribute(paved, 1));
  geometry.setAttribute('aLine', new THREE.Float32BufferAttribute(lines, 1));
  geometry.setAttribute('aOut', new THREE.Float32BufferAttribute(outs, 2));
  geometry.setAttribute('aHalf', new THREE.Float32BufferAttribute(halves, 1));
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
        uAir: { value: 90 },
        uPaper: { value: new THREE.Color(PAPER) },
        uRoad: { value: new THREE.Color(ROAD) },
        uGrid: { value: new THREE.Vector4(grid.minX, grid.minY, width, depth) },
        uMiddle: { value: new THREE.Vector2(yard.middle[0], yard.middle[1]) },
        uPixel: { value: 0.001 },
      },
    });
  }, [yard, grid, heat, texture, width, depth]);
  useEffect(
    () => () => {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture && uniform.value !== heat.texture) uniform.value.dispose();
      }
      material.dispose();
    },
    [material, heat],
  );
  const seen = useRef(-1);
  const drag = useRef<{ kind: 'tree' | 'sail'; id: number } | null>(null);
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const owner = useRef<THREE.ShaderMaterial | null>(null);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 30;
    const zoom = camera.isPerspectiveCamera ? camera.zoom : 1;
    material.uniforms.uPixel.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, state.gl.domElement.height * zoom);
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
