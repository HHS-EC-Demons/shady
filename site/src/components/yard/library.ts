import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CARS, FURNITURE, TREE_SHAPES, nearOrder, phaseOf } from './forest';
import { MODELS_VERSION, earlyPack, fetchAhead, nextTask, takeBlob, takeBytes } from './early';

export { MODELS_VERSION } from './early';
export const LEVELS = ['lod0', 'lod1', 'lod2'];
export const TINTED = new Set(['leaves', 'leaves-far', 'crown', 'paint', 'kit']);
export const TREE_LOOKS = new Set(['bark', 'leaves', 'leaves-far', 'crown']);
export const RETRY_MS = 4000;

export type Kind = 'broadleaf' | 'conifers' | 'cars' | 'poles' | 'people' | 'furniture';

export const KINDS: Record<Kind, string[]> = {
  broadleaf: TREE_SHAPES.filter((shape) => shape.kind !== 'conifer').map((shape) => shape.name),
  conifers: TREE_SHAPES.filter((shape) => shape.kind === 'conifer').map((shape) => shape.name),
  cars: [...CARS],
  poles: ['pole-lot', 'pole-lot-double'],
  people: ['person-stand', 'person-walk', 'person-walk-b', 'person-run'],
  furniture: [...FURNITURE],
};

const CORE: Kind[] = ['broadleaf', 'cars', 'poles', 'people', 'furniture'];
const IDLE_AFTER_MS = 6000;
const IDLE_WAIT_MS = 4000;
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export type Look = { key: string; name: string; map: THREE.Texture | null; cutoff: number; double: boolean; colors: boolean; rough: number };
export type Part = { look: string; geometry: THREE.BufferGeometry; color: THREE.Color };
export type Model = { name: string; levels: (Part[] | null)[] };
export type Library = { models: Map<string, Model>; looks: Map<string, Look>; kinds: Set<Kind>; full: Set<Kind>; conifers: boolean };

type Loaded = { models: Model[]; looks: Look[] };
type Picture = ImageBitmap | HTMLImageElement;
type Stage = 'far' | 'full';
type Json = { textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]; images?: { uri?: string }[] };
type Pack = { gltf: GLTF; address: string };

const done = new Map<string, Loaded>();
const flying = new Map<string, Promise<Loaded | null>>();
const waiting = new Map<string, number>();
const asked = new Set<string>();
const pictures = new Map<string, Promise<Picture>>();
const textures = new Map<string, THREE.Texture>();
const listeners = new Set<() => void>();
const merged = new Map<string, Library | null>();
let packing: Promise<Pack | null> | null = null;
let packed: Pack | null = null;
let preparing: Promise<unknown> = Promise.resolve();
let needles = false;
let idling = false;
let telling = false;
let place = '';
let version = 0;
let decoding = false;

export function wanted(conifers: boolean): Kind[] {
  return conifers ? [...CORE, 'conifers'] : CORE;
}

function levelsOf(name: string): number {
  return name.startsWith('tree-') ? 3 : 2;
}

function loader(): GLTFLoader {
  if (!decoding && typeof Worker !== 'undefined') {
    decoding = true;
    MeshoptDecoder.useWorkers(2);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((address) => (address.startsWith('data:') || address.endsWith('.glb') ? address : PLACEHOLDER));
  const result = new GLTFLoader(manager);
  result.setMeshoptDecoder(MeshoptDecoder);
  return result;
}

type Range = [string, number, number, number, number];

function floatGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4, range?: Range): THREE.BufferGeometry {
  const first = range ? range[1] : 0;
  const geometry = new THREE.BufferGeometry();
  const e = matrix.elements;
  const scale = Math.hypot(e[0], e[1], e[2]);
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attribute = source.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!attribute) continue;
    const woven = (attribute as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
    const size = name === 'color' ? 3 : attribute.itemSize;
    const count = range ? range[2] : attribute.count;
    const input = (woven ? (attribute as unknown as THREE.InterleavedBufferAttribute).data.array : attribute.array) as ArrayLike<number>;
    const stride = woven ? (attribute as unknown as THREE.InterleavedBufferAttribute).data.stride : attribute.itemSize;
    const offset = woven ? (attribute as unknown as THREE.InterleavedBufferAttribute).offset : 0;
    const array = new Float32Array(count * size);
    const unit = attribute.normalized ? (input instanceof Int8Array ? 127 : input instanceof Uint8Array ? 255 : input instanceof Int16Array ? 32767 : input instanceof Uint16Array ? 65535 : 1) : 1;
    const signed = input instanceof Int8Array || input instanceof Int16Array;
    for (let index = 0; index < count; index += 1) {
      for (let part = 0; part < size; part += 1) {
        const raw = input[(index + first) * stride + offset + part] / unit;
        array[index * size + part] = signed && unit !== 1 ? Math.max(raw, -1) : raw;
      }
    }
    if (name === 'position') {
      for (let index = 0; index < count; index += 1) {
        const x = array[index * 3];
        const y = array[index * 3 + 1];
        const z = array[index * 3 + 2];
        array[index * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        array[index * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        array[index * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    } else if (name === 'normal') {
      for (let index = 0; index < count; index += 1) {
        const x = (e[0] * array[index * 3] + e[4] * array[index * 3 + 1] + e[8] * array[index * 3 + 2]) / scale;
        const y = (e[1] * array[index * 3] + e[5] * array[index * 3 + 1] + e[9] * array[index * 3 + 2]) / scale;
        const z = (e[2] * array[index * 3] + e[6] * array[index * 3 + 1] + e[10] * array[index * 3 + 2]) / scale;
        const length = Math.hypot(x, y, z) || 1;
        array[index * 3] = x / length;
        array[index * 3 + 1] = y / length;
        array[index * 3 + 2] = z / length;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index = source.getIndex();
  if (index && range) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from((index.array as Uint32Array).subarray(range[3], range[3] + range[4]), (value) => value - first), 1));
  else if (index) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(index.array as ArrayLike<number>), 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function chunkOf(buffer: ArrayBuffer): Json {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('model');
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as Json;
}

function decode(blob: Blob): Promise<Picture> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return new Promise((resolve, reject) => {
    const image = new Image();
    const address = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(address);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(address);
      reject(new Error('picture'));
    };
    image.src = address;
  });
}

function picture(address: string): Promise<Picture> {
  let known = pictures.get(address);
  if (!known) {
    known = takeBlob(address).then(decode);
    known.catch(() => pictures.delete(address));
    pictures.set(address, known);
  }
  return known;
}

function imageOf(gltf: GLTF, texture: THREE.Texture, base: string): string {
  const mapping = gltf.parser.associations.get(texture) as { textures?: number } | undefined;
  const json = gltf.parser.json as Json;
  const definition = mapping?.textures !== undefined ? json.textures?.[mapping.textures] : undefined;
  const source = definition?.extensions?.EXT_texture_webp?.source ?? definition?.source;
  const uri = source !== undefined ? json.images?.[source]?.uri : undefined;
  return uri ? new URL(uri, base).href : texture.uuid;
}

function textureFor(address: string, image: Picture, from: THREE.Texture): THREE.Texture {
  let texture = textures.get(address);
  if (!texture) {
    texture = new THREE.Texture(image);
    texture.flipY = false;
    texture.colorSpace = from.colorSpace;
    texture.wrapS = from.wrapS;
    texture.wrapT = from.wrapT;
    texture.magFilter = from.magFilter;
    texture.minFilter = from.minFilter;
    texture.needsUpdate = true;
    textures.set(address, texture);
  }
  return texture;
}

function unify(models: Model[], looks: Look[]): void {
  const parts = models.flatMap((model) => model.levels.flatMap((level) => level ?? []));
  for (const look of looks) {
    const own = parts.filter((part) => part.look === look.key);
    const colors = own.some((part) => part.geometry.getAttribute('color'));
    const uvs = own.some((part) => part.geometry.getAttribute('uv'));
    look.colors = colors;
    for (const part of own) {
      const count = part.geometry.getAttribute('position').count;
      if (colors && !part.geometry.getAttribute('color')) part.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      if (uvs && !part.geometry.getAttribute('uv')) part.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
  }
}

function meshesOf(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

function lookOf(gltf: GLTF, mesh: THREE.Mesh, address: string, images: Map<string, Picture>, looks: Map<string, Look>): string {
  const material = mesh.material as THREE.MeshStandardMaterial;
  const from = material.map;
  const image = from ? imageOf(gltf, from, address) : '';
  const found = image ? images.get(image) : undefined;
  if (from && !found) throw new Error('picture');
  const key = image ? `${material.name}@${image}` : material.name;
  if (!looks.has(key)) {
    const map = from && found ? textureFor(image, found, from) : null;
    looks.set(key, { key, name: material.name, map, cutoff: material.alphaTest, double: material.side === THREE.DoubleSide, colors: false, rough: material.roughness });
  }
  return key;
}

function partOf(gltf: GLTF, mesh: THREE.Mesh, address: string, images: Map<string, Picture>, looks: Map<string, Look>, range?: Range): Part {
  const material = mesh.material as THREE.MeshStandardMaterial;
  return { look: lookOf(gltf, mesh, address, images, looks), geometry: floatGeometry(mesh.geometry, mesh.matrixWorld, range), color: material.color.clone() };
}

function drop(gltf: GLTF): void {
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.map?.dispose();
    material.dispose();
  });
}

function packOf(base: string): Promise<Pack | null> {
  if (packed) return Promise.resolve(packed);
  if (!packing) {
    let address = '';
    packing = earlyPack(base)
      .then((found) => {
        address = found.address;
        return loader().parseAsync(found.buffer, address.slice(0, address.lastIndexOf('/') + 1));
      })
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        packed = { gltf, address };
        return packed;
      })
      .catch(() => null)
      .finally(() => {
        packing = null;
      });
  }
  return packing;
}

async function farSet(base: string, names: string[]): Promise<Loaded | null> {
  const pack = await packOf(base);
  if (!pack) return null;
  try {
    const images = new Map<string, Picture>();
    const wanted = new Set(names);
    const pieces = meshesOf(pack.gltf.scene).flatMap((mesh) => ((mesh.geometry.userData.parts ?? []) as Range[]).filter((range) => wanted.has(range[0])).map((range) => ({ mesh, range })));
    for (const name of names) if (!pieces.some(({ range }) => range[0] === name)) throw new Error('model');
    const maps = new Set<string>();
    for (const { mesh } of pieces) {
      const map = (mesh.material as THREE.MeshStandardMaterial).map;
      if (map) maps.add(imageOf(pack.gltf, map, pack.address));
    }
    await Promise.all([...maps].map((image) => picture(image).then((found) => images.set(image, found))));
    const looks = new Map<string, Look>();
    const models = names.map((name): Model => {
      const levels: (Part[] | null)[] = new Array(levelsOf(name)).fill(null);
      levels[levelsOf(name) - 1] = pieces.filter(({ range }) => range[0] === name).map(({ mesh, range }) => partOf(pack.gltf, mesh, pack.address, images, looks, range));
      return { name, levels };
    });
    unify(models, [...looks.values()]);
    return { models, looks: [...looks.values()] };
  } catch {
    return null;
  }
}

function fileOf(base: string, name: string): string {
  return new URL(`${base}models/${name}.glb?v=${MODELS_VERSION}`, window.location.href).href;
}

async function fullSet(base: string, names: string[], far: Loaded | undefined): Promise<Loaded | null> {
  const addresses = names.map((name) => fileOf(base, name));
  const downloads = addresses.map((address) => takeBytes(address));
  for (const download of downloads) download.catch(() => undefined);
  try {
    const looks = new Map<string, Look>();
    const models: Model[] = [];
    const known = new Map((far?.models ?? []).map((model) => [model.name, model]));
    for (const look of far?.looks ?? []) looks.set(look.key, look);
    for (let which = 0; which < names.length; which += 1) {
      const name = names[which];
      const address = addresses[which];
      const buffer = await downloads[which];
      const images = new Map<string, Picture>();
      await Promise.all(
        (chunkOf(buffer).images ?? [])
          .filter((image) => image.uri)
          .map((image) => {
            const at = new URL(image.uri as string, address).href;
            return picture(at).then((found) => images.set(at, found));
          }),
      );
      await nextTask();
      const gltf = await loader().parseAsync(buffer, address.slice(0, address.lastIndexOf('/') + 1));
      gltf.scene.updateMatrixWorld(true);
      await nextTask();
      const levels: (Part[] | null)[] = [];
      for (const [index, level] of LEVELS.slice(0, levelsOf(name)).entries()) {
        const node = gltf.scene.getObjectByName(level);
        if (!node) throw new Error('model');
        const kept = known.get(name)?.levels[index];
        if (kept) {
          const swap = new Map(meshesOf(node).map((mesh) => [(mesh.material as THREE.Material).name, lookOf(gltf, mesh, address, images, looks)]));
          levels.push(kept.map((part) => ({ ...part, look: swap.get(part.look.split('@')[0]) ?? part.look })));
          continue;
        }
        const parts: Part[] = [];
        for (const mesh of meshesOf(node)) {
          parts.push(partOf(gltf, mesh, address, images, looks));
          await nextTask();
        }
        levels.push(parts);
      }
      drop(gltf);
      models.push({ name, levels });
    }
    unify(models, [...looks.values()]);
    return { models, looks: [...looks.values()] };
  } catch {
    return null;
  }
}

function tell(): void {
  version += 1;
  merged.clear();
  if (telling) return;
  telling = true;
  void nextTask().then(() => {
    telling = false;
    for (const listener of listeners) listener();
  });
}

function attempt(base: string, kind: Kind, stage: Stage): Promise<Loaded | null> {
  const key = `${base} ${kind} ${stage}`;
  const known = done.get(key);
  if (known) return Promise.resolve(known);
  let run = flying.get(key);
  if (!run) {
    run = (stage === 'far' ? farSet(base, KINDS[kind]) : fullSet(base, KINDS[kind], done.get(`${base} ${kind} far`))).then((result) => {
      flying.delete(key);
      if (result) {
        done.set(key, result);
        tell();
      }
      return result;
    });
    flying.set(key, run);
  }
  return run;
}

function later(base: string, kind: Kind, stage: Stage): void {
  const key = `${base} ${kind} ${stage}`;
  if (waiting.has(key) || typeof window === 'undefined') return;
  waiting.set(
    key,
    window.setTimeout(() => {
      waiting.delete(key);
      void attempt(base, kind, stage);
    }, RETRY_MS),
  );
}

function build(conifers: boolean): Library | null {
  const memo = `${conifers} ${version}`;
  if (merged.has(memo)) return merged.get(memo) ?? null;
  const models = new Map<string, Model>();
  const looks = new Map<string, Look>();
  const kinds = new Set<Kind>();
  const far = new Set<Kind>();
  const full = new Set<Kind>();
  for (const kind of wanted(conifers)) {
    if (done.has(`${place} ${kind} far`)) far.add(kind);
    if (done.has(`${place} ${kind} full`)) full.add(kind);
  }
  for (const kind of wanted(conifers)) {
    const phase = phaseOf(far, full, kind);
    const set = phase === 'none' ? undefined : done.get(`${place} ${kind} ${phase}`);
    if (!set) continue;
    kinds.add(kind);
    for (const model of set.models) models.set(model.name, model);
    for (const look of set.looks) {
      const known = looks.get(look.key);
      if (known) known.colors = known.colors || look.colors;
      else looks.set(look.key, look);
    }
  }
  const library = kinds.size > 0 ? { models, looks, kinds, full, conifers } : null;
  if (library) unify([...models.values()], [...looks.values()]);
  merged.set(memo, library);
  return library;
}

export function needsConifers(trees: readonly { needle?: boolean }[]): boolean {
  return trees.some((tree) => tree.needle === true);
}

export async function loadLibrary(base: string, conifers = false): Promise<Library | null> {
  place = base;
  await Promise.all(
    wanted(conifers).map((kind) =>
      attempt(base, kind, 'far').then((result) => {
        if (!result) later(base, kind, 'far');
      }),
    ),
  );
  return build(conifers);
}

const MODEL_KINDS = new Map((Object.keys(KINDS) as Kind[]).flatMap((kind) => KINDS[kind].map((name) => [name, kind] as const)));

function prepare(kind: Kind): Promise<unknown> {
  const base = place;
  const key = `${base} ${kind} full`;
  if (!base || done.has(key) || flying.has(key) || waiting.has(key) || asked.has(key)) return flying.get(key) ?? Promise.resolve();
  if (kind === 'conifers' && !needles) return Promise.resolve();
  asked.add(key);
  preparing = preparing.then(async () => {
    if (done.has(key) || flying.has(key)) return;
    await nextTask();
    const result = await attempt(base, kind, 'full');
    if (!result) later(base, kind, 'full');
  });
  return preparing;
}

export function demandNear(models: Iterable<string>): void {
  for (const model of models) {
    const kind = MODEL_KINDS.get(model);
    if (kind) void prepare(kind);
  }
}

function idleNext(): void {
  const kind = nearOrder(needles).find((name) => !asked.has(`${place} ${name} full`)) as Kind | undefined;
  if (!kind) {
    idling = false;
    return;
  }
  const go = () => void prepare(kind).then(idleNext);
  const idle = (globalThis as { requestIdleCallback?: (run: () => void, options: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: IDLE_WAIT_MS });
  else window.setTimeout(go, 200);
}

export function nearSoon(conifers = false): () => void {
  if (typeof window === 'undefined' || !place) return () => undefined;
  if (conifers) needles = true;
  const base = place;
  let timer = 0;
  const frame = window.requestAnimationFrame(() => {
    void fetchAhead(nearOrder(needles).flatMap((kind) => KINDS[kind as Kind].map((name) => fileOf(base, name))));
    timer = window.setTimeout(() => {
      if (idling) return;
      idling = true;
      idleNext();
    }, IDLE_AFTER_MS);
  });
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

export function peekLibrary(conifers = false): Library | null {
  return place ? build(conifers) : null;
}

export function watchLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function releaseLibrary(library: Library | null | undefined): void {
  if (!library) return;
  for (const model of library.models.values()) for (const level of model.levels) for (const part of level ?? []) part.geometry.dispose();
  for (const look of library.looks.values()) look.map?.dispose();
}

export function makeMaterial(look: Look): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const shared = { color: 0xffffff, map: look.map, vertexColors: look.colors, side: look.double ? THREE.DoubleSide : THREE.FrontSide };
  const material = TREE_LOOKS.has(look.name) ? new THREE.MeshLambertMaterial(shared) : new THREE.MeshStandardMaterial({ ...shared, roughness: look.rough, metalness: 0 });
  if (look.cutoff > 0) material.alphaTest = look.cutoff;
  material.name = look.key;
  return material;
}
