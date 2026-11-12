import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rasterize, SURFACES, type Campus } from './campus';
import { insideRing, ringArea, type Ring } from './geometry';
import { DAY_START, STEP, STEPS, backdropOf, decode, encode, hottestMinute, rampColor, simulate, tally, temperatureAt } from './heat';
import { assemble, buildCampus } from './osm';
import { placeDay, placesOf, shadeDistance, walkToShade } from './places';
import { Planner } from './planner';
import { cellAt, ellipseSpans, lineSpans, makeGrid, polygonSpans } from './raster';
import { castShadows, treeShadow, LIGHT_UNDER } from './shade';
import { clockLabel, offsetFor, sunAt, utcFor } from './sun';
import { hourly, minuteNow, type Weather } from './weather';

const square: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function count(run: (emit: (row: number, from: number, to: number) => void) => void): number {
  let total = 0;
  run((_row, from, to) => {
    total += to - from + 1;
  });
  return total;
}

const flatDay: Weather = {
  date: '2026-08-24',
  zone: 'America/Chicago',
  offset: -300,
  air: Array.from({ length: 24 }, () => 100),
  sunshine: Array.from({ length: 24 }, (_value, hour) => (hour >= 8 && hour <= 18 ? 1000 : 0)),
  wind: Array.from({ length: 24 }, () => 5),
  source: 'test',
};

function plainCampus(): Campus {
  return {
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
    patches: [
      {
        surface: 'asphalt',
        ring: [
          [-50, -50],
          [0, -50],
          [0, 50],
          [-50, 50],
        ],
      },
    ],
    strips: [],
    blocks: [],
    trees: [],
  };
}

describe('geometry and raster', () => {
  it('measures and tests rings', () => {
    expect(ringArea(square)).toBe(100);
    expect(insideRing(square, 5, 5)).toBe(true);
    expect(insideRing(square, 11, 5)).toBe(false);
  });

  it('fills a polygon to its area', () => {
    const grid = makeGrid({ minX: -5, maxX: 15, minY: -5, maxY: 15 }, 0.5);
    expect(count((emit) => polygonSpans(grid, square, emit)) * 0.25).toBeCloseTo(100, 0);
  });

  it('fills an ellipse to its area at any angle', () => {
    const grid = makeGrid({ minX: -30, maxX: 30, minY: -30, maxY: 30 }, 0.25);
    for (const angle of [0, 0.6, 1.5708, 2.4]) {
      const cells = count((emit) => ellipseSpans(grid, 1, -2, 12, 5, angle, emit));
      expect((cells * 0.0625) / (Math.PI * 60)).toBeCloseTo(1, 1);
    }
  });

  it('strokes a line to its width', () => {
    const grid = makeGrid({ minX: -5, maxX: 105, minY: -10, maxY: 10 }, 0.5);
    const seen = new Uint8Array(grid.cols * grid.rows);
    lineSpans(grid, [[0, 0], [100, 0]], 6, (row, from, to) => seen.fill(1, row * grid.cols + from, row * grid.cols + to + 1));
    expect(seen[cellAt(grid, 50, 2.5)]).toBe(1);
    expect(seen[cellAt(grid, 50, 3.6)]).toBe(0);
  });
});

describe('sun', () => {
  it('puts the August sun high in the south at solar noon in Texas', () => {
    const noon = sunAt(33.178, -96.754, utcFor('2026-08-24', 13 * 60 + 29, -300));
    expect((noon.altitude * 180) / Math.PI).toBeGreaterThan(65);
    expect(noon.y).toBeLessThan(0);
    expect(Math.abs(noon.x)).toBeLessThan(0.05);
  });

  it('puts the morning sun in the east and the evening sun in the west', () => {
    expect(sunAt(33.178, -96.754, utcFor('2026-08-24', 8 * 60, -300)).x).toBeGreaterThan(0.5);
    expect(sunAt(33.178, -96.754, utcFor('2026-08-24', 19 * 60, -300)).x).toBeLessThan(-0.5);
  });

  it('reads the summer and winter offsets of a zone', () => {
    expect(offsetFor('America/Chicago', '2026-08-24')).toBe(-300);
    expect(offsetFor('America/Chicago', '2026-01-10')).toBe(-360);
    expect(offsetFor('Asia/Kolkata', '2026-05-01')).toBe(330);
  });

  it('writes clock times without a colon', () => {
    expect(clockLabel(16 * 60 + 5)).toBe('4.05 pm');
    expect(clockLabel(0)).toBe('12.00 am');
  });
});

describe('shade', () => {
  const grid = makeGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 1);
  const sun = sunAt(33.178, -96.754, utcFor('2026-08-24', 17 * 60, -300));

  it('throws a building shadow away from the sun with the right length', () => {
    const light = new Uint8Array(grid.cols * grid.rows);
    castShadows(grid, light, sun, { blocks: [{ id: 1, ring: square, height: 10, guessed: false, home: true }], trees: [], sails: [] });
    const reach = 10 / Math.tan(sun.altitude);
    const ux = -sun.x / Math.hypot(sun.x, sun.y);
    const uy = -sun.y / Math.hypot(sun.x, sun.y);
    expect(light[cellAt(grid, 5 + ux * (reach - 3), 5 + uy * (reach - 3))]).toBe(Math.round(LIGHT_UNDER.block * 255));
    expect(light[cellAt(grid, 5 + ux * (reach + 9), 5 + uy * (reach + 9))]).toBe(255);
    expect(light[cellAt(grid, 5 - ux * 12, 5 - uy * 12)]).toBe(255);
  });

  it('throws a tree shadow as an ellipse past the trunk', () => {
    const light = new Uint8Array(grid.cols * grid.rows);
    const tree = { x: 0, y: 0, radius: 5, height: 10 };
    castShadows(grid, light, sun, { blocks: [], trees: [tree], sails: [] });
    const shadow = treeShadow(tree, sun);
    expect(shadow.along).toBeGreaterThan(shadow.across);
    expect(light[cellAt(grid, shadow.x, shadow.y)]).toBe(Math.round(LIGHT_UNDER.tree * 255));
    expect(light[cellAt(grid, shadow.x + 30, shadow.y + 30)]).toBe(255);
  });

  it('shades the ground under a sail at noon', () => {
    const light = new Uint8Array(grid.cols * grid.rows);
    const noon = sunAt(33.178, -96.754, utcFor('2026-08-24', 13 * 60 + 29, -300));
    castShadows(grid, light, noon, {
      blocks: [],
      trees: [],
      sails: [{ id: 1, corners: [[-10, -10], [10, -10], [10, 10], [-10, 10]], height: 4 }],
    });
    expect(light[cellAt(grid, 0, 3)]).toBe(Math.round(LIGHT_UNDER.sail * 255));
  });

  it('gives no direct light after sunset', () => {
    const light = new Uint8Array(grid.cols * grid.rows).fill(255);
    castShadows(grid, light, sunAt(33.178, -96.754, utcFor('2026-08-24', 21 * 60, -300)), { blocks: [], trees: [], sails: [] });
    expect(light[0]).toBe(0);
  });
});

describe('heat', () => {
  it('round trips the temperature code', () => {
    expect(decode(encode(142))).toBeCloseTo(142, 0);
  });

  it('interpolates hourly weather', () => {
    expect(hourly([0, 10, 20], 90)).toBe(15);
  });

  it('reads the local clock at the school', () => {
    expect(minuteNow(flatDay, Date.UTC(2026, 7, 24, 20, 30))).toBe(15 * 60 + 30);
    expect(minuteNow(flatDay, Date.UTC(2026, 7, 24, 2, 0))).toBe(21 * 60);
  });

  it('heats asphalt far above grass and holds heat after sunset', () => {
    const campus = plainCampus();
    const ground = rasterize(campus, 2);
    const day = simulate(ground, flatDay, backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] }));
    const lot = cellAt(ground.grid, -25, 0);
    const lawn = cellAt(ground.grid, 25, 0);
    expect(temperatureAt(day, 15 * 60, lot)).toBeGreaterThan(138);
    expect(temperatureAt(day, 15 * 60, lawn)).toBeLessThan(112);
    expect(temperatureAt(day, 19 * 60 + 30, lot)).toBeGreaterThan(temperatureAt(day, 19 * 60 + 30, lawn) + 4);
    expect(temperatureAt(day, DAY_START, lot)).toBeCloseTo(100, 0);
    expect(day.temps.length).toBe(day.cells * STEPS);
  });

  it('cools the lot under a tree and lowers the hot share', () => {
    const campus = plainCampus();
    const ground = rasterize(campus, 2);
    const back = backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] });
    const bare = simulate(ground, flatDay, back);
    const trees = [-40, -25, -10].flatMap((x) => [-30, 0, 30].map((y) => ({ x, y, radius: 7, height: 12 })));
    const shaded = simulate(ground, flatDay, back, { blocks: [], trees, sails: [] });
    const minute = 13 * 60 + 30;
    const under = cellAt(ground.grid, -25, 1);
    expect(temperatureAt(bare, minute, under) - temperatureAt(shaded, minute, under)).toBeGreaterThan(25);
    expect(tally(shaded, ground, minute).hot).toBeLessThan(tally(bare, ground, minute).hot);
    expect(tally(bare, ground, minute).peak).toBeGreaterThan(138);
  });

  it('finds the hottest time in the afternoon', () => {
    const campus = plainCampus();
    const ground = rasterize(campus, 2);
    const day = simulate(ground, flatDay, backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] }));
    const minute = hottestMinute(day, ground);
    expect(minute).toBeGreaterThan(9 * 60);
    expect(minute).toBeLessThan(19 * 60);
    expect((minute - DAY_START) % STEP).toBe(0);
  });

  it('runs the ramp from pale to dark', () => {
    const cool = rampColor(80);
    const hot = rampColor(170);
    expect(cool[0] + cool[1] + cool[2]).toBeGreaterThan(hot[0] + hot[1] + hot[2]);
  });
});

describe('planner', () => {
  it('puts trees on grass beside the hot lot and each one helps', () => {
    const campus = plainCampus();
    const ground = rasterize(campus, 2);
    const back = backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] });
    const bare = simulate(ground, flatDay, back);
    const planner = new Planner(campus, ground, bare, flatDay, 5.5, 10);
    const trees = [planner.next(), planner.next(), planner.next(), planner.next()].filter((tree) => tree !== null);
    expect(trees).toHaveLength(4);
    for (const tree of trees) {
      expect(tree.x).toBeGreaterThan(0);
      expect(tree.x).toBeLessThan(16);
    }
    for (let i = 0; i < trees.length; i += 1) {
      for (let j = i + 1; j < trees.length; j += 1) {
        expect(Math.hypot(trees[i].x - trees[j].x, trees[i].y - trees[j].y)).toBeGreaterThan(7);
      }
    }
    const shaded = simulate(ground, flatDay, back, { blocks: [], trees, sails: [] });
    expect(tally(shaded, ground, 16 * 60).mean).toBeLessThan(tally(bare, ground, 16 * 60).mean);
  });
});

describe('places', () => {
  it('groups named ground and reports its hot hours', () => {
    const campus = plainCampus();
    campus.patches[0].label = 'Parking lot';
    const ground = rasterize(campus, 2);
    const back = backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] });
    const places = placesOf(campus, ground);
    expect(places).toHaveLength(1);
    expect(places[0].label).toBe('Parking lot');
    expect(places[0].area).toBeCloseTo(5000, -2);
    const report = placeDay(places[0], simulate(ground, flatDay, back));
    expect(report.peak).toBeGreaterThan(140);
    expect(report.hotFrom).toBeGreaterThan(7 * 60);
    expect(report.hotFrom).toBeLessThan(10 * 60);
    expect(report.hotTo).toBeGreaterThan(18 * 60);
    expect(report.hotMinutes).toBeGreaterThan(8 * 60);
  });

  it('measures the walk to shade and shortens it with a tree', () => {
    const campus = plainCampus();
    campus.patches[0].label = 'Parking lot';
    const ground = rasterize(campus, 2);
    const back = backdropOf(ground, flatDay, campus.center.lat, campus.center.lon, { blocks: [], trees: [], sails: [] });
    const lot = placesOf(campus, ground)[0];
    const bare = simulate(ground, flatDay, back);
    const noon = 13 * 60 + 30;
    expect(walkToShade(lot, shadeDistance(ground, bare, noon))).toBeGreaterThan(1e6);
    const shaded = simulate(ground, flatDay, back, { blocks: [], trees: [{ x: 5, y: 0, radius: 6, height: 11 }], sails: [] });
    const walk = walkToShade(lot, shadeDistance(ground, shaded, noon));
    expect(walk).toBeGreaterThan(10);
    expect(walk).toBeLessThan(45);
  });
});

describe('campus from map data', () => {
  it('builds surfaces, roads and buildings from tags', () => {
    const center = { lat: 10, lon: 20 };
    const ring = (lat: number, lon: number, size: number) => [
      { lat, lon },
      { lat, lon: lon + size },
      { lat: lat + size, lon: lon + size },
      { lat: lat + size, lon },
      { lat, lon },
    ];
    const campus = buildCampus('School', 'Town', center, [ring(9.999, 19.999, 0.002)], [
      { type: 'way', id: 1, tags: { building: 'school', 'building:levels': '2' }, geometry: ring(10, 20, 0.0003) },
      { type: 'way', id: 2, tags: { building: 'house' }, geometry: ring(10.01, 20.01, 0.0001) },
      { type: 'way', id: 3, tags: { amenity: 'parking' }, geometry: ring(9.9995, 19.9995, 0.0003) },
      { type: 'way', id: 4, tags: { leisure: 'pitch', sport: 'tennis' }, geometry: ring(10.0005, 20.0005, 0.0002) },
      { type: 'way', id: 5, tags: { leisure: 'track' }, geometry: ring(9.9992, 20.0002, 0.0006) },
      { type: 'way', id: 6, tags: { leisure: 'pitch', sport: 'soccer' }, geometry: ring(9.9994, 20.0004, 0.0002) },
      { type: 'way', id: 7, tags: { highway: 'footway' }, geometry: [{ lat: 10, lon: 20 }, { lat: 10.0005, lon: 20 }] },
      { type: 'node', id: 8, tags: { natural: 'tree' }, lat: 10.0002, lon: 19.9995 },
    ]);
    expect(campus.blocks).toHaveLength(2);
    expect(campus.blocks[0].height).toBeCloseTo(8.6);
    expect(campus.blocks[0].home).toBe(true);
    expect(campus.blocks[1].home).toBe(false);
    expect(campus.patches.map((patch) => patch.surface)).toEqual(['asphalt', 'court', 'turf']);
    expect(campus.strips.map((strip) => strip.surface).sort()).toEqual(['concrete', 'track']);
    expect(campus.trees).toHaveLength(1);
    const ground = rasterize(campus, 1);
    expect(ground.surface.includes(SURFACES.roof.code)).toBe(true);
    expect(ground.home.includes(1)).toBe(true);
    expect(campus.clear).toHaveLength(3);
    const [fx, fy] = campus.patches[2].ring[0];
    expect(ground.open[cellAt(ground.grid, fx + 3, fy + 3)]).toBe(0);
  });

  it('assembles raw map elements into shapes', () => {
    const elements = assemble([
      { type: 'node', id: 1, lat: 10, lon: 20 },
      { type: 'node', id: 2, lat: 10, lon: 20.001 },
      { type: 'node', id: 3, lat: 10.001, lon: 20.001 },
      { type: 'node', id: 4, lat: 10.0005, lon: 20.0005, tags: { natural: 'tree' } },
      { type: 'way', id: 9, nodes: [1, 2, 3, 1], tags: { building: 'yes' } },
      { type: 'way', id: 10, nodes: [1, 2, 99], tags: { highway: 'service' } },
      { type: 'way', id: 11, nodes: [1, 2, 3, 1] },
      { type: 'relation', id: 20, tags: { type: 'multipolygon', building: 'school' }, members: [{ type: 'way', ref: 11, role: 'outer' }, { type: 'way', ref: 404, role: 'outer' }] },
    ]);
    expect(elements.map((element) => `${element.type} ${element.id}`)).toEqual(['node 4', 'way 9', 'relation 20']);
    expect(elements[1].geometry).toHaveLength(4);
    expect(elements[2].members).toHaveLength(1);
    const campus = buildCampus('School', '', { lat: 10, lon: 20 }, [], elements);
    expect(campus.blocks).toHaveLength(2);
    expect(campus.trees).toHaveLength(1);
  });

  it('simulates the real default campus quickly', () => {
    const file = JSON.parse(readFileSync(new URL('../../public/campus/heritage.json', import.meta.url), 'utf8')) as { campus: Campus; weather: Weather };
    const ground = rasterize(file.campus, 2);
    const first = performance.now();
    const back = backdropOf(ground, file.weather, file.campus.center.lat, file.campus.center.lon, { blocks: file.campus.blocks, trees: file.campus.trees, sails: [] });
    const started = performance.now();
    const day = simulate(ground, file.weather, back, { blocks: [], trees: [{ x: 0, y: 0, radius: 6, height: 11 }], sails: [] });
    const took = performance.now() - started;
    console.log(JSON.stringify({ backdrop: Math.round(started - first) }));
    const result = tally(day, ground, 16 * 60);
    console.log(JSON.stringify({ cols: ground.grid.cols, rows: ground.grid.rows, took: Math.round(took), ...result }));
    expect(result.peak).toBeGreaterThan(130);
    expect(result.peak).toBeLessThan(190);
    expect(took).toBeLessThan(3000);
  });
});
