import { boxOf, grow, insideRing, ringArea, ringDistance, segmentDistance, type Box, type Point, type Ring } from './geometry';
import { ellipseSpans, lineSpans, makeGrid, polygonSpans, type Grid, type Span } from './raster';

export type Surface = 'grass' | 'asphalt' | 'concrete' | 'turf' | 'court' | 'track' | 'soil' | 'water' | 'roof';

export type SurfaceFacts = {
  code: number;
  name: string;
  rise: number;
  lag: number;
  plantable: boolean;
  use: number;
};

export const SURFACES: Record<Surface, SurfaceFacts> = {
  grass: { code: 0, name: 'Grass', rise: 10, lag: 10, plantable: true, use: 1 },
  asphalt: { code: 1, name: 'Asphalt', rise: 45, lag: 45, plantable: false, use: 2 },
  concrete: { code: 2, name: 'Concrete', rise: 24, lag: 55, plantable: false, use: 3 },
  turf: { code: 3, name: 'Turf', rise: 55, lag: 12, plantable: false, use: 3 },
  court: { code: 4, name: 'Court', rise: 40, lag: 40, plantable: false, use: 3 },
  track: { code: 5, name: 'Track', rise: 55, lag: 20, plantable: false, use: 3 },
  soil: { code: 6, name: 'Soil', rise: 35, lag: 25, plantable: true, use: 1 },
  water: { code: 7, name: 'Water', rise: 0, lag: 60, plantable: false, use: 0 },
  roof: { code: 8, name: 'Roof', rise: 0, lag: 30, plantable: false, use: 0 },
};

export function surfaceChoices(surface: Surface): Surface[] {
  if (surface === 'grass' || surface === 'turf' || surface === 'soil') return ['grass', 'turf', 'soil'];
  if (surface === 'asphalt' || surface === 'concrete') return ['asphalt', 'concrete'];
  if (surface === 'court') return ['court', 'asphalt', 'concrete'];
  return [];
}

export const SURFACE_ORDER: Surface[] = ['grass', 'asphalt', 'concrete', 'turf', 'court', 'track', 'soil', 'water', 'roof'];

export type Tone = 'pale' | 'cream' | 'sand' | 'brick' | 'tile' | 'grey' | 'dark' | 'green' | 'blue';
export type RoofShape = 'gabled' | 'hipped' | 'pyramidal' | 'skillion' | 'dome' | 'flat';
export type Patch = { surface: Surface; ring: Ring; label?: string; guessed?: boolean; sport?: string };
export type Strip = { surface: Surface; width: number; line: Ring; label?: string; crossing?: boolean; aisle?: boolean };
export type Block = {
  id: number;
  ring: Ring;
  height: number;
  guessed: boolean;
  home: boolean;
  min?: number;
  levels?: number;
  roof?: RoofShape;
  rise?: number;
  across?: boolean;
  slope?: number;
  wall?: Tone;
  top?: Tone;
  tone?: Tone;
  stand?: boolean;
};
export type Tree = { x: number; y: number; radius: number; height: number; photo?: boolean; needle?: boolean };
export type Sighting = { source: string; date: string; fields: number[] };
export type RoofPhoto = { src: string; date: string; minX: number; minY: number; maxX: number; maxY: number; blocks: number[] };
export type Cover = { id: number; ring: Ring; height: number; home: boolean; solar?: boolean };
export type EdgeKind = 'fence' | 'wall' | 'hedge';
export type Edge = { kind: EdgeKind; line: Ring; height: number };
export type ThingKind = 'flagpole' | 'bench' | 'bikes' | 'lamp' | 'door' | 'main door';
export type Thing = { kind: ThingKind; x: number; y: number };

export const CAMPUS_VERSION = 4;

export type Campus = {
  version?: number;
  name: string;
  place: string;
  center: { lat: number; lon: number };
  boundary: Ring[];
  clear: Ring[];
  patches: Patch[];
  strips: Strip[];
  blocks: Block[];
  trees: Tree[];
  photo?: Sighting;
  covers?: Cover[];
  edges?: Edge[];
  things?: Thing[];
  roofs?: RoofPhoto | null;
};

export function outdated(campus: Campus): boolean {
  return (campus.version ?? 0) < CAMPUS_VERSION;
}

export function mapped(campus: Campus): boolean {
  return campus.blocks.some((block) => block.home) || campus.patches.length > 0;
}

export type Ground = {
  grid: Grid;
  surface: Uint8Array;
  home: Uint8Array;
  open: Uint8Array;
};

export function extentOf(campus: Campus, margin = 70): Box {
  const rings = campus.boundary.length > 0 ? campus.boundary : campus.blocks.filter((block) => block.home).map((block) => block.ring);
  return grow(boxOf(rings), margin);
}

export const FLOATS_ABOVE = 2;

export function floating(block: Block): boolean {
  return (block.min ?? 0) >= FLOATS_ABOVE;
}

export function insideCover(campus: Campus, x: number, y: number, gap = 0): boolean {
  for (const cover of campus.covers ?? []) {
    if (insideRing(cover.ring, x, y) || (gap > 0 && ringDistance(cover.ring, x, y) < gap)) return true;
  }
  return false;
}

export function atHome(campus: Campus, x: number, y: number): boolean {
  if (campus.boundary.length === 0) return true;
  return campus.boundary.some((ring) => insideRing(ring, x, y));
}

export function simCell(campus: Campus, margin = 70): number {
  const box = extentOf(campus, margin);
  return Math.max(2, Math.ceil(Math.max(box.maxX - box.minX, box.maxY - box.minY) / 512));
}

export function rasterize(campus: Campus, cell: number, margin = 70, exact?: Grid): Ground {
  const grid = exact ?? makeGrid(extentOf(campus, margin), cell);
  const size = grid.cols * grid.rows;
  const surface = new Uint8Array(size);
  const home = new Uint8Array(size);
  const paint = (target: Uint8Array, value: number): Span => (row, from, to) => {
    target.fill(value, row * grid.cols + from, row * grid.cols + to + 1);
  };
  if (campus.boundary.length === 0) home.fill(1);
  for (const ring of campus.boundary) polygonSpans(grid, ring, paint(home, 1));
  for (const patch of campus.patches) {
    if (patch.surface === 'grass' || patch.surface === 'soil') polygonSpans(grid, patch.ring, paint(surface, SURFACES[patch.surface].code));
  }
  for (const strip of campus.strips) {
    if (strip.surface !== 'track') lineSpans(grid, strip.line, strip.width, paint(surface, SURFACES[strip.surface].code));
  }
  for (const patch of campus.patches) {
    if (patch.surface === 'asphalt' || patch.surface === 'concrete') polygonSpans(grid, patch.ring, paint(surface, SURFACES[patch.surface].code));
  }
  for (const strip of campus.strips) {
    if (strip.surface === 'track') lineSpans(grid, strip.line, strip.width, paint(surface, SURFACES.track.code));
  }
  for (const patch of campus.patches) {
    if (patch.surface !== 'grass' && patch.surface !== 'soil' && patch.surface !== 'asphalt' && patch.surface !== 'concrete') {
      polygonSpans(grid, patch.ring, paint(surface, SURFACES[patch.surface].code));
    }
  }
  for (const block of campus.blocks) {
    if (!floating(block)) polygonSpans(grid, block.ring, paint(surface, SURFACES.roof.code));
  }
  const open = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    if (home[index] && SURFACES[SURFACE_ORDER[surface[index]]].plantable) open[index] = 1;
  }
  for (const ring of campus.clear ?? []) polygonSpans(grid, ring, paint(open, 0));
  for (const cover of campus.covers ?? []) polygonSpans(grid, cover.ring, paint(open, 0));
  for (const block of campus.blocks) {
    if (floating(block)) polygonSpans(grid, block.ring, paint(open, 0));
  }
  return { grid, surface, home, open };
}

export function placeAt(campus: Campus, x: number, y: number, surface: Surface): string {
  for (let index = campus.patches.length - 1; index >= 0; index -= 1) {
    const patch = campus.patches[index];
    if (patch.label && patch.surface === surface && insideRing(patch.ring, x, y)) return patch.label;
  }
  for (const strip of campus.strips) {
    if (!strip.label || strip.surface !== surface) continue;
    for (let i = 0; i + 1 < strip.line.length; i += 1) {
      const [ax, ay] = strip.line[i];
      const [bx, by] = strip.line[i + 1];
      if (segmentDistance(x, y, ax, ay, bx, by) <= strip.width / 2 + 1) return strip.label;
    }
  }
  return SURFACES[surface].name;
}

export function campusRadius(campus: Campus): number {
  const box = extentOf(campus, 0);
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
}

export function campusMiddle(campus: Campus): Point {
  const box = extentOf(campus, 0);
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}

export function treeAt(trees: Tree[], x: number, y: number): number {
  let best = -1;
  let gap = Infinity;
  trees.forEach((tree, index) => {
    const away = Math.hypot(tree.x - x, tree.y - y);
    if (away <= Math.max(tree.radius, 2) && away < gap) {
      gap = away;
      best = index;
    }
  });
  return best;
}

export function blockArea(block: Block): number {
  return ringArea(block.ring);
}

export { ellipseSpans };
