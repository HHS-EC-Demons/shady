import type { Campus } from '@/engine/campus';
import { fresh, placeKey } from '@/engine/memory';
import { loadCampus, type Found } from '@/engine/osm';
import { pause } from '@/engine/race';
import { hottestDay, type Weather } from '@/engine/weather';
import { recall, remember, touch, type Memory } from './recall';
import { applyFixes, fixesOf, hasFixes, keptSchool, type Bundle, type Fixes } from './store';

export type Stage = 'map' | 'weather';
export type Arrival = { bundle: Bundle; pristine: Campus; late: Promise<Campus | null>; cached: boolean };
export type Flight = { key: string; stage: Stage; done: Promise<Arrival>; listen: (listener: (stage: Stage) => void) => () => void };

export class Unmapped extends Error {}

const HOLD = 2500;
const NONE: Fixes = { surfaces: [], heights: [], cut: [] };
const flights = new Map<string, Flight>();

function slowPhoto(): number {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0;
  const wait = Number(new URLSearchParams(window.location.search).get('slowphoto'));
  return Number.isFinite(wait) && wait > 0 ? wait : 0;
}

const SLOW = slowPhoto();

function photo(campus: Campus): Promise<Campus> {
  const asked = import('@/engine/aerial').then(({ enrich }) => enrich(campus)).catch(() => campus);
  if (SLOW === 0) return asked;
  return Promise.all([asked, pause(SLOW)]).then(([value]) => ({ ...value, trees: [...value.trees] }));
}

export function mapped(campus: Campus): boolean {
  return campus.blocks.some((block) => block.home) || campus.patches.length > 0;
}

function sameSchool(bundle: Bundle | null, found: Found): boolean {
  return Boolean(bundle?.school && bundle.school.kind === found.kind && bundle.school.id === found.id);
}

function fixesFor(found: Found, memory: Memory | null): Fixes {
  if (memory && hasFixes(memory.fixes)) return memory.fixes;
  const kept = keptSchool();
  if (kept && sameSchool(kept, found)) {
    const fixes = fixesOf(kept);
    if (hasFixes(fixes)) return fixes;
  }
  return NONE;
}

function bundleOf(found: Found, campus: Campus, weather: Weather, fixes: Fixes): Bundle {
  const bundle: Bundle = { campus, weather, school: found };
  return hasFixes(fixes) ? applyFixes(bundle, fixes) : bundle;
}

export function carry(current: Bundle, campus: Campus): Bundle {
  const mine = fixesOf(current);
  const surfaces = mine.surfaces.flatMap((fix) => {
    const now = campus.patches[fix.patch]?.surface;
    return !now || now === fix.to ? [] : [{ ...fix, from: now }];
  });
  const fixes: Fixes = { ...mine, surfaces };
  const bare: Bundle = { ...current, campus, was: undefined };
  return hasFixes(fixes) ? applyFixes(bare, fixes) : bare;
}

async function keepLate(found: Found, campus: Campus, weather: Weather, at?: number): Promise<void> {
  const memory = await recall(found);
  await remember({ found, campus, weather: memory?.weather ?? weather, enriched: true, fixes: memory?.fixes ?? NONE, at: memory?.at ?? at });
}

function lateFrom(found: Found, asked: Promise<Campus>, before: Campus, weather: Weather, at?: number): Promise<Campus | null> {
  return asked.then(
    (campus) => {
      if (campus === before || !mapped(campus)) return null;
      void keepLate(found, campus, weather, at);
      return campus;
    },
    () => null,
  );
}

async function arrive(found: Found, say: (stage: Stage) => void): Promise<Arrival> {
  const memory = await recall(found);
  const fixes = fixesFor(found, memory);
  if (memory && fresh(memory, Date.now()) && mapped(memory.campus)) {
    void touch(memory);
    let weather = memory.weather;
    if (!weather) {
      say('weather');
      weather = await hottestDay(found.lat, found.lon);
      void remember({ ...memory, weather });
    }
    const late = memory.enriched ? Promise.resolve(null) : lateFrom(found, photo(memory.campus), memory.campus, weather, memory.at);
    return { bundle: bundleOf(found, memory.campus, weather, fixes), pristine: memory.campus, late, cached: true };
  }
  say('map');
  const controller = new AbortController();
  let weatherDone = false;
  const weatherTask = hottestDay(found.lat, found.lon, Date.now(), undefined, controller.signal);
  weatherTask.then(
    () => {
      weatherDone = true;
    },
    () => controller.abort(),
  );
  const weatherFailed = new Promise<never>((_, reject) => {
    weatherTask.catch(reject);
  });
  let campus: Campus;
  try {
    campus = await Promise.race([loadCampus(found, {}, { signal: controller.signal }), weatherFailed]);
  } catch (error) {
    controller.abort();
    throw error;
  }
  if (!mapped(campus)) {
    controller.abort();
    throw new Unmapped('No mapped buildings');
  }
  const started = Date.now();
  const asked = photo(campus);
  if (!weatherDone) say('weather');
  const weather = await weatherTask;
  const early = await Promise.race([asked, pause(Math.max(0, HOLD - (Date.now() - started))).then(() => null)]);
  const shown = early ?? campus;
  void remember({ found, campus: shown, weather, enriched: early !== null && early !== campus, fixes });
  const late = early !== null ? Promise.resolve(null) : lateFrom(found, asked, campus, weather);
  return { bundle: bundleOf(found, shown, weather, fixes), pristine: shown, late, cached: false };
}

export function begin(found: Found): Flight {
  const key = placeKey(found);
  const known = flights.get(key);
  if (known) return known;
  const listeners = new Set<(stage: Stage) => void>();
  const flight: Flight = {
    key,
    stage: 'map',
    done: Promise.resolve(null as unknown as Arrival),
    listen: (listener) => {
      listeners.add(listener);
      listener(flight.stage);
      return () => listeners.delete(listener);
    },
  };
  flight.done = arrive(found, (stage) => {
    flight.stage = stage;
    for (const listener of listeners) listener(stage);
  });
  flight.done.catch(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
}

export function take(found: Found): Flight {
  const flight = begin(found);
  flights.delete(flight.key);
  return flight;
}

export async function placeBundle(found: Found, say: (stage: Stage) => void = () => undefined): Promise<Arrival> {
  const flight = take(found);
  const stop = flight.listen(say);
  try {
    return await flight.done;
  } finally {
    stop();
  }
}
