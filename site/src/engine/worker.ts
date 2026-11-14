import { campusMiddle, type Ground } from './campus';
import { contactOf } from './contact';
import { openCampus, prepareCampus, simulate, type Backdrop } from './heat';
import type { Answer, Ask } from './remote';
import { roofOf } from './roof';
import { groundValues } from './surface';
import type { Weather } from './weather';

type Session = { ground: Ground; weather: Weather; backdrop: Backdrop };

const KEEP = 4;
const sessions = new Map<number, Session>();
const looking = new Map<number, AbortController>();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Ask>) => void) | null;
  postMessage: (message: Answer, transfer?: Transferable[]) => void;
};

function keep(key: number, session: Session): void {
  sessions.delete(key);
  sessions.set(key, session);
  while (sessions.size > KEEP) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function sight(ask: Extract<Ask, { kind: 'sight' }>): void {
  const control = new AbortController();
  looking.set(ask.id, control);
  import('./look')
    .then(({ look }) => look(ask.campus, control.signal))
    .catch(() => null)
    .then((found) => {
      looking.delete(ask.id);
      scope.postMessage({ id: ask.id, kind: 'sight', sight: control.signal.aborted ? null : found });
    });
}

function roofs(ask: Extract<Ask, { kind: 'roofs' }>): void {
  const control = new AbortController();
  looking.set(ask.id, control);
  import('./roofpass')
    .then(({ readRoofs }) => readRoofs(ask.campus, control.signal))
    .catch(() => null)
    .then((found) => {
      looking.delete(ask.id);
      scope.postMessage({ id: ask.id, kind: 'roofs', roofs: control.signal.aborted ? null : found });
    });
}

function answer(ask: Ask): void {
  if (ask.kind === 'sight') {
    sight(ask);
    return;
  }
  if (ask.kind === 'roofs') {
    roofs(ask);
    return;
  }
  if (ask.kind === 'cancel') {
    looking.get(ask.target)?.abort();
    return;
  }
  if (ask.kind === 'close') {
    sessions.delete(ask.key);
    scope.postMessage({ id: ask.id, kind: 'ready' });
    return;
  }
  if (ask.kind === 'open' && !ask.reply) {
    const prepared = prepareCampus(ask.campus, ask.weather);
    keep(ask.key, { ground: prepared.ground, weather: ask.weather, backdrop: prepared.backdrop });
    scope.postMessage({ id: ask.id, kind: 'ready' });
    return;
  }
  if (ask.kind === 'open') {
    const opened = openCampus(ask.campus, ask.weather);
    keep(ask.key, { ground: opened.ground, weather: ask.weather, backdrop: opened.backdrop });
    const { ground, backdrop, bare } = opened;
    const surface = ground.surface.slice();
    const home = ground.home.slice();
    const open = ground.open.slice();
    const light = backdrop.light.slice();
    const contact = contactOf(ask.campus, ground.grid);
    const roof = roofOf(ask.campus);
    const paving = groundValues(ask.campus, ground.grid, campusMiddle(ask.campus));
    scope.postMessage(
      { id: ask.id, kind: 'opened', grid: ground.grid, surface, home, open, light, rays: backdrop.rays, temps: bare.temps, air: bare.air, peak: opened.peak, contact, roof, paving },
      [surface.buffer, home.buffer, open.buffer, light.buffer, bare.temps.buffer, bare.air.buffer, contact.data.buffer, paving.buffer],
    );
    return;
  }
  const session = sessions.get(ask.key);
  if (!session) {
    scope.postMessage({ id: ask.id, kind: 'gone' });
    return;
  }
  keep(ask.key, session);
  const day = simulate(session.ground, session.weather, session.backdrop, ask.added);
  const light = day.light === session.backdrop.light ? day.light.slice() : day.light;
  scope.postMessage({ id: ask.id, kind: 'day', temps: day.temps, light, air: day.air }, [day.temps.buffer, light.buffer, day.air.buffer]);
}

scope.onmessage = (event) => {
  try {
    answer(event.data);
  } catch (error) {
    scope.postMessage({ id: event.data.id, kind: 'failed', reason: String(error) });
  }
};
