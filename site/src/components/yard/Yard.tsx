import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowsOutIcon } from '@phosphor-icons/react/dist/csr/ArrowsOut';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlantIcon } from '@phosphor-icons/react/dist/csr/Plant';
import { ThermometerIcon } from '@phosphor-icons/react/dist/csr/Thermometer';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { TreeIcon } from '@phosphor-icons/react/dist/csr/Tree';
import { UmbrellaIcon } from '@phosphor-icons/react/dist/csr/Umbrella';
import { Canvas } from '@react-three/fiber';
import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SURFACES, surfaceChoices, type Campus, type Surface } from '@/engine/campus';
import { centerOf } from '@/engine/geometry';
import { DAY_END, DAY_START, RAMP, TOUCH_LIMIT } from '@/engine/heat';
import { loadCampus, type Found } from '@/engine/osm';
import { clockLabel } from '@/engine/sun';
import { hottestDay, minuteNow, todayWeather, type Weather } from '@/engine/weather';
import { SQUARE_FEET, YEARS, Yard, type Tool } from './controller';
import { PerformanceMonitor } from '@react-three/drei';
import { TIERS, quality } from './quality';
import { Scene, probeHeight, sunReach } from './Scene';
import { SchoolPicker } from './SchoolPicker';
import { keepPlan, keepSchool, loadBundle, restorePlan, type Bundle } from './store';

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

type Day = 'hottest' | 'today';

type LoadedProps = {
  yard: Yard;
  onFind: () => void;
  day: Day;
  onDay: (day: Day) => void;
  onEdit: (patch: number, surface: Surface) => void;
  onRaise: (block: number, height: number) => void;
  finder: RefObject<HTMLButtonElement | null>;
  first: RefObject<boolean>;
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

function Loaded({ yard, onFind, day, onDay, onEdit, onRaise, finder, first }: LoadedProps) {
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState('');
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  useSyncExternalStore(yard.subscribe, yard.snapshot, yard.snapshot);
  const still = useReducedMotion();

  useEffect(() => {
    if (still || !first.current) return;
    first.current = false;
    const target = yard.minute;
    yard.setMinute(yard.sunrise);
    const sweep = animate(yard.sunrise, target, {
      duration: 3.4,
      delay: 0.35,
      ease: [0.3, 0.05, 0.2, 1],
      onUpdate: (value) => yard.setMinute(value),
    });
    const stop = () => sweep.stop();
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      sweep.stop();
      window.removeEventListener('pointerdown', stop);
    };
  }, [yard, still]);

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
  const was = Math.round(before.hot * 100);
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
      const words = { planted: 'Tree planted', sail: 'Sail placed', asked: 'Type the reading', picked: 'Selected', none: 'Nothing placed here' };
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
        className="relative min-h-0 focus-visible:[outline-offset:-4px]"
        tabIndex={0}
        role="application"
        aria-label={`3D model of ${yard.campus.name} coloured by ground temperature. Arrow keys move a pointer north, south, east and west. Enter uses the selected tool at the pointer. Delete removes the nearest tree or sail.`}
        onKeyDown={steer}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>
        <Canvas
          shadows
          flat
          frameloop="demand"
          dpr={[1, TIERS[tier].dpr]}
          camera={{ fov: 30, near: 5, far: 9000, position: [-300, 420, 600] }}
          style={{ position: 'absolute', inset: 0, cursor: yard.tool === 'look' ? undefined : 'crosshair' }}
          aria-hidden="true"
        >
          <PerformanceMonitor onDecline={() => quality.lower()} />
          <Scene yard={yard} layer={layer} shadow={TIERS[tier].shadow} texture={TIERS[tier].texture} />
        </Canvas>

        <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden">
          {hours.map((hour) => (
            <span key={hour.minute} data-at={hour.at} className="absolute left-0 top-0" aria-hidden="true">
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="lg"
          spacing={0}
          value={day}
          onValueChange={(value) => value && onDay(value as Day)}
          aria-label="Day to model"
          className="absolute right-[var(--gutter)] top-[4.5rem] bg-raised"
        >
          <ToggleGroupItem value="hottest" className="h-11 px-3.5 text-[0.9375rem]">
            Hottest day
          </ToggleGroupItem>
          <ToggleGroupItem value="today" className="h-11 px-3.5 text-[0.9375rem]">
            Today
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="absolute bottom-6 left-[var(--gutter)] flex items-center gap-2.5">
          {yard.focus !== null && (
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
              <Button ref={finder} variant="ghost" className="-ml-2 -mt-2 mb-0.5 h-11 gap-1.5 px-2 text-[0.875rem] font-medium text-soft hover:text-oak" onClick={onFind} aria-label={`${yard.campus.name}, ${dayLabel(yard.weather.date)}. Find another school`}>
                <MagnifyingGlassIcon aria-hidden="true" weight="bold" />
                {yard.campus.name}, {dayLabel(yard.weather.date)}
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
                  <span className={hot >= 30 ? 'text-heat-deep' : undefined}>{hot}%</span>
                  {planned && was !== hot ? <span className="ml-2 font-normal text-soft">was {was}%</span> : null}
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

export default function YardStage({ base }: { base: string }) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState<Day>('hottest');
  const bundle = useRef<Bundle | null>(null);
  const finder = useRef<HTMLButtonElement>(null);
  const home = useRef('Heritage High School');

  const first = useRef(true);

  const show = (next: Bundle, live?: Weather, minute?: number, raising?: number) => {
    bundle.current = next;
    const weather = live ?? next.weather;
    const key = keyOf(next.campus, weather);
    const same = kept !== null && kept.key === key && kept.bundle.campus === next.campus && kept.weather === weather ? kept : null;
    const built = same ? same.yard : new Yard(next.campus, weather);
    if (!same) {
      restorePlan(built);
      kept = { key, bundle: next, weather, yard: built };
    }
    if (raising !== undefined) built.pickBlock(raising);
    if (minute !== undefined) built.setMinute(minute);
    else if (live) built.setMinute(minuteNow(live));
    if (import.meta.env.DEV) (window as unknown as { yard: Yard }).yard = built;
    setYard(built);
  };

  useEffect(() => {
    let live = true;
    const asked = new URLSearchParams(window.location.search).get('school');
    const ready = kept && kept.weather === kept.bundle.weather ? Promise.resolve(kept.bundle) : loadBundle(base);
    ready
      .then((file) => {
        if (!live) return;
        show(file);
        if (!asked) return;
        window.history.replaceState(null, '', window.location.pathname);
        try {
          const found = JSON.parse(asked) as Found;
          if (typeof found.id === 'number' && typeof found.name === 'string') {
            setPicking(true);
            void pick(found);
          }
        } catch {
          setPicking(false);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [base]);

  useEffect(() => {
    if (!yard) return;
    let seen = -1;
    return yard.subscribe(() => {
      if (yard.busy || yard.planting > 0 || seen === yard.heat) return;
      seen = yard.heat;
      keepPlan(yard);
    });
  }, [yard]);

  const pick = async (found: Found | null) => {
    setNote('');
    try {
      let next: Bundle;
      if (found === null) {
        keepSchool(null);
        setStatus('Loading the campus');
        next = await loadBundle(base);
      } else {
        setStatus(`Loading the map of ${found.name}`);
        const campus = await loadCampus(found);
        if (campus.blocks.filter((block) => block.home).length + campus.patches.length === 0) {
          setStatus('');
          setNote('That school has no mapped buildings yet');
          return;
        }
        setStatus('Loading its hottest day of the year');
        const weather = await hottestDay(campus.center.lat, campus.center.lon);
        next = { campus, weather };
        keepSchool(next);
      }
      setStatus('Heating the ground');
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      setDay('hottest');
      first.current = true;
      show(next);
      setPicking(false);
    } catch {
      setNote('The map did not load. Try again.');
    } finally {
      setStatus('');
    }
  };

  const edit = (patch: number, surface: Surface) => {
    const current = bundle.current;
    if (!current || !yard) return;
    const patches = current.campus.patches.map((item, index) => (index === patch ? { ...item, surface } : item));
    const next = { campus: { ...current.campus, patches }, weather: current.weather };
    keepSchool(next);
    show(next, yard.weather.live ? yard.weather : undefined, yard.minute);
  };

  const raise = (block: number, height: number) => {
    const current = bundle.current;
    if (!current || !yard) return;
    const blocks = current.campus.blocks.map((item, index) => (index === block ? { ...item, height, guessed: false } : item));
    const next = { campus: { ...current.campus, blocks }, weather: current.weather };
    keepSchool(next);
    show(next, yard.weather.live ? yard.weather : undefined, yard.minute, block);
  };

  const change = async (wanted: Day) => {
    const current = bundle.current;
    if (!current || wanted === day) return;
    if (wanted === 'hottest') {
      setDay('hottest');
      show(current);
      return;
    }
    try {
      const live = await todayWeather(current.campus.center.lat, current.campus.center.lon);
      setDay('today');
      show(current, live);
    } catch {
      setDay('hottest');
    }
  };

  if (failed) return <p className="shell absolute inset-x-0 top-1/2 text-center text-lg">The campus did not load. Reload the page.</p>;
  if (!yard) return <Skeleton className="absolute inset-0 rounded-none bg-muted" />;
  return (
    <>
      <Loaded key={`${yard.campus.name} ${yard.campus.center.lat} ${yard.weather.date}`} yard={yard} onFind={() => setPicking(true)} day={day} onDay={change} onEdit={edit} onRaise={raise} finder={finder} first={first} />
      <SchoolPicker open={picking} onOpenChange={(open) => status === '' && setPicking(open)} onPick={pick} home={home.current} status={status} note={note} returnTo={finder} />
    </>
  );
}
