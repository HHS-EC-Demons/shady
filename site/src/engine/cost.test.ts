import { describe, expect, it } from 'vitest';
import { YEARS, treeHeight, treeRadius } from '../components/yard/controller';
import { dollars, planCost, sailArea } from './cost';
import type { Sail } from './shade';

const sail: Sail = {
  id: 1,
  corners: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  height: 4.5,
};

describe('cost', () => {
  it('measures a sail in square feet', () => {
    expect(sailArea(sail)).toBeCloseTo(861.1, 0);
  });

  it('prices trees and sails as a range', () => {
    const cost = planCost(30, []);
    expect(cost).toEqual({ low: 4800, high: 9000 });
    const withSail = planCost(0, [sail]);
    expect(withSail.low).toBeCloseTo(12917, -1);
    expect(withSail.high).toBeGreaterThan(withSail.low);
  });

  it('rounds money to a readable figure', () => {
    expect(dollars(4800)).toBe('$4,800');
    expect(dollars(12917)).toBe('$13,000');
    expect(dollars(160)).toBe('$200');
  });
});

describe('tree growth', () => {
  it('starts near seven feet and grows about a foot a year', () => {
    expect(treeHeight(0) / 0.3048).toBeCloseTo(7);
    expect(treeHeight(20) / 0.3048).toBeCloseTo(31);
  });

  it('gives a wider canopy every step and stays under a grown oak', () => {
    const spreads = YEARS.map((years) => treeRadius(years) * 2 * 3.28084);
    for (let i = 1; i < spreads.length; i += 1) expect(spreads[i]).toBeGreaterThan(spreads[i - 1]);
    expect(spreads[spreads.length - 1]).toBeLessThan(50);
    expect(spreads[0]).toBeGreaterThan(10);
  });
});
