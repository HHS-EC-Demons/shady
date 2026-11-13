import { SURFACES, SURFACE_ORDER, type Surface } from './campus';
import type { Point } from './geometry';
import { YEARS } from './growth';

export type ShareKind = 'way' | 'relation' | 'node';
export type SharedSchool = { kind: ShareKind; id: number; name: string; lat: number; lon: number };
export type SharedSail = { corners: [Point, Point, Point, Point]; height: number };
export type SurfaceFix = { patch: number; from: Surface; to: Surface };
export type HeightFix = { building: number; nth: number; feet: number };
export type Plan = {
  version: 1;
  school: SharedSchool | null;
  date: string;
  years: number;
  trees: Point[];
  sails: SharedSail[];
  surfaces: SurfaceFix[];
  heights: HeightFix[];
  cut?: Point[];
};

export const LIMITS = { trees: 500, sails: 50, fixes: 200, cut: 800, name: 120, text: 32768, bytes: 131072 };
export const HASH = '#plan=';

const REACH = 100000;
const KINDS = new Map<unknown, ShareKind>([
  ['w', 'way'],
  ['r', 'relation'],
  ['n', 'node'],
]);

export function linkFor(origin: string, base: string, text: string): string {
  return `${origin}${base}plan/${HASH}${text}`;
}

function decimetres(value: number): number {
  return Math.round(value * 10);
}

function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, LIMITS.name);
}

function compact(plan: Plan): string {
  const body: Record<string, unknown> = { v: 1 };
  if (plan.school) body.s = [plan.school.kind[0], plan.school.id, cleanName(plan.school.name), plan.school.lat, plan.school.lon];
  body.d = plan.date;
  body.y = plan.years;
  if (plan.trees.length > 0) body.t = plan.trees.flatMap(([x, y]) => [decimetres(x), decimetres(y)]);
  if (plan.sails.length > 0) body.a = plan.sails.map((sail) => [...sail.corners.flatMap(([x, y]) => [decimetres(x), decimetres(y)]), decimetres(sail.height)]);
  if (plan.surfaces.length > 0) body.f = plan.surfaces.map((fix) => [fix.patch, SURFACES[fix.from].code, SURFACES[fix.to].code]);
  if (plan.heights.length > 0) body.h = plan.heights.map((fix) => [fix.building, fix.nth, fix.feet]);
  if (plan.cut && plan.cut.length > 0) body.c = plan.cut.flatMap(([x, y]) => [decimetres(x), decimetres(y)]);
  return JSON.stringify(body);
}

function toText(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x2000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x2000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromText(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function squeeze(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  if (typeof DecompressionStream !== 'function') return null;
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMITS.bytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

export async function encodePlan(plan: Plan): Promise<string> {
  const bytes = new TextEncoder().encode(compact(plan));
  const packed = await squeeze(bytes);
  return packed && packed.length < bytes.length ? `z${toText(packed)}` : `j${toText(bytes)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function whole(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}

function within(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

function listOf(value: unknown, most: number): unknown[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= most ? value : null;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1940 || year > 2100) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function readSchool(value: unknown): SharedSchool | null | false {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 5) return false;
  const [code, id, name, lat, lon] = value;
  const kind = KINDS.get(code);
  if (!kind || !whole(id, 1, Number.MAX_SAFE_INTEGER) || typeof name !== 'string' ||!within(lat, -90, 90) || !within(lon, -180, 180)) return false;
  const label = cleanName(name);
  return label === '' ? false : { kind, id, name: label, lat, lon };
}

function readPlan(body: unknown): Plan | null {
  if (!isRecord(body) || body.v !== 1) return null;
  const school = readSchool(body.s);
  if (school === false || !isDate(body.d) || typeof body.y !== 'number' || !YEARS.includes(body.y)) return null;

  const flat = listOf(body.t, LIMITS.trees * 2);
  if (!flat || flat.length % 2 !== 0 || !flat.every((value) => whole(value, -REACH, REACH))) return null;
  const trees: Point[] = [];
  for (let index = 0; index < flat.length; index += 2) trees.push([(flat[index] as number) / 10, (flat[index + 1] as number) / 10]);

  const rawSails = listOf(body.a, LIMITS.sails);
  if (!rawSails) return null;
  const sails: SharedSail[] = [];
  for (const item of rawSails) {
    if (!Array.isArray(item) || item.length !== 9 || !item.slice(0, 8).every((value) => whole(value, -REACH, REACH)) || !whole(item[8], 1, 500)) return null;
    const n = item as number[];
    sails.push({
      corners: [
        [n[0] / 10, n[1] / 10],
        [n[2] / 10, n[3] / 10],
        [n[4] / 10, n[5] / 10],
        [n[6] / 10, n[7] / 10],
      ],
      height: n[8] / 10,
    });
  }

  const rawSurfaces = listOf(body.f, LIMITS.fixes);
  const rawHeights = listOf(body.h, LIMITS.fixes);
  if (!rawSurfaces || !rawHeights || rawSurfaces.length + rawHeights.length > LIMITS.fixes) return null;
  const last = SURFACE_ORDER.length - 1;
  const surfaces: SurfaceFix[] = [];
  for (const item of rawSurfaces) {
    if (!Array.isArray(item) || item.length !== 3 || !whole(item[0], 0, 100000) || !whole(item[1], 0, last) || !whole(item[2], 0, last)) return null;
    surfaces.push({ patch: item[0], from: SURFACE_ORDER[item[1]], to: SURFACE_ORDER[item[2]] });
  }
  const heights: HeightFix[] = [];
  for (const item of rawHeights) {
    if (!Array.isArray(item) || item.length !== 3 || !whole(item[0], 1, Number.MAX_SAFE_INTEGER) || !whole(item[1], 0, 1000) || !whole(item[2], 1, 2000)) return null;
    heights.push({ building: item[0], nth: item[1], feet: item[2] });
  }

  const rawCut = listOf(body.c, LIMITS.cut * 2);
  if (!rawCut || rawCut.length % 2 !== 0 || !rawCut.every((value) => whole(value, -REACH, REACH))) return null;
  const cut: Point[] = [];
  for (let index = 0; index < rawCut.length; index += 2) cut.push([(rawCut[index] as number) / 10, (rawCut[index + 1] as number) / 10]);

  const plan: Plan = { version: 1, school, date: body.d, years: body.y, trees, sails, surfaces, heights };
  return cut.length > 0 ? { ...plan, cut } : plan;
}

export async function decodePlan(text: unknown): Promise<Plan | null> {
  try {
    if (typeof text !== 'string' || text.length < 2 || text.length > LIMITS.text) return null;
    const bytes = fromText(text.slice(1));
    if (!bytes) return null;
    const raw = text[0] === 'z' ? await inflate(bytes) : text[0] === 'j' ? bytes : null;
    if (!raw || raw.length > LIMITS.bytes) return null;
    return readPlan(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  } catch {
    return null;
  }
}
