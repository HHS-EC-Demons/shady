import type { Campus } from '@/engine/campus';
import { alive, schoolKey, type Summary } from '@/engine/district';
import type { Found } from '@/engine/osm';
import type { Weather } from '@/engine/weather';

export type Kept = { key: string; place: Found; at: number; total: number; schools: Found[]; weather: Weather | null };
export type KeptRow = { key: string; district: string; school: string; at: number; status: 'done' | 'failed' | 'unmapped' | 'bare'; summary?: Summary; looked?: boolean; version?: number };
type KeptCampus = { key: string; at: number; campus: Campus };

const NAME = 'shady-district';
const DISTRICTS = 'districts';
const ROWS = 'rows';
const CAMPUSES = 'campuses';
const BY_DISTRICT = 'district';
const OPEN_WAIT = 1500;
const MOST_KEPT = 8;

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) {
        value?.close();
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), OPEN_WAIT);
    try {
      const request = window.indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DISTRICTS)) db.createObjectStore(DISTRICTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: 'key' }).createIndex(BY_DISTRICT, 'district');
        if (!db.objectStoreNames.contains(CAMPUSES)) db.createObjectStore(CAMPUSES, { keyPath: 'key' });
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return opening;
}

function answer<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function rowKey(district: string, school: string): string {
  return `${district}|${school}`;
}

export async function openKept(place: Found): Promise<{ kept: Kept | null; rows: KeptRow[] }> {
  try {
    const db = await database();
    if (!db) return { kept: null, rows: [] };
    const key = schoolKey(place);
    const reading = db.transaction([DISTRICTS, ROWS], 'readonly');
    const kept = (await answer(reading.objectStore(DISTRICTS).get(key))) as Kept | undefined;
    if (!kept || !alive(kept.at, Date.now())) return { kept: null, rows: [] };
    const rows = (await answer(reading.objectStore(ROWS).index(BY_DISTRICT).getAll(key))) as KeptRow[];
    return { kept, rows: rows.filter((row) => alive(row.at, Date.now())) };
  } catch {
    return { kept: null, rows: [] };
  }
}

export async function keepDistrict(kept: Kept): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const writing = db.transaction(DISTRICTS, 'readwrite');
    writing.objectStore(DISTRICTS).put(kept);
    await finished(writing);
  } catch {
    return;
  }
}

export async function keepRow(row: KeptRow): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const writing = db.transaction(ROWS, 'readwrite');
    writing.objectStore(ROWS).put(row);
    await finished(writing);
  } catch {
    return;
  }
}

export async function keepCampus(key: string, campus: Campus): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const writing = db.transaction(CAMPUSES, 'readwrite');
    writing.objectStore(CAMPUSES).put({ key, at: Date.now(), campus } satisfies KeptCampus);
    await finished(writing);
  } catch {
    return;
  }
}

export async function keptCampus(key: string): Promise<Campus | null> {
  try {
    const db = await database();
    if (!db) return null;
    const found = (await answer(db.transaction(CAMPUSES, 'readonly').objectStore(CAMPUSES).get(key))) as KeptCampus | undefined;
    return found && alive(found.at, Date.now()) ? found.campus : null;
  } catch {
    return null;
  }
}

export async function tidyKept(now = Date.now()): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const reading = db.transaction([DISTRICTS, CAMPUSES], 'readonly');
    const districts = (await answer(reading.objectStore(DISTRICTS).getAll())) as Kept[];
    const campusKeys = (await answer(reading.objectStore(CAMPUSES).getAllKeys())) as string[];
    const kept = districts
      .filter((item) => alive(item.at, now))
      .sort((a, b) => b.at - a.at)
      .slice(0, MOST_KEPT);
    const keep = new Set(kept.map((item) => item.key));
    const used = new Set(kept.flatMap((item) => item.schools.map(schoolKey)));
    const gone = districts.filter((item) => !keep.has(item.key)).map((item) => item.key);
    const writing = db.transaction([DISTRICTS, ROWS, CAMPUSES], 'readwrite');
    for (const key of gone) {
      writing.objectStore(DISTRICTS).delete(key);
      writing.objectStore(ROWS).delete(IDBKeyRange.bound(`${key}|`, `${key}|￿`));
    }
    for (const key of campusKeys) if (!used.has(key)) writing.objectStore(CAMPUSES).delete(key);
    await finished(writing);
  } catch {
    return;
  }
}
