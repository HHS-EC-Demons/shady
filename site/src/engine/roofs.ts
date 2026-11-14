import type { Block, Campus, RoofPhoto } from './campus';
import type { Box, Ring } from './geometry';
import type { Photo } from './naip';
import { polygonSpans, type Grid } from './raster';

export type { RoofPhoto } from './campus';
export type Mute = { contrast: number; color: number; sharpen?: number };
export type Look = { base: [number, number, number]; contrast: number; color: number };
export type Dressed = { width: number; height: number; data: Uint8Array; box: Box; blocks: number[] };

export const ROOF_MUTE: Mute = { contrast: 1, color: 0.75 };
export const ROOF_FLOOR = 0.42;

const BAND = 1.5;
const BAND_SOFT = 0.35;
const LIFT = 0.92;
const COOL_LOW = 1.04;
const COOL_HIGH = 1.18;
const DIM_HIGH = 0.97;
const DIM_LOW = 0.78;
const SPREAD = 1.6;
const LEAF_LOW = 0.1;
const LEAF_HIGH = 0.22;
const SHARPEN = 0.9;
const FACET = 1.5;
const FLATTEN = 0.8;
const NATIVE = 0.6;
const REACH = 6;
const LEAST = 30;
const LUMA = [0.2126, 0.7152, 0.0722];
const NEUTRAL: [number, number, number] = [0.63, 0.62, 0.59];
const DARK_HIGH = 0.5;
const DARK_LOW = 0.18;
const TINT_LOW = 0.12;
const TINT_HIGH = 0.4;
const TINT_KEEP = 0.34;
const TINT_LIFT = 0.7;
const DROP = 0.6;
const RISE = 0.8;
const DATA = /^data:image\/(webp|png);base64,[A-Za-z0-9+/]+=*$/;
const FILE = /^[a-z0-9/_-]+\.webp$/i;

const linear = new Float32Array(256);
for (let value = 0; value < 256; value += 1) {
  const share = value / 255;
  linear[value] = share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
}

function toByte(value: number): number {
  const share = Math.min(1, Math.max(0, value));
  const curved = share <= 0.0031308 ? share * 12.92 : 1.055 * share ** (1 / 2.4) - 0.055;
  return Math.round(curved * 255);
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lumaOf(color: ArrayLike<number>): number {
  return color[0] * LUMA[0] + color[1] * LUMA[1] + color[2] * LUMA[2];
}

export function roofPhotoOf(campus: Campus): RoofPhoto | null {
  const value: unknown = campus.roofs;
  if (!value || typeof value !== 'object') return null;
  const photo = value as Record<string, unknown>;
  const numbers = [photo.minX, photo.minY, photo.maxX, photo.maxY];
  if (typeof photo.src !== 'string' || !(DATA.test(photo.src) || FILE.test(photo.src))) return null;
  if (typeof photo.date !== 'string' || !numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  const [minX, minY, maxX, maxY] = numbers as number[];
  if (maxX <= minX || maxY <= minY) return null;
  const blocks = Array.isArray(photo.blocks) ? photo.blocks.filter((item): item is number => Number.isInteger(item) && item >= 0 && item < campus.blocks.length) : [];
  return { src: photo.src, date: photo.date, minX, minY, maxX, maxY, blocks };
}

function encode(value: number): number {
  const share = Math.min(1, Math.max(0, value));
  return share <= 0.0031308 ? share * 12.92 : 1.055 * share ** (1 / 2.4) - 0.055;
}

function decode(value: number): number {
  const share = Math.min(1, Math.max(0, value));
  return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
}

export function roofLook(middle: ArrayLike<number>, mute: Mute = ROOF_MUTE): Look {
  const light = Math.max(1e-4, lumaOf(middle));
  const high = Math.max(middle[0], middle[1], middle[2]);
  const tint = high > 1e-4 ? (high - Math.min(middle[0], middle[1], middle[2])) / high : 0;
  const tinted = smooth(TINT_LOW, TINT_HIGH, tint);
  const pull = Math.max(smooth(DARK_HIGH, DARK_LOW, light), tinted * TINT_LIFT);
  const target = Math.max(ROOF_FLOOR, light + (lumaOf(NEUTRAL) - light) * pull);
  const keep = mute.color + (TINT_KEEP - mute.color) * tinted;
  const gray = encode(light);
  const lifted = encode(target);
  const base: [number, number, number] = [0, 0, 0];
  for (let band = 0; band < 3; band += 1) base[band] = decode(lifted + (encode(middle[band]) - gray) * keep);
  const scale = target / Math.max(1e-4, lumaOf(base));
  for (let band = 0; band < 3; band += 1) base[band] = Math.min(1, base[band] * scale);
  return { base, contrast: mute.contrast * (1 - 0.45 * pull), color: keep };
}

export function partBoxes(campus: Campus, margin = REACH + 2): Box[] {
  return campus.blocks
    .filter((block) => block.home && !block.stand && block.ring.length > 2)
    .map((block) => {
      const xs = block.ring.map((point) => point[0]);
      const ys = block.ring.map((point) => point[1]);
      return { minX: Math.min(...xs) - margin, minY: Math.min(...ys) - margin, maxX: Math.max(...xs) + margin, maxY: Math.max(...ys) + margin };
    });
}

export function homeBox(campus: Campus, margin = REACH + 2): Box | null {
  let box: Box | null = null;
  for (const block of campus.blocks) {
    if (!block.home || block.stand) continue;
    for (const [x, y] of block.ring) {
      box ??= { minX: x, minY: y, maxX: x, maxY: y };
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box ? { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin } : null;
}

export function windowOf(photo: Photo, box: Box): Photo | null {
  const left = Math.max(0, Math.floor((box.minX - photo.minX) / photo.cell));
  const bottom = Math.max(0, Math.floor((box.minY - photo.minY) / photo.cell));
  const right = Math.min(photo.cols, Math.ceil((box.maxX - photo.minX) / photo.cell));
  const top = Math.min(photo.rows, Math.ceil((box.maxY - photo.minY) / photo.cell));
  const cols = right - left;
  const rows = top - bottom;
  if (cols < 2 || rows < 2) return null;
  const cut = (band: Uint8Array) => {
    const out = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) out.set(band.subarray((bottom + row) * photo.cols + left, (bottom + row) * photo.cols + right), row * cols);
    return out;
  };
  return {
    ...photo,
    minX: photo.minX + left * photo.cell,
    minY: photo.minY + bottom * photo.cell,
    cols,
    rows,
    red: cut(photo.red),
    green: cut(photo.green),
    blue: cut(photo.blue),
    nir: cut(photo.nir),
    seen: cut(photo.seen),
  };
}

export function photoBox(photo: Photo): Box {
  return { minX: photo.minX, minY: photo.minY, maxX: photo.minX + photo.cols * photo.cell, maxY: photo.minY + photo.rows * photo.cell };
}

function inside(box: Box, ring: Ring, margin: number): boolean {
  return ring.every(([x, y]) => x >= box.minX + margin && x <= box.maxX - margin && y >= box.minY + margin && y <= box.maxY - margin);
}

function blur(values: Float32Array, cols: number, rows: number, radius: number, scratch: Float32Array): void {
  const span = 2 * radius + 1;
  for (let pass = 0; pass < 3; pass += 1) {
    for (let row = 0; row < rows; row += 1) {
      const start = row * cols;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += values[start + Math.min(cols - 1, Math.max(0, k))];
      for (let col = 0; col < cols; col += 1) {
        scratch[start + col] = sum / span;
        sum += values[start + Math.min(cols - 1, col + radius + 1)] - values[start + Math.max(0, col - radius)];
      }
    }
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += scratch[Math.min(rows - 1, Math.max(0, k)) * cols + col];
      for (let row = 0; row < rows; row += 1) {
        values[row * cols + col] = sum / span;
        sum += scratch[Math.min(rows - 1, row + radius + 1) * cols + col] - scratch[Math.max(0, row - radius) * cols + col];
      }
    }
  }
}

function edt1(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) {
      v[k] = q;
      continue;
    }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    if (s <= z[k] && k === 0) {
      v[0] = q;
      z[1] = Infinity;
      continue;
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const gap = q - v[k];
    d[q] = f[v[k]] === Infinity ? Infinity : gap * gap + f[v[k]];
  }
}

function edgeDistance(owner: Int32Array, cols: number, rows: number): Float32Array {
  const size = cols * rows;
  const field = new Float32Array(size);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const mine = owner[index];
      const edge =
        mine < 0 ||
        col === 0 ||
        row === 0 ||
        col === cols - 1 ||
        row === rows - 1 ||
        owner[index - 1] !== mine ||
        owner[index + 1] !== mine ||
        owner[index - cols] !== mine ||
        owner[index + cols] !== mine;
      field[index] = edge ? 0 : Infinity;
    }
  }
  const most = Math.max(cols, rows);
  const f = new Float32Array(most);
  const d = new Float32Array(most);
  const v = new Int32Array(most);
  const z = new Float32Array(most + 1);
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) f[row] = field[row * cols + col];
    edt1(f, rows, d, v, z);
    for (let row = 0; row < rows; row += 1) field[row * cols + col] = d[row];
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) f[col] = field[row * cols + col];
    edt1(f, cols, d, v, z);
    for (let col = 0; col < cols; col += 1) field[row * cols + col] = Math.sqrt(d[col]);
  }
  return field;
}

function median(histogram: Uint32Array, count: number): number {
  let seen = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += histogram[value];
    if (seen * 2 >= count) return value;
  }
  return 255;
}

export function dressRoofs(photo: Photo, all: Block[], mute: Mute = ROOF_MUTE): Dressed | null {
  const { cols, rows, cell } = photo;
  const size = cols * rows;
  const grid: Grid = { cols, rows, cell, minX: photo.minX, minY: photo.minY };
  const box = photoBox(photo);
  const picked = all.map((block, index) => ({ block, index })).filter(({ block }) => block.home && !block.stand && inside(box, block.ring, REACH));
  const blocks = picked.map((item) => item.block);
  const owner = new Int32Array(size).fill(-1);
  const order = blocks.map((_, index) => index).sort((a, b) => blocks[a].height - blocks[b].height);
  for (const index of order) polygonSpans(grid, blocks[index].ring, (row, from, to) => owner.fill(index, row * cols + from, row * cols + to + 1));
  const blocked = new Uint8Array(size);
  const taken = new Set(blocks);
  for (const block of all) {
    if (taken.has(block)) continue;
    polygonSpans(grid, block.ring, (row, from, to) => blocked.fill(1, row * cols + from, row * cols + to + 1));
  }
  const edge = edgeDistance(owner, cols, rows);
  const count = blocks.length;
  const histograms = Array.from({ length: count * 3 }, () => new Uint32Array(256));
  const totals = new Uint32Array(count);
  const wide = new Uint32Array(count);
  for (let index = 0; index < size; index += 1) {
    const mine = owner[index];
    if (mine >= 0 && photo.seen[index] && edge[index] * cell > BAND) wide[mine] += 1;
  }
  for (let index = 0; index < size; index += 1) {
    const mine = owner[index];
    if (mine < 0 || !photo.seen[index]) continue;
    if (wide[mine] >= LEAST && edge[index] * cell <= BAND) continue;
    histograms[mine * 3][photo.red[index]] += 1;
    histograms[mine * 3 + 1][photo.green[index]] += 1;
    histograms[mine * 3 + 2][photo.blue[index]] += 1;
    totals[mine] += 1;
  }
  const middle = new Float32Array(count * 3);
  const middleLuma = new Float32Array(count);
  const looks: Look[] = [];
  const usable = new Uint8Array(count);
  for (let block = 0; block < count; block += 1) {
    if (totals[block] < LEAST) {
      looks.push({ base: [1, 1, 1], contrast: 0, color: 0 });
      continue;
    }
    usable[block] = 1;
    for (let band = 0; band < 3; band += 1) middle[block * 3 + band] = Math.max(1e-3, linear[median(histograms[block * 3 + band], totals[block])]);
    middleLuma[block] = Math.max(1e-4, lumaOf(middle.subarray(block * 3, block * 3 + 3)));
    looks.push(roofLook(middle.subarray(block * 3, block * 3 + 3), mute));
  }
  const used: number[] = [];
  for (let block = 0; block < count; block += 1) if (usable[block]) used.push(picked[block].index);
  if (used.length === 0) return null;
  const luma = new Float32Array(size);
  const shade = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const mine = owner[index];
    if (mine < 0 || !usable[mine] || !photo.seen[index]) continue;
    const r = linear[photo.red[index]];
    const b = linear[photo.blue[index]];
    luma[index] = r * LUMA[0] + linear[photo.green[index]] * LUMA[1] + b * LUMA[2];
    const cool = (b + 0.004) / (r + 0.004) / ((middle[mine * 3 + 2] + 0.004) / (middle[mine * 3] + 0.004));
    const leaf = (photo.nir[index] - photo.red[index]) / Math.max(1, photo.nir[index] + photo.red[index]);
    shade[index] = Math.max(smooth(COOL_LOW, COOL_HIGH, cool) * smooth(DIM_HIGH, DIM_LOW, luma[index] / middleLuma[mine]), smooth(LEAF_LOW, LEAF_HIGH, leaf) / LIFT);
  }
  const spread = Float32Array.from(shade);
  blur(spread, cols, rows, 1, new Float32Array(size));
  for (let index = 0; index < size; index += 1) shade[index] = Math.min(1, Math.max(shade[index], spread[index] * SPREAD));
  const reach = new Int32Array(size).fill(-1);
  const hops = new Float32Array(size).fill(Infinity);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < size; index += 1) {
    const mine = owner[index];
    if (mine < 0 || !usable[mine]) continue;
    reach[index] = mine;
    hops[index] = 0;
    queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    const row = Math.floor(index / cols);
    const col = index - row * cols;
    const next = hops[index] + 1;
    const visit = (other: number) => {
      if (hops[other] <= next) return;
      hops[other] = next;
      reach[other] = reach[index];
      queue[tail++] = other;
    };
    if (col > 0) visit(index - 1);
    if (col < cols - 1) visit(index + 1);
    if (row > 0) visit(index - cols);
    if (row < rows - 1) visit(index + cols);
  }
  const level = new Float32Array(size);
  const weight = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const mine = owner[index];
    if (mine < 0 || !usable[mine] || !photo.seen[index]) continue;
    const own = Math.max(1e-4, luma[index]);
    level[index] = own + (middleLuma[mine] - own) * Math.min(1, shade[index] * LIFT);
    weight[index] = 1;
  }
  const broad = Float32Array.from(level);
  const scratch = new Float32Array(size);
  const radius = Math.max(1, Math.round(FACET / cell));
  blur(broad, cols, rows, radius, scratch);
  blur(weight, cols, rows, radius, scratch);
  const ratio = new Float32Array(size * 3);
  const inner = new Float32Array(size);
  let left = cols;
  let right = -1;
  let low = rows;
  let high = -1;
  for (let index = 0; index < size; index += 1) {
    const near = reach[index];
    if (near < 0) continue;
    const mine = owner[index];
    if (!blocked[index] && !(mine >= 0 && !usable[mine]) && hops[index] * cell <= REACH) {
      const row = Math.floor(index / cols);
      const col = index - row * cols;
      left = Math.min(left, col);
      right = Math.max(right, col);
      low = Math.min(low, row);
      high = Math.max(high, row);
    }
    ratio[index * 3] = 1;
    ratio[index * 3 + 1] = 1;
    ratio[index * 3 + 2] = 1;
    if (mine !== near || !photo.seen[index]) continue;
    const own = Math.max(1e-4, luma[index]);
    const ml = middleLuma[near];
    const lift = Math.min(1, shade[index] * LIFT);
    const even = weight[index] > 1e-3 ? broad[index] / weight[index] : ml;
    const target = level[index] * (ml / Math.max(1e-4, even)) ** FLATTEN;
    for (let band = 0; band < 3; band += 1) {
      const value = band === 0 ? photo.red[index] : band === 1 ? photo.green[index] : photo.blue[index];
      const m = middle[near * 3 + band];
      ratio[index * 3 + band] = (((linear[value] / own) * (1 - lift) + (m / ml) * lift) * target) / m;
    }
    inner[index] = smooth(BAND - BAND_SOFT, BAND + BAND_SOFT, edge[index] * cell);
  }
  if (right < left || high < low) return null;
  const width = right - left + 1;
  const height = high - low + 1;
  const data = new Uint8Array(width * height * 4);
  for (let row = low; row <= high; row += 1) {
    const out = (high - row) * width;
    for (let col = left; col <= right; col += 1) {
      const index = row * cols + col;
      const near = reach[index];
      if (near < 0) continue;
      const at = (out + col - left) * 4;
      const look = looks[near];
      const weight = inner[index] * look.contrast;
      const color = [look.base[0], look.base[1], look.base[2]];
      if (weight > 0) {
        const change = [0, 0, 0];
        for (let band = 0; band < 3; band += 1) {
          let sum = 0;
          let seen = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const y = row + dy;
            if (y < 0 || y >= rows) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const x = col + dx;
              if (x < 0 || x >= cols) continue;
              sum += ratio[(y * cols + x) * 3 + band];
              seen += 1;
            }
          }
          const own = ratio[index * 3 + band];
          const sharp = own + (own - sum / seen) * (mute.sharpen ?? SHARPEN);
          change[band] = Math.min(RISE, Math.max(-DROP, sharp - 1)) * weight;
        }
        const even = lumaOf(change);
        for (let band = 0; band < 3; band += 1) color[band] *= 1 + even + (change[band] - even) * look.color;
      }
      data[at] = toByte(color[0]);
      data[at + 1] = toByte(color[1]);
      data[at + 2] = toByte(color[2]);
      const mine = owner[index];
      data[at + 3] = blocked[index] || (mine >= 0 && !usable[mine]) || hops[index] * cell > REACH ? 0 : 255;
    }
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    width,
    height,
    data,
    box: { minX: round(photo.minX + left * cell), minY: round(photo.minY + low * cell), maxX: round(photo.minX + (right + 1) * cell), maxY: round(photo.minY + (high + 1) * cell) },
    blocks: used,
  };
}

type Canvas2d = {
  getContext: (kind: '2d') => { putImageData: (image: ImageData, x: number, y: number) => void } | null;
  convertToBlob: (options: { type: string; quality: number }) => Promise<Blob>;
};

export async function encodeRoofs(dressed: Dressed): Promise<string | null> {
  const Maker = (globalThis as { OffscreenCanvas?: new (width: number, height: number) => Canvas2d }).OffscreenCanvas;
  if (!Maker || typeof ImageData !== 'function') return null;
  const canvas = new Maker(dressed.width, dressed.height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = new Uint8ClampedArray(dressed.data.length);
  pixels.set(dressed.data);
  context.putImageData(new ImageData(pixels, dressed.width, dressed.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 });
  if (blob.type !== 'image/webp' && blob.type !== 'image/png') return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return `data:${blob.type};base64,${btoa(text)}`;
}

export function muteFor(gsd: number, mute: Mute = ROOF_MUTE): Mute {
  const fine = Math.min(1, Math.max(0, NATIVE / gsd));
  return { contrast: mute.contrast * (0.4 + 0.6 * fine * fine), color: mute.color, sharpen: (mute.sharpen ?? SHARPEN) * fine * fine };
}

export async function roofsFrom(photo: Photo, campus: Campus): Promise<RoofPhoto | null> {
  const box = homeBox(campus);
  const part = box ? windowOf(photo, box) : null;
  const dressed = part ? dressRoofs(part, campus.blocks, muteFor(photo.gsd)) : null;
  if (!dressed) return null;
  const src = await encodeRoofs(dressed);
  return src ? { src, date: photo.date, ...dressed.box, blocks: dressed.blocks } : null;
}
