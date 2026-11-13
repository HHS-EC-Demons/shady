import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SURFACES, rasterize, type Campus } from './campus';
import { materialTone, photoTone, roofShape, toneOf, bearing, bufferLine } from './detail';
import type { Ring } from './geometry';
import { backdropOf, fixedOf, openCampus, simulate, tally, temperatureAt } from './heat';
import { buildCampus, relevant, type Element } from './osm';
import { Planner } from './planner';
import { cellAt } from './raster';
import { castShadows, LIGHT_UNDER } from './shade';
import { applySight } from './aerial';
import type { Layers } from './canopy';
import { roofTones } from './look';
import { diamondOf, homeCorners, layoutOf, sportOf } from './sports';
import { sunAt, utcFor } from './sun';
import type { Weather } from './weather';

const flatDay: Weather = {
  date: '2026-08-24',
  zone: 'America/Chicago',
  offset: -300,
  air: Array.from({ length: 24 }, () => 100),
  sunshine: Array.from({ length: 24 }, (_value, hour) => (hour >= 8 && hour <= 18 ? 1000 : 0)),
  wind: Array.from({ length: 24 }, () => 5),
  source: 'test',
};

const lot: Ring = [
  [-50, -50],
  [0, -50],
  [0, 50],
  [-50, 50],
];

function lotCampus(withCover: boolean): Campus {
  const campus: Campus = {
    name: 'Test',
    place: '',
    center: { lat: 33.178, lon: -96.754 },
    boundary: [
      [
        [-60, -60],
        [60, -60],
        [60, 60],
        [-60, 60],
      ],
    ],
    clear: [],
    patches: [{ surface: 'asphalt', ring: lot, label: 'Parking lot' }],
    strips: [],
    blocks: [],
    trees: [],
  };
  if (withCover) {
    campus.covers = [
      {
        id: 7,
        ring: [
          [-40, -20],
          [-10, -20],
          [-10, 20],
          [-40, 20],
        ],
        height: 3.5,
        home: true,
      },
    ];
  }
  return campus;
}

describe('covers already there', () => {
  const noon = sunAt(33.178, -96.754, utcFor('2026-08-24', 13 * 60 + 29, -300));

  it('casts shade like a sail of its own outline', () => {
    const campus = lotCampus(true);
    const ground = rasterize(campus, 1);
    const light = new Uint8Array(ground.grid.cols * ground.grid.rows);
    castShadows(ground.grid, light, noon, fixedOf(campus));
    expect(light[cellAt(ground.grid, -25, 0)]).toBe(Math.round(LIGHT_UNDER.cover * 255));
    expect(light[cellAt(ground.grid, 30, 0)]).toBe(255);
  });

  it('keeps the real ground under it and counts it as shaded ground', () => {
    const bare = lotCampus(false);
    const covered = lotCampus(true);
    const before = openCampus(bare, flatDay);
    const after = openCampus(covered, flatDay);
    const under = cellAt(after.ground.grid, -25, 0);
    expect(after.ground.surface[under]).toBe(SURFACES.asphalt.code);
    const minute = 13 * 60 + 30;
    expect(tally(after.bare, after.ground, minute).cells).toBe(tally(before.bare, before.ground, minute).cells);
    expect(temperatureAt(before.bare, minute, under) - temperatureAt(after.bare, minute, under)).toBeGreaterThan(30);
    expect(tally(after.bare, after.ground, minute).hot).toBeLessThan(tally(before.bare, before.ground, minute).hot);
  });

  it('never lets the planner plant inside a cover', () => {
    const campus = lotCampus(true);
    campus.patches = [];
    const ground = rasterize(campus, 2);
    const day = simulate(ground, flatDay, backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, fixedOf(campus)));
    const planner = new Planner(campus, ground, day, flatDay, 4, 8);
    for (let index = 0; index < 12; index += 1) {
      const tree = planner.next();
      if (!tree) break;
      expect(tree.x > -40 && tree.x < -10 && tree.y > -20 && tree.y < 20).toBe(false);
    }
    expect(ground.open[cellAt(ground.grid, -25, 0)]).toBe(0);
  });

  it('turns roofs without walls into covers when the campus is built', () => {
    const square = (x: number, y: number, size: number) => [
      { lat: y, lon: x },
      { lat: y, lon: x + size },
      { lat: y + size, lon: x + size },
      { lat: y + size, lon: x },
      { lat: y, lon: x },
    ];
    const elements: Element[] = [
      { type: 'way', id: 1, tags: { building: 'school' }, geometry: square(0, 0, 0.0004) },
      { type: 'way', id: 2, tags: { building: 'carport' }, geometry: square(0.0006, 0, 0.0003) },
      { type: 'way', id: 3, tags: { amenity: 'shelter', height: '4' }, geometry: square(0, 0.0006, 0.0001) },
      { type: 'way', id: 4, tags: { highway: 'footway', covered: 'yes' }, geometry: [{ lat: 0.0009, lon: 0 }, { lat: 0.0009, lon: 0.0005 }] },
      { type: 'way', id: 5, tags: { building: 'roof', 'generator:source': 'solar' }, geometry: square(0.0012, 0, 0.0002) },
    ];
    const campus = buildCampus('Test', '', { lat: 0, lon: 0 }, [], elements);
    expect(campus.blocks.map((block) => block.id)).toEqual([1]);
    expect(campus.covers?.map((cover) => cover.id)).toEqual([2, 3, 4, 5]);
    expect(campus.covers?.find((cover) => cover.id === 3)?.height).toBe(4);
    expect(campus.covers?.find((cover) => cover.id === 2)?.height).toBe(3.5);
    expect(campus.covers?.find((cover) => cover.id === 5)?.solar).toBe(true);
    expect(campus.strips).toHaveLength(1);
  });
});

describe('sports', () => {
  it('reads the first known sport and prefers football lines when both are played', () => {
    expect(sportOf('basketball;tennis')).toBe('basketball');
    expect(sportOf('soccer;american_football')).toBe('american_football');
    expect(sportOf('football')).toBe('soccer');
    expect(sportOf('kite;tennis')).toBe('tennis');
    expect(sportOf('skateboard')).toBe('skateboard');
    expect(sportOf('made_up')).toBeUndefined();
    expect(sportOf(undefined)).toBeUndefined();
  });

  it('draws a basketball court with hoops and no tennis net', () => {
    const court: Ring = [
      [0, 0],
      [30, 0],
      [30, 18],
      [0, 18],
    ];
    const layout = layoutOf({ surface: 'court', ring: court, label: 'Basketball court', sport: 'basketball' });
    expect(layout?.gear.map((gear) => gear.kind)).toEqual(['hoop', 'hoop']);
    const half = layoutOf({ surface: 'court', ring: court.map(([x, y]) => [x / 2, (y * 14) / 18]) as Ring, sport: 'basketball' });
    expect(half?.gear.map((gear) => gear.kind)).toEqual(['hoop']);
    const unknown = layoutOf({ surface: 'court', ring: court });
    expect(unknown?.gear).toEqual([]);
    expect(unknown?.marks.length).toBeGreaterThan(0);
  });

  it('gives a soccer field soccer goals and no uprights', () => {
    const field: Ring = [
      [0, 0],
      [105, 0],
      [105, 68],
      [0, 68],
    ];
    expect(layoutOf({ surface: 'grass', ring: field, sport: 'soccer' })?.gear.map((gear) => gear.kind)).toEqual(['soccer goal', 'soccer goal']);
    expect(layoutOf({ surface: 'turf', ring: field, sport: 'american_football' })?.gear.map((gear) => gear.kind)).toEqual(['uprights', 'uprights']);
  });
});

describe('home plate', () => {
  const fan: Ring = [[0, 0], [95, 0]];
  for (let step = 1; step < 12; step += 1) {
    const angle = (step / 12) * (Math.PI / 2);
    fan.push([Math.cos(angle) * 105, Math.sin(angle) * 105]);
  }
  fan.push([0, 95]);

  it('finds home plate where the two foul lines meet', () => {
    const diamond = diamondOf(fan, 'baseball');
    expect(diamond).not.toBeNull();
    expect(diamond?.home[0]).toBeCloseTo(diamond?.home[1] ?? 0, 3);
    expect(diamond?.toward[0]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(diamond?.toward[1]).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('finds home plate behind a short backstop chamfer', () => {
    const chamfered: Ring = [
      [8, 0],
      [75, 0],
      [80, 30],
      [62, 62],
      [30, 80],
      [0, 75],
      [0, 8],
    ];
    const diamond = diamondOf(chamfered, 'softball');
    expect(diamond).not.toBeNull();
    expect(Math.hypot(diamond?.home[0] ?? 0, diamond?.home[1] ?? 0)).toBeGreaterThan(8);
    expect(diamond?.toward[0]).toBeCloseTo(Math.SQRT1_2, 2);
    const patches = buildCampus('Test', '', { lat: 0, lon: 0 }, [], []).patches;
    expect(patches).toHaveLength(0);
  });

  it('refuses a rectangle where several corners qualify or none do', () => {
    const square: Ring = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(homeCorners(square).length).toBeGreaterThan(1);
    expect(diamondOf(square, 'baseball')).toBeNull();
    const long: Ring = [
      [0, 0],
      [120, 0],
      [120, 70],
      [0, 70],
    ];
    expect(diamondOf(long, 'baseball')).toBeNull();
  });

  it('adds the skinned infield as new patches at the end', () => {
    const degrees = (metres: number) => metres / 111320;
    const geometry = fan.map(([x, y]) => ({ lat: degrees(y), lon: degrees(x) }));
    geometry.push(geometry[0]);
    const elements: Element[] = [
      { type: 'way', id: 1, tags: { leisure: 'pitch', sport: 'baseball' }, geometry },
      { type: 'way', id: 2, tags: { amenity: 'parking' }, geometry: [geometry[0], geometry[1], geometry[5], geometry[0]] },
    ];
    const campus = buildCampus('Test', '', { lat: 0, lon: 0 }, [], elements);
    expect(campus.patches.slice(0, 2).map((patch) => patch.label)).toEqual(['Ball field', 'Parking lot']);
    expect(campus.patches.slice(2).map((patch) => patch.surface)).toEqual(['soil', 'grass', 'soil']);
    expect(layoutOf(campus.patches[0])?.gear.map((gear) => gear.kind)).toEqual(['backstop']);
  });
});

describe('tags read into the model', () => {
  it('keeps only the new things the campus uses', () => {
    expect(relevant({ type: 'node', id: 1, tags: { man_made: 'flagpole' }, lat: 0, lon: 0 })).toBe(true);
    expect(relevant({ type: 'node', id: 1, tags: { entrance: 'main' }, lat: 0, lon: 0 })).toBe(true);
    expect(relevant({ type: 'way', id: 1, tags: { barrier: 'hedge' }, geometry: [] })).toBe(true);
    expect(relevant({ type: 'node', id: 1, tags: { barrier: 'gate' }, lat: 0, lon: 0 })).toBe(false);
    expect(relevant({ type: 'way', id: 1, tags: { 'building:part': 'yes' }, geometry: [] })).toBe(true);
  });

  it('maps colours and materials to clay tones', () => {
    expect(toneOf('white')).toBe('pale');
    expect(toneOf('#fff5de')).toBe('cream');
    expect(toneOf('maroon', 'roof')).toBe('tile');
    expect(toneOf('brown')).toBe('brick');
    expect(toneOf('black')).toBe('dark');
    expect(toneOf('#a5462d', 'roof')).toBe('tile');
    expect(toneOf('#b07a63')).toBe('brick');
    expect(toneOf('#d6d6d6', 'roof')).toBe('grey');
    expect(toneOf('not a colour')).toBeUndefined();
    expect(materialTone('brick')).toBe('brick');
    expect(materialTone('glass')).toBe('blue');
    expect(photoTone(210, 210, 205)).toBe('pale');
    expect(photoTone(80, 85, 90)).toBe('dark');
    expect(roofShape('gabled')).toBe('gabled');
    expect(roofShape('onion')).toBeUndefined();
    expect(bearing('SW')).toBe(225);
    expect(bearing('370')).toBe(10);
  });

  it('builds a cover outline along a covered path', () => {
    const ring = bufferLine(
      [
        [0, 0],
        [10, 0],
      ],
      1.5,
    );
    expect(ring).toHaveLength(4);
    expect(Math.max(...ring.map(([, y]) => y))).toBeCloseTo(1.5, 5);
  });

  it('uses building parts in place of an outline they cover', () => {
    const box = (x0: number, y0: number, x1: number, y1: number) => [
      { lat: y0, lon: x0 },
      { lat: y0, lon: x1 },
      { lat: y1, lon: x1 },
      { lat: y1, lon: x0 },
      { lat: y0, lon: x0 },
    ];
    const elements: Element[] = [
      { type: 'way', id: 10, tags: { building: 'school', 'building:colour': 'brown' }, geometry: box(0, 0, 0.0004, 0.0002) },
      { type: 'way', id: 11, tags: { 'building:part': 'yes', height: '12', 'roof:shape': 'gabled', 'roof:height': '3' }, geometry: box(0, 0, 0.0002, 0.0002) },
      { type: 'way', id: 12, tags: { 'building:part': 'yes', 'building:levels': '2', min_height: '3' }, geometry: box(0.0002, 0, 0.0004, 0.0002) },
      { type: 'way', id: 20, tags: { building: 'yes' }, geometry: box(0.001, 0, 0.0012, 0.0002) },
      { type: 'way', id: 21, tags: { 'building:part': 'yes', height: '9' }, geometry: box(0.001, 0, 0.00105, 0.00005) },
    ];
    const campus = buildCampus('Test', '', { lat: 0, lon: 0 }, [], elements);
    expect(campus.blocks.map((block) => block.id)).toEqual([20, 11, 12]);
    const gabled = campus.blocks.find((block) => block.id === 11);
    expect(gabled?.height).toBe(12);
    expect(gabled?.roof).toBe('gabled');
    expect(gabled?.rise).toBe(3);
    expect(gabled?.wall).toBe('brick');
    const raised = campus.blocks.find((block) => block.id === 12);
    expect(raised?.min).toBe(3);
    expect(raised?.levels).toBe(2);
  });
});

describe('roof tone from the photo', () => {
  it('reads the mean roof colour and keeps a tagged roof colour', () => {
    const size = 20 * 20;
    const red = new Uint8Array(size).fill(84);
    const green = new Uint8Array(size).fill(88);
    const blue = new Uint8Array(size).fill(92);
    for (let index = 0; index < size; index += 1) {
      if (index % 20 >= 10) {
        red[index] = 208;
        green[index] = 206;
        blue[index] = 200;
      }
    }
    const photo = { minX: 0, minY: 0, cell: 1, cols: 20, rows: 20, red, green, blue, nir: new Uint8Array(size), seen: new Uint8Array(size).fill(1), date: '2022-07-04', gsd: 1, bytes: 0, seconds: 0, items: [] };
    const layers = { grid: { cols: 20, rows: 20, cell: 1, minX: 0, minY: 0 }, photo } as unknown as Layers;
    const block = (x: number) => ({ id: x, ring: [[x, 2], [x + 6, 2], [x + 6, 8], [x, 8]] as Ring, height: 6, guessed: true, home: true });
    const campus = { ...lotCampus(false), blocks: [block(2), block(12), { ...block(12), id: 99, top: 'tile' as const }, { ...block(30), id: 98 }] };
    const tones = roofTones(layers, campus);
    expect(tones).toEqual(['dark', 'pale', 'pale', null]);
    const seen = applySight(campus, { date: '2022-07-04', bytes: 1, seconds: 1, trees: [], fields: [], tones });
    expect(seen.blocks.map((item) => item.tone)).toEqual(['dark', 'pale', undefined, undefined]);
    expect(applySight(campus, { date: '2022-07-04', bytes: 1, seconds: 1, trees: [], fields: [] }).blocks.every((item) => item.tone === undefined)).toBe(true);
  });
});

describe('a campus saved before the detail', () => {
  const file = JSON.parse(readFileSync(new URL('./fixtures/before-detail.json', import.meta.url), 'utf8')) as { campus: Campus; weather: Weather; peak: number; mean: number; hot: number };

  it('still builds and simulates to the same numbers', () => {
    const opened = openCampus(file.campus, file.weather);
    const result = tally(opened.bare, opened.ground, opened.peak);
    expect(opened.peak).toBe(file.peak);
    expect(result.mean).toBeCloseTo(file.mean, 6);
    expect(result.hot).toBeCloseTo(file.hot, 6);
    for (const patch of file.campus.patches) layoutOf(patch);
  });
});
