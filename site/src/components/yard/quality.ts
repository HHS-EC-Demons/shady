export type Tier = 'high' | 'medium' | 'low';

export const TIERS: Record<Tier, { dpr: number; shadow: number; texture: number }> = {
  high: { dpr: 2, shadow: 4096, texture: 2048 },
  medium: { dpr: 1.5, shadow: 2048, texture: 2048 },
  low: { dpr: 1, shadow: 1024, texture: 2048 },
};

const ORDER: Tier[] = ['high', 'medium', 'low'];
const KEY = 'shady.quality';

function guess(): Tier {
  if (typeof window === 'undefined') return 'medium';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let chip = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    chip = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    chip = '';
  }
  const weak = /Intel|SwiftShader|Mali-4|Adreno \(TM\) [3-5]|PowerVR/i.test(chip);
  if (memory <= 2 || navigator.hardwareConcurrency <= 2) return 'low';
  if (coarse || weak || memory <= 4) return 'medium';
  return 'high';
}

class Quality {
  tier: Tier = 'medium';
  chosen = false;
  private ready = false;
  private listeners = new Set<() => void>();

  private start(): void {
    if (this.ready || typeof window === 'undefined') return;
    this.ready = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    if (saved === 'high' || saved === 'medium' || saved === 'low') {
      this.tier = saved;
      this.chosen = true;
    } else {
      this.tier = guess();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.start();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): Tier => {
    this.start();
    return this.tier;
  };

  server = (): Tier => 'medium';

  choose(tier: Tier): void {
    this.tier = tier;
    this.chosen = true;
    try {
      window.localStorage.setItem(KEY, tier);
    } catch {
      this.chosen = true;
    }
    for (const listener of this.listeners) listener();
  }

  lower(): void {
    if (this.chosen) return;
    const next = ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(this.tier) + 1)];
    if (next === this.tier) return;
    this.tier = next;
    for (const listener of this.listeners) listener();
  }
}

export const quality = new Quality();
