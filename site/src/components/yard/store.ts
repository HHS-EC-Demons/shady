import { outdated, surfaceChoices, treeAt, type Campus, type Patch, type Surface, type Tree } from '@/engine/campus';
import { insideRing, type Point, type Ring } from '@/engine/geometry';
import type { Found } from '@/engine/osm';
import type { HeightFix, Plan, SpotFix, SurfaceFix } from '@/engine/share';
import type { Weather } from '@/engine/weather';
import type { Saved, Yard } from './controller';

export type Was = { patches?: Record<string, Surface>; blocks?: Record<string, number>; trees?: Tree[] };
export type Bundle = { campus: Campus; weather: Weather; school?: Found | null; was?: Was; hottest?: Weather };
export type Fixes = { surfaces: SurfaceFix[]; heights: HeightFix[]; cut: Point[] };

const FEET = 3.28084;

const SCHOOL = 'shady.school.v1';

export function planKey(campus: Campus): string {
  return `shady.plan.v1.${campus.name}.${campus.center.lat.toFixed(4)}.${campus.center.lon.toFixed(4)}`;
}

export async function homeBundle(base: string): Promise<Bundle> {
  const answer = await fetch(`${base}campus/heritage.json`);
  if (!answer.ok) throw new Error('The campus file did not load');
  return { ...((await answer.json()) as Bundle), school: null };
}

function sameCampus(a: Campus, b: Campus): boolean {
  return a.name === b.name && a.center.lat === b.center.lat && a.center.lon === b.center.lon;
}

function samePatch(a: Patch, b: Patch): boolean {
  return a.ring.length === b.ring.length && a.ring.every(([x, y], index) => Math.abs(x - b.ring[index][0]) < 0.5 && Math.abs(y - b.ring[index][1]) < 0.5);
}

export function matchPatch(from: Campus, to: Campus, index: number): number {
  const patch = from.patches[index];
  if (!patch) return -1;
  const same = to.patches[index];
  if (same && samePatch(patch, same)) return index;
  return to.patches.findIndex((other) => samePatch(patch, other));
}

export function rebase(fixes: Fixes, from: Campus, to: Campus): Fixes {
  const surfaces = fixes.surfaces.flatMap((fix) => {
    const patch = matchPatch(from, to, fix.patch);
    const now = to.patches[patch]?.surface;
    return !now || now === fix.to ? [] : [{ patch, from: now, to: fix.to }];
  });
  surfaces.sort((a, b) => a.patch - b.patch);
  return { ...fixes, surfaces };
}

export function carry(current: Bundle, campus: Campus): Bundle {
  const fixes = rebase(fixesOf(current), current.campus, campus);
  const bare: Bundle = { ...current, campus, was: undefined };
  return hasFixes(fixes) ? applyFixes(bare, fixes) : bare;
}

function wasOf(stored: Campus, home: Campus): Was {
  const was: Was = { patches: {}, blocks: {} };
  stored.patches.forEach((patch, index) => {
    const original = home.patches[matchPatch(stored, home, index)]?.surface;
    if (original && patch.surface !== original && was.patches) was.patches[index] = original;
  });
  if (home.blocks.length === stored.blocks.length) {
    stored.blocks.forEach((block, index) => {
      const original = home.blocks[index].height;
      if (block.height !== original && was.blocks) was.blocks[index] = original;
    });
  }
  return was;
}

async function known(stored: Bundle, base: string): Promise<Bundle> {
  if (stored.school || (stored.school === null && !outdated(stored.campus))) return stored;
  const home = await homeBundle(base).catch(() => null);
  if (!home || !sameCampus(home.campus, stored.campus)) return stored;
  const marked: Bundle = stored.school === undefined ? { ...stored, school: null, was: wasOf(stored.campus, home.campus) } : stored;
  const upgraded = outdated(stored.campus) ? carry(marked, home.campus) : marked;
  keepSchool(upgraded);
  return upgraded;
}

export async function loadBundle(base: string): Promise<Bundle> {
  try {
    const stored = window.localStorage.getItem(SCHOOL);
    if (stored) return await known(JSON.parse(stored) as Bundle, base);
  } catch {
    window.localStorage.removeItem(SCHOOL);
  }
  return homeBundle(base);
}

export function keepSchool(bundle: Bundle | null): void {
  try {
    if (bundle) window.localStorage.setItem(SCHOOL, JSON.stringify(bundle));
    else window.localStorage.removeItem(SCHOOL);
  } catch {
    window.localStorage.removeItem(SCHOOL);
  }
}

export function keptSchool(): Bundle | null {
  try {
    const stored = window.localStorage.getItem(SCHOOL);
    return stored ? (JSON.parse(stored) as Bundle) : null;
  } catch {
    return null;
  }
}

export function editSurface(bundle: Bundle, patch: number, surface: Surface): Bundle {
  const was = bundle.was ?? {};
  const original = was.patches?.[patch] ?? bundle.campus.patches[patch].surface;
  const patches = bundle.campus.patches.map((item, index) => (index === patch ? { ...item, surface } : item));
  return { ...bundle, campus: { ...bundle.campus, patches }, was: { ...was, patches: { ...was.patches, [patch]: original } } };
}

export function editHeight(bundle: Bundle, block: number, height: number): Bundle {
  const was = bundle.was ?? {};
  const original = was.blocks?.[block] ?? bundle.campus.blocks[block].height;
  const blocks = bundle.campus.blocks.map((item, index) => (index === block ? { ...item, height, guessed: false } : item));
  return { ...bundle, campus: { ...bundle.campus, blocks }, was: { ...was, blocks: { ...was.blocks, [block]: original } } };
}

export function cutTree(bundle: Bundle, x: number, y: number): Bundle | null {
  const was = bundle.was ?? {};
  const trees = bundle.campus.trees;
  const gone = was.trees ?? [];
  const hit = treeAt(trees, x, y);
  if (hit >= 0) {
    return { ...bundle, campus: { ...bundle.campus, trees: trees.filter((_, index) => index !== hit) }, was: { ...was, trees: [...gone, trees[hit]] } };
  }
  const back = treeAt(gone, x, y);
  if (back < 0) return null;
  return { ...bundle, campus: { ...bundle.campus, trees: [...trees, gone[back]] }, was: { ...was, trees: gone.filter((_, index) => index !== back) } };
}

export function fixesOf(bundle: Bundle): Fixes {
  const { campus, was = {} } = bundle;
  const surfaces: SurfaceFix[] = [];
  for (const key of Object.keys(was.patches ?? {})) {
    const index = Number(key);
    const from = was.patches?.[key];
    const patch = campus.patches[index];
    if (from && patch && patch.surface !== from) surfaces.push({ patch: index, from, to: patch.surface });
  }
  const heights: HeightFix[] = [];
  for (const key of Object.keys(was.blocks ?? {})) {
    const index = Number(key);
    const block = campus.blocks[index];
    if (!block || !Number.isSafeInteger(block.id) || block.id < 1) continue;
    let nth = 0;
    for (let other = 0; other < index; other += 1) if (campus.blocks[other].id === block.id) nth += 1;
    heights.push({ building: block.id, nth, feet: Math.min(2000, Math.max(1, Math.round(block.height * FEET))) });
  }
  surfaces.sort((a, b) => a.patch - b.patch);
  heights.sort((a, b) => a.building - b.building || a.nth - b.nth);
  const cut = (was.trees ?? []).map((tree): Point => [Math.round(tree.x * 10) / 10, Math.round(tree.y * 10) / 10]);
  return { surfaces, heights, cut };
}

export function applyFixes(start: Bundle, fixes: Fixes): Bundle {
  let bundle = start;
  for (const fix of fixes.surfaces) {
    const patch = bundle.campus.patches[fix.patch];
    if (patch && patch.surface === fix.from && surfaceChoices(fix.from).includes(fix.to)) bundle = editSurface(bundle, fix.patch, fix.to);
  }
  for (const fix of fixes.heights) {
    let seen = 0;
    for (let index = 0; index < bundle.campus.blocks.length; index += 1) {
      if (bundle.campus.blocks[index].id !== fix.building) continue;
      if (seen === fix.nth) {
        bundle = editHeight(bundle, index, fix.feet / FEET);
        break;
      }
      seen += 1;
    }
  }
  for (const [x, y] of fixes.cut ?? []) {
    if (treeAt(bundle.campus.trees, x, y) >= 0) bundle = cutTree(bundle, x, y) ?? bundle;
  }
  return bundle;
}

export function hasFixes(fixes: Fixes): boolean {
  return fixes.surfaces.length + fixes.heights.length + (fixes.cut?.length ?? 0) > 0;
}

function holders(campus: Campus, x: number, y: number, surface: (index: number) => Surface, wanted: Surface): number[] {
  return campus.patches.flatMap((patch, index) => (patch.label && surface(index) === wanted && insideRing(patch.ring, x, y) ? [index] : []));
}

function pointsIn(ring: Ring): Point[] {
  const ys = ring.map(([, y]) => y);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  const points: Point[] = [];
  for (const share of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6]) {
    const y = Math.round((low + (high - low) * share) * 10) / 10;
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x = Math.round(((xs[k] + xs[k + 1]) / 2) * 10) / 10;
      if (insideRing(ring, x, y)) points.push([x, y]);
    }
  }
  return points;
}

export function spotOf(bundle: Bundle, fix: SurfaceFix): SpotFix | null {
  const patch = bundle.campus.patches[fix.patch];
  if (!patch) return null;
  const before = (index: number): Surface => bundle.was?.patches?.[index] ?? bundle.campus.patches[index].surface;
  for (const [x, y] of pointsIn(patch.ring)) {
    const hits = holders(bundle.campus, x, y, before, fix.from);
    if (hits.length === 1 && hits[0] === fix.patch) return { at: [x, y], from: fix.from, to: fix.to };
  }
  return null;
}

export function applySpots(start: Bundle, spots: SpotFix[]): Bundle {
  let bundle = start;
  for (const fix of spots) {
    const [x, y] = fix.at;
    const hits = holders(bundle.campus, x, y, (index) => bundle.campus.patches[index].surface, fix.from);
    if (hits.length === 1 && surfaceChoices(fix.from).includes(fix.to)) bundle = editSurface(bundle, hits[0], fix.to);
  }
  return bundle;
}

export function applyShared(bundle: Bundle, plan: Plan): Bundle {
  const surfaces = plan.school === null ? plan.surfaces : [];
  return applySpots(applyFixes(bundle, { surfaces, heights: plan.heights, cut: plan.cut ?? [] }), plan.spots ?? []);
}

export function storedPlan(campus: Campus): Saved | null {
  try {
    const stored = window.localStorage.getItem(planKey(campus));
    if (!stored) return null;
    const saved = JSON.parse(stored) as Saved;
    return Array.isArray(saved.trees) && Array.isArray(saved.sails) ? saved : null;
  } catch {
    return null;
  }
}

export function keepSaved(campus: Campus, saved: Saved): void {
  try {
    window.localStorage.setItem(planKey(campus), JSON.stringify(saved));
  } catch {
    return;
  }
}

export function restorePlan(yard: Yard): void {
  try {
    const stored = window.localStorage.getItem(planKey(yard.campus));
    if (!stored) return;
    const saved = JSON.parse(stored) as Saved;
    if (Array.isArray(saved.trees) && Array.isArray(saved.sails)) yard.load(saved);
  } catch {
    window.localStorage.removeItem(planKey(yard.campus));
  }
}

export function keepPlan(yard: Yard): void {
  keepSaved(yard.campus, yard.saved());
}
