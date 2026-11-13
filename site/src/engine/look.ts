import { extentOf, type Campus, type Tree } from './campus';
import { findCanopy, judgeFields, layersOf, type FieldCall } from './canopy';
import { readPhoto } from './naip';

export type Sight = { date: string; bytes: number; seconds: number; trees: Tree[]; fields: FieldCall[] };

const READ_MARGIN = 25;
const MOST_AREA = 2.5e6;

export async function look(campus: Campus, signal?: AbortSignal): Promise<Sight | null> {
  const started = performance.now();
  const box = extentOf(campus, READ_MARGIN);
  if ((box.maxX - box.minX) * (box.maxY - box.minY) > MOST_AREA) return null;
  const photo = await readPhoto(campus.center, box, signal);
  if (!photo || signal?.aborted) return null;
  const layers = layersOf(photo, campus);
  const canopy = layers ? findCanopy(layers, campus) : null;
  const fields = layers ? judgeFields(layers, campus) : [];
  return {
    date: photo.date,
    bytes: photo.bytes,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    trees: canopy ? canopy.trees : [],
    fields,
  };
}
