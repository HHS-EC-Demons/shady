import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlantIcon } from '@phosphor-icons/react/dist/csr/Plant';
import { ThermometerIcon } from '@phosphor-icons/react/dist/csr/Thermometer';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { TreeIcon } from '@phosphor-icons/react/dist/csr/Tree';
import { UmbrellaIcon } from '@phosphor-icons/react/dist/csr/Umbrella';
import { animate, useReducedMotion } from 'motion/react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { behind, newer } from '@/engine/aerial';
import { SURFACES, surfaceChoices, type Campus, type Surface } from '@/engine/campus';
import { centerOf } from '@/engine/geometry';
import { DAY_END, DAY_START, RAMP, TOUCH_LIMIT, sharePair } from '@/engine/heat';
import type { Found } from '@/engine/osm';
import { placeKey } from '@/engine/memory';
import { warmUp } from '@/engine/remote';
import { decodePlan } from '@/engine/share';
import { clockLabel } from '@/engine/sun';
import { FIRST_DAY, dayWeather, lastDay, localDay, minuteNow, todayWeather, type Weather } from '@/engine/weather';
import { canDraw } from '@/lib/utils';
import { SQUARE_FEET, YEARS, Yard, probeHeight, sunReach, type Cut, type Saved, type Tool } from './controller';
import { NoWeather, Unmapped, ownHottest, picked, placeBundle, stopPhotos, type Shown, type Stage } from './loader';
import { quality } from './quality';
import { rememberFixes } from './recall';
import { SchoolPicker } from './SchoolPicker';
import { OpenShared } from './ShareDialogs';
import { adopt, clashes, dropHash, sharedBundle, sharedText, watchHash } from './shared';
import { carry, cutTree, editHeight, editSurface, fixesOf, keepPlan, keepSchool, loadBundle, restorePlan, type Bundle } from './store';

const YardCanvas = lazy(() => import('./YardCanvas'));
const Still = lazy(() => import('../plan/PlanSheet').then((module) => ({ default: module.Map })));
const loadCalendar = () => import('@/components/ui/calendar');
const Calendar = lazy(() => loadCalendar().then((module) => ({ default: module.Calendar })));

type Kept = { key: string; bundle: Bundle; weather: Weather; yard: Yard };

let kept: Kept | null = null;

function keyOf(campus: Campus, weather: Weather): string {
  return `${campus.name} ${campus.center.lat} ${weather.date}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day} ${year}`;
}

function hourName(minute: number): string {
  const hour = Math.round(minute / 60);
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

function Legend() {
  const marks = [90, TOUCH_LIMIT, 160];
  return (
    <div className="pointer-events-none absolute bottom-[5.25rem] right-[var(--gutter)] flex flex-col gap-1 rounded-lg border border-rule bg-raised px-3 pb-1.5 pt-2.5 sm:bottom-6" aria-hidden="true">
      <div className="flex h-2.5 w-44 overflow-hidden rounded-[3px]">
        {RAMP.map(([degrees, color]) => (
          <span key={degrees} className="flex-1" style={{ background: `rgb(${color.join(' ')})` }} />
        ))}
      </div>
      <div className="data flex w-44 justify-between text-[0.8125rem] text-soft">
        {marks.map((mark) => (
          <span key={mark}>{mark}°</span>
        ))}
      </div>
    </div>
  );
}

type Day = 'hottest' | 'today' | 'pick';

function dateOf(text: string): Date {
  const [year, month, day] = text.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dayOf(bundle: Bundle): Day {
  return picked(bundle) || (bundle.hottest && bundle.hottest.date !== bundle.weather.date) ? 'pick' : 'hottest';
}

type DayChoiceProps = { day: Day; picked: string; onDay: (day: Day, date?: string) => void; refocus: RefObject<boolean>; pending: Day | null };

const WAITING = 'aria-busy:opacity-70 aria-busy:animate-pulse';

function DayChoice({ day, picked, onDay, refocus, pending }: DayChoiceProps) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [refocus]);
  const today = localDay();
  const first = dateOf(FIRST_DAY);
  const last = dateOf(lastDay(today));
  const chosen = day === 'pick' ? dateOf(picked) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <ToggleGroup
          ref={group}
          type="single"
          variant="outline"
          size="lg"
          spacing={0}
          value={day}
          onValueChange={(value) => {
            if (value === 'hottest' || value === 'today') onDay(value);
          }}
          aria-label="Day to model"
          className="absolute right-[var(--gutter)] top-[4.5rem] bg-raised"
        >
          <ToggleGroupItem value="hottest" aria-busy={pending === 'hottest' || undefined} className={`h-11 px-3.5 text-[0.9375rem] ${WAITING}`}>
            Hottest day
          </ToggleGroupItem>
          <ToggleGroupItem value="today" aria-busy={pending === 'today' || undefined} className={`h-11 px-3.5 text-[0.9375rem] ${WAITING}`}>
            Today
          </ToggleGroupItem>
          <ToggleGroupItem
            ref={opener}
            value="pick"
            aria-busy={pending === 'pick' || undefined}
            className={`h-11 gap-2 px-3.5 text-[0.9375rem] ${WAITING}`}
            onPointerEnter={() => void loadCalendar()}
            onFocus={() => void loadCalendar()}
            onClick={() => setOpen((shown) => !shown)}
          >
            <CalendarBlankIcon aria-hidden="true" />
            {day === 'pick' ? dayLabel(picked) : 'Pick a day'}
          </ToggleGroupItem>
        </ToggleGroup>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-auto bg-raised p-2"
        aria-label="Pick a day"
        onInteractOutside={(event) => {
          if (opener.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <Suspense fallback={<div className="h-[22rem] w-[19rem]" />}>
          <Calendar
            mode="single"
            required
            selected={chosen}
            defaultMonth={chosen ?? dateOf(today)}
            startMonth={first}
            endMonth={last}
            disabled={[{ before: first }, { after: last }]}
            captionLayout="dropdown"
            autoFocus
            onSelect={(date) => {
              if (!date) return;
              setOpen(false);
              onDay('pick', localDay(date.getTime()));
            }}
            className="bg-transparent [--cell-size:--spacing(10)]"
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

type LoadedProps = {
  yard: Yard;
  onFind: () => void;
  day: Day;
  onDay: (day: Day, date?: string) => void;
  onEdit: (patch: number, surface: Surface) => void;
  onRaise: (block: number, height: number) => void;
  finder: RefObject<HTMLButtonElement | null>;
  first: RefObject<boolean>;
  aim: RefObject<number | null>;
  refocus: RefObject<boolean>;
  waiting: Day | null;
  trouble: string;
};

function Roof({ yard, index, onRaise }: { yard: Yard; index: number; onRaise: (block: number, height: number) => void }) {
  const block = yard.campus.blocks[index];
  const [feet, setFeet] = useState(Math.round(block.height * 3.28084));
  const [x, y] = centerOf(block.ring);
  const at = yard.toScene(x, y);
  return (
    <div data-at={`${at[0]} ${block.height} ${at[2]}`} className="absolute left-0 top-0">
      <div className="pointer-events-auto absolute flex w-60 -translate-x-1/2 -translate-y-full items-center gap-3 rounded-xl border border-rule bg-raised px-3.5 py-3 shadow-[0_8px_24px_rgba(18,38,28,0.22)]">
        <Slider
          min={8}
          max={90}
          step={1}
          value={[feet]}
          onValueChange={([value]) => setFeet(value)}
          onValueCommit={([value]) => onRaise(index, value / 3.28084)}
          label="Building height"
          valueText={`${feet} feet`}
        />
        <span className="data w-14 shrink-0 text-right text-[0.9375rem] font-semibold">{feet} ft</span>
      </div>
    </div>
  );
}

function Loaded({ yard, onFind, day, onDay, onEdit, onRaise, finder, first, aim, refocus, waiting, trouble }: LoadedProps) {
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState('');
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  useSyncExternalStore(yard.subscribe, yard.snapshot, yard.snapshot);
  const still = useReducedMotion();
  const [solid] = useState(canDraw);
  const [drawn, setDrawn] = useState(!solid);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (solid) return;
    let frame = 0;
    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    const run = () => {
      frame = 0;
      yard.tick(performance.now());
      if (yard.working()) wake();
    };
    wake();
    const stop = yard.subscribe(wake);
    return () => {
      stop();
      window.cancelAnimationFrame(frame);
    };
  }, [yard, solid]);

  useEffect(() => {
    let timer = 0;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => setPainted(true), 60);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!drawn || still || !first.current) return;
    first.current = false;
    const target = yard.minute;
    aim.current = target;
    yard.setMinute(yard.sunrise);
    const sweep = animate(yard.sunrise, target, {
      duration: 3.4,
      delay: 0.35,
      ease: [0.3, 0.05, 0.2, 1],
      onUpdate: (value) => yard.setMinute(value),
      onComplete: () => {
        aim.current = null;
      },
    });
    const stop = () => {
      sweep.stop();
      aim.current = null;
    };
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      stop();
      window.removeEventListener('pointerdown', stop);
    };
  }, [yard, still, drawn]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && yard.selected !== null && !(event.target instanceof HTMLInputElement)) {
        yard.remove(yard.selected);
      }
      if (event.key === 'Escape') {
        if (yard.pending) yard.cancelAsk();
        else if (yard.editing || yard.raising !== null) yard.closeEdit();
        else yard.setTool('look');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [yard]);

  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<number | null>(null);
  const spotOf = (event: ReactPointerEvent<HTMLDivElement>): [number, number] | null => {
    const matrix = event.currentTarget.querySelector('svg')?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, -point.y];
  };
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    const spot = spotOf(event);
    if (!spot) return;
    if (yard.tool === 'tree') yard.plant(spot[0], spot[1]);
    if (yard.tool !== 'sail') return;
    sheet.current = yard.startSail(spot[0], spot[1]);
    if (sheet.current !== null) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const stretch = (event: ReactPointerEvent<HTMLDivElement>) => {
    const spot = spotOf(event);
    if (spot && sheet.current !== null) yard.stretchSail(sheet.current, spot[0], spot[1]);
  };
  const release = () => {
    if (sheet.current !== null) yard.endSail(sheet.current);
    sheet.current = null;
  };
  const hours = useMemo(() => {
    const reach = sunReach(yard);
    const marks: { minute: number; at: string }[] = [];
    for (let minute = Math.ceil((yard.sunrise + 40) / 180) * 180; minute <= yard.sunset - 40; minute += 180) {
      const ray = yard.sun(minute);
      const out = reach * 1.12;
      marks.push({ minute, at: `${ray.x * out} ${ray.z * out} ${-ray.y * out}` });
    }
    return marks;
  }, [yard]);
  const probe = yard.probe && yard.probe.home && yard.probe.surface !== 'roof' ? yard.probe : null;
  const cooler = probe ? probe.bare - probe.now : 0;

  const now = yard.tallyOf('day');
  const before = yard.tallyOf('bare');
  const planned = yard.trees.length + yard.sails.length > 0;
  const cooled = planned ? Math.round((yard.cooled() * SQUARE_FEET) / 100) * 100 : 0;
  const hot = Math.round(now.hot * 100);
  const [hotText, wasText] = sharePair(now.hot, before.hot);
  const readings = yard.shownReadings();
  const error = yard.modelError();
  const pending = yard.pending;
  const editing = yard.editing;
  const edited = editing ? yard.campus.patches[editing.patch] : null;
  const choices = edited ? surfaceChoices(edited.surface) : [];
  const save = () => {
    const value = Number.parseFloat(typed);
    if (Number.isFinite(value)) yard.record(value);
    setTyped('');
  };
  const treeCount = yard.trees.length;
  const sailCount = yard.sails.length;
  useEffect(() => {
    if (treeCount + sailCount === 0) return;
    setSaid(`${treeCount} ${treeCount === 1 ? 'tree' : 'trees'} and ${sailCount} ${sailCount === 1 ? 'sail' : 'sails'} planned. Cooled ground ${cooled.toLocaleString('en-US')} square feet.`);
  }, [treeCount, sailCount, cooled]);

  useEffect(() => {
    if (trouble) setSaid(trouble);
  }, [trouble]);

  const steer = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 20 : 4;
    const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      yard.moveCursor(move[0], move[1]);
      const at = yard.probe;
      if (at) setSaid(`${at.place}, ${Math.round(at.now)} degrees`);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const done = yard.actAtCursor();
      const words = { planted: 'Tree planted', sail: 'Sail placed', asked: 'Type the reading', picked: 'Selected', removed: 'Tree removed', restored: 'Tree back', none: 'Nothing placed here' };
      setSaid(words[done]);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setSaid(yard.removeAtCursor() ? 'Removed' : 'Nothing to remove here');
    }
  };

  return (
    <div className="absolute inset-0 grid grid-rows-[minmax(0,1fr)_auto]">
      <div
        className="relative min-h-0 focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-1 focus-visible:after:z-10 focus-visible:after:border-[3px] focus-visible:after:border-leaf"
        tabIndex={0}
        role="application"
        aria-label={`3D model of ${yard.campus.name} coloured by ground temperature. Arrow keys move a pointer north, south, east and west. Enter uses the selected tool at the pointer. Delete removes the nearest tree or sail.`}
        onKeyDown={steer}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>
        {painted && solid && (
          <Suspense fallback={null}>
            <YardCanvas yard={yard} layer={layer} tier={tier} drawn={drawn} conifers={yard.campus.trees.some((tree) => tree.needle === true)} onReady={() => setDrawn(true)} />
          </Suspense>
        )}
        {!solid && (
          <div
            className={`absolute inset-x-[var(--gutter)] bottom-36 top-32 touch-none sm:bottom-24 [&>svg]:size-full [&>svg]:max-h-none [&>svg]:rounded-none [&>svg]:border-0 [&>svg]:bg-transparent ${yard.tool === 'look' ? '' : 'cursor-crosshair'}`}
            onPointerDown={press}
            onPointerMove={stretch}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <Suspense fallback={null}>
              <Still key={`${yard.heat} ${yard.trees.length} ${yard.sails.length}`} yard={yard} />
            </Suspense>
          </div>
        )}
        {!drawn && <Skeleton className="absolute inset-0 rounded-none bg-muted" />}

        <div ref={layer} className={solid ? 'pointer-events-none absolute inset-0 overflow-hidden' : 'hidden'}>
          {hours.map((hour) => (
            <span key={hour.minute} data-at={hour.at} data-hour="" className="absolute left-0 top-0 transition-opacity duration-200" aria-hidden="true">
              <span className="data absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[0.8125rem] text-soft">{hourName(hour.minute)}</span>
            </span>
          ))}
          {readings.map((reading) => (
            <div key={reading.id} data-at={`${yard.toScene(reading.x, reading.y)[0]} 0 ${yard.toScene(reading.x, reading.y)[2]}`} className="absolute left-0 top-0">
              <button
                type="button"
                onClick={() => yard.forget(reading.id)}
                aria-label={`Remove the reading of ${Math.round(reading.measured)}°F`}
                className="data pointer-events-auto absolute flex h-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border-2 border-oak bg-raised px-3 text-[0.9375rem] font-semibold text-oak"
              >
                {Math.round(reading.measured)}°F
                <span className="font-normal text-soft">model {Math.round(yard.modeled(reading))}°F</span>
              </button>
            </div>
          ))}
          {pending && (
            <div data-at={`${yard.toScene(pending.x, pending.y)[0]} 0 ${yard.toScene(pending.x, pending.y)[2]}`} className="absolute left-0 top-0">
              <form
                className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-xl border border-rule bg-raised p-2 shadow-[0_8px_24px_rgba(18,38,28,0.22)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <Input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="°F"
                  aria-label="Ground temperature you measured in degrees Fahrenheit"
                  className="data h-11 w-24 bg-white text-base"
                />
                <Button type="submit" size="lg" className="h-11 px-4 text-base" disabled={typed.trim() === ''}>
                  Save
                </Button>
              </form>
            </div>
          )}
          {editing && edited && choices.length > 1 && (
            <div data-at={`${yard.toScene(editing.x, editing.y)[0]} 0 ${yard.toScene(editing.x, editing.y)[2]}`} className="absolute left-0 top-0">
              <ToggleGroup
                type="single"
                variant="outline"
                size="lg"
                spacing={0}
                value={edited.surface}
                onValueChange={(value) => value && onEdit(editing.patch, value as Surface)}
                aria-label={`Surface of this ${(edited.label ?? 'ground').toLowerCase()}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full bg-raised shadow-[0_8px_24px_rgba(18,38,28,0.22)]"
              >
                {choices.map((choice) => (
                  <ToggleGroupItem key={choice} value={choice} className="h-11 px-3.5 text-[0.9375rem]">
                    {SURFACES[choice].name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          {yard.raising !== null && <Roof key={yard.raising} yard={yard} index={yard.raising} onRaise={onRaise} />}
          {probe && !pending && !editing && yard.raising === null && (
            <div data-at={`${yard.toScene(probe.x, probe.y)[0]} ${probeHeight(yard)} ${yard.toScene(probe.x, probe.y)[2]}`} className="absolute left-0 top-0" aria-hidden="true">
              <div className="absolute -translate-x-1/2 -translate-y-full pb-1.5">
                <div className="rounded-md bg-oak px-2.5 py-1.5 text-center text-raised shadow-[0_6px_18px_rgba(18,38,28,0.28)]">
                  <div className="data whitespace-nowrap text-[1.0625rem] font-semibold leading-tight">{Math.round(probe.now)}°F</div>
                  <div className="whitespace-nowrap text-[0.8125rem] leading-tight text-[#c9d6d0]">
                    {probe.place}
                    {cooler >= 2 ? `, ${Math.round(cooler)}° cooler` : ''}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <DayChoice day={day} picked={yard.weather.date} onDay={onDay} refocus={refocus} pending={waiting} />
        <div className="absolute bottom-6 left-[var(--gutter)] flex items-center gap-2.5">
          {solid && yard.focus !== null && (
            <Button variant="outline" size="icon-lg" className="size-11 bg-raised" aria-label="Show the whole campus" onClick={() => yard.lookAt(null)}>
              <ArrowsOutIcon aria-hidden="true" />
            </Button>
          )}
          {planned && yard.selected === null && (
            <Button variant="outline" size="icon-lg" className="size-11 bg-raised" aria-label="Undo the last tree or sail" disabled={yard.planting > 0} onClick={() => yard.undo()}>
              <ArrowCounterClockwiseIcon aria-hidden="true" />
            </Button>
          )}
          {yard.selected !== null && (
            <Button variant="outline" size="icon-lg" className="size-11 bg-raised" aria-label="Remove the selected shade" onClick={() => yard.remove(yard.selected as number)}>
              <TrashIcon aria-hidden="true" />
            </Button>
          )}
          {yard.trees.length > 0 && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="lg"
              spacing={0}
              value={String(yard.years)}
              onValueChange={(value) => value && yard.setYears(Number(value))}
              aria-label="Years of tree growth"
              className="bg-raised"
            >
              {YEARS.map((years) => (
                <ToggleGroupItem key={years} value={String(years)} className="data h-11 px-3 text-[0.9375rem]">
                  {years} yr
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
        <Legend />
      </div>

      <div className="relative border-t border-rule bg-raised">
        <div className="absolute inset-x-0 top-0 -translate-y-1/2 px-[var(--gutter)]">
        <Slider
          min={DAY_START}
          max={DAY_END}
          step={5}
          value={[Math.round(yard.minute / 5) * 5]}
          onValueChange={([value]) => yard.setMinute(value)}
          label="Time of day"
          valueText={clockLabel(yard.minute)}
        />
        </div>
        <div className="shell flex flex-wrap items-center justify-between gap-x-8 gap-y-3 pb-3.5 pt-5">
          <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
            <div>
              <Button ref={finder} variant="ghost" className="-ml-2 -mt-2 mb-0.5 h-11 gap-1.5 px-2 text-[0.875rem] font-medium text-soft hover:text-oak" onClick={onFind} aria-label={`${trouble || `${yard.campus.name}, ${dayLabel(yard.weather.date)}`}. Find another school`}>
                <MagnifyingGlassIcon aria-hidden="true" weight="bold" />
                {trouble || `${yard.campus.name}, ${dayLabel(yard.weather.date)}`}
              </Button>
              <p className="data text-[1.875rem] font-semibold leading-none tracking-tight">{clockLabel(yard.minute)}</p>
            </div>
            <dl className="m-0 flex flex-wrap gap-x-7 gap-y-2">
              <div>
                <dt className="text-[0.8125rem] text-soft">Air</dt>
                <dd className="data m-0 text-[1.125rem] font-semibold leading-tight">{Math.round(yard.air())}°F</dd>
              </div>
              <div>
                <dt className="text-[0.8125rem] text-soft">Too hot to touch</dt>
                <dd className="data m-0 text-[1.125rem] font-semibold leading-tight">
                  <span className={hot >= 30 ? 'text-heat-deep' : undefined}>{hotText}%</span>
                  {planned && hotText !== wasText ? <span className="ml-2 font-normal text-soft">was {wasText}%</span> : null}
                </dd>
              </div>
              {error !== null && (
                <div>
                  <dt className="text-[0.8125rem] text-soft">Model error</dt>
                  <dd className="data m-0 text-[1.125rem] font-semibold leading-tight">{Math.round(error)}°F</dd>
                </div>
              )}
              {planned && (
                <div>
                  <dt className="text-[0.8125rem] text-soft">Cooled ground</dt>
                  <dd className="data m-0 text-[1.125rem] font-semibold leading-tight text-leaf">{cooled.toLocaleString('en-US')} sq ft</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="lg"
              spacing={0}
              value={yard.tool === 'look' ? '' : yard.tool}
              onValueChange={(value) => yard.setTool((value || 'look') as Tool)}
              aria-label="Tool"
            >
              <ToggleGroupItem value="tree" className="h-11 gap-2 px-4 text-base">
                <TreeIcon aria-hidden="true" />
                Tree
              </ToggleGroupItem>
              <ToggleGroupItem value="sail" className="h-11 gap-2 px-4 text-base">
                <UmbrellaIcon aria-hidden="true" />
                Sail
              </ToggleGroupItem>
              <ToggleGroupItem value="measure" className="h-11 gap-2 px-4 text-base">
                <ThermometerIcon aria-hidden="true" />
                Measure
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="lg" className="h-11 rounded-full px-5 text-base" disabled={yard.planting > 0} onClick={() => yard.startAuto(10)}>
              <PlantIcon aria-hidden="true" weight="fill" />
              Plant 10 trees
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function readFound(text: string | null): Found | null {
  if (!text) return null;
  try {
    const found = JSON.parse(text) as Found;
    return typeof found.id === 'number' && typeof found.name === 'string' && Number.isFinite(found.lat) && Number.isFinite(found.lon) ? found : null;
  } catch {
    return null;
  }
}

function sayStage(stage: Stage, name: string): string {
  return stage === 'weather' ? 'Loading its hottest day of the year' : `Loading the map of ${name}`;
}

export default function YardStage({ base }: { base: string }) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [day, setDay] = useState<Day>('hottest');
  const [asking, setAsking] = useState<((take: boolean) => void) | null>(null);
  const [pending, setPending] = useState<Day | null>(null);
  const [trouble, setTrouble] = useState('');
  const quiet = useRef(0);
  const bundle = useRef<Bundle | null>(null);
  const fallback = useRef<Promise<Bundle> | null>(null);
  const showing = useRef(false);
  const finder = useRef<HTMLButtonElement>(null);
  const home = useRef('Heritage High School');

  const first = useRef(true);
  const aim = useRef<number | null>(null);
  const refocus = useRef(false);
  const turns = useRef(0);

  const show = async (next: Bundle, override?: Weather, minute?: number, raising?: number, saved?: Saved, tool?: Tool): Promise<void> => {
    turns.current += 1;
    const turn = turns.current;
    bundle.current = next;
    const weather = override ?? next.weather;
    const key = keyOf(next.campus, weather);
    const same = kept !== null && kept.key === key && kept.bundle.campus === next.campus && kept.weather === weather ? kept : null;
    let built: Yard;
    let previous: Yard | null = null;
    if (same) {
      built = same.yard;
    } else {
      built = await Yard.open(next.campus, weather);
      if (saved) built.load(saved);
      else restorePlan(built);
      await built.settled();
      if (turn !== turns.current) {
        built.close();
        return;
      }
      previous = kept ? kept.yard : null;
      kept = { key, bundle: next, weather, yard: built };
    }
    if (canDraw()) {
      const { loadLibrary } = await import('./library');
      await loadLibrary(base, next.campus.trees.some((tree) => tree.needle === true));
    }
    if (turn !== turns.current) return;
    if (previous && previous.campus.center.lat === built.campus.center.lat && previous.campus.center.lon === built.campus.center.lon) built.cursor = previous.cursor;
    built.gone = next.was?.trees ?? [];
    built.cutter = cutAt;
    if (tool) built.setTool(tool);
    if (raising !== undefined) built.pickBlock(raising);
    if (minute !== undefined) built.setMinute(minute);
    else if (override?.live) built.setMinute(minuteNow(override));
    if (import.meta.env.DEV) (window as unknown as { yard: Yard }).yard = built;
    showing.current = true;
    setYard(built);
    if (previous && previous !== built) previous.close();
  };

  const showFallback = () => {
    if (showing.current || !fallback.current) return;
    fallback.current
      .then((file) => {
        if (showing.current) return;
        setDay(dayOf(file));
        return show(file);
      })
      .catch(() => setFailed(true));
  };

  const refresh = (found: Found, campus: Campus) => {
    const current = bundle.current;
    const shown = kept ? kept.yard : null;
    if (!current || !shown || !current.school || current.school.kind !== found.kind || current.school.id !== found.id) return;
    const next = carry(current, campus);
    const minute = aim.current ?? shown.minute;
    aim.current = null;
    keepSchool(next);
    void show(next, shown.weather !== next.weather ? shown.weather : undefined, minute, undefined, shown.saved(), shown.tool);
  };

  const renew = async (found: Found, campus: Campus, shown: Promise<void>) => {
    const asked = placeBundle(found);
    asked.catch(() => undefined);
    try {
      await shown;
      const arrival = await asked;
      if (newer(arrival.pristine, campus)) refresh(found, arrival.pristine);
      const late = await arrival.late;
      if (late) refresh(found, late);
    } catch {
      return;
    }
  };

  const pick = async (found: Found | null) => {
    stopPhotos(found ? placeKey(found) : undefined);
    setNote('');
    setRetry(null);
    try {
      let next: Bundle;
      let late: Promise<Campus | null> | null = null;
      if (found === null) {
        keepSchool(null);
        setStatus('Loading the campus');
        next = await loadBundle(base);
      } else {
        setStatus(sayStage('map', found.name));
        const arrival = await placeBundle(found, (stage) => setStatus(sayStage(stage, found.name)));
        next = arrival.bundle;
        late = arrival.late;
        keepSchool(next);
      }
      setStatus('Heating the ground');
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      setDay(dayOf(next));
      first.current = true;
      await show(next);
      setPicking(false);
      if (late && found) void late.then((campus) => campus && refresh(found, campus));
    } catch (error) {
      if (error instanceof Unmapped) {
        setNote('That school has no mapped buildings yet');
      } else {
        setNote(error instanceof NoWeather ? 'The weather did not load' : 'The map did not load');
        setRetry(() => () => void pick(found));
      }
      showFallback();
    } finally {
      setStatus('');
    }
  };

  const choose = () => new Promise<boolean>((resolve) => setAsking(() => resolve));

  const openShared = async (text: string) => {
    const plan = await decodePlan(text);
    if (!plan) {
      dropHash();
      return;
    }
    stopPhotos(plan.school ? placeKey(plan.school) : undefined);
    setNote('');
    setRetry(null);
    if (plan.school) setPicking(true);
    try {
      const next = await sharedBundle(plan, base, setStatus);
      if (!next) {
        dropHash();
        setStatus('');
        setNote('That school has no mapped buildings yet');
        return;
      }
      if (clashes(next, plan)) {
        setStatus('');
        setPicking(false);
        const take = await choose();
        if (!take) {
          dropHash();
          return;
        }
        if (plan.school) setPicking(true);
      }
      const saved = adopt(next, plan);
      dropHash();
      setStatus('Heating the ground');
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      setDay(dayOf(next));
      first.current = true;
      await show(next, undefined, undefined, undefined, saved);
      setPicking(false);
    } catch (error) {
      setPicking(true);
      setNote(error instanceof NoWeather ? 'The weather did not load' : 'The map did not load');
      setRetry(() => () => void openShared(text));
    } finally {
      setStatus('');
    }
  };

  useEffect(() => {
    let live = true;
    warmUp();
    const shared = sharedText();
    const found = shared === null ? readFound(new URLSearchParams(window.location.search).get('school')) : null;
    if (shared === null && new URLSearchParams(window.location.search).has('school')) window.history.replaceState(window.history.state, '', window.location.pathname);
    const ready = kept && kept.weather === kept.bundle.weather ? Promise.resolve(kept.bundle) : loadBundle(base);
    if (canDraw()) void import('./library').then(({ loadLibrary }) => loadLibrary(base));
    fallback.current = ready;
    if (found) {
      setPicking(true);
      void import('./YardCanvas');
      void pick(found);
    }
    ready
      .then((file) => {
        if (!live) return;
        if (shared !== null) {
          setDay(dayOf(file));
          void show(file);
          void openShared(shared);
          return;
        }
        if (found) return;
        setDay(dayOf(file));
        const shown = show(file);
        if (file.school && behind(file.campus)) void renew(file.school, file.campus, shown);
      })
      .catch(() => live && !found && setFailed(true));
    const unwatch = watchHash();
    return () => {
      live = false;
      unwatch();
      stopPhotos();
    };
  }, [base]);

  useEffect(() => {
    if (!yard) return;
    let seen = yard.heat;
    return yard.subscribe(() => {
      if (yard.busy || yard.planting > 0 || seen === yard.heat) return;
      seen = yard.heat;
      keepPlan(yard);
    });
  }, [yard]);

  const keepFixes = (next: Bundle) => {
    keepSchool(next);
    if (next.school) void rememberFixes(next.school, fixesOf(next));
  };

  const edit = (patch: number, surface: Surface) => {
    const current = bundle.current;
    if (!current || !yard) return;
    const next = editSurface(current, patch, surface);
    keepFixes(next);
    void show(next, yard.weather.live ? yard.weather : undefined, yard.minute);
  };

  const cutAt = (x: number, y: number): Cut | null => {
    const current = bundle.current;
    const shown = kept?.yard;
    if (!current || !shown) return null;
    const next = cutTree(current, x, y);
    if (!next) return null;
    keepFixes(next);
    void show(next, shown.weather.live ? shown.weather : undefined, shown.minute, undefined, undefined, shown.tool);
    return next.campus.trees.length < current.campus.trees.length ? 'removed' : 'restored';
  };

  const raise = (block: number, height: number) => {
    const current = bundle.current;
    if (!current || !yard) return;
    const next = editHeight(current, block, height);
    keepFixes(next);
    void show(next, yard.weather.live ? yard.weather : undefined, yard.minute, block);
  };

  useEffect(() => () => window.clearTimeout(quiet.current), []);

  const warn = () => {
    setTrouble('The weather did not load');
    window.clearTimeout(quiet.current);
    quiet.current = window.setTimeout(() => setTrouble(''), 4000);
  };

  const fetchFor = async <T,>(wanted: Day, load: () => Promise<T>): Promise<T | null> => {
    setPending(wanted);
    try {
      return await load();
    } catch {
      warn();
      return null;
    } finally {
      setPending((now) => (now === wanted ? null : now));
    }
  };

  const change = async (wanted: Day, date?: string) => {
    const current = bundle.current;
    if (!current) return;
    const hottest = current.hottest ?? current.weather;
    const plain: Bundle = current.hottest ? { ...current, weather: hottest, hottest: undefined } : current;
    const settle = () => {
      if (plain !== current) keepSchool(plain);
    };
    const unknown = picked(current);
    const target = wanted === 'pick' && !unknown && date === hottest.date ? 'hottest' : wanted;
    if (target === 'hottest') {
      if (day === 'hottest') return;
      if (unknown && current.school) {
        const school = current.school;
        const own = await fetchFor('hottest', () => ownHottest(school));
        if (!own || bundle.current !== current) return;
        const next: Shown = { ...current, weather: own, hottest: undefined, picked: false };
        keepSchool(next);
        refocus.current = true;
        setDay('hottest');
        void show(next);
        return;
      }
      settle();
      refocus.current = true;
      setDay('hottest');
      void show(plain);
      return;
    }
    const { lat, lon } = current.campus.center;
    if (target === 'today') {
      if (day === 'today') return;
      const live = await fetchFor('today', () => todayWeather(lat, lon));
      if (!live || bundle.current !== current) return;
      settle();
      refocus.current = true;
      setDay('today');
      void show(plain, live);
      return;
    }
    if (!date || (day === 'pick' && date === current.weather.date)) return;
    const weather = await fetchFor('pick', () => dayWeather(lat, lon, date, localDay()));
    if (!weather || bundle.current !== current) return;
    const next: Bundle = unknown ? { ...current, weather } : { ...current, weather, hottest };
    keepSchool(next);
    refocus.current = true;
    setDay('pick');
    void show(next);
  };

  if (failed) return <p className="shell absolute inset-x-0 top-1/2 text-center text-lg">The campus did not load. Reload the page.</p>;
  const picker = (
    <SchoolPicker
      open={picking}
      onOpenChange={(open) => status === '' && setPicking(open)}
      onPick={pick}
      home={home.current}
      status={status}
      note={note}
      onRetry={retry ?? undefined}
      returnTo={finder}
    />
  );
  if (!yard) {
    return (
      <>
        <Skeleton className="absolute inset-0 rounded-none bg-muted" />
        {picker}
      </>
    );
  }
  return (
    <>
      <Loaded key={`${yard.campus.name} ${yard.campus.center.lat} ${yard.weather.date}`} yard={yard} onFind={() => setPicking(true)} day={day} onDay={change} onEdit={edit} onRaise={raise} finder={finder} first={first} aim={aim} refocus={refocus} waiting={pending} trouble={trouble} />
      {picker}
      <OpenShared
        open={asking !== null}
        onChoose={(take) => {
          asking?.(take);
          setAsking(null);
        }}
      />
    </>
  );
}
