import { covered } from '@/engine/aerial';
import { CAMPUS_VERSION, outdated, type Campus } from '@/engine/campus';
import { MOST_SCHOOLS, bareGround, countLine, photoPicks, schoolKey, shownRows, skipPhotos, upToDate, type Link, type Row } from '@/engine/district';
import type { Found } from '@/engine/osm';
import type { Weather } from '@/engine/weather';
import { begin, usable } from '../yard/loader';
import { recall, remember } from '../yard/recall';
import { hasFixes } from '../yard/store';
import type { Engine } from './remote';
import { keepCampus, keepDistrict, keepRow, keptCampus, openKept, rowKey, type KeptRow } from './store';

export type Phase = 'opening' | 'listing' | 'weather' | 'modelling' | 'photos' | 'done' | 'empty' | 'failed';

const IN_FLIGHT = 2;
const NO_FIXES = { surfaces: [], heights: [], cut: [] };

export class Run {
  readonly place: Found;
  readonly key: string;
  phase: Phase = 'opening';
  failure: 'map' | 'weather' | null = null;
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
    this.shown = shownRows(this.rows);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  count(): string {
    return countLine(this.shown.length, Math.max(this.total, this.rows.length));
  }

  close(): void {
    this.stop.abort();
    this.listeners.clear();
  }

  private alive(): boolean {
    return !this.stop.signal.aborted;
  }

  private fail(failure: 'map' | 'weather'): void {
    this.failure = failure;
    this.phase = 'failed';
    this.emit();
  }

  private save(): void {
    void keepDistrict({ key: this.key, place: this.place, at: this.born ?? Date.now(), total: this.total, schools: this.rows.map((row) => row.school), weather: this.weather });
  }

  private keep(row: Row, status: KeptRow['status'], version: number): void {
    const school = schoolKey(row.school);
    void keepRow({ key: rowKey(this.key, school), district: this.key, school, at: Date.now(), status, summary: row.summary, looked: row.looked, version });
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
          if (!found || (found.version ?? 0) < CAMPUS_VERSION || (found.status === 'done' && !upToDate(found.summary))) return { school, status: 'waiting' };
          return { school, status: found.status, summary: found.summary, looked: found.looked };
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
        this.fail('map');
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
        this.fail('weather');
        return;
      }
      this.weather = answer.weather;
      this.save();
    }
    this.failure = null;
    this.phase = 'modelling';
    this.emit();
    const known = await this.fromYard();
    if (!this.alive()) return;
    const queue = this.rows.filter((row) => {
      const yard = known.get(schoolKey(row.school));
      if (row.status === 'done') return Boolean(yard?.photo && !row.summary?.photo);
      return row.status !== 'unmapped' && row.status !== 'bare';
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
      if (this.rows.some((row) => row.status === 'failed')) this.fail('map');
      else {
        this.phase = 'done';
        this.emit();
      }
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
        if (campus && !outdated(campus)) await this.model(row, campus, true);
        if (row.summary === before) this.keep(row, 'done', before.version);
      }
      if (!this.alive()) return;
    }
    this.phase = 'done';
    this.emit();
  }

  private photosAllowed(): boolean {
    const link = (navigator as Navigator & { connection?: Link }).connection;
    return covered(this.place) && !skipPhotos(link, window.matchMedia('(pointer: coarse)').matches);
  }

  private async fromYard(): Promise<Map<string, Campus>> {
    const known = new Map<string, Campus>();
    const now = Date.now();
    await Promise.all(
      this.rows.map(async (row) => {
        const memory = await recall(row.school);
        if (memory && usable(memory, now)) known.set(schoolKey(row.school), memory.campus);
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
    if (answer.kind === 'modelled' && answer.result) {
      const { summary } = answer.result;
      row.summary = summary;
      row.status = bareGround(summary) ? 'bare' : 'done';
      this.campuses.set(key, answer.result.campus);
      void keepCampus(key, answer.result.campus);
      this.keep(row, row.status, summary.version);
    } else if (answer.kind === 'unmapped') {
      if (!photo) row.status = 'unmapped';
      this.keep(row, 'unmapped', CAMPUS_VERSION);
    } else if (!photo && row.status !== 'done') {
      row.status = row.summary ? 'done' : 'failed';
      if (!row.summary) this.keep(row, 'failed', CAMPUS_VERSION);
    }
    this.emit();
  }

  async handOver(school: Found): Promise<void> {
    const key = schoolKey(school);
    const memory = await recall(school);
    if (!(memory && usable(memory, Date.now())) && !(memory && hasFixes(memory.fixes))) {
      const campus = this.campuses.get(key) ?? (await keptCampus(key));
      if (campus && !outdated(campus)) await remember({ found: school, campus, weather: memory?.weather ?? null, enriched: Boolean(campus.photo), fixes: NO_FIXES });
    }
    begin(school, this.weather ?? undefined);
  }
}
