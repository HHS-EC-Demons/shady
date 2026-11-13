# Shady

A 3D heat model of any school. The landing page scrolls through one hot day on a real campus. The yard lets you drag the sun, plant trees, stretch shade sails, check the model against a thermometer and print a planting plan with coordinates and cost.

Live at https://hhs-ec-demons.github.io/shady/

Built as a Samsung Solve for Tomorrow 2026 to 2027 entry. Every push to `main` rebuilds and publishes the site through `.github/workflows/deploy.yml`.

## Run it

```
cd site
npm install
npm run dev
```

`npm test` runs the engine tests. `npm run build` writes the static site to `site/dist`.

## What is where

- `site/src/engine` holds the model with no browser code in it.
  - `osm.ts` finds a school and turns OpenStreetMap data into a campus.
  - `weather.ts` picks the hottest day of the past year from the Open-Meteo archive, or today's forecast.
  - `sun.ts` and `shade.ts` place the sun and cast shadows onto a grid.
  - `heat.ts` runs the day in ten minute steps and gives every grid cell a temperature.
  - `planner.ts` finds the best spots for trees.
  - `places.ts` reports peak heat, hot hours and the walk to shade for each court, lot and field.
  - `story.ts` works out the numbers in the landing page captions at build time.
  - `cost.ts` prices a plan.
- `site/src/pages/index.astro` is the landing film. `site/src/components/film` holds its scene and scroll state.
- `site/src/pages/yard.astro` is the interactive model. `site/src/components/yard` holds its controller, ground, models and scene.
- `site/src/components/plan` is the printable plan sheet.
- `site/src/pages/sources.astro` lists every model number and its source.
- `pipeline/fetch_campus.ts` rebuilds the default campus file with `bun pipeline/fetch_campus.ts`.
- `checks` holds headless browser scripts for frame times, load times and the fallback stills.

## What is real and what is not

- The map, the weather day and the sun position are real data.
- Ground temperatures are modeled from published measurements. Nobody has checked them against a thermometer at this school yet. The Measure tool is there for that.
- Building heights are estimates when the map has none. Tap a building to set its real height.
- Unmapped ground counts as grass. The football field inside a running track is assumed to be artificial turf. Tap any field, court or lot to set its real surface. Fixes are saved in the browser.
- Shady reports ground temperature. It does not predict heat illness.
- Loading another school depends on public map servers that are sometimes busy.

See `PERF.md` for measured frame times.
