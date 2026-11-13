import { surfaceChoices, type Campus, type Surface } from '@/engine/campus';
import type { Found } from '@/engine/osm';
import type { HeightFix, SurfaceFix } from '@/engine/share';
import type { Weather } from '@/engine/weather';
import type { Saved, Yard } from './controller';

export type Was = { patches?: Record<string, Surface>; blocks?: Record<string, number> };
export type Bundle = { campus: Campus; weather: Weather; school?: Found | null; was?: Was; hottest?: Weather };
export type Fixes = { surfaces: SurfaceFix[]; heights: HeightFix[] };

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

async function known(stored: Bundle, base: string): Promise<Bundle> {
  if (stored.school !== undefined) return stored;
  const home = await homeBundle(base).catch(() => null);
  if (!home || !sameCampus(home.campus, stored.campus)) return stored;
  const was: Was = { patches: {}, blocks: {} };
  if (home.campus.patches.length === stored.campus.patches.length) {
    stored.campus.patches.forEach((patch, index) => {
      const original = home.campus.patches[index].surface;
      if (patch.surface !== original && was.patches) was.patches[index] = original;
    });
  }
  if (home.campus.blocks.length === stored.campus.blocks.length) {
    stored.campus.blocks.forEach((block, index) => {
      const original = home.campus.blocks[index].height;
      if (block.height !== original && was.blocks) was.blocks[index] = original;
    });
  }
  const upgraded = { ...stored, school: null, was };
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
  return { surfaces, heights };
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
  return bundle;
}

export function hasFixes(fixes: Fixes): boolean {
  return fixes.surfaces.length + fixes.heights.length > 0;
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
