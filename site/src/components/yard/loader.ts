import { covered } from '@/engine/aerial';
import { mapped, outdated, type Campus } from '@/engine/campus';
import { skipPhotos, type Link } from '@/engine/district';
import { fresh, placeKey } from '@/engine/memory';
import { loadCampus, type Found } from '@/engine/osm';
import { pause } from '@/engine/race';
import { askRoofs } from '@/engine/remote';
import { roofPhotoOf } from '@/engine/roofs';
import { hottestDay, type Weather } from '@/engine/weather';
import { recall, remember, touch, type Memory } from './recall';
import { applyFixes, fixesOf, hasFixes, keptSchool, rebase, type Bundle, type Fixes } from './store';

export type Stage = 'map' | 'weather';
export type Shown = Bundle & { picked?: boolean };
export type Arrival = { bundle: Bundle; pristine: Campus; late: Promise<Campus | null>; cached: boolean };
export type Flight = { key: string; stage: Stage; done: Promise<Arrival>; listen: (listener: (stage: Stage) => void) => () => void };

export class Unmapped extends Error {}
export class NoWeather extends Error {}

const HOLD = 2500;
const PHOTO_WAIT = 60000;
const NONE: Fixes = { surfaces: [], heights: [], cut: [] };
const flights = new Map<string, Flight>();
const reading = new Map<AbortController, string>();
const saving = new Map<string, Promise<void>>();
const tried = new Set<string>();

function slowPhoto(): number {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0;
  const wait = Number(new URLSearchParams(window.location.search).get('slowphoto'));
  return Number.isFinite(wait) && wait > 0 ? wait : 0;
}

const SLOW = slowPhoto();

function endPhotos(ends: (key: string) => boolean): void {
  for (const [control, key] of reading) {
    if (!ends(key)) continue;
    control.abort();
    reading.delete(control);
  }
}

export function stopPhotos(keep?: string): void {
  endPhotos((key) => key !== keep);
}

function photo(key: string, campus: Campus): Promise<Campus> {
  const control = new AbortController();
  reading.set(control, key);
  const asked = import('@/engine/aerial')
    .then(({ enrich }) => enrich(campus, control.signal, { wait: PHOTO_WAIT }))
    .catch(() => campus)
    .finally(() => reading.delete(control));
  if (SLOW === 0) return asked;
  return Promise.all([asked, pause(SLOW)]).then(([value]) => ({ ...value, trees: [...value.trees] }));
}

function save(key: string, task: () => Promise<void>): Promise<void> {
  const next = (saving.get(key) ?? Promise.resolve()).then(task, task);
  saving.set(key, next);
  return next;
}

export function roofsAllowed(link: Link | undefined, coarse: boolean): boolean {
  return !skipPhotos(link, coarse);
}

function roofsHere(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return roofsAllowed((navigator as Navigator & { connection?: Link }).connection, window.matchMedia('(pointer: coarse)').matches);
}

export function roofless(campus: Campus): boolean {
  return covered(campus.center) && !roofPhotoOf(campus);
}

export async function roofsFor(found: Found, campus: Campus): Promise<Campus | null> {
  const key = placeKey(found);
  if (!roofless(campus) || !mapped(campus) || tried.has(key) || !roofsHere()) return null;
  tried.add(key);
  const control = new AbortController();
  reading.set(control, key);
  try {
    const roofs = await askRoofs(campus, control.signal);
    if (control.signal.aborted) tried.delete(key);
    if (!roofs || control.signal.aborted) return null;
    await save(key, async () => {
      const memory = await recall(found);
      if (memory && !outdated(memory.campus) && !roofPhotoOf(memory.campus) && memory.campus.blocks.length === campus.blocks.length) await remember({ ...memory, campus: { ...memory.campus, roofs } });
    });
    return { ...campus, roofs };
  } catch {
    return null;
  } finally {
    reading.delete(control);
  }
}

export function usable(memory: Memory, now: number): boolean {
  return fresh(memory, now) && !outdated(memory.campus) && mapped(memory.campus);
}

function sameSchool(bundle: Bundle | null, found: Found): boolean {
  return Boolean(bundle?.school && bundle.school.kind === found.kind && bundle.school.id === found.id);
}

type Mine = { fixes: Fixes; on: Campus | null };

function fixesFor(found: Found, memory: Memory | null): Mine {
  if (memory && hasFixes(memory.fixes)) return { fixes: memory.fixes, on: memory.campus };
  const kept = keptSchool();
  if (kept && sameSchool(kept, found)) {
    const fixes = fixesOf(kept);
    if (hasFixes(fixes)) return { fixes, on: kept.campus };
  }
  return { fixes: NONE, on: null };
}

function fixesOn(mine: Mine, campus: Campus): Fixes {
  return mine.on ? rebase(mine.fixes, mine.on, campus) : mine.fixes;
}

function bundleOf(found: Found, campus: Campus, weather: Weather, fixes: Fixes): Bundle {
  const bundle: Bundle = { campus, weather, school: found };
  return hasFixes(fixes) ? applyFixes(bundle, fixes) : bundle;
}

export function picked(bundle: Bundle): boolean {
  return (bundle as Shown).picked === true;
}

function onDay(bundle: Bundle, day: Weather | undefined, hottest: Weather | null): Shown {
  if (!day) return bundle;
  if (hottest && hottest.date === day.date) return { ...bundle, weather: day };
  return hottest ? { ...bundle, weather: day, hottest } : { ...bundle, weather: day, picked: true };
}

export async function ownHottest(found: Found): Promise<Weather> {
  const weather = await hottestDay(found.lat, found.lon);
  const memory = await recall(found);
  if (memory) void remember({ ...memory, weather });
  return weather;
}

function keepLate(found: Found, campus: Campus, weather: Weather | null, at?: number): Promise<void> {
  return save(placeKey(found), async () => {
    const memory = await recall(found);
    await remember({ found, campus, weather: memory?.weather ?? weather, enriched: true, fixes: memory?.fixes ?? NONE, at: memory?.at ?? at });
  });
}

function lateFrom(found: Found, asked: Promise<Campus>, before: Campus, weather: Weather | null, at?: number): Promise<Campus | null> {
  return asked.then(
    (campus) => {
      if (campus === before || !mapped(campus)) return null;
      void keepLate(found, campus, weather, at);
      return campus;
    },
    () => null,
  );
}

function noWeather(): never {
  throw new NoWeather('No weather');
}

async function arrive(found: Found, say: (stage: Stage) => void, day?: Weather): Promise<Arrival> {
  const key = placeKey(found);
  const memory = await recall(found);
  const mine = fixesFor(found, memory);
  if (memory && usable(memory, Date.now())) {
    void touch(memory);
    if (day) {
      const late = memory.enriched ? Promise.resolve(null) : lateFrom(found, photo(key, memory.campus), memory.campus, memory.weather, memory.at);
      return { bundle: onDay(bundleOf(found, memory.campus, day, fixesOn(mine, memory.campus)), day, memory.weather), pristine: memory.campus, late, cached: true };
    }
    let weather = memory.weather;
    if (!weather) {
      say('weather');
      weather = await hottestDay(found.lat, found.lon).catch(noWeather);
      void remember({ ...memory, weather });
    }
    const late = memory.enriched ? Promise.resolve(null) : lateFrom(found, photo(key, memory.campus), memory.campus, weather, memory.at);
    return { bundle: bundleOf(found, memory.campus, weather, fixesOn(mine, memory.campus)), pristine: memory.campus, late, cached: true };
  }
  say('map');
  const controller = new AbortController();
  let weatherDone = false;
  let weatherBroke = false;
  const weatherTask = hottestDay(found.lat, found.lon, Date.now(), undefined, controller.signal);
  weatherTask.then(
    () => {
      weatherDone = true;
    },
    () => {
      weatherBroke = true;
      controller.abort();
    },
  );
  const weatherFailed = new Promise<never>((_, reject) => {
    weatherTask.catch(reject);
  });
  let campus: Campus;
  try {
    campus = await Promise.race([loadCampus(found, {}, { signal: controller.signal }), weatherFailed]);
  } catch (error) {
    controller.abort();
    if (weatherBroke) noWeather();
    throw error;
  }
  if (!mapped(campus)) {
    controller.abort();
    throw new Unmapped('No mapped buildings');
  }
  const started = Date.now();
  const asked = photo(key, campus);
  if (!weatherDone) say('weather');
  const weather = await weatherTask.catch(() => {
    endPhotos((other) => other === key);
    return noWeather();
  });
  const early = await Promise.race([asked, pause(Math.max(0, HOLD - (Date.now() - started))).then(() => null)]);
  const shown = early ?? campus;
  const fixes = fixesOn(mine, shown);
  void save(key, () => remember({ found, campus: shown, weather, enriched: early !== null && early !== campus, fixes }));
  const late = early !== null ? Promise.resolve(null) : lateFrom(found, asked, campus, weather);
  return { bundle: onDay(bundleOf(found, shown, weather, fixes), day, weather), pristine: shown, late, cached: false };
}

export function begin(found: Found, day?: Weather): Flight {
  const key = placeKey(found);
  const known = flights.get(key);
  if (known && !day) return known;
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
  flight.done = arrive(
    found,
    (stage) => {
      flight.stage = stage;
      for (const listener of listeners) listener(stage);
    },
    day,
  );
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
