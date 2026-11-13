export const KEEP_PLACES = 20;
export const PLACE_LIFE = 30 * 86400000;

export type Stamp = { key: string; at: number; used: number };

export function placeKey(place: { kind: string; id: number }): string {
  return `${place.kind}/${place.id}`;
}

export function fresh(stamp: { at: number }, now: number): boolean {
  return Number.isFinite(stamp.at) && stamp.at <= now + 60000 && now - stamp.at < PLACE_LIFE;
}

export function samePlace(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;
}

export function prune(stamps: Stamp[], now: number, keep = KEEP_PLACES): string[] {
  const alive = stamps.filter((stamp) => fresh(stamp, now)).sort((a, b) => b.used - a.used);
  const kept = new Set(alive.slice(0, keep).map((stamp) => stamp.key));
  return stamps.filter((stamp) => !kept.has(stamp.key)).map((stamp) => stamp.key);
}
