import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Campus } from '@/engine/campus';
import { insideRing } from '@/engine/geometry';
import { bandPads, courts, fields, lightPoles, parkingStalls, walkers } from './layout';

const { campus } = JSON.parse(readFileSync(new URL('../../../public/campus/heritage.json', import.meta.url), 'utf8')) as { campus: Campus };

describe('layout', () => {
  const stalls = parkingStalls(campus);
  const lots = campus.patches.filter((patch) => patch.label === 'Parking lot');

  it('finds the painted stalls', () => {
    expect(stalls.length).toBeGreaterThan(200);
  });

  it('keeps every stall centre inside a parking lot', () => {
    for (const stall of stalls) expect(lots.some((lot) => insideRing(lot.ring, stall.x, stall.y))).toBe(true);
  });

  it('keeps stall centres at least 2 m apart', () => {
    let nearest = Infinity;
    for (let i = 0; i < stalls.length; i += 1) {
      for (let j = i + 1; j < stalls.length; j += 1) nearest = Math.min(nearest, Math.hypot(stalls[i].x - stalls[j].x, stalls[i].y - stalls[j].y));
    }
    expect(nearest).toBeGreaterThanOrEqual(2);
  });

  it('centres every court box inside its patch', () => {
    const found = courts(campus);
    expect(found.length).toBeGreaterThan(0);
    for (const court of found) expect(insideRing(court.ring, court.x, court.y)).toBe(true);
  });

  it('gives only finite numbers', () => {
    const spots = [...stalls, ...lightPoles(campus), ...walkers(campus)];
    for (const spot of spots) expect([spot.x, spot.y, spot.heading].every(Number.isFinite)).toBe(true);
    for (const box of [...courts(campus), ...fields(campus), ...bandPads(campus)]) {
      expect([box.x, box.y, box.ux, box.uy, box.long, box.short].every(Number.isFinite)).toBe(true);
    }
  });
});
