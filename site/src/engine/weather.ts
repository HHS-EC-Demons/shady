import { clamp, lerp } from './geometry';
import { Stopped, firstOf, type Source } from './race';
import { offsetFor } from './sun';

export type Weather = {
  date: string;
  zone: string;
  offset: number;
  air: number[];
  sunshine: number[];
  wind: number[];
  source: string;
  live?: boolean;
};

export function hourly(values: number[], minute: number): number {
  const at = clamp(minute / 60, 0, values.length - 1);
  const low = Math.floor(at);
  const high = Math.min(values.length - 1, low + 1);
  return lerp(values[low], values[high], at - low);
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

type DailyAnswer = { daily: { time: string[]; temperature_2m_max: (number | null)[] } };
type HourlyAnswer = {
  timezone: string;
  hourly: { temperature_2m: number[]; shortwave_radiation: number[]; wind_speed_10m: number[] };
};

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const HISTORY = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const HISTORY_FROM = '2022-01-01';
export const WEATHER_GAP = 2500;

type LiveAnswer = HourlyAnswer & { hourly: { time: string[] } };

const HOURS = 'hourly=temperature_2m,shortwave_radiation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
export const WEATHER_BUDGET = 10000;
export const FIRST_DAY = '1940-01-01';
export const DAYS_AHEAD = 14;
export const ARCHIVE_AFTER = 5;

function where(lat: number, lon: number): string {
  return `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
}

export async function todayWeather(lat: number, lon: number, signal?: AbortSignal): Promise<Weather> {
  const hours = await firstOf([(stop) => ask<LiveAnswer>(`${FORECAST}?${where(lat, lon)}&${HOURS}&forecast_days=1`, stop)], WEATHER_GAP, Date.now() + WEATHER_BUDGET, signal);
  const date = hours.hourly.time[0].slice(0, 10);
  return {
    date,
    zone: hours.timezone,
    offset: offsetFor(hours.timezone, date),
    air: hours.hourly.temperature_2m,
    sunshine: hours.hourly.shortwave_radiation,
    wind: hours.hourly.wind_speed_10m,
    source: 'Open-Meteo forecast',
    live: true,
  };
}

export function minuteNow(weather: Weather, now = Date.now()): number {
  const minutes = Math.floor(now / 60000) + weather.offset;
  return ((minutes % 1440) + 1440) % 1440;
}

async function ask<T>(url: string, signal: AbortSignal): Promise<T> {
  const answer = await fetch(url, { signal });
  const body = (await answer.json()) as T & { error?: boolean; reason?: string };
  if (!answer.ok || body.error) throw new Error(`The weather service did not answer (${body.reason ?? answer.status})`);
  return body;
}

function complete(weather: Weather): boolean {
  return [weather.air, weather.sunshine, weather.wind].every((values) => values.length >= 24 && values.every((value) => typeof value === 'number' && Number.isFinite(value)));
}

export function localDay(time = Date.now()): string {
  const day = new Date(time);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  return isoDay(Date.parse(`${date}T00:00:00Z`) + days * 86400000);
}

export function lastDay(today: string): string {
  return addDays(today, DAYS_AHEAD);
}

export function dayAllowed(date: string, today: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || isoDay(time) !== date) return false;
  return date >= FIRST_DAY && date <= lastDay(today);
}

export function weatherSource(date: string, today: string): 'archive' | 'forecast' {
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  return age > ARCHIVE_AFTER ? 'archive' : 'forecast';
}

function label(base: string): string {
  if (base === ARCHIVE) return 'Open-Meteo historical weather, ERA5 reanalysis';
  return base === HISTORY ? 'Open-Meteo historical forecast' : 'Open-Meteo forecast';
}

function hoursFrom(base: string, lat: number, lon: number, date: string): Source<Weather> {
  return async (signal) => {
    const hours = await ask<HourlyAnswer>(`${base}?${where(lat, lon)}&start_date=${date}&end_date=${date}&${HOURS}`, signal);
    const weather: Weather = {
      date,
      zone: hours.timezone,
      offset: offsetFor(hours.timezone, date),
      air: hours.hourly.temperature_2m,
      sunshine: hours.hourly.shortwave_radiation,
      wind: hours.hourly.wind_speed_10m,
      source: label(base),
    };
    if (!complete(weather)) throw new Error('The weather for that day is not complete');
    return weather;
  };
}

function hottestFrom(base: string, lat: number, lon: number, start: string, end: string): Source<{ base: string; date: string }> {
  return async (signal) => {
    const daily = await ask<DailyAnswer>(`${base}?${where(lat, lon)}&start_date=${start}&end_date=${end}&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=auto`, signal);
    const values = daily.daily?.temperature_2m_max ?? [];
    let best = -1;
    values.forEach((value, index) => {
      if (value !== null && Number.isFinite(value) && (best < 0 || value > (values[best] ?? -Infinity))) best = index;
    });
    if (best < 0) throw new Error('The weather service sent no days');
    return { base, date: daily.daily.time[best] };
  };
}

export function daySources(date: string, today: string): string[] {
  if (weatherSource(date, today) === 'archive') return date >= HISTORY_FROM ? [ARCHIVE, HISTORY] : [ARCHIVE];
  return date < today && date >= HISTORY_FROM ? [FORECAST, HISTORY] : [FORECAST];
}

export async function hottestDay(lat: number, lon: number, now = Date.now(), date?: string, signal?: AbortSignal): Promise<Weather> {
  if (date) {
    const day = await dayWeather(lat, lon, date, isoDay(now), signal).catch((error: unknown) => {
      if (error instanceof Stopped) throw error;
      return null;
    });
    if (day) return day;
  }
  const deadline = Date.now() + WEATHER_BUDGET;
  const end = isoDay(now - 8 * 86400000);
  const start = isoDay(now - 372 * 86400000);
  const found = await firstOf([hottestFrom(ARCHIVE, lat, lon, start, end), hottestFrom(HISTORY, lat, lon, start, end)], WEATHER_GAP, deadline, signal);
  const order = found.base === ARCHIVE ? [ARCHIVE, HISTORY] : [HISTORY, ARCHIVE];
  return firstOf(
    order.map((base) => hoursFrom(base, lat, lon, found.date)),
    WEATHER_GAP,
    deadline,
    signal,
  );
}

export async function dayWeather(lat: number, lon: number, date: string, today: string, signal?: AbortSignal): Promise<Weather> {
  if (!dayAllowed(date, today)) throw new Error('That day is out of range');
  return firstOf(
    daySources(date, today).map((base) => hoursFrom(base, lat, lon, date)),
    WEATHER_GAP,
    Date.now() + WEATHER_BUDGET,
    signal,
  );
}
