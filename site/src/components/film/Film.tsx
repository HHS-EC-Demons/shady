import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { HeatDay } from '@/engine/heat';
import { warmUp } from '@/engine/remote';
import type { Story } from '@/engine/story';
import { canDraw } from '@/lib/utils';
import { Yard } from '../yard/controller';
import type { Bundle } from '../yard/store';
import { film, measure } from './state';

const FilmScene = lazy(() => import('./FilmScene'));

export type Days = { sail: HeatDay | null; full: HeatDay | null };
type Ready = { yard: Yard; days: Days };

const loads = new Map<string, Promise<Ready>>();
const done = new Map<string, Ready>();
const progress: { share: number; listen: ((share: number) => void) | null } = { share: 0, listen: null };

function report(share: number): void {
  progress.share = share;
  progress.listen?.(share);
}

function prepare(base: string, story: Story): Promise<Ready> {
  const known = loads.get(base);
  if (known) return known;
  const run = (async () => {
    report(0.12);
    warmUp(2);
    const scene = import('./FilmScene');
    const models = import('../yard/library').then(({ loadLibrary }) => loadLibrary(base));
    const answer = await fetch(`${base}campus/heritage.json`);
    if (!answer.ok) throw new Error('campus');
    const bundle = (await answer.json()) as Bundle;
    report(0.35);
    const yard = await Yard.open(bundle.campus, bundle.weather, 1);
    report(0.6);
    const days: Days = { sail: null, full: null };
    const sail = yard.simulate({ blocks: [], trees: [], sails: [story.sail] }, 0).then((day) => {
      days.sail = day;
      film.wake();
    });
    const full = yard.simulate({ blocks: [], trees: story.trees, sails: [story.sail] }, 1).then((day) => {
      days.full = day;
      film.wake();
    });
    void Promise.all([sail, full]).then(() => yard.close());
    report(0.74);
    await scene;
    if (bundle.campus.trees.some((tree) => tree.needle === true)) await import('../yard/library').then(({ loadLibrary }) => loadLibrary(base, true));
    else await models;
    report(0.86);
    const ready: Ready = { yard, days };
    done.set(base, ready);
    return ready;
  })();
  loads.set(base, run);
  run.catch(() => loads.delete(base));
  return run;
}

function unseen(): boolean {
  try {
    const frame = window.frameElement;
    return frame !== null && window.parent.getComputedStyle(frame).display === 'none';
  } catch {
    return false;
  }
}

export default function Film({ base, story }: { base: string; story: Story }) {
  const [ready, setReady] = useState<Ready | null>(null);
  const [loaded, setLoaded] = useState(0);
  const root = useRef<HTMLElement | null>(null);
  const debug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');

  useEffect(() => {
    const host = document.querySelector<HTMLElement>('.film');
    if (!host) return;
    root.current = host;
    if (unseen() || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !canDraw()) {
      host.dataset.mode = 'still';
      return;
    }
    let live = true;
    host.dataset.mode = 'loading';
    const onScroll = () => {
      film.target = measure(host);
      if (host.dataset.mode === 'loading') film.current = film.target;
      film.wake();
    };
    onScroll();
    film.current = film.target;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    const stop = () => {
      live = false;
      if (progress.listen === setLoaded) progress.listen = null;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    const hit = done.get(base);
    if (hit) {
      setReady(hit);
      return stop;
    }
    progress.listen = setLoaded;
    setLoaded(Math.max(0.12, progress.share));
    prepare(base, story)
      .then((value) => {
        if (!live) return;
        setLoaded(0.94);
        setReady(value);
      })
      .catch(() => {
        host.dataset.mode = 'still';
      });
    return stop;
  }, [base, story]);

  const shown = () => {
    setLoaded(1);
    if (root.current && root.current.dataset.mode === 'loading') root.current.dataset.mode = 'live';
  };

  return (
    <>
      {ready && (
        <Suspense fallback={null}>
          <FilmScene yard={ready.yard} days={ready.days} story={story} onFrame={shown} debug={debug} />
        </Suspense>
      )}
      {loaded > 0 && loaded < 1 && (
        <div className="film-load" role="progressbar" aria-label="Loading the 3D campus" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loaded * 100)}>
          <span style={{ transform: `scaleX(${loaded})` }} />
        </div>
      )}
      {debug && <div data-perf className="data absolute left-3 top-16 z-30 rounded-md bg-oak px-2.5 py-1.5 text-[0.8125rem] text-raised" />}
    </>
  );
}
