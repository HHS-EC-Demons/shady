import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoofShape } from '@/engine/campus';
import { roofRise } from '@/engine/detail';
import { roofUnits, type RoofUnit } from '@/engine/roof';

type Random = () => number;

function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

class Builder {
  positions: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  vertex(x: number, y: number, z: number, color?: THREE.Color): number {
    this.positions.push(x, y, z);
    if (color) this.colors.push(color.r, color.g, color.b);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (this.colors.length === this.positions.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

function srgb(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function blend(from: THREE.Color, to: THREE.Color, share: number, out: THREE.Color): THREE.Color {
  return out.copy(from).lerp(to, clamp(share));
}

type Wave = { x: number; y: number; z: number; f: number; p: number; a: number };

function waves(random: Random, count: number, low: number, high: number, amp: number): Wave[] {
  const list: Wave[] = [];
  for (let index = 0; index < count; index += 1) {
    const u = random() * 2 - 1;
    const turn = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    list.push({ x: s * Math.cos(turn), y: u, z: s * Math.sin(turn), f: low + (high - low) * random(), p: random() * Math.PI * 2, a: amp * (0.75 + 0.5 * random()) });
  }
  return list;
}

function field(list: Wave[], x: number, y: number, z: number): number {
  let sum = 0;
  for (const wave of list) sum += wave.a * Math.cos(wave.f * (wave.x * x + wave.y * y + wave.z * z) + wave.p);
  return sum;
}

type Lobe = { x: number; y: number; z: number; r: number; tall: number; bumps: Wave[]; tone: number; detail: number; dirs: number[]; reaches: number[]; near: number };

function lobeReach(lobe: Lobe, dx: number, dy: number, dz: number): number {
  const under = dy < -0.15 ? 1 - 0.2 * smooth(-0.15, -1, dy) : 1;
  return lobe.r * (1 + field(lobe.bumps, dx, dy, dz)) * under;
}

function meshDepth(lobe: Lobe, x: number, y: number, z: number): number {
  const lx = x - lobe.x;
  const ly = (y - lobe.y) / lobe.tall;
  const lz = z - lobe.z;
  const distance = Math.hypot(lx, ly, lz);
  if (distance > lobe.r * 1.6) return -1;
  if (distance < 1e-6) return 1;
  const dx = lx / distance;
  const dy = ly / distance;
  const dz = lz / distance;
  let lower = Infinity;
  for (let index = 0; index < lobe.reaches.length; index += 1) {
    if (dx * lobe.dirs[index * 3] + dy * lobe.dirs[index * 3 + 1] + dz * lobe.dirs[index * 3 + 2] > lobe.near) lower = Math.min(lower, lobe.reaches[index]);
  }
  if (lower === Infinity) return -1;
  return (lower * 0.97 - distance) / lobe.r;
}

function crownLobes(shell: number, detail: number, size: number): Lobe[] {
  const random = seeded(20261111);
  const texture = seeded(9031);
  const lobes: Lobe[] = [];
  const add = (x: number, y: number, z: number, r: number, detail: number) => {
    lobes.push({
      x,
      y,
      z,
      r,
      tall: 1.08,
      bumps: [...waves(texture, 4, 2.2, 3.6, 0.06), ...waves(texture, 8, 6.5, 10, 0.036)],
      tone: random() * 2 - 1,
      detail,
      dirs: [],
      reaches: [],
      near: detail <= 1 ? 0.76 : detail === 2 ? 0.86 : 0.92,
    });
  };
  add(0, -0.02, 0, 0.64, Math.min(1, detail));
  for (let index = 0; index < shell; index += 1) {
    const share = (index + 0.5) / shell;
    const lift = 0.9 - share * 1.6;
    const ring = Math.sqrt(Math.max(0, 1 - lift * lift));
    const angle = index * 2.39996 + (random() - 0.5) * 0.5;
    const r = size + random() * 0.09 + (lift < -0.2 ? 0.03 : 0);
    const reach = 0.95 - r + (random() - 0.5) * 0.07;
    add(Math.cos(angle) * ring * reach, lift * reach, Math.sin(angle) * ring * reach, r, detail);
  }
  return lobes;
}

const LIGHT_SHELL = 11;
const LIGHT_SIZE = 0.35;
const LOW_SHELL = 4;
const LOW_SIZE = 0.48;

type Leaves = { deep: THREE.Color; mid: THREE.Color; sun: THREE.Color; warm: THREE.Color; cool: THREE.Color };

const LEAVES: Leaves = { deep: srgb('#173723'), mid: srgb('#2f6243'), sun: srgb('#52834f'), warm: srgb('#3f6a3c'), cool: srgb('#2a5e4a') };
const QUIET: Leaves = { deep: srgb('#26342b'), mid: srgb('#4b5f50'), sun: srgb('#76896f'), warm: srgb('#5b6a55'), cool: srgb('#48605a') };

const TINTS = [srgb('#f4f7de'), srgb('#ffffff'), srgb('#e2efe8')];

export function treeTint(key: number, lift = 1, out = new THREE.Color()): THREE.Color {
  let hash = Math.imul((key | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return out.copy(TINTS[hash % TINTS.length]).multiplyScalar(lift);
}

type Shape = 'full' | 'light' | 'low';

const treeCache = new Map<string, { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry }>();

export function buildTree(options: { light?: boolean; low?: boolean } = {}): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const shape: Shape = options.low ? 'low' : options.light ? 'light' : 'full';
  let cached = treeCache.get(shape);
  if (!cached) {
    cached = { crown: buildCrown(shape), trunk: buildTrunk(shape) };
    treeCache.set(shape, cached);
  }
  return { crown: cached.crown.clone(), trunk: cached.trunk.clone() };
}

function probes(count: number): THREE.Vector3[] {
  const list: THREE.Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - ((index + 0.5) / count) * 2;
    const ring = Math.sqrt(1 - y * y);
    const angle = index * 2.39996;
    list.push(new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring));
  }
  return list;
}

function blocked(lobes: Lobe[], skip: number, x: number, y: number, z: number, dir: THREE.Vector3, far: number): boolean {
  for (let index = 0; index < lobes.length; index += 1) {
    if (index === skip) continue;
    const lobe = lobes[index];
    const ox = x - lobe.x;
    const oy = (y - lobe.y) / lobe.tall;
    const oz = z - lobe.z;
    const dx = dir.x;
    const dy = dir.y / lobe.tall;
    const dz = dir.z;
    const radius = lobe.r * 0.94;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    if (c < 0) return true;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t > 0 && t < far) return true;
  }
  return false;
}

function buildCrown(shape: Shape): THREE.BufferGeometry {
  const lobes = shape === 'low' ? crownLobes(LOW_SHELL, 0, LOW_SIZE) : shape === 'light' ? crownLobes(LIGHT_SHELL, 1, LIGHT_SIZE) : crownLobes(17, 2, 0.29);
  const leaves = shape === 'low' ? QUIET : LEAVES;
  const positions: number[] = [];
  const owners: number[] = [];
  const indices: number[] = [];
  lobes.forEach((lobe, which) => {
    const raw = new THREE.IcosahedronGeometry(1, lobe.detail);
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    const sphere = mergeVertices(raw, 1e-5);
    raw.dispose();
    const place = sphere.getAttribute('position');
    const index = sphere.getIndex();
    const offset = positions.length / 3;
    for (let at = 0; at < place.count; at += 1) {
      const dx = place.getX(at);
      const dy = place.getY(at);
      const dz = place.getZ(at);
      const length = Math.hypot(dx, dy, dz);
      const reach = lobeReach(lobe, dx / length, dy / length, dz / length);
      lobe.dirs.push(dx / length, dy / length, dz / length);
      lobe.reaches.push(reach);
      positions.push(lobe.x + (dx / length) * reach, lobe.y + (dy / length) * reach * lobe.tall, lobe.z + (dz / length) * reach);
      owners.push(which);
    }
    if (index) for (let at = 0; at < index.count; at += 1) indices.push(index.getX(at) + offset);
    sphere.dispose();
  });

  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  full.setIndex(indices);
  full.computeVertexNormals();
  const normals = full.getAttribute('normal');

  const count = positions.length / 3;
  const hidden: boolean[] = new Array(count).fill(false);
  for (let at = 0; at < count; at += 1) {
    for (let other = 0; other < lobes.length; other += 1) {
      if (other !== owners[at] && meshDepth(lobes[other], positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]) > 0.03) {
        hidden[at] = true;
        break;
      }
    }
  }

  const covered = (skip: number, x: number, y: number, z: number) => {
    for (let other = 0; other < lobes.length; other += 1) {
      if (other !== skip && meshDepth(lobes[other], x, y, z) > 0.03) return true;
    }
    return false;
  };
  const kept: number[] = [];
  const weights = [
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [1 / 3, 1 / 3, 1 / 3],
  ];
  for (let at = 0; at < indices.length; at += 3) {
    const a = indices[at];
    const b = indices[at + 1];
    const c = indices[at + 2];
    let buried = hidden[a] && hidden[b] && hidden[c];
    if (buried) {
      for (const [wa, wb, wc] of weights) {
        const x = positions[a * 3] * wa + positions[b * 3] * wb + positions[c * 3] * wc;
        const y = positions[a * 3 + 1] * wa + positions[b * 3 + 1] * wb + positions[c * 3 + 1] * wc;
        const z = positions[a * 3 + 2] * wa + positions[b * 3 + 2] * wb + positions[c * 3 + 2] * wc;
        if (!covered(owners[a], x, y, z)) {
          buried = false;
          break;
        }
      }
    }
    if (!buried) kept.push(a, b, c);
  }

  const colors: number[] = new Array(count * 3).fill(0);
  const bent: number[] = new Array(count * 3).fill(0);
  const done: boolean[] = new Array(count).fill(false);
  const mottle = waves(seeded(77), 5, 7, 11, 1);
  const rays = probes(40);
  const tint = new THREE.Color();
  const tone = new THREE.Color();
  const facing = new THREE.Vector3();
  const volume = new THREE.Vector3();
  let lowest = Infinity;
  let highest = -Infinity;
  for (let at = 0; at < count; at += 1) {
    lowest = Math.min(lowest, positions[at * 3 + 1]);
    highest = Math.max(highest, positions[at * 3 + 1]);
  }
  for (const at of kept) {
    if (done[at]) continue;
    done[at] = true;
    const x = positions[at * 3];
    const y = positions[at * 3 + 1];
    const z = positions[at * 3 + 2];
    const mine = owners[at];
    facing.set(normals.getX(at), normals.getY(at), normals.getZ(at));
    let open = 0;
    let total = 0;
    for (const ray of rays) {
      const weight = ray.dot(facing);
      if (weight <= 0.02) continue;
      total += weight;
      if (!blocked(lobes, mine, x + facing.x * 0.01, y + facing.y * 0.01, z + facing.z * 0.01, ray, 1.2)) open += weight;
    }
    open = total > 0 ? open / total : 1;
    const rise = (y - lowest) / (highest - lowest);
    let light = 0.06 + 0.62 * open + 0.16 * facing.y + 0.24 * (rise - 0.45);
    light += (0.05 * field(mottle, x, y, z)) / 3;
    light = clamp(light);
    if (light < 0.5) blend(leaves.deep, leaves.mid, light / 0.5, tint);
    else blend(leaves.mid, leaves.sun, (light - 0.5) / 0.5, tint);
    const lean = lobes[mine].tone;
    blend(tint, lean > 0 ? leaves.warm : leaves.cool, Math.abs(lean) * 0.25 * (0.4 + light), tone);
    colors[at * 3] = tone.r;
    colors[at * 3 + 1] = tone.g;
    colors[at * 3 + 2] = tone.b;
    volume.set(x, y, z).normalize();
    facing.multiplyScalar(0.68).addScaledVector(volume, 0.32).normalize();
    bent[at * 3] = facing.x;
    bent[at * 3 + 1] = facing.y;
    bent[at * 3 + 2] = facing.z;
  }

  const remap = new Map<number, number>();
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outColors: number[] = [];
  const outIndex: number[] = [];
  let radius = 0;
  let middle = 0;
  let top = -Infinity;
  let bottom = Infinity;
  for (const vertex of kept) {
    top = Math.max(top, positions[vertex * 3 + 1]);
    bottom = Math.min(bottom, positions[vertex * 3 + 1]);
  }
  middle = (top + bottom) / 2;
  for (const vertex of kept) radius = Math.max(radius, Math.hypot(positions[vertex * 3], positions[vertex * 3 + 1] - middle, positions[vertex * 3 + 2]));
  const fit = 0.995 / radius;
  for (const vertex of kept) {
    let next = remap.get(vertex);
    if (next === undefined) {
      next = outPositions.length / 3;
      remap.set(vertex, next);
      outPositions.push(positions[vertex * 3] * fit, (positions[vertex * 3 + 1] - middle) * fit, positions[vertex * 3 + 2] * fit);
      outNormals.push(bent[vertex * 3], bent[vertex * 3 + 1], bent[vertex * 3 + 2]);
      outColors.push(colors[vertex * 3], colors[vertex * 3 + 1], colors[vertex * 3 + 2]);
    }
    outIndex.push(next);
  }
  full.dispose();

  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(outNormals, 3));
  crown.setAttribute('color', new THREE.Float32BufferAttribute(outColors, 3));
  crown.setIndex(outIndex);
  crown.computeBoundingSphere();
  crown.computeBoundingBox();
  return crown;
}

let cone: THREE.BufferGeometry | null = null;

export function buildCone(): THREE.BufferGeometry {
  if (cone) return cone.clone();
  const builder = new Builder();
  const tiers: [number, number, number, number][] = [
    [0, 0.52, 1, 0.34],
    [0.3, 0.78, 0.76, 0.22],
    [0.56, 1, 0.52, 0],
  ];
  const sides = 8;
  const shade = new THREE.Color();
  tiers.forEach(([low, high, wide, narrow], tier) => {
    const color = (y: number, angle: number) => {
      const lit = 0.3 + 0.45 * y + 0.12 * Math.cos(angle - 0.8) + 0.05 * tier;
      return lit < 0.5 ? blend(QUIET.deep, QUIET.mid, lit / 0.5, shade).clone() : blend(QUIET.mid, QUIET.sun, (lit - 0.5) / 0.5, shade).clone();
    };
    const bottom: number[] = [];
    const top: number[] = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = ((side + tier * 0.5) / sides) * Math.PI * 2;
      bottom.push(builder.vertex(Math.cos(angle) * wide, low, Math.sin(angle) * wide, color(low, angle)));
      if (narrow > 0) top.push(builder.vertex(Math.cos(angle) * narrow, high, Math.sin(angle) * narrow, color(high, angle)));
    }
    const apex = narrow > 0 ? -1 : builder.vertex(0, high, 0, color(high, 0));
    const centre = builder.vertex(0, low + 0.02, 0, color(low, Math.PI));
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      if (apex >= 0) builder.triangle(bottom[side], apex, bottom[next]);
      else builder.quad(bottom[side], top[side], top[next], bottom[next]);
      builder.triangle(bottom[side], bottom[next], centre);
    }
  });
  cone = builder.geometry();
  return cone.clone();
}

type Ring = { at: THREE.Vector3; radius: (angle: number) => number; color: (angle: number) => THREE.Color };

function sweep(builder: Builder, rings: Ring[], sides: number, tip: THREE.Vector3 | null, tipColor: THREE.Color | null, level = false): void {
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const helper = new THREE.Vector3();
  const starts: number[] = [];
  rings.forEach((ring, step) => {
    const before = rings[Math.max(0, step - 1)].at;
    const after = rings[Math.min(rings.length - 1, step + 1)].at;
    tangent.subVectors(after, before).normalize();
    if (level) {
      normal.set(1, 0, 0);
      binormal.set(0, 0, -1);
    } else if (step === 0) {
      helper.set(0, 0, 1);
      if (Math.abs(tangent.z) > 0.9) helper.set(1, 0, 0);
      normal.crossVectors(helper, tangent).normalize();
    } else {
      normal.sub(helper.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize();
    }
    if (!level) binormal.crossVectors(tangent, normal).normalize();
    starts.push(builder.positions.length / 3);
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const r = ring.radius(angle);
      const cx = Math.cos(angle) * r;
      const sz = Math.sin(angle) * r;
      builder.vertex(
        ring.at.x + normal.x * cx + binormal.x * sz,
        ring.at.y + normal.y * cx + binormal.y * sz,
        ring.at.z + normal.z * cx + binormal.z * sz,
        ring.color(angle),
      );
    }
  });
  for (let step = 0; step + 1 < rings.length; step += 1) {
    const a = starts[step];
    const b = starts[step + 1];
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      builder.quad(a + side, a + next, b + next, b + side);
    }
  }
  if (tip) {
    const last = starts[starts.length - 1];
    const point = builder.vertex(tip.x, tip.y, tip.z, tipColor ?? undefined);
    for (let side = 0; side < sides; side += 1) builder.triangle(last + side, last + ((side + 1) % sides), point);
  }
}

const BARK = srgb('#5b4a3a');
const BARK_DARK = srgb('#463729');
const BARK_LIGHT = srgb('#6a5743');

function buildTrunk(shape: Shape): THREE.BufferGeometry {
  const builder = new Builder();
  const random = seeded(4242);
  const light = shape !== 'full';
  const sides = shape === 'low' ? 5 : light ? 7 : 10;
  const steps = shape === 'low' ? [0, 1] : light ? [0, 0.03, 0.1, 0.35, 0.65, 1] : [0, 0.012, 0.03, 0.06, 0.11, 0.2, 0.32, 0.45, 0.58, 0.72, 0.86, 1];
  const sway = waves(random, 3, 4, 7, 0.018);
  const grain = random() * Math.PI * 2;
  const shade = new THREE.Color();
  const rings: Ring[] = steps.map((t) => {
    const y = t - 0.5;
    const at = new THREE.Vector3(field(sway, 0, t * 1.7, 0.3), y, field(sway, 0.6, t * 1.7, 0));
    const taper = 0.26 - 0.1 * t;
    const flare = 0.12 * Math.exp(-t / 0.035);
    return {
      at,
      radius: (angle: number) => taper + flare * (0.7 + 0.3 * Math.cos(5 * angle + grain)) + 0.008 * Math.cos(3 * angle + t * 9),
      color: (angle: number) => {
        const ground = 1 - smooth(0, 0.08, t);
        const canopy = smooth(0.55, 1, t);
        const ridge = 0.5 + 0.5 * Math.cos(5 * angle + grain + t * 4);
        blend(BARK, BARK_LIGHT, ridge * 0.45 * (1 - canopy), shade);
        return blend(shade, BARK_DARK, Math.max(ground * 0.8, canopy * 0.7), new THREE.Color());
      },
    };
  });
  sweep(builder, rings, sides, null, null, true);

  const limbs = [
    { from: 0.3, angle: grain, lean: 0.8, size: 0.13 },
    { from: 0.36, angle: grain + 2.3, lean: 0.72, size: 0.12 },
    { from: 0.44, angle: grain + 4.1, lean: 0.62, size: 0.1 },
  ];
  for (const limb of shape === 'low' ? [] : light ? limbs.slice(0, 2) : limbs) {
    const start = new THREE.Vector3(field(sway, 0, limb.from * 1.7, 0.3), limb.from - 0.5, field(sway, 0.6, limb.from * 1.7, 0));
    const reach = new THREE.Vector3(Math.cos(limb.angle) * limb.lean, 0.46, Math.sin(limb.angle) * limb.lean);
    const span = reach.y - start.y;
    const path: Ring[] = [];
    const count = light ? 2 : 4;
    for (let step = 0; step <= count; step += 1) {
      const s = step / count;
      const bend = Math.pow(s, 0.45);
      const point = new THREE.Vector3(start.x + (reach.x - start.x) * bend, start.y + span * s, start.z + (reach.z - start.z) * bend);
      const radius = limb.size * (1 - 0.7 * s);
      path.push({
        at: point,
        radius: () => radius,
        color: () => blend(BARK, BARK_DARK, 0.4 + 0.5 * s, new THREE.Color()),
      });
    }
    const end = path[count].at;
    const tip = end.clone().add(new THREE.Vector3(Math.cos(limb.angle) * 0.04, 0.03, Math.sin(limb.angle) * 0.04));
    sweep(builder, path, light ? 5 : 6, tip, blend(BARK, BARK_DARK, 0.9, new THREE.Color()));
  }
  return builder.geometry();
}

export function buildSail(wide: number, deep: number, height: number): { cloth: THREE.BufferGeometry; posts: THREE.BufferGeometry } {
  const w = Math.max(wide, 0.1);
  const d = Math.max(deep, 0.1);
  const twist = clamp(Math.min(w, d) / 8, 0.15, 1);
  const high = height + 0.9 * twist;
  const low = height - 0.7 * twist;
  const sagAcross = Math.min(0.065 * d, w * 0.18);
  const sagAlong = Math.min(0.065 * w, d * 0.18);
  const cuts = 16;
  const cloth = new Builder();
  const lift = (u: number, v: number) => high * (1 - u) * (1 - v) + low * u * (1 - v) + high * u * v + low * (1 - u) * v;
  const spot = (u: number, v: number): [number, number, number] => {
    const x = -w / 2 + u * w + (1 - 2 * u) * sagAcross * 4 * v * (1 - v);
    const z = -d / 2 + v * d + (1 - 2 * v) * sagAlong * 4 * u * (1 - u);
    const belly = 0.012 * Math.min(w, d) * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return [x, lift(u, v) - belly, z];
  };
  for (let row = 0; row <= cuts; row += 1) {
    for (let column = 0; column <= cuts; column += 1) {
      const [x, y, z] = spot(column / cuts, row / cuts);
      cloth.vertex(x, y, z);
    }
  }
  for (let row = 0; row < cuts; row += 1) {
    for (let column = 0; column < cuts; column += 1) {
      const a = row * (cuts + 1) + column;
      const b = a + 1;
      const c = a + cuts + 2;
      const e = a + cuts + 1;
      if ((row + column) % 2 === 0) cloth.quad(a, e, c, b);
      else {
        cloth.triangle(a, e, b);
        cloth.triangle(b, e, c);
      }
    }
  }

  const posts = new Builder();
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const rake = Math.tan((5 * Math.PI) / 180);
  for (const [u, v] of corners) {
    const [cx, cy, cz] = spot(u, v);
    const out = new THREE.Vector2(cx, cz).normalize();
    const gap = 0.32;
    const attach = new THREE.Vector3(cx + out.x * gap, cy, cz + out.y * gap);
    const axis = new THREE.Vector3(out.x * rake, 1, out.y * rake).normalize();
    const foot = attach.clone().addScaledVector(axis, -cy / axis.y);
    const head = attach.clone().addScaledVector(axis, 0.42 / axis.y);
    cylinder(posts, foot, head, 0.09, 10, true);
    cylinder(posts, foot.clone().setY(-0.05), foot.clone().setY(0.08), 0.24, 10, true);
    cylinder(posts, new THREE.Vector3(cx, cy, cz), attach, 0.028, 6, false);
    cylinder(posts, attach.clone().addScaledVector(axis, -0.07), attach.clone().addScaledVector(axis, 0.07), 0.12, 10, true);
  }
  return { cloth: cloth.geometry(), posts: posts.geometry() };
}

function cylinder(builder: Builder, from: THREE.Vector3, to: THREE.Vector3, radius: number, sides: number, capped: boolean): void {
  const axis = new THREE.Vector3().subVectors(to, from).normalize();
  const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const other = new THREE.Vector3().crossVectors(axis, across).normalize();
  const ring = (center: THREE.Vector3) => {
    const start = builder.positions.length / 3;
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      builder.vertex(center.x + across.x * c + other.x * s, center.y + across.y * c + other.y * s, center.z + across.z * c + other.z * s);
    }
    return start;
  };
  const a = ring(from);
  const b = ring(to);
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    builder.quad(a + side, a + next, b + next, b + side);
  }
  if (!capped) return;
  const top = ring(to);
  const middle = builder.vertex(to.x, to.y, to.z);
  for (let side = 0; side < sides; side += 1) builder.triangle(top + side, top + ((side + 1) % sides), middle);
}

function box(builder: Builder, center: THREE.Vector3, along: THREE.Vector3, across: THREE.Vector3, long: number, wide: number, low: number, high: number): void {
  const corner = (su: number, sv: number, y: number) => new THREE.Vector3(center.x + along.x * su * long * 0.5 + across.x * sv * wide * 0.5, y, center.z + along.z * su * long * 0.5 + across.z * sv * wide * 0.5);
  const face = (points: THREE.Vector3[]) => {
    const start = builder.positions.length / 3;
    for (const point of points) builder.vertex(point.x, point.y, point.z);
    const ab = new THREE.Vector3().subVectors(points[1], points[0]);
    const ac = new THREE.Vector3().subVectors(points[2], points[0]);
    const facing = new THREE.Vector3().crossVectors(ab, ac);
    const middle = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(0.25);
    const outward = middle.sub(new THREE.Vector3(center.x, (low + high) / 2, center.z));
    if (facing.dot(outward) >= 0) builder.quad(start, start + 1, start + 2, start + 3);
    else builder.quad(start, start + 3, start + 2, start + 1);
  };
  const p = [corner(-1, -1, low), corner(1, -1, low), corner(1, 1, low), corner(-1, 1, low)];
  const q = [corner(-1, -1, high), corner(1, -1, high), corner(1, 1, high), corner(-1, 1, high)];
  face([q[0], q[1], q[2], q[3]]);
  face([p[0], p[1], q[1], q[0]]);
  face([p[1], p[2], q[2], q[1]]);
  face([p[2], p[3], q[3], q[2]]);
  face([p[3], p[0], q[0], q[3]]);
}

const SINK_HEAD = `#include <common>
attribute float aSink;
uniform float uSink;`;

const SINK_BODY = `#include <begin_vertex>
if ( aSink > -0.5 ) transformed.y = mix( transformed.y, aSink - 0.5, uSink );`;

export function sinkingUnits(sink: { value: number }): { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const patch: THREE.Material['onBeforeCompile'] = (shader) => {
    shader.uniforms.uSink = sink;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', SINK_HEAD).replace('#include <begin_vertex>', SINK_BODY);
  };
  const material = new THREE.MeshStandardMaterial({ color: '#dfe5e4', roughness: 0.9 });
  material.onBeforeCompile = patch;
  material.customProgramCacheKey = () => 'shady-units-1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = patch;
  depth.customProgramCacheKey = () => 'shady-units-depth-1';
  return { material, depth };
}

export function buildRoofUnits(
  blocks: { ring: [number, number][]; height: number; sunk?: boolean }[],
  toScene: (x: number, y: number) => [number, number, number],
  units: RoofUnit[] = roofUnits(blocks.map((block) => block.ring)),
): THREE.BufferGeometry | null {
  if (units.length === 0) return null;
  const builder = new Builder();
  const sinks: number[] = [];
  for (const unit of units) {
    const { x, y, ux, uy } = unit;
    const [sx, , sz] = toScene(x, y);
    const [tx, , tz] = toScene(x + ux, y + uy);
    const along = new THREE.Vector3(tx - sx, 0, tz - sz).normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x);
    const center = new THREE.Vector3(sx, 0, sz);
    const base = blocks[unit.block].height;
    box(builder, center, along, across, unit.long, unit.wide, base, base + unit.tall);
    const fan = Math.min(unit.wide * 0.32, 0.62);
    for (let index = 0; index < unit.fans; index += 1) {
      const shift = unit.fans === 2 ? (index === 0 ? -0.25 : 0.25) * unit.long : 0;
      const spot = center.clone().addScaledVector(along, shift);
      cylinder(builder, new THREE.Vector3(spot.x, base + unit.tall - 0.02, spot.z), new THREE.Vector3(spot.x, base + unit.tall + 0.22, spot.z), fan, 12, true);
    }
    const sink = blocks[unit.block].sunk ? base : -1;
    while (sinks.length < builder.positions.length / 3) sinks.push(sink);
  }
  const geometry = builder.geometry();
  geometry.setAttribute('aSink', new THREE.Float32BufferAttribute(sinks, 1));
  return geometry;
}

export type Flat = [number, number][];
export type BlockForm = 'parapet' | 'chamfer' | 'hip' | 'flat' | 'gable' | 'skillion' | 'pyramid' | 'dome' | 'stand';
export type BlockModel = { geometry: THREE.BufferGeometry; roof: number; form: BlockForm };

type Spot = [number, number, number];

const CHAMFER = 0.22;
const RIM = 0.4;
const RECESS = 0.5;
const EAVE = 0.35;
const FASCIA = 0.15;
const RISE = 2.4;
const PEAK = 0.22;
const HIP_AREA = 450;
const HIP_CORNERS = 10;
const MITRE = 3;
const KEEP = 0.55;
const UP: Spot = [0, 1, 0];
const DOWN: Spot = [0, -1, 0];
const ROOF_WARM: Spot = [0.88 / 0.91, 0.82 / 0.935, 0.74 / 0.965];
const MASONRY_TILE = 1.7;
const MASONRY_CONTRAST = 0.9;

function ringArea(ring: Flat): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    twice += ax * by - bx * ay;
  }
  return twice / 2;
}

function turn(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function simpleRing(ring: Flat): boolean {
  const count = ring.length;
  for (let i = 0; i < count; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % count];
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      const c = ring[j];
      const d = ring[(j + 1) % count];
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) return false;
    }
  }
  return true;
}

export function cleanRing(ring: Flat): Flat {
  const out: Flat = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) > 0.02) out.push([x, y]);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.02) out.pop();
  for (let i = 0; out.length > 3 && i < out.length; ) {
    const a = out[(i + out.length - 1) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const straight = Math.abs(ux * vy - uy * vx) <= 2e-3 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0;
    if (straight) out.splice(i, 1);
    else i += 1;
  }
  if (ringArea(out) < 0) out.reverse();
  return out;
}

export function insetRing(ring: Flat, distance: number): Flat | null {
  const count = ring.length;
  if (count < 3) return null;
  const out: Flat = [];
  for (let i = 0; i < count; i += 1) {
    const [px, py] = ring[(i + count - 1) % count];
    const [x, y] = ring[i];
    const [nx, ny] = ring[(i + 1) % count];
    const first = Math.hypot(x - px, y - py);
    const second = Math.hypot(nx - x, ny - y);
    if (first < 1e-6 || second < 1e-6) return null;
    const sx = (py - y) / first + (y - ny) / second;
    const sy = (x - px) / first + (nx - x) / second;
    const size = Math.hypot(sx, sy);
    if (size < 1e-6) return null;
    const reach = Math.min(MITRE, 2 / size) * distance;
    out.push([x + (sx / size) * reach, y + (sy / size) * reach]);
  }
  const before = ringArea(ring);
  const after = ringArea(out);
  if (!(after > 0)) return null;
  if (distance > 0 ? after < before * KEEP : after < before) return null;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    if ((ring[j][0] - ring[i][0]) * (out[j][0] - out[i][0]) + (ring[j][1] - ring[i][1]) * (out[j][1] - out[i][1]) <= 0) return null;
  }
  return simpleRing(out) ? out : null;
}

export function lift(point: [number, number], y: number): Spot {
  return [point[0], y, -point[1]];
}

export function outward(a: [number, number], b: [number, number]): Spot {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[1] - a[1]) / length, 0, (b[0] - a[0]) / length];
}

export class Shell {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  storeys: number[] = [];
  storey = 0;

  constructor(readonly paint: boolean) {}

  vertex(point: Spot, normal: Spot, color: THREE.Color | null): number {
    this.positions.push(point[0], point[1], point[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.storeys.push(this.storey);
    if (this.paint) this.colors.push(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1);
    return this.positions.length / 3 - 1;
  }

  face(points: Spot[], want: Spot, color: THREE.Color | null, normals?: Spot[]): void {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay, az] = points[i];
      const [bx, by, bz] = points[(i + 1) % points.length];
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
    }
    const size = Math.hypot(nx, ny, nz);
    if (size < 1e-9) return;
    const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
    const sign = flip ? -1 / size : 1 / size;
    const plain: Spot = [nx * sign, ny * sign, nz * sign];
    const order = points.map((_, at) => at);
    if (flip) order.reverse();
    const ids = order.map((at) => this.vertex(points[at], normals ? normals[at] : plain, color));
    for (let i = 1; i + 1 < ids.length; i += 1) this.indices.push(ids[0], ids[i], ids[i + 1]);
  }

  cap(ring: Flat, y: number, color: THREE.Color | null): void {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const start = this.positions.length / 3;
    for (const point of ring) this.vertex(lift(point, y), UP, color);
    for (const [a, b, c] of triangles) {
      if (turn(ring[a], ring[b], ring[c]) >= 0) this.indices.push(start + a, start + b, start + c);
      else this.indices.push(start + a, start + c, start + b);
    }
  }

  walls(ring: Flat, low: number, high: number, color: THREE.Color | null): void {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      this.face([lift(a, low), lift(b, low), lift(b, high), lift(a, high)], outward(a, b), color);
    }
  }

  bevel(outer: Flat, inner: Flat, low: number, high: number, color: THREE.Color | null): void {
    for (let i = 0; i < outer.length; i += 1) {
      const j = (i + 1) % outer.length;
      const side = outward(outer[i], outer[j]);
      this.face([lift(outer[i], low), lift(outer[j], low), lift(inner[j], high), lift(inner[i], high)], [side[0], 1, side[2]], color, [side, side, UP, UP]);
    }
  }

  band(outer: Flat, inner: Flat, y: number, color: THREE.Color | null, want: Spot): void {
    for (let i = 0; i < outer.length; i += 1) {
      const j = (i + 1) % outer.length;
      this.face([lift(outer[i], y), lift(outer[j], y), lift(inner[j], y), lift(inner[i], y)], want, color);
    }
  }

  post(x: number, z: number, low: number, high: number, radius: number, sides: number, color: THREE.Color | null): void {
    const start = this.positions.length / 3;
    for (let side = 0; side < sides; side += 1) {
      const angle = ((side + 0.5) / sides) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      this.vertex([x + nx * radius, low, z + nz * radius], [nx, 0, nz], color);
      this.vertex([x + nx * radius, high, z + nz * radius], [nx, 0, nz], color);
    }
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const a = start + side * 2;
      const b = start + next * 2;
      this.indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }

  flat(ring: Flat, y: number, color: THREE.Color | null, down = false): void {
    if (ring.length < 3) return;
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const start = this.positions.length / 3;
    for (const point of ring) this.vertex(lift(point, y), down ? DOWN : UP, color);
    for (const [a, b, c] of triangles) {
      const up = turn(ring[a], ring[b], ring[c]) >= 0;
      if (up !== down) this.indices.push(start + a, start + b, start + c);
      else this.indices.push(start + a, start + c, start + b);
    }
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(this.storeys, 1));
    if (this.paint) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

function centroid(ring: Flat): [number, number] {
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const cross = ax * by - bx * ay;
    twice += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  return [x / (3 * twice), y / (3 * twice)];
}

function warm(wall: THREE.Color | null): THREE.Color | null {
  return wall ? new THREE.Color(wall.r * ROOF_WARM[0], wall.g * ROOF_WARM[1], wall.b * ROOF_WARM[2]) : null;
}

function hipRoof(shell: Shell, ring: Flat, low: number, height: number, rise: number, peak: number, wall: THREE.Color | null, roof: THREE.Color | null): boolean {
  const eave = insetRing(ring, -EAVE);
  if (!eave) return false;
  const middle = centroid(ring);
  for (let i = 0; i < ring.length; i += 1) {
    if (turn(ring[i], ring[(i + 1) % ring.length], middle) <= 1e-6) return false;
  }
  const top: Flat = ring.map(([x, y]) => [middle[0] + (x - middle[0]) * peak, middle[1] + (y - middle[1]) * peak]);
  shell.walls(ring, low, height, wall);
  shell.band(ring, eave, height, roof, DOWN);
  shell.walls(eave, height, height + FASCIA, roof);
  for (let i = 0; i < ring.length; i += 1) {
    const j = (i + 1) % ring.length;
    const side = outward(eave[i], eave[j]);
    if (peak > 0) shell.face([lift(eave[i], height + FASCIA), lift(eave[j], height + FASCIA), lift(top[j], height + rise), lift(top[i], height + rise)], [side[0], 1, side[2]], roof);
    else shell.face([lift(eave[i], height + FASCIA), lift(eave[j], height + FASCIA), lift(middle, height + rise)], [side[0], 1, side[2]], roof);
  }
  if (peak > 0) shell.cap(top, height + rise, roof);
  return true;
}

type Box2 = { cx: number; cy: number; ux: number; uy: number; long: number; short: number };

function boxOf2(ring: Flat): Box2 {
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

function rectangular(ring: Flat, box: Box2, fill: number): boolean {
  return ring.length >= 4 && ring.length <= 8 && Math.abs(ringArea(ring)) >= box.long * box.short * fill;
}

type Axes = { cx: number; cy: number; ax: number; ay: number; bx: number; by: number; p: number; q: number };

function axesOf(box: Box2, across: boolean): Axes {
  if (!across) return { cx: box.cx, cy: box.cy, ax: box.ux, ay: box.uy, bx: -box.uy, by: box.ux, p: box.long / 2, q: box.short / 2 };
  return { cx: box.cx, cy: box.cy, ax: -box.uy, ay: box.ux, bx: -box.ux, by: -box.uy, p: box.short / 2, q: box.long / 2 };
}

function point2(axes: Axes, a: number, b: number): [number, number] {
  return [axes.cx + axes.ax * a + axes.bx * b, axes.cy + axes.ay * a + axes.by * b];
}

function slab(shell: Shell, top: Spot[], color: THREE.Color | null, up: Spot): void {
  const under = top.map((point): Spot => [point[0], point[1] - FASCIA, point[2]]);
  shell.face(top, up, color);
  shell.face(under, [-up[0], -up[1], -up[2]], color);
  for (let i = 0; i < top.length; i += 1) {
    const j = (i + 1) % top.length;
    const mx = (top[i][0] + top[j][0]) / 2;
    const mz = (top[i][2] + top[j][2]) / 2;
    const cx = top.reduce((sum, point) => sum + point[0], 0) / top.length;
    const cz = top.reduce((sum, point) => sum + point[2], 0) / top.length;
    shell.face([top[i], top[j], under[j], under[i]], [mx - cx, 0, mz - cz], color);
  }
}

function gableRoof(shell: Shell, axes: Axes, low: number, eave: number, rise: number, wall: THREE.Color | null, roof: THREE.Color | null, hip: boolean): void {
  const { p, q } = axes;
  const at = (a: number, b: number, y: number): Spot => lift(point2(axes, a, b), y);
  const origin = at(0, 0, 0);
  const dir = (a: number, b: number): Spot => {
    const point = at(a, b, 0);
    return [point[0] - origin[0], 0, point[2] - origin[2]];
  };
  const ridge = hip ? Math.max(0, p - q) : p;
  for (const side of [-1, 1]) shell.face([at(-p, side * q, low), at(p, side * q, low), at(p, side * q, eave), at(-p, side * q, eave)], dir(0, side), wall);
  for (const end of [-1, 1]) {
    if (hip) shell.face([at(end * p, -q, low), at(end * p, q, low), at(end * p, q, eave), at(end * p, -q, eave)], dir(end, 0), wall);
    else shell.face([at(end * p, -q, low), at(end * p, q, low), at(end * p, q, eave), at(end * p, 0, eave + rise), at(end * p, -q, eave)], dir(end, 0), wall);
  }
  const over = EAVE;
  const drop = (rise * over) / Math.max(q, 0.5);
  const top = eave + rise;
  const g = hip ? over : over * 0.7;
  for (const side of [-1, 1]) {
    const up = dir(0, side * 0.5);
    if (hip) slab(shell, [at(-ridge, 0, top), at(ridge, 0, top), at(p + over, side * (q + over), eave - drop), at(-p - over, side * (q + over), eave - drop)], roof, [up[0], 1, up[2]]);
    else slab(shell, [at(-p - g, 0, top), at(p + g, 0, top), at(p + g, side * (q + over), eave - drop), at(-p - g, side * (q + over), eave - drop)], roof, [up[0], 1, up[2]]);
  }
  if (hip) {
    for (const end of [-1, 1]) {
      const up = dir(end * 0.5, 0);
      slab(shell, [at(end * ridge, 0, top), at(end * (p + over), q + over, eave - drop), at(end * (p + over), -q - over, eave - drop)], roof, [up[0], 1, up[2]]);
    }
  }
}

function skillionRoof(shell: Shell, axes: Axes, low: number, eave: number, rise: number, wall: THREE.Color | null, roof: THREE.Color | null): void {
  const { p, q } = axes;
  const at = (a: number, b: number, y: number): Spot => lift(point2(axes, a, b), y);
  const origin = at(0, 0, 0);
  const dir = (a: number, b: number): Spot => {
    const point = at(a, b, 0);
    return [point[0] - origin[0], 0, point[2] - origin[2]];
  };
  const height = (b: number) => eave + (rise * (b + q)) / (2 * q);
  for (const side of [-1, 1]) shell.face([at(-p, side * q, low), at(p, side * q, low), at(p, side * q, height(side * q)), at(-p, side * q, height(side * q))], dir(0, side), wall);
  for (const end of [-1, 1]) shell.face([at(end * p, -q, low), at(end * p, q, low), at(end * p, q, height(q)), at(end * p, -q, height(-q))], dir(end, 0), wall);
  const over = EAVE;
  const slope = rise / (2 * q);
  const up = dir(0, -slope);
  slab(shell, [at(-p - over, -q - over, height(-q) - slope * over + FASCIA), at(p + over, -q - over, height(-q) - slope * over + FASCIA), at(p + over, q + over, height(q) + slope * over + FASCIA), at(-p - over, q + over, height(q) + slope * over + FASCIA)], roof, [up[0], 1, up[2]]);
}

function domeRoof(shell: Shell, ring: Flat, low: number, eave: number, rise: number, wall: THREE.Color | null, roof: THREE.Color | null): boolean {
  const middle = centroid(ring);
  for (let i = 0; i < ring.length; i += 1) {
    if (turn(ring[i], ring[(i + 1) % ring.length], middle) <= 1e-6) return false;
  }
  shell.walls(ring, low, eave, wall);
  const steps = 6;
  let last = ring;
  let lastY = eave;
  for (let step = 1; step <= steps; step += 1) {
    const angle = (step / steps) * (Math.PI / 2) * 0.92;
    const scale = Math.cos(angle);
    const y = eave + rise * Math.sin(angle) / Math.sin((Math.PI / 2) * 0.92);
    const next: Flat = ring.map(([x, z]) => [middle[0] + (x - middle[0]) * scale, middle[1] + (z - middle[1]) * scale]);
    for (let i = 0; i < ring.length; i += 1) {
      const j = (i + 1) % ring.length;
      const side = outward(last[i], last[j]);
      shell.face([lift(last[i], lastY), lift(last[j], lastY), lift(next[j], y), lift(next[i], y)], [side[0], 1, side[2]], roof);
    }
    last = next;
    lastY = y;
  }
  shell.cap(last, lastY, roof);
  return true;
}

function standBlock(shell: Shell, box: Box2, low: number, height: number, away: [number, number], wall: THREE.Color | null): void {
  const alongShort = Math.abs(away[0] * -box.uy + away[1] * box.ux) >= Math.abs(away[0] * box.ux + away[1] * box.uy);
  const axes: Axes = alongShort
    ? { cx: box.cx, cy: box.cy, ax: box.ux, ay: box.uy, bx: -box.uy, by: box.ux, p: box.long / 2, q: box.short / 2 }
    : { cx: box.cx, cy: box.cy, ax: -box.uy, ay: box.ux, bx: box.ux, by: box.uy, p: box.short / 2, q: box.long / 2 };
  const sign = away[0] * axes.bx + away[1] * axes.by >= 0 ? 1 : -1;
  const at = (a: number, b: number, y: number): Spot => lift(point2(axes, a, b * sign), y);
  const { p, q } = axes;
  const tall = height - low;
  const rows = Math.max(3, Math.min(40, Math.round((2 * q) / 0.85)));
  const depth = (2 * q) / rows;
  const front = Math.min(0.6, tall / rows);
  const profile: [number, number][] = [[-q, low]];
  for (let row = 0; row < rows; row += 1) {
    const y = low + front + ((tall - front) * row) / Math.max(1, rows - 1);
    profile.push([-q + row * depth, y], [-q + (row + 1) * depth, y]);
  }
  profile.push([q, low]);
  const origin = at(0, 0, 0);
  const toward = (b: number): Spot => {
    const point = at(0, b, 0);
    return [point[0] - origin[0], 0, point[2] - origin[2]];
  };
  for (let i = 0; i + 1 < profile.length; i += 1) {
    const [b0, y0] = profile[i];
    const [b1, y1] = profile[i + 1];
    const facing: Spot = Math.abs(y1 - y0) < 1e-6 ? [0, 1, 0] : toward(y1 > y0 ? -1 : 1);
    shell.face([at(-p, b0, y0), at(p, b0, y0), at(p, b1, y1), at(-p, b1, y1)], facing, wall);
  }
  for (const end of [-1, 1]) {
    const contour = profile.map(([b, y]) => new THREE.Vector2(b, y));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    const out = at(end, 0, 0);
    const middle = at(0, 0, 0);
    const want: Spot = [out[0] - middle[0], 0, out[2] - middle[2]];
    for (const [a, b, c] of triangles) shell.face([at(end * p, profile[a][0], profile[a][1]), at(end * p, profile[b][0], profile[b][1]), at(end * p, profile[c][0], profile[c][1])], want, wall);
  }
  const rail = profile[profile.length - 2][1];
  const back = q - 0.06;
  const rim: Flat = [point2(axes, -p, back * sign), point2(axes, p, back * sign), point2(axes, p, q * sign), point2(axes, -p, q * sign)];
  const railRing = ringArea(rim) < 0 ? rim.reverse() : rim;
  shell.walls(railRing, rail, rail + 1.05, wall);
  shell.cap(railRing, rail + 1.05, wall);
}

export type BlockLook = {
  home?: boolean;
  tint?: THREE.Color;
  top?: THREE.Color;
  min?: number;
  roof?: RoofShape;
  rise?: number;
  across?: boolean;
  slope?: number;
  levels?: number;
  stand?: [number, number];
};

export function buildBlock(footprint: Flat, height: number, options: BlockLook = {}): BlockModel {
  const wall = options.tint ?? null;
  const roofTone = options.top ?? warm(wall);
  const shell = new Shell(wall !== null || options.top !== undefined);
  const ring = cleanRing(footprint);
  const tall = Math.max(height, 0.1);
  const low = Math.min(Math.max(0, options.min ?? 0), tall - 0.1);
  if (ring.length < 3) return { geometry: shell.geometry(), roof: tall, form: 'flat' };
  const box = boxOf2(ring);
  if (options.stand && rectangular(ring, box, 0.8) && box.short > 2) {
    shell.storey = -1;
    standBlock(shell, box, low, tall, options.stand, wall);
    return { geometry: shell.geometry(), roof: tall, form: 'stand' };
  }
  if (low > 0.05) shell.flat(ring, low, wall, true);
  const shape = options.roof;
  if (shape && shape !== 'flat') {
    const rise = options.rise ?? roofRise(shape, ring);
    const eave = options.rise !== undefined ? tall - rise : tall;
    if (eave - low > 0.5 && rise > 0.2) {
      shell.storey = options.levels ? (eave - 0) / options.levels : 0;
      const top = options.top ?? warm(wall) ?? null;
      if ((shape === 'gabled' || shape === 'skillion') && rectangular(ring, box, 0.9)) {
        if (shape === 'gabled') gableRoof(shell, axesOf(box, options.across === true), low, eave, rise, wall, top, false);
        else skillionRoof(shell, skillionAxes(box, options.slope), low, eave, rise, wall, top);
        return { geometry: shell.geometry(), roof: eave + rise, form: shape === 'gabled' ? 'gable' : 'skillion' };
      }
      if (shape === 'hipped' && rectangular(ring, box, 0.9)) {
        gableRoof(shell, axesOf(box, false), low, eave, rise, wall, top, true);
        return { geometry: shell.geometry(), roof: eave + rise, form: 'hip' };
      }
      if ((shape === 'hipped' || shape === 'pyramidal') && ring.length <= HIP_CORNERS && hipRoof(shell, ring, low, eave, rise, shape === 'pyramidal' ? 0 : PEAK, wall, top)) {
        return { geometry: shell.geometry(), roof: eave + rise, form: shape === 'pyramidal' ? 'pyramid' : 'hip' };
      }
      if (shape === 'dome' && ring.length >= 3 && domeRoof(shell, ring, low, eave, rise, wall, top)) {
        return { geometry: shell.geometry(), roof: eave + rise, form: 'dome' };
      }
      shell.positions.length = 0;
      shell.normals.length = 0;
      shell.colors.length = 0;
      shell.indices.length = 0;
      shell.storeys.length = 0;
      if (low > 0.05) shell.flat(ring, low, wall, true);
    }
  }
  shell.storey = options.levels ? tall / options.levels : 0;
  if (!shape && !options.home && low < 0.05 && ringArea(ring) < HIP_AREA && ring.length <= HIP_CORNERS && hipRoof(shell, ring, 0, tall, RISE, PEAK, wall, roofTone)) {
    return { geometry: shell.geometry(), roof: tall + RISE, form: 'hip' };
  }
  const roofColor = options.top ?? wall;
  const span = tall - low;
  const bevel = span > CHAMFER * 3 ? insetRing(ring, CHAMFER) : null;
  const rim = options.home && bevel && span > CHAMFER + RECESS + 0.5 ? insetRing(ring, RIM) : null;
  if (bevel && rim) {
    shell.walls(ring, low, tall - CHAMFER, wall);
    shell.bevel(ring, bevel, tall - CHAMFER, tall, wall);
    shell.band(bevel, rim, tall, wall, UP);
    for (let i = 0; i < rim.length; i += 1) {
      const j = (i + 1) % rim.length;
      const side = outward(rim[i], rim[j]);
      shell.face([lift(rim[i], tall), lift(rim[j], tall), lift(rim[j], tall - RECESS), lift(rim[i], tall - RECESS)], [-side[0], 0, -side[2]], wall);
    }
    shell.cap(rim, tall - RECESS, roofColor);
    return { geometry: shell.geometry(), roof: tall - RECESS, form: 'parapet' };
  }
  if (bevel) {
    shell.walls(ring, low, tall - CHAMFER, wall);
    shell.bevel(ring, bevel, tall - CHAMFER, tall, wall);
    shell.cap(bevel, tall, roofColor);
    return { geometry: shell.geometry(), roof: tall, form: 'chamfer' };
  }
  shell.walls(ring, low, tall, wall);
  shell.cap(ring, tall, roofColor);
  return { geometry: shell.geometry(), roof: tall, form: 'flat' };
}

function skillionAxes(box: Box2, slope: number | undefined): Axes {
  const short: Axes = { cx: box.cx, cy: box.cy, ax: box.ux, ay: box.uy, bx: -box.uy, by: box.ux, p: box.long / 2, q: box.short / 2 };
  if (slope === undefined) return short;
  const downX = Math.sin((slope * Math.PI) / 180);
  const downY = Math.cos((slope * Math.PI) / 180);
  const alongLong = Math.abs(downX * box.ux + downY * box.uy) > Math.abs(downX * -box.uy + downY * box.ux);
  const axes: Axes = alongLong ? { cx: box.cx, cy: box.cy, ax: -box.uy, ay: box.ux, bx: box.ux, by: box.uy, p: box.short / 2, q: box.long / 2 } : short;
  const uphill = -(downX * axes.bx + downY * axes.by);
  return uphill >= 0 ? axes : { ...axes, ax: -axes.ax, ay: -axes.ay, bx: -axes.bx, by: -axes.by };
}

const WALL_VERTEX_HEAD = `#include <common>
attribute float aWall;
varying float vWallStorey;
varying vec3 vWallPos;
varying vec3 vWallNormal;
varying float vWallLift;
varying float vWallRaised;
varying float vWallHigh;`;

const WALL_VERTEX_BODY = `#include <worldpos_vertex>
vec4 wallWorld = vec4( transformed, 1.0 );
vec3 wallNormal = objectNormal;
#ifdef USE_BATCHING
wallWorld = batchingMatrix * wallWorld;
wallNormal = mat3( batchingMatrix ) * wallNormal;
#endif
#ifdef USE_INSTANCING
wallWorld = instanceMatrix * wallWorld;
wallNormal = mat3( instanceMatrix ) * wallNormal;
#endif
wallWorld = modelMatrix * wallWorld;
vWallPos = wallWorld.xyz;
vWallNormal = normalize( mat3( modelMatrix ) * wallNormal );
vWallHigh = transformed.y;
vWallStorey = aWall;
vWallRaised = step( 0.05, transformed.y );
vWallLift = transformed.y * vWallRaised;`;

const WALL_FRAGMENT_HEAD = `#include <common>
uniform sampler2D uRoofMap;
uniform vec4 uRoofBox;
uniform float uRoofMix;
uniform sampler2D uBrickMap;
uniform float uBrickMix;
varying float vWallStorey;
varying vec3 vWallPos;
varying vec3 vWallNormal;
varying float vWallLift;
varying float vWallRaised;
varying float vWallHigh;
float wallHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float wallNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wallHash( i ), wallHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wallHash( i + vec2( 0.0, 1.0 ) ), wallHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

const WALL_FRAGMENT_BODY = `#include <color_fragment>
vec3 wallN = normalize( vWallNormal );
float wallRoof = smoothstep( 0.55, 0.85, wallN.y );
float wallDeck = smoothstep( 0.985, 0.998, wallN.y );
float wallSide = 1.0 - smoothstep( 0.2, 0.3, abs( wallN.y ) );
vec2 wallFlat = vec2( -wallN.z, wallN.x );
vec2 wallDir = wallFlat / max( length( wallFlat ), 1e-4 );
float wallAlong = dot( vWallPos.xz, wallDir );
float wallHigh = vWallHigh;
float wallTop = vWallLift / max( vWallRaised, 1e-4 );
float wallStepU = max( fwidth( wallAlong ), 1e-4 );
float wallStepY = max( fwidth( wallHigh ), 1e-4 );
float wallPx = max( wallStepU, wallStepY );
float wallPlain = step( vWallStorey, -0.5 );
float wallFade = wallSide * ( 1.0 - smoothstep( 0.16, 0.45, wallPx ) ) * ( 1.0 - wallPlain );
float wallFine = 1.0 - smoothstep( 0.025, 0.07, wallPx );
float wallGravel = wallDeck * ( 1.0 - smoothstep( 0.05, 0.16, max( length( fwidth( vWallPos.xz ) ), 1e-4 ) ) );
vec2 wallBrickUv = vec2( wallAlong, wallHigh ) * ${(1 / MASONRY_TILE).toFixed(4)};
vec2 wallBrickX = dFdx( wallBrickUv );
vec2 wallBrickY = dFdy( wallBrickUv );
float wallGlass = 0.0;
float wallFrame = 0.0;
float wallPhoto = 0.0;
if ( uRoofMix > 0.0 ) {
  vec2 wallRoofUv = vec2( ( vWallPos.x - uRoofBox.x ) * uRoofBox.z, ( -vWallPos.z - uRoofBox.y ) * uRoofBox.w );
  vec4 wallRoofTexel = texture2D( uRoofMap, wallRoofUv );
  vec2 wallRoofIn = step( vec2( 0.0 ), wallRoofUv ) * step( wallRoofUv, vec2( 1.0 ) );
  wallPhoto = smoothstep( 0.25, 0.45, wallN.y ) * ( 1.0 - wallPlain ) * wallRoofTexel.a * wallRoofIn.x * wallRoofIn.y * uRoofMix;
  diffuseColor.rgb = mix( diffuseColor.rgb, wallRoofTexel.rgb, wallPhoto );
}
if ( wallFade > 0.0 ) {
  float wallStorey = vWallStorey > 2.4 ? vWallStorey : 4.2;
  float wallScale = 4.2 / wallStorey;
  float wallLevel = floor( wallHigh / wallStorey );
  float wallIn = ( wallHigh - wallLevel * wallStorey ) * wallScale;
  float wallRoom = step( wallLevel * wallStorey + 3.3 / wallScale, wallTop );
  float wallBand = smoothstep( 1.0 - wallStepY, 1.0 + wallStepY, wallIn ) * ( 1.0 - smoothstep( 2.7 - wallStepY, 2.7 + wallStepY, wallIn ) );
  float wallBay = 3.6;
  float wallOff = abs( fract( wallAlong / wallBay ) - 0.5 ) * wallBay;
  float wallPane = 1.0 - smoothstep( 1.3 - wallStepU, 1.3 + wallStepU, wallOff );
  float wallMullion = 1.0 - smoothstep( 0.035 - wallStepU, 0.035 + wallStepU, wallOff );
  float wallTransom = 1.0 - smoothstep( 0.03 - wallStepY, 0.03 + wallStepY, abs( wallIn - 2.15 ) );
  float wallInset = ( 1.0 - smoothstep( 1.25 - wallStepU, 1.25 + wallStepU, wallOff ) ) * smoothstep( 1.05 - wallStepY, 1.05 + wallStepY, wallIn ) * ( 1.0 - smoothstep( 2.65 - wallStepY, 2.65 + wallStepY, wallIn ) );
  wallGlass = wallBand * wallPane * wallRoom * wallFade;
  wallFrame = max( max( wallMullion, wallTransom ), 1.0 - wallInset ) * wallGlass * wallFine;
  float wallSill = ( 1.0 - smoothstep( 0.06 - wallStepY, 0.06 + wallStepY, abs( wallIn - 0.94 ) ) ) * wallPane * wallRoom * wallFade * wallFine;
  float wallBase = ( 1.0 - smoothstep( 0.5 - wallStepY, 0.5 + wallStepY, wallHigh ) ) * wallFade;
  float wallJointW = max( 0.035, wallPx * 0.6 );
  float wallJointV = 1.0 - smoothstep( wallJointW - wallStepU, wallJointW + wallStepU, wallBay * 0.5 - wallOff );
  float wallJointH = ( 1.0 - smoothstep( wallJointW - wallStepY, wallJointW + wallStepY, min( wallIn, 4.2 - wallIn ) ) ) * step( 0.6, wallHigh );
  float wallJoint = max( wallJointV, wallJointH ) * wallFade * ( 1.0 - wallGlass ) * clamp( 0.05 / wallPx, 0.0, 1.0 );
  float wallBrickNear = ( 1.0 - smoothstep( 0.035, 0.08, wallPx ) ) * uBrickMix * ( 1.0 - wallGlass );
  if ( wallBrickNear > 0.0 ) {
    float wallBrick = textureGrad( uBrickMap, wallBrickUv, wallBrickX, wallBrickY ).r - 0.5;
    diffuseColor.rgb *= 1.0 + wallBrick * ${MASONRY_CONTRAST.toFixed(3)} * wallBrickNear;
  }
  vec3 wallView = normalize( cameraPosition - vWallPos );
  float wallGrazing = 1.0 - clamp( dot( wallN, wallView ), 0.0, 1.0 );
  vec3 wallPaneColor = mix( vec3( 0.13, 0.165, 0.21 ), vec3( 0.4, 0.48, 0.57 ), 0.22 + 0.5 * wallGrazing * wallGrazing );
  diffuseColor.rgb = mix( diffuseColor.rgb, wallPaneColor, wallGlass * ( 1.0 - wallFrame ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.8, 0.82, 0.82 ), wallFrame );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.9, wallSill );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.84, 0.86, 0.86 ), wallBase );
  diffuseColor.rgb *= 1.0 - 0.045 * wallJoint;
}
if ( wallGravel > 0.0 ) {
  vec2 wallGrit = vWallPos.xz / 0.35;
  float wallSpeck = wallNoise( wallGrit ) * 0.65 + wallNoise( wallGrit * 0.37 + 17.0 ) * 0.35;
  diffuseColor.rgb *= 1.0 + ( wallSpeck - 0.5 ) * 0.07 * wallGravel;
}
diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.91, 0.935, 0.965 ), wallRoof * ( 1.0 - wallPhoto ) );
float wallGrounded = step( 0.001, vWallRaised ) * step( vWallRaised, 0.9999 );
float wallFoot = wallSide * ( 1.0 - smoothstep( 0.0, 2.0, wallHigh ) );
float wallEave = wallSide * wallGrounded * smoothstep( wallTop - 0.7, wallTop, wallHigh );
diffuseColor.rgb *= ( 1.0 - 0.10 * wallFoot ) * ( 1.0 - 0.09 * wallEave );`;

export type WallSurface = {
  uRoofMap: { value: THREE.Texture };
  uRoofBox: { value: THREE.Vector4 };
  uRoofMix: { value: number };
  uBrickMap: { value: THREE.Texture };
  uBrickMix: { value: number };
};

const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.needsUpdate = true;

export function wallSurface(shared?: WallSurface): WallSurface {
  return {
    uRoofMap: shared?.uRoofMap ?? { value: BLANK },
    uRoofBox: shared?.uRoofBox ?? { value: new THREE.Vector4(0, 0, 1, 1) },
    uRoofMix: { value: 0 },
    uBrickMap: shared?.uBrickMap ?? { value: BLANK },
    uBrickMix: shared?.uBrickMix ?? { value: 0 },
  };
}

export function enhanceWalls(material: THREE.MeshStandardMaterial, surface: WallSurface = wallSurface()): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surface);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', WALL_VERTEX_HEAD).replace('#include <worldpos_vertex>', WALL_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', WALL_FRAGMENT_HEAD).replace('#include <color_fragment>', WALL_FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => 'shady-walls-6';
  material.needsUpdate = true;
}

export const BLOB_LIFT = 0.06;

const BLOB_VERTEX = `
varying vec2 vBlob;
void main() {
  vBlob = uv * 2.0 - 1.0;
  vec4 local = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * local;
}
`;

const BLOB_FRAGMENT = `
uniform vec3 uColor;
varying vec2 vBlob;
void main() {
  float r = length( vBlob );
  if ( r >= 1.0 ) discard;
  gl_FragColor = vec4( uColor, 0.26 * ( 1.0 - smoothstep( 0.25, 1.0, r ) ) );
  #include <colorspace_fragment>
}
`;

export function buildBlob(): { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: BLOB_VERTEX,
    fragmentShader: BLOB_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color('#2b4450') } },
    transparent: true,
    depthWrite: false,
  });
  return { geometry, material };
}
