import { describe, expect, it } from 'vitest';
import { behind, newer } from '@/engine/aerial';
import { CAMPUS_VERSION, outdated, type Campus, type Patch, type Surface, type Tree } from '@/engine/campus';
import type { Ring } from '@/engine/geometry';
import type { Found } from '@/engine/osm';
import type { Plan } from '@/engine/share';
import type { Weather } from '@/engine/weather';
import { usable } from './loader';
import type { Memory } from './recall';
import { applyShared, applySpots, carry, cutTree, editHeight, editSurface, fixesOf, matchPatch, rebase, spotOf, type Bundle } from './store';

const square = (x: number, y: number, size = 20): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

const patch = (x: number, surface: Surface, label = 'Field'): Patch => ({ surface, ring: square(x, 0), label });

function campus(patches: Patch[], extra: Partial<Campus> = {}): Campus {
  return {
    version: CAMPUS_VERSION,
    name: 'Test',
    place: '',
    center: { lat: 47.67, lon: -122.31 },
    boundary: [square(-200, -200, 400)],
    clear: [],
    patches,
    strips: [],
    blocks: [{ id: 7, ring: square(100, 100), height: 6, guessed: true, home: true }],
    trees: [],
    ...extra,
  };
}

const weather = { date: '2026-08-24' } as Weather;
const found: Found = { kind: 'way', id: 1, name: 'Test', place: '', lat: 47.67, lon: -122.31 };
const tree = (x: number, y: number): Tree => ({ x, y, radius: 4, height: 9, photo: true });

describe('campus data version', () => {
  it('counts a missing or lower version as out of date', () => {
    const now = campus([]);
    expect(outdated(now)).toBe(false);
    expect(outdated({ ...now, version: undefined })).toBe(true);
    expect(outdated({ ...now, version: CAMPUS_VERSION - 1 })).toBe(true);
  });

  it('asks again for an old campus or a US campus with no photo yet', () => {
    const seen = campus([], { photo: { source: 'USDA NAIP', date: '2023-10-01', fields: [] } });
    expect(behind(seen)).toBe(false);
    expect(behind({ ...seen, version: undefined })).toBe(true);
    expect(behind({ ...seen, photo: undefined })).toBe(true);
    expect(behind({ ...seen, photo: undefined, center: { lat: 51.5, lon: -0.12 } })).toBe(false);
  });

  it('swaps in only a campus that brings something new', () => {
    const old = campus([], { version: undefined });
    const plain = campus([]);
    const seen = campus([], { photo: { source: 'USDA NAIP', date: '2023-10-01', fields: [] } });
    expect(newer(plain, old)).toBe(true);
    expect(newer(seen, plain)).toBe(true);
    expect(newer(plain, plain)).toBe(false);
    expect(newer(plain, seen)).toBe(false);
  });

  it('fetches a remembered place again when its campus is out of date', () => {
    const now = Date.UTC(2026, 10, 13);
    const memory: Memory = { key: 'way/1', found, campus: campus([patch(0, 'grass')]), weather, at: now - 1000, used: now, enriched: true, fixes: { surfaces: [], heights: [], cut: [] } };
    expect(usable(memory, now)).toBe(true);
    expect(usable({ ...memory, campus: { ...memory.campus, version: undefined } }, now)).toBe(false);
    expect(usable({ ...memory, at: now - 31 * 86400000 }, now)).toBe(false);
  });
});

describe('moving corrections onto a newer campus', () => {
  it('finds the same field after new patches shift the list', () => {
    const before = campus([patch(0, 'grass'), patch(40, 'court', 'Tennis court'), patch(80, 'court', 'Tennis court')]);
    const after = campus([patch(0, 'grass'), patch(300, 'grass', ''), patch(80, 'court', 'Tennis court'), patch(40, 'court', 'Tennis court')]);
    expect(matchPatch(before, after, 0)).toBe(0);
    expect(matchPatch(before, after, 1)).toBe(3);
    expect(matchPatch(before, after, 2)).toBe(2);
    expect(matchPatch(before, campus([patch(0, 'grass')]), 1)).toBe(-1);
  });

  it('keeps a correction on the field it was made on', () => {
    const before = campus([patch(0, 'grass'), patch(40, 'court', 'Tennis court'), patch(80, 'court', 'Tennis court')]);
    const edited = editSurface({ campus: before, weather, school: null }, 1, 'concrete');
    const after = campus([patch(300, 'grass', ''), patch(0, 'grass'), patch(80, 'court', 'Tennis court'), patch(40, 'court', 'Tennis court')]);
    const moved = carry(edited, after);
    expect(moved.campus.patches.map((item) => item.surface)).toEqual(['grass', 'grass', 'court', 'concrete']);
    expect(fixesOf(moved).surfaces).toEqual([{ patch: 3, from: 'court', to: 'concrete' }]);
  });

  it('lets the person win when the photo changed the same field', () => {
    const before = campus([patch(0, 'turf', 'Football field')]);
    const edited = editSurface({ campus: before, weather, school: found }, 0, 'soil');
    const seen = campus([patch(0, 'grass', 'Football field')]);
    expect(rebase(fixesOf(edited), edited.campus, seen).surfaces).toEqual([{ patch: 0, from: 'grass', to: 'soil' }]);
    expect(carry(edited, seen).campus.patches[0].surface).toBe('soil');
  });

  it('drops a correction the new campus already agrees with', () => {
    const before = campus([patch(0, 'turf', 'Football field')]);
    const edited = editSurface({ campus: before, weather, school: found }, 0, 'grass');
    const seen = campus([patch(0, 'grass', 'Football field')]);
    const moved = carry(edited, seen);
    expect(moved.campus.patches[0].surface).toBe('grass');
    expect(fixesOf(moved).surfaces).toEqual([]);
  });

  it('carries building heights, removed trees and the chosen day', () => {
    const hottest = { date: '2026-08-24' } as Weather;
    const picked = { date: '2025-07-15' } as Weather;
    const before = campus([patch(0, 'grass')], { trees: [tree(50, 50)] });
    let bundle: Bundle = { campus: before, weather: picked, hottest, school: found };
    bundle = editHeight(bundle, 0, 12);
    bundle = cutTree(bundle, 50, 50) as Bundle;
    const after = campus([patch(300, 'grass', ''), patch(0, 'grass')], { trees: [tree(50, 50), tree(-60, -60)], photo: { source: 'USDA NAIP', date: '2023-10-01', fields: [] } });
    const moved = carry(bundle, after);
    expect(moved.weather).toBe(picked);
    expect(moved.hottest).toBe(hottest);
    expect(moved.campus.blocks[0].height).toBeCloseTo(39 / 3.28084, 3);
    expect(moved.campus.trees).toEqual([tree(-60, -60)]);
    expect(fixesOf(moved).cut).toEqual([[50, 50]]);
  });
});

describe('field corrections in share links', () => {
  const ell: Patch = {
    surface: 'grass',
    label: 'Play area',
    ring: [
      [0, 0],
      [60, 0],
      [60, 10],
      [10, 10],
      [10, 60],
      [0, 60],
    ],
  };

  it('stores a point inside the corrected field even when its centre is outside', () => {
    const bundle = editSurface({ campus: campus([ell]), weather, school: found }, 0, 'soil');
    const spot = spotOf(bundle, fixesOf(bundle).surfaces[0]);
    expect(spot).not.toBeNull();
    expect(spot?.from).toBe('grass');
    expect(spot?.to).toBe('soil');
    expect(applySpots({ campus: campus([ell]), weather }, spot ? [spot] : []).campus.patches[0].surface).toBe('soil');
  });

  it('picks a point no other field of the same surface covers', () => {
    const inner = patch(20, 'grass', 'Ball field');
    const outer: Patch = { surface: 'grass', label: 'Park', ring: square(0, 0, 60) };
    const bundle = editSurface({ campus: campus([outer, inner]), weather, school: found }, 0, 'soil');
    const spot = spotOf(bundle, fixesOf(bundle).surfaces[0]);
    expect(spot).not.toBeNull();
    const moved = applySpots({ campus: campus([inner, outer]), weather }, spot ? [spot] : []);
    expect(moved.campus.patches.map((item) => item.surface)).toEqual(['grass', 'soil']);
  });

  it('finds the field after the patch list was reordered', () => {
    const sent = editSurface({ campus: campus([patch(0, 'grass'), patch(40, 'court', 'Tennis court'), patch(80, 'court', 'Tennis court')]), weather, school: found }, 2, 'concrete');
    const spot = spotOf(sent, fixesOf(sent).surfaces[0]);
    const got = applySpots({ campus: campus([patch(80, 'court', 'Tennis court'), patch(300, 'grass', ''), patch(40, 'court', 'Tennis court'), patch(0, 'grass')]), weather }, spot ? [spot] : []);
    expect(got.campus.patches.map((item) => item.surface)).toEqual(['concrete', 'grass', 'court', 'grass']);
  });

  it('skips a correction it cannot place for sure', () => {
    const twin = patch(0, 'grass', 'Field');
    const at: [number, number] = [10, 10];
    const surfaces = (bundle: Bundle) => bundle.campus.patches.map((item) => item.surface);
    expect(surfaces(applySpots({ campus: campus([twin, { ...twin }]), weather }, [{ at, from: 'grass', to: 'soil' }]))).toEqual(['grass', 'grass']);
    expect(surfaces(applySpots({ campus: campus([twin]), weather }, [{ at, from: 'turf', to: 'grass' }]))).toEqual(['grass']);
    expect(surfaces(applySpots({ campus: campus([twin]), weather }, [{ at, from: 'grass', to: 'asphalt' }]))).toEqual(['grass']);
    expect(surfaces(applySpots({ campus: campus([twin]), weather }, [{ at: [90, 90], from: 'grass', to: 'soil' }]))).toEqual(['grass']);
    expect(surfaces(applySpots({ campus: campus([{ ...twin, label: undefined }]), weather }, [{ at, from: 'grass', to: 'soil' }]))).toEqual(['grass']);
  });

  it('applies old index corrections only on the built in campus', () => {
    const start = campus([patch(0, 'grass'), patch(40, 'court', 'Tennis court')], { trees: [tree(50, 50)] });
    const plan: Plan = { version: 1, school: null, date: '2026-08-24', years: 20, trees: [], sails: [], surfaces: [{ patch: 1, from: 'court', to: 'concrete' }], heights: [{ building: 7, nth: 0, feet: 40 }], cut: [[50, 50]] };
    const home = applyShared({ campus: start, weather, school: null }, plan);
    expect(home.campus.patches[1].surface).toBe('concrete');
    const school = { kind: 'way' as const, id: 1, name: 'Test', lat: 47.67, lon: -122.31 };
    const searched = applyShared({ campus: start, weather, school: found }, { ...plan, school });
    expect(searched.campus.patches[1].surface).toBe('court');
    expect(searched.campus.blocks[0].height).toBeCloseTo(40 / 3.28084, 3);
    expect(searched.campus.trees).toEqual([]);
    const spotted = applyShared({ campus: start, weather, school: found }, { ...plan, school, spots: [{ at: [50, 10], from: 'court', to: 'concrete' }] });
    expect(spotted.campus.patches[1].surface).toBe('concrete');
  });
});
