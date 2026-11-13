import { applySight } from '../../engine/aerial';
import { mapped, type Campus } from '../../engine/campus';
import { nearest, placeLabel, schoolQuery, schoolSearch, schoolsFromOverpass, schoolsFromPhoton, summarize, type Listed, type Summary } from '../../engine/district';
import { openCampus } from '../../engine/heat';
import { loadCampus, overpassResting, type Found, type PhotonFeature } from '../../engine/osm';
import { linked } from '../../engine/race';
import { hottestDay, type Weather } from '../../engine/weather';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OVERPASS_WAIT = 20000;
const PHOTON_WAIT = 10000;
const MAP_WAIT = 25000;
const MAP_GAP = 6000;
const PHOTO_WAIT = 30000;
const WORDS = ['school', 'elementary', 'middle'];

export class NoBuildings extends Error {}

export type Listing = { schools: Found[]; total: number; source: 'overpass' | 'photon' };
export type Modelled = { summary: Summary; campus: Campus; bytes: number };

async function timed<T>(wait: number, signal: AbortSignal, run: (inner: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  const unlink = linked(signal, control);
  const timer = setTimeout(() => control.abort(new Error('timed out')), wait);
  try {
    return await run(control.signal);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

async function fromOverpass(place: Found, byArea: boolean, signal: AbortSignal): Promise<Found[]> {
  return timed(OVERPASS_WAIT, signal, async (inner) => {
    const answer = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(schoolQuery(place, byArea))}`,
      signal: inner,
    });
    if (!answer.ok) throw new Error(`Overpass ${answer.status}`);
    const body = (await answer.json()) as { elements?: Listed[]; remark?: string };
    if (!Array.isArray(body.elements) || /error|timed out|out of memory/i.test(body.remark ?? '')) throw new Error('Overpass sent no schools');
    return schoolsFromOverpass(body.elements, placeLabel(place));
  });
}

async function fromPhoton(place: Found, signal: AbortSignal): Promise<Found[]> {
  if (!place.extent) throw new Error('The place has no extent');
  const features: PhotonFeature[] = [];
  for (const word of WORDS) {
    const box = place.extent;
    const page = await timed(PHOTON_WAIT, signal, async (inner) => {
      const answer = await fetch(schoolSearch(word, box), { signal: inner });
      if (!answer.ok) throw new Error(`The search did not answer (${answer.status})`);
      const body = (await answer.json()) as { features?: PhotonFeature[] };
      return Array.isArray(body.features) ? body.features : [];
    });
    features.push(...page);
  }
  return schoolsFromPhoton(features, placeLabel(place));
}

export async function listSchools(place: Found, signal: AbortSignal): Promise<Listing> {
  let schools: Found[] | null = null;
  let source: Listing['source'] = 'overpass';
  if (!overpassResting()) {
    try {
      schools = await fromOverpass(place, place.kind === 'relation', signal);
      if (schools.length === 0 && place.kind === 'relation') schools = await fromOverpass(place, false, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      schools = null;
    }
  }
  if (schools === null) {
    source = 'photon';
    schools = await fromPhoton(place, signal);
  }
  return { schools: nearest(schools, place), total: schools.length, source };
}

export function districtWeather(place: Found, signal: AbortSignal): Promise<Weather> {
  return hottestDay(place.lat, place.lon, Date.now(), undefined, signal);
}

export async function modelSchool(school: Found, weather: Weather, known: Campus | null, photo: boolean, signal: AbortSignal): Promise<Modelled | null> {
  let campus = known ?? (await loadCampus(school, {}, { signal, budget: MAP_WAIT, stagger: MAP_GAP }));
  if (!mapped(campus)) throw new NoBuildings('No mapped buildings');
  let bytes = 0;
  if (photo) {
    if (campus.photo) return null;
    const { look } = await import('../../engine/look');
    const sight = await timed(PHOTO_WAIT, signal, (inner) => look(campus, inner)).catch(() => null);
    if (!sight || signal.aborted) return null;
    bytes = sight.bytes;
    campus = applySight(campus, sight);
  }
  const opened = openCampus(campus, weather);
  return { summary: summarize(campus, opened.ground, opened.bare, opened.peak), campus, bytes };
}
