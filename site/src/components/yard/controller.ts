import { SURFACES, SURFACE_ORDER, atHome, campusMiddle, campusRadius, placeAt, type Campus, type Ground, type Surface, type Tree } from '@/engine/campus';
import type { Contact } from '@/engine/contact';
import type { RoofUnit } from '@/engine/roof';
import { clamp, insideRing, ringDistance, type Point } from '@/engine/geometry';
import { DAY_END, DAY_START, FULL_SUN, airAt, decode, stepAt, tally, temperatureAt, type Backdrop, type HeatDay, type Tally } from '@/engine/heat';
import { YEARS, treeHeight, treeRadius } from '@/engine/growth';
import { Planner } from '@/engine/planner';
import { cellAt, ellipseSpans, polygonSpans, type Span } from '@/engine/raster';
import { openBench, type Bench } from '@/engine/remote';
import { shadowShift, treeShadow, type Obstacles, type Sail } from '@/engine/shade';
import { sunAt, utcFor, type SunRay } from '@/engine/sun';
import { hourly, type Weather } from '@/engine/weather';

export type Tool = 'look' | 'tree' | 'sail' | 'measure';
export type Reading = { id: number; x: number; y: number; date: string; minute: number; measured: number };
export type PlanTree = Tree & { id: number };
export type Probe = { x: number; y: number; now: number; bare: number; surface: Surface; place: string; home: boolean };
export type Focus = { x: number; y: number; span: number } | null;
export type Saved = { trees: PlanTree[]; sails: Sail[]; years?: number; readings?: Reading[] };

export { GROWTH_FEET, START_FEET, TREE_TALL, YEARS, treeHeight, treeRadius } from '@/engine/growth';
export const SAIL_HEIGHT = 4.5;
const BUILDING_GAP = 3;
const RESIM_GAP = 110;
const AUTO_GAP = 150;
export const COOLED_BY = 15;
export const SQUARE_FEET = 10.7639;
export const RISE = SURFACE_ORDER.map((name) => SURFACES[name].rise);
const RISE_FAST = Float32Array.from(RISE);
const DEGREES_AT_ZERO = decode(0);
const DEGREES_PER_STEP = decode(1) - decode(0);

function snap(value: number): number {
  return Math.round(value * 10) / 10;
}

export function probeHeight(yard: Yard): number {
  return yard.radius * 0.07;
}

export function sunReach(yard: Yard): number {
  return yard.radius * 0.72;
}

export class Yard {
  readonly campus: Campus;
  readonly weather: Weather;
  readonly ground: Ground;
  readonly middle: Point;
  readonly radius: number;
  readonly backdrop: Backdrop;
  readonly contact: Contact;
  readonly roof: RoofUnit[];
  readonly paving: Float32Array;
  readonly bare: HeatDay;
  readonly sunrise: number;
  readonly sunset: number;
  readonly peak: number;
  day: HeatDay;
  minute: number;
  tool: Tool = 'look';
  years = 20;
  trees: PlanTree[] = [];
  sails: Sail[] = [];
  selected: number | null = null;
  readings: Reading[] = [];
  pending: { x: number; y: number } | null = null;
  editing: { patch: number; x: number; y: number } | null = null;
  raising: number | null = null;
  probe: Probe | null = null;
  ghost: { x: number; y: number; ok: boolean } | null = null;
  busy = false;
  planting = 0;
  focus: Focus = null;
  focusTurn = 0;
  heat = 0;
  frame = 0;
  version = 0;
  private nextId = 1;
  private dirty = false;
  private lastSim = 0;
  private lastAuto = 0;
  private queue: Tree[] = [];
  private cooledAt = '';
  private cooledArea = 0;
  private listeners = new Set<() => void>();
  private tallies = new Map<string, Tally>();
  private readonly bench: Bench;
  private asked = 0;
  private shownTurn = 0;
  private flight = 0;
  private plantAsk = 0;
  private waiters: (() => void)[] = [];

  static async open(campus: Campus, weather: Weather, spare = 0): Promise<Yard> {
    return new Yard(campus, weather, await openBench(campus, weather, spare));
  }

  constructor(campus: Campus, weather: Weather, bench: Bench) {
    this.campus = campus;
    this.weather = weather;
    this.bench = bench;
    this.ground = bench.ground;
    this.middle = campusMiddle(campus);
    this.radius = campusRadius(campus);
    this.backdrop = bench.backdrop;
    this.contact = bench.contact;
    this.roof = bench.roof;
    this.paving = bench.paving;
    this.bare = bench.bare;
    this.day = this.bare;
    let rise = DAY_START;
    let set = DAY_END;
    let up = false;
    for (let minute = 180; minute <= 1380; minute += 1) {
      const above = this.sun(minute).z > 0;
      if (above && !up) rise = minute;
      if (!above && up) set = minute;
      up = above;
    }
    this.sunrise = rise;
    this.sunset = set;
    this.peak = bench.peak;
    this.minute = this.peak;
  }

  simulate(added: Obstacles, lane = 0): Promise<HeatDay> {
    return this.bench.simulate(added, lane);
  }

  close(): void {
    this.bench.close();
  }

  settled(): Promise<void> {
    if (!this.working()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  sun(minute = this.minute): SunRay {
    return sunAt(this.campus.center.lat, this.campus.center.lon, utcFor(this.weather.date, minute, this.weather.offset));
  }

  setMinute(minute: number): void {
    const next = clamp(minute, DAY_START, DAY_END);
    if (next === this.minute) return;
    this.minute = next;
    this.frame += 1;
    if (this.probe) this.probeAt(this.probe.x, this.probe.y, true);
    this.emit();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.ghost = null;
    this.pending = null;
    this.editing = null;
    this.raising = null;
    this.emit();
  }

  pickPatch(x: number, y: number): boolean {
    const index = cellAt(this.ground.grid, x, y);
    let found = -1;
    if (index >= 0 && this.ground.home[index]) {
      for (let i = this.campus.patches.length - 1; i >= 0; i -= 1) {
        const patch = this.campus.patches[i];
        if (patch.label && patch.surface !== 'water' && insideRing(patch.ring, x, y)) {
          found = i;
          break;
        }
      }
    }
    const next = found >= 0 ? { patch: found, x, y } : null;
    if (!next && !this.editing && this.raising === null) return false;
    this.editing = next;
    this.raising = null;
    this.emit();
    return next !== null;
  }

  pickBlock(index: number | null): void {
    if (this.raising === index) return;
    this.raising = index;
    this.editing = null;
    this.emit();
  }

  blockAt(x: number, y: number): number | null {
    for (let index = 0; index < this.campus.blocks.length; index += 1) {
      const block = this.campus.blocks[index];
      if (block.home && insideRing(block.ring, x, y)) return index;
    }
    return null;
  }

  closeEdit(): void {
    if (!this.editing && this.raising === null) return;
    this.editing = null;
    this.raising = null;
    this.emit();
  }

  ask(x: number, y: number): void {
    const index = cellAt(this.ground.grid, x, y);
    if (index < 0 || !this.ground.home[index] || this.ground.surface[index] === SURFACES.roof.code) return;
    this.pending = { x, y };
    this.emit();
  }

  cancelAsk(): void {
    if (!this.pending) return;
    this.pending = null;
    this.emit();
  }

  record(measured: number): void {
    if (!this.pending || !Number.isFinite(measured)) return;
    const id = this.nextId;
    this.nextId += 1;
    this.readings = [...this.readings, { id, x: this.pending.x, y: this.pending.y, date: this.weather.date, minute: Math.round(this.minute), measured }];
    this.pending = null;
    this.heat += 1;
    this.emit();
  }

  forget(id: number): void {
    this.readings = this.readings.filter((reading) => reading.id !== id);
    this.heat += 1;
    this.emit();
  }

  modeled(reading: Reading): number {
    const index = cellAt(this.ground.grid, reading.x, reading.y);
    return index < 0 ? Number.NaN : temperatureAt(this.bare, reading.minute, index);
  }

  shownReadings(): Reading[] {
    return this.readings.filter((reading) => reading.date === this.weather.date);
  }

  modelError(): number | null {
    const shown = this.shownReadings();
    if (shown.length === 0) return null;
    let sum = 0;
    for (const reading of shown) sum += Math.abs(this.modeled(reading) - reading.measured);
    return sum / shown.length;
  }

  select(id: number | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  probeAt(x: number, y: number, quiet = false): void {
    const index = cellAt(this.ground.grid, x, y);
    if (index < 0) {
      this.clearProbe();
      return;
    }
    const surface = SURFACE_ORDER[this.ground.surface[index]];
    const moved = !this.probe || Math.abs(this.probe.x - x) > 1.5 || Math.abs(this.probe.y - y) > 1.5 || this.probe.surface !== surface;
    this.probe = {
      x,
      y,
      now: temperatureAt(this.day, this.minute, index),
      bare: temperatureAt(this.bare, this.minute, index),
      surface,
      place: moved || !this.probe ? placeAt(this.campus, x, y, surface) : this.probe.place,
      home: this.ground.home[index] === 1,
    };
    if (!quiet) this.emit();
  }

  clearProbe(): void {
    if (!this.probe && !this.ghost) return;
    this.probe = null;
    this.ghost = null;
    this.emit();
  }

  canPlant(x: number, y: number, skip?: number): boolean {
    const index = cellAt(this.ground.grid, x, y);
    if (index < 0 || !this.ground.open[index]) return false;
    for (const block of this.campus.blocks) {
      if (block.home && ringDistance(block.ring, x, y) < BUILDING_GAP) return false;
    }
    for (const tree of this.trees) {
      if (tree.id !== skip && Math.hypot(tree.x - x, tree.y - y) < 3) return false;
    }
    return true;
  }

  hint(x: number, y: number): void {
    this.ghost = { x, y, ok: this.canPlant(x, y) };
  }

  setYears(years: number): void {
    if (years === this.years) return;
    this.years = years;
    const radius = treeRadius(years);
    const height = treeHeight(years);
    this.trees = this.trees.map((tree) => ({ ...tree, radius, height }));
    this.touch(true);
  }

  plant(atX: number, atY: number): number | null {
    const x = snap(atX);
    const y = snap(atY);
    if (!this.canPlant(x, y)) return null;
    const id = this.nextId;
    this.nextId += 1;
    this.trees = [...this.trees, { id, x, y, radius: treeRadius(this.years), height: treeHeight(this.years) }];
    this.selected = id;
    this.ghost = null;
    this.touch(true);
    return id;
  }

  moveTree(id: number, atX: number, atY: number): void {
    const x = snap(atX);
    const y = snap(atY);
    if (!this.canPlant(x, y, id)) return;
    this.trees = this.trees.map((tree) => (tree.id === id ? { ...tree, x, y } : tree));
    this.touch(false);
  }

  startSail(atX: number, atY: number): number | null {
    const x = snap(atX);
    const y = snap(atY);
    if (!atHome(this.campus, x, y)) return null;
    const id = this.nextId;
    this.nextId += 1;
    this.sails = [...this.sails, { id, corners: [[x, y], [x, y], [x, y], [x, y]], height: SAIL_HEIGHT }];
    this.selected = id;
    this.emit();
    return id;
  }

  stretchSail(id: number, x: number, y: number): void {
    this.sails = this.sails.map((sail) => {
      if (sail.id !== id) return sail;
      const [ax, ay] = sail.corners[0];
      const bx = snap(ax + clamp(x - ax, -40, 40));
      const by = snap(ay + clamp(y - ay, -40, 40));
      return { ...sail, corners: [[ax, ay], [bx, ay], [bx, by], [ax, by]] };
    });
    this.touch(false);
  }

  endSail(id: number): void {
    const sail = this.sails.find((item) => item.id === id);
    if (sail) {
      const [a, , c] = sail.corners;
      if (Math.abs(c[0] - a[0]) < 2 || Math.abs(c[1] - a[1]) < 2) this.sails = this.sails.filter((item) => item.id !== id);
    }
    this.commit();
  }

  remove(id: number): void {
    this.trees = this.trees.filter((tree) => tree.id !== id);
    this.sails = this.sails.filter((sail) => sail.id !== id);
    if (this.selected === id) this.selected = null;
    this.touch(true);
  }

  cursor: { x: number; y: number } | null = null;

  moveCursor(dx: number, dy: number): void {
    const grid = this.ground.grid;
    const from = this.cursor ?? { x: this.middle[0], y: this.middle[1] };
    this.cursor = {
      x: clamp(from.x + dx, grid.minX + 1, grid.minX + grid.cols * grid.cell - 1),
      y: clamp(from.y + dy, grid.minY + 1, grid.minY + grid.rows * grid.cell - 1),
    };
    if (this.tool === 'tree') this.hint(this.cursor.x, this.cursor.y);
    this.probeAt(this.cursor.x, this.cursor.y);
  }

  private nearest(reach: number): number | null {
    if (!this.cursor) return null;
    let best: number | null = null;
    let gap = reach;
    for (const tree of this.trees) {
      const distance = Math.hypot(tree.x - this.cursor.x, tree.y - this.cursor.y);
      if (distance < gap) {
        gap = distance;
        best = tree.id;
      }
    }
    for (const sail of this.sails) {
      const distance = Math.hypot((sail.corners[0][0] + sail.corners[2][0]) / 2 - this.cursor.x, (sail.corners[0][1] + sail.corners[2][1]) / 2 - this.cursor.y);
      if (distance < gap) {
        gap = distance;
        best = sail.id;
      }
    }
    return best;
  }

  actAtCursor(): 'planted' | 'sail' | 'asked' | 'picked' | 'none' {
    if (!this.cursor) return 'none';
    const { x, y } = this.cursor;
    if (this.tool === 'tree') return this.plant(x, y) === null ? 'none' : 'planted';
    if (this.tool === 'sail') {
      const id = this.startSail(x - 4.5, y - 4.5);
      if (id === null) return 'none';
      this.stretchSail(id, x + 4.5, y + 4.5);
      this.endSail(id);
      return 'sail';
    }
    if (this.tool === 'measure') {
      this.ask(x, y);
      return this.pending ? 'asked' : 'none';
    }
    const id = this.nearest(12);
    this.select(id);
    if (id !== null) return 'picked';
    const block = this.blockAt(x, y);
    if (block !== null) {
      this.pickBlock(block);
      return 'picked';
    }
    return this.pickPatch(x, y) ? 'picked' : 'none';
  }

  removeAtCursor(): boolean {
    const id = this.selected ?? this.nearest(12);
    if (id === null) return false;
    this.remove(id);
    return true;
  }

  undo(): void {
    const ids = [...this.trees.map((tree) => tree.id), ...this.sails.map((sail) => sail.id)];
    if (ids.length > 0) this.remove(Math.max(...ids));
  }

  clear(): void {
    this.trees = [];
    this.sails = [];
    this.selected = null;
    this.touch(true);
  }

  load(saved: Saved): void {
    this.years = YEARS.includes(saved.years ?? 0) ? (saved.years as number) : 20;
    const radius = treeRadius(this.years);
    const height = treeHeight(this.years);
    this.trees = saved.trees.map((tree) => ({ ...tree, x: snap(tree.x), y: snap(tree.y), radius, height }));
    this.sails = saved.sails.map((sail) => ({ ...sail, corners: sail.corners.map(([x, y]) => [snap(x), snap(y)]) as Sail['corners'] }));
    this.readings = Array.isArray(saved.readings) ? saved.readings : [];
    this.nextId = Math.max(0, ...saved.trees.map((tree) => tree.id), ...saved.sails.map((sail) => sail.id), ...this.readings.map((reading) => reading.id)) + 1;
    this.touch(true);
  }

  saved(): Saved {
    return { trees: this.trees, sails: this.sails, years: this.years, readings: this.readings };
  }

  private touch(now: boolean): void {
    this.dirty = true;
    if (now) this.commit();
    else this.emit();
  }

  commit(): void {
    if (this.dirty) this.resim();
    this.settle();
    this.emit();
  }

  lookAt(focus: Focus): void {
    this.focus = focus;
    this.focusTurn += 1;
    this.emit();
  }

  startAuto(count: number): void {
    if (this.planting > 0) return;
    if (this.dirty) this.resim();
    if (this.flight !== 0) {
      this.plantAsk = count;
      this.planting = count;
      this.emit();
      return;
    }
    const planner = new Planner(this.campus, this.ground, this.day, this.weather, treeRadius(this.years), treeHeight(this.years));
    planner.block(this.trees);
    this.queue = [];
    for (let index = 0; index < count; index += 1) {
      const tree = planner.next();
      if (!tree) break;
      this.queue.push(tree);
    }
    this.planting = this.queue.length;
    this.selected = null;
    if (this.queue.length > 0) {
      const xs = this.queue.map((tree) => tree.x);
      const ys = this.queue.map((tree) => tree.y);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2;
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      const span = Math.max(60, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 45);
      this.lookAt({ x, y, span });
    } else {
      this.emit();
    }
  }

  private autoStep(): void {
    const tree = this.queue.shift();
    if (tree) {
      const id = this.nextId;
      this.nextId += 1;
      this.trees = [...this.trees, { id, ...tree, x: snap(tree.x), y: snap(tree.y) }];
      this.dirty = true;
    }
    this.planting = this.queue.length;
    if (this.planting === 0) this.commit();
    else this.emit();
  }

  cooled(minute = this.minute): number {
    const key = `${Math.round(minute / 5)} ${this.heat}`;
    if (key === this.cooledAt) return this.cooledArea;
    this.cooledAt = key;
    this.cooledArea = 0;
    if (this.day === this.bare) return 0;
    const { low } = stepAt(minute);
    const offset = low * this.day.cells;
    const roof = SURFACES.roof.code;
    const gap = COOLED_BY * 1.25;
    let cells = 0;
    for (let index = 0; index < this.day.cells; index += 1) {
      if (!this.ground.home[index] || this.ground.surface[index] === roof) continue;
      if (this.bare.temps[offset + index] - this.day.temps[offset + index] >= gap) cells += 1;
    }
    this.cooledArea = cells * this.ground.grid.cell * this.ground.grid.cell;
    return this.cooledArea;
  }

  tick(time: number): void {
    if (this.plantAsk === 0 && this.planting > 0 && time - this.lastAuto > AUTO_GAP) {
      this.autoStep();
      this.lastAuto = performance.now();
    }
    if (this.dirty && this.flight === 0 && time - this.lastSim > RESIM_GAP) {
      this.resim();
      this.lastSim = performance.now();
      this.emit();
    }
  }

  private resim(): void {
    this.dirty = false;
    this.asked += 1;
    const turn = this.asked;
    if (this.trees.length + this.sails.length === 0) {
      this.apply(this.bare, turn);
      return;
    }
    if (this.flight !== 0) {
      this.dirty = true;
      return;
    }
    this.flight = turn;
    void this.bench.simulate({ blocks: [], trees: this.trees, sails: this.sails }).then((day) => {
      if (this.flight === turn) this.flight = 0;
      this.apply(day, turn);
      this.emit();
    });
  }

  private apply(day: HeatDay, turn: number): void {
    if (turn > this.shownTurn) {
      this.shownTurn = turn;
      this.day = day;
      this.heat += 1;
      this.frame += 1;
      this.tallies.clear();
      if (this.probe) this.probeAt(this.probe.x, this.probe.y, true);
    }
    this.settle();
  }

  private settle(): void {
    if (this.dirty || this.flight !== 0) return;
    if (this.plantAsk > 0) {
      const count = this.plantAsk;
      this.plantAsk = 0;
      this.planting = 0;
      this.startAuto(count);
    }
    if (this.planting > 0 || this.dirty || this.flight !== 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const done of waiters) done();
  }

  tallyOf(which: 'day' | 'bare', minute = this.minute): Tally {
    const day = which === 'day' ? this.day : this.bare;
    const key = day === this.bare ? `bare ${Math.round(minute)} 0` : `day ${Math.round(minute)} ${this.heat}`;
    let result = this.tallies.get(key);
    if (!result) {
      result = tally(day, this.ground, minute);
      if (this.tallies.size > 400) this.tallies.clear();
      this.tallies.set(key, result);
    }
    return result;
  }

  private effect(run: (emit: Span) => void, minute: number): { place: string; cooler: number } {
    const { low } = stepAt(minute);
    const offset = low * this.day.cells;
    const grid = this.ground.grid;
    let cooler = 0;
    let best = -1;
    run((row, from, to) => {
      for (let index = row * grid.cols + from; index <= row * grid.cols + to; index += 1) {
        if (!this.ground.home[index]) continue;
        const gap = this.bare.temps[offset + index] - this.day.temps[offset + index];
        if (gap > cooler) {
          cooler = gap;
          best = index;
        }
      }
    });
    if (best < 0) return { place: 'Grass', cooler: 0 };
    const row = Math.floor(best / grid.cols);
    const col = best - row * grid.cols;
    const x = grid.minX + (col + 0.5) * grid.cell;
    const y = grid.minY + (row + 0.5) * grid.cell;
    return { place: placeAt(this.campus, x, y, SURFACE_ORDER[this.ground.surface[best]]), cooler: cooler / 1.25 };
  }

  treeEffect(tree: Tree, minute = this.peak): { place: string; cooler: number } {
    const shadow = treeShadow(tree, this.sun(minute));
    return this.effect((emit) => ellipseSpans(this.ground.grid, shadow.x, shadow.y, shadow.along, shadow.across, shadow.angle, emit), minute);
  }

  sailEffect(sail: Sail, minute = this.peak): { place: string; cooler: number } {
    const [dx, dy] = shadowShift(this.sun(minute), sail.height);
    const ring = sail.corners.map(([x, y]) => [x + dx, y + dy] as Point);
    return this.effect((emit) => polygonSpans(this.ground.grid, ring, emit), minute);
  }

  surfaceMeans(minute = this.peak): number[] {
    const { low } = stepAt(minute);
    const offset = low * this.day.cells;
    const sums = SURFACE_ORDER.map(() => 0);
    const counts = SURFACE_ORDER.map(() => 0);
    for (let index = 0; index < this.day.cells; index += 1) {
      if (!this.ground.home[index]) continue;
      const code = this.ground.surface[index];
      sums[code] += this.bare.temps[offset + index];
      counts[code] += 1;
    }
    return sums.map((sum, code) => (counts[code] > 0 ? decode(sum / counts[code]) : this.air(minute)));
  }

  air(minute = this.minute): number {
    return airAt(this.day, minute);
  }

  blend: { to: HeatDay; mix: number } | null = null;

  setBlend(to: HeatDay | null, mix: number): void {
    const next = to && mix > 0.001 ? { to, mix: Math.min(1, mix) } : null;
    if (!next && !this.blend) return;
    if (next && this.blend && this.blend.to === next.to && Math.abs(this.blend.mix - next.mix) < 0.004) return;
    this.blend = next;
    this.frame += 1;
  }

  setBase(day: HeatDay): void {
    if (this.day === day) return;
    this.day = day;
    this.frame += 1;
  }

  working(): boolean {
    return this.planting > 0 || this.dirty || this.flight !== 0;
  }

  private shown: Int32Array | null = null;

  readyCells(): void {
    this.shownCells();
  }

  private shownCells(): Int32Array {
    if (this.shown) return this.shown;
    const { cols, rows } = this.ground.grid;
    const home = this.ground.home;
    const list: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        let near = false;
        for (let dr = -1; dr <= 1 && !near; dr += 1) {
          const r = row + dr;
          if (r < 0 || r >= rows) continue;
          for (let dc = -1; dc <= 1; dc += 1) {
            const c = col + dc;
            if (c >= 0 && c < cols && home[r * cols + c] === 1) {
              near = true;
              break;
            }
          }
        }
        if (near) list.push(row * cols + col);
      }
    }
    this.shown = Int32Array.from(list);
    return this.shown;
  }

  fillHeat(target: Uint8Array): number {
    const { low, high, share } = stepAt(this.minute);
    const day = this.day;
    const a = low * day.cells;
    const b = high * day.cells;
    const air = airAt(day, this.minute);
    const power = hourly(this.weather.sunshine, this.minute) / FULL_SUN / 255;
    const surface = this.ground.surface;
    const temps = day.temps;
    const light = day.light;
    const other = this.blend ? this.blend.to : null;
    const otherTemps = other ? other.temps : temps;
    const otherLight = other ? other.light : light;
    const mix = other && this.blend ? this.blend.mix : 0;
    const shown = this.shownCells();
    const count = shown.length;
    for (let k = 0; k < count; k += 1) {
      const index = shown[k];
      const rise = RISE_FAST[surface[index]];
      let byte: number;
      if (rise > 0) {
        let value = temps[a + index];
        value += (temps[b + index] - value) * share;
        if (mix > 0) {
          let next = otherTemps[a + index];
          next += (otherTemps[b + index] - next) * share;
          value += (next - value) * mix;
        }
        byte = ((value * DEGREES_PER_STEP + DEGREES_AT_ZERO - air) / rise) * 200;
      } else {
        let lit = light[a + index];
        lit += (light[b + index] - lit) * share;
        if (mix > 0) {
          let next = otherLight[a + index];
          next += (otherLight[b + index] - next) * share;
          lit += (next - lit) * mix;
        }
        byte = power * lit * 200;
      }
      target[index] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
    }
    return air;
  }

  toScene(x: number, y: number): [number, number, number] {
    return [x - this.middle[0], 0, -(y - this.middle[1])];
  }

  fromScene(x: number, z: number): Point {
    return [x + this.middle[0], -z + this.middle[1]];
  }
}
