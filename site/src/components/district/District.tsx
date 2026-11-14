import { useReducedMotion } from 'motion/react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { FIRST_HOUR, LAST_HOUR, percentOf, placeLabel, schoolKey, shareAt, type Row } from '@/engine/district';
import { RAMP, TOUCH_LIMIT } from '@/engine/heat';
import type { Found } from '@/engine/osm';
import { clockLabel } from '@/engine/sun';
import { hourly } from '@/engine/weather';
import { canDraw } from '@/lib/utils';
import { quality } from '../yard/quality';
import type { Engine } from './remote';
import type { Run } from './run';
import { Search } from './Search';
import type { Tile } from './Table';

const Table = lazy(() => import('./Table'));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR = `rgb(${RAMP[6][1].join(' ')})`;
const START = FIRST_HOUR * 60;
const END = LAST_HOUR * 60;
const INSETS = { top: 84, bottom: 76 };
const SAMPLES: Found[] = [
  { kind: 'relation', id: 6579857, name: 'Frisco', place: 'Texas, United States', lat: 33.1505998, lon: -96.8238183, extent: { south: 33.0810976, west: -96.9227866, north: 33.219578, east: -96.7327675 } },
  { kind: 'relation', id: 110833, name: 'Tempe', place: 'Arizona, United States', lat: 33.4255117, lon: -111.940016, extent: { south: 33.31986, west: -111.9784718, north: 33.4639799, east: -111.8773587 } },
  { kind: 'relation', id: 2221794, name: 'Kelowna', place: 'British Columbia, Canada', lat: 49.8879177, lon: -119.495902, extent: { south: 49.772822, west: -119.5890596, north: 50.0254575, east: -119.3197826 } },
];
const quiet = () => () => undefined;
const zero = () => 0;

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day} ${year}`;
}

function readPlace(text: string | null): Found | null {
  if (!text) return null;
  try {
    const place = JSON.parse(text) as Found;
    if (typeof place.id !== 'number' || typeof place.name !== 'string' || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
    if (place.kind !== 'relation' && place.kind !== 'way' && place.kind !== 'node') return null;
    return place;
  } catch {
    return null;
  }
}

function placeLink(place: Found): string {
  return `?place=${encodeURIComponent(JSON.stringify(place))}`;
}

function yardLink(base: string, school: Found): string {
  return `${base}yard/?school=${encodeURIComponent(JSON.stringify(school))}`;
}

function Legend() {
  const marks = [90, TOUCH_LIMIT, 160];
  return (
    <div className="pointer-events-none absolute bottom-6 right-[var(--gutter)] flex flex-col gap-1 rounded-lg border border-rule bg-raised px-3 pb-1.5 pt-2.5" aria-hidden="true">
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

type ListProps = { rows: Row[]; base: string; stalled: boolean; minute: number; onOpen: (school: Found) => void; onActive: (key: string | null) => void };

function Schools({ rows, base, stalled, minute, onOpen, onActive }: ListProps) {
  if (rows.length === 0) return null;
  return (
    <ol className="m-0 list-none border-b border-rule p-0" aria-label="Schools, hottest first">
      {rows.map((row, index) => {
        const key = schoolKey(row.school);
        const percent = row.summary ? percentOf(shareAt(row.summary, minute)) : 0;
        return (
          <li key={key} className="border-t border-rule" data-status={row.status} data-photo={row.summary?.photo ? 'yes' : undefined}>
            <a
              href={yardLink(base, row.school)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                onOpen(row.school);
              }}
              onFocus={() => onActive(key)}
              onBlur={() => onActive(null)}
              onPointerEnter={() => onActive(key)}
              onPointerLeave={() => onActive(null)}
              className="group grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-2 py-3 no-underline sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(8rem,16rem)_3.5rem]"
            >
              <span className="data text-soft" aria-hidden="true">
                {index + 1}
              </span>
              <span className="text-[1.0625rem] font-medium leading-snug underline-offset-4 group-hover:underline">{row.school.name}</span>
              {row.status === 'done' && row.summary && (
                <>
                  <span className="col-span-2 col-start-2 row-start-2 h-2 overflow-hidden rounded-full bg-[#d6dfe1] sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(1, percent)}%`, background: BAR }} />
                  </span>
                  <span className="data col-start-3 row-start-1 text-right text-[1.0625rem] font-semibold sm:col-start-4">
                    {percent}%<span className="sr-only"> too hot to touch</span>
                  </span>
                </>
              )}
              {!stalled && (row.status === 'waiting' || row.status === 'loading') && (
                <>
                  <Skeleton className="col-span-2 col-start-2 row-start-2 h-2 rounded-full bg-[#d6dfe1] sm:col-span-1 sm:col-start-3 sm:row-start-1" />
                  <Skeleton className="col-start-3 row-start-1 ml-auto h-5 w-10 rounded bg-[#d6dfe1] sm:col-start-4" />
                </>
              )}
              {(row.status === 'failed' || row.status === 'unmapped') && (
                <span className="col-span-2 col-start-2 row-start-2 text-base text-soft sm:col-span-2 sm:col-start-3 sm:row-start-1 sm:text-right">
                  {row.status === 'failed' ? 'The map did not load' : 'No mapped buildings yet'}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function Tooltip({ refer, row, minute }: { refer: RefObject<HTMLDivElement | null>; row: Row | null; minute: number }) {
  return (
    <div ref={refer} className="pointer-events-none absolute left-0 top-0 z-30" style={{ visibility: 'hidden' }} aria-hidden="true">
      {row && (
        <div className="absolute -translate-x-1/2 -translate-y-full pb-2">
          <div className="rounded-md bg-oak px-2.5 py-1.5 text-center text-raised shadow-[0_6px_18px_rgba(18,38,28,0.28)]">
            {row.summary && <div className="data whitespace-nowrap text-[1.0625rem] font-semibold leading-tight">{percentOf(shareAt(row.summary, minute))}%</div>}
            <div className="whitespace-nowrap text-[0.8125rem] leading-tight text-[#c9d6d0]">{row.school.name}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusOf(run: Run | null): string {
  if (!run) return '';
  if (run.phase === 'opening') return '';
  if (run.phase === 'listing') return `Loading the map of ${run.place.name}`;
  if (run.phase === 'weather') return 'Loading its hottest day of the year';
  if (run.phase === 'empty') return 'No schools found';
  if (run.phase === 'failed') return run.failure === 'weather' ? 'The weather did not load' : 'The map did not load';
  return run.count();
}

export default function District({ base }: { base: string }) {
  const still = useReducedMotion();
  const [webgl] = useState(canDraw);
  const flat = Boolean(still) || !webgl;
  const engine = useRef<Engine | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  useSyncExternalStore(run?.subscribe ?? quiet, run?.snapshot ?? zero, zero);
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot, quality.server);
  const [minute, setMinute] = useState(15 * 60);
  const touched = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [refocus, setRefocus] = useState(false);
  const tooltip = useRef<HTMLDivElement>(null);
  const ready = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const snapped = useRef<Run | null>(null);

  const start = (place: Found) => {
    touched.current = false;
    void Promise.all([import('./run'), import('./remote'), import('./store')]).then(([{ Run }, { Engine }, { tidyKept }]) => {
      if (!mounted.current) return;
      if (!engine.current) engine.current = new Engine();
      const next = new Run(place, engine.current);
      setRun(next);
      if (!ready.current) ready.current = tidyKept();
      void ready.current.then(() => next.start());
    });
  };

  useEffect(() => {
    const place = readPlace(new URLSearchParams(window.location.search).get('place'));
    mounted.current = true;
    if (place) start(place);
    return () => {
      mounted.current = false;
      engine.current?.close();
      engine.current = null;
    };
  }, []);

  useEffect(() => () => run?.close(), [run]);

  const pick = (place: Found) => {
    const address = new URL(window.location.href);
    address.searchParams.set('place', JSON.stringify(place));
    window.history.replaceState(window.history.state, '', address.pathname + address.search);
    setRefocus(true);
    setDrawn(false);
    start(place);
  };

  const open = async (school: Found) => {
    const target = yardLink(base, school);
    try {
      await run?.handOver(school);
    } catch {
      window.location.assign(target);
      return;
    }
    import('astro:transitions/client')
      .then(({ navigate }) => navigate(target))
      .catch(() => window.location.assign(target));
  };

  const rows = run?.shown ?? [];
  const lead = rows.find((row) => row.summary)?.summary ?? null;
  useEffect(() => {
    if (touched.current || !lead || snapped.current === run) return;
    snapped.current = run;
    setMinute(Math.min(END, Math.max(START, Math.round(lead.peak / 60) * 60)));
  }, [lead, run]);

  const tiles = useMemo<Tile[]>(() => {
    if (!run) return [];
    const slots = new Map(run.rows.map((row, index) => [schoolKey(row.school), index]));
    const live = run.phase !== 'failed';
    return rows.map((row) => ({ key: schoolKey(row.school), slot: slots.get(schoolKey(row.school)) ?? 0, status: row.status, summary: row.summary, busy: live && (row.status === 'waiting' || row.status === 'loading') }));
  }, [run, run?.version]);

  const weather = run?.weather ?? null;
  const done = rows.filter((row) => row.summary);
  const area = done.reduce((sum, row) => sum + (row.summary?.area ?? 0), 0);
  const district = area > 0 ? done.reduce((sum, row) => sum + shareAt(row.summary as NonNullable<Row['summary']>, minute) * (row.summary?.area ?? 0), 0) / area : null;
  const hot = district === null ? null : percentOf(district);
  const status = statusOf(run);
  const failed = run?.phase === 'failed';
  const listed = Boolean(run && run.rows.length > 0);
  const stopped = failed || run?.phase === 'empty';
  const place = run?.place ?? null;
  const activeRow = active ? (rows.find((row) => schoolKey(row.school) === active) ?? null) : null;
  const byKey = (key: string) => rows.find((row) => schoolKey(row.school) === key)?.school;
  const retry = () => place && start(place);

  const statusLine = (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
      <p role="status" className="text-base font-medium">
        {status}
      </p>
      {failed && (
        <Button size="lg" className="h-11 shrink-0 rounded-full px-5 text-base" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );

  if (flat || !place) {
    return (
      <section className="shell mx-auto w-full max-w-[880px] pb-20 pt-12" data-phase={run?.phase ?? 'idle'}>
        <h1 className="max-w-[12ch] text-[length:clamp(2.5rem,5.4vw,4.25rem)]">{place ? placeLabel(place) : 'Shade your district.'}</h1>
        <Search key={place ? schoolKey(place) : 'none'} value={place?.name ?? ''} onPick={pick} autoFocus={refocus} className="mt-8 max-w-[26rem]" />
        {!place && (
          <ul className="m-0 mt-5 flex list-none flex-wrap gap-2.5 p-0">
            {SAMPLES.map((sample) => (
              <li key={sample.id}>
                <Button asChild variant="outline" size="lg" className="h-11 rounded-full px-4 text-base">
                  <a
                    href={placeLink(sample)}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                      event.preventDefault();
                      pick(sample);
                    }}
                  >
                    {sample.name}
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {place && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-4">
            {statusLine}
            {weather && <p className="text-base text-soft">{dayLabel(weather.date)}</p>}
          </div>
        )}
        <Schools rows={rows} base={base} stalled={failed} minute={minute} onOpen={open} onActive={() => undefined} />
      </section>
    );
  }

  return (
    <>
      <section className="relative h-[72dvh] min-h-[480px] overflow-hidden sm:h-[calc(100dvh-72px)] sm:min-h-[560px]" data-phase={run?.phase ?? 'idle'}>
        <h1 className="sr-only">{placeLabel(place)}</h1>
        <div className="absolute inset-0 grid grid-rows-[minmax(0,1fr)_auto]">
          <div className="relative min-h-0">
            {run && run.rows.length > 0 && (
              <Suspense fallback={null}>
                <Table
                  key={run.key}
                  tiles={tiles}
                  slots={run.rows.length}
                  minute={minute}
                  weather={weather}
                  center={place}
                  tier={tier}
                  active={active}
                  onHover={setActive}
                  onOpen={(key) => {
                    const school = byKey(key);
                    if (school) void open(school);
                  }}
                  label={tooltip}
                  insets={INSETS}
                  onReady={() => setDrawn(true)}
                />
              </Suspense>
            )}
            {!drawn && !stopped && <Skeleton className="absolute inset-0 rounded-none bg-muted" />}
            <Tooltip refer={tooltip} row={activeRow} minute={minute} />
            <Search key={schoolKey(place)} value={place.name} onPick={pick} autoFocus={refocus} className="absolute left-[var(--gutter)] right-[var(--gutter)] top-4 z-20 w-auto sm:right-auto sm:w-[22rem]" />
            {listed && <Legend />}
          </div>
          <div className="relative border-t border-rule bg-raised">
            <div className={listed ? 'absolute inset-x-0 top-0 -translate-y-1/2 px-[var(--gutter)]' : 'hidden'}>
              <Slider
                min={START}
                max={END}
                step={5}
                value={[minute]}
                onValueChange={([value]) => {
                  touched.current = true;
                  setMinute(value);
                }}
                label="Time of day"
                valueText={clockLabel(minute)}
              />
            </div>
            <div className="shell flex flex-wrap items-center justify-between gap-x-8 gap-y-3 pb-3.5 pt-5">
              <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
                <div>
                  <p className="mb-1.5 text-[0.875rem] font-medium text-soft">{weather ? `${place.name}, ${dayLabel(weather.date)}` : place.name}</p>
                  {listed && <p className="data text-[1.875rem] font-semibold leading-none tracking-tight">{clockLabel(minute)}</p>}
                </div>
                {weather && (
                  <dl className="m-0 flex flex-wrap gap-x-7 gap-y-2">
                    <div>
                      <dt className="text-[0.8125rem] text-soft">Air</dt>
                      <dd className="data m-0 text-[1.125rem] font-semibold leading-tight">{Math.round(hourly(weather.air, minute))}°F</dd>
                    </div>
                    {hot !== null && (
                      <div>
                        <dt className="text-[0.8125rem] text-soft">Too hot to touch</dt>
                        <dd className="data m-0 text-[1.125rem] font-semibold leading-tight">
                          <span className={hot >= 30 ? 'text-heat-deep' : undefined}>{hot}%</span>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
              {statusLine}
            </div>
          </div>
        </div>
      </section>
      <section className="shell w-full max-w-[1180px] pb-20 pt-8">
        <Schools rows={rows} base={base} stalled={failed} minute={minute} onOpen={open} onActive={setActive} />
      </section>
    </>
  );
}
