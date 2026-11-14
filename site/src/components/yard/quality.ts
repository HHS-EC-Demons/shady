export type Tier = 'high' | 'medium' | 'low';
export type PropLevel = { cars: number; people: number; light: boolean; shadows: boolean } | null;

export const TIERS: Record<Tier, { dpr: number; shadow: number; texture: number; props: PropLevel; standing: number; grain: boolean }> = {
  high: { dpr: 1.5, shadow: 3072, texture: 2048, props: { cars: 300, people: 150, light: false, shadows: true }, standing: 600, grain: true },
  medium: { dpr: 1.25, shadow: 2048, texture: 2048, props: { cars: 140, people: 70, light: true, shadows: false }, standing: 250, grain: false },
  low: { dpr: 1, shadow: 1024, texture: 2048, props: null, standing: 150, grain: false },
};

const ORDER: Tier[] = ['high', 'medium', 'low'];
const KEY = 'shady.quality';
const SETTLE_MS = 5000;

export function powerChoice(): 'low-power' | 'high-performance' {
  if (typeof window === 'undefined') return 'high-performance';
  return new URLSearchParams(window.location.search).get('gpu') === 'low' ? 'low-power' : 'high-performance';
}

export function keepFrame(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(pointer: coarse)').matches;
}

export function chipName(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string {
  if (!gl) return '';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}

export function shortChip(name: string): string {
  const marker = 'Renderer: ';
  const start = name.indexOf(marker);
  const rest = start >= 0 ? name.slice(start + marker.length) : name;
  const end = rest.indexOf(',');
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

function guess(): Tier {
  if (typeof window === 'undefined') return 'medium';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let chip = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: powerChoice() });
    chip = chipName(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    chip = '';
  }
  if (/Intel/i.test(chip)) return 'medium';
  const weak = /SwiftShader|Mali-4|Adreno \(TM\) [3-5]|PowerVR/i.test(chip);
  if (memory <= 2 || navigator.hardwareConcurrency <= 2) return 'low';
  if (coarse || weak || memory <= 4) return 'medium';
  return 'high';
}

class Quality {
  tier: Tier = 'medium';
  chosen = false;
  private ready = false;
  private changed = 0;
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
    const now = performance.now();
    if (this.changed > 0 && now - this.changed < SETTLE_MS) return;
    const next = ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(this.tier) + 1)];
    if (next === this.tier) return;
    this.tier = next;
    this.changed = now;
    for (const listener of this.listeners) listener();
  }
}

export const quality = new Quality();
