import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Campus } from '@/engine/campus';
import { YEARS, treeHeight, treeRadius } from '@/engine/growth';
import { slowOf } from './early';
import { CARS, STRETCH_HIGH, STRETCH_LOW, TREE_SHAPES, arrived, chooseCar, choosePerson, chooseTree, levelFor, modelled, nearOrder, phaseOf, reach, spotHash, wantsNear } from './forest';
import { TIERS } from './quality';

const { campus } = JSON.parse(readFileSync(new URL('../../../public/campus/heritage.json', import.meta.url), 'utf8')) as { campus: Campus };
const crownOf = (model: string) => TREE_SHAPES.find((shape) => shape.name === model)?.crown ?? NaN;
const kindOf = (model: string) => TREE_SHAPES.find((shape) => shape.name === model)?.kind;

describe('tree choice', () => {
  it('draws every standing tree with the engine crown radius and a stretch inside the limits', () => {
    for (const tree of campus.trees) {
      const choice = chooseTree(tree, spotHash(tree.x, tree.y));
      expect(Math.abs(choice.wide * crownOf(choice.model) - tree.radius) / tree.radius).toBeLessThan(0.1);
      const stretch = choice.tall / choice.wide;
      expect(stretch).toBeGreaterThanOrEqual(STRETCH_LOW - 1e-9);
      expect(stretch).toBeLessThanOrEqual(STRETCH_HIGH + 1e-9);
      expect(kindOf(choice.model)).not.toBe('conifer');
    }
  });

  it('keeps the drawn height on the engine height wherever a model fits', () => {
    let matched = 0;
    for (const tree of campus.trees) {
      const choice = chooseTree(tree, spotHash(tree.x, tree.y));
      const height = TREE_SHAPES.find((shape) => shape.name === choice.model)?.height ?? NaN;
      if (Math.abs(choice.tall * height - tree.height) / tree.height < 0.01) matched += 1;
    }
    expect(matched).toBe(campus.trees.length);
  });

  it('mixes the mature models along a row and never changes a choice between visits', () => {
    const row = Array.from({ length: 12 }, (_, index) => ({ x: index * 9, y: 40, radius: 5, height: 11.5 }));
    const first = row.map((tree) => chooseTree(tree, spotHash(tree.x, tree.y)));
    const again = row.map((tree) => chooseTree(tree, spotHash(tree.x, tree.y)));
    expect(again).toEqual(first);
    expect(new Set(first.map((choice) => choice.model)).size).toBeGreaterThan(1);
    expect(new Set(first.map((choice) => choice.turn.toFixed(3))).size).toBe(row.length);
  });

  it('grows a planned tree from a young model to a mature one', () => {
    const kinds = YEARS.map((years) => kindOf(chooseTree({ radius: treeRadius(years), height: treeHeight(years) }, 4).model));
    expect(kinds).toEqual(['young', 'young', 'mature', 'mature']);
    for (const years of YEARS) {
      const choice = chooseTree({ radius: treeRadius(years), height: treeHeight(years) }, 4);
      expect(choice.wide * crownOf(choice.model)).toBeCloseTo(treeRadius(years), 6);
    }
  });

  it('uses the nursery tree for a small tree with its shape', () => {
    expect(chooseTree({ radius: 0.6, height: 2.3 }, 1).model).toBe('tree-new');
  });

  it('gives needle trees a conifer and falls back when none is loaded', () => {
    expect(kindOf(chooseTree({ radius: 3.6, height: 14, needle: true }, 2).model)).toBe('conifer');
    expect(kindOf(chooseTree({ radius: 3.6, height: 8, needle: true }, 2).model)).toBe('conifer');
    const broad = TREE_SHAPES.filter((shape) => shape.kind !== 'conifer');
    expect(kindOf(chooseTree({ radius: 3.6, height: 14, needle: true }, 2, broad).model)).not.toBe('conifer');
  });
});

describe('levels', () => {
  const edges = [100, 300];

  it('picks the level from the distance', () => {
    expect(levelFor(50, edges)).toBe(0);
    expect(levelFor(150, edges)).toBe(1);
    expect(levelFor(400, edges)).toBe(2);
  });

  it('holds a level inside the 15 percent dead band', () => {
    expect(levelFor(110, edges, 0)).toBe(0);
    expect(levelFor(114.9, edges, 0)).toBe(0);
    expect(levelFor(115.1, edges, 0)).toBe(1);
    expect(levelFor(105, edges, 1)).toBe(1);
    expect(levelFor(99, edges, 1)).toBe(0);
    expect(levelFor(320, edges, 1)).toBe(1);
    expect(levelFor(500, edges, 0)).toBe(2);
    expect(levelFor(20, edges, 2)).toBe(0);
  });

  it('shows only the far level when there are no near edges', () => {
    expect(levelFor(1, [0, 0])).toBe(2);
  });

  it('scales the distance by size and screen height', () => {
    expect(reach(100, 10, 1080, 10)).toBeCloseTo(100);
    expect(reach(100, 20, 1080, 10)).toBeCloseTo(50);
    expect(reach(100, 10, 2160, 10)).toBeCloseTo(50);
  });
});

describe('props', () => {
  it('keeps the van rare and every body type in use', () => {
    const counts = new Map<string, number>();
    for (let key = 0; key < 5000; key += 1) {
      const model = chooseCar(key * 7919);
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    for (const model of CARS) expect(counts.get(model) ?? 0).toBeGreaterThan(0);
    expect((counts.get('car-van') ?? 0) / 5000).toBeLessThan(0.06);
  });

  it('has the band mostly standing', () => {
    let standing = 0;
    for (let key = 0; key < 600; key += 1) if (choosePerson('band', key) === 'person-stand') standing += 1;
    expect(standing / 600).toBeGreaterThan(0.7);
  });
});

describe('fallback by kind', () => {
  it('draws a tree as a model only when its own kind loaded', () => {
    const broad = { needle: false };
    const needle = { needle: true };
    expect(modelled(new Set(['broadleaf', 'cars']), broad)).toBe(true);
    expect(modelled(new Set(['broadleaf']), needle)).toBe(true);
    expect(modelled(new Set(['conifers', 'cars']), needle)).toBe(true);
    expect(modelled(new Set(['conifers', 'cars']), broad)).toBe(false);
    expect(modelled(new Set(['cars', 'poles', 'people']), broad)).toBe(false);
    expect(modelled(new Set(), needle)).toBe(false);
  });
});

describe('low tier', () => {
  const edges = TIERS.low.levels.trees;
  const at = (distance: number) => levelFor(reach(distance, 10, 1080, 10), edges);

  it('shows the detailed level for the nearest trees and the middle level up close', () => {
    expect(at(20)).toBe(0);
    expect(at(50)).toBe(1);
    expect(at(120)).toBe(2);
    expect(at(400)).toBe(2);
  });

  it('keeps every low distance shorter than medium', () => {
    edges.forEach((edge, index) => expect(edge).toBeLessThan(TIERS.medium.levels.trees[index]));
    expect(TIERS.low.props).toBeNull();
  });
});

describe('two phases', () => {
  it('draws only the far level before the full file arrives', () => {
    const trees = [null, null, ['crown']];
    expect(arrived(trees, 0)).toBe(2);
    expect(arrived(trees, 1)).toBe(2);
    expect(arrived(trees, 2)).toBe(2);
    expect(arrived([null, ['body']], 0)).toBe(1);
  });

  it('keeps the chosen level once every level is in', () => {
    const trees = [['a'], ['b'], ['c']];
    [0, 1, 2].forEach((level) => expect(arrived(trees, level)).toBe(level));
  });

  it('falls back to the nearest level below when farther ones are missing', () => {
    expect(arrived([['a'], ['b'], null], 2)).toBe(1);
    expect(arrived([['a'], null, null], 2)).toBe(0);
    expect(arrived([['a'], ['b'], ['c']], 9)).toBe(2);
    expect(arrived([null, null, null], 1)).toBe(-1);
    expect(arrived([], 0)).toBe(-1);
  });

  it('fetches broadleaf first and conifers only when the campus has them', () => {
    expect(nearOrder(false)).toEqual(['broadleaf', 'cars', 'poles', 'people', 'furniture']);
    expect(nearOrder(true)).toEqual(['broadleaf', 'cars', 'poles', 'people', 'furniture', 'conifers']);
  });

  it('prefers the full set and stands each kind alone', () => {
    const far = new Set(['broadleaf', 'cars']);
    const full = new Set(['broadleaf', 'people']);
    expect(phaseOf(far, full, 'broadleaf')).toBe('full');
    expect(phaseOf(far, full, 'cars')).toBe('far');
    expect(phaseOf(far, full, 'people')).toBe('full');
    expect(phaseOf(far, full, 'poles')).toBe('none');
  });
});

describe('near levels on demand', () => {
  const far = [null, null, ['crown']];
  const full = [['a'], ['b'], ['c']];

  it('asks for a kind only when a member on screen sits inside its middle distance', () => {
    expect(wantsNear(far, 1, 2, true)).toBe(true);
    expect(wantsNear(far, 0, 2, true)).toBe(true);
    expect(wantsNear(far, 2, 2, true)).toBe(false);
    expect(wantsNear(far, 1, 2, false)).toBe(false);
  });

  it('stops asking once the nearer levels are in', () => {
    expect(wantsNear(full, 0, 2, true)).toBe(false);
    expect(wantsNear(full, 1, 2, true)).toBe(false);
    expect(wantsNear([null, ['body']], 0, 1, true)).toBe(true);
    expect(wantsNear([['near'], ['body']], 0, 1, true)).toBe(false);
  });

  it('skips the early download on slow or saving connections', () => {
    expect(slowOf(undefined)).toBe(false);
    expect(slowOf({ effectiveType: '4g' })).toBe(false);
    expect(slowOf({ effectiveType: '3g' })).toBe(true);
    expect(slowOf({ effectiveType: '2g' })).toBe(true);
    expect(slowOf({ effectiveType: 'slow-2g' })).toBe(true);
    expect(slowOf({ effectiveType: '4g', saveData: true })).toBe(true);
  });
});
