import type { Campus } from '@/engine/campus';
import type { Weather } from '@/engine/weather';
import type { Saved, Yard } from './controller';

export type Bundle = { campus: Campus; weather: Weather };

const SCHOOL = 'shady.school.v1';

function planKey(campus: Campus): string {
  return `shady.plan.v1.${campus.name}.${campus.center.lat.toFixed(4)}.${campus.center.lon.toFixed(4)}`;
}

export async function loadBundle(base: string): Promise<Bundle> {
  try {
    const stored = window.localStorage.getItem(SCHOOL);
    if (stored) return JSON.parse(stored) as Bundle;
  } catch {
    window.localStorage.removeItem(SCHOOL);
  }
  const answer = await fetch(`${base}campus/heritage.json`);
  if (!answer.ok) throw new Error('The campus file did not load');
  return (await answer.json()) as Bundle;
}

export function keepSchool(bundle: Bundle | null): void {
  try {
    if (bundle) window.localStorage.setItem(SCHOOL, JSON.stringify(bundle));
    else window.localStorage.removeItem(SCHOOL);
  } catch {
    window.localStorage.removeItem(SCHOOL);
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
  try {
    window.localStorage.setItem(planKey(yard.campus), JSON.stringify(yard.saved()));
  } catch {
    return;
  }
}
