import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCampus, type Found } from '../site/src/engine/osm';
import { hottestDay, type Weather } from '../site/src/engine/weather';

const school: Found = {
  kind: 'way',
  id: 334606673,
  name: 'Heritage High School',
  place: 'Frisco, Texas',
  lat: 33.1787082,
  lon: -96.7545208,
};

const campus = await loadCampus(school, { 'User-Agent': 'school-shade-project/0.1' });
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'site', 'public', 'campus');
mkdirSync(out, { recursive: true });
const file = join(out, 'heritage.json');
let weather: Weather;
try {
  weather = await hottestDay(campus.center.lat, campus.center.lon);
} catch (error) {
  if (!existsSync(file)) throw error;
  weather = (JSON.parse(readFileSync(file, 'utf8')) as { weather: Weather }).weather;
  console.error(`Kept the saved weather day. ${String(error)}`);
}
writeFileSync(join(out, 'heritage.json'), JSON.stringify({ campus, weather }));

const kinds: Record<string, number> = {};
for (const patch of campus.patches) kinds[patch.surface] = (kinds[patch.surface] ?? 0) + 1;
for (const strip of campus.strips) kinds[`strip ${strip.surface}`] = (kinds[`strip ${strip.surface}`] ?? 0) + 1;
console.log(
  JSON.stringify({
    boundary: campus.boundary.map((ring) => ring.length),
    kinds,
    blocks: campus.blocks.length,
    home: campus.blocks.filter((block) => block.home).length,
    trees: campus.trees.length,
    day: weather.date,
    zone: weather.zone,
    offset: weather.offset,
    peak: Math.max(...weather.air),
    sunshine: Math.max(...weather.sunshine),
  }),
);
