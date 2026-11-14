import { describe, expect, it } from 'vitest';
import { CAMPUS_VERSION, outdated, type Block, type Campus } from './campus';
import type { Ring } from './geometry';
import { RAMP } from './heat';
import type { Photo } from './naip';
import { roofAim } from './roofpass';
import { dressRoofs, homeBox, lumaOf, muteFor, partBoxes, ROOF_FLOOR, ROOF_MUTE, roofLook, roofPhotoOf, windowOf } from './roofs';

const square = (x: number, y: number, size: number): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

const block = (ring: Ring, home: boolean, height = 6): Block => ({ id: 1, ring, height, guessed: true, home });

function campusWith(blocks: Block[], extra: Partial<Campus> = {}): Campus {
  return {
    version: CAMPUS_VERSION,
    name: 'Test',
    place: '',
    center: { lat: 33.1, lon: -96.7 },
    boundary: [],
    clear: [],
    patches: [],
    strips: [],
    blocks,
    trees: [],
    ...extra,
  };
}

const toLinear = (value: number) => {
  const share = value / 255;
  return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
};

function photoOf(cols: number, rows: number, paint: (x: number, y: number) => [number, number, number, number]): Photo {
  const size = cols * rows;
  const photo: Photo = {
    minX: 0,
    minY: 0,
    cell: 1,
    cols,
    rows,
    red: new Uint8Array(size),
    green: new Uint8Array(size),
    blue: new Uint8Array(size),
    nir: new Uint8Array(size),
    seen: new Uint8Array(size).fill(1),
    date: '2024-07-01',
    gsd: 0.6,
    bytes: 0,
    seconds: 0,
    items: [],
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [r, g, b, n] = paint(col + 0.5, row + 0.5);
      const index = row * cols + col;
      photo.red[index] = r;
      photo.green[index] = g;
      photo.blue[index] = b;
      photo.nir[index] = n;
    }
  }
  return photo;
}

function pixel(dressed: NonNullable<ReturnType<typeof dressRoofs>>, x: number, y: number): number[] {
  const col = Math.floor(x - dressed.box.minX);
  const row = dressed.height - 1 - Math.floor(y - dressed.box.minY);
  const at = (row * dressed.width + col) * 4;
  return Array.from(dressed.data.subarray(at, at + 4));
}

const lumaBytes = (rgb: number[]) => lumaOf([toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])]);

describe('roof photo entries', () => {
  const base = { date: '2024-07-01', minX: -10, minY: -20, maxX: 30, maxY: 40, blocks: [0, 3, 9] };

  it('accepts a baked file and a data address and keeps only real blocks', () => {
    const campus = campusWith([block(square(0, 0, 10), true), block(square(20, 0, 10), true)]);
    expect(roofPhotoOf({ ...campus, roofs: { ...base, src: 'campus/heritage-roofs.webp' } })).toEqual({ ...base, src: 'campus/heritage-roofs.webp', blocks: [0] });
    expect(roofPhotoOf({ ...campus, roofs: { ...base, src: 'data:image/webp;base64,UklGRg==' } })?.src).toBe('data:image/webp;base64,UklGRg==');
  });

  it('refuses addresses, paths out of the folder, broken bounds and missing entries', () => {
    const campus = campusWith([]);
    for (const src of ['https://example.com/a.webp', '../campus/a.webp', 'campus/a.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA']) {
      expect(roofPhotoOf({ ...campus, roofs: { ...base, src } })).toBeNull();
    }
    expect(roofPhotoOf({ ...campus, roofs: { ...base, src: 'campus/a.webp', maxX: -10 } })).toBeNull();
    expect(roofPhotoOf({ ...campus, roofs: null })).toBeNull();
    expect(roofPhotoOf(campus)).toBeNull();
  });

  it('survives the trip through saved text', () => {
    const campus = campusWith([block(square(0, 0, 10), true)], { roofs: { ...base, src: 'data:image/png;base64,iVBORw0KGgo=', blocks: [0] } });
    const back = JSON.parse(JSON.stringify(campus)) as Campus;
    expect(roofPhotoOf(back)).toEqual(roofPhotoOf(campus));
  });

  it('marks campuses saved before roof photos as out of date', () => {
    expect(outdated(campusWith([], { version: CAMPUS_VERSION - 1 }))).toBe(true);
    expect(CAMPUS_VERSION).toBeGreaterThanOrEqual(4);
  });
});

describe('the mute rule', () => {
  const encode = (value: number) => Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
  const saturation = (rgb: number[]) => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
  const hot = RAMP.filter(([temperature]) => temperature >= 130).map(([, rgb]) => rgb);
  const hottest = Math.max(...hot.map((rgb) => lumaBytes(rgb)));
  const lightest = Math.min(...hot.map((rgb) => saturation(rgb)));
  const lookOf = (rgb: number[]) => roofLook(rgb.map(toLinear));

  it('leaves a light grey roof nearly as it is with the lightest mute', () => {
    const look = lookOf([222, 223, 220]);
    expect(look.base.map(encode).every((value, band) => Math.abs(value - [222, 223, 220][band]) <= 1)).toBe(true);
    expect(look.contrast).toBe(ROOF_MUTE.contrast);
    expect(look.color).toBe(ROOF_MUTE.color);
  });

  it('lifts a dark roof to a light neutral above the hot ground', () => {
    const look = lookOf([70, 72, 78]);
    expect(lumaOf(look.base)).toBeGreaterThanOrEqual(ROOF_FLOOR - 1e-6);
    expect(lumaOf(look.base)).toBeGreaterThan(hottest);
    expect(saturation(look.base.map(encode))).toBeLessThan(0.05);
    expect(look.contrast).toBeLessThan(ROOF_MUTE.contrast);
    expect(look.contrast).toBeGreaterThan(0.4);
  });

  it('keeps a soft warm tone on a red metal roof that stays paler than any hot ground', () => {
    const look = lookOf([165, 70, 58]);
    const rgb = look.base.map(encode);
    expect(rgb[0] - rgb[2]).toBeGreaterThan(20);
    expect(saturation(rgb)).toBeGreaterThan(0.1);
    expect(saturation(rgb)).toBeLessThan(lightest * 0.6);
    expect(lumaOf(look.base)).toBeGreaterThan(hottest * 1.1);
    expect(look.color).toBeGreaterThan(0.3);
    expect(look.color).toBeLessThan(0.4);
  });

  it('never sharpens the sharp photo and calms coarse ones', () => {
    expect(muteFor(0.6)).toEqual({ ...ROOF_MUTE, sharpen: 0 });
    const coarse = muteFor(1.2);
    expect(coarse.contrast).toBeLessThan(0.7);
    expect(coarse.contrast).toBeGreaterThan(0.4);
    expect(coarse.sharpen).toBeGreaterThan(0);
  });

  it('leaves no bright rim around a small dark mark', () => {
    const plain: [number, number, number, number] = [200, 201, 198, 180];
    const marked = photoOf(40, 40, (x, y) => {
      if (x < 6 || x > 34 || y < 6 || y > 34) return [120, 130, 110, 90];
      return Math.hypot(x - 20, y - 20) < 1.2 ? [70, 72, 74, 60] : plain;
    });
    const dressed = dressRoofs(marked, [block(square(6, 6, 28), true)]);
    expect(dressed).not.toBeNull();
    if (!dressed) return;
    const field = lumaBytes(pixel(dressed, 12.5, 12.5));
    for (const [x, y] of [[22.5, 20], [17.5, 20], [20, 22.5], [20, 17.5]]) expect(lumaBytes(pixel(dressed, x, y))).toBeLessThanOrEqual(field * 1.01);
  });

  it('reads the sharp photo except on a huge campus', () => {
    expect(roofAim(campusWith([block(square(0, 0, 200), true)]))).toBe(0.6);
    expect(roofAim(campusWith([block(square(0, 0, 200), true), block(square(700, 700, 20), true)]))).toBe(1.2);
    expect(partBoxes(campusWith([block(square(0, 0, 10), true), block(square(50, 0, 10), false)]))).toEqual([{ minX: -8, minY: -8, maxX: 18, maxY: 18 }]);
  });
});

describe('dressing roofs', () => {
  const roof = square(10, 10, 30);
  const neighbour = square(48, 10, 8);
  const white: [number, number, number, number] = [222, 223, 220, 205];
  const photo = photoOf(60, 50, (x, y) => {
    if (x > 10 && x < 40 && y > 10 && y < 40) {
      if (x > 30 && x < 34) return [122, 136, 160, 72];
      if (Math.hypot(x - 18, y - 30) < 2.5) return [60, 110, 50, 170];
      return white;
    }
    return [120, 130, 110, 90];
  });
  const dressed = dressRoofs(photo, [block(roof, true), block(neighbour, false)]);

  it('dresses only campus roofs and crops to them', () => {
    expect(dressed).not.toBeNull();
    if (!dressed) return;
    expect(dressed.blocks).toEqual([0]);
    expect(dressed.box.minX).toBeGreaterThanOrEqual(3);
    expect(dressed.box.maxX).toBeLessThanOrEqual(47);
    expect(pixel(dressed, 25, 25)[3]).toBe(255);
  });

  it('paints a plain band in the median colour at the edge', () => {
    if (!dressed) return;
    const edge = pixel(dressed, 10.5, 25);
    const outside = pixel(dressed, 7.5, 25);
    expect(Math.abs(lumaBytes(edge) - lumaBytes(outside))).toBeLessThan(0.01);
    expect(Math.abs(lumaBytes(edge) - lumaBytes(white))).toBeLessThan(0.03);
  });

  it('lifts the baked shadow and removes the tree crown', () => {
    if (!dressed) return;
    const middle = lumaBytes(pixel(dressed, 25, 18));
    expect(lumaBytes(pixel(dressed, 32, 20))).toBeGreaterThan(middle * 0.85);
    expect(lumaBytes(pixel(dressed, 18, 30))).toBeGreaterThan(middle * 0.85);
  });

  it('leaves no photo far from the roof', () => {
    if (!dressed) return;
    expect(pixel(dressed, dressed.box.minX + 0.5, dressed.box.minY + 0.5)[3]).toBe(0);
  });

  it('returns nothing when no campus roof is in the photo', () => {
    expect(dressRoofs(photo, [block(neighbour, false)])).toBeNull();
  });

  it('cuts a window around the campus buildings', () => {
    const campus = campusWith([block(roof, true), block(neighbour, false)]);
    const box = homeBox(campus);
    expect(box).toEqual({ minX: 2, minY: 2, maxX: 48, maxY: 48 });
    const part = box ? windowOf(photo, box) : null;
    expect(part?.cols).toBe(46);
    expect(part?.minX).toBe(2);
    expect(part?.red[0]).toBe(photo.red[2 * 60 + 2]);
  });
});
