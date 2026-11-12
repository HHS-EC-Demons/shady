import { SURFACES, type Campus, type Ground, type Surface } from './campus';
import { DAY_START, STEP, STEPS, TOUCH_LIMIT, decode, stepAt, type HeatDay } from './heat';
import { lineSpans, polygonSpans } from './raster';

export type Place = { label: string; surface: Surface; cells: Int32Array; area: number };

export type PlaceDay = {
  label: string;
  surface: Surface;
  area: number;
  peak: number;
  peakMinute: number;
  hotFrom: number | null;
  hotTo: number | null;
  hotMinutes: number;
};

const PLURAL: Record<string, string> = {
  'Tennis court': 'Tennis courts',
  'Pickleball court': 'Pickleball courts',
  'Basketball court': 'Basketball courts',
  'Volleyball court': 'Volleyball courts',
  'Parking lot': 'Parking lots',
  'Ball field': 'Ball fields',
  'Football field': 'Football fields',
  'Soccer field': 'Soccer fields',
  Walkway: 'Walkways',
  Driveway: 'Driveways',
  Playground: 'Playgrounds',
};

export function placesOf(campus: Campus, ground: Ground): Place[] {
  const grid = ground.grid;
  const groups = new Map<string, { label: string; surface: Surface; count: number; cells: Set<number> }>();
  const group = (label: string, surface: Surface) => {
    const key = label;
    let entry = groups.get(key);
    if (!entry) {
      entry = { label, surface, count: 0, cells: new Set() };
      groups.set(key, entry);
    }
    entry.count += 1;
    return entry;
  };
  const collect = (entry: { cells: Set<number> }, surface: Surface) => (row: number, from: number, to: number) => {
    const code = SURFACES[surface].code;
    for (let index = row * grid.cols + from; index <= row * grid.cols + to; index += 1) {
      if (ground.home[index] && ground.surface[index] === code) entry.cells.add(index);
    }
  };
  for (const patch of campus.patches) {
    if (!patch.label || patch.surface === 'water') continue;
    polygonSpans(grid, patch.ring, collect(group(patch.label, patch.surface), patch.surface));
  }
  for (const strip of campus.strips) {
    if (!strip.label || strip.label === 'Road') continue;
    lineSpans(grid, strip.line, strip.width, collect(group(strip.label, strip.surface), strip.surface));
  }
  const places: Place[] = [];
  for (const entry of groups.values()) {
    if (entry.cells.size < 6) continue;
    places.push({
      label: entry.count > 1 ? (PLURAL[entry.label] ?? entry.label) : entry.label,
      surface: entry.surface,
      cells: Int32Array.from(entry.cells),
      area: entry.cells.size * grid.cell * grid.cell,
    });
  }
  return places.sort((a, b) => b.area - a.area);
}

export function placeDay(place: Place, day: HeatDay): PlaceDay {
  let peak = -Infinity;
  let peakMinute = DAY_START;
  let hotFrom: number | null = null;
  let hotTo: number | null = null;
  let hotMinutes = 0;
  for (let step = 0; step < STEPS; step += 1) {
    const offset = step * day.cells;
    let sum = 0;
    for (let i = 0; i < place.cells.length; i += 1) sum += day.temps[offset + place.cells[i]];
    const mean = decode(sum / place.cells.length);
    const minute = DAY_START + step * STEP;
    if (mean > peak) {
      peak = mean;
      peakMinute = minute;
    }
    if (mean >= TOUCH_LIMIT) {
      if (hotFrom === null) hotFrom = minute;
      hotTo = minute;
      hotMinutes += STEP;
    }
  }
  return { label: place.label, surface: place.surface, area: place.area, peak, peakMinute, hotFrom, hotTo, hotMinutes };
}

const SHADED_BELOW = 128;

export function shadeDistance(ground: Ground, day: HeatDay, minute: number): Float32Array {
  const { cols, rows, cell } = ground.grid;
  const offset = stepAt(minute).low * day.cells;
  const far = 1e9;
  const distance = new Float32Array(cols * rows);
  const roof = SURFACES.roof.code;
  const water = SURFACES.water.code;
  for (let index = 0; index < distance.length; index += 1) {
    const code = ground.surface[index];
    const shaded = ground.home[index] === 1 && code !== roof && code !== water && day.light[offset + index] < SHADED_BELOW;
    distance[index] = shaded ? 0 : far;
  }
  const straight = cell;
  const slant = cell * Math.SQRT2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let best = distance[index];
      if (col > 0) best = Math.min(best, distance[index - 1] + straight);
      if (row > 0) {
        best = Math.min(best, distance[index - cols] + straight);
        if (col > 0) best = Math.min(best, distance[index - cols - 1] + slant);
        if (col < cols - 1) best = Math.min(best, distance[index - cols + 1] + slant);
      }
      distance[index] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const index = row * cols + col;
      let best = distance[index];
      if (col < cols - 1) best = Math.min(best, distance[index + 1] + straight);
      if (row < rows - 1) {
        best = Math.min(best, distance[index + cols] + straight);
        if (col < cols - 1) best = Math.min(best, distance[index + cols + 1] + slant);
        if (col > 0) best = Math.min(best, distance[index + cols - 1] + slant);
      }
      distance[index] = best;
    }
  }
  return distance;
}

export function walkToShade(place: Place, distance: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < place.cells.length; i += 1) sum += distance[place.cells[i]];
  return sum / place.cells.length;
}
