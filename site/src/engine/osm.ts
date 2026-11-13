import { areaOf, boundsOf, covers, padded, plannedBounds, squareArea, touches, type Area, type Bounds, type LatLon } from './area';
import type { Block, Campus, Patch, Strip, Surface, Tree } from './campus';
import { boxOf, insideRing, ringArea, type Point, type Ring } from './geometry';
import { Stopped, firstOf, linked, type Source } from './race';

export type { Bounds } from './area';

type Tags = Record<string, string>;

export type Element = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Tags;
  lat?: number;
  lon?: number;
  geometry?: LatLon[];
  members?: { type: string; role: string; geometry?: LatLon[] }[];
};

export type Found = {
  kind: 'way' | 'relation' | 'node';
  id: number;
  name: string;
  place: string;
  lat: number;
  lon: number;
  extent?: Bounds;
};

type Raw = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Tags;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
};

const OSM_API = 'https://api.openstreetmap.org/api/0.6';

export function assemble(raw: Raw[]): Element[] {
  const nodes = new Map<number, LatLon>();
  const ways = new Map<number, LatLon[]>();
  for (const item of raw) {
    if (item.type === 'node' && item.lat !== undefined && item.lon !== undefined) nodes.set(item.id, { lat: item.lat, lon: item.lon });
  }
  for (const item of raw) {
    if (item.type !== 'way' || !item.nodes) continue;
    const geometry: LatLon[] = [];
    for (const id of item.nodes) {
      const node = nodes.get(id);
      if (node) geometry.push(node);
    }
    if (geometry.length === item.nodes.length) ways.set(item.id, geometry);
  }
  const elements: Element[] = [];
  for (const item of raw) {
    if (item.type === 'node') {
      if (item.tags) elements.push({ type: 'node', id: item.id, tags: item.tags, lat: item.lat, lon: item.lon });
    } else if (item.type === 'way') {
      const geometry = ways.get(item.id);
      if (geometry && item.tags) elements.push({ type: 'way', id: item.id, tags: item.tags, geometry });
    } else if (item.members && item.tags) {
      const members = item.members
        .filter((member) => member.type === 'way' && ways.has(member.ref))
        .map((member) => ({ type: 'way', role: member.role, geometry: ways.get(member.ref) }));
      if (members.length > 0) elements.push({ type: 'relation', id: item.id, tags: item.tags, members });
    }
  }
  return elements;
}

export function outlineQuery(kind: Found['kind'], id: number): string {
  return `[out:json][timeout:20];${kind}(${id});out geom;`;
}

export function campusQuery(bounds: Bounds): string {
  const box = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`;
  const parts = [
    `nwr["building"]${box}`,
    `way["amenity"="parking"]${box}`,
    `nwr["leisure"~"^(pitch|track|playground|swimming_pool|park|garden)$"]${box}`,
    `way["highway"]${box}`,
    `nwr["landuse"~"^(grass|meadow|recreation_ground|village_green)$"]${box}`,
    `nwr["natural"~"^(water|wood|scrub|sand|bare_rock|tree_row)$"]${box}`,
    `node["natural"="tree"]${box}`,
  ];
  return `[out:json][timeout:25];(${parts.join(';')};);out body geom;`;
}

export function projector(center: LatLon): (point: LatLon) => Point {
  const perLat = 110950;
  const perLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
  return (point) => [
    Math.round((point.lon - center.lon) * perLon * 10) / 10,
    Math.round((point.lat - center.lat) * perLat * 10) / 10,
  ];
}

export function unproject(center: LatLon, x: number, y: number): LatLon {
  const perLat = 110950;
  const perLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
  return { lat: center.lat + y / perLat, lon: center.lon + x / perLon };
}

function memberRings(element: Element, inner: boolean): LatLon[][] {
  const rings: LatLon[][] = [];
  const loose: LatLon[][] = [];
  for (const member of element.members ?? []) {
    if (member.type !== 'way' || !member.geometry || (member.role === 'inner') !== inner) continue;
    loose.push([...member.geometry]);
  }
  while (loose.length > 0) {
    const ring = loose.shift() as LatLon[];
    let joined = true;
    while (joined && !same(ring[0], ring[ring.length - 1])) {
      joined = false;
      for (let i = 0; i < loose.length; i += 1) {
        const other = loose[i];
        const end = ring[ring.length - 1];
        if (same(other[0], end)) ring.push(...other.slice(1));
        else if (same(other[other.length - 1], end)) ring.push(...other.reverse().slice(1));
        else continue;
        loose.splice(i, 1);
        joined = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

function outerRings(element: Element): LatLon[][] {
  return [...(element.geometry ? [element.geometry] : []), ...memberRings(element, false)];
}

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

function side(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function edgesOf(ring: Ring): [Point, Point][] {
  return ring.map((point, index) => [point, ring[(index + 1) % ring.length]]);
}

export function withHoles(outer: Ring, holes: Ring[]): Ring {
  let ring = signedArea(outer) < 0 ? [...outer].reverse() : [...outer];
  const shaped = holes
    .filter((hole) => hole.length >= 3)
    .map((hole) => (signedArea(hole) > 0 ? [...hole].reverse() : [...hole]))
    .sort((a, b) => Math.max(...b.map((point) => point[0])) - Math.max(...a.map((point) => point[0])));
  for (const hole of shaped) {
    let pick = 0;
    for (let index = 1; index < hole.length; index += 1) if (hole[index][0] > hole[pick][0]) pick = index;
    const from = hole[pick];
    const walls = [...edgesOf(ring), ...shaped.flatMap(edgesOf)];
    const order = ring.map((_, index) => index).sort((a, b) => Math.hypot(ring[a][0] - from[0], ring[a][1] - from[1]) - Math.hypot(ring[b][0] - from[0], ring[b][1] - from[1]));
    const target = order.find((index) => !walls.some(([c, d]) => crosses(ring[index], from, c, d))) ?? order[0];
    const loop = [...hole.slice(pick), ...hole.slice(0, pick), from];
    ring = [...ring.slice(0, target + 1), ...loop, ring[target], ...ring.slice(target + 1)];
  }
  return ring;
}

function same(a: LatLon, b: LatLon): boolean {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

function closed(ring: LatLon[]): boolean {
  return ring.length > 3 && same(ring[0], ring[ring.length - 1]);
}

function open(ring: Ring): Ring {
  const last = ring[ring.length - 1];
  if (ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1]) return ring.slice(0, -1);
  return ring;
}

const HARD: Record<string, Surface> = {
  asphalt: 'asphalt',
  paved: 'asphalt',
  concrete: 'concrete',
  'concrete:plates': 'concrete',
  paving_stones: 'concrete',
  sett: 'concrete',
  artificial_turf: 'turf',
  grass: 'grass',
  tartan: 'track',
  rubber: 'track',
  acrylic: 'court',
  hard: 'court',
  clay: 'soil',
  dirt: 'soil',
  ground: 'soil',
  earth: 'soil',
  sand: 'soil',
  woodchips: 'soil',
  mulch: 'soil',
  gravel: 'soil',
  fine_gravel: 'soil',
  compacted: 'soil',
};

const COURT_SPORTS = ['tennis', 'basketball', 'pickleball', 'volleyball', 'handball', 'netball', 'futsal', 'padel', 'skateboard'];
const FIELD_SPORTS = ['american_football', 'soccer', 'football', 'rugby', 'lacrosse', 'field_hockey'];

function sports(tags: Tags): string[] {
  return (tags.sport ?? '').split(';').map((value) => value.trim());
}

const ROADS: Record<string, [Surface, number, string]> = {
  service: ['asphalt', 6, 'Driveway'],
  residential: ['asphalt', 8, 'Road'],
  unclassified: ['asphalt', 8, 'Road'],
  tertiary: ['asphalt', 11, 'Road'],
  secondary: ['asphalt', 15, 'Road'],
  primary: ['asphalt', 20, 'Road'],
  trunk: ['asphalt', 24, 'Road'],
  motorway: ['asphalt', 26, 'Road'],
  living_street: ['asphalt', 6, 'Road'],
  footway: ['concrete', 2.2, 'Walkway'],
  path: ['concrete', 2, 'Walkway'],
  pedestrian: ['concrete', 4, 'Walkway'],
  cycleway: ['asphalt', 2.5, 'Bike path'],
  steps: ['concrete', 2.2, 'Steps'],
};

const SPORT_NAMES: [string, string][] = [
  ['tennis', 'Tennis court'],
  ['pickleball', 'Pickleball court'],
  ['basketball', 'Basketball court'],
  ['volleyball', 'Volleyball court'],
  ['marching_band', 'Band pad'],
  ['baseball', 'Ball field'],
  ['softball', 'Ball field'],
  ['american_football', 'Football field'],
  ['soccer', 'Soccer field'],
  ['football', 'Soccer field'],
  ['lacrosse', 'Field'],
  ['rugby', 'Field'],
  ['field_hockey', 'Field'],
];

function pitchName(played: string[]): string {
  for (const [sport, name] of SPORT_NAMES) {
    if (played.includes(sport)) return name;
  }
  return 'Play area';
}

function blockHeight(tags: Tags, area: number, home: boolean): { height: number; guessed: boolean } {
  const tagged = Number.parseFloat(tags.height ?? '');
  if (Number.isFinite(tagged) && tagged > 1) return { height: tagged, guessed: false };
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return { height: Math.round(levels * 4.3 * 10) / 10, guessed: false };
  if (tags.building === 'roof' || tags.building === 'carport') return { height: 3.5, guessed: true };
  if (tags.building === 'grandstand' || tags.building === 'bleachers') return { height: 8, guessed: true };
  if (area > 2500) return { height: home ? 9.5 : 8, guessed: true };
  if (area > 350) return { height: 6.5, guessed: true };
  if (area > 60) return { height: home ? 4 : 5.5, guessed: true };
  return { height: 3, guessed: true };
}

export function buildCampus(name: string, place: string, center: LatLon, outline: LatLon[][], elements: Element[]): Campus {
  const local = projector(center);
  const boundary = outline.filter((ring) => ring.length > 3).map((ring) => open(ring.map(local)));
  const within = (ring: Ring): boolean => {
    if (boundary.length === 0) return true;
    let x = 0;
    let y = 0;
    for (const point of ring) {
      x += point[0];
      y += point[1];
    }
    x /= ring.length;
    y /= ring.length;
    return boundary.some((edge) => insideRing(edge, x, y));
  };
  const patches: Patch[] = [];
  const strips: Strip[] = [];
  const blocks: Block[] = [];
  const trees: Tree[] = [];
  const tracks: Ring[] = [];
  const clear: Ring[] = [];
  const fields: { patch: Patch; tagged: boolean }[] = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === 'node') {
      if (tags.natural === 'tree' && element.lat !== undefined && element.lon !== undefined) {
        const [x, y] = local({ lat: element.lat, lon: element.lon });
        const crown = Number.parseFloat(tags.diameter_crown ?? '');
        const tall = Number.parseFloat(tags.height ?? '');
        const radius = Number.isFinite(crown) && crown > 1 ? crown / 2 : 4;
        trees.push({ x, y, radius, height: Number.isFinite(tall) && tall > 2 ? tall : radius * 2.2 });
      }
      continue;
    }
    const holes = tags.building && element.type === 'relation' ? memberRings(element, true).filter(closed).map((raw) => open(raw.map(local))) : [];
    for (const raw of outerRings(element)) {
      const isClosed = closed(raw);
      const ring = open(raw.map(local));
      if (tags.building && tags.building !== 'no') {
        if (!isClosed || ring.length < 3) continue;
        const inside = holes.filter((hole) => insideRing(ring, hole[0][0], hole[0][1]));
        const shape = inside.length > 0 ? withHoles(ring, inside) : ring;
        const home = within(ring);
        blocks.push({ id: element.id, ring: shape, home, ...blockHeight(tags, ringArea(shape), home) });
        continue;
      }
      if (tags.highway) {
        const road = ROADS[tags.highway];
        if (!road) continue;
        if (isClosed && tags.area === 'yes') {
          patches.push({ surface: HARD[tags.surface ?? ''] ?? road[0], ring, label: 'Plaza' });
          continue;
        }
        const lanes = Number.parseFloat(tags.lanes ?? '');
        const width = Number.parseFloat(tags.width ?? '');
        const wide = Number.isFinite(width) && width > 0.5 ? width : Number.isFinite(lanes) && lanes > 2 ? lanes * 3.5 : road[1];
        strips.push({ surface: HARD[tags.surface ?? ''] ?? road[0], width: wide, line: raw.map(local), label: road[2] });
        continue;
      }
      if (tags.natural === 'tree_row') {
        const line = raw.map(local);
        for (let i = 0; i + 1 < line.length; i += 1) {
          const [ax, ay] = line[i];
          const [bx, by] = line[i + 1];
          const count = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 9));
          for (let k = 0; k < count; k += 1) {
            const share = (k + 0.5) / count;
            trees.push({ x: ax + (bx - ax) * share, y: ay + (by - ay) * share, radius: 3.6, height: 8 });
          }
        }
        continue;
      }
      if (!isClosed || ring.length < 3) continue;
      if (tags.amenity === 'parking') {
        if (tags.parking === 'underground' || tags.parking === 'multi-storey') continue;
        patches.push({ surface: HARD[tags.surface ?? ''] ?? 'asphalt', ring, label: 'Parking lot' });
      } else if (tags.leisure === 'track') {
        if (tags.area === 'yes') patches.push({ surface: HARD[tags.surface ?? ''] ?? 'track', ring, label: 'Track' });
        else {
          strips.push({ surface: 'track', width: 9.8, line: [...ring, ring[0]], label: 'Track' });
          tracks.push(ring);
          clear.push(ring);
        }
      } else if (tags.leisure === 'pitch') {
        const tagged = HARD[tags.surface ?? ''];
        const played = sports(tags);
        let surface: Surface = tagged ?? 'grass';
        if (!tagged && played.some((sport) => COURT_SPORTS.includes(sport))) surface = 'court';
        const patch: Patch = { surface, ring, label: pitchName(played) };
        patches.push(patch);
        clear.push(ring);
        if (played.some((sport) => FIELD_SPORTS.includes(sport))) fields.push({ patch, tagged: Boolean(tagged) });
      } else if (tags.leisure === 'playground') {
        patches.push({ surface: HARD[tags.surface ?? ''] ?? 'soil', ring, label: 'Playground' });
        clear.push(ring);
      } else if (tags.leisure === 'swimming_pool' || tags.natural === 'water') {
        patches.push({ surface: 'water', ring, label: tags.leisure === 'swimming_pool' ? 'Pool' : 'Water' });
      } else if (tags.natural === 'sand' || tags.natural === 'bare_rock') {
        patches.push({ surface: 'soil', ring });
      } else if (tags.landuse || tags.leisure === 'park' || tags.leisure === 'garden' || tags.natural === 'scrub') {
        patches.push({ surface: 'grass', ring });
      } else if (tags.natural === 'wood') {
        patches.push({ surface: 'grass', ring });
        const box = boxOf([ring]);
        for (let x = box.minX + 5; x < box.maxX; x += 11) {
          for (let y = box.minY + 5; y < box.maxY; y += 11) {
            const jx = x + ((x * 7.3 + y * 3.1) % 5) - 2.5;
            const jy = y + ((x * 2.7 + y * 5.9) % 5) - 2.5;
            if (insideRing(ring, jx, jy)) trees.push({ x: jx, y: jy, radius: 4.5, height: 11 });
          }
        }
      }
    }
  }

  for (const field of fields) {
    if (field.tagged) continue;
    const [x, y] = field.patch.ring[0];
    if (tracks.some((ring) => insideRing(ring, x, y))) field.patch.surface = 'turf';
  }

  return { name, place, center, boundary, clear, patches, strips, blocks, trees };
}


type PhotonProperties = {
  osm_type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  extent?: number[];
};

export type PhotonFeature = { geometry?: { coordinates?: number[] }; properties: PhotonProperties };

const PHOTON = 'https://photon.komoot.io/api/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const SCHOOLS = new Set(['school', 'college', 'university', 'kindergarten']);
const NOT_AREAS = new Set(['highway', 'railway', 'waterway', 'place', 'boundary', 'route', 'power', 'barrier', 'aerialway', 'public_transport']);
export const MOST_FOUND = 7;
export const SEARCH_WAIT = 7000;
export const STAGGER = 1200;
export const MAP_BUDGET = 10000;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

export function extentOf(raw: number[] | undefined): Bounds | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((value) => Number.isFinite(value))) return null;
  const [west, north, east, south] = raw;
  return south <= north && west <= east ? { south, west, north, east } : null;
}

export function rankPlaces(features: PhotonFeature[], text: string): Found[] {
  const words = new Set(wordsOf(text));
  const ranked: { found: Found; group: number }[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!p.osm_id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const address = [p.housenumber, p.street].filter(Boolean).join(' ');
    const name = (p.name ?? address).trim();
    if (name === '') continue;
    const extent = extentOf(p.extent);
    const numbered = Boolean(p.housenumber) && wordsOf(p.housenumber ?? '').every((word) => words.has(word));
    const outlined = (p.osm_type === 'W' || p.osm_type === 'R') && extent !== null && !NOT_AREAS.has(p.osm_key ?? '');
    const school = p.osm_key === 'amenity' && SCHOOLS.has(p.osm_value ?? '');
    const group = school ? 0 : p.name && outlined && !numbered ? 1 : 2;
    const area = outlined && group < 2;
    const place = [p.city ?? p.county, p.state ?? p.country].filter(Boolean).join(', ');
    const key = area ? `${p.osm_type}${p.osm_id}` : `${group} ${name.toLowerCase()} ${place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const found: Found =
      area && extent
        ? { kind: p.osm_type === 'R' ? 'relation' : 'way', id: p.osm_id, name, place, lat, lon, extent }
        : { kind: 'node', id: p.osm_id, name, place, lat, lon };
    ranked.push({ found, group });
  }
  return ranked
    .map((item, order) => ({ ...item, order }))
    .sort((a, b) => a.group - b.group || a.order - b.order)
    .slice(0, MOST_FOUND)
    .map((item) => item.found);
}

export async function findPlaces(text: string, signal?: AbortSignal): Promise<Found[]> {
  const controller = new AbortController();
  const unlink = linked(signal, controller);
  const timer = setTimeout(() => controller.abort(new Error('timed out')), SEARCH_WAIT);
  try {
    const answer = await fetch(`${PHOTON}?q=${encodeURIComponent(text)}&limit=15&lang=en`, { signal: controller.signal });
    if (!answer.ok) throw new Error(`The search did not answer (${answer.status})`);
    const body = (await answer.json()) as { features?: PhotonFeature[] };
    return rankPlaces(Array.isArray(body.features) ? body.features : [], text);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

export const findSchools = findPlaces;

const OVERPASS_REST = 5 * 60000;
let overpassRest = 0;

export function overpassResting(now = Date.now()): boolean {
  return now < overpassRest;
}

async function askOverpass(query: string, headers: Record<string, string>, signal: AbortSignal): Promise<Element[]> {
  try {
    const answer = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!answer.ok) throw new Error(`Overpass ${answer.status}`);
    const body = (await answer.json()) as { elements?: Element[]; remark?: string };
    if (!Array.isArray(body.elements) || /error|timed out|out of memory/i.test(body.remark ?? '')) throw new Error(`Overpass ${body.remark ?? 'empty'}`);
    overpassRest = 0;
    return body.elements;
  } catch (error) {
    if (!signal.aborted) overpassRest = Date.now() + OVERPASS_REST;
    throw error;
  }
}

function inTurn<T>(overpass: Source<T>, official: Source<T>): Source<T>[] {
  return overpassResting() ? [official, overpass] : [overpass, official];
}

async function askOfficial(path: string, headers: Record<string, string>, signal: AbortSignal): Promise<Element[]> {
  const answer = await fetch(`${OSM_API}/${path}`, { headers, signal });
  if (!answer.ok) throw new Error(`OpenStreetMap ${answer.status}`);
  const body = (await answer.json()) as { elements?: Raw[] };
  if (!Array.isArray(body.elements)) throw new Error('OpenStreetMap empty');
  return assemble(body.elements);
}

function ringsFor(elements: Element[], found: Found): LatLon[][] {
  const mine = elements.filter((element) => element.type === found.kind && element.id === found.id);
  if (mine.length === 0) throw new Error('The outline is missing');
  return mine.flatMap(outerRings).filter(closed);
}

function outlineSources(found: Found, headers: Record<string, string>): Source<LatLon[][]>[] {
  return inTurn(
    async (signal) => ringsFor(await askOverpass(outlineQuery(found.kind, found.id), headers, signal), found),
    async (signal) => ringsFor(await askOfficial(`${found.kind}/${found.id}/full.json`, headers, signal), found),
  );
}

function contentsSources(box: Bounds, headers: Record<string, string>): Source<Element[]>[] {
  return inTurn(
    (signal) => askOverpass(campusQuery(box), headers, signal),
    (signal) => askOfficial(`map.json?bbox=${box.west},${box.south},${box.east},${box.north}`, headers, signal),
  );
}

const LEISURE = /^(pitch|track|playground|swimming_pool|park|garden)$/;
const LANDUSE = /^(grass|meadow|recreation_ground|village_green)$/;
const NATURAL = /^(water|wood|scrub|sand|bare_rock|tree_row)$/;
const ORDER: Record<Element['type'], number> = { node: 0, way: 1, relation: 2 };

export function relevant(element: Element): boolean {
  const tags = element.tags ?? {};
  if (tags.building !== undefined) return true;
  if (element.type === 'way' && (tags.amenity === 'parking' || tags.highway !== undefined)) return true;
  if (LEISURE.test(tags.leisure ?? '') || LANDUSE.test(tags.landuse ?? '') || NATURAL.test(tags.natural ?? '')) return true;
  return element.type === 'node' && tags.natural === 'tree';
}

function reachOf(element: Element): Bounds | null {
  if (element.type === 'node') {
    if (element.lat === undefined || element.lon === undefined) return null;
    return { south: element.lat, north: element.lat, west: element.lon, east: element.lon };
  }
  const rings: LatLon[][] = [];
  if (element.geometry) rings.push(element.geometry.filter(Boolean));
  for (const member of element.members ?? []) if (member.geometry) rings.push(member.geometry.filter(Boolean));
  return boundsOf(rings);
}

export function tidy(elements: Element[], box: Bounds): Element[] {
  const seen = new Set<string>();
  const kept: Element[] = [];
  for (const element of elements) {
    const key = `${element.type} ${element.id}`;
    if (seen.has(key) || !relevant(element)) continue;
    const reach = reachOf(element);
    if (!reach || !touches(reach, box)) continue;
    seen.add(key);
    kept.push(element);
  }
  return kept.sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.id - b.id);
}

export type LoadOptions = { signal?: AbortSignal; budget?: number; stagger?: number };

function campusOf(found: Found, area: Area, elements: Element[]): Campus {
  return buildCampus(found.name, found.place, area.center, area.rings, elements);
}

export async function loadCampus(found: Found, headers: Record<string, string> = {}, options: LoadOptions = {}): Promise<Campus> {
  const controller = new AbortController();
  const unlink = linked(options.signal, controller);
  const deadline = Date.now() + (options.budget ?? MAP_BUDGET);
  const gap = options.stagger ?? STAGGER;
  const contents = (box: Bounds, signal: AbortSignal) => firstOf(contentsSources(box, headers), gap, deadline, signal);
  try {
    if (found.kind === 'node') {
      const area = squareArea(found);
      const want = padded(area.bounds);
      return campusOf(found, area, tidy(await contents(want, controller.signal), want));
    }
    const guess = plannedBounds(found, found.extent);
    const ahead = new AbortController();
    const unlinkAhead = linked(controller.signal, ahead);
    const early = guess ? contents(padded(guess), ahead.signal) : null;
    early?.catch(() => undefined);
    try {
      const rings = await firstOf(outlineSources(found, headers), gap, deadline, controller.signal);
      const area = areaOf(found, rings);
      const want = padded(area.bounds);
      if (early && guess && covers(padded(guess), want)) return campusOf(found, area, tidy(await early, want));
      ahead.abort(new Stopped('replaced'));
      return campusOf(found, area, tidy(await contents(want, controller.signal), want));
    } finally {
      unlinkAhead();
    }
  } finally {
    controller.abort(new Stopped('done'));
    unlink();
  }
}
