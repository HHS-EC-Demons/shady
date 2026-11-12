import { getPosition } from 'suncalc';

export type SunRay = { x: number; y: number; z: number; altitude: number; bearing: number };

export function sunAt(lat: number, lon: number, utc: number): SunRay {
  const position = getPosition(new Date(utc), lat, lon);
  const bearing = (position.azimuth * Math.PI) / 180;
  const altitude = (position.altitude * Math.PI) / 180;
  const flat = Math.cos(altitude);
  return {
    x: Math.sin(bearing) * flat,
    y: Math.cos(bearing) * flat,
    z: Math.sin(altitude),
    altitude,
    bearing,
  };
}

export function utcFor(date: string, minute: number, offsetMinutes: number): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 0, 0, 0) + (minute - offsetMinutes) * 60000;
}

export function offsetFor(zone: string, date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(noon);
  const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function clockLabel(minute: number): string {
  const whole = Math.round(minute);
  const hour = Math.floor(whole / 60) % 24;
  const rest = whole % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}.${String(rest).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}
