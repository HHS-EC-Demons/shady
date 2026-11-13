export type LatLon = { lat: number; lon: number };
export type Bounds = { south: number; west: number; north: number; east: number };
export type Area = { rings: LatLon[][]; bounds: Bounds; center: LatLon; kind: 'outline' | 'square' | 'cropped' };

export const POINT_SIZE = 300;
export const WIDEST = 1500;
export const CROP_SIZE = 1200;
export const PAD = 0.0007;

const PER_LAT = 110950;

function perLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export function squareAround(center: LatLon, size: number): Bounds {
  const half = size / 2;
  const lat = half / PER_LAT;
  const lon = half / perLon(center.lat);
  return { south: center.lat - lat, north: center.lat + lat, west: center.lon - lon, east: center.lon + lon };
}

export function spanOf(bounds: Bounds): number {
  const middle = (bounds.south + bounds.north) / 2;
  return Math.max((bounds.north - bounds.south) * PER_LAT, (bounds.east - bounds.west) * perLon(middle));
}

export function ringOf(bounds: Bounds): LatLon[] {
  return [
    { lat: bounds.south, lon: bounds.west },
    { lat: bounds.south, lon: bounds.east },
    { lat: bounds.north, lon: bounds.east },
    { lat: bounds.north, lon: bounds.west },
    { lat: bounds.south, lon: bounds.west },
  ];
}

export function boundsOf(rings: LatLon[][]): Bounds | null {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      if (point.lat < south) south = point.lat;
      if (point.lat > north) north = point.lat;
      if (point.lon < west) west = point.lon;
      if (point.lon > east) east = point.lon;
    }
  }
  return Number.isFinite(south) ? { south, west, north, east } : null;
}

export function padded(bounds: Bounds, pad = PAD): Bounds {
  return { south: bounds.south - pad, north: bounds.north + pad, west: bounds.west - pad * 1.2, east: bounds.east + pad * 1.2 };
}

export function covers(outer: Bounds, inner: Bounds, slack = 2e-5): boolean {
  return outer.south <= inner.south + slack && outer.north >= inner.north - slack && outer.west <= inner.west + slack && outer.east >= inner.east - slack;
}

export function touches(a: Bounds, b: Bounds): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

export function middleOf(bounds: Bounds): LatLon {
  return { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
}

type Edge = { inside: (point: LatLon) => boolean; cross: (a: LatLon, b: LatLon) => LatLon };

function edges(box: Bounds): Edge[] {
  const atLat = (lat: number) => (a: LatLon, b: LatLon): LatLon => ({ lat, lon: a.lon + ((lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon) });
  const atLon = (lon: number) => (a: LatLon, b: LatLon): LatLon => ({ lat: a.lat + ((lon - a.lon) / (b.lon - a.lon)) * (b.lat - a.lat), lon });
  return [
    { inside: (point) => point.lat >= box.south, cross: atLat(box.south) },
    { inside: (point) => point.lat <= box.north, cross: atLat(box.north) },
    { inside: (point) => point.lon >= box.west, cross: atLon(box.west) },
    { inside: (point) => point.lon <= box.east, cross: atLon(box.east) },
  ];
}

export function clipRing(ring: LatLon[], box: Bounds): LatLon[] {
  let points = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon ? ring.slice(0, -1) : ring.slice();
  for (const edge of edges(box)) {
    if (points.length === 0) break;
    const next: LatLon[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      const now = edge.inside(current);
      const before = edge.inside(previous);
      if (now) {
        if (!before) next.push(edge.cross(previous, current));
        next.push(current);
      } else if (before) {
        next.push(edge.cross(previous, current));
      }
    }
    points = next;
  }
  if (points.length < 3) return [];
  return [...points, points[0]];
}

export function squareArea(center: LatLon): Area {
  const bounds = squareAround(center, POINT_SIZE);
  return { rings: [ringOf(bounds)], bounds, center, kind: 'square' };
}

export function plannedBounds(center: LatLon, extent: Bounds | undefined): Bounds | null {
  if (!extent) return null;
  return spanOf(extent) > WIDEST ? squareAround(center, CROP_SIZE) : extent;
}

export function areaOf(center: LatLon, rings: LatLon[][]): Area {
  const bounds = boundsOf(rings);
  if (!bounds) return squareArea(center);
  if (spanOf(bounds) <= WIDEST) return { rings, bounds, center: middleOf(bounds), kind: 'outline' };
  const square = squareAround(center, CROP_SIZE);
  const clipped = rings.map((ring) => clipRing(ring, square)).filter((ring) => ring.length >= 4);
  const kept = clipped.length > 0 ? clipped : [ringOf(square)];
  const box = boundsOf(kept) ?? square;
  return { rings: kept, bounds: box, center: middleOf(box), kind: 'cropped' };
}
