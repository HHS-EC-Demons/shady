import type { Box, Ring } from './geometry';

export type Grid = { cols: number; rows: number; cell: number; minX: number; minY: number };

export type Span = (row: number, from: number, to: number) => void;

export function makeGrid(box: Box, cell: number): Grid {
  return {
    cols: Math.max(1, Math.ceil((box.maxX - box.minX) / cell)),
    rows: Math.max(1, Math.ceil((box.maxY - box.minY) / cell)),
    cell,
    minX: box.minX,
    minY: box.minY,
  };
}

export function cellAt(grid: Grid, x: number, y: number): number {
  const col = Math.floor((x - grid.minX) / grid.cell);
  const row = Math.floor((y - grid.minY) / grid.cell);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1;
  return row * grid.cols + col;
}

export function cellCenter(grid: Grid, index: number): [number, number] {
  const row = Math.floor(index / grid.cols);
  const col = index - row * grid.cols;
  return [grid.minX + (col + 0.5) * grid.cell, grid.minY + (row + 0.5) * grid.cell];
}

const crossings: number[] = [];

export function polygonSpans(grid: Grid, ring: Ring, emit: Span): void {
  const count = ring.length;
  if (count < 3) return;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const y = ring[i][1];
    if (y < low) low = y;
    if (y > high) high = y;
  }
  const firstRow = Math.max(0, Math.ceil((low - grid.minY) / grid.cell - 0.5));
  const lastRow = Math.min(grid.rows - 1, Math.floor((high - grid.minY) / grid.cell - 0.5));
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = grid.minY + (row + 0.5) * grid.cell;
    crossings.length = 0;
    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const ay = ring[i][1];
      const by = ring[j][1];
      if (ay > y !== by > y) {
        const ax = ring[i][0];
        const bx = ring[j][0];
        crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - grid.minX) / grid.cell - 0.5));
      const to = Math.min(grid.cols - 1, Math.ceil((crossings[k + 1] - grid.minX) / grid.cell - 0.5) - 1);
      if (to >= from) emit(row, from, to);
    }
  }
}

export function ellipseSpans(
  grid: Grid,
  cx: number,
  cy: number,
  along: number,
  across: number,
  angle: number,
  emit: Span,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfY = Math.sqrt(along * along * sin * sin + across * across * cos * cos);
  const firstRow = Math.max(0, Math.ceil((cy - halfY - grid.minY) / grid.cell - 0.5));
  const lastRow = Math.min(grid.rows - 1, Math.floor((cy + halfY - grid.minY) / grid.cell - 0.5));
  const a = (cos * cos) / (along * along) + (sin * sin) / (across * across);
  const b = 2 * cos * sin * (1 / (along * along) - 1 / (across * across));
  const c = (sin * sin) / (along * along) + (cos * cos) / (across * across);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const dy = grid.minY + (row + 0.5) * grid.cell - cy;
    const linear = b * dy;
    const rest = c * dy * dy - 1;
    const root = linear * linear - 4 * a * rest;
    if (root <= 0) continue;
    const reach = Math.sqrt(root);
    const x0 = cx + (-linear - reach) / (2 * a);
    const x1 = cx + (-linear + reach) / (2 * a);
    const from = Math.max(0, Math.ceil((x0 - grid.minX) / grid.cell - 0.5));
    const to = Math.min(grid.cols - 1, Math.ceil((x1 - grid.minX) / grid.cell - 0.5) - 1);
    if (to >= from) emit(row, from, to);
  }
}

export function lineSpans(grid: Grid, line: Ring, width: number, emit: Span): void {
  const half = width / 2;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) continue;
    const nx = (-(by - ay) / length) * half;
    const ny = ((bx - ax) / length) * half;
    polygonSpans(
      grid,
      [
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ],
      emit,
    );
    ellipseSpans(grid, bx, by, half, half, 0, emit);
  }
}
