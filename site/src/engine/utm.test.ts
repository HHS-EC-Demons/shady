import { describe, expect, it } from 'vitest';
import { fromUtm, toUtm, zoneOf } from './utm';

const pairs = [
  { place: 'Seattle', epsg: 26910, lat: 47.622835, lon: -122.309851, east: 551856, north: 5274612 },
  { place: 'Bethesda', epsg: 26918, lat: 39.001718, lon: -77.129274, east: 315618, north: 4319124 },
  { place: 'Phoenix', epsg: 26912, lat: 33.24937, lon: -112.062624, east: 401012, north: 3679436 },
  { place: 'Frisco', epsg: 26914, lat: 33.191863, lon: -96.81512, east: 703679.4, north: 3674683.8 },
];

describe('UTM', () => {
  it('reads the zone from NAD83 and WGS84 codes', () => {
    expect(zoneOf(26914)).toEqual({ zone: 14, south: false });
    expect(zoneOf(32610)).toEqual({ zone: 10, south: false });
    expect(zoneOf(32756)).toEqual({ zone: 56, south: true });
    expect(zoneOf(4326)).toBeNull();
  });

  for (const pair of pairs) {
    it(`matches a known corner near ${pair.place} within half a metre`, () => {
      const zone = zoneOf(pair.epsg);
      if (!zone) throw new Error('no zone');
      const [east, north] = toUtm(pair.lat, pair.lon, zone);
      expect(Math.hypot(east - pair.east, north - pair.north)).toBeLessThan(0.5);
      const back = fromUtm(pair.east, pair.north, zone);
      expect(Math.abs(back.lat - pair.lat) * 111000).toBeLessThan(0.5);
      expect(Math.abs(back.lon - pair.lon) * 111000 * Math.cos((pair.lat * Math.PI) / 180)).toBeLessThan(0.5);
    });
  }

  it('round trips in the southern hemisphere', () => {
    const zone = { zone: 56, south: true };
    const [east, north] = toUtm(-33.8688, 151.2093, zone);
    const back = fromUtm(east, north, zone);
    expect(Math.abs(back.lat + 33.8688)).toBeLessThan(1e-7);
    expect(Math.abs(back.lon - 151.2093)).toBeLessThan(1e-7);
  });
});
