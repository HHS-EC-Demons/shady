import type { Campus, Tree } from './campus';
import { clamp, insideRing, ringArea, ringDistance, type Ring } from './geometry';
import type { Photo } from './naip';
import { polygonSpans, type Grid } from './raster';

export type FieldCall = { patch: number; surface: 'grass' | 'turf' };

export type Layers = {
  grid: Grid;
  size: number;
  photo: Photo;
  roof: Uint8Array;
  ndvi: Float32Array;
  vis: Float32Array;
  near: Float32Array;
  level: Float32Array;
  veg: number;
  vegMask: Uint8Array;
  shadow: number;
};

export type Canopy = { trees: Tree[]; mask: Uint8Array };

const PITCH = /field|court|track|play area|band pad|playground/i;
const CAP = 7;
const OVERLAP = 0.9;
const EVIDENCE = 6;
const GRAIN = 1.5;
const ISLAND = 1;
const ISLAND_GRAIN = 3.5;
const SHADE = 0.6;
const THIN = 2.5;
const SPOKES = 16;
const SMOOTH = 4;
const LARGE = 400;
const MARGIN = 15;
const ISLAND_AREA = 7;
const LAWN_AREA = 12;
const LEAST_LAWN = 300;

export function gridOf(photo: Photo): Grid {
  return { cols: photo.cols, rows: photo.rows, cell: photo.cell, minX: photo.minX, minY: photo.minY };
}

function fill(grid: Grid, ring: Ring, target: Uint8Array, value = 1): void {
  polygonSpans(grid, ring, (row, from, to) => target.fill(value, row * grid.cols + from, row * grid.cols + to + 1));
}

export function sample(values: ArrayLike<number>, pick: (index: number) => boolean): Float32Array {
  let count = 0;
  for (let index = 0; index < values.length; index += 1) if (pick(index)) count += 1;
  const out = new Float32Array(count);
  let next = 0;
  for (let index = 0; index < values.length; index += 1) if (pick(index)) out[next++] = values[index];
  return out.sort();
}

export function at(sorted: Float32Array, share: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))))];
}

export function otsu(values: ArrayLike<number>, pick: (index: number) => boolean, low: number, high: number, bins = 128): number {
  const counts = new Float64Array(bins);
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (!pick(index)) continue;
    counts[Math.min(bins - 1, Math.max(0, Math.floor(((values[index] - low) / (high - low)) * bins)))] += 1;
    total += 1;
  }
  if (total === 0) return (low + high) / 2;
  let sum = 0;
  for (let bin = 0; bin < bins; bin += 1) sum += bin * counts[bin];
  let weightLow = 0;
  let sumLow = 0;
  let best = 0;
  let split = bins / 2;
  for (let bin = 0; bin < bins; bin += 1) {
    weightLow += counts[bin];
    if (weightLow === 0) continue;
    const weightHigh = total - weightLow;
    if (weightHigh === 0) break;
    sumLow += bin * counts[bin];
    const between = weightLow * weightHigh * (sumLow / weightLow - (sum - sumLow) / weightHigh) ** 2;
    if (between > best) {
      best = between;
      split = bin + 1;
    }
  }
  return low + (split / bins) * (high - low);
}

export function boxMean(source: Float32Array, cols: number, rows: number, reach: number): Float32Array {
  const wide = cols + 1;
  const sums = new Float64Array(wide * (rows + 1));
  for (let row = 0; row < rows; row += 1) {
    let run = 0;
    for (let col = 0; col < cols; col += 1) {
      run += source[row * cols + col];
      sums[(row + 1) * wide + col + 1] = sums[row * wide + col + 1] + run;
    }
  }
  const out = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const r0 = Math.max(0, row - reach);
    const r1 = Math.min(rows, row + reach + 1);
    for (let col = 0; col < cols; col += 1) {
      const c0 = Math.max(0, col - reach);
      const c1 = Math.min(cols, col + reach + 1);
      const total = sums[r1 * wide + c1] - sums[r0 * wide + c1] - sums[r1 * wide + c0] + sums[r0 * wide + c0];
      out[row * cols + col] = total / ((r1 - r0) * (c1 - c0));
    }
  }
  return out;
}

function morph(mask: Uint8Array, cols: number, rows: number, grow: boolean): Uint8Array {
  const pass = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const want = grow ? 1 : 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let value = mask[index];
      if (value !== want && ((col > 0 && mask[index - 1] === want) || (col + 1 < cols && mask[index + 1] === want))) value = want;
      pass[index] = value;
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let value = pass[index];
      if (value !== want && ((row > 0 && pass[index - cols] === want) || (row + 1 < rows && pass[index + cols] === want))) value = want;
      out[index] = value;
    }
  }
  return out;
}

export function opened(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  return morph(morph(mask, cols, rows, false), cols, rows, true);
}

export function closed(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  return morph(morph(mask, cols, rows, true), cols, rows, false);
}

export function distance(mask: Uint8Array, cols: number, rows: number, edge = true): Float32Array {
  const far = 1e6;
  const out = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) out[index] = mask[index] ? far : 0;
  const diagonal = Math.SQRT2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (out[index] === 0) continue;
      let best = out[index];
      if (col > 0) best = Math.min(best, out[index - 1] + 1);
      if (row > 0) {
        best = Math.min(best, out[index - cols] + 1);
        if (col > 0) best = Math.min(best, out[index - cols - 1] + diagonal);
        if (col + 1 < cols) best = Math.min(best, out[index - cols + 1] + diagonal);
      }
      if (edge && (col === 0 || row === 0 || col === cols - 1)) best = Math.min(best, 1);
      out[index] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const index = row * cols + col;
      if (out[index] === 0) continue;
      let best = out[index];
      if (col + 1 < cols) best = Math.min(best, out[index + 1] + 1);
      if (row + 1 < rows) {
        best = Math.min(best, out[index + cols] + 1);
        if (col + 1 < cols) best = Math.min(best, out[index + cols + 1] + diagonal);
        if (col > 0) best = Math.min(best, out[index + cols - 1] + diagonal);
      }
      if (edge && row === rows - 1) best = Math.min(best, 1);
      out[index] = best;
    }
  }
  return out;
}

export function components(mask: Uint8Array, cols: number, rows: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop() as number;
      count += 1;
      const row = Math.floor(index / cols);
      const col = index - row * cols;
      const visit = (other: number) => {
        if (mask[other] && label[other] < 0) {
          label[other] = id;
          stack.push(other);
        }
      };
      if (col > 0) visit(index - 1);
      if (col + 1 < cols) visit(index + 1);
      if (row > 0) visit(index - cols);
      if (row + 1 < rows) visit(index + cols);
    }
    sizes.push(count);
  }
  return { label, sizes };
}

export function linear(mask: Uint8Array, cols: number, rows: number, spot: number, reach: number): boolean {
  const row = Math.floor(spot / cols);
  const col = spot - row * cols;
  const hits: number[] = [];
  for (let spoke = 0; spoke < SPOKES; spoke += 1) {
    const angle = (spoke / SPOKES) * Math.PI * 2;
    const r = Math.round(row + Math.sin(angle) * reach);
    const c = Math.round(col + Math.cos(angle) * reach);
    if (r >= 0 && c >= 0 && r < rows && c < cols && mask[r * cols + c]) hits.push(spoke);
  }
  if (hits.length < 2 || hits.length > SPOKES / 2) return false;
  for (const a of hits) {
    for (const b of hits) {
      const apart = Math.abs(a - b) % SPOKES;
      if (Math.min(apart, SPOKES - apart) >= (SPOKES * 3) / 8) return true;
    }
  }
  return false;
}

export function shaded(glow: Float32Array, cols: number, rows: number, spot: number, radius: number, dark: number): boolean {
  const row = Math.floor(spot / cols);
  const col = spot - row * cols;
  let hits = 0;
  for (let reach = radius + 1; reach <= radius + 4; reach += 1) {
    for (let spoke = 0; spoke < 32; spoke += 1) {
      const angle = (spoke / 32) * Math.PI * 2;
      const r = Math.round(row + Math.sin(angle) * reach);
      const c = Math.round(col + Math.cos(angle) * reach);
      if (r >= 0 && c >= 0 && r < rows && c < cols && glow[r * cols + c] < dark) hits += 1;
    }
  }
  return hits >= 4;
}

export function heightFor(radius: number): number {
  return Math.round(Math.min(24, 1.5 + radius * 2) * 10) / 10;
}

export function layersOf(photo: Photo, campus: Campus): Layers | null {
  const grid = gridOf(photo);
  const size = grid.cols * grid.rows;
  const { red, green, blue, nir, seen } = photo;
  const roof = new Uint8Array(size);
  for (const block of campus.blocks) fill(grid, block.ring, roof);
  const ndvi = new Float32Array(size);
  const vis = new Float32Array(size);
  const near = new Float32Array(size);
  let roofs = 0;
  for (let index = 0; index < size; index += 1) {
    const r = red[index];
    const n = nir[index];
    ndvi[index] = n + r > 0 ? (n - r) / (n + r) : 0;
    vis[index] = (r + green[index] + blue[index]) / 3;
    near[index] = n;
    if (roof[index] && seen[index]) roofs += 1;
  }
  const open = (index: number) => seen[index] === 1 && roof[index] === 0;
  const neutral = roofs > 200 ? at(sample(ndvi, (index) => roof[index] === 1 && seen[index] === 1), 0.5) : at(sample(ndvi, open), 0.2);
  const top = at(sample(ndvi, open), 0.99);
  if (!Number.isFinite(neutral) || !Number.isFinite(top) || top - neutral < 0.08) return null;
  const level = new Float32Array(size);
  for (let index = 0; index < size; index += 1) level[index] = (ndvi[index] - neutral) / (top - neutral);
  const veg = clamp(otsu(level, open, -0.5, 1.5), 0.3, 0.65);
  const vegMask = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) if (open(index) && level[index] > veg) vegMask[index] = 1;
  const shadow = 0.5 * at(sample(near, (index) => vegMask[index] === 1), 0.5);
  return { grid, size, photo, roof, ndvi, vis, near, level, veg, vegMask, shadow };
}

export function keepArea(grid: Grid, campus: Campus, margin: number): Uint8Array {
  const size = grid.cols * grid.rows;
  const keep = new Uint8Array(size);
  if (campus.boundary.length === 0) return keep.fill(1);
  for (const ring of campus.boundary) fill(grid, ring, keep);
  if (margin <= 0) return keep;
  const away = distance(keep.map((value) => 1 - value), grid.cols, grid.rows, false);
  for (let index = 0; index < size; index += 1) if (away[index] <= margin / grid.cell) keep[index] = 1;
  return keep;
}

export function findCanopy(layers: Layers, campus: Campus): Canopy {
  const { grid, size, roof, ndvi, vis, near, vegMask, shadow } = layers;
  const { cols, rows } = grid;
  const seen = layers.photo.seen;
  const bumps = new Float32Array(size);
  const inner = new Float32Array(size);
  const counted = new Float32Array(size);
  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      const index = row * cols + col;
      const bump = Math.abs(4 * near[index] - near[index - 1] - near[index + 1] - near[index - cols] - near[index + cols]);
      bumps[index] = bump;
      if (vegMask[index] && vegMask[index - 1] && vegMask[index + 1] && vegMask[index - cols] && vegMask[index + cols]) {
        inner[index] = bump;
        counted[index] = 1;
      }
    }
  }
  const roughAll = boxMean(bumps, cols, rows, 1);
  const innerSum = boxMean(inner, cols, rows, 1);
  const innerCount = boxMean(counted, cols, rows, 1);
  const pieces = components(vegMask, cols, rows);
  const large = LARGE / (grid.cell * grid.cell);
  const big = (index: number) => pieces.label[index] >= 0 && pieces.sizes[pieces.label[index]] > large;
  const rough = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    rough[index] = big(index) ? (innerCount[index] > 0 ? innerSum[index] / innerCount[index] : 0) : roughAll[index];
  }
  const lawn = new Uint8Array(size);
  for (const patch of campus.patches) {
    if (patch.surface === 'grass' && patch.label && /field/i.test(patch.label)) fill(grid, patch.ring, lawn);
  }
  const lawnInside = distance(lawn, cols, rows);
  let lawnPick = (index: number) => vegMask[index] === 1 && lawnInside[index] >= 4 / grid.cell && rough[index] < SMOOTH;
  let lawnCount = 0;
  for (let index = 0; index < size; index += 1) if (lawnPick(index)) lawnCount += 1;
  if (lawnCount < LEAST_LAWN) {
    const smooth = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) if (vegMask[index] && rough[index] < SMOOTH) smooth[index] = 1;
    const wide = distance(opened(smooth, cols, rows), cols, rows);
    lawnPick = (index: number) => wide[index] >= 5 / grid.cell;
    lawnCount = 0;
    for (let index = 0; index < size; index += 1) if (lawnPick(index)) lawnCount += 1;
  }
  const known = lawnCount >= LEAST_LAWN;
  const ratio = new Float32Array(size);
  for (let index = 0; index < size; index += 1) ratio[index] = near[index] / (vis[index] + 1);
  const spreadOf = (values: Float32Array, least: number, fallback: number) => {
    if (!known) return { mid: fallback, spread: 1 };
    const sorted = sample(values, lawnPick);
    return { mid: at(sorted, 0.5), spread: Math.max(least, (at(sorted, 0.9) - at(sorted, 0.1)) / 2.56) };
  };
  const lawnNdvi = spreadOf(ndvi, 0.02, 0);
  const lawnVis = spreadOf(vis, 4, 0);
  const lawnRatio = spreadOf(ratio, 0.05, 0);
  const lawnRough = spreadOf(rough, 0.6, 2);
  const evidence = new Float32Array(size);
  const grain = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const texture = clamp((rough[index] - lawnRough.mid) / lawnRough.spread, -2, 6);
    grain[index] = texture;
    if (!known) {
      evidence[index] = texture * 1.5;
      continue;
    }
    const green = clamp((ndvi[index] - lawnNdvi.mid) / lawnNdvi.spread, -3, 4);
    const dim = clamp((lawnVis.mid - vis[index]) / lawnVis.spread, -3, 4);
    const tilt = clamp((ratio[index] - lawnRatio.mid) / lawnRatio.spread, -3, 4);
    evidence[index] = green + dim + tilt + texture;
  }
  let mask: Uint8Array = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    if (vegMask[index] && big(index) && near[index] > shadow && evidence[index] > EVIDENCE && grain[index] > GRAIN) mask[index] = 1;
  }
  mask = closed(opened(mask, cols, rows), cols, rows);
  const island = new Uint8Array(size);
  const pieceEvidence = new Float64Array(pieces.sizes.length);
  const pieceGrain = new Float64Array(pieces.sizes.length);
  const pieceLight = new Float64Array(pieces.sizes.length);
  for (let index = 0; index < size; index += 1) {
    const piece = pieces.label[index];
    if (piece < 0 || big(index)) continue;
    pieceEvidence[piece] += evidence[index];
    pieceGrain[piece] += grain[index];
    pieceLight[piece] += near[index];
  }
  for (let index = 0; index < size; index += 1) {
    const piece = pieces.label[index];
    if (piece < 0 || big(index)) continue;
    const count = pieces.sizes[piece];
    if (pieceEvidence[piece] / count > ISLAND && pieceGrain[piece] / count > ISLAND_GRAIN && pieceLight[piece] / count > shadow) {
      mask[index] = 1;
      island[index] = 1;
    }
  }
  for (let index = 0; index < size; index += 1) if (!seen[index] || roof[index]) mask[index] = 0;
  const reach = distance(mask, cols, rows);
  const cap = CAP / grid.cell;
  const least = 1.5 / grid.cell;
  const order: number[] = [];
  for (let index = 0; index < size; index += 1) if (mask[index] && reach[index] >= least) order.push(index);
  order.sort((a, b) => Math.min(cap, reach[b]) - Math.min(cap, reach[a]) || reach[b] - reach[a] || a - b);
  const bucket = Math.ceil(cap * 2);
  const across = Math.ceil(cols / bucket) + 1;
  const hash = new Map<number, number[]>();
  const peaks: number[] = [];
  const radii: number[] = [];
  for (const index of order) {
    const row = Math.floor(index / cols);
    const col = index - row * cols;
    const radius = Math.min(cap, reach[index]);
    const hr = Math.floor(row / bucket);
    const hc = Math.floor(col / bucket);
    let free = true;
    for (let dr = -1; dr <= 1 && free; dr += 1) {
      for (let dc = -1; dc <= 1 && free; dc += 1) {
        for (const other of hash.get((hr + dr) * across + hc + dc) ?? []) {
          const orow = Math.floor(peaks[other] / cols);
          const ocol = peaks[other] - orow * cols;
          if (Math.hypot(orow - row, ocol - col) < (radii[other] + radius) * OVERLAP) {
            free = false;
            break;
          }
        }
      }
    }
    if (!free) continue;
    const key = hr * across + hc;
    const list = hash.get(key);
    if (list) list.push(peaks.length);
    else hash.set(key, [peaks.length]);
    peaks.push(index);
    radii.push(radius);
  }
  const owner = new Int32Array(size).fill(-1);
  let wave: number[] = [];
  peaks.forEach((index, label) => {
    owner[index] = label;
    wave.push(index);
  });
  while (wave.length > 0) {
    const next: number[] = [];
    for (const index of wave) {
      const row = Math.floor(index / cols);
      const col = index - row * cols;
      const label = owner[index];
      const spread = (other: number) => {
        if (mask[other] && owner[other] < 0) {
          owner[other] = label;
          next.push(other);
        }
      };
      if (col > 0) spread(index - 1);
      if (col + 1 < cols) spread(index + 1);
      if (row > 0) spread(index - cols);
      if (row + 1 < rows) spread(index + cols);
    }
    wave = next;
  }
  const count = peaks.length;
  const area = new Float64Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const sumEvidence = new Float64Array(count);
  const sumGrain = new Float64Array(count);
  const sumIsland = new Float64Array(count);
  for (let index = 0; index < size; index += 1) {
    const label = owner[index];
    if (label < 0) continue;
    const row = Math.floor(index / cols);
    area[label] += 1;
    sumX[label] += index - row * cols;
    sumY[label] += row;
    sumEvidence[label] += evidence[index];
    sumGrain[label] += grain[index];
    sumIsland[label] += island[index];
  }
  const blobs = components(mask, cols, rows);
  const blobReach = new Float32Array(blobs.sizes.length);
  const blobBox = new Float64Array(blobs.sizes.length * 4);
  for (let blob = 0; blob < blobs.sizes.length; blob += 1) blobBox.set([Infinity, Infinity, -Infinity, -Infinity], blob * 4);
  for (let index = 0; index < size; index += 1) {
    const blob = blobs.label[index];
    if (blob < 0) continue;
    const row = Math.floor(index / cols);
    const col = index - row * cols;
    blobReach[blob] = Math.max(blobReach[blob], reach[index]);
    blobBox[blob * 4] = Math.min(blobBox[blob * 4], col);
    blobBox[blob * 4 + 1] = Math.min(blobBox[blob * 4 + 1], row);
    blobBox[blob * 4 + 2] = Math.max(blobBox[blob * 4 + 2], col);
    blobBox[blob * 4 + 3] = Math.max(blobBox[blob * 4 + 3], row);
  }
  const thin = THIN / grid.cell;
  const blobThin = blobs.sizes.map((_, blob) => {
    const long = Math.hypot(blobBox[blob * 4 + 2] - blobBox[blob * 4], blobBox[blob * 4 + 3] - blobBox[blob * 4 + 1]) + 1;
    return blobReach[blob] < thin && long > blobReach[blob] * 6;
  });
  const glow = boxMean(near, cols, rows, 1);
  const dark = SHADE * (known ? at(sample(near, lawnPick), 0.5) : at(sample(near, (index) => vegMask[index] === 1), 0.5));
  const keep = keepArea(grid, campus, MARGIN);
  const pitches = campus.patches.filter((patch) => patch.label && PITCH.test(patch.label)).map((patch) => patch.ring);
  for (const strip of campus.strips) if (strip.surface === 'track') pitches.push(strip.line);
  const cellArea = grid.cell * grid.cell;
  const trees: Tree[] = [];
  for (let label = 0; label < count; label += 1) {
    const cells = area[label];
    const fromIsland = sumIsland[label] >= cells / 2;
    if (cells * cellArea < (fromIsland ? ISLAND_AREA : LAWN_AREA)) continue;
    if (!fromIsland && (sumEvidence[label] / cells < EVIDENCE || sumGrain[label] / cells < GRAIN + 0.5)) continue;
    if (radii[label] < thin && (blobThin[blobs.label[peaks[label]]] || linear(mask, cols, rows, peaks[label], radii[label] + 2))) continue;
    if (blobs.sizes[blobs.label[peaks[label]]] < large && !shaded(glow, cols, rows, peaks[label], Math.sqrt(cells / Math.PI), dark)) continue;
    const col = sumX[label] / cells;
    const row = sumY[label] / cells;
    if (!keep[Math.round(row) * cols + Math.round(col)]) continue;
    const x = grid.minX + (col + 0.5) * grid.cell;
    const y = grid.minY + (row + 0.5) * grid.cell;
    if (pitches.some((ring) => insideRing(ring, x, y) && ringDistance(ring, x, y) > 3)) continue;
    const radius = Math.round(clamp(Math.sqrt((cells * cellArea) / Math.PI), 1.5, 12) * 10) / 10;
    trees.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, radius, height: heightFor(radius), photo: true });
  }
  return { trees, mask };
}

export function judgeFields(layers: Layers, campus: Campus): FieldCall[] {
  const { grid, level, veg, photo, roof } = layers;
  const calls: FieldCall[] = [];
  campus.patches.forEach((patch, index) => {
    if (!patch.guessed || (patch.surface !== 'grass' && patch.surface !== 'turf')) return;
    let c0 = Infinity;
    let c1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (const [x, y] of patch.ring) {
      c0 = Math.min(c0, Math.floor((x - grid.minX) / grid.cell));
      c1 = Math.max(c1, Math.ceil((x - grid.minX) / grid.cell));
      r0 = Math.min(r0, Math.floor((y - grid.minY) / grid.cell));
      r1 = Math.max(r1, Math.ceil((y - grid.minY) / grid.cell));
    }
    c0 = Math.max(0, c0);
    r0 = Math.max(0, r0);
    c1 = Math.min(grid.cols - 1, c1);
    r1 = Math.min(grid.rows - 1, r1);
    if (c1 <= c0 || r1 <= r0) return;
    const part: Grid = { cols: c1 - c0 + 1, rows: r1 - r0 + 1, cell: grid.cell, minX: grid.minX + c0 * grid.cell, minY: grid.minY + r0 * grid.cell };
    const inside = new Uint8Array(part.cols * part.rows);
    fill(part, patch.ring, inside);
    const deep = distance(inside, part.cols, part.rows, false);
    const levels: number[] = [];
    const tints: number[] = [];
    for (let row = 0; row < part.rows; row += 1) {
      for (let col = 0; col < part.cols; col += 1) {
        if (deep[row * part.cols + col] < 3 / grid.cell) continue;
        const cell = (row + r0) * grid.cols + col + c0;
        if (!photo.seen[cell] || roof[cell]) continue;
        levels.push(level[cell]);
        tints.push(photo.green[cell] - photo.red[cell]);
      }
    }
    if (levels.length < 200 || levels.length * grid.cell * grid.cell < ringArea(patch.ring) * 0.5) return;
    const sortedLevels = Float32Array.from(levels).sort();
    const sortedTints = Float32Array.from(tints).sort();
    if (at(sortedLevels, 0.5) >= veg) calls.push({ patch: index, surface: 'grass' });
    else if (at(sortedLevels, 0.75) < Math.min(0.25, veg * 0.7) && at(sortedTints, 0.5) >= 12) calls.push({ patch: index, surface: 'turf' });
  });
  return calls;
}
