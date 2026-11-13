import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LIMITS, decodePlan, encodePlan, linkFor, type Plan } from './share';

function plain(body: unknown): string {
  return `j${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
}

function bodyOf(text: string): Record<string, unknown> {
  const bytes = Buffer.from(text.slice(1), 'base64url');
  return JSON.parse((text[0] === 'z' ? inflateRawSync(bytes) : bytes).toString()) as Record<string, unknown>;
}

function packed(text: string): string {
  return `z${deflateRawSync(Buffer.from(text)).toString('base64url')}`;
}

function spot(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round((value - Math.floor(value) - 0.5) * 6000) / 10;
}

const full: Plan = {
  version: 1,
  school: { kind: 'way', id: 25386178, name: 'Roosevelt High School', lat: 47.6767449, lon: -122.3155711 },
  date: '2025-07-08',
  years: 20,
  trees: [
    [12.3, -45.6],
    [-210.4, 88],
    [0, 0.1],
  ],
  sails: [
    {
      corners: [
        [10, 20],
        [19, 20],
        [19, 29],
        [10, 29],
      ],
      height: 4.5,
    },
  ],
  surfaces: [
    { patch: 4, from: 'asphalt', to: 'concrete' },
    { patch: 9, from: 'turf', to: 'grass' },
  ],
  heights: [
    { building: 549415125, nth: 0, feet: 40 },
    { building: 12, nth: 1, feet: 18 },
  ],
};

const base = { v: 1, d: '2025-07-08', y: 20 };

describe('share links', () => {
  it('round trips a plan with trees, sails and corrections', async () => {
    const text = await encodePlan(full);
    expect(text).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(await decodePlan(text)).toEqual(full);
  });

  it('round trips the built in campus with no school', async () => {
    const plan: Plan = { ...full, school: null, surfaces: [], heights: [] };
    const text = await encodePlan(plan);
    expect(await decodePlan(text)).toEqual(plan);
  });

  it('keeps decimetre positions exact', async () => {
    const trees = Array.from({ length: 40 }, (_, index) => [spot(index), spot(index + 100)] as [number, number]);
    const plan: Plan = { ...full, trees };
    const back = await decodePlan(await encodePlan(plan));
    expect(back?.trees).toEqual(trees);
  });

  it('fits a 30 tree, 1 sail plan in under 700 characters', async () => {
    const trees = Array.from({ length: 30 }, (_, index) => [spot(index + 1), spot(index + 51)] as [number, number]);
    const text = await encodePlan({ ...full, trees });
    expect(text.length).toBeLessThan(700);
    expect(text[0]).toBe('z');
  });

  it('round trips removed trees in an optional key', async () => {
    const cut: [number, number][] = [
      [-23.4, 151.2],
      [88, -0.1],
    ];
    const plan: Plan = { ...full, cut };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    expect(bodyOf(await encodePlan(plan)).c).toEqual([-234, 1512, 880, -1]);
  });

  it('reads an older link with no removed trees', async () => {
    const plan = await decodePlan(plain({ ...base, t: [10, 20] }));
    expect(plan).not.toBeNull();
    expect(plan?.cut).toBeUndefined();
    expect(bodyOf(await encodePlan(full)).c).toBeUndefined();
  });

  it('returns null for a bad removed tree list', async () => {
    expect(await decodePlan(plain({ ...base, c: [1, 2, 3] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, c: [1.5, 2] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, c: '1,2' }))).toBeNull();
    expect(await decodePlan(plain({ ...base, c: Array.from({ length: (LIMITS.cut + 1) * 2 }, () => 5) }))).toBeNull();
  });

  it('builds the link under the plan page with the plan in the hash', () => {
    expect(linkFor('https://example.org', '/shady/', 'zABC')).toBe('https://example.org/shady/plan/#plan=zABC');
  });

  it('reads a plain payload and ignores unknown fields', async () => {
    const plan = await decodePlan(plain({ ...base, t: [10, 20], extra: { deep: [1, 2, 3] }, s: ['n', 7, 'Small School', 1.5, 2.5, 'more'] }));
    expect(plan?.trees).toEqual([[1, 2]]);
    expect(plan?.school).toEqual({ kind: 'node', id: 7, name: 'Small School', lat: 1.5, lon: 2.5 });
  });

  it('caps the school name at 120 characters', async () => {
    const plan = await decodePlan(plain({ ...base, s: ['w', 1, 'A'.repeat(500), 0, 0] }));
    expect(plan?.school?.name.length).toBe(LIMITS.name);
  });

  it('returns null for garbage', async () => {
    for (const text of ['', 'z', 'j', 'hello world', '%%%%', 'q' + 'A'.repeat(40), 'zAAAA', 'jAAAA', 'z!!!!', 'jnot json at all'.replace(/ /g, '')]) {
      expect(await decodePlan(text)).toBeNull();
    }
    for (const value of [null, undefined, 42, {}, ['z']]) expect(await decodePlan(value)).toBeNull();
  });

  it('returns null for a truncated link', async () => {
    const text = await encodePlan(full);
    for (const cut of [text.length - 1, text.length - 6, Math.floor(text.length / 2), 3]) {
      expect(await decodePlan(text.slice(0, cut))).toBeNull();
    }
    const flat = plain({ ...base, t: [1, 2, 3, 4] });
    expect(await decodePlan(flat.slice(0, flat.length - 5))).toBeNull();
  });

  it('returns null for the wrong version', async () => {
    expect(await decodePlan(plain({ ...base, v: 2 }))).toBeNull();
    expect(await decodePlan(plain({ ...base, v: '1' }))).toBeNull();
    expect(await decodePlan(plain({ d: base.d, y: 20 }))).toBeNull();
  });

  it('returns null for huge counts', async () => {
    const many = { ...base, t: Array.from({ length: 200000 }, (_, index) => index % 1000) };
    expect(await decodePlan(packed(JSON.stringify(many)))).toBeNull();
    expect(await decodePlan(plain({ ...base, t: Array.from({ length: (LIMITS.trees + 1) * 2 }, () => 5) }))).toBeNull();
    expect(await decodePlan(plain({ ...base, a: Array.from({ length: LIMITS.sails + 1 }, () => [0, 0, 10, 0, 10, 10, 0, 10, 45]) }))).toBeNull();
    expect(await decodePlan(plain({ ...base, f: Array.from({ length: 150 }, () => [1, 1, 2]), h: Array.from({ length: 51 }, () => [1, 0, 20]) }))).toBeNull();
    expect(await decodePlan(packed(' '.repeat(LIMITS.bytes + 10)))).toBeNull();
    expect(await decodePlan(`z${'A'.repeat(LIMITS.text + 4)}`)).toBeNull();
  });

  it('returns null for NaN, infinity and numbers out of range', async () => {
    expect(await decodePlan(plain({ ...base, t: ['NaN', 4] }))).toBeNull();
    expect(await decodePlan(packed(`{"v":1,"d":"2025-07-08","y":20,"t":[NaN,4]}`))).toBeNull();
    expect(await decodePlan(packed(`{"v":1,"d":"2025-07-08","y":20,"t":[1e999,4]}`))).toBeNull();
    expect(await decodePlan(plain({ ...base, t: [1.5, 4] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, t: [100001, 4] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: ['w', 1, 'School', 95, 0] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, a: [[0, 0, 10, 0, 10, 10, 0, 10, 0]] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, h: [[1, 0, 0]] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, h: [[-4, 0, 20]] }))).toBeNull();
  });

  it('returns null for wrong types and unknown kinds', async () => {
    expect(await decodePlan(plain([1, 2, 3]))).toBeNull();
    expect(await decodePlan(plain({ ...base, t: '1,2' }))).toBeNull();
    expect(await decodePlan(plain({ ...base, t: [1, 2, 3] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, y: 7 }))).toBeNull();
    expect(await decodePlan(plain({ ...base, y: '20' }))).toBeNull();
    expect(await decodePlan(plain({ ...base, d: '2025-02-30' }))).toBeNull();
    expect(await decodePlan(plain({ ...base, d: 20250708 }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: ['x', 1, 'School', 0, 0] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: ['__proto__', 1, 'School', 0, 0] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: ['w', 1, 42, 0, 0] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: ['w', 1, '   ', 0, 0] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, s: { kind: 'way' } }))).toBeNull();
    expect(await decodePlan(plain({ ...base, a: [{ corners: [] }] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, f: [[1, 9, 2]] }))).toBeNull();
    expect(await decodePlan(plain({ ...base, f: [[1, 1]] }))).toBeNull();
    expect(await decodePlan(`j${Buffer.from([0xff, 0xfe, 0x00]).toString('base64url')}`)).toBeNull();
  });
});
