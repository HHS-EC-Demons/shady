import type { Campus } from '@/engine/campus';
import { gate, type Tally } from '@/engine/district';
import type { Found } from '@/engine/osm';
import type { Weather } from '@/engine/weather';
import type { Listing, Modelled } from './pipeline';

export type Ask =
  | { id: number; kind: 'list'; place: Found }
  | { id: number; kind: 'weather'; place: Found }
  | { id: number; kind: 'model'; school: Found; weather: Weather; campus: Campus | null; photo: boolean }
  | { id: number; kind: 'stats' }
  | { id: number; kind: 'cancel'; target: number };

export type Answer =
  | { id: number; kind: 'listed'; listing: Listing }
  | { id: number; kind: 'weather'; weather: Weather }
  | { id: number; kind: 'modelled'; result: Modelled | null }
  | { id: number; kind: 'unmapped' }
  | { id: number; kind: 'failed'; reason: string }
  | { id: number; kind: 'stats'; hosts: [string, { requests: number; bytes: number }][] };

type Work = Exclude<Ask, { kind: 'cancel' } | { kind: 'stats' }>;
type Spread<T> = T extends unknown ? Omit<T, 'id'> : never;

export class Engine {
  private worker: Worker | null = null;
  private waiting = new Map<number, (answer: Answer) => void>();
  private next = 1;
  private counts: Tally = new Map();
  private plain: typeof fetch | null = null;

  constructor() {
    try {
      if (typeof Worker === 'function') {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<Answer>) => {
          const done = this.waiting.get(event.data.id);
          if (!done) return;
          this.waiting.delete(event.data.id);
          done(event.data);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          this.drop();
        };
        this.worker = worker;
      }
    } catch {
      this.worker = null;
    }
  }

  private drop(): void {
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.waiting.entries()];
    this.waiting.clear();
    for (const [id, done] of waiting) done({ id, kind: 'failed', reason: 'The worker stopped' });
  }

  private async inline(ask: Work, signal: AbortSignal): Promise<Answer> {
    if (!this.plain) {
      this.plain = window.fetch;
      window.fetch = gate(this.plain.bind(window), this.counts, window.location.href);
    }
    const { NoBuildings, districtWeather, listSchools, modelSchool } = await import('./pipeline');
    try {
      if (ask.kind === 'list') return { id: ask.id, kind: 'listed', listing: await listSchools(ask.place, signal) };
      if (ask.kind === 'weather') return { id: ask.id, kind: 'weather', weather: await districtWeather(ask.place, signal) };
      return { id: ask.id, kind: 'modelled', result: await modelSchool(ask.school, ask.weather, ask.campus, ask.photo, signal) };
    } catch (error) {
      if (error instanceof NoBuildings) return { id: ask.id, kind: 'unmapped' };
      return { id: ask.id, kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  ask(make: Spread<Work>, signal: AbortSignal): Promise<Answer> {
    const id = this.next;
    this.next += 1;
    const ask = { ...make, id } as Work;
    if (signal.aborted) return Promise.resolve({ id, kind: 'failed', reason: 'stopped' });
    const worker = this.worker;
    if (!worker) {
      const inner = new AbortController();
      const stop = () => inner.abort();
      signal.addEventListener('abort', stop, { once: true });
      return this.inline(ask, inner.signal).finally(() => signal.removeEventListener('abort', stop));
    }
    return new Promise((resolve) => {
      const stop = () => {
        this.waiting.delete(id);
        try {
          worker.postMessage({ id: 0, kind: 'cancel', target: id } satisfies Ask);
        } catch {
          resolve({ id, kind: 'failed', reason: 'stopped' });
          return;
        }
        resolve({ id, kind: 'failed', reason: 'stopped' });
      };
      signal.addEventListener('abort', stop, { once: true });
      this.waiting.set(id, (answer) => {
        signal.removeEventListener('abort', stop);
        resolve(answer);
      });
      try {
        worker.postMessage(ask);
      } catch {
        this.waiting.delete(id);
        signal.removeEventListener('abort', stop);
        resolve({ id, kind: 'failed', reason: 'The worker stopped' });
      }
    });
  }

  async stats(): Promise<[string, { requests: number; bytes: number }][]> {
    const worker = this.worker;
    if (!worker) return [...this.counts.entries()];
    const id = this.next;
    this.next += 1;
    return new Promise((resolve) => {
      this.waiting.set(id, (answer) => resolve(answer.kind === 'stats' ? answer.hosts : []));
      worker.postMessage({ id, kind: 'stats' } satisfies Ask);
    });
  }

  close(): void {
    this.drop();
    if (this.plain) {
      window.fetch = this.plain;
      this.plain = null;
    }
  }
}
