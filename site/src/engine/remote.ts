import { campusMiddle, type Campus, type Ground, type RoofPhoto } from './campus';
import { contactOf, type Contact } from './contact';
import { roofOf, type RoofUnit } from './roof';
import { openCampus, simulate, type Backdrop, type HeatDay, type Opened } from './heat';
import type { Sight } from './look';
import type { Grid } from './raster';
import type { Obstacles } from './shade';
import type { SunRay } from './sun';
import type { Weather } from './weather';

export type Ask =
  | { id: number; kind: 'open'; key: number; campus: Campus; weather: Weather; reply: boolean }
  | { id: number; kind: 'simulate'; key: number; added: Obstacles }
  | { id: number; kind: 'close'; key: number }
  | { id: number; kind: 'sight'; campus: Campus }
  | { id: number; kind: 'roofs'; campus: Campus }
  | { id: number; kind: 'cancel'; target: number };

export type Answer =
  | {
      id: number;
      kind: 'opened';
      grid: Grid;
      surface: Uint8Array;
      home: Uint8Array;
      open: Uint8Array;
      light: Uint8Array;
      rays: SunRay[];
      temps: Uint8Array;
      air: Float32Array;
      peak: number;
      contact: Contact;
      roof: RoofUnit[];
      paving: Float32Array;
    }
  | { id: number; kind: 'day'; temps: Uint8Array; light: Uint8Array; air: Float32Array }
  | { id: number; kind: 'sight'; sight: Sight | null }
  | { id: number; kind: 'roofs'; roofs: RoofPhoto | null }
  | { id: number; kind: 'ready' }
  | { id: number; kind: 'gone' }
  | { id: number; kind: 'failed'; reason: string };

type Lane = { worker: Worker; waiting: Map<number, (answer: Answer | null) => void> };

const LANES = 2;
const lanes: (Lane | null | undefined)[] = [];
let nextId = 1;
let nextKey = 1;

function laneAt(index: number): Lane | null {
  const known = lanes[index];
  if (known !== undefined) return known;
  let made: Lane | null = null;
  try {
    if (typeof Worker === 'function') {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const lane: Lane = { worker, waiting: new Map() };
      const fail = () => {
        lanes[index] = null;
        worker.terminate();
        const waiting = [...lane.waiting.values()];
        lane.waiting.clear();
        for (const done of waiting) done(null);
      };
      worker.onmessage = (event: MessageEvent<Answer>) => {
        const done = lane.waiting.get(event.data.id);
        if (!done) return;
        lane.waiting.delete(event.data.id);
        done(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail();
      };
      worker.onmessageerror = fail;
      made = lane;
    }
  } catch {
    made = null;
  }
  lanes[index] = made;
  return made;
}

export function warmUp(count = 1): void {
  for (let index = 0; index < Math.min(count, LANES); index += 1) laneAt(index);
}

function send(index: number, make: (id: number) => Ask): Promise<Answer | null> {
  const lane = laneAt(Math.min(index, LANES - 1));
  if (!lane) return Promise.resolve(null);
  const id = nextId;
  nextId += 1;
  return new Promise((resolve) => {
    lane.waiting.set(id, resolve);
    try {
      lane.worker.postMessage(make(id));
    } catch {
      lane.waiting.delete(id);
      resolve(null);
    }
  });
}

function askLate(kind: 'sight' | 'roofs', campus: Campus, signal: AbortSignal): Promise<Answer | null | undefined> {
  const index = LANES - 1;
  const lane = laneAt(index);
  if (!lane) return Promise.resolve(undefined);
  let asked = 0;
  const answer = send(index, (id) => {
    asked = id;
    return { id, kind, campus };
  });
  const cancel = () => {
    try {
      lane.worker.postMessage({ id: 0, kind: 'cancel', target: asked } satisfies Ask);
    } catch {
      return;
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  return answer.then((reply) => {
    signal.removeEventListener('abort', cancel);
    return reply;
  });
}

export function askSight(campus: Campus, signal: AbortSignal): Promise<Sight | null | undefined> {
  return askLate('sight', campus, signal).then((reply) => (reply && reply.kind === 'sight' ? reply.sight : undefined));
}

export function askRoofs(campus: Campus, signal: AbortSignal): Promise<RoofPhoto | null> {
  return askLate('roofs', campus, signal).then((reply) => (reply && reply.kind === 'roofs' ? reply.roofs : null));
}

export class Bench {
  readonly ground: Ground;
  readonly backdrop: Backdrop;
  readonly bare: HeatDay;
  readonly peak: number;
  readonly contact: Contact;
  readonly roof: RoofUnit[];
  readonly paving: Float32Array;
  private readonly primed: Set<number>;

  constructor(
    opened: Opened,
    contact: Contact,
    roof: RoofUnit[],
    paving: Float32Array,
    private readonly campus: Campus,
    private readonly weather: Weather,
    private readonly key: number,
    primed: number[] = [],
  ) {
    this.ground = opened.ground;
    this.backdrop = opened.backdrop;
    this.bare = opened.bare;
    this.peak = opened.peak;
    this.contact = contact;
    this.roof = roof;
    this.paving = paving;
    this.primed = new Set(primed);
  }

  prime(index: number): void {
    if (this.primed.has(index)) return;
    this.primed.add(index);
    void send(index, (id) => ({ id, kind: 'open', key: this.key, campus: this.campus, weather: this.weather, reply: false }));
  }

  simulate(added: Obstacles, index = 0): Promise<HeatDay> {
    return this.remote(added, index, true).then((day) => day ?? simulate(this.ground, this.weather, this.backdrop, added));
  }

  close(): void {
    for (const index of this.primed) void send(index, (id) => ({ id, kind: 'close', key: this.key }));
    this.primed.clear();
  }

  private async remote(added: Obstacles, index: number, retry: boolean): Promise<HeatDay | null> {
    this.prime(index);
    const answer = await send(index, (id) => ({ id, kind: 'simulate', key: this.key, added }));
    if (answer && answer.kind === 'gone') {
      this.primed.delete(index);
      return retry ? this.remote(added, index, false) : null;
    }
    if (!answer || answer.kind !== 'day') return null;
    return { grid: this.ground.grid, cells: this.bare.cells, temps: answer.temps, light: answer.light, air: answer.air, rays: this.backdrop.rays };
  }
}

export async function openBench(campus: Campus, weather: Weather, spare = 0): Promise<Bench> {
  const key = nextKey;
  nextKey += 1;
  const asked = send(0, (id) => ({ id, kind: 'open', key, campus, weather, reply: true }));
  const primed = [0];
  for (let index = 1; index <= Math.min(spare, LANES - 1); index += 1) {
    primed.push(index);
    void send(index, (id) => ({ id, kind: 'open', key, campus, weather, reply: false }));
  }
  const answer = await asked;
  if (!answer || answer.kind !== 'opened') {
    const { groundValues } = await import('./surface');
    const opened = openCampus(campus, weather);
    return new Bench(opened, contactOf(campus, opened.ground.grid), roofOf(campus), groundValues(campus, opened.ground.grid, campusMiddle(campus)), campus, weather, key, primed.slice(1));
  }
  const ground: Ground = { grid: answer.grid, surface: answer.surface, home: answer.home, open: answer.open };
  const backdrop: Backdrop = { rays: answer.rays, light: answer.light };
  const bare: HeatDay = { grid: ground.grid, cells: ground.grid.cols * ground.grid.rows, temps: answer.temps, light: backdrop.light, air: answer.air, rays: backdrop.rays };
  return new Bench({ ground, backdrop, bare, peak: answer.peak }, answer.contact, answer.roof, answer.paving, campus, weather, key, primed);
}
