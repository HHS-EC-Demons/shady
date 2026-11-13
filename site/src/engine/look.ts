import { extentOf, type Campus, type Tone, type Tree } from './campus';
import { findCanopy, judgeFields, layersOf, type FieldCall, type Layers } from './canopy';
import { photoTone } from './detail';
import { readPhoto } from './naip';
import { polygonSpans } from './raster';

export type Sight = { date: string; bytes: number; seconds: number; trees: Tree[]; fields: FieldCall[]; tones?: (Tone | null)[] };

const ROOF_PIXELS = 12;

export function roofTones(layers: Layers, campus: Campus): (Tone | null)[] {
  const { grid, photo } = layers;
  return campus.blocks.map((block) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    polygonSpans(grid, block.ring, (row, from, to) => {
      for (let index = row * grid.cols + from; index <= row * grid.cols + to; index += 1) {
        if (!photo.seen[index]) continue;
        red += photo.red[index];
        green += photo.green[index];
        blue += photo.blue[index];
        count += 1;
      }
    });
    return count >= ROOF_PIXELS ? photoTone(red / count, green / count, blue / count) : null;
  });
}

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
  const tones = layers ? roofTones(layers, campus) : undefined;
  return {
    date: photo.date,
    bytes: photo.bytes,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    trees: canopy ? canopy.trees : [],
    fields,
    ...(tones ? { tones } : {}),
  };
}
