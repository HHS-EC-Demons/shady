import type { Campus } from './campus';
import { makeGrid, polygonSpans, type Grid } from './raster';

const CONTACT_LIMIT = 1024;
const CONTACT_REACH = 2.5;
const CONTACT_PASSES = 3;

export type Contact = { cols: number; rows: number; data: Uint8Array };

function boxBlur(source: Float32Array, target: Float32Array, cols: number, rows: number, radius: number, across: boolean): void {
  const lines = across ? rows : cols;
  const length = across ? cols : rows;
  const step = across ? 1 : cols;
  const jump = across ? cols : 1;
  const width = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const start = line * jump;
    let sum = 0;
    for (let at = 0; at <= Math.min(radius, length - 1); at += 1) sum += source[start + at * step];
    for (let at = 0; at < length; at += 1) {
      target[start + at * step] = sum / width;
      const enter = at + radius + 1;
      const leave = at - radius;
      if (enter < length) sum += source[start + enter * step];
      if (leave >= 0) sum -= source[start + leave * step];
    }
  }
}

export function contactOf(campus: Campus, heat: Grid): Contact {
  const width = heat.cols * heat.cell;
  const depth = heat.rows * heat.cell;
  const cell = Math.max(1, Math.max(width, depth) / CONTACT_LIMIT);
  const shape = makeGrid({ minX: heat.minX, minY: heat.minY, maxX: heat.minX + width, maxY: heat.minY + depth }, cell);
  const grid = { ...shape, cols: Math.min(CONTACT_LIMIT, shape.cols), rows: Math.min(CONTACT_LIMIT, shape.rows) };
  const { cols, rows } = grid;
  const field = new Float32Array(cols * rows);
  const spare = new Float32Array(cols * rows);
  for (const block of campus.blocks) {
    polygonSpans(grid, block.ring, (row, from, to) => field.fill(255, row * cols + from, row * cols + to + 1));
  }
  const radius = Math.max(1, Math.round(CONTACT_REACH / cell));
  for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
    boxBlur(field, spare, cols, rows, radius, true);
    boxBlur(spare, field, cols, rows, radius, false);
  }
  const fade = radius * CONTACT_PASSES;
  const data = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const edgeRow = Math.min(row, rows - 1 - row);
    for (let col = 0; col < cols; col += 1) {
      const edge = Math.min(edgeRow, col, cols - 1 - col);
      const keep = Math.min(1, edge / fade);
      data[row * cols + col] = Math.round(Math.min(255, field[row * cols + col] * keep));
    }
  }
  return { cols, rows, data };
}
