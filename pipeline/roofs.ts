import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Campus } from '../site/src/engine/campus';
import { readPhoto } from '../site/src/engine/naip';
import { dressRoofs, homeBox, partBoxes, ROOF_MUTE, type Mute, type RoofPhoto } from '../site/src/engine/roofs';

type Encoder = (input: Uint8Array, options: { raw: { width: number; height: number; channels: 4 } }) => {
  webp: (options: Record<string, unknown>) => { toFile: (path: string) => Promise<{ size: number }> };
};

const NATIVE = 0.6;

export async function bakeRoofs(campus: Campus, folder: string, name: string, mute: Mute = ROOF_MUTE): Promise<RoofPhoto> {
  const sharp = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'package.json'))('sharp') as Encoder;
  const box = homeBox(campus);
  if (!box) throw new Error('The campus has no buildings for the roof photo');
  let photo = await readPhoto(campus.center, box, undefined, NATIVE, NATIVE, partBoxes(campus));
  if (photo && photo.gsd > NATIVE + 0.01) photo = await readPhoto(campus.center, box, undefined, photo.gsd, photo.gsd, partBoxes(campus));
  if (!photo) throw new Error('The roof photo step found nothing');
  const dressed = dressRoofs(photo, campus.blocks, mute);
  if (!dressed) throw new Error('The roof photo step dressed no roofs');
  const file = `${name}-roofs.webp`;
  const saved = await sharp(dressed.data, { raw: { width: dressed.width, height: dressed.height, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(join(folder, file));
  console.log(JSON.stringify({ roofPhoto: photo.date, cell: photo.cell, width: dressed.width, height: dressed.height, roofs: dressed.blocks.length, bytes: saved.size }));
  return { src: `campus/${file}`, date: photo.date, ...dressed.box, blocks: dressed.blocks };
}
