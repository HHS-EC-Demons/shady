import { clamp, lerp } from './geometry';
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

type LiveAnswer = HourlyAnswer & { hourly: { time: string[] } };

export async function todayWeather(lat: number, lon: number): Promise<Weather> {
  const where = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
  const hours = await ask<LiveAnswer>(
    `${FORECAST}?${where}&hourly=temperature_2m,shortwave_radiation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`,
  );
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

async function ask<T>(url: string): Promise<T> {
  let reason = 'no answer';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const answer = (await (await fetch(url, { signal: AbortSignal.timeout(25000) })).json()) as T & { error?: boolean; reason?: string };
      if (!answer.error) return answer;
      reason = answer.reason ?? 'error';
    } catch (error) {
      reason = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
  }
  throw new Error(`The weather archive did not answer (${reason})`);
}

export async function hottestDay(lat: number, lon: number, now = Date.now()): Promise<Weather> {
  const end = isoDay(now - 8 * 86400000);
  const start = isoDay(now - 372 * 86400000);
  const where = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`;
  const daily = await ask<DailyAnswer>(`${ARCHIVE}?${where}&start_date=${start}&end_date=${end}&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=auto`);
  let best = 0;
  daily.daily.temperature_2m_max.forEach((value, index) => {
    if (value !== null && value > (daily.daily.temperature_2m_max[best] ?? -Infinity)) best = index;
  });
  const date = daily.daily.time[best];
  const hours = await ask<HourlyAnswer>(
    `${ARCHIVE}?${where}&start_date=${date}&end_date=${date}&hourly=temperature_2m,shortwave_radiation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`,
  );
  return {
    date,
    zone: hours.timezone,
    offset: offsetFor(hours.timezone, date),
    air: hours.hourly.temperature_2m,
    sunshine: hours.hourly.shortwave_radiation,
    wind: hours.hourly.wind_speed_10m,
    source: 'Open-Meteo historical weather, ERA5 reanalysis',
  };
}
