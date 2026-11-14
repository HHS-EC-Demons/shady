import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CARS, TREE_SHAPES } from './forest';

export const MODELS_VERSION = 3;
export const LEVELS = ['lod0', 'lod1', 'lod2'];
export const TINTED = new Set(['leaves', 'leaves-far', 'crown', 'paint', 'kit']);
export const TREE_LOOKS = new Set(['bark', 'leaves', 'leaves-far', 'crown']);
export const RETRY_MS = 4000;

export type Kind = 'broadleaf' | 'conifers' | 'cars' | 'poles' | 'people';

export const KINDS: Record<Kind, string[]> = {
  broadleaf: TREE_SHAPES.filter((shape) => shape.kind !== 'conifer').map((shape) => shape.name),
  conifers: TREE_SHAPES.filter((shape) => shape.kind === 'conifer').map((shape) => shape.name),
  cars: [...CARS],
  poles: ['pole-lot', 'pole-lot-double'],
  people: ['person-stand', 'person-walk', 'person-walk-b', 'person-run'],
};

const CORE: Kind[] = ['broadleaf', 'cars', 'poles', 'people'];
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export type Look = { key: string; name: string; map: THREE.Texture | null; cutoff: number; double: boolean; colors: boolean; rough: number };
export type Part = { look: string; geometry: THREE.BufferGeometry; color: THREE.Color };
export type Model = { name: string; levels: Part[][] };
export type Library = { models: Map<string, Model>; looks: Map<string, Look>; kinds: Set<Kind> };

type Loaded = { models: Model[]; looks: Look[] };
type Picture = ImageBitmap | HTMLImageElement;

const done = new Map<string, Loaded>();
const flying = new Map<string, Promise<Loaded | null>>();
const waiting = new Map<string, number>();
const pictures = new Map<string, Promise<Picture>>();
const textures = new Map<string, THREE.Texture>();
const listeners = new Set<() => void>();
const merged = new Map<string, Library | null>();
let place = '';
let version = 0;

export function kindOf(model: string): Kind | null {
  for (const kind of Object.keys(KINDS) as Kind[]) if (KINDS[kind].includes(model)) return kind;
  return null;
}

export function wanted(conifers: boolean): Kind[] {
  return conifers ? [...CORE, 'conifers'] : CORE;
}

function floatGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const size = name === 'color' ? 3 : attribute.itemSize;
    const array = new Float32Array(attribute.count * size);
    for (let index = 0; index < attribute.count; index += 1) {
      for (let part = 0; part < size; part += 1) array[index * size + part] = attribute.getComponent(index, part);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index = source.getIndex();
  if (index) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(index.array as ArrayLike<number>), 1));
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

type Json = { textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]; images?: { uri?: string }[] };

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
    known = fetch(address).then((answer) => {
      if (!answer.ok) throw new Error('picture');
      return answer.blob().then(decode);
    });
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
  for (const look of looks) {
    const parts = models.flatMap((model) => model.levels.flat()).filter((part) => part.look === look.key);
    const colors = parts.some((part) => part.geometry.getAttribute('color'));
    const uvs = parts.some((part) => part.geometry.getAttribute('uv'));
    look.colors = colors;
    for (const part of parts) {
      const count = part.geometry.getAttribute('position').count;
      if (colors && !part.geometry.getAttribute('color')) part.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      if (uvs && !part.geometry.getAttribute('uv')) part.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
  }
}

async function loadSet(base: string, names: string[]): Promise<Loaded | null> {
  try {
    const addresses = names.map((name) => new URL(`${base}models/${name}.glb?v=${MODELS_VERSION}`, window.location.href).href);
    const buffers = await Promise.all(
      addresses.map((address) =>
        fetch(address).then((answer) => {
          if (!answer.ok) throw new Error('model');
          return answer.arrayBuffer();
        }),
      ),
    );
    const images = new Map<string, Picture>();
    const needed = new Set<string>();
    buffers.forEach((buffer, which) => {
      for (const image of chunkOf(buffer).images ?? []) if (image.uri) needed.add(new URL(image.uri, addresses[which]).href);
    });
    await Promise.all([...needed].map((address) => picture(address).then((image) => images.set(address, image))));
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((address) => (needed.has(address) ? PLACEHOLDER : address));
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const files = await Promise.all(buffers.map((buffer, which) => loader.parseAsync(buffer, addresses[which].slice(0, addresses[which].lastIndexOf('/') + 1))));
    const looks = new Map<string, Look>();
    const models = files.map((gltf, which): Model => {
      gltf.scene.updateMatrixWorld(true);
      const levels: Part[][] = [];
      for (const level of LEVELS) {
        const node = gltf.scene.getObjectByName(level);
        if (!node) break;
        const parts: Part[] = [];
        node.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = mesh.material as THREE.MeshStandardMaterial;
          const from = material.map;
          const address = from ? imageOf(gltf, from, addresses[which]) : '';
          const image = address ? images.get(address) : undefined;
          if (from && !image) throw new Error('picture');
          const key = address ? `${material.name}@${address}` : material.name;
          if (!looks.has(key)) {
            const map = from && image ? textureFor(address, image, from) : null;
            looks.set(key, { key, name: material.name, map, cutoff: material.alphaTest, double: material.side === THREE.DoubleSide, colors: false, rough: material.roughness });
          }
          parts.push({ look: key, geometry: floatGeometry(mesh.geometry, mesh.matrixWorld), color: material.color.clone() });
        });
        levels.push(parts);
      }
      return { name: names[which], levels };
    });
    for (const gltf of files) {
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      });
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
  for (const listener of listeners) listener();
}

function attempt(base: string, kind: Kind): Promise<Loaded | null> {
  const key = `${base} ${kind}`;
  const known = done.get(key);
  if (known) return Promise.resolve(known);
  let run = flying.get(key);
  if (!run) {
    run = loadSet(base, KINDS[kind]).then((result) => {
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

function later(base: string, kind: Kind): void {
  const key = `${base} ${kind}`;
  if (waiting.has(key) || typeof window === 'undefined') return;
  waiting.set(
    key,
    window.setTimeout(() => {
      waiting.delete(key);
      void attempt(base, kind);
    }, RETRY_MS),
  );
}

function build(conifers: boolean): Library | null {
  const memo = `${conifers} ${version}`;
  if (merged.has(memo)) return merged.get(memo) ?? null;
  const models = new Map<string, Model>();
  const looks = new Map<string, Look>();
  const kinds = new Set<Kind>();
  for (const kind of wanted(conifers)) {
    const set = done.get(`${place} ${kind}`);
    if (!set) continue;
    kinds.add(kind);
    for (const model of set.models) models.set(model.name, model);
    for (const look of set.looks) {
      const known = looks.get(look.key);
      if (known) known.colors = known.colors || look.colors;
      else looks.set(look.key, look);
    }
  }
  const library = kinds.size > 0 ? { models, looks, kinds } : null;
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
      attempt(base, kind).then((result) => {
        if (!result) later(base, kind);
      }),
    ),
  );
  return build(conifers);
}

export function peekLibrary(conifers = false): Library | null {
  return place ? build(conifers) : null;
}

export function watchLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function libraryVersion(): number {
  return version;
}

export function releaseLibrary(library: Library | null | undefined): void {
  if (!library) return;
  for (const model of library.models.values()) for (const level of model.levels) for (const part of level) part.geometry.dispose();
  for (const look of library.looks.values()) look.map?.dispose();
}

export function makeMaterial(look: Look): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const shared = { color: 0xffffff, map: look.map, vertexColors: look.colors, side: look.double ? THREE.DoubleSide : THREE.FrontSide };
  const material = TREE_LOOKS.has(look.name) ? new THREE.MeshLambertMaterial(shared) : new THREE.MeshStandardMaterial({ ...shared, roughness: look.rough, metalness: 0 });
  if (look.cutoff > 0) material.alphaTest = look.cutoff;
  material.name = look.key;
  return material;
}
