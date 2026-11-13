export type Source<T> = (signal: AbortSignal) => Promise<T>;

export class Stopped extends Error {}

export function linked(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (!parent) return () => undefined;
  const stop = () => controller.abort(parent.reason);
  if (parent.aborted) stop();
  else parent.addEventListener('abort', stop, { once: true });
  return () => parent.removeEventListener('abort', stop);
}

export function pause(time: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Stopped('stopped'));
      return;
    }
    const done = () => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, time));
    const stop = () => {
      clearTimeout(timer);
      reject(new Stopped('stopped'));
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

export function firstOf<T>(sources: Source<T>[], gap: number, deadline: number, outer?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const reasons: string[] = [];
    let started = 0;
    let failed = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(limit);
      outer?.removeEventListener('abort', cancel);
      for (const controller of controllers) controller.abort(new Stopped('stopped'));
      settle();
    };
    const cancel = () => finish(() => reject(new Stopped('stopped')));
    const next = () => {
      if (done || started >= sources.length) return;
      clearTimeout(timer);
      const controller = new AbortController();
      controllers.push(controller);
      const run = sources[started];
      started += 1;
      let attempt: Promise<T>;
      try {
        attempt = run(controller.signal);
      } catch (error) {
        attempt = Promise.reject(error);
      }
      attempt.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => {
          if (done) return;
          failed += 1;
          reasons.push(error instanceof Error ? error.message : String(error));
          if (failed >= sources.length) finish(() => reject(new Error(reasons.join('; '))));
          else if (failed >= started) next();
        },
      );
      if (started < sources.length) timer = setTimeout(next, gap);
    };
    if (outer?.aborted) {
      reject(new Stopped('stopped'));
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      reject(new Error('timed out'));
      return;
    }
    limit = setTimeout(() => finish(() => reject(new Error(`timed out${reasons.length > 0 ? ` after ${reasons.join('; ')}` : ''}`))), left);
    outer?.addEventListener('abort', cancel, { once: true });
    next();
  });
}
