import type { Sail } from './shade';

export const TREE_COST = { low: 160, high: 300 };
export const SAIL_COST_PER_SQUARE_FOOT = { low: 15, high: 23 };
const SQUARE_FEET_PER_SQUARE_METER = 10.7639;

export function sailArea(sail: Sail): number {
  const [a, , c] = sail.corners;
  return Math.abs(c[0] - a[0]) * Math.abs(c[1] - a[1]) * SQUARE_FEET_PER_SQUARE_METER;
}

export function planCost(trees: number, sails: Sail[]): { low: number; high: number } {
  const area = sails.reduce((sum, sail) => sum + sailArea(sail), 0);
  return {
    low: trees * TREE_COST.low + area * SAIL_COST_PER_SQUARE_FOOT.low,
    high: trees * TREE_COST.high + area * SAIL_COST_PER_SQUARE_FOOT.high,
  };
}

export function dollars(amount: number): string {
  const rounded = amount >= 10000 ? Math.round(amount / 1000) * 1000 : Math.round(amount / 100) * 100;
  return `$${rounded.toLocaleString('en-US')}`;
}
