import type { Block, Campus, Patch, Strip, Surface, Tree } from './campus';
import { boxOf, insideRing, ringArea, type Point, type Ring } from './geometry';

type LatLon = { lat: number; lon: number };
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

export type Bounds = { south: number; west: number; north: number; east: number };

export type Found = {
  kind: 'way' | 'relation' | 'node';
  id: number;
  name: string;
  place: string;
  lat: number;
  lon: number;
};

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function overpass(query: string, headers: Record<string, string> = {}): Promise<Element[]> {
  let last = 'no answer';
  for (const mirror of MIRRORS) {
    try {
      const answer = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20000),
      });
      if (answer.ok) return ((await answer.json()) as { elements: Element[] }).elements;
      last = `${answer.status}`;
    } catch (error) {
      last = String(error);
    }
  }
  throw new Error(`The map servers are busy (${last})`);
}

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

async function osmApi(path: string, headers: Record<string, string>): Promise<Element[]> {
  const answer = await fetch(`${OSM_API}/${path}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!answer.ok) throw new Error(`The map did not answer (${answer.status})`);
  return assemble(((await answer.json()) as { elements: Raw[] }).elements);
}

function later<T>(wait: number, run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => run().then(resolve, reject), wait);
  });
}

const BACKUP_AFTER = 5000;

export function outlineQuery(kind: Found['kind'], id: number): string {
  return `[out:json][timeout:30];${kind}(${id});out geom;`;
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
  return `[out:json][timeout:60];(${parts.join(';')};);out body geom;`;
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

function outerRings(element: Element): LatLon[][] {
  const rings: LatLon[][] = [];
  if (element.geometry) rings.push(element.geometry);
  const loose: LatLon[][] = [];
  for (const member of element.members ?? []) {
    if (member.type !== 'way' || !member.geometry || member.role === 'inner') continue;
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
    for (const raw of outerRings(element)) {
      const isClosed = closed(raw);
      const ring = open(raw.map(local));
      if (tags.building && tags.building !== 'no') {
        if (!isClosed || ring.length < 3) continue;
        const home = within(ring);
        blocks.push({ id: element.id, ring, home, ...blockHeight(tags, ringArea(ring), home) });
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

type PhotonAnswer = {
  features: {
    geometry: { coordinates: [number, number] };
    properties: { osm_type?: string; osm_id?: number; name?: string; city?: string; county?: string; state?: string; country?: string };
  }[];
};

export async function findSchools(text: string, signal?: AbortSignal): Promise<Found[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=7&lang=en&osm_tag=amenity:school`;
  const answer = (await (await fetch(url, { signal })).json()) as PhotonAnswer;
  const found: Found[] = [];
  for (const feature of answer.features) {
    const p = feature.properties;
    if (!p.osm_id || !p.name) continue;
    const kind = p.osm_type === 'R' ? 'relation' : p.osm_type === 'W' ? 'way' : 'node';
    found.push({
      kind,
      id: p.osm_id,
      name: p.name,
      place: [p.city ?? p.county, p.state ?? p.country].filter(Boolean).join(', '),
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0],
    });
  }
  return found;
}

export async function loadCampus(found: Found, headers: Record<string, string> = {}): Promise<Campus> {
  let outline: LatLon[][] = [];
  if (found.kind !== 'node') {
    const shape = await Promise.any([
      overpass(outlineQuery(found.kind, found.id), headers),
      later(BACKUP_AFTER, () => osmApi(`${found.kind}/${found.id}/full.json`, headers)),
    ]);
    outline = shape
      .filter((element) => element.type === found.kind && element.id === found.id)
      .flatMap(outerRings)
      .filter(closed);
  }
  const points = outline.flat();
  const reach = 0.0016;
  const bounds: Bounds =
    points.length > 0
      ? {
          south: Math.min(...points.map((point) => point.lat)),
          north: Math.max(...points.map((point) => point.lat)),
          west: Math.min(...points.map((point) => point.lon)),
          east: Math.max(...points.map((point) => point.lon)),
        }
      : { south: found.lat - reach, north: found.lat + reach, west: found.lon - reach * 1.2, east: found.lon + reach * 1.2 };
  const center = { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
  const pad = 0.0007;
  const wide: Bounds = { south: bounds.south - pad, north: bounds.north + pad, west: bounds.west - pad * 1.2, east: bounds.east + pad * 1.2 };
  const elements = await Promise.any([
    overpass(campusQuery(wide), headers),
    later(BACKUP_AFTER, () => osmApi(`map.json?bbox=${wide.west},${wide.south},${wide.east},${wide.north}`, headers)),
  ]);
  return buildCampus(found.name, found.place, center, outline, elements);
}
