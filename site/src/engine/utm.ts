export type Zone = { zone: number; south: boolean };

const A = 6378137;
const F = 1 / 298.257223563;
const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const RECT = (A / (1 + N)) * (1 + N2 / 4 + (N2 * N2) / 64);
const K0 = 0.9996;
const EAST = 500000;
const SOUTH = 10000000;
const ALPHA = [N / 2 - (2 * N2) / 3 + (5 * N3) / 16, (13 * N2) / 48 - (3 * N3) / 5, (61 * N3) / 240];
const BETA = [N / 2 - (2 * N2) / 3 + (37 * N3) / 96, N2 / 48 + N3 / 15, (17 * N3) / 480];
const DELTA = [2 * N - (2 * N2) / 3 - 2 * N3, (7 * N2) / 3 - (8 * N3) / 5, (56 * N3) / 15];
const ECC = (2 * Math.sqrt(N)) / (1 + N);
const RAD = Math.PI / 180;

export function zoneOf(epsg: number): Zone | null {
  if (epsg >= 26901 && epsg <= 26923) return { zone: epsg - 26900, south: false };
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

function meridian(zone: number): number {
  return ((zone - 1) * 6 - 180 + 3) * RAD;
}

export function toUtm(lat: number, lon: number, zone: Zone): [number, number] {
  const phi = lat * RAD;
  const lambda = lon * RAD - meridian(zone.zone);
  const sine = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sine) - ECC * Math.atanh(ECC * sine));
  const xi = Math.atan2(t, Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let east = eta;
  let north = xi;
  for (let j = 1; j <= 3; j += 1) {
    east += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    north += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [EAST + K0 * RECT * east, (zone.south ? SOUTH : 0) + K0 * RECT * north];
}

export function fromUtm(east: number, north: number, zone: Zone): { lat: number; lon: number } {
  const xi = (north - (zone.south ? SOUTH : 0)) / (K0 * RECT);
  const eta = (east - EAST) / (K0 * RECT);
  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 3; j += 1) {
    xiPrime -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let phi = chi;
  for (let j = 1; j <= 3; j += 1) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lambda = meridian(zone.zone) + Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));
  return { lat: phi / RAD, lon: lambda / RAD };
}
