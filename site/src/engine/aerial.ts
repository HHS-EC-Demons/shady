import type { Campus } from './campus';

export async function enrich(campus: Campus, _signal?: AbortSignal): Promise<Campus> {
  return campus;
}
