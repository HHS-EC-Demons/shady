import * as THREE from 'three';
import { arrived, levelFor, reach, wantsNear } from './forest';
import { TINTED, makeMaterial, type Library, type Look, type Model, type Part } from './library';

export const SHADOW_LAYER = 1;

export type Member = { model: string; matrix: THREE.Matrix4; tint: THREE.Color | null; size: number; hidden?: boolean };
export type CrowdOptions = { edges: readonly number[]; reference: number; floor: number | null; bulk: number; candidates?: readonly string[] };

type Entry = { model: string; level: number; part: Part };

type Slot = {
  tinted: boolean;
  colored: boolean;
  main: THREE.BatchedMesh | null;
  shade: THREE.BatchedMesh | null;
  parts: Map<string, (Part | null)[]>;
  mainIds: Map<string, number[]>;
  shadeIds: Map<string, number[]>;
  mainSlots: Int32Array;
  shadeSlots: Int32Array;
};

type Batch = { mesh: THREE.BatchedMesh; ids: Map<string, number[]>; slots: Int32Array };

type Herd = { mesh: THREE.InstancedMesh; part: Part | null; tinted: boolean; colored: boolean; count: number };

const WHITE = new THREE.Color(1, 1, 1);
const MOVE = 0.06;
const TURN = Math.cos((3 * Math.PI) / 180);
const MARGIN = 0.08;
const SHADOW_MARGIN = 0.15;
const SHADOW_REACH = 5;
const paint = new THREE.Color();
const spot = new THREE.Vector3();
const look = new THREE.Vector3();
const ball = new THREE.Sphere();
const sight = new THREE.Frustum();
const screenMatrix = new THREE.Matrix4();
const noRay = () => {};
const NONE: number[] = [];
const NO_HERDS: Herd[][] = [];
const PLACE_SLICE = 256;

function solid(parts: Part[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const part of parts) {
    vertices += part.geometry.getAttribute('position').count;
    indices += part.geometry.getIndex()?.count ?? 0;
  }
  const position = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let at = 0;
  let to = 0;
  for (const part of parts) {
    const source = part.geometry.getAttribute('position');
    for (let item = 0; item < source.count; item += 1) {
      position[(at + item) * 3] = source.getX(item);
      position[(at + item) * 3 + 1] = source.getY(item);
      position[(at + item) * 3 + 2] = source.getZ(item);
    }
    const order = part.geometry.getIndex();
    if (order) for (let item = 0; item < order.count; item += 1) index[to + item] = order.getX(item) + at;
    at += source.count;
    to += order?.count ?? 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export class Crowd {
  readonly object = new THREE.Group();
  readonly members: Member[];
  readonly wanted = new Set<string>();
  private slots: Slot[] = [];
  private herds: Herd[] = [];
  private shown = new Map<string, Herd[][]>();
  private shades = new Map<string, Herd[][]>();
  private owned: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private levels: Int8Array;
  private tops: Int8Array;
  private inside: Uint8Array;
  private casting: Uint8Array;
  private centres: Float32Array;
  private seen = new THREE.Vector3(Infinity, Infinity, Infinity);
  private facing = new THREE.Vector3();
  private lens = new THREE.Matrix4();
  private screen = 0;
  private nearest = 0;

  constructor(
    private library: Library,
    members: Member[],
    private options: CrowdOptions,
    lazy = false,
  ) {
    this.members = members.map((member) => ({ ...member, matrix: member.matrix.clone(), tint: member.tint?.clone() ?? null }));
    this.levels = new Int8Array(members.length).fill(options.edges.length);
    this.tops = new Int8Array(members.length);
    this.inside = new Uint8Array(members.length).fill(1);
    this.casting = new Uint8Array(members.length).fill(1);
    this.centres = new Float32Array(members.length * 3);
    if (!lazy) for (const _ of this.steps()) continue;
  }

  *steps(): Generator<void> {
    const { library, options, members } = this;
    const names = new Set<string>([...(options.candidates ?? []), ...members.map((member) => member.model)]);
    const models = [...names].map((name) => library.models.get(name)).filter((model): model is Model => model !== undefined);
    const byLook = new Map<string, Entry[]>();
    for (const model of models) {
      model.levels.forEach((parts, level) => {
        for (const part of parts ?? []) {
          const list = byLook.get(part.look) ?? [];
          list.push({ model: model.name, level, part });
          byLook.set(part.look, list);
        }
      });
    }
    const count = Math.max(1, members.length);
    const floor = options.floor;
    const casts = (entry: Entry) => floor !== null && entry.level >= Math.min(floor, this.top(entry.model));
    const plain = new THREE.MeshBasicMaterial();
    this.materials.push(plain);
    const solidParts = new Map<string, Part[]>();
    for (const [key, entries] of byLook) {
      const found = library.looks.get(key);
      if (!found) continue;
      const lookOf: Look = found;
      const tinted = TINTED.has(lookOf.name);
      const colored = tinted || entries.some((entry) => !entry.part.color.equals(WHITE));
      const near = entries.filter((entry) => entry.level < options.bulk);
      const far = entries.filter((entry) => entry.level >= options.bulk);
      const batch = near.length > 0 ? makeMaterial(lookOf) : null;
      const herd = far.length > 0 ? makeMaterial(lookOf) : null;
      if (batch) this.materials.push(batch);
      if (herd) this.materials.push(herd);
      const prepare = (mesh: THREE.Mesh, shadow: boolean) => this.prepare(mesh, shadow, shadow ? `${key} shadow` : key);
      const build = function* (list: Entry[], shadow: boolean, material: THREE.Material): Generator<void, Batch> {
        let vertices = 0;
        let indices = 0;
        for (const entry of list) {
          vertices += entry.part.geometry.getAttribute('position').count;
          indices += entry.part.geometry.getIndex()?.count ?? 0;
        }
        const mesh = new THREE.BatchedMesh(count, vertices, indices, material);
        const ids = new Map<string, number[]>();
        let first = -1;
        for (const entry of list) {
          const levels = ids.get(entry.model) ?? [-1, -1, -1];
          levels[entry.level] = mesh.addGeometry(entry.part.geometry);
          if (first < 0) first = levels[entry.level];
          ids.set(entry.model, levels);
          yield;
        }
        const slots = new Int32Array(members.length);
        for (let index = 0; index < members.length; index += 1) {
          slots[index] = mesh.addInstance(first);
          mesh.setVisibleAt(slots[index], false);
          if (index % PLACE_SLICE === PLACE_SLICE - 1) yield;
        }
        mesh.perObjectFrustumCulled = false;
        mesh.sortObjects = false;
        prepare(mesh, shadow);
        return { mesh, ids, slots };
      };
      const main = batch ? yield* build(near, false, batch) : null;
      if (main && colored && members.length > 0) main.mesh.setColorAt(main.slots[0], WHITE);
      const deep = near.filter(casts);
      const shade = batch && deep.length > 0 ? yield* build(deep, true, batch) : null;
      const parts = new Map<string, (Part | null)[]>();
      for (const entry of entries) {
        const levels = parts.get(entry.model) ?? [null, null, null];
        levels[entry.level] = entry.part;
        parts.set(entry.model, levels);
      }
      this.slots.push({
        tinted,
        colored,
        main: main?.mesh ?? null,
        shade: shade?.mesh ?? null,
        parts,
        mainIds: main?.ids ?? new Map(),
        shadeIds: shade?.ids ?? new Map(),
        mainSlots: main?.slots ?? new Int32Array(0),
        shadeSlots: shade?.slots ?? new Int32Array(0),
      });
      for (const entry of far) {
        if (!herd) continue;
        this.herd(this.shown, entry, new THREE.InstancedMesh(entry.part.geometry, herd, count), false, tinted, colored);
        if (!casts(entry)) continue;
        if (lookOf.map && lookOf.cutoff > 0) this.herd(this.shades, entry, new THREE.InstancedMesh(entry.part.geometry, herd, count), true, false, false);
        else {
          const name = `${entry.model} ${entry.level}`;
          const list = solidParts.get(name) ?? [];
          list.push(entry.part);
          solidParts.set(name, list);
        }
      }
      yield;
    }
    for (const [name, parts] of solidParts) {
      const split = name.lastIndexOf(' ');
      const geometry = solid(parts);
      this.owned.push(geometry);
      this.herd(this.shades, { model: name.slice(0, split), level: Number(name.slice(split + 1)), part: parts[0] }, new THREE.InstancedMesh(geometry, plain, count), true, false, false);
      yield;
    }
    for (let index = 0; index < members.length; index += 1) {
      this.place(index);
      if (index % PLACE_SLICE === PLACE_SLICE - 1) yield;
    }
    this.pack();
  }

  private prepare(mesh: THREE.Mesh, shadow: boolean, name: string): void {
    mesh.frustumCulled = false;
    mesh.raycast = noRay;
    mesh.matrixAutoUpdate = false;
    if (shadow) {
      mesh.layers.set(SHADOW_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
    } else {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    }
    mesh.name = name;
    this.object.add(mesh);
  }

  private herd(table: Map<string, Herd[][]>, entry: Entry, mesh: THREE.InstancedMesh, shadow: boolean, tinted: boolean, colored: boolean): void {
    mesh.count = 0;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.prepare(mesh, shadow, `${entry.model} ${entry.level}${shadow ? ' shadow' : ''}`);
    if (colored) mesh.setColorAt(0, WHITE);
    const herd: Herd = { mesh, part: shadow ? null : entry.part, tinted, colored, count: 0 };
    this.herds.push(herd);
    const levels = table.get(entry.model) ?? [[], [], []];
    levels[entry.level].push(herd);
    table.set(entry.model, levels);
  }

  private top(model: string): number {
    return Math.max(0, (this.library.models.get(model)?.levels.length ?? 1) - 1);
  }

  private centre(index: number): void {
    const member = this.members[index];
    spot.setFromMatrixPosition(member.matrix);
    this.centres[index * 3] = spot.x;
    this.centres[index * 3 + 1] = spot.y + member.size / 2;
    this.centres[index * 3 + 2] = spot.z;
  }

  private place(index: number): void {
    const member = this.members[index];
    this.tops[index] = this.top(member.model);
    this.centre(index);
    for (let which = 0; which < this.slots.length; which += 1) {
      const slot = this.slots[which];
      if (slot.main) slot.main.setMatrixAt(slot.mainSlots[index], member.matrix);
      if (slot.shade) slot.shade.setMatrixAt(slot.shadeSlots[index], member.matrix);
    }
    this.show(index, true);
  }

  private reached(model: string, level: number): number {
    const levels = this.library.models.get(model)?.levels;
    return levels ? arrived(levels, level) : level;
  }

  private deepOf(model: string, level: number, top: number): number {
    const floor = this.options.floor;
    return floor === null ? -1 : this.reached(model, Math.min(Math.max(level, floor), top));
  }

  private show(index: number, force = false): void {
    const member = this.members[index];
    const top = this.tops[index];
    const level = this.reached(member.model, Math.min(this.levels[index], top));
    const deep = this.deepOf(member.model, level, top);
    for (let which = 0; which < this.slots.length; which += 1) {
      const slot = this.slots[which];
      if (slot.main) {
        const part = slot.parts.get(member.model)?.[level] ?? null;
        const main = slot.mainSlots[index];
        const id = (slot.mainIds.get(member.model) ?? NONE)[level] ?? -1;
        if (member.hidden || this.inside[index] === 0 || !part || id < 0) slot.main.setVisibleAt(main, false);
        else {
          const fresh = force || !slot.main.getVisibleAt(main) || slot.main.getGeometryIdAt(main) !== id;
          if (fresh) slot.main.setGeometryIdAt(main, id);
          slot.main.setVisibleAt(main, true);
          if (fresh && slot.colored) slot.main.setColorAt(main, this.colorOf(slot.tinted, part, member));
        }
      }
      if (!slot.shade) continue;
      const shadow = slot.shadeSlots[index];
      const deepId = deep >= 0 ? ((slot.shadeIds.get(member.model) ?? NONE)[deep] ?? -1) : -1;
      if (member.hidden || this.casting[index] === 0 || deepId < 0) slot.shade.setVisibleAt(shadow, false);
      else {
        if (slot.shade.getGeometryIdAt(shadow) !== deepId) slot.shade.setGeometryIdAt(shadow, deepId);
        slot.shade.setVisibleAt(shadow, true);
      }
    }
  }

  private pack(): void {
    for (let which = 0; which < this.herds.length; which += 1) this.herds[which].count = 0;
    const bulk = this.options.bulk;
    for (let index = 0; index < this.members.length; index += 1) {
      const member = this.members[index];
      if (member.hidden) continue;
      const top = this.tops[index];
      const level = this.reached(member.model, Math.min(this.levels[index], top));
      if (this.inside[index] === 1 && level >= bulk) {
        const herds = (this.shown.get(member.model) ?? NO_HERDS)[level];
        if (herds) {
          for (let which = 0; which < herds.length; which += 1) {
            const herd = herds[which];
            herd.mesh.setMatrixAt(herd.count, member.matrix);
            if (herd.colored && herd.part) herd.mesh.setColorAt(herd.count, this.colorOf(herd.tinted, herd.part, member));
            herd.count += 1;
          }
        }
      }
      const deep = this.deepOf(member.model, level, top);
      if (this.casting[index] === 1 && deep >= bulk) {
        const herds = (this.shades.get(member.model) ?? NO_HERDS)[deep];
        if (herds) {
          for (let which = 0; which < herds.length; which += 1) {
            const herd = herds[which];
            herd.mesh.setMatrixAt(herd.count, member.matrix);
            herd.count += 1;
          }
        }
      }
    }
    for (let which = 0; which < this.herds.length; which += 1) {
      const herd = this.herds[which];
      herd.mesh.count = herd.count;
      herd.mesh.visible = herd.count > 0;
      if (herd.count === 0) continue;
      herd.mesh.instanceMatrix.clearUpdateRanges();
      herd.mesh.instanceMatrix.addUpdateRange(0, herd.count * 16);
      herd.mesh.instanceMatrix.needsUpdate = true;
      if (herd.mesh.instanceColor) {
        herd.mesh.instanceColor.clearUpdateRanges();
        herd.mesh.instanceColor.addUpdateRange(0, herd.count * 3);
        herd.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private colorOf(tinted: boolean, part: Part, member: Member): THREE.Color {
    paint.copy(part.color);
    if (tinted && member.tint) paint.multiply(member.tint);
    return paint;
  }

  set(index: number, member: Member): void {
    const current = this.members[index];
    if (!current) return;
    current.model = member.model;
    current.matrix.copy(member.matrix);
    current.size = member.size;
    current.hidden = member.hidden;
    if (member.tint) current.tint = (current.tint ?? new THREE.Color()).copy(member.tint);
    else current.tint = null;
    this.centre(index);
    if (this.screen > 0) {
      const distance = this.distanceOf(index);
      this.levels[index] = this.levelOf(index, this.levels[index]);
      this.inside[index] = this.seenFrom(index, distance);
      this.casting[index] = this.seenFrom(index, distance, SHADOW_REACH, SHADOW_MARGIN);
    }
    this.place(index);
    if (this.herds.length > 0) this.pack();
  }

  private distanceOf(index: number): number {
    const dx = this.centres[index * 3] - this.seen.x;
    const dy = this.centres[index * 3 + 1] - this.seen.y;
    const dz = this.centres[index * 3 + 2] - this.seen.z;
    return Math.hypot(dx, dy, dz);
  }

  private levelOf(index: number, current: number): number {
    const distance = this.distanceOf(index);
    if (distance < this.nearest) this.nearest = distance;
    return levelFor(reach(distance, this.members[index].size, this.screen, this.options.reference), this.options.edges, current);
  }

  private seenFrom(index: number, distance: number, size = 1, margin = MARGIN): number {
    ball.center.set(this.centres[index * 3], this.centres[index * 3 + 1], this.centres[index * 3 + 2]);
    ball.radius = this.members[index].size * size + distance * margin;
    return sight.intersectsSphere(ball) ? 1 : 0;
  }

  update(camera: THREE.Camera, screen: number): boolean {
    camera.getWorldPosition(spot);
    camera.getWorldDirection(look);
    const still = screen === this.screen && spot.distanceTo(this.seen) < Math.max(0.5, this.nearest * MOVE) && look.dot(this.facing) > TURN && camera.projectionMatrix.equals(this.lens);
    if (still) return false;
    this.seen.copy(spot);
    this.facing.copy(look);
    this.lens.copy(camera.projectionMatrix);
    this.screen = screen;
    this.nearest = Infinity;
    camera.updateMatrixWorld();
    screenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    sight.setFromProjectionMatrix(screenMatrix);
    let changed = false;
    for (let index = 0; index < this.members.length; index += 1) {
      const distance = this.distanceOf(index);
      const level = this.levelOf(index, this.levels[index]);
      const inside = this.seenFrom(index, distance);
      const casting = this.seenFrom(index, distance, SHADOW_REACH, SHADOW_MARGIN);
      if (level === this.levels[index] && inside === this.inside[index] && casting === this.casting[index]) continue;
      this.levels[index] = level;
      this.inside[index] = inside;
      this.casting[index] = casting;
      this.show(index);
      changed = true;
    }
    if (changed && this.herds.length > 0) this.pack();
    this.wanted.clear();
    for (let index = 0; index < this.members.length; index += 1) {
      const member = this.members[index];
      const level = this.levels[index];
      const levels = this.library.models.get(member.model)?.levels;
      if (levels && wantsNear(levels, level, this.tops[index], this.inside[index] === 1 && !member.hidden)) this.wanted.add(member.model);
    }
    return changed;
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.main?.dispose();
      slot.shade?.dispose();
    }
    for (const herd of this.herds) herd.mesh.dispose();
    for (const geometry of this.owned) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.clear();
  }
}

export async function buildCrowd(library: Library, members: Member[], options: CrowdOptions, pause: () => Promise<void>): Promise<Crowd> {
  const crowd = new Crowd(library, members, options, true);
  for (const _ of crowd.steps()) await pause();
  return crowd;
}
