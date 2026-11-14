import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let drawable: boolean | null = null;

export function canDraw(): boolean {
  if (drawable !== null) return drawable;
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    drawable = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    drawable = false;
  }
  return drawable;
}
