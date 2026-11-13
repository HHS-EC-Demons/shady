import { afterEach, describe, expect, it, vi } from 'vitest';
import { CROP_SIZE, POINT_SIZE, areaOf, clipRing, plannedBounds, ringOf, spanOf, squareAround, squareArea, type LatLon } from './area';
import { CAMPUS_VERSION } from './campus';
import { KEEP_PLACES, PLACE_LIFE, fresh, placeKey, prune, samePlace } from './memory';
import { insideRing, ringArea, type Ring } from './geometry';
import { MOST_FOUND, buildCampus, rankPlaces, tidy, withHoles, type Element, type PhotonFeature } from './osm';
import { firstOf } from './race';
import { addDays, dayAllowed, daySources, lastDay, weatherSource } from './weather';

function feature(properties: PhotonFeature['properties'], lon = -122.3, lat = 47.6): PhotonFeature {
  return { geometry: { coordinates: [lon, lat] }, properties };
}

const center: LatLon = { lat: 40.78, lon: -73.97 };

function metres(a: LatLon, b: LatLon): [number, number] {
  return [(b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110950];
}

describe('place search ranking', () => {
  it('puts schools first, then named areas, then addresses and points', () => {
    const found = rankPlaces(
      [
        feature({ osm_type: 'N', osm_id: 1, osm_key: 'highway', osm_value: 'bus_stop', name: 'Lincoln stop', city: 'Portland', state: 'Oregon' }),
        feature({ osm_type: 'W', osm_id: 2, osm_key: 'leisure', osm_value: 'park', name: 'Lincoln Park', city: 'Portland', state: 'Oregon', extent: [-122.7, 45.53, -122.69, 45.52] }),
        feature({ osm_type: 'W', osm_id: 3, osm_key: 'building', osm_value: 'house', housenumber: '1600', street: 'Main Street', city: 'Portland', state: 'Oregon', extent: [-122.7, 45.53, -122.69, 45.52] }),
        feature({ osm_type: 'W', osm_id: 4, osm_key: 'amenity', osm_value: 'school', name: 'Lincoln High School', city: 'Portland', state: 'Oregon', extent: [-122.692, 45.5198, -122.687, 45.5178] }),
      ],
      'lincoln portland',
    );
    expect(found.map((item) => item.name)).toEqual(['Lincoln High School', 'Lincoln Park', 'Lincoln stop', '1600 Main Street']);
    expect(found[0]).toMatchObject({ kind: 'way', id: 4, place: 'Portland, Oregon' });
    expect(found[0].extent).toEqual({ west: -122.692, north: 45.5198, east: -122.687, south: 45.5178 });
    expect(found[1].kind).toBe('way');
    expect(found[2].kind).toBe('node');
    expect(found[3]).toMatchObject({ kind: 'node', id: 3, name: '1600 Main Street' });
  });

  it('treats a typed house number as an address even when the building has a name', () => {
    const [white] = rankPlaces(
      [feature({ osm_type: 'R', osm_id: 19761182, osm_key: 'office', osm_value: 'government', name: 'White House', housenumber: '1600', street: 'Pennsylvania Avenue Northwest', city: 'Washington', extent: [-77.0369, 38.8978, -77.0363, 38.8975] })],
      '1600 Pennsylvania Avenue Washington',
    );
    expect(white.kind).toBe('node');
    expect(white.extent).toBeUndefined();
    const [named] = rankPlaces(
      [feature({ osm_type: 'R', osm_id: 19761182, osm_key: 'office', osm_value: 'government', name: 'White House', housenumber: '1600', street: 'Pennsylvania Avenue Northwest', city: 'Washington', extent: [-77.0369, 38.8978, -77.0363, 38.8975] })],
      'White House Washington',
    );
    expect(named.kind).toBe('relation');
  });

  it('keeps a school that is only a point, drops duplicates and caps the list', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      feature({ osm_type: 'W', osm_id: 100 + index, osm_key: 'highway', osm_value: 'secondary', name: 'Central Park West', city: 'New York', state: 'New York', extent: [-73.96, 40.8, -73.95, 40.79] }),
    );
    const found = rankPlaces([...many, feature({ osm_type: 'N', osm_id: 7, osm_key: 'amenity', osm_value: 'school', name: 'Hugoton High School', city: 'Hugoton', state: 'Kansas' })], 'x');
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ name: 'Hugoton High School', kind: 'node' });
    const varied = Array.from({ length: 12 }, (_, index) => feature({ osm_type: 'N', osm_id: 200 + index, osm_key: 'shop', osm_value: 'bakery', name: `Bakery ${index}` }));
    expect(rankPlaces(varied, 'bakery')).toHaveLength(MOST_FOUND);
  });

  it('skips results with no id, no position or no name', () => {
    expect(rankPlaces([{ properties: { osm_id: 4, name: 'No position' } }, feature({ osm_type: 'N', osm_key: 'shop', name: 'No id' }), feature({ osm_type: 'N', osm_id: 9 })], 'x')).toEqual([]);
  });
});

describe('square and crop geometry', () => {
  it('makes a 300 m square around a point', () => {
    const area = squareArea(center);
    expect(area.kind).toBe('square');
    expect(area.center).toEqual(center);
    expect(area.rings).toHaveLength(1);
    const [sw, , ne] = area.rings[0];
    const [x0, y0] = metres(center, sw);
    const [x1, y1] = metres(center, ne);
    expect(x0).toBeCloseTo(-POINT_SIZE / 2, 3);
    expect(y0).toBeCloseTo(-POINT_SIZE / 2, 3);
    expect(x1).toBeCloseTo(POINT_SIZE / 2, 3);
    expect(y1).toBeCloseTo(POINT_SIZE / 2, 3);
    expect(spanOf(area.bounds)).toBeCloseTo(POINT_SIZE, 3);
  });

  it('keeps an outline up to 1.5 km as it is', () => {
    const ring = ringOf(squareAround(center, 900));
    const area = areaOf(center, [ring]);
    expect(area.kind).toBe('outline');
    expect(area.rings[0]).toBe(ring);
  });

  it('crops an area wider than 1.5 km to a 1.2 km square around its centre', () => {
    const long = ringOf({ south: center.lat - 0.004, north: center.lat + 0.004, west: center.lon - 0.03, east: center.lon + 0.03 });
    const area = areaOf(center, [long]);
    expect(area.kind).toBe('cropped');
    expect(spanOf(area.bounds)).toBeCloseTo(CROP_SIZE, 0);
    const [width, height] = metres({ lat: area.bounds.south, lon: area.bounds.west }, { lat: area.bounds.north, lon: area.bounds.east });
    expect(width).toBeCloseTo(CROP_SIZE, 0);
    expect(height).toBeCloseTo(0.008 * 110950, 0);
    expect(area.rings[0][0]).toEqual(area.rings[0][area.rings[0].length - 1]);
  });

  it('falls back to the bare square when the crop misses the outline', () => {
    const far = ringOf({ south: center.lat + 0.02, north: center.lat + 0.03, west: center.lon - 0.02, east: center.lon + 0.02 });
    const area = areaOf(center, [far]);
    expect(area.kind).toBe('cropped');
    expect(spanOf(area.bounds)).toBeCloseTo(CROP_SIZE, 0);
  });

  it('uses a square when there is no outline at all', () => {
    expect(areaOf(center, []).kind).toBe('square');
  });

  it('clips a ring to a box and keeps it closed', () => {
    const clipped = clipRing(ringOf({ south: 0, north: 2, west: 0, east: 2 }), { south: 1, north: 3, west: 1, east: 3 });
    expect(clipped[0]).toEqual(clipped[clipped.length - 1]);
    const lats = clipped.map((point) => point.lat);
    const lons = clipped.map((point) => point.lon);
    expect(Math.min(...lats)).toBe(1);
    expect(Math.max(...lats)).toBe(2);
    expect(Math.min(...lons)).toBe(1);
    expect(Math.max(...lons)).toBe(2);
    expect(clipRing(ringOf({ south: 0, north: 1, west: 0, east: 1 }), { south: 5, north: 6, west: 5, east: 6 })).toEqual([]);
  });

  it('plans the map request from the search extent', () => {
    const small = { south: 40.78, north: 40.781, west: -73.971, east: -73.97 };
    expect(plannedBounds(center, small)).toBe(small);
    const wide = { south: 40.76, north: 40.8, west: -73.98, east: -73.95 };
    expect(spanOf(plannedBounds(center, wide) ?? small)).toBeCloseTo(CROP_SIZE, 0);
    expect(plannedBounds(center, undefined)).toBeNull();
  });
});

describe('map answers', () => {
  it('keeps only what the campus uses inside the box, in a fixed order', () => {
    const box = { south: 0, north: 1, west: 0, east: 1 };
    const elements: Element[] = [
      { type: 'way', id: 9, tags: { building: 'yes' }, geometry: [{ lat: 0.5, lon: 0.5 }, { lat: 0.6, lon: 0.6 }] },
      { type: 'way', id: 3, tags: { landuse: 'residential' }, geometry: [{ lat: 0.5, lon: 0.5 }, { lat: 0.6, lon: 0.6 }] },
      { type: 'node', id: 5, tags: { natural: 'tree' }, lat: 0.2, lon: 0.2 },
      { type: 'way', id: 2, tags: { highway: 'service' }, geometry: [{ lat: 2, lon: 2 }, { lat: 3, lon: 3 }] },
      { type: 'way', id: 1, tags: { highway: 'service' }, geometry: [{ lat: -1, lon: 0.5 }, { lat: 2, lon: 0.5 }] },
      { type: 'node', id: 5, tags: { natural: 'tree' }, lat: 0.2, lon: 0.2 },
      { type: 'node', id: 6, tags: { amenity: 'cafe' }, lat: 0.2, lon: 0.2 },
      { type: 'node', id: 7, tags: { amenity: 'bench' }, lat: 0.3, lon: 0.3 },
      { type: 'way', id: 8, tags: { barrier: 'fence' }, geometry: [{ lat: 0.5, lon: 0.5 }, { lat: 0.6, lon: 0.6 }] },
      { type: 'node', id: 10, tags: { barrier: 'fence' }, lat: 0.3, lon: 0.3 },
    ];
    expect(tidy(elements, box).map((element) => `${element.type}${element.id}`)).toEqual(['node5', 'node7', 'way1', 'way8', 'way9']);
  });
});

describe('buildings with holes', () => {
  it('opens the hole of a building like a stadium bowl or a courtyard', () => {
    const outer: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: Ring = [
      [4, 4],
      [4, 6],
      [6, 6],
      [6, 4],
    ];
    const ring = withHoles(outer, [hole]);
    expect(ringArea(ring)).toBeCloseTo(96, 6);
    expect(insideRing(ring, 5, 5)).toBe(false);
    expect(insideRing(ring, 1, 1)).toBe(true);
    expect(insideRing(ring, 2, 8)).toBe(true);
    expect(insideRing(ring, 9, 5)).toBe(true);
  });

  it('keeps the inner ring of a building relation open in the campus', () => {
    const at = (x: number, y: number) => ({ lat: 40 + y / 110950, lon: -100 + x / (111320 * Math.cos((40 * Math.PI) / 180)) });
    const loop = (points: [number, number][]) => [...points, points[0]].map(([x, y]) => at(x, y));
    const campus = buildCampus('Bowl', '', at(0, 0), [], [
      {
        type: 'relation',
        id: 1,
        tags: { building: 'stadium', type: 'multipolygon' },
        members: [
          { type: 'way', role: 'outer', geometry: loop([[-100, -80], [100, -80], [100, 80], [-100, 80]]) },
          { type: 'way', role: 'inner', geometry: loop([[-60, -40], [60, -40], [60, 40], [-60, 40]]) },
        ],
      },
    ]);
    expect(campus.blocks).toHaveLength(1);
    expect(campus.version).toBe(CAMPUS_VERSION);
    const ring = campus.blocks[0].ring;
    expect(ringArea(ring)).toBeCloseTo(200 * 160 - 120 * 80, -2);
    expect(insideRing(ring, 0, 0)).toBe(false);
    expect(insideRing(ring, -90, 0)).toBe(true);
  });
});

describe('remembered places', () => {
  const now = Date.UTC(2026, 10, 12);

  it('expires after 30 days', () => {
    expect(fresh({ at: now - PLACE_LIFE + 1000 }, now)).toBe(true);
    expect(fresh({ at: now - PLACE_LIFE }, now)).toBe(false);
    expect(fresh({ at: now + 3600000 }, now)).toBe(false);
  });

  it('keeps the 20 most recently used and drops stale ones', () => {
    const stamps = Array.from({ length: 25 }, (_, index) => ({ key: `way/${index}`, at: now - 86400000, used: now - index * 1000 }));
    stamps.push({ key: 'way/old', at: now - 40 * 86400000, used: now });
    const dropped = prune(stamps, now);
    expect(dropped).toContain('way/old');
    expect(dropped).toHaveLength(26 - KEEP_PLACES);
    expect(dropped).not.toContain('way/0');
    expect(dropped).toContain('way/24');
  });

  it('keys by map kind and id and checks the place is the same', () => {
    expect(placeKey({ kind: 'relation', id: 42 })).toBe('relation/42');
    expect(samePlace({ lat: 1, lon: 1 }, { lat: 1.001, lon: 0.999 })).toBe(true);
    expect(samePlace({ lat: 1, lon: 1 }, { lat: 1.5, lon: 1 })).toBe(false);
  });
});

describe('day to weather source', () => {
  const today = '2026-11-12';

  it('uses the archive only for days more than 5 days old', () => {
    expect(weatherSource('2026-01-15', today)).toBe('archive');
    expect(weatherSource('1940-01-01', today)).toBe('archive');
    expect(weatherSource('2026-11-06', today)).toBe('archive');
    expect(weatherSource('2026-11-07', today)).toBe('forecast');
    expect(weatherSource(today, today)).toBe('forecast');
    expect(weatherSource('2026-11-26', today)).toBe('forecast');
  });

  it('asks a second service only where it has data', () => {
    const hosts = (date: string) => daySources(date, today).map((url) => new URL(url).host.split('.')[0]);
    expect(hosts('2026-01-15')).toEqual(['archive-api', 'historical-forecast-api']);
    expect(hosts('1950-06-01')).toEqual(['archive-api']);
    expect(hosts('2026-11-10')).toEqual(['api', 'historical-forecast-api']);
    expect(hosts(today)).toEqual(['api']);
    expect(hosts('2026-11-20')).toEqual(['api']);
  });

  it('allows 1940 up to 14 days ahead', () => {
    expect(lastDay(today)).toBe('2026-11-26');
    expect(dayAllowed('1940-01-01', today)).toBe(true);
    expect(dayAllowed('1939-12-31', today)).toBe(false);
    expect(dayAllowed('2026-11-26', today)).toBe(true);
    expect(dayAllowed('2026-11-27', today)).toBe(false);
    expect(dayAllowed('2026-02-30', today)).toBe(false);
    expect(dayAllowed('nonsense', today)).toBe(false);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('staggered sources', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function slow<T>(value: T, after: number, log: string[], name: string, fail = false) {
    return (signal: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        log.push(`start ${name} ${Date.now()}`);
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          if (fail) reject(new Error(name));
          else resolve(value);
        }, after);
        signal.addEventListener('abort', () => {
          if (settled) return;
          clearTimeout(timer);
          log.push(`abort ${name}`);
          reject(new Error('aborted'));
        });
      });
  }

  it('asks the second source after the gap and aborts the loser', async () => {
    vi.useFakeTimers({ now: 0 });
    const log: string[] = [];
    const answer = firstOf([slow('overpass', 5000, log, 'a'), slow('official', 500, log, 'b')], 1200, 11000);
    await vi.advanceTimersByTimeAsync(1800);
    await expect(answer).resolves.toBe('official');
    expect(log).toEqual(['start a 0', 'start b 1200', 'abort a']);
  });

  it('starts the second source at once when the first fails', async () => {
    vi.useFakeTimers({ now: 0 });
    const log: string[] = [];
    const answer = firstOf([slow('x', 100, log, 'a', true), slow('official', 300, log, 'b')], 1200, 11000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(answer).resolves.toBe('official');
    expect(log).toEqual(['start a 0', 'start b 100']);
  });

  it('gives up at the deadline when nothing answers', async () => {
    vi.useFakeTimers({ now: 0 });
    const log: string[] = [];
    const answer = firstOf([slow('a', 60000, log, 'a'), slow('b', 60000, log, 'b')], 1200, 9000);
    const settled = expect(answer).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(9100);
    await settled;
    expect(log).toEqual(['start a 0', 'start b 1200', 'abort a', 'abort b']);
  });

  it('fails as soon as every source has failed', async () => {
    vi.useFakeTimers({ now: 0 });
    const log: string[] = [];
    const answer = firstOf([slow('a', 50, log, 'a', true), slow('b', 50, log, 'b', true)], 1200, 9000);
    const settled = expect(answer).rejects.toThrow('a; b');
    await vi.advanceTimersByTimeAsync(200);
    await settled;
  });
});
