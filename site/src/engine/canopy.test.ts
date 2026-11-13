import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Campus, Patch } from './campus';
import { findCanopy, heightFor, judgeFields, layersOf } from './canopy';
import { insideRing, ringDistance, type Ring } from './geometry';
import type { Photo } from './naip';

const meta = JSON.parse(readFileSync(new URL('./fixtures/heritage-photo.json', import.meta.url), 'utf8')) as {
  photo: { minX: number; minY: number; cell: number; cols: number; rows: number; date: string };
  campus: Campus;
};
const raw = new Uint8Array(readFileSync(new URL('./fixtures/heritage-photo.bin', import.meta.url)));
const cells = meta.photo.cols * meta.photo.rows;
const band = (index: number) => raw.slice(index * cells, (index + 1) * cells);
const recorded: Photo = { ...meta.photo, red: band(0), green: band(1), blue: band(2), nir: band(3), seen: band(4), gsd: 1.2, bytes: 0, seconds: 0, items: [] };

function flat(cols: number, rows: number, paint: (col: number, row: number) => [number, number, number, number]): Photo {
  const size = cols * rows;
  const photo: Photo = {
    minX: 0,
    minY: 0,
    cell: 1,
    cols,
    rows,
    red: new Uint8Array(size),
    green: new Uint8Array(size),
    blue: new Uint8Array(size),
    nir: new Uint8Array(size),
    seen: new Uint8Array(size).fill(1),
    date: '2024-07-01',
    gsd: 1.2,
    bytes: 0,
    seconds: 0,
    items: [],
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [r, g, b, n] = paint(col, row);
      const index = row * cols + col;
      photo.red[index] = r;
      photo.green[index] = g;
      photo.blue[index] = b;
      photo.nir[index] = n;
    }
  }
  return photo;
}

function square(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function campusWith(patches: Patch[]): Campus {
  return {
    name: 'Test',
    place: '',
    center: { lat: 33, lon: -97 },
    boundary: [],
    clear: [],
    patches,
    strips: [],
    blocks: [{ id: 1, ring: square(0, 0, 180, 10), height: 6, guessed: true, home: true }],
    trees: [],
  };
}

describe('tree finding on a recorded aerial photo', () => {
  const layers = layersOf(recorded, meta.campus);
  if (!layers) throw new Error('no layers');
  const { trees } = findCanopy(layers, meta.campus);
  const field = meta.campus.patches.find((patch) => patch.label === 'Ball field' && insideRing(patch.ring, meta.photo.minX + 50, meta.photo.minY + 80));

  it('keeps the recorded crop under 150 KB', () => {
    expect(raw.byteLength).toBeLessThan(150 * 1024);
  });

  it('finds the tree row and the wood corner as separate crowns', () => {
    expect(trees.length).toBeGreaterThanOrEqual(15);
    expect(trees.length).toBeLessThanOrEqual(35);
    const row = trees.filter((tree) => tree.y > meta.photo.minY + 110);
    expect(row.length).toBeGreaterThanOrEqual(10);
  });

  it('puts no crown on the ball field', () => {
    expect(field).toBeDefined();
    for (const tree of trees) {
      if (field && insideRing(field.ring, tree.x, tree.y)) expect(ringDistance(field.ring, tree.x, tree.y)).toBeLessThan(3);
    }
  });

  it('sizes every crown within limits and marks it as seen', () => {
    for (const tree of trees) {
      expect(tree.radius).toBeGreaterThanOrEqual(1.5);
      expect(tree.radius).toBeLessThanOrEqual(12);
      expect(tree.height).toBe(heightFor(tree.radius));
      expect(tree.photo).toBe(true);
    }
  });

  it('calls the ball field grass', () => {
    const index = field ? meta.campus.patches.indexOf(field) : -1;
    expect(judgeFields(layers, meta.campus)).toContainEqual({ patch: index, surface: 'grass' });
  });
});

describe('turf or grass', () => {
  const photo = flat(180, 70, (col, row) => {
    if (row < 10) return [150, 150, 150, 150];
    if (col < 60) return [60, 100, 50, 180];
    if (col < 120) return [70, 110, 60, 75];
    return [150, 135, 100, 160];
  });
  const fields: Patch[] = [
    { surface: 'grass', ring: square(2, 12, 58, 68), label: 'Soccer field', guessed: true },
    { surface: 'grass', ring: square(62, 12, 118, 68), label: 'Football field', guessed: true },
    { surface: 'grass', ring: square(122, 12, 178, 68), label: 'Ball field', guessed: true },
    { surface: 'grass', ring: square(62, 12, 118, 68), label: 'Football field' },
  ];
  const campus = campusWith(fields);
  const layers = layersOf(photo, campus);
  if (!layers) throw new Error('no layers');
  const calls = judgeFields(layers, campus);

  it('calls living grass grass', () => {
    expect(calls).toContainEqual({ patch: 0, surface: 'grass' });
  });

  it('calls green plastic with no near infrared turf', () => {
    expect(calls).toContainEqual({ patch: 1, surface: 'turf' });
  });

  it('leaves a brown field and a tagged field alone', () => {
    expect(calls.some((call) => call.patch === 2 || call.patch === 3)).toBe(false);
  });
});
