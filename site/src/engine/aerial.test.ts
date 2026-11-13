import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySight, covered, enrich, mergeTrees, PHOTO_SOURCE } from './aerial';
import type { Campus, Tree } from './campus';

function campus(trees: Tree[], center = { lat: 33.18, lon: -96.75 }): Campus {
  return {
    name: 'Test',
    place: '',
    center,
    boundary: [
      [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
    ],
    clear: [],
    patches: [{ surface: 'turf', ring: [], label: 'Football field', guessed: true }],
    strips: [],
    blocks: [],
    trees,
  };
}

const seen = (x: number, y: number, radius = 4): Tree => ({ x, y, radius, height: 9.5, photo: true });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aerial trees', () => {
  it('only asks for photos in the lower 48 states', () => {
    expect(covered({ lat: 33.18, lon: -96.75 })).toBe(true);
    expect(covered({ lat: 51.5, lon: -0.12 })).toBe(false);
    expect(covered({ lat: 21.3, lon: -157.8 })).toBe(false);
  });

  it('lets a photo crown replace a mapped tree it covers', () => {
    const mapped = campus([
      { x: 0, y: 0, radius: 4, height: 8.8 },
      { x: 12, y: 0, radius: 4, height: 8.8 },
      { x: 30, y: 30, radius: 4, height: 8.8 },
    ]);
    const merged = mergeTrees(mapped, [seen(1, 1, 6), seen(14.5, 0, 2)]);
    expect(merged).toHaveLength(3);
    expect(merged).toContainEqual({ x: 30, y: 30, radius: 4, height: 8.8 });
    expect(merged.filter((tree) => tree.photo)).toHaveLength(2);
  });

  it('keeps at most 800 trees and prefers trees on campus', () => {
    const far = Array.from({ length: 500 }, (_, index) => seen(200 + index, 200, 8));
    const near = Array.from({ length: 500 }, (_, index) => seen(-40 + (index % 80), -40 + Math.floor(index / 80) * 10, 2));
    const merged = mergeTrees(campus([]), [...far, ...near]);
    expect(merged).toHaveLength(800);
    expect(merged.filter((tree) => tree.x < 100)).toHaveLength(500);
  });

  it('records the photo and its field calls on the campus', () => {
    const result = applySight(campus([]), { date: '2022-07-04', bytes: 1, seconds: 1, trees: [seen(0, 0)], fields: [{ patch: 0, surface: 'grass' }] });
    expect(result.photo).toEqual({ source: PHOTO_SOURCE, date: '2022-07-04', fields: [0] });
    expect(result.patches[0].surface).toBe('grass');
    expect(result.trees).toHaveLength(1);
  });

  it('returns the campus unchanged outside the US without asking', async () => {
    const ask = vi.fn();
    vi.stubGlobal('fetch', ask);
    const abroad = campus([], { lat: 51.5, lon: -0.12 });
    expect(await enrich(abroad)).toBe(abroad);
    expect(ask).not.toHaveBeenCalled();
  });

  it('returns the campus unchanged when the photo hosts fail', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('blocked'))));
    const home = campus([]);
    expect(await enrich(home, undefined, { inline: true })).toBe(home);
  });

  it('gives up when the photo hosts hang', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const home = campus([]);
    const started = performance.now();
    expect(await enrich(home, undefined, { inline: true, wait: 50 })).toBe(home);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('does not read a campus twice', async () => {
    const ask = vi.fn();
    vi.stubGlobal('fetch', ask);
    const done = { ...campus([]), photo: { source: PHOTO_SOURCE, date: '2022-07-04', fields: [] } };
    expect(await enrich(done)).toBe(done);
    expect(ask).not.toHaveBeenCalled();
  });
});
