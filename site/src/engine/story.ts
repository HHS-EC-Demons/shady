import { SURFACES, rasterize, simCell, type Campus, type Ground, type Tree } from './campus';
import { planCost } from './cost';
import { ringDistance, type Point } from './geometry';
import { treeHeight, treeRadius } from './growth';
import { TOUCH_LIMIT, airAt, backdropOf, decode, hottestMinute, simulate, stepAt, type HeatDay } from './heat';
import { placeDay, placesOf, type Place } from './places';
import { Planner } from './planner';
import { cellCenter, polygonSpans } from './raster';
import { shadowShift, type Sail } from './shade';
import { sunAt, utcFor } from './sun';
import type { Weather } from './weather';

export type Story = {
  school: string;
  date: string;
  peak: number;
  air: number;
  place: string;
  placePeak: number;
  anchor: Point;
  place2: string;
  anchor2: Point;
  shade2Before: Point;
  shade2After: Point;
  walk2Before: number;
  walk2After: number;
  sail: Sail;
  sailCooler: number;
  sailCost: { low: number; high: number };
  focus3: Point;
  span3: number;
  place5: string;
  anchor5: Point;
  early: number;
  earlyTemp: number;
  lateTemp: number;
  years: number;
  trees: Tree[];
  cost: { low: number; high: number };
};

const QUIET = ['Driveways', 'Driveway', 'Walkways', 'Walkway', 'Parking lots', 'Parking lot', 'Steps', 'Plaza', 'Bike path'];
const PATHS = ['Driveways', 'Driveway', 'Walkways', 'Walkway', 'Steps', 'Bike path', 'Road'];
const UNSEEN = /track|field|pitch/i;
const STAGE = 'Band pad';
const SHADED_BELOW = 128;
const FEET = 3.28084;
const SAIL_WIDE = 12;
const SAIL_DEEP = 9;
const SAIL_HIGH = 4.5;
const SAIL_GAP = 7;
const SAIL_SEARCH = 60;
const EARLY = 8 * 60;
const MID_MORNING = 10 * 60;

function anchorOf(place: Place, ground: Ground): Point {
  let x = 0;
  let y = 0;
  for (let i = 0; i < place.cells.length; i += 1) {
    const [cx, cy] = cellCenter(ground.grid, place.cells[i]);
    x += cx;
    y += cy;
  }
  x /= place.cells.length;
  y /= place.cells.length;
  let best: Point = [x, y];
  let gap = Infinity;
  for (let i = 0; i < place.cells.length; i += 1) {
    const [cx, cy] = cellCenter(ground.grid, place.cells[i]);
    const distance = Math.hypot(cx - x, cy - y);
    if (distance < gap) {
      gap = distance;
      best = [cx, cy];
    }
  }
  return best;
}

export function nearestShade(ground: Ground, day: HeatDay, minute: number, from: Point, skip?: Place): { at: Point; distance: number } {
  const offset = stepAt(minute).low * day.cells;
  const roof = SURFACES.roof.code;
  const water = SURFACES.water.code;
  const own = new Set<number>(skip ? Array.from(skip.cells) : []);
  let best: Point = from;
  let gap = Infinity;
  for (let index = 0; index < day.cells; index += 1) {
    if (!ground.home[index] || day.light[offset + index] >= SHADED_BELOW) continue;
    const code = ground.surface[index];
    if (code === roof || code === water || own.has(index)) continue;
    const [x, y] = cellCenter(ground.grid, index);
    const distance = Math.hypot(x - from[0], y - from[1]);
    if (distance < gap) {
      gap = distance;
      best = [x, y];
    }
  }
  return { at: best, distance: gap };
}

function sailSpot(campus: Campus, ground: Ground, place: Place, anchor: Point): Point {
  const grid = ground.grid;
  const own = new Set<number>(Array.from(place.cells));
  const roof = SURFACES.roof.code;
  const water = SURFACES.water.code;
  const rings = campus.blocks.filter((block) => block.home).map((block) => block.ring);
  const reach = Math.ceil(SAIL_SEARCH / grid.cell);
  const col0 = Math.floor((anchor[0] - grid.minX) / grid.cell);
  const row0 = Math.floor((anchor[1] - grid.minY) / grid.cell);
  const spots: { index: number; distance: number }[] = [];
  for (let row = Math.max(0, row0 - reach); row <= Math.min(grid.rows - 1, row0 + reach); row += 1) {
    for (let col = Math.max(0, col0 - reach); col <= Math.min(grid.cols - 1, col0 + reach); col += 1) {
      const index = row * grid.cols + col;
      if (!ground.home[index] || own.has(index)) continue;
      const code = ground.surface[index];
      if (code === roof || code === water) continue;
      const [x, y] = cellCenter(grid, index);
      const distance = Math.hypot(x - anchor[0], y - anchor[1]);
      if (distance <= SAIL_SEARCH) spots.push({ index, distance });
    }
  }
  spots.sort((a, b) => a.distance - b.distance);
  for (const spot of spots) {
    const [x, y] = cellCenter(grid, spot.index);
    if (rings.every((ring) => ringDistance(ring, x, y) >= SAIL_GAP)) return [x, y];
  }
  return anchor;
}

function sailAround(center: Point): Sail {
  const [x, y] = center;
  const w = SAIL_WIDE / 2;
  const d = SAIL_DEEP / 2;
  return {
    id: 1,
    corners: [
      [x - w, y - d],
      [x + w, y - d],
      [x + w, y + d],
      [x - w, y + d],
    ],
    height: SAIL_HIGH,
  };
}

function sailDrop(ground: Ground, bare: HeatDay, shaded: HeatDay, sail: Sail, minute: number): number {
  const { low } = stepAt(minute);
  const offset = low * bare.cells;
  const [dx, dy] = shadowShift(bare.rays[low], sail.height);
  const ring = sail.corners.map(([x, y]) => [x + dx, y + dy] as Point);
  const grid = ground.grid;
  let drop = 0;
  polygonSpans(grid, ring, (row, from, to) => {
    for (let index = row * grid.cols + from; index <= row * grid.cols + to; index += 1) {
      if (!ground.home[index]) continue;
      const gap = decode(bare.temps[offset + index]) - decode(shaded.temps[offset + index]);
      if (gap > drop) drop = gap;
    }
  });
  return drop;
}

function earlyMinute(campus: Campus, weather: Weather): number {
  const up = (minute: number) => sunAt(campus.center.lat, campus.center.lon, utcFor(weather.date, minute, weather.offset)).z > 0;
  if (up(EARLY)) return EARLY;
  let rise = EARLY;
  while (rise < MID_MORNING && !up(rise)) rise += 1;
  return Math.ceil((rise + 60) / 10) * 10;
}

function meanAt(place: Place, day: HeatDay, minute: number): number {
  const offset = stepAt(minute).low * day.cells;
  let sum = 0;
  for (let i = 0; i < place.cells.length; i += 1) sum += day.temps[offset + place.cells[i]];
  return decode(sum / place.cells.length);
}

function plantFocus(trees: Tree[], anchors: { at: Point; open: boolean }[]): { focus: Point; span: number } {
  if (trees.length === 0) return { focus: [0, 0], span: 40 };
  const groups = anchors.map(() => [] as Tree[]);
  for (const tree of trees) {
    let best = -1;
    let gap = Infinity;
    anchors.forEach(({ at: [x, y] }, index) => {
      const distance = Math.hypot(tree.x - x, tree.y - y);
      if (distance < gap) {
        gap = distance;
        best = index;
      }
    });
    if (best >= 0) groups[best].push(tree);
  }
  const largest = groups.reduce<Tree[]>((top, group, index) => (anchors[index].open && group.length > top.length ? group : top), []);
  const chosen = largest.length > 0 ? largest : trees;
  const x = chosen.reduce((sum, tree) => sum + tree.x, 0) / chosen.length;
  const y = chosen.reduce((sum, tree) => sum + tree.y, 0) / chosen.length;
  const span = chosen.reduce((top, tree) => Math.max(top, Math.hypot(tree.x - x, tree.y - y) + tree.radius), 20);
  return { focus: [x, y], span };
}

const told = new Map<string, Story>();

export function tellStory(campus: Campus, weather: Weather, count = 30, years = 20): Story {
  const key = `${campus.name} ${weather.date} ${count} ${years}`;
  const kept = told.get(key);
  if (kept) return kept;
  const story = composeStory(campus, weather, count, years);
  told.set(key, story);
  return story;
}

function composeStory(campus: Campus, weather: Weather, count: number, years: number): Story {
  const ground = rasterize(campus, simCell(campus));
  const backdrop = backdropOf(ground, weather, campus.center.lat, campus.center.lon, { blocks: campus.blocks, trees: campus.trees, sails: [] });
  const bare = simulate(ground, weather, backdrop);
  const peak = hottestMinute(bare, ground);
  const places = placesOf(campus, ground);
  const scored = places
    .map((place) => ({ place, report: placeDay(place, bare) }))
    .sort((a, b) => b.report.peak - a.report.peak);
  const ranked = scored.filter((item) => !UNSEEN.test(item.place.label));
  const active = ranked.filter((item) => !QUIET.includes(item.place.label));
  const star = ranked.find((item) => !PATHS.includes(item.place.label)) ?? ranked[0];
  const middle: Point = star ? anchorOf(star.place, ground) : cellCenter(ground.grid, Math.floor((ground.grid.cols * ground.grid.rows) / 2));

  const walks = active
    .filter((item) => item.place.label !== star?.place.label)
    .map((item) => {
      const anchor = anchorOf(item.place, ground);
      return { item, anchor, shade: nearestShade(ground, bare, peak, anchor, item.place) };
    })
    .filter((walk) => Number.isFinite(walk.shade.distance))
    .sort((a, b) => b.shade.distance - a.shade.distance);
  const hot = walks.find((walk) => walk.item.report.peak >= TOUCH_LIMIT);
  const second = hot ?? walks[0] ?? (star ? { item: star, anchor: middle, shade: nearestShade(ground, bare, peak, middle, star.place) } : null);
  const anchor2: Point = second ? second.anchor : middle;
  const before2 = second ? second.shade : { at: middle, distance: 0 };

  const sail = sailAround(second ? sailSpot(campus, ground, second.item.place, anchor2) : anchor2);
  const sailed = simulate(ground, weather, backdrop, { blocks: [], trees: [], sails: [sail] });
  const after2 = nearestShade(ground, sailed, peak, anchor2, second?.item.place);

  const planner = new Planner(campus, ground, sailed, weather, treeRadius(years), treeHeight(years));
  const trees: Tree[] = [];
  for (let index = 0; index < count; index += 1) {
    const tree = planner.next();
    if (!tree) break;
    trees.push(tree);
  }
  const others = scored
    .filter((item) => !QUIET.includes(item.place.label) && item.place !== second?.item.place)
    .map((item) => ({ at: anchorOf(item.place, ground), open: !UNSEEN.test(item.place.label) }));
  const { focus, span } = plantFocus(trees, others.length > 0 ? others : [{ at: middle, open: true }]);

  const early = earlyMinute(campus, weather);
  const fifth = ranked.find((item) => item.place.label === STAGE)?.place ?? second?.item.place ?? star?.place;
  const anchor5: Point = fifth ? anchorOf(fifth, ground) : middle;
  const round = (meters: number) => (Number.isFinite(meters) ? Math.round((meters * FEET) / 5) * 5 : 0);
  return {
    school: campus.name,
    date: weather.date,
    peak,
    air: Math.round(airAt(bare, peak)),
    place: star ? star.place.label : 'Ground',
    placePeak: star ? Math.round(star.report.peak) : 0,
    anchor: middle,
    place2: second ? second.item.place.label : 'Ground',
    anchor2,
    shade2Before: before2.at,
    shade2After: after2.at,
    walk2Before: round(before2.distance),
    walk2After: round(after2.distance),
    sail,
    sailCooler: Math.round(sailDrop(ground, bare, sailed, sail, peak)),
    sailCost: planCost(0, [sail]),
    focus3: focus,
    span3: span,
    place5: fifth ? fifth.label : 'Ground',
    anchor5,
    early,
    earlyTemp: fifth ? Math.round(meanAt(fifth, bare, early)) : 0,
    lateTemp: fifth ? Math.round(meanAt(fifth, bare, peak)) : 0,
    years,
    trees,
    cost: planCost(trees.length, []),
  };
}
