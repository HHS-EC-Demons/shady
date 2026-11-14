import * as THREE from 'three';
import type { Campus } from '@/engine/campus';
import { roofPhotoOf } from '@/engine/roofs';

export type RoofLayer = { texture: THREE.Texture; box: THREE.Vector4; blocks: number[] };

const MASONRY = 'textures/masonry.webp';
const ANISOTROPY = 4;
const KEEP_ROOFS = 3;

const asked = new Map<string, Promise<THREE.Texture | null>>();
const held = new Map<string, THREE.Texture>();
const roofs: string[] = [];

function base(): string {
  const raw = import.meta.env.BASE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

async function bitmap(path: string, flip: boolean): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const answer = await fetch(path.startsWith('data:') ? path : `${base()}${path}`);
  if (!answer.ok) return null;
  const blob = await answer.blob();
  return createImageBitmap(blob, { imageOrientation: flip ? 'flipY' : 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function forget(path: string): void {
  asked.delete(path);
  held.get(path)?.dispose();
  held.delete(path);
}

function load(path: string, photo: boolean): Promise<THREE.Texture | null> {
  const known = asked.get(path);
  if (known) return known;
  if (photo) {
    roofs.push(path);
    while (roofs.length > KEEP_ROOFS) forget(roofs.shift() as string);
  }
  const made = bitmap(path, photo)
    .then((image) => {
      if (!image) return null;
      const texture = new THREE.Texture(image);
      texture.flipY = false;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = ANISOTROPY;
      texture.colorSpace = photo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = photo ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      texture.wrapT = texture.wrapS;
      texture.needsUpdate = true;
      if (asked.get(path) === made) held.set(path, texture);
      return texture;
    })
    .catch(() => null);
  asked.set(path, made);
  return made;
}

function layerOf(campus: Campus, middle: [number, number], texture: THREE.Texture | null | undefined): RoofLayer | null {
  const photo = roofPhotoOf(campus);
  if (!photo || !texture) return null;
  const box = new THREE.Vector4(photo.minX - middle[0], photo.minY - middle[1], 1 / (photo.maxX - photo.minX), 1 / (photo.maxY - photo.minY));
  return { texture, box, blocks: photo.blocks };
}

export function heldMasonry(): THREE.Texture | null {
  return held.get(MASONRY) ?? null;
}

export function loadMasonry(): Promise<THREE.Texture | null> {
  return load(MASONRY, false);
}

export function roofBlocks(campus: Campus): Set<number> {
  return new Set(roofPhotoOf(campus)?.blocks ?? []);
}

export function heldRoofs(campus: Campus, middle: [number, number]): RoofLayer | null {
  const photo = roofPhotoOf(campus);
  return photo ? layerOf(campus, middle, held.get(photo.src)) : null;
}

export async function loadRoofs(campus: Campus, middle: [number, number]): Promise<RoofLayer | null> {
  const photo = roofPhotoOf(campus);
  if (!photo) return null;
  return layerOf(campus, middle, await load(photo.src, true));
}
