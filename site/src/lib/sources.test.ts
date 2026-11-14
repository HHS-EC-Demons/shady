import { describe, expect, it } from 'vitest';
import { countSources, hostOf, models, rest, rows, sources } from './sources';

describe('sources', () => {
  it('counts distinct websites', () => {
    expect(countSources(rows)).toBe(16);
    expect(countSources()).toBe(new Set(sources.filter((row) => row.url).map((row) => hostOf(row.url))).size);
  });

  it('counts each model website once and ignores estimates', () => {
    expect(countSources([...rows, ...models])).toBe(countSources(rows) + 2);
    expect(countSources(rest)).toBe(0);
  });

  it('keeps eighteen websites with the brick texture listed', () => {
    expect(models.some((row) => row.url === 'https://ambientcg.com/view?id=Bricks101')).toBe(true);
    expect(countSources()).toBe(18);
  });

  it('does not grow for another texture from a counted website', () => {
    const brick = { what: 'Brick on the walls', value: 'CC0', source: 'ambientCG', url: 'https://ambientcg.com/view?id=Bricks001' };
    expect(countSources([...sources, brick])).toBe(countSources());
  });

  it('treats www and bare hosts as one website', () => {
    expect(hostOf('https://www.epa.gov/a')).toBe(hostOf('https://epa.gov/b'));
  });
});
