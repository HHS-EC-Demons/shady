import { squareAround, type Bounds, type LatLon } from './area';
import { SURFACES, extentOf as campusExtent, type Campus, type Ground } from './campus';
import { DAY_START, STEP, tally, type HeatDay } from './heat';
import { extentOf, type Found, type PhotonFeature } from './osm';

export const MOST_SCHOOLS = 48;
export const MOST_DISTRICTS = 7;
export const PHOTO_SCHOOLS = 12;
export const FRAME_SIDE = 96;
export const FIRST_HOUR = 8;
export const LAST_HOUR = 18;
export const HOURS = LAST_HOUR - FIRST_HOUR + 1;
export const DISTRICT_LIFE = 30 * 86400000;
export const NODE_SPAN = 6000;
export const FRAME_MARGIN = 6;

const SQUARE_FEET = 10.7639;
const PHOTON = 'https://photon.komoot.io/api/';
const PLACE_KINDS = new Set(['city', 'town', 'village', 'county', 'district', 'borough', 'suburb', 'municipality', 'city_district']);

export type Listed = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  center?: { lat: number; lon: number };
};

export type Footprint = { ring: number[]; height: number };

export type Summary = {
  share: number;
  hourly: number[];
  hot: number;
  area: number;
  top: number;
  peak: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  frames: Uint8Array;
  mask: Uint8Array;
  blocks: Footprint[];
  photo: boolean;
};

export type Status = 'waiting' | 'loading' | 'done' | 'failed' | 'unmapped';

export type Row = { school: Found; status: Status; summary?: Summary; looked?: boolean };

export function hasMap(campus: Campus): boolean {
  return campus.blocks.some((block) => block.home) || campus.patches.length > 0;
}

export function schoolKey(place: { kind: string; id: number }): string {
  return `${place.kind}/${place.id}`;
}

export function districtSearch(text: string): string {
  return `${PHOTON}?q=${encodeURIComponent(text)}&limit=15&lang=en&layer=city&layer=county&layer=district`;
}

export function schoolSearch(word: string, box: Bounds): string {
  return `${PHOTON}?q=${encodeURIComponent(word)}&bbox=${box.west},${box.south},${box.east},${box.north}&osm_tag=amenity:school&limit=50&lang=en`;
}

export function rankDistricts(features: PhotonFeature[]): Found[] {
  const kept: Found[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const name = (p.name ?? '').trim();
    if (!p.osm_id || !Number.isFinite(lat) || !Number.isFinite(lon) || name === '') continue;
    if (!PLACE_KINDS.has(p.osm_value ?? '') && !(p.osm_key === 'boundary' && p.osm_value === 'administrative')) continue;
    const kind: Found['kind'] = p.osm_type === 'R' ? 'relation' : p.osm_type === 'W' ? 'way' : 'node';
    const place = [p.state, p.country].filter((part) => part && part !== name).join(', ');
    const id = `${kind}${p.osm_id}`;
    const same = `${name.toLowerCase()} ${place}`;
    if (seen.has(id) || seen.has(same)) continue;
    seen.add(id);
    seen.add(same);
    kept.push({ kind, id: p.osm_id, name, place, lat, lon, extent: extentOf(p.extent) ?? squareAround({ lat, lon }, NODE_SPAN) });
    if (kept.length >= MOST_DISTRICTS) break;
  }
  return kept;
}

export function placeLabel(place: Found): string {
  const state = place.place.split(', ')[0];
  return state ? `${place.name}, ${state}` : place.name;
}

export function schoolQuery(place: Found, byArea = place.kind === 'relation'): string {
  const where = byArea ? '(area.a)' : `(${place.extent ? [place.extent.south, place.extent.west, place.extent.north, place.extent.east].join(',') : ''})`;
  const head = byArea ? `area(${3600000000 + place.id})->.a;` : '';
  return `[out:json][timeout:25];${head}(way["amenity"="school"]${where};relation["amenity"="school"]${where};);out tags bb;`;
}

function normal(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function areaOf(box: Bounds): number {
  return Math.max(0, box.north - box.south) * Math.max(0, box.east - box.west);
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

function unique(schools: Found[]): Found[] {
  const sorted = [...schools].sort((a, b) => areaOf(b.extent as Bounds) - areaOf(a.extent as Bounds));
  const kept: Found[] = [];
  const ids = new Set<string>();
  for (const school of sorted) {
    const key = schoolKey(school);
    if (ids.has(key)) continue;
    const name = normal(school.name);
    if (kept.some((other) => normal(other.name) === name && overlaps(other.extent as Bounds, school.extent as Bounds))) continue;
    ids.add(key);
    kept.push(school);
  }
  return kept;
}

export function schoolsFromOverpass(elements: Listed[], label: string): Found[] {
  const found: Found[] = [];
  for (const element of elements) {
    if (element.type !== 'way' && element.type !== 'relation') continue;
    const name = (element.tags?.name ?? '').trim();
    const bounds = element.bounds;
    if (name === '' || !bounds || ![bounds.minlat, bounds.minlon, bounds.maxlat, bounds.maxlon].every(Number.isFinite)) continue;
    const extent: Bounds = { south: bounds.minlat, west: bounds.minlon, north: bounds.maxlat, east: bounds.maxlon };
    const lat = element.center?.lat ?? (extent.south + extent.north) / 2;
    const lon = element.center?.lon ?? (extent.west + extent.east) / 2;
    found.push({ kind: element.type, id: element.id, name, place: label, lat, lon, extent });
  }
  return unique(found);
}

export function schoolsFromPhoton(features: PhotonFeature[], label: string): Found[] {
  const found: Found[] = [];
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const name = (p.name ?? '').trim();
    const extent = extentOf(p.extent);
    if (!p.osm_id || name === '' || !extent || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if ((p.osm_type !== 'W' && p.osm_type !== 'R') || p.osm_key !== 'amenity' || p.osm_value !== 'school') continue;
    found.push({ kind: p.osm_type === 'R' ? 'relation' : 'way', id: p.osm_id, name, place: label, lat, lon, extent });
  }
  return unique(found);
}

export function metresBetween(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = (b.lat - a.lat) * 110950;
  return Math.hypot(x, y);
}

export function nearest(schools: Found[], center: LatLon, most = MOST_SCHOOLS): Found[] {
  return schools
    .map((school, order) => ({ school, order, away: metresBetween(center, school) }))
    .sort((a, b) => a.away - b.away || a.order - b.order)
    .slice(0, most)
    .map((item) => item.school);
}

export function countLine(shown: number, total: number): string {
  if (total > shown) return `${shown} of ${total} schools`;
  return `${shown} ${shown === 1 ? 'school' : 'schools'}`;
}

const RANK: Record<Status, number> = { done: 0, loading: 1, waiting: 1, failed: 2, unmapped: 2 };

export function ordered(rows: Row[]): Row[] {
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => {
      const rank = RANK[a.row.status] - RANK[b.row.status];
      if (rank !== 0) return rank;
      if (a.row.summary && b.row.summary) return b.row.summary.share - a.row.summary.share || b.row.summary.hot - a.row.summary.hot || a.order - b.order;
      return a.order - b.order;
    })
    .map((item) => item.row);
}

export function alive(at: number, now: number): boolean {
  return Number.isFinite(at) && at <= now + 60000 && now - at < DISTRICT_LIFE;
}

export function percentOf(share: number): number {
  return Math.round(share * 100);
}

export function hourPlace(minute: number): number {
  return Math.min(HOURS - 1, Math.max(0, minute / 60 - FIRST_HOUR));
}

export function shareAt(summary: Summary, minute: number): number {
  const at = hourPlace(minute);
  const low = Math.floor(at);
  const high = Math.min(HOURS - 1, low + 1);
  return summary.hourly[low] + (summary.hourly[high] - summary.hourly[low]) * (at - low);
}

export function photoPicks(rows: Row[], most = PHOTO_SCHOOLS): Found[] {
  const left = most - rows.filter((row) => row.looked).length;
  if (left <= 0) return [];
  return ordered(rows)
    .filter((row) => row.status === 'done' && row.summary)
    .slice(0, most)
    .filter((row) => !row.summary?.photo && !row.looked)
    .slice(0, left)
    .map((row) => row.school);
}

export type Link = { saveData?: boolean; effectiveType?: string };

export function slowLink(link: Link | undefined): boolean {
  if (!link) return false;
  return link.saveData === true || ['slow-2g', '2g', '3g'].includes(link.effectiveType ?? '');
}

export function fillGaps(values: Float32Array, known: Uint8Array, cols: number, rows: number): void {
  const size = cols * rows;
  let total = 0;
  let count = 0;
  for (let index = 0; index < size; index += 1) {
    if (!known[index]) continue;
    total += values[index];
    count += 1;
  }
  const mean = count > 0 ? total / count : 0;
  const seen = known.slice();
  for (let pass = 0; pass < 6; pass += 1) {
    const next = seen.slice();
    let changed = false;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        if (seen[index]) continue;
        let sum = 0;
        let near = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const r = row + dy;
            const c = col + dx;
            if (r < 0 || c < 0 || r >= rows || c >= cols || !seen[r * cols + c]) continue;
            sum += values[r * cols + c];
            near += 1;
          }
        }
        if (near === 0) continue;
        values[index] = sum / near;
        next[index] = 1;
        changed = true;
      }
    }
    seen.set(next);
    if (!changed) break;
  }
  for (let index = 0; index < size; index += 1) if (!seen[index]) values[index] = mean;
}

export type Crop = { col: number; row: number; cols: number; rows: number; step: number };

export function cropOf(campus: Campus, ground: Ground): Crop {
  const grid = ground.grid;
  const box = campusExtent(campus, FRAME_MARGIN);
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((box.minX - grid.minX) / grid.cell)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((box.minY - grid.minY) / grid.cell)));
  const endCol = Math.min(grid.cols, Math.max(col + 1, Math.ceil((box.maxX - grid.minX) / grid.cell)));
  const endRow = Math.min(grid.rows, Math.max(row + 1, Math.ceil((box.maxY - grid.minY) / grid.cell)));
  const cols = endCol - col;
  const rows = endRow - row;
  return { col, row, cols, rows, step: Math.max(1, Math.ceil(Math.max(cols, rows) / FRAME_SIDE)) };
}

export function framesOf(day: HeatDay, ground: Ground, crop: Crop): { cols: number; rows: number; frames: Uint8Array; mask: Uint8Array } {
  const grid = ground.grid;
  const { step } = crop;
  const cols = Math.ceil(crop.cols / step);
  const rows = Math.ceil(crop.rows / step);
  const size = cols * rows;
  const mask = new Uint8Array(size);
  const frames = new Uint8Array(size * HOURS);
  const roof = SURFACES.roof.code;
  const values = new Float32Array(size);
  const known = new Uint8Array(size);
  for (let hour = 0; hour < HOURS; hour += 1) {
    const offset = ((FIRST_HOUR + hour) * 60 - DAY_START) / STEP * day.cells;
    values.fill(0);
    known.fill(0);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        let sum = 0;
        let count = 0;
        let inside = 0;
        let all = 0;
        for (let dy = 0; dy < step; dy += 1) {
          const gridRow = crop.row + row * step + dy;
          if (gridRow >= crop.row + crop.rows) break;
          for (let dx = 0; dx < step; dx += 1) {
            const gridCol = crop.col + col * step + dx;
            if (gridCol >= crop.col + crop.cols) break;
            const index = gridRow * grid.cols + gridCol;
            all += 1;
            if (!ground.home[index]) continue;
            inside += 1;
            if (ground.surface[index] === roof) continue;
            sum += day.temps[offset + index];
            count += 1;
          }
        }
        const at = row * cols + col;
        if (hour === 0) mask[at] = all > 0 ? Math.round((inside / (step * step)) * 255) : 0;
        if (count > 0) {
          values[at] = sum / count;
          known[at] = 1;
        }
      }
    }
    fillGaps(values, known, cols, rows);
    const frame = frames.subarray(hour * size, (hour + 1) * size);
    for (let index = 0; index < size; index += 1) frame[index] = Math.min(255, Math.max(1, Math.round(values[index])));
  }
  return { cols, rows, frames, mask };
}

export function summarize(campus: Campus, ground: Ground, day: HeatDay, peak: number): Summary {
  const grid = ground.grid;
  const at = tally(day, ground, peak);
  const hourly: number[] = [];
  for (let hour = FIRST_HOUR; hour <= LAST_HOUR; hour += 1) hourly.push(tally(day, ground, hour * 60).hot);
  const crop = cropOf(campus, ground);
  const { cols, rows, frames, mask } = framesOf(day, ground, crop);
  const minX = grid.minX + crop.col * grid.cell;
  const minY = grid.minY + crop.row * grid.cell;
  const blocks = campus.blocks
    .filter((block) => block.home && block.ring.length >= 3)
    .map((block) => ({
      ring: block.ring.flatMap(([x, y]) => [Math.round((x - minX) * 10) / 10, Math.round((y - minY) * 10) / 10]),
      height: Math.round(block.height * 10) / 10,
    }));
  return {
    share: at.hot,
    hourly,
    hot: Math.round(at.hot * at.cells * grid.cell * grid.cell * SQUARE_FEET),
    area: Math.round(at.cells * grid.cell * grid.cell * SQUARE_FEET),
    top: Math.round(at.peak),
    peak,
    cols,
    rows,
    width: cols * crop.step * grid.cell,
    depth: rows * crop.step * grid.cell,
    frames,
    mask,
    blocks,
    photo: Boolean(campus.photo),
  };
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EMPTY = new Set([101, 103, 204, 205, 304]);

export function hostOf(input: RequestInfo | URL, base = 'http://localhost/'): string {
  const text = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(text, base).host;
  } catch {
    return '';
  }
}

export type Tally = Map<string, { requests: number; bytes: number }>;

export function gate(run: Fetch, counts: Tally = new Map(), base?: string): Fetch {
  const tails = new Map<string, Promise<void>>();
  return (input, init) => {
    const host = hostOf(input, base);
    const before = tails.get(host) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const tail = before.then(() => mine);
    tails.set(host, tail);
    void tail.then(() => {
      if (tails.get(host) === tail) tails.delete(host);
    });
    return before.then(async () => {
      try {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const count = counts.get(host) ?? { requests: 0, bytes: 0 };
        count.requests += 1;
        counts.set(host, count);
        const answer = await run(input, init);
        const body = EMPTY.has(answer.status) ? null : await answer.arrayBuffer();
        count.bytes += body?.byteLength ?? 0;
        return new Response(body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
      } finally {
        release();
      }
    });
  };
}
