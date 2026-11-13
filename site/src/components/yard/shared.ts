import { surfaceChoices } from '@/engine/campus';
import { loadCampus, type Found } from '@/engine/osm';
import { HASH, LIMITS, type HeightFix, type Plan, type SurfaceFix } from '@/engine/share';
import { hottestDay } from '@/engine/weather';
import { treeHeight, treeRadius, type Saved, type Yard } from './controller';
import { editHeight, editSurface, homeBundle, keepSaved, keepSchool, keptSchool, planKey, storedPlan, type Bundle } from './store';

const FEET = 3.28084;

export function sharedText(): string | null {
  const hash = window.location.hash;
  return hash.startsWith(HASH) ? hash.slice(HASH.length) : null;
}

export function dropHash(): void {
  window.history.replaceState(window.history.state, '', window.location.pathname);
}

export function watchHash(): () => void {
  const changed = () => {
    if (sharedText() !== null) window.location.reload();
  };
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
}

type Fixes = { surfaces: SurfaceFix[]; heights: HeightFix[] };

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

export function planOf(bundle: Bundle, yard: Yard): Plan | null {
  if (bundle.school === undefined) return null;
  const fixes = fixesOf(bundle);
  if (yard.trees.length > LIMITS.trees || yard.sails.length > LIMITS.sails || fixes.surfaces.length + fixes.heights.length > LIMITS.fixes) return null;
  const school = bundle.school ? { kind: bundle.school.kind, id: bundle.school.id, name: bundle.school.name, lat: bundle.school.lat, lon: bundle.school.lon } : null;
  return {
    version: 1,
    school,
    date: bundle.weather.date,
    years: yard.years,
    trees: yard.trees.map((tree) => [tree.x, tree.y]),
    sails: yard.sails.map((sail) => ({ corners: sail.corners, height: sail.height })),
    ...fixes,
  };
}

export async function sharedBundle(plan: Plan, base: string, say: (text: string) => void): Promise<Bundle | null> {
  let bundle: Bundle;
  if (plan.school === null) {
    const home = await homeBundle(base);
    const { lat, lon } = home.campus.center;
    const weather = home.weather.date === plan.date ? home.weather : await hottestDay(lat, lon, Date.now(), plan.date);
    bundle = { ...home, weather };
  } else {
    const found: Found = { ...plan.school, place: '' };
    say(`Loading the map of ${found.name}`);
    const campus = await loadCampus(found);
    if (campus.blocks.filter((block) => block.home).length + campus.patches.length === 0) return null;
    say('Loading its hottest day of the year');
    const weather = await hottestDay(campus.center.lat, campus.center.lon, Date.now(), plan.date);
    bundle = { campus, weather, school: found };
  }
  for (const fix of plan.surfaces) {
    const patch = bundle.campus.patches[fix.patch];
    if (patch && patch.surface === fix.from && surfaceChoices(fix.from).includes(fix.to)) bundle = editSurface(bundle, fix.patch, fix.to);
  }
  for (const fix of plan.heights) {
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

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.051;
}

export function clashes(bundle: Bundle, plan: Plan): boolean {
  const mine = storedPlan(bundle.campus);
  const current = keptSchool();
  const mineFixes: Fixes = current && planKey(current.campus) === planKey(bundle.campus) ? fixesOf(current) : { surfaces: [], heights: [] };
  const trees = mine?.trees ?? [];
  const sails = mine?.sails ?? [];
  if (trees.length + sails.length + mineFixes.surfaces.length + mineFixes.heights.length === 0) return false;
  const sameTrees = trees.length === plan.trees.length && trees.every((tree, index) => near(tree.x, plan.trees[index][0]) && near(tree.y, plan.trees[index][1]));
  const sameSails =
    sails.length === plan.sails.length &&
    sails.every((sail, index) => near(sail.height, plan.sails[index].height) && sail.corners.every(([x, y], corner) => near(x, plan.sails[index].corners[corner][0]) && near(y, plan.sails[index].corners[corner][1])));
  const sameYears = trees.length === 0 || (mine?.years ?? 20) === plan.years;
  const sameFixes = JSON.stringify(mineFixes) === JSON.stringify(fixesOf(bundle));
  return !(sameTrees && sameSails && sameYears && sameFixes);
}

export function adopt(bundle: Bundle, plan: Plan): Saved {
  const kept = storedPlan(bundle.campus)?.readings;
  const readings = Array.isArray(kept) ? kept : [];
  const start = Math.max(0, ...readings.map((reading) => reading.id)) + 1;
  const radius = treeRadius(plan.years);
  const height = treeHeight(plan.years);
  const trees = plan.trees.map(([x, y], index) => ({ id: start + index, x, y, radius, height }));
  const sails = plan.sails.map((sail, index) => ({ id: start + trees.length + index, corners: sail.corners, height: sail.height }));
  const saved: Saved = { trees, sails, years: plan.years, readings };
  keepSchool(bundle);
  keepSaved(bundle.campus, saved);
  return saved;
}
