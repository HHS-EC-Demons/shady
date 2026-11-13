import { describe, expect, it } from 'vitest';
import { CAMPUS_VERSION, SURFACES, mapped, type Campus, type Ground } from './campus';
import {
  DISTRICT_LIFE,
  FRAME_SIDE,
  HOURS,
  MOST_DISTRICTS,
  alive,
  bareGround,
  countLine,
  cropOf,
  fillGaps,
  framesOf,
  gate,
  nearest,
  ordered,
  photoPicks,
  rankDistricts,
  schoolKey,
  schoolQuery,
  schoolsFromOverpass,
  schoolsFromPhoton,
  shareAt,
  shownRows,
  skipPhotos,
  slowLink,
  summarize,
  upToDate,
  type Row,
  type Summary,
} from './district';
import { DAY_START, STEP, STEPS, encode, openCampus, tally, type HeatDay } from './heat';
import type { Found, PhotonFeature } from './osm';
import type { Weather } from './weather';

function school(id: number, lat: number, lon: number, name = `School ${id}`): Found {
  return { kind: 'way', id, name, place: 'Town', lat, lon, extent: { south: lat - 0.001, north: lat + 0.001, west: lon - 0.001, east: lon + 0.001 } };
}

function summary(share: number, extra: Partial<Summary> = {}): Summary {
  return {
    share,
    hourly: Array.from({ length: HOURS }, (_value, index) => index / 10),
    hot: share * 1000,
    area: 1000,
    top: 150,
    peak: 900,
    cols: 1,
    rows: 1,
    width: 10,
    depth: 10,
    frames: new Uint8Array(HOURS),
    mask: new Uint8Array(1),
    blocks: [],
    photo: false,
    covers: [],
    open: 0.6,
    version: CAMPUS_VERSION,
    ...extra,
  };
}

function row(id: number, status: Row['status'], share?: number, photo = false): Row {
  return { school: school(id, 33, -96), status, summary: share === undefined ? undefined : summary(share, { photo }) };
}

describe('district places', () => {
  it('keeps cities, towns, villages, counties and districts and drops hamlets and streets', () => {
    const feature = (osm_type: string, osm_id: number, osm_key: string, osm_value: string, name: string, extent?: number[]): PhotonFeature => ({
      geometry: { coordinates: [-96.8, 33.15] },
      properties: { osm_type, osm_id, osm_key, osm_value, name, state: 'Texas', country: 'United States', extent },
    });
    const found = rankDistricts([
      feature('R', 1, 'place', 'city', 'Frisco', [-96.92, 33.22, -96.73, 33.08]),
      feature('N', 2, 'place', 'hamlet', 'Frisco Corner'),
      feature('W', 3, 'highway', 'residential', 'Frisco Street', [-96.9, 33.2, -96.8, 33.1]),
      feature('N', 4, 'place', 'village', 'Frisco City'),
      feature('R', 5, 'boundary', 'administrative', 'Collin County', [-96.9, 33.4, -96.3, 32.9]),
      feature('N', 6, 'place', 'city', 'Frisco'),
    ]);
    expect(found.map((item) => item.name)).toEqual(['Frisco', 'Frisco City', 'Collin County']);
    expect(found[0]).toMatchObject({ kind: 'relation', id: 1, place: 'Texas, United States' });
    expect(found[1].kind).toBe('node');
    expect(found[1].extent?.north).toBeGreaterThan(33.15);
    expect(found[1].extent?.south).toBeLessThan(33.15);
  });

  it('stops at seven places', () => {
    const many = Array.from({ length: 12 }, (_value, index): PhotonFeature => ({
      geometry: { coordinates: [10 + index, 50] },
      properties: { osm_type: 'R', osm_id: index + 1, osm_key: 'place', osm_value: 'town', name: `Town ${index}`, country: 'Germany', extent: [10 + index, 50.1, 10.1 + index, 49.9] },
    }));
    expect(rankDistricts(many)).toHaveLength(MOST_DISTRICTS);
  });

  it('asks Overpass by area for a relation and by extent otherwise', () => {
    const city: Found = { kind: 'relation', id: 6579857, name: 'Frisco', place: 'Texas', lat: 33.15, lon: -96.82, extent: { south: 33.08, west: -96.92, north: 33.22, east: -96.73 } };
    expect(schoolQuery(city)).toContain('area(3606579857)->.a;');
    expect(schoolQuery(city)).toContain('way["amenity"="school"](area.a)');
    expect(schoolQuery(city)).toContain('out tags bb;');
    expect(schoolQuery({ ...city, kind: 'way' })).toContain('way["amenity"="school"](33.08,-96.92,33.22,-96.73)');
  });
});

describe('listing schools', () => {
  it('keeps named school areas, drops points and merges the same school mapped twice', () => {
    const found = schoolsFromOverpass(
      [
        { type: 'way', id: 1, tags: { name: 'Lone Star High School' }, bounds: { minlat: 33.1, minlon: -96.8, maxlat: 33.11, maxlon: -96.79 } },
        { type: 'way', id: 2, tags: { name: 'Lone Star High School' }, bounds: { minlat: 33.104, minlon: -96.796, maxlat: 33.105, maxlon: -96.795 } },
        { type: 'way', id: 3, tags: {}, bounds: { minlat: 33.2, minlon: -96.8, maxlat: 33.21, maxlon: -96.79 } },
        { type: 'node', id: 4, tags: { name: 'Little School' } },
        { type: 'relation', id: 5, tags: { name: 'Hosp Elementary' }, bounds: { minlat: 33.12, minlon: -96.7, maxlat: 33.122, maxlon: -96.698 } },
      ],
      'Frisco, Texas',
    );
    expect(found.map((item) => `${item.kind}/${item.id}`)).toEqual(['way/1', 'relation/5']);
    expect(found[0].lat).toBeCloseTo(33.105, 6);
    expect(found[0].place).toBe('Frisco, Texas');
  });

  it('reads the Photon fallback the same way', () => {
    const found = schoolsFromPhoton(
      [
        { geometry: { coordinates: [-96.82, 33.13] }, properties: { osm_type: 'W', osm_id: 7, osm_key: 'amenity', osm_value: 'school', name: 'Frisco High School', extent: [-96.825, 33.134, -96.82, 33.128] } },
        { geometry: { coordinates: [-96.82, 33.13] }, properties: { osm_type: 'N', osm_id: 8, osm_key: 'amenity', osm_value: 'school', name: 'Point School' } },
        { geometry: { coordinates: [-96.82, 33.13] }, properties: { osm_type: 'W', osm_id: 7, osm_key: 'amenity', osm_value: 'school', name: 'Frisco High School', extent: [-96.825, 33.134, -96.82, 33.128] } },
      ],
      'Frisco, Texas',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'way', id: 7, extent: { south: 33.128, north: 33.134 } });
  });

  it('keeps the 48 schools nearest the centre of the place', () => {
    const center = { lat: 33, lon: -96 };
    const all = Array.from({ length: 143 }, (_value, index) => school(index + 1, 33 + (index % 2 === 0 ? 1 : -1) * index * 0.001, -96));
    const kept = nearest(all, center);
    expect(kept).toHaveLength(48);
    const farthestKept = Math.max(...kept.map((item) => Math.abs(item.lat - 33)));
    const nearestDropped = Math.min(...all.filter((item) => !kept.includes(item)).map((item) => Math.abs(item.lat - 33)));
    expect(farthestKept).toBeLessThan(nearestDropped);
    expect(kept[0].id).toBe(1);
    expect(nearest(all.slice(0, 31), center)).toHaveLength(31);
  });

  it('writes the count as one short line', () => {
    expect(countLine(48, 143)).toBe('48 of 143 schools');
    expect(countLine(31, 31)).toBe('31 schools');
    expect(countLine(1, 1)).toBe('1 school');
  });
});

describe('ordering', () => {
  it('puts the hottest first, then schools still loading in listing order, then failures', () => {
    const rows = [row(1, 'waiting'), row(2, 'done', 0.2), row(3, 'failed'), row(4, 'done', 0.6), row(5, 'loading'), row(6, 'unmapped'), row(7, 'done', 0.6)];
    rows[6].summary = summary(0.6, { hot: 5000 });
    expect(ordered(rows).map((item) => item.school.id)).toEqual([7, 4, 2, 1, 5, 3, 6]);
  });

  it('picks the hottest schools without photo trees for the photo step, twelve at most', () => {
    const rows = [row(1, 'done', 0.1), row(2, 'done', 0.9, true), row(3, 'done', 0.5), row(4, 'failed'), row(5, 'done', 0.7)];
    expect(photoPicks(rows, 3).map((item) => item.id)).toEqual([5, 3]);
    rows[4].looked = true;
    expect(photoPicks(rows, 3).map((item) => item.id)).toEqual([3]);
    expect(photoPicks(rows, 1)).toEqual([]);
    const many = Array.from({ length: 20 }, (_value, index) => row(index + 1, 'done', index / 20));
    expect(photoPicks(many)).toHaveLength(12);
    many.forEach((item, index) => {
      if (index < 12) item.looked = true;
    });
    expect(photoPicks(many)).toEqual([]);
  });

  it('skips the photo step on a saving or slow connection', () => {
    expect(slowLink(undefined)).toBe(false);
    expect(slowLink({ effectiveType: '4g' })).toBe(false);
    expect(slowLink({ effectiveType: '4g', saveData: true })).toBe(true);
    expect(slowLink({ effectiveType: '2g' })).toBe(true);
    expect(slowLink({ effectiveType: '3g' })).toBe(true);
    expect(skipPhotos({ effectiveType: '4g' }, false)).toBe(false);
    expect(skipPhotos({ effectiveType: '4g' }, true)).toBe(true);
    expect(skipPhotos(undefined, true)).toBe(true);
  });

  it('leaves out schools with almost no open ground and counts only what is shown', () => {
    expect(bareGround({ open: 0.05, area: 90000 })).toBe(true);
    expect(bareGround({ open: 0.6, area: 2000 })).toBe(true);
    expect(bareGround({ open: 0.6, area: 90000 })).toBe(false);
    const rows = [row(1, 'done', 0.4), row(2, 'bare', 0), row(3, 'waiting'), row(4, 'done', 0.1)];
    expect(shownRows(rows).map((item) => item.school.id)).toEqual([1, 4, 3]);
    expect(countLine(shownRows(rows).length, rows.length)).toBe('3 of 4 schools');
  });

  it('treats a summary from an older campus as stale', () => {
    expect(upToDate(summary(0.3))).toBe(true);
    expect(upToDate(summary(0.3, { version: CAMPUS_VERSION - 1 }))).toBe(false);
    expect(upToDate(undefined)).toBe(false);
  });
});

describe('expiry', () => {
  it('keeps a district for 30 days', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(alive(now - DISTRICT_LIFE + 60000, now)).toBe(true);
    expect(alive(now - DISTRICT_LIFE - 1, now)).toBe(false);
    expect(alive(now + 3600000, now)).toBe(false);
    expect(alive(Number.NaN, now)).toBe(false);
  });
});

const hotDay: Weather = {
  date: '2026-07-20',
  zone: 'America/Chicago',
  offset: -300,
  air: Array.from({ length: 24 }, (_value, hour) => 80 + Math.max(0, 20 - Math.abs(hour - 15) * 3)),
  sunshine: Array.from({ length: 24 }, (_value, hour) => Math.max(0, 1000 - Math.abs(hour - 13) * 160)),
  wind: Array.from({ length: 24 }, () => 5),
  source: 'test',
};

function yardCampus(): Campus {
  return {
    name: 'Test',
    place: '',
    center: { lat: 33.178, lon: -96.754 },
    boundary: [
      [
        [-80, -60],
        [80, -60],
        [80, 60],
        [-80, 60],
      ],
    ],
    clear: [],
    patches: [
      { surface: 'asphalt', ring: [[-70, -50], [0, -50], [0, 50], [-70, 50]], label: 'Parking lot' },
      { surface: 'grass', ring: [[0, -50], [70, -50], [70, 50], [0, 50]], label: 'Field' },
    ],
    strips: [],
    blocks: [
      { id: 1, ring: [[-20, -10], [10, -10], [10, 20], [-20, 20]], height: 8, guessed: false, home: true },
      { id: 2, ring: [[100, 100], [110, 100], [110, 110], [100, 110]], height: 6, guessed: false, home: false },
      { id: 3, ring: [[20, 20], [30, 20], [30, 30], [20, 30]], height: 9, min: 5, guessed: false, home: true },
      { id: 4, ring: [[-60, 30], [-40, 30], [-40, 40], [-60, 40]], height: 5, guessed: false, home: true, stand: true },
    ],
    covers: [{ id: 5, ring: [[-60, -40], [-40, -40], [-40, -30], [-60, -30]], height: 4, home: true }],
    trees: [],
    version: CAMPUS_VERSION,
  };
}

describe('summary maths', () => {
  const campus = yardCampus();
  const opened = openCampus(campus, hotDay);
  const made = summarize(campus, opened.ground, opened.bare, opened.peak);

  it('uses the same figure the yard shows at the peak hour', () => {
    const yard = tally(opened.bare, opened.ground, opened.peak);
    expect(made.share).toBe(yard.hot);
    expect(made.peak).toBe(opened.peak);
    expect(made.top).toBe(Math.round(yard.peak));
    expect(made.hot).toBe(Math.round(yard.hot * yard.cells * opened.ground.grid.cell ** 2 * 10.7639));
    expect(made.area).toBe(Math.round(yard.cells * opened.ground.grid.cell ** 2 * 10.7639));
    expect(made.share).toBeGreaterThan(0.2);
    expect(made.share).toBeLessThan(0.8);
  });

  it('keeps one share per hour from 8 am to 6 pm and blends between them', () => {
    expect(made.hourly).toHaveLength(HOURS);
    expect(made.hourly[0]).toBe(tally(opened.bare, opened.ground, 480).hot);
    expect(made.hourly[HOURS - 1]).toBe(tally(opened.bare, opened.ground, 1080).hot);
    expect(shareAt(made, 540)).toBe(made.hourly[1]);
    expect(shareAt(made, 570)).toBeCloseTo((made.hourly[1] + made.hourly[2]) / 2, 9);
    expect(shareAt(made, 300)).toBe(made.hourly[0]);
  });

  it('keeps only school buildings, placed in the frame box', () => {
    expect(made.blocks).toHaveLength(3);
    const xs = made.blocks[0].ring.filter((_value, index) => index % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(made.width);
    expect(made.blocks[0].height).toBe(8);
    expect(made.blocks[1]).toMatchObject({ height: 9, min: 5 });
    expect(made.blocks[2].stand).toBe(true);
    expect(made.covers).toHaveLength(1);
    expect(made.covers[0].height).toBe(4);
    expect(made.version).toBe(CAMPUS_VERSION);
    expect(made.open).toBeGreaterThan(0.5);
    expect(bareGround(made)).toBe(false);
    expect(mapped(campus)).toBe(true);
  });

  it('marks a school mapped only as its building as bare', () => {
    const building: Campus = { ...campus, boundary: [[[-20, -10], [10, -10], [10, 20], [-20, 20]]], patches: [], covers: [], blocks: [campus.blocks[0]] };
    const shut = openCampus(building, hotDay);
    expect(bareGround(summarize(building, shut.ground, shut.bare, shut.peak))).toBe(true);
  });

  it('downsamples heat frames to at most 96 cells on the long side', () => {
    expect(Math.max(made.cols, made.rows)).toBeLessThanOrEqual(FRAME_SIDE);
    expect(made.frames).toHaveLength(made.cols * made.rows * HOURS);
    expect(made.mask).toHaveLength(made.cols * made.rows);
    expect(made.width).toBeGreaterThanOrEqual(160);
  });
});

function synthetic(cols: number, rows: number, value: (col: number, row: number, step: number) => number, home: (col: number, row: number) => boolean, roof: (col: number, row: number) => boolean = () => false): { day: HeatDay; ground: Ground } {
  const cells = cols * rows;
  const temps = new Uint8Array(cells * STEPS);
  for (let step = 0; step < STEPS; step += 1) {
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) temps[step * cells + row * cols + col] = value(col, row, step);
  }
  const surface = new Uint8Array(cells);
  const homeCells = new Uint8Array(cells);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      homeCells[row * cols + col] = home(col, row) ? 1 : 0;
      surface[row * cols + col] = roof(col, row) ? SURFACES.roof.code : SURFACES.asphalt.code;
    }
  }
  const grid = { cols, rows, cell: 2, minX: 0, minY: 0 };
  return {
    day: { grid, cells, temps, light: new Uint8Array(cells * STEPS), air: new Float32Array(STEPS), rays: [] },
    ground: { grid, surface, home: homeCells, open: new Uint8Array(cells) },
  };
}

describe('frame downsampling', () => {
  it('averages blocks of cells for each hour and leaves the outside masked', () => {
    const { day, ground } = synthetic(
      200,
      100,
      (col, _row, step) => (col < 100 ? 100 : 200) + (step === (9 * 60 - DAY_START) / STEP ? 10 : 0),
      (col) => col >= 20,
    );
    const made = framesOf(day, ground, { col: 0, row: 0, cols: 200, rows: 100, step: 3 });
    expect(made.cols).toBe(67);
    expect(made.rows).toBe(34);
    const size = made.cols * made.rows;
    expect(made.frames[10]).toBe(100);
    expect(made.frames[60]).toBe(200);
    expect(made.frames[size + 10]).toBe(110);
    expect(made.mask[2]).toBe(0);
    expect(made.mask[10]).toBe(255);
    expect(made.frames[2]).toBeGreaterThan(90);
  });

  it('fills roofs and the outside from the nearest open ground so blending stays clean', () => {
    const { day, ground } = synthetic(
      12,
      12,
      () => encode(140),
      () => true,
      (col, row) => col >= 4 && col < 8 && row >= 4 && row < 8,
    );
    const made = framesOf(day, ground, { col: 0, row: 0, cols: 12, rows: 12, step: 1 });
    expect(made.frames[5 * 12 + 5]).toBe(encode(140));
    expect(made.mask[5 * 12 + 5]).toBe(255);
  });

  it('crops to the campus with a small margin', () => {
    const campus = yardCampus();
    const opened = openCampus(campus, hotDay);
    const crop = cropOf(campus, opened.ground);
    expect(crop.cols * opened.ground.grid.cell).toBeGreaterThanOrEqual(160);
    expect(crop.cols).toBeLessThan(opened.ground.grid.cols);
    expect(crop.step).toBe(Math.max(1, Math.ceil(Math.max(crop.cols, crop.rows) / FRAME_SIDE)));
  });

  it('gives empty grids the mean of what is known', () => {
    const values = new Float32Array([10, 0, 0, 0, 0, 0, 0, 0, 30]);
    const known = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    fillGaps(values, known, 3, 3);
    expect(values[4]).toBeCloseTo(20, 5);
    expect(values[1]).toBe(10);
  });
});

describe('polite fetching', () => {
  it('lets one request at a time reach each host and counts what came back', async () => {
    let busy = 0;
    let most = 0;
    const order: string[] = [];
    const slow = async (input: RequestInfo | URL) => {
      busy += 1;
      most = Math.max(most, busy);
      order.push(String(input));
      await new Promise((resolve) => setTimeout(resolve, 5));
      busy -= 1;
      return new Response('abcd', { status: 200 });
    };
    const counts = new Map();
    const run = gate(slow, counts);
    await Promise.all([run('https://a.test/1'), run('https://a.test/2'), run('https://a.test/3')]);
    expect(most).toBe(1);
    expect(order).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/3']);
    expect(counts.get('a.test')).toEqual({ requests: 3, bytes: 12 });
  });

  it('lets different hosts run side by side and drops stopped requests before they start', async () => {
    let busy = 0;
    let most = 0;
    const slow = async () => {
      busy += 1;
      most = Math.max(most, busy);
      await new Promise((resolve) => setTimeout(resolve, 5));
      busy -= 1;
      return new Response('x', { status: 200 });
    };
    const run = gate(slow);
    const stop = new AbortController();
    const first = run('https://a.test/1');
    const stopped = run('https://a.test/2', { signal: stop.signal }).then(
      () => 'sent',
      () => 'stopped',
    );
    stop.abort();
    await Promise.all([first, run('https://b.test/1')]);
    expect(await stopped).toBe('stopped');
    expect(most).toBe(2);
  });

  it('makes a school key from its kind and id', () => {
    expect(schoolKey({ kind: 'relation', id: 5 })).toBe('relation/5');
  });
});
