import { covered } from '@/engine/aerial';
import type { Campus } from '@/engine/campus';
import { MOST_SCHOOLS, countLine, ordered, photoPicks, schoolKey, slowLink, type Link, type Row } from '@/engine/district';
import { fresh } from '@/engine/memory';
import type { Found } from '@/engine/osm';
import type { Weather } from '@/engine/weather';
import { begin, mapped } from '../yard/loader';
import { recall, remember } from '../yard/recall';
import type { Engine } from './remote';
import { keepCampus, keepDistrict, keepRow, keptCampus, openKept, rowKey } from './store';

export type Phase = 'opening' | 'listing' | 'weather' | 'modelling' | 'photos' | 'done' | 'empty' | 'failed';

const IN_FLIGHT = 2;
const NO_FIXES = { surfaces: [], heights: [], cut: [] };

export class Run {
  readonly place: Found;
  readonly key: string;
  phase: Phase = 'opening';
  total = 0;
  weather: Weather | null = null;
  rows: Row[] = [];
  shown: Row[] = [];
  version = 0;
  private campuses = new Map<string, Campus>();
  private listeners = new Set<() => void>();
  private stop = new AbortController();
  private born: number | null = null;

  constructor(
    place: Found,
    private readonly engine: Engine,
  ) {
    this.place = place;
    this.key = schoolKey(place);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  private emit(): void {
    this.shown = ordered(this.rows);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  count(): string {
    return countLine(this.rows.length, this.total);
  }

  campusOf(key: string): Campus | null {
    return this.campuses.get(key) ?? null;
  }

  close(): void {
    this.stop.abort();
    this.listeners.clear();
  }

  private alive(): boolean {
    return !this.stop.signal.aborted;
  }

  private save(): void {
    void keepDistrict({ key: this.key, place: this.place, at: this.born ?? Date.now(), total: this.total, schools: this.rows.map((row) => row.school), weather: this.weather });
  }

  async start(): Promise<void> {
    const signal = this.stop.signal;
    if (this.rows.length === 0) {
      const { kept, rows } = await openKept(this.place);
      if (!this.alive()) return;
      if (kept) {
        this.born = kept.at;
        this.total = kept.total;
        this.weather = kept.weather;
        const byKey = new Map(rows.map((row) => [row.school, row]));
        this.rows = kept.schools.map((school) => {
          const found = byKey.get(schoolKey(school));
          return found ? { school, status: found.status, summary: found.summary, looked: found.looked } : { school, status: 'waiting' };
        });
        this.emit();
      }
    }
    const weatherAsk = this.weather ? null : this.engine.ask({ kind: 'weather', place: this.place }, signal);
    if (this.rows.length === 0) {
      this.phase = 'listing';
      this.emit();
      const listed = await this.engine.ask({ kind: 'list', place: this.place }, signal);
      if (!this.alive()) return;
      if (listed.kind !== 'listed') {
        this.phase = 'failed';
        this.emit();
        return;
      }
      this.total = listed.listing.total;
      this.rows = listed.listing.schools.slice(0, MOST_SCHOOLS).map((school) => ({ school, status: 'waiting' }));
      if (this.rows.length === 0) {
        this.phase = 'empty';
        this.emit();
        return;
      }
      this.born = Date.now();
      this.save();
      this.emit();
    }
    if (weatherAsk) {
      this.phase = 'weather';
      this.emit();
      const answer = await weatherAsk;
      if (!this.alive()) return;
      if (answer.kind !== 'weather') {
        this.phase = 'failed';
        this.emit();
        return;
      }
      this.weather = answer.weather;
      this.save();
    }
    this.phase = 'modelling';
    this.emit();
    const known = await this.fromYard();
    if (!this.alive()) return;
    const queue = this.rows.filter((row) => {
      const yard = known.get(schoolKey(row.school));
      if (row.status === 'done') return Boolean(yard?.photo && !row.summary?.photo);
      return row.status !== 'unmapped';
    });
    for (const row of queue) if (row.status !== 'done') row.status = 'waiting';
    this.emit();
    let next = 0;
    const lane = async () => {
      while (next < queue.length && this.alive()) {
        const row = queue[next];
        next += 1;
        await this.model(row, known.get(schoolKey(row.school)) ?? null, false);
      }
    };
    await Promise.all(Array.from({ length: IN_FLIGHT }, lane));
    if (!this.alive()) return;
    if (!this.rows.some((row) => row.status === 'done')) {
      this.phase = this.rows.every((row) => row.status === 'unmapped') ? 'done' : 'failed';
      this.emit();
      return;
    }
    if (this.photosAllowed()) {
      this.phase = 'photos';
      this.emit();
      for (;;) {
        const pick = photoPicks(this.rows)[0];
        const row = pick ? this.rows.find((item) => item.school === pick) : undefined;
        if (!pick || !row?.summary || !this.alive()) break;
        const key = schoolKey(pick);
        row.looked = true;
        const before = row.summary;
        const campus = this.campuses.get(key) ?? (await keptCampus(key));
        if (campus) await this.model(row, campus, true);
        if (row.summary === before) void keepRow({ key: rowKey(this.key, key), district: this.key, school: key, at: Date.now(), status: 'done', summary: before, looked: true });
      }
      if (!this.alive()) return;
    }
    this.phase = 'done';
    this.emit();
  }

  private photosAllowed(): boolean {
    const link = (navigator as Navigator & { connection?: Link }).connection;
    return covered(this.place) && !slowLink(link);
  }

  private async fromYard(): Promise<Map<string, Campus>> {
    const known = new Map<string, Campus>();
    const now = Date.now();
    await Promise.all(
      this.rows.map(async (row) => {
        const memory = await recall(row.school);
        if (memory && fresh(memory, now) && mapped(memory.campus)) known.set(schoolKey(row.school), memory.campus);
      }),
    );
    return known;
  }

  private async model(row: Row, campus: Campus | null, photo: boolean): Promise<void> {
    const weather = this.weather;
    if (!weather) return;
    const key = schoolKey(row.school);
    if (!photo && row.status !== 'done') {
      row.status = 'loading';
      this.emit();
    }
    const answer = await this.engine.ask({ kind: 'model', school: row.school, weather, campus, photo }, this.stop.signal);
    if (!this.alive()) return;
    const at = Date.now();
    if (answer.kind === 'modelled' && answer.result) {
      row.status = 'done';
      row.summary = answer.result.summary;
      this.campuses.set(key, answer.result.campus);
      void keepCampus(key, answer.result.campus);
      void keepRow({ key: rowKey(this.key, key), district: this.key, school: key, at, status: 'done', summary: answer.result.summary, looked: row.looked });
    } else if (answer.kind === 'unmapped') {
      if (!photo) row.status = 'unmapped';
      void keepRow({ key: rowKey(this.key, key), district: this.key, school: key, at, status: 'unmapped' });
    } else if (!photo && row.status !== 'done') {
      row.status = row.summary ? 'done' : 'failed';
      if (!row.summary) void keepRow({ key: rowKey(this.key, key), district: this.key, school: key, at, status: 'failed' });
    }
    this.emit();
  }

  async handOver(school: Found): Promise<void> {
    const key = schoolKey(school);
    const memory = await recall(school);
    if (!(memory && fresh(memory, Date.now()) && mapped(memory.campus)) && this.weather) {
      const campus = this.campuses.get(key) ?? (await keptCampus(key));
      if (campus) await remember({ found: school, campus, weather: this.weather, enriched: Boolean(campus.photo), fixes: NO_FIXES });
    }
    begin(school);
  }
}
