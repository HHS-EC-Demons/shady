# Shady

A 3D heat model of any school. The landing page scrolls through one hot day on a real campus. The yard lets you drag the sun, plant trees, stretch shade sails, check the model against a thermometer and print a planting plan with coordinates and cost. The district page models up to 48 schools in a city and lists them hottest first.

A plan can be shared as a link or scanned from the QR code on the printed sheet, and whoever opens it sees the same plan live in 3D. The link carries the whole plan in its hash, so nothing is stored on a server.

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
  - `aerial.ts` finds the trees a US school already has and checks its field surfaces in a public USDA aerial photo, with `naip.ts`, `utm.ts`, `look.ts` and `canopy.ts` doing the reading and the pixel work.
  - `places.ts` reports peak heat, hot hours and the walk to shade for each court, lot and field.
  - `story.ts` works out the numbers in the landing page captions at build time.
  - `cost.ts` prices a plan.
  - `sports.ts` lays out the lines and equipment of each court and field from its sport on the map, and finds home plate on ball fields.
  - `detail.ts` turns map tags for colours, roofs and covered paths into clay tones and shapes.
- `site/src/pages/index.astro` is the landing film. `site/src/components/film` holds its scene and scroll state.
- `site/src/pages/yard.astro` is the interactive model. `site/src/components/yard` holds its controller, ground, models, covers, sports gear and scene.
- `site/public/models` holds the trees, cars, light poles and people as compressed GLB files with their shared textures in `tex`. `far.glb` holds only the far level of every model. `manifest.json` beside them is the licence record for every shipped model and texture, with its source page, author, licence, triangles and bytes.
  - `site/src/components/yard/library.ts` loads the models in two steps and in five kinds, broadleaf trees, conifers, cars, poles and people. `far.glb` arrives with the campus and draws everything at its far level. After the first picture the full files are downloaded in the background as bytes only, one at a time and not at all on a saving or slow connection. A kind's nearer levels are prepared only when one of its models on screen comes inside its middle distance, or once the page has been idle for about 6 s after the first picture, and each crowd swaps them in once their shaders are ready. A kind whose far step fails falls back to its old clay shapes and a kind whose full files fail stays at its far level. Either step is tried once more a few seconds later and again on the next page, and the far step also on the next school.
  - `site/src/components/yard/forest.ts` picks the model, the scale and the level of detail for each tree, car and person, and `site/src/components/yard/crowd.ts` draws them in a few batches with a cheaper copy for the shadow pass.
- `site/src/components/plan` is the printable plan sheet.
- `site/src/pages/district.astro` is the district view. `site/src/engine/district.ts` lists a city's schools and summarizes each one, and `site/src/components/district` models them in a worker and draws the tiles.
- `site/src/pages/sources.astro` lists every model number and its source from `site/src/lib/sources.ts`, which also counts the distinct websites for the landing card.
- `pipeline/fetch_campus.ts` rebuilds the default campus file with `bun pipeline/fetch_campus.ts`.
- `pipeline/models_far.mjs` rebuilds `far.glb` from the model files with `npx -p @gltf-transform/core@4.5.1 -p @gltf-transform/extensions@4.5.1 -p @gltf-transform/functions@4.5.1 -p meshoptimizer@1.3.0 node pipeline/models_far.mjs site/public/models`.
- `checks` holds headless browser scripts for frame times, load times and the fallback stills, and `checks/perf.yml`, a workflow that compares page speed against `main` when copied to `.github/workflows` on a branch named `perf/` something.

## What is real and what is not

- The map, the weather day and the sun position are real data.
- Ground temperatures are modeled from published measurements. Nobody has checked them against a thermometer at this school yet. The Measure tool is there for that.
- Building heights are estimates when the map has none. Tap a building to set its real height.
- Unmapped ground counts as grass. The football field inside a running track is assumed to be artificial turf unless the aerial photo shows living grass. Tap any field, court or lot to set its real surface. Fixes are saved in the browser.
- At US schools the trees already standing come from a USDA aerial photo that can be a few years old. Small trees and trees inside building courtyards are often missed. With the Tree tool, tap a standing tree to remove it and tap the same spot to bring it back.
- Roofs without walls, such as carports, shelters and covered walkways, count as shaded ground under them.
- Hoops, goals, nets and backstops are drawn because every court or field of that sport has them. Playground pieces follow a fixed pattern and are not mapped.
- Shady reports ground temperature. It does not predict heat illness.
- Loading another school depends on public map servers that are sometimes busy.

See `PERF.md` for measured frame times.
