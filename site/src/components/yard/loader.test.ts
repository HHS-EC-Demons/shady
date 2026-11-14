import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPUS_VERSION, type Campus, type RoofPhoto } from '@/engine/campus';
import type { Found } from '@/engine/osm';
import type { Memory } from './recall';

const saved = new Map<string, Memory>();
const asked: { count: number; answer: RoofPhoto | null } = { count: 0, answer: null };

const campus: Campus = {
  version: CAMPUS_VERSION,
  name: 'Test',
  place: '',
  center: { lat: 47.67, lon: -122.31 },
  boundary: [],
  clear: [],
  patches: [],
  strips: [],
  blocks: [{ id: 1, ring: [[0, 0], [20, 0], [20, 20], [0, 20]], height: 6, guessed: true, home: true }],
  trees: [{ x: 5, y: 5, radius: 3, height: 8, photo: true }],
  photo: { source: 'USDA NAIP', date: '2024-07-01', fields: [] },
};
const roofs: RoofPhoto = { src: 'data:image/webp;base64,UklGRg==', date: '2024-07-01', minX: -6, minY: -6, maxX: 26, maxY: 26, blocks: [0] };

vi.mock('./recall', () => ({
  recall: async (found: Found) => saved.get(`${found.kind}/${found.id}`) ?? null,
  remember: async (entry: Omit<Memory, 'key' | 'used' | 'at'> & { at?: number }) => {
    const key = `${entry.found.kind}/${entry.found.id}`;
    saved.set(key, { ...entry, key, at: entry.at ?? Date.now(), used: Date.now() });
  },
  touch: async () => undefined,
}));
vi.mock('@/engine/remote', () => ({
  askRoofs: async () => {
    asked.count += 1;
    return asked.answer;
  },
  askSight: async () => undefined,
}));

const { roofsAllowed, roofsFor, roofless } = await import('./loader');

const school = (id: number): Found => ({ kind: 'way', id, name: 'Test', place: '', lat: 47.67, lon: -122.31 });

function keep(id: number, stored: Campus = campus): void {
  const key = `way/${id}`;
  saved.set(key, { key, found: school(id), campus: stored, weather: null, at: Date.now(), used: Date.now(), enriched: true, fixes: { surfaces: [], heights: [], cut: [] } });
}

function device(coarse: boolean, connection?: { saveData?: boolean; effectiveType?: string }): void {
  vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' && coarse }) });
  vi.stubGlobal('navigator', { connection });
}

describe('the roof pass', () => {
  beforeEach(() => {
    asked.count = 0;
    asked.answer = roofs;
    device(false, { effectiveType: '4g' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs only where the sharp read is fair', () => {
    expect(roofsAllowed({ effectiveType: '4g' }, false)).toBe(true);
    expect(roofsAllowed(undefined, false)).toBe(true);
    expect(roofsAllowed({ effectiveType: '4g' }, true)).toBe(false);
    expect(roofsAllowed({ effectiveType: '4g', saveData: true }, false)).toBe(false);
    for (const effectiveType of ['slow-2g', '2g', '3g']) expect(roofsAllowed({ effectiveType }, false)).toBe(false);
  });

  it('wants roofs only for a campus in the United States without them', () => {
    expect(roofless(campus)).toBe(true);
    expect(roofless({ ...campus, roofs })).toBe(false);
    expect(roofless({ ...campus, center: { lat: 49.86, lon: -119.48 } })).toBe(false);
  });

  it('keeps the roofs beside the cached campus and its photo trees', async () => {
    keep(1);
    const done = await roofsFor(school(1), campus);
    expect(done?.roofs).toEqual(roofs);
    expect(saved.get('way/1')?.campus.roofs).toEqual(roofs);
    expect(saved.get('way/1')?.campus.trees).toHaveLength(1);
    expect(saved.get('way/1')?.enriched).toBe(true);
  });

  it('asks once per visit and leaves a failed school to the next visit', async () => {
    keep(2);
    asked.answer = null;
    expect(await roofsFor(school(2), campus)).toBeNull();
    expect(await roofsFor(school(2), campus)).toBeNull();
    expect(asked.count).toBe(1);
    expect(saved.get('way/2')?.campus.roofs).toBeUndefined();
  });

  it('skips touch devices and saving or slow connections without a download', async () => {
    keep(3);
    device(true, { effectiveType: '4g' });
    expect(await roofsFor(school(3), campus)).toBeNull();
    device(false, { saveData: true });
    expect(await roofsFor(school(3), campus)).toBeNull();
    device(false, { effectiveType: '3g' });
    expect(await roofsFor(school(3), campus)).toBeNull();
    expect(asked.count).toBe(0);
  });

  it('skips a campus that already has roofs or lies outside the United States', async () => {
    expect(await roofsFor(school(4), { ...campus, roofs })).toBeNull();
    expect(await roofsFor(school(5), { ...campus, center: { lat: 49.86, lon: -119.48 } })).toBeNull();
    expect(asked.count).toBe(0);
  });

  it('gives roofs to a campus handed over without them', async () => {
    keep(6, { ...campus, version: CAMPUS_VERSION });
    const done = await roofsFor(school(6), saved.get('way/6')?.campus ?? campus);
    expect(done?.roofs).toEqual(roofs);
    expect(saved.get('way/6')?.campus.roofs).toEqual(roofs);
  });
});
