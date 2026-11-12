import { SURFACES, SURFACE_ORDER, type Ground } from './campus';
import { clamp } from './geometry';
import type { Grid } from './raster';
import { addShadows, castShadows, type Obstacles } from './shade';
import { sunAt, utcFor, type SunRay } from './sun';
import { hourly, type Weather } from './weather';

export const DAY_START = 300;
export const DAY_END = 1260;
export const STEP = 10;
export const STEPS = (DAY_END - DAY_START) / STEP + 1;
export const FULL_SUN = 1000;
export const TOUCH_LIMIT = 120;

const LOW = 30;
const SCALE = 1.25;

export function encode(temperature: number): number {
  return clamp(Math.round((temperature - LOW) * SCALE), 0, 255);
}

export function decode(value: number): number {
  return value / SCALE + LOW;
}

export type Backdrop = { rays: SunRay[]; light: Uint8Array };

export type HeatDay = {
  grid: Grid;
  cells: number;
  temps: Uint8Array;
  light: Uint8Array;
  air: Float32Array;
  rays: SunRay[];
};

export function sunPath(weather: Weather, lat: number, lon: number): SunRay[] {
  const rays: SunRay[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    rays.push(sunAt(lat, lon, utcFor(weather.date, DAY_START + step * STEP, weather.offset)));
  }
  return rays;
}

export function backdropOf(ground: Ground, weather: Weather, lat: number, lon: number, fixed: Obstacles): Backdrop {
  const grid = ground.grid;
  const cells = grid.cols * grid.rows;
  const rays = sunPath(weather, lat, lon);
  const light = new Uint8Array(cells * STEPS);
  for (let step = 0; step < STEPS; step += 1) {
    castShadows(grid, light.subarray(step * cells, (step + 1) * cells), rays[step], fixed);
  }
  return { rays, light };
}

const NOTHING: Obstacles = { blocks: [], trees: [], sails: [] };

export function simulate(ground: Ground, weather: Weather, backdrop: Backdrop, added: Obstacles = NOTHING): HeatDay {
  const grid = ground.grid;
  const cells = grid.cols * grid.rows;
  const temps = new Uint8Array(cells * STEPS);
  const empty = added.blocks.length + added.trees.length + added.sails.length === 0;
  const lightAll = empty ? backdrop.light : backdrop.light.slice();
  const air = new Float32Array(STEPS);
  const now = new Float32Array(cells);
  const rise = new Float32Array(SURFACE_ORDER.length);
  const keep = new Float32Array(SURFACE_ORDER.length);
  SURFACE_ORDER.forEach((name, code) => {
    rise[code] = SURFACES[name].rise / 255;
    keep[code] = Math.exp(-STEP / SURFACES[name].lag);
  });
  const surface = ground.surface;
  for (let step = 0; step < STEPS; step += 1) {
    const minute = DAY_START + step * STEP;
    const outside = hourly(weather.air, minute);
    const power = hourly(weather.sunshine, minute) / FULL_SUN;
    air[step] = outside;
    const offset = step * cells;
    if (!empty) addShadows(grid, lightAll.subarray(offset, offset + cells), backdrop.rays[step], added);
    if (step === 0) now.fill(outside);
    for (let index = 0; index < cells; index += 1) {
      const code = surface[index];
      const settle = outside + rise[code] * power * lightAll[offset + index];
      const value = settle + (now[index] - settle) * keep[code];
      now[index] = value;
      temps[offset + index] = (value - LOW) * SCALE + 0.5;
    }
  }
  return { grid, cells, temps, light: lightAll, air, rays: backdrop.rays };
}

export function stepAt(minute: number): { low: number; high: number; share: number } {
  const at = clamp((minute - DAY_START) / STEP, 0, STEPS - 1);
  const low = Math.floor(at);
  const high = Math.min(STEPS - 1, low + 1);
  return { low, high, share: at - low };
}

export function temperatureAt(day: HeatDay, minute: number, index: number): number {
  const { low, high, share } = stepAt(minute);
  const a = day.temps[low * day.cells + index];
  const b = day.temps[high * day.cells + index];
  return decode(a + (b - a) * share);
}

export function airAt(day: HeatDay, minute: number): number {
  const { low, high, share } = stepAt(minute);
  return day.air[low] + (day.air[high] - day.air[low]) * share;
}

export type Tally = { mean: number; peak: number; hot: number; cells: number };

export function tally(day: HeatDay, ground: Ground, minute: number): Tally {
  const { low, high, share } = stepAt(minute);
  const a = low * day.cells;
  const b = high * day.cells;
  const roof = SURFACES.roof.code;
  const water = SURFACES.water.code;
  const limit = (TOUCH_LIMIT - LOW) * SCALE;
  let sum = 0;
  let peak = 0;
  let hot = 0;
  let count = 0;
  for (let index = 0; index < day.cells; index += 1) {
    if (!ground.home[index]) continue;
    const code = ground.surface[index];
    if (code === roof || code === water) continue;
    const value = day.temps[a + index] + (day.temps[b + index] - day.temps[a + index]) * share;
    sum += value;
    if (value > peak) peak = value;
    if (value >= limit) hot += 1;
    count += 1;
  }
  return {
    mean: count > 0 ? decode(sum / count) : 0,
    peak: decode(peak),
    hot: count > 0 ? hot / count : 0,
    cells: count,
  };
}

export function hottestMinute(day: HeatDay, ground: Ground): number {
  let best = DAY_START;
  let top = -Infinity;
  for (let step = 0; step < STEPS; step += 3) {
    const minute = DAY_START + step * STEP;
    const result = tally(day, ground, minute);
    if (result.mean > top) {
      top = result.mean;
      best = minute;
    }
  }
  return best;
}

export const RAMP: [number, [number, number, number]][] = [
  [70, [201, 224, 217]],
  [88, [219, 230, 207]],
  [102, [235, 230, 189]],
  [116, [243, 214, 160]],
  [130, [240, 185, 138]],
  [144, [232, 148, 120]],
  [158, [213, 112, 95]],
  [176, [169, 74, 72]],
];

export function rampColor(temperature: number): [number, number, number] {
  if (temperature <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i += 1) {
    if (temperature <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const share = (temperature - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * share, c0[1] + (c1[1] - c0[1]) * share, c0[2] + (c1[2] - c0[2]) * share];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function rampTable(): Uint8Array {
  const table = new Uint8Array(256 * 4);
  for (let value = 0; value < 256; value += 1) {
    const [r, g, b] = rampColor(decode(value));
    table[value * 4] = r;
    table[value * 4 + 1] = g;
    table[value * 4 + 2] = b;
    table[value * 4 + 3] = 255;
  }
  return table;
}
