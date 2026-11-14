import type { Campus, RoofPhoto } from './campus';
import { readPhoto } from './naip';
import { homeBox, partBoxes, roofsFrom } from './roofs';

const NATIVE = 0.6;
const COARSE = 1.2;
const HUGE = 360000;

export function roofAim(campus: Campus): number {
  const box = homeBox(campus);
  return box && (box.maxX - box.minX) * (box.maxY - box.minY) > HUGE ? COARSE : NATIVE;
}

export async function readRoofs(campus: Campus, signal?: AbortSignal): Promise<RoofPhoto | null> {
  const box = homeBox(campus);
  if (!box) return null;
  const aim = roofAim(campus);
  const photo = await readPhoto(campus.center, box, signal, aim, aim, partBoxes(campus));
  if (!photo || signal?.aborted) return null;
  return roofsFrom(photo, campus);
}
