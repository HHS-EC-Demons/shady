import { TREE_SHAPES } from './forest';

export const MODELS_VERSION = 4;

export type Packed = { buffer: ArrayBuffer; address: string };

type Chunk = {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { primitives?: { material?: number }[] }[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index?: number } } }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
  images?: { uri?: string }[];
};

type Yielding = { yield?: () => Promise<void> };
type Link = { saveData?: boolean; effectiveType?: string };
type Quiet = RequestInit & { priority?: 'low' | 'high' | 'auto' };

const NEEDLES = new Set(TREE_SHAPES.filter((shape) => shape.kind === 'conifer').map((shape) => shape.name));
const SLOW_LINKS = new Set(['slow-2g', '2g', '3g']);
const blobs = new Map<string, Promise<Blob>>();
const files = new Map<string, Promise<ArrayBuffer>>();
const taken = new Set<string>();
let pack: Promise<Packed> | null = null;
let fetching = false;

export function nextTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Yielding }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function blob(address: string, quiet = false): Promise<Blob> {
  return fetch(address, quiet ? ({ priority: 'low' } as Quiet) : undefined).then((answer) => {
    if (!answer.ok) throw new Error('picture');
    return answer.blob();
  });
}

function bytes(address: string, quiet = false): Promise<ArrayBuffer> {
  return fetch(address, quiet ? ({ priority: 'low' } as Quiet) : undefined).then((answer) => {
    if (!answer.ok) throw new Error('model');
    return answer.arrayBuffer();
  });
}

export function takeBytes(address: string): Promise<ArrayBuffer> {
  taken.add(address);
  const known = files.get(address) ?? bytes(address);
  files.delete(address);
  return known;
}

export function slowOf(link: Link | undefined): boolean {
  return link?.saveData === true || SLOW_LINKS.has(link?.effectiveType ?? '');
}

export function slowLink(): boolean {
  return slowOf((globalThis.navigator as (Navigator & { connection?: Link }) | undefined)?.connection);
}

export async function fetchAhead(addresses: readonly string[]): Promise<void> {
  if (fetching || slowLink()) return;
  fetching = true;
  try {
    for (const address of addresses) {
      if (files.has(address) || taken.has(address)) continue;
      const run = bytes(address, true);
      files.set(address, run);
      run.catch(() => files.delete(address));
      const buffer = await run.catch(() => null);
      if (!buffer) continue;
      for (const image of imagesOf(chunkOf(buffer), address)) {
        if (blobs.has(image) || taken.has(image)) continue;
        const picture = blob(image, true);
        blobs.set(image, picture);
        picture.catch(() => blobs.delete(image));
        await picture.catch(() => null);
      }
    }
  } finally {
    fetching = false;
  }
}

function imagesOf(json: Chunk, address: string): string[] {
  return (json.images ?? []).flatMap((image) => (image.uri ? [new URL(image.uri, address).href] : []));
}

export function takeBlob(address: string): Promise<Blob> {
  taken.add(address);
  const known = blobs.get(address) ?? blob(address);
  blobs.delete(address);
  return known;
}

function chunkOf(buffer: ArrayBuffer): Chunk {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('model');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true)))) as Chunk;
}

function prefetch(buffer: ArrayBuffer, address: string): void {
  const json = chunkOf(buffer);
  const wanted = new Set<string>();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined || NEEDLES.has((node.name ?? '').split('@')[0])) continue;
    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      const index = json.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorTexture?.index;
      const texture = index === undefined ? undefined : json.textures?.[index];
      const source = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
      const uri = source === undefined ? undefined : json.images?.[source]?.uri;
      if (uri) wanted.add(new URL(uri, address).href);
    }
  }
  for (const image of wanted) {
    if (blobs.has(image)) continue;
    const run = blob(image);
    run.catch(() => blobs.delete(image));
    blobs.set(image, run);
  }
}

export function earlyPack(base: string): Promise<Packed> {
  if (!pack) {
    const address = new URL(`${base}models/far.glb?v=${MODELS_VERSION}`, window.location.href).href;
    const run = fetch(address)
      .then((answer) => {
        if (!answer.ok) throw new Error('model');
        return answer.arrayBuffer();
      })
      .then((buffer) => {
        void Promise.resolve()
          .then(() => prefetch(buffer, address))
          .catch(() => undefined);
        return { buffer, address };
      });
    run.catch(() => {
      if (pack === run) pack = null;
    });
    pack = run;
  }
  return pack;
}
