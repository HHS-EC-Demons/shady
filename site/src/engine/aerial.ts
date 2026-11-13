import { atHome, type Campus, type Tree } from './campus';
import type { Sight } from './look';
import { askSight } from './remote';

export type Enrich = { wait?: number; inline?: boolean; onSight?: (sight: Sight) => void };

export const PHOTO_SOURCE = 'USDA NAIP';
const WAIT = 8000;
const MOST_TREES = 800;
const SAME_TREE = 3;
const REACH = { south: 24.4, north: 49.5, west: -125, east: -66.8 };

export function covered(center: { lat: number; lon: number }): boolean {
  return center.lat >= REACH.south && center.lat <= REACH.north && center.lon >= REACH.west && center.lon <= REACH.east;
}

export function mergeTrees(campus: Campus, seen: Tree[]): Tree[] {
  const kept = campus.trees.filter((tree) => !seen.some((found) => Math.hypot(found.x - tree.x, found.y - tree.y) < Math.max(SAME_TREE, found.radius)));
  const all = [...kept, ...seen];
  if (all.length <= MOST_TREES) return all;
  return all
    .map((tree, order) => ({ tree, order, home: atHome(campus, tree.x, tree.y) }))
    .sort((a, b) => Number(b.home) - Number(a.home) || b.tree.radius - a.tree.radius || a.order - b.order)
    .slice(0, MOST_TREES)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.tree);
}

export function applySight(campus: Campus, sight: Sight): Campus {
  const calls = new Map(sight.fields.map((call) => [call.patch, call.surface]));
  const patches = campus.patches.map((patch, index) => {
    const surface = calls.get(index);
    return surface && surface !== patch.surface ? { ...patch, surface } : patch;
  });
  const tones = sight.tones;
  const blocks =
    tones && tones.length === campus.blocks.length
      ? campus.blocks.map((block, index) => {
          const tone = tones[index];
          return tone && !block.top ? { ...block, tone } : block;
        })
      : campus.blocks;
  return {
    ...campus,
    trees: mergeTrees(campus, sight.trees),
    patches,
    blocks,
    photo: { source: PHOTO_SOURCE, date: sight.date, fields: sight.fields.map((call) => call.patch) },
  };
}

function within<T>(wait: number, signal: AbortSignal | undefined, run: (inner: AbortSignal) => Promise<T | null>): Promise<T | null> {
  const control = new AbortController();
  return new Promise((resolve) => {
    const stop = () => {
      control.abort();
      resolve(null);
    };
    const timer = setTimeout(stop, wait);
    signal?.addEventListener('abort', stop, { once: true });
    run(control.signal).then(
      (value) => resolve(control.signal.aborted ? null : value),
      () => resolve(null),
    ).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    });
  });
}

async function sightOf(campus: Campus, signal: AbortSignal, options: Enrich): Promise<Sight | null> {
  if (!options.inline) {
    const remote = await askSight(campus, signal);
    if (remote !== undefined) return remote;
  }
  if (signal.aborted) return null;
  const { look } = await import('./look');
  return look(campus, signal);
}

export async function enrich(campus: Campus, signal?: AbortSignal, options: Enrich = {}): Promise<Campus> {
  try {
    if (campus.photo || !covered(campus.center) || signal?.aborted) return campus;
    const sight = await within(options.wait ?? WAIT, signal, (inner) => sightOf(campus, inner, options));
    if (!sight) return campus;
    options.onSight?.(sight);
    return applySight(campus, sight);
  } catch {
    return campus;
  }
}
