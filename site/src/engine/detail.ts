import type { RoofShape, Tone } from './campus';
import type { Point, Ring } from './geometry';
import { frameOf } from './sports';

export const TONES: Record<Tone, string> = {
  pale: '#eceeea',
  cream: '#ede3cf',
  sand: '#dccbaa',
  brick: '#c99682',
  tile: '#c47e68',
  grey: '#c6cbca',
  dark: '#8b9592',
  green: '#a9bea4',
  blue: '#b5c6d1',
};

const SEEN: Partial<Record<Tone, [number, number, number]>> = {
  pale: [205, 205, 200],
  grey: [148, 150, 150],
  dark: [86, 90, 94],
  tile: [156, 96, 78],
  sand: [172, 152, 122],
  green: [104, 122, 98],
};

const NAMED: Record<string, string> = {
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  snow: '#fffafa',
  ivory: '#fffff0',
  beige: '#f5f5dc',
  cream: '#f3ead2',
  linen: '#faf0e6',
  wheat: '#f5deb3',
  tan: '#d2b48c',
  khaki: '#c3b091',
  yellow: '#ffff00',
  lightyellow: '#ffffe0',
  gold: '#ffd700',
  orange: '#ffa500',
  red: '#ff0000',
  darkred: '#8b0000',
  maroon: '#800000',
  brown: '#a52a2a',
  sienna: '#a0522d',
  salmon: '#fa8072',
  pink: '#ffc0cb',
  terracotta: '#e2725b',
  grey: '#808080',
  gray: '#808080',
  lightgrey: '#d3d3d3',
  lightgray: '#d3d3d3',
  silver: '#c0c0c0',
  darkgrey: '#a9a9a9',
  darkgray: '#a9a9a9',
  dimgray: '#696969',
  dimgrey: '#696969',
  black: '#000000',
  green: '#008000',
  darkgreen: '#006400',
  lightgreen: '#90ee90',
  olive: '#808000',
  blue: '#0000ff',
  lightblue: '#add8e6',
  navy: '#000080',
  teal: '#008080',
  cyan: '#00ffff',
  purple: '#800080',
};

const MATERIAL: Record<string, Tone> = {
  brick: 'brick',
  bricks: 'brick',
  concrete: 'grey',
  cement_block: 'grey',
  reinforced_concrete: 'grey',
  stone: 'sand',
  sandstone: 'sand',
  limestone: 'cream',
  wood: 'sand',
  timber_framing: 'sand',
  glass: 'blue',
  metal: 'grey',
  steel: 'grey',
  aluminium: 'grey',
  plaster: 'pale',
  render: 'pale',
  stucco: 'cream',
  vinyl: 'pale',
  roof_tiles: 'tile',
  tiles: 'tile',
  clay: 'tile',
  asphalt: 'dark',
  tar_paper: 'dark',
  slate: 'dark',
  copper: 'green',
  grass: 'green',
  thatch: 'sand',
  gravel: 'grey',
};

const SHAPES: Record<string, RoofShape> = {
  gabled: 'gabled',
  hipped: 'hipped',
  pyramidal: 'pyramidal',
  skillion: 'skillion',
  dome: 'dome',
  flat: 'flat',
  half_hipped: 'hipped',
  gambrel: 'gabled',
  saltbox: 'gabled',
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function rgbOf(text: string | undefined): [number, number, number] | null {
  if (!text) return null;
  let value = text.trim().toLowerCase().replace(/[\s_-]/g, '');
  value = NAMED[value] ?? value;
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)];
  const long = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  return null;
}

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot((la - lb) * 0.5, aa - ab, ba - bb);
}

function nearest(rgb: [number, number, number], table: Partial<Record<Tone, [number, number, number] | string>>, skip: Tone[] = []): Tone {
  let best: Tone = 'pale';
  let gap = Infinity;
  for (const [name, value] of Object.entries(table) as [Tone, [number, number, number] | string][]) {
    if (skip.includes(name)) continue;
    const target = typeof value === 'string' ? (rgbOf(value) as [number, number, number]) : value;
    const away = distance(rgb, target);
    if (away < gap) {
      gap = away;
      best = name;
    }
  }
  return best;
}

const WALL_ONLY: Tone[] = ['brick', 'cream'];
const ROOF_ONLY: Tone[] = ['tile'];

export function toneOf(colour: string | undefined, part: 'wall' | 'roof' = 'wall'): Tone | undefined {
  const rgb = rgbOf(colour);
  return rgb ? nearest(rgb, TONES, part === 'wall' ? ROOF_ONLY : WALL_ONLY) : undefined;
}

export function materialTone(material: string | undefined): Tone | undefined {
  return material ? MATERIAL[material.trim().toLowerCase()] : undefined;
}

export function photoTone(red: number, green: number, blue: number): Tone {
  const [l, a, b] = lab([red, green, blue]);
  let best: Tone = 'pale';
  let gap = Infinity;
  for (const [name, value] of Object.entries(SEEN) as [Tone, [number, number, number]][]) {
    const [tl, ta, tb] = lab(value);
    const away = Math.hypot(l - tl, a - ta, b - tb);
    if (away < gap) {
      gap = away;
      best = name;
    }
  }
  return best;
}

export function roofShape(value: string | undefined): RoofShape | undefined {
  return value ? SHAPES[value.trim().toLowerCase()] : undefined;
}

export function bearing(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const text = value.trim().toUpperCase();
  const index = COMPASS.indexOf(text);
  if (index >= 0) return index * 22.5;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? ((number % 360) + 360) % 360 : undefined;
}

export function metres(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return undefined;
  if (/(ft|feet|')\s*$/.test(text)) return number * 0.3048;
  return number;
}

export function roofRise(shape: RoofShape, ring: Ring): number {
  const short = frameOf(ring).short;
  if (shape === 'flat') return 0;
  if (shape === 'skillion') return Math.min(4, Math.max(0.6, short * 0.15));
  if (shape === 'dome') return Math.min(15, Math.max(1, short * 0.5));
  return Math.min(8, Math.max(1.2, short * 0.3));
}

export function standHeight(ring: Ring): number {
  const deep = frameOf(ring).short;
  return Math.round(Math.min(14, Math.max(1.5, deep * 0.4 + 1)) * 10) / 10;
}

export function bufferLine(line: Ring, half: number): Ring {
  const points: Point[] = [];
  for (const point of line) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-3) points.push(point);
  }
  if (points.length < 2) return [];
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const into = i > 0 ? unit(before, points[i]) : unit(points[i], after);
    const out = i < points.length - 1 ? unit(points[i], after) : into;
    let nx = -(into[1] + out[1]);
    let ny = into[0] + out[0];
    const size = Math.hypot(nx, ny);
    if (size < 1e-6) {
      nx = -into[1];
      ny = into[0];
    } else {
      nx /= size;
      ny /= size;
    }
    const stretch = 1 / Math.max(0.5, nx * -into[1] + ny * into[0]);
    left.push([points[i][0] + nx * half * stretch, points[i][1] + ny * half * stretch]);
    right.push([points[i][0] - nx * half * stretch, points[i][1] - ny * half * stretch]);
  }
  return [...left, ...right.reverse()];
}

function unit(a: Point, b: Point): Point {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return length > 0 ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0];
}
