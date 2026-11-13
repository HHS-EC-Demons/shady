import { unproject } from './osm';
import { toUtm, zoneOf, type Zone } from './utm';

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export type Photo = {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  red: Uint8Array;
  green: Uint8Array;
  blue: Uint8Array;
  nir: Uint8Array;
  seen: Uint8Array;
  date: string;
  gsd: number;
  bytes: number;
  seconds: number;
  items: string[];
};

type Item = {
  id: string;
  date: string;
  year: number;
  epsg: number;
  gsd: number;
  href: string;
  ring: [number, number][];
};

type Feature = {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  assets?: Record<string, { href?: string }>;
};

const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const MOST_ITEMS = 4;
const AIM = 1.25;

function inside(ring: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function itemOf(feature: Feature): Item | null {
  const props = feature.properties ?? {};
  const href = feature.assets?.image?.href;
  const date = typeof props.datetime === 'string' ? props.datetime.slice(0, 10) : '';
  const code = typeof props['proj:code'] === 'string' ? /^EPSG:(\d+)$/.exec(props['proj:code']) : null;
  const epsg = Number(props['proj:epsg'] ?? code?.[1]);
  const gsd = Number(props.gsd);
  const coords = feature.geometry?.type === 'Polygon' ? (feature.geometry.coordinates as [number, number][][] | undefined) : undefined;
  const ring = coords?.[0];
  if (!href || !/^https:\/\/[a-z0-9.-]+\.blob\.core\.windows\.net\//.test(href) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!zoneOf(epsg) || !Number.isFinite(gsd) || gsd <= 0 || !Array.isArray(ring) || ring.length < 4) return null;
  return { id: String(feature.id ?? href), date, year: Number(date.slice(0, 4)), epsg, gsd, href, ring };
}

export function chooseItems(features: Feature[], west: number, south: number, east: number, north: number): Item[] {
  const items = features.map(itemOf).filter((item): item is Item => item !== null);
  const years = [...new Set(items.map((item) => item.year))].sort((a, b) => b - a);
  const probes: [number, number][] = [];
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) probes.push([west + ((east - west) * i) / 4, south + ((north - south) * j) / 4]);
  }
  for (const year of years) {
    const same = items.filter((item) => item.year === year).sort((a, b) => (a.date < b.date ? 1 : -1));
    const chosen: Item[] = [];
    let covered = true;
    for (const [x, y] of probes) {
      if (chosen.some((item) => inside(item.ring, x, y))) continue;
      const next = same.find((item) => inside(item.ring, x, y));
      if (!next) {
        covered = false;
        break;
      }
      chosen.push(next);
    }
    if (covered && chosen.length > 0 && chosen.length <= MOST_ITEMS) return chosen;
  }
  return [];
}

export async function searchItems(west: number, south: number, east: number, north: number, signal?: AbortSignal): Promise<Item[]> {
  const url = `${STAC}?collections=naip&bbox=${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}&limit=24&sortby=-datetime`;
  const answer = await fetch(url, { signal });
  if (!answer.ok) throw new Error(`The photo index did not answer (${answer.status})`);
  const body = (await answer.json()) as { features?: Feature[] };
  return chooseItems(body.features ?? [], west, south, east, north);
}

type Sampler = {
  zone: Zone;
  originX: number;
  originY: number;
  res: number;
  left: number;
  top: number;
  width: number;
  height: number;
  data: Uint8Array;
};

function sample(sampler: Sampler, east: number, north: number, out: Uint8Array): boolean {
  const px = (east - sampler.originX) / sampler.res - sampler.left - 0.5;
  const py = (sampler.originY - north) / sampler.res - sampler.top - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= sampler.width || y0 + 1 >= sampler.height) return false;
  const fx = px - x0;
  const fy = py - y0;
  const data = sampler.data;
  const a = (y0 * sampler.width + x0) * 4;
  const b = a + 4;
  const c = a + sampler.width * 4;
  const d = c + 4;
  if (data[a] + data[a + 1] + data[a + 2] + data[a + 3] === 0 || data[d] + data[d + 1] + data[d + 2] + data[d + 3] === 0) return false;
  for (let band = 0; band < 4; band += 1) {
    const top = data[a + band] + (data[b + band] - data[a + band]) * fx;
    const bottom = data[c + band] + (data[d + band] - data[c + band]) * fx;
    out[band] = Math.round(top + (bottom - top) * fy);
  }
  return true;
}

type Counter = { bytes: number };

async function openSampler(item: Item, center: { lat: number; lon: number }, box: Box, counter: Counter, signal?: AbortSignal): Promise<Sampler | null> {
  const zone = zoneOf(item.epsg);
  if (!zone) return null;
  const { fromCustomClient, BaseClient, BaseResponse } = await import('geotiff');
  class Counted extends BaseResponse {
    constructor(private readonly response: Response) {
      super();
    }
    get status(): number {
      return this.response.status;
    }
    getHeader(name: string): string | undefined {
      return this.response.headers.get(name) ?? undefined;
    }
    async getData(): Promise<ArrayBuffer> {
      const data = await this.response.arrayBuffer();
      counter.bytes += data.byteLength;
      return data;
    }
  }
  class Client extends BaseClient {
    async request(options: RequestInit = {}): Promise<Counted> {
      return new Counted(await fetch(this.url, { headers: options.headers, signal: options.signal ?? signal }));
    }
  }
  const tiff = await fromCustomClient(new Client(item.href), { allowFullFile: false }, signal);
  const base = await tiff.getImage(0);
  const [originX, originY] = base.getOrigin();
  const [baseRes] = base.getResolution();
  let wanted = 0;
  while (baseRes * 2 ** (wanted + 1) <= AIM) wanted += 1;
  let image = base;
  for (let level = wanted; level > 0; level -= 1) {
    try {
      image = await tiff.getImage(level);
      break;
    } catch {
      image = base;
    }
  }
  const res = (baseRes * base.getWidth()) / image.getWidth();
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const [x, y] of [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ]) {
    const { lat, lon } = unproject(center, x, y);
    const [east, north] = toUtm(lat, lon, zone);
    minE = Math.min(minE, east);
    maxE = Math.max(maxE, east);
    minN = Math.min(minN, north);
    maxN = Math.max(maxN, north);
  }
  const left = Math.max(0, Math.floor((minE - originX) / res) - 2);
  const top = Math.max(0, Math.floor((originY - maxN) / res) - 2);
  const right = Math.min(image.getWidth(), Math.ceil((maxE - originX) / res) + 2);
  const bottom = Math.min(image.getHeight(), Math.ceil((originY - minN) / res) + 2);
  if (right - left < 2 || bottom - top < 2) return null;
  const raster = await image.readRasters({ window: [left, top, right, bottom], interleave: true, signal });
  const data = raster instanceof Uint8Array ? raster : Uint8Array.from(raster as ArrayLike<number>);
  if (image.getSamplesPerPixel() < 4 || data.length !== (right - left) * (bottom - top) * 4) return null;
  return { zone, originX, originY, res, left, top, width: right - left, height: bottom - top, data };
}

export async function readPhoto(center: { lat: number; lon: number }, box: Box, signal?: AbortSignal, cell = 1): Promise<Photo | null> {
  const started = performance.now();
  const corners = [unproject(center, box.minX, box.minY), unproject(center, box.maxX, box.maxY)];
  const items = await searchItems(corners[0].lon, corners[0].lat, corners[1].lon, corners[1].lat, signal);
  if (items.length === 0) return null;
  const counter: Counter = { bytes: 0 };
  const opened = await Promise.all(items.map(async (item) => ({ item, sampler: await openSampler(item, center, box, counter, signal) })));
  const used = opened.filter((entry) => entry.sampler !== null).map((entry) => entry.item);
  const samplers = opened.map((entry) => entry.sampler).filter((sampler): sampler is Sampler => sampler !== null);
  if (samplers.length === 0) return null;
  const cols = Math.max(1, Math.round((box.maxX - box.minX) / cell));
  const rows = Math.max(1, Math.round((box.maxY - box.minY) / cell));
  const size = cols * rows;
  const red = new Uint8Array(size);
  const green = new Uint8Array(size);
  const blue = new Uint8Array(size);
  const nir = new Uint8Array(size);
  const seen = new Uint8Array(size);
  const pixel = new Uint8Array(4);
  const zones = samplers.map((sampler) => {
    const at = (x: number, y: number) => {
      const { lat, lon } = unproject(center, x, y);
      return toUtm(lat, lon, sampler.zone);
    };
    const o = at(box.minX, box.minY);
    const ex = at(box.minX + 100, box.minY);
    const ey = at(box.minX, box.minY + 100);
    return { o, ex: [(ex[0] - o[0]) / 100, (ex[1] - o[1]) / 100], ey: [(ey[0] - o[0]) / 100, (ey[1] - o[1]) / 100] };
  });
  for (let row = 0; row < rows; row += 1) {
    const dy = (row + 0.5) * cell;
    for (let col = 0; col < cols; col += 1) {
      const dx = (col + 0.5) * cell;
      const index = row * cols + col;
      for (let which = 0; which < samplers.length; which += 1) {
        const map = zones[which];
        const east = map.o[0] + map.ex[0] * dx + map.ey[0] * dy;
        const north = map.o[1] + map.ex[1] * dx + map.ey[1] * dy;
        if (!sample(samplers[which], east, north, pixel)) continue;
        red[index] = pixel[0];
        green[index] = pixel[1];
        blue[index] = pixel[2];
        nir[index] = pixel[3];
        seen[index] = 1;
        break;
      }
    }
  }
  return {
    minX: box.minX,
    minY: box.minY,
    cell,
    cols,
    rows,
    red,
    green,
    blue,
    nir,
    seen,
    date: used.map((item) => item.date).sort()[used.length - 1],
    gsd: Math.max(...samplers.map((sampler) => sampler.res)),
    bytes: counter.bytes,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    items: used.map((item) => item.id),
  };
}
