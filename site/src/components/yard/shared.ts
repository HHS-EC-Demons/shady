import type { Found } from '@/engine/osm';
import { HASH, LIMITS, type Plan } from '@/engine/share';
import { dayWeather, localDay } from '@/engine/weather';
import { treeHeight, treeRadius, type Saved, type Yard } from './controller';
import { placeBundle, Unmapped, type Arrival, type Stage } from './loader';
import { applyShared, fixesOf, homeBundle, keepSaved, keepSchool, keptSchool, planKey, spotOf, storedPlan, type Bundle, type Fixes } from './store';

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

export { fixesOf };

export function planOf(bundle: Bundle, yard: Yard): Plan | null {
  if (bundle.school === undefined) return null;
  const { cut, ...fixes } = fixesOf(bundle);
  if (yard.trees.length > LIMITS.trees || yard.sails.length > LIMITS.sails || fixes.surfaces.length + fixes.heights.length > LIMITS.fixes || cut.length > LIMITS.cut) return null;
  const school = bundle.school ? { kind: bundle.school.kind, id: bundle.school.id, name: bundle.school.name, lat: bundle.school.lat, lon: bundle.school.lon } : null;
  const spots = fixes.surfaces.flatMap((fix) => spotOf(bundle, fix) ?? []);
  return {
    version: 1,
    school,
    date: bundle.weather.date,
    years: yard.years,
    trees: yard.trees.map((tree) => [tree.x, tree.y]),
    sails: yard.sails.map((sail) => ({ corners: sail.corners, height: sail.height })),
    surfaces: [],
    heights: fixes.heights,
    ...(cut.length > 0 ? { cut } : {}),
    ...(spots.length > 0 ? { spots } : {}),
  };
}

function dayText(stage: Stage, name: string): string {
  return stage === 'weather' ? 'Loading its hottest day of the year' : `Loading the map of ${name}`;
}

export async function sharedBundle(plan: Plan, base: string, say: (text: string) => void): Promise<Bundle | null> {
  let bundle: Bundle;
  const today = localDay();
  if (plan.school === null) {
    const home = await homeBundle(base);
    const { lat, lon } = home.campus.center;
    const day = home.weather.date === plan.date ? null : await dayWeather(lat, lon, plan.date, today).catch(() => null);
    bundle = day ? { ...home, weather: day, hottest: home.weather } : home;
  } else {
    const found: Found = { ...plan.school, place: '' };
    say(`Loading the map of ${found.name}`);
    let arrival: Arrival;
    try {
      arrival = await placeBundle(found, (stage) => say(dayText(stage, found.name)));
    } catch (error) {
      if (error instanceof Unmapped) return null;
      throw error;
    }
    const hottest = arrival.bundle.weather;
    const campus = (await arrival.late) ?? arrival.pristine;
    const day = hottest.date === plan.date ? null : await dayWeather(campus.center.lat, campus.center.lon, plan.date, today).catch(() => null);
    bundle = day ? { campus, weather: day, school: found, hottest } : { campus, weather: hottest, school: found };
  }
  return applyShared(bundle, plan);
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.051;
}

export function clashes(bundle: Bundle, plan: Plan): boolean {
  const mine = storedPlan(bundle.campus);
  const current = keptSchool();
  const mineFixes: Fixes = current && planKey(current.campus) === planKey(bundle.campus) ? fixesOf(current) : { surfaces: [], heights: [], cut: [] };
  const trees = mine?.trees ?? [];
  const sails = mine?.sails ?? [];
  if (trees.length + sails.length + mineFixes.surfaces.length + mineFixes.heights.length + mineFixes.cut.length === 0) return false;
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
