import { rasterize, simCell } from '../site/src/engine/campus';
import { backdropOf, fixedOf, hottestMinute, simulate, tally } from '../site/src/engine/heat';
import { findSchools, loadCampus } from '../site/src/engine/osm';
import { placesOf } from '../site/src/engine/places';
import { Planner } from '../site/src/engine/planner';
import { clockLabel } from '../site/src/engine/sun';
import { hottestDay } from '../site/src/engine/weather';

const names = process.argv.slice(2);
const headers = { 'User-Agent': 'school-shade-project/0.1' };

for (const name of names) {
  const started = performance.now();
  try {
    const found = await findSchools(name);
    if (found.length === 0) {
      console.log(JSON.stringify({ name, error: 'no school found' }));
      continue;
    }
    const campus = await loadCampus(found[0], headers);
    const weather = await hottestDay(campus.center.lat, campus.center.lon);
    const loaded = performance.now();
    const ground = rasterize(campus, simCell(campus));
    const backdrop = backdropOf(ground, weather, campus.center.lat, campus.center.lon, fixedOf(campus));
    const day = simulate(ground, weather, backdrop);
    const peak = hottestMinute(day, ground);
    const result = tally(day, ground, peak);
    const planner = new Planner(campus, ground, day, weather, 5.1, 9.4);
    let planted = 0;
    for (let index = 0; index < 10; index += 1) if (planner.next()) planted += 1;
    console.log(
      JSON.stringify({
        name: found[0].name,
        place: found[0].place,
        kind: found[0].kind,
        boundary: campus.boundary.length,
        blocks: campus.blocks.length,
        home: campus.blocks.filter((block) => block.home).length,
        patches: campus.patches.length,
        strips: campus.strips.length,
        trees: campus.trees.length,
        places: placesOf(campus, ground).map((place) => place.label),
        grid: `${ground.grid.cols}x${ground.grid.rows} at ${ground.grid.cell}m`,
        day: weather.date,
        zone: weather.zone,
        airPeak: Math.round(Math.max(...weather.air)),
        peakAt: clockLabel(peak),
        groundPeak: Math.round(result.peak),
        hotShare: Math.round(result.hot * 100),
        planted,
        loadSeconds: Math.round((loaded - started) / 100) / 10,
        modelMs: Math.round(performance.now() - loaded),
      }),
    );
  } catch (error) {
    console.log(JSON.stringify({ name, error: String(error).slice(0, 160) }));
  }
}
