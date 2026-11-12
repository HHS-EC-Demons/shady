import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Campus } from './campus';
import { tellStory, type Story } from './story';
import type { Weather } from './weather';

const file = JSON.parse(readFileSync(new URL('../../public/campus/heritage.json', import.meta.url), 'utf8')) as { campus: Campus; weather: Weather };

function numbers(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value);
  else if (Array.isArray(value)) for (const item of value) numbers(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) numbers(item, found);
  return found;
}

describe('the landing story', () => {
  const started = performance.now();
  const story: Story = tellStory(file.campus, file.weather);
  const took = performance.now() - started;

  it('tells the story in under 8 seconds', () => {
    expect(took).toBeLessThan(8000);
  });

  it('plants 30 trees', () => {
    expect(story.trees).toHaveLength(30);
  });

  it('walks to a second place', () => {
    expect(story.place2).not.toBe(story.place);
  });

  it('zooms in on three different places', () => {
    expect(new Set([story.place, story.place2, story.place5]).size).toBe(3);
  });

  it('never zooms in on a track or a field', () => {
    for (const label of [story.place, story.place2, story.place5]) expect(label).not.toMatch(/track|field|pitch/i);
  });

  it('shortens the walk with the sail', () => {
    expect(story.walk2After).toBeLessThan(story.walk2Before);
  });

  it('cools the ground under the sail by at least 10 degrees', () => {
    expect(story.sailCooler).toBeGreaterThanOrEqual(10);
  });

  it('is much cooler early in the day', () => {
    expect(story.earlyTemp).toBeLessThan(story.lateTemp);
    expect(story.earlyTemp).toBeLessThan(story.lateTemp - 20);
  });

  it('puts the sail within 60 m of the second place', () => {
    const [a, , c] = story.sail.corners;
    const x = (a[0] + c[0]) / 2;
    const y = (a[1] + c[1]) / 2;
    expect(Math.hypot(x - story.anchor2[0], y - story.anchor2[1])).toBeLessThanOrEqual(60);
  });

  it('has only finite numbers', () => {
    const all = numbers(story);
    expect(all.length).toBeGreaterThan(0);
    for (const value of all) expect(Number.isFinite(value)).toBe(true);
  });

  it('remembers a story it has told', () => {
    expect(tellStory(file.campus, file.weather)).toBe(story);
  });
});
