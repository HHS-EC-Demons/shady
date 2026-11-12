import { SURFACES, SURFACE_ORDER, type Campus, type Ground, type Tree } from './campus';
import { ringDistance } from './geometry';
import { DAY_START, FULL_SUN, STEP, type HeatDay } from './heat';
import { placesOf, type Place } from './places';
import { ellipseSpans } from './raster';
import { LIGHT_UNDER, LOWEST_SUN, treeShadow } from './shade';
import { hourly, type Weather } from './weather';

export const PLAN_FROM = 8 * 60;
export const PLAN_TO = 18 * 60 + 30;
const PLAN_STEP = 30;
const LATTICE = 2;
const SHARE_AFTER_SERVED = 0.6;

type Moment = {
  value: Float32Array;
  sums: Float64Array;
  shiftCol: number;
  shiftRow: number;
  halfCol: number;
  halfRow: number;
  ray: HeatDay['rays'][number];
};

function integrate(value: Float32Array, sums: Float64Array, cols: number, rows: number): void {
  const wide = cols + 1;
  for (let row = 0; row < rows; row += 1) {
    let run = 0;
    for (let col = 0; col < cols; col += 1) {
      run += value[row * cols + col];
      sums[(row + 1) * wide + col + 1] = sums[row * wide + col + 1] + run;
    }
  }
}

function boxSum(sums: Float64Array, cols: number, rows: number, col0: number, row0: number, col1: number, row1: number): number {
  const a = Math.max(0, col0);
  const b = Math.max(0, row0);
  const c = Math.min(cols, col1 + 1);
  const d = Math.min(rows, row1 + 1);
  if (c <= a || d <= b) return 0;
  const wide = cols + 1;
  return sums[d * wide + c] - sums[b * wide + c] - sums[d * wide + a] + sums[b * wide + a];
}

export class Planner {
  private ground: Ground;
  private campus: Campus;
  private moments: Moment[] = [];
  private open: Uint8Array;
  private places: Place[];
  private owner: Int16Array;
  private radius: number;
  private height: number;

  constructor(campus: Campus, ground: Ground, day: HeatDay, weather: Weather, radius: number, height: number) {
    this.campus = campus;
    this.ground = ground;
    this.radius = radius;
    this.height = height;
    const grid = ground.grid;
    const cells = grid.cols * grid.rows;
    const probe: Tree = { x: 0, y: 0, radius, height };
    for (let minute = PLAN_FROM; minute <= PLAN_TO; minute += PLAN_STEP) {
      const step = Math.round((minute - DAY_START) / STEP);
      const ray = day.rays[step];
      if (ray.z <= LOWEST_SUN * 3) continue;
      const power = hourly(weather.sunshine, minute) / FULL_SUN;
      const value = new Float32Array(cells);
      const offset = step * cells;
      for (let index = 0; index < cells; index += 1) {
        if (!ground.home[index]) continue;
        const facts = SURFACES[SURFACE_ORDER[ground.surface[index]]];
        const spare = day.light[offset + index] / 255 - LIGHT_UNDER.tree;
        if (spare > 0) value[index] = facts.use * facts.rise * power * spare;
      }
      const shadow = treeShadow(probe, ray);
      const cos = Math.abs(Math.cos(shadow.angle));
      const sin = Math.abs(Math.sin(shadow.angle));
      const spanX = Math.sqrt(shadow.along * shadow.along * cos * cos + shadow.across * shadow.across * sin * sin);
      const spanY = Math.sqrt(shadow.along * shadow.along * sin * sin + shadow.across * shadow.across * cos * cos);
      const sums = new Float64Array((grid.cols + 1) * (grid.rows + 1));
      integrate(value, sums, grid.cols, grid.rows);
      this.moments.push({
        value,
        sums,
        ray,
        shiftCol: shadow.x / grid.cell,
        shiftRow: shadow.y / grid.cell,
        halfCol: (spanX * 0.886) / grid.cell,
        halfRow: (spanY * 0.886) / grid.cell,
      });
    }
    this.open = new Uint8Array(cells);
    this.places = placesOf(campus, ground);
    this.owner = new Int16Array(cells).fill(-1);
    this.places.forEach((place, index) => {
      for (let i = 0; i < place.cells.length; i += 1) this.owner[place.cells[i]] = index;
    });
    const blocks = campus.blocks.filter((block) => block.home);
    for (let row = 0; row < grid.rows; row += LATTICE) {
      for (let col = 0; col < grid.cols; col += LATTICE) {
        const index = row * grid.cols + col;
        if (!ground.open[index]) continue;
        const x = grid.minX + (col + 0.5) * grid.cell;
        const y = grid.minY + (row + 0.5) * grid.cell;
        if (blocks.some((block) => ringDistance(block.ring, x, y) < radius + 1)) continue;
        this.open[index] = 1;
      }
    }
  }

  block(trees: Tree[]): void {
    for (const tree of trees) this.claim(tree);
  }

  private claim(tree: Tree): void {
    const grid = this.ground.grid;
    const gap = Math.ceil((tree.radius + this.radius) * 0.85 / grid.cell);
    const col = Math.floor((tree.x - grid.minX) / grid.cell);
    const row = Math.floor((tree.y - grid.minY) / grid.cell);
    for (let r = Math.max(0, row - gap); r <= Math.min(grid.rows - 1, row + gap); r += 1) {
      for (let c = Math.max(0, col - gap); c <= Math.min(grid.cols - 1, col + gap); c += 1) {
        if ((r - row) * (r - row) + (c - col) * (c - col) <= gap * gap) this.open[r * grid.cols + c] = 0;
      }
    }
    const gains = new Float64Array(this.places.length);
    for (const moment of this.moments) {
      const shadow = treeShadow(tree, moment.ray);
      ellipseSpans(grid, shadow.x, shadow.y, shadow.along, shadow.across, shadow.angle, (r, from, to) => {
        for (let index = r * grid.cols + from; index <= r * grid.cols + to; index += 1) {
          const place = this.owner[index];
          if (place >= 0) gains[place] += moment.value[index];
          moment.value[index] = 0;
        }
      });
    }
    let served = -1;
    for (let index = 0; index < gains.length; index += 1) {
      if (gains[index] > 0 && (served < 0 || gains[index] > gains[served])) served = index;
    }
    for (const moment of this.moments) {
      if (served >= 0) {
        const cells = this.places[served].cells;
        for (let i = 0; i < cells.length; i += 1) moment.value[cells[i]] *= SHARE_AFTER_SERVED;
      }
      integrate(moment.value, moment.sums, grid.cols, grid.rows);
    }
  }

  next(): Tree | null {
    const grid = this.ground.grid;
    let best = -1;
    let top = 0;
    for (let row = 0; row < grid.rows; row += LATTICE) {
      for (let col = 0; col < grid.cols; col += LATTICE) {
        const index = row * grid.cols + col;
        if (!this.open[index]) continue;
        let score = 0;
        for (const moment of this.moments) {
          const centerCol = col + moment.shiftCol;
          const centerRow = row + moment.shiftRow;
          score += boxSum(
            moment.sums,
            grid.cols,
            grid.rows,
            Math.round(centerCol - moment.halfCol),
            Math.round(centerRow - moment.halfRow),
            Math.round(centerCol + moment.halfCol),
            Math.round(centerRow + moment.halfRow),
          );
        }
        if (score > top) {
          top = score;
          best = index;
        }
      }
    }
    if (best < 0) return null;
    const row = Math.floor(best / grid.cols);
    const col = best - row * grid.cols;
    const tree: Tree = {
      x: grid.minX + (col + 0.5) * grid.cell,
      y: grid.minY + (row + 0.5) * grid.cell,
      radius: this.radius,
      height: this.height,
    };
    this.claim(tree);
    return tree;
  }
}
