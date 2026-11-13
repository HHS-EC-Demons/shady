import type { Campus } from '@/engine/campus';
import { placeKey, prune, samePlace, type Stamp } from '@/engine/memory';
import type { Found } from '@/engine/osm';
import type { Weather } from '@/engine/weather';
import type { Fixes } from './store';

export type Memory = { key: string; found: Found; campus: Campus; weather: Weather | null; at: number; used: number; enriched: boolean; fixes: Fixes };

const NAME = 'shady';
const PLACES = 'places';
const STAMPS = 'stamps';
const OPEN_WAIT = 1500;

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
        if (!db.objectStoreNames.contains(PLACES)) db.createObjectStore(PLACES, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STAMPS)) db.createObjectStore(STAMPS, { keyPath: 'key' });
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

export async function recall(found: Found): Promise<Memory | null> {
  try {
    const db = await database();
    if (!db) return null;
    const memory = (await answer(db.transaction(PLACES, 'readonly').objectStore(PLACES).get(placeKey(found)))) as Memory | undefined;
    if (!memory || !memory.campus || !samePlace(memory.found, found)) return null;
    return memory;
  } catch {
    return null;
  }
}

async function store(memory: Memory): Promise<void> {
  const db = await database();
  if (!db) return;
  const writing = db.transaction([PLACES, STAMPS], 'readwrite');
  writing.objectStore(PLACES).put(memory);
  writing.objectStore(STAMPS).put({ key: memory.key, at: memory.at, used: memory.used } satisfies Stamp);
  await finished(writing);
  const stamps = (await answer(db.transaction(STAMPS, 'readonly').objectStore(STAMPS).getAll())) as Stamp[];
  const drop = prune(stamps, Date.now());
  if (drop.length === 0) return;
  const clearing = db.transaction([PLACES, STAMPS], 'readwrite');
  for (const key of drop) {
    clearing.objectStore(PLACES).delete(key);
    clearing.objectStore(STAMPS).delete(key);
  }
  await finished(clearing);
}

export async function remember(entry: { found: Found; campus: Campus; weather: Weather | null; enriched: boolean; fixes: Fixes; at?: number }): Promise<void> {
  try {
    const now = Date.now();
    await store({ key: placeKey(entry.found), found: entry.found, campus: entry.campus, weather: entry.weather, at: entry.at ?? now, used: now, enriched: entry.enriched, fixes: entry.fixes });
  } catch {
    return;
  }
}

export async function touch(memory: Memory): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    const writing = db.transaction(STAMPS, 'readwrite');
    writing.objectStore(STAMPS).put({ key: memory.key, at: memory.at, used: Date.now() } satisfies Stamp);
    await finished(writing);
  } catch {
    return;
  }
}

export async function rememberFixes(found: Found, fixes: Fixes): Promise<void> {
  try {
    const memory = await recall(found);
    if (!memory) return;
    await store({ ...memory, fixes, used: Date.now() });
  } catch {
    return;
  }
}
