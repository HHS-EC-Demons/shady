import { describe, expect, it } from 'vitest';
import { FURNITURE } from './forest';
import { playModel } from './gear';

describe('playground models', () => {
  it('maps each old piece to its real model and turns the slide a quarter', () => {
    expect(playModel(0, 10, 20)).toEqual({ model: 'play-slide', turn: Math.PI / 2 });
    expect(playModel(1, 10, 20)).toEqual({ model: 'play-swings', turn: 0 });
    expect(playModel(3, 10, 20)).toEqual({ model: 'play-seesaw', turn: 0 });
  });

  it('alternates climbers and monkey bars by place and keeps the choice stable', () => {
    const picks = Array.from({ length: 40 }, (_, index) => playModel(2, index * 3.7, index * -2.3).model);
    expect(new Set(picks)).toEqual(new Set(['play-climber', 'play-monkeybars']));
    expect(playModel(2, 12.34, 56.78)).toEqual(playModel(2, 12.34, 56.78));
  });

  it('only names models that ship', () => {
    for (const kind of [0, 1, 2, 3]) for (const spot of [0, 1, 2, 3, 4]) expect(FURNITURE).toContain(playModel(kind, spot * 5.1, spot * 2.9).model);
  });
});
