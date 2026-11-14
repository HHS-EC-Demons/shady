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

const NEEDLES = new Set(TREE_SHAPES.filter((shape) => shape.kind === 'conifer').map((shape) => shape.name));
const blobs = new Map<string, Promise<Blob>>();
let pack: Promise<Packed> | null = null;

function blob(address: string): Promise<Blob> {
  return fetch(address).then((answer) => {
    if (!answer.ok) throw new Error('picture');
    return answer.blob();
  });
}

export function takeBlob(address: string): Promise<Blob> {
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
