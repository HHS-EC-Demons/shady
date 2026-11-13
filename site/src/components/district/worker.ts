import { gate, type Tally } from '../../engine/district';
import { NoBuildings, districtWeather, listSchools, modelSchool } from './pipeline';
import type { Answer, Ask } from './remote';

const counts: Tally = new Map();
const running = new Map<number, AbortController>();
const scope = self as unknown as {
  fetch: typeof fetch;
  location: { href: string };
  onmessage: ((event: MessageEvent<Ask>) => void) | null;
  postMessage: (message: Answer, transfer?: Transferable[]) => void;
};

scope.fetch = gate(scope.fetch.bind(scope), counts, scope.location.href);

async function work(ask: Exclude<Ask, { kind: 'cancel' } | { kind: 'stats' }>, signal: AbortSignal): Promise<void> {
  if (ask.kind === 'list') {
    const listing = await listSchools(ask.place, signal);
    scope.postMessage({ id: ask.id, kind: 'listed', listing });
    return;
  }
  if (ask.kind === 'weather') {
    const weather = await districtWeather(ask.place, signal);
    scope.postMessage({ id: ask.id, kind: 'weather', weather });
    return;
  }
  const result = await modelSchool(ask.school, ask.weather, ask.campus, ask.photo, signal);
  const transfer = result ? [result.summary.frames.buffer, result.summary.mask.buffer] : [];
  scope.postMessage({ id: ask.id, kind: 'modelled', result }, transfer as Transferable[]);
}

scope.onmessage = (event) => {
  const ask = event.data;
  if (ask.kind === 'cancel') {
    running.get(ask.target)?.abort();
    return;
  }
  if (ask.kind === 'stats') {
    scope.postMessage({ id: ask.id, kind: 'stats', hosts: [...counts.entries()] });
    return;
  }
  const control = new AbortController();
  running.set(ask.id, control);
  work(ask, control.signal)
    .catch((error: unknown) => {
      if (error instanceof NoBuildings) scope.postMessage({ id: ask.id, kind: 'unmapped' });
      else scope.postMessage({ id: ask.id, kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => running.delete(ask.id));
};
