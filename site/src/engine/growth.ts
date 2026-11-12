export const TREE_TALL = 1.85;
export const YEARS = [5, 10, 20, 30];
export const START_FEET = 7;
export const GROWTH_FEET = 1.2;

export function treeHeight(years: number): number {
  return (START_FEET + GROWTH_FEET * years) * 0.3048;
}

export function treeRadius(years: number): number {
  return treeHeight(years) / TREE_TALL;
}
