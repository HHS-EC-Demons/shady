import type { Block, Cover, Tree } from './campus';
import type { Point, Ring } from './geometry';
import { ellipseSpans, polygonSpans, type Grid, type Span } from './raster';
import type { SunRay } from './sun';

export type Sail = { id: number; corners: [Point, Point, Point, Point]; height: number };

export type Obstacles = { blocks: Block[]; trees: Tree[]; sails: Sail[]; covers?: Cover[] };

export const LIGHT_UNDER = { block: 0.08, tree: 0.12, sail: 0.16, cover: 0.1 };
export const COVER_HEIGHT = 3.5;
export const LOWEST_SUN = 0.035;
export const CANOPY_FLATTEN = 0.72;

export function canopyCenter(tree: Tree): number {
  return tree.height - tree.radius * CANOPY_FLATTEN;
}

export function shadowShift(sun: SunRay, height: number): Point {
  return [(-sun.x / sun.z) * height, (-sun.y / sun.z) * height];
}

export function treeShadow(tree: Tree, sun: SunRay): { x: number; y: number; along: number; across: number; angle: number } {
  const [dx, dy] = shadowShift(sun, canopyCenter(tree));
  const tall = tree.radius * CANOPY_FLATTEN;
  const flat = 1 - sun.z * sun.z;
  const along = Math.sqrt(tree.radius * tree.radius * sun.z * sun.z + tall * tall * flat) / sun.z;
  return { x: tree.x + dx, y: tree.y + dy, along, across: tree.radius, angle: Math.atan2(sun.y, sun.x) };
}

export function addShadows(grid: Grid, light: Uint8Array, sun: SunRay, obstacles: Obstacles): void {
  if (sun.z <= LOWEST_SUN) return;
  const dim = (share: number): Span => {
    const value = Math.round(share * 255);
    return (row, from, to) => {
      const base = row * grid.cols;
      for (let index = base + from; index <= base + to; index += 1) {
        if (light[index] > value) light[index] = value;
      }
    };
  };
  const underBlock = dim(LIGHT_UNDER.block);
  const quad: Ring = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  for (const block of obstacles.blocks) {
    const [dx, dy] = shadowShift(sun, block.height);
    const low = Math.min(block.min ?? 0, block.height);
    const [lx, ly] = low > 0 ? shadowShift(sun, low) : [0, 0];
    const ring = block.ring;
    if (low > 0) polygonSpans(grid, ring.map(([x, y]) => [x + lx, y + ly] as Point), underBlock);
    else polygonSpans(grid, ring, underBlock);
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      quad[0][0] = a[0] + lx;
      quad[0][1] = a[1] + ly;
      quad[1][0] = b[0] + lx;
      quad[1][1] = b[1] + ly;
      quad[2][0] = b[0] + dx;
      quad[2][1] = b[1] + dy;
      quad[3][0] = a[0] + dx;
      quad[3][1] = a[1] + dy;
      polygonSpans(grid, quad, underBlock);
    }
  }
  const underCover = dim(LIGHT_UNDER.cover);
  for (const cover of obstacles.covers ?? []) {
    const [dx, dy] = shadowShift(sun, cover.height);
    polygonSpans(
      grid,
      cover.ring.map(([x, y]) => [x + dx, y + dy] as Point),
      underCover,
    );
  }
  const underTree = dim(LIGHT_UNDER.tree);
  for (const tree of obstacles.trees) {
    const shadow = treeShadow(tree, sun);
    ellipseSpans(grid, shadow.x, shadow.y, shadow.along, shadow.across, shadow.angle, underTree);
  }
  const underSail = dim(LIGHT_UNDER.sail);
  for (const sail of obstacles.sails) {
    const [dx, dy] = shadowShift(sun, sail.height);
    polygonSpans(
      grid,
      sail.corners.map(([x, y]) => [x + dx, y + dy] as Point),
      underSail,
    );
  }
}

export function castShadows(grid: Grid, light: Uint8Array, sun: SunRay, obstacles: Obstacles): void {
  light.fill(sun.z <= LOWEST_SUN ? 0 : 255);
  addShadows(grid, light, sun, obstacles);
}
