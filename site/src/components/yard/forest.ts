export type TreeKind = 'new' | 'young' | 'mature' | 'conifer';
export type TreeShape = { name: string; height: number; crown: number; kind: TreeKind };
export type TreeChoice = { model: string; wide: number; tall: number; turn: number };
export type Role = 'band' | 'player' | 'walker';

export const TREE_SHAPES: readonly TreeShape[] = [
  { name: 'tree-new', height: 2.2, crown: 0.58, kind: 'new' },
  { name: 'tree-young-a', height: 5.1, crown: 2.11, kind: 'young' },
  { name: 'tree-young-b', height: 6.11, crown: 1.59, kind: 'young' },
  { name: 'tree-oak-a', height: 11.04, crown: 6.7, kind: 'mature' },
  { name: 'tree-oak-b', height: 13.3, crown: 5.14, kind: 'mature' },
  { name: 'tree-pecan', height: 13.97, crown: 5.88, kind: 'mature' },
  { name: 'tree-pine', height: 15, crown: 3.81, kind: 'conifer' },
  { name: 'tree-cedar', height: 8.26, crown: 1.67, kind: 'conifer' },
];

export const STRETCH_LOW = 0.7;
export const STRETCH_HIGH = 1.4;
export const NEW_CROWN = 1.04;
export const YOUNG_CROWN = 3.3;
export const DEAD_BAND = 0.15;
export const SCREEN = 1080;

export const CARS = ['car-sedan', 'car-hatchback', 'car-suv', 'car-coupe', 'car-pickup', 'car-van'];
export const CAR_SHARES = [0.27, 0.2, 0.25, 0.1, 0.14, 0.04];

const ROLES: Record<Role, { models: string[]; shares: number[] }> = {
  band: { models: ['person-stand', 'person-walk'], shares: [0.85, 0.15] },
  player: { models: ['person-run', 'person-walk', 'person-walk-b'], shares: [0.5, 0.25, 0.25] },
  walker: { models: ['person-walk', 'person-walk-b'], shares: [0.5, 0.5] },
};

export function mix(a: number, b: number, salt = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function spotHash(x: number, y: number): number {
  return mix(Math.round(x * 10), Math.round(y * 10), 7);
}

export function share(key: number, salt: number): number {
  return mix(key, salt, 31) / 4294967296;
}

export function weighted(list: readonly string[], shares: readonly number[], roll: number): string {
  let total = 0;
  for (const value of shares) total += value;
  let left = roll * total;
  for (let index = 0; index < list.length; index += 1) {
    left -= shares[index] ?? 0;
    if (left < 0) return list[index];
  }
  return list[list.length - 1];
}

export function stretchOf(shape: TreeShape, radius: number, height: number): number {
  return height / radius / (shape.height / shape.crown);
}

function fits(stretch: number): boolean {
  return stretch >= STRETCH_LOW && stretch <= STRETCH_HIGH;
}

export function tierOf(radius: number): TreeKind {
  if (radius < NEW_CROWN) return 'new';
  if (radius < YOUNG_CROWN) return 'young';
  return 'mature';
}

export function chooseTree(tree: { radius: number; height: number; needle?: boolean }, key: number, shapes: readonly TreeShape[] = TREE_SHAPES, out?: TreeChoice): TreeChoice {
  const radius = Math.max(tree.radius, 1e-3);
  const height = Math.max(tree.height, 1e-3);
  let conifers = 0;
  for (let index = 0; index < shapes.length; index += 1) if (shapes[index].kind === 'conifer') conifers += 1;
  const needle = tree.needle === true && conifers > 0;
  const tier = tierOf(radius);
  const inFamily = (shape: TreeShape) => (shape.kind === 'conifer') === needle;
  const inPool = (shape: TreeShape) => inFamily(shape) && (needle || shape.kind === tier);
  let valid = 0;
  for (let index = 0; index < shapes.length; index += 1) if (inPool(shapes[index]) && fits(stretchOf(shapes[index], radius, height))) valid += 1;
  let shape = shapes[0];
  if (valid > 0) {
    let left = key % valid;
    for (let index = 0; index < shapes.length; index += 1) {
      const option = shapes[index];
      if (!inPool(option) || !fits(stretchOf(option, radius, height))) continue;
      if (left === 0) {
        shape = option;
        break;
      }
      left -= 1;
    }
  } else {
    let best = Infinity;
    for (let index = 0; index < shapes.length; index += 1) {
      const option = shapes[index];
      if (!inFamily(option)) continue;
      const miss = Math.abs(Math.log(stretchOf(option, radius, height)));
      if (miss < best) {
        best = miss;
        shape = option;
      }
    }
  }
  const wide = radius / shape.crown;
  const result = out ?? { model: '', wide: 0, tall: 0, turn: 0 };
  result.model = shape.name;
  result.wide = wide;
  result.tall = Math.min(wide * STRETCH_HIGH, Math.max(wide * STRETCH_LOW, height / shape.height));
  result.turn = ((mix(key, 3, 11) % 3600) / 3600) * Math.PI * 2;
  return result;
}

export function reach(distance: number, size: number, screen: number, reference: number): number {
  return distance * (reference / Math.max(size, 0.25)) * (SCREEN / Math.max(screen, 1));
}

export function levelFor(distance: number, edges: readonly number[], current = -1, band = DEAD_BAND): number {
  let level = 0;
  while (level < edges.length && distance >= edges[level]) level += 1;
  if (current < 0 || level <= current) return level;
  let next = current;
  while (next < edges.length && distance >= edges[next] * (1 + band)) next += 1;
  return next;
}

export function chooseCar(key: number): string {
  return weighted(CARS, CAR_SHARES, share(key, 5));
}

export function choosePerson(role: Role, key: number): string {
  const { models, shares } = ROLES[role];
  return weighted(models, shares, share(key, 9));
}

export function modelled(kinds: ReadonlySet<string>, tree: { needle?: boolean }): boolean {
  if (kinds.has('broadleaf')) return true;
  return tree.needle === true && kinds.has('conifers');
}

export function arrived(levels: readonly unknown[], level: number): number {
  for (let at = Math.max(0, level); at < levels.length; at += 1) if (levels[at]) return at;
  for (let at = Math.min(level, levels.length) - 1; at >= 0; at -= 1) if (levels[at]) return at;
  return -1;
}

export function nearOrder(conifers: boolean): string[] {
  return conifers ? ['broadleaf', 'cars', 'poles', 'people', 'conifers'] : ['broadleaf', 'cars', 'poles', 'people'];
}

export function phaseOf(far: ReadonlySet<string>, full: ReadonlySet<string>, kind: string): 'none' | 'far' | 'full' {
  if (full.has(kind)) return 'full';
  return far.has(kind) ? 'far' : 'none';
}
