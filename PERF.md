# Performance

Measured 2026-11-12 on a 2018 MacBook Pro in headless Chrome. The page asks for the fast chip, the Radeon Pro 555X. Add `gpu=low` to the page address to force the Intel UHD Graphics 630, which stands in for a laptop with only integrated graphics. Every row names the chip that drew it. Passes 1 to 3 started with the one minute load average under 3. Pass 4 is a separate check run after the others and started at 3.0.

## Budget and result

| Budget | Result |
| --- | --- |
| 60 fps while scrolling at 1080p on integrated graphics | Intel UHD Graphics 630 at 1080p on the medium tier, 60 fps average and 60 fps at the 1% low in passes 2, 3 and 4, 55 fps average and 30 fps at the 1% low in pass 1 |
| 60 fps while scrolling on the fast chip | Radeon Pro 555X at 1080p and at 1440 by 900 at 2x on the high tier, 60 fps average and 60 fps at the 1% low in all four passes |
| Under 100 draw calls | 54 at the busiest beat on high and 46 on medium with covers, sports gear, fences and street furniture, up from 48 and 41 |
| Under 300k triangles | 269k at the busiest beat on high and 160k on medium with 478 standing trees, both counting the shadow pass, up from 262k and 155k |
| Initial JavaScript under 350 KB gzipped | 72 KB before the 3D code is asked for, from the earlier load test and not measured again |
| Largest Contentful Paint under 2.5 s | 116 ms on a local server, from the earlier load test and not measured again |
| HTML content visible before the 3D is ready | Heading painted at 72 ms and film live at 1.3 s, from the earlier load test and not measured again |

## Scroll test

`checks/scroll-perf.js` scrolls the whole film at a steady 700 px a second and records every frame time. Run it from the project root with `playwright-cli -s=perf run-code --filename=checks/scroll-perf.js` while the dev server is on port 4392 and nothing else is using the machine.

The low power chip runs go first. An Intel run straight after a Radeon page in the same browser came out at 37 fps on 1080p and 46 fps at 1440 by 900, both after falling to the low tier, while the same runs before any Radeon page held 59 to 60 fps on medium. The likely cause is macOS switching graphics chips when the Radeon page closes, so that order would measure the switch and not the site.

Pass 2

| Run | Chip | Frames | Average | 1% low | Worst frame | Frames over 20 ms | Readout |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Laptop 1920 by 1080 with `gpu=low` | Intel UHD Graphics 630 | 581 | 60 fps | 60 fps | 17 ms | 0 | 38 calls, 112k tris, dpr 1.00, medium |
| Laptop 1440 by 900 at 2x with `gpu=low` | Intel UHD Graphics 630 | 482 | 59 fps | 30 fps | 50 ms | 6 | 38 calls, 112k tris, dpr 1.25, medium |
| Laptop 1920 by 1080 | Radeon Pro 555X | 581 | 60 fps | 60 fps | 17 ms | 0 | 44 calls, 181k tris, dpr 1.00, high |
| Laptop 1440 by 900 at 2x | Radeon Pro 555X | 489 | 60 fps | 60 fps | 17 ms | 0 | 44 calls, 181k tris, dpr 1.50, high |
| Phone 390 by 844 at 3x | Radeon Pro 555X | 459 | 60 fps | 60 fps | 17 ms | 0 | 44 calls, 181k tris, dpr 1.50, high |
| Laptop 1080p with the CPU slowed 4 times | Radeon Pro 555X | 581 | 60 fps | 60 fps | 17 ms | 0 | 44 calls, 181k tris, dpr 1.00, high |

Pass 3 matched pass 2 except two rows. Intel at 1440 by 900 had 483 frames, 59 fps, 60 fps at the 1% low, a worst frame of 50 ms and 4 slow frames. Radeon at 1440 by 900 had 486 frames, 60 fps, 60 fps at the 1% low, a worst frame of 33 ms and 3 slow frames.

Pass 1 ran first in a fresh browser and the load rose from 2.3 to 5.1 during it. Its Radeon rows matched pass 2. Intel at 1080p had 537 frames, 55 fps, 30 fps at the 1% low, a worst frame of 67 ms and 42 slow frames. Intel at 1440 by 900 had 463 frames, 57 fps, 30 fps at the 1% low, a worst frame of 67 ms and 24 slow frames. Both stayed on medium.

Pass 4 ran in a fresh browser after the yard canvas change below, with the load at 3.0 at the start and 4.3 at the end. Every row was 60 fps average and 60 fps at the 1% low with a worst frame of 17 ms and no slow frames, except Intel at 1440 by 900 with 486 frames, a worst frame of 33 ms and 3 slow frames.

The live site at https://hhs-ec-demons.github.io/shady/ was scrolled the same way at 1080p just after another build on this machine ended, with the load at 3.4 at the start and 4.5 at the end. Intel UHD Graphics 630 on medium had 549 frames, 59 fps, 30 fps at the 1% low, a worst frame of 33 ms and 7 slow frames. Radeon Pro 555X on high had 556 frames, 60 fps, 60 fps at the 1% low, a worst frame of 17 ms and no slow frames.

The phone row is this laptop at phone size. It reports the high tier because headless Chrome has no touch pointer.

## Trees already standing

Heritage now carries 474 trees found in the aerial photo, where it had none from the map before. Standing trees use a 79 triangle crown and a 10 triangle trunk in a quieter green, so they are told apart from planned trees and stay cheap. The high tier draws at most 600 of them, medium 250 and low 150, campus trees first and then the largest. Below the high tier they skip the soft blob under each tree, and their trunks never cast shadows.

Scroll test on 2026-11-13 against the production build on `astro preview`, each run started with the one minute load under 3 or 4 as noted. Before is the same build with the old campus file and no standing trees.

| Run | Chip | Before frames, average, 1% low, slow frames | After frames, average, 1% low, slow frames | After readout |
| --- | --- | --- | --- | --- |
| Laptop 1920 by 1080 with `gpu=low` | Intel UHD Graphics 630 | 577, 60 fps, 60 fps, 4 | 574, 59 fps, 30 fps, 7 | 41 calls, 155k tris, dpr 1.00, medium |
| Laptop 1440 by 900 at 2x with `gpu=low` | Intel UHD Graphics 630 | 475, 58 fps, 30 fps, 13 | 460, 57 fps, 30 fps, 27 | 41 calls, 155k tris, dpr 1.25, medium |
| Laptop 1920 by 1080 | Radeon Pro 555X | 581, 60 fps, 60 fps, 0 | 581, 60 fps, 60 fps, 0 | 48 calls, 262k tris, dpr 1.00, high |
| Laptop 1440 by 900 at 2x | Radeon Pro 555X | 488, 60 fps, 60 fps, 0 | 489, 60 fps, 60 fps, 0 | 48 calls, 262k tris, dpr 1.50, high |
| Phone 390 by 844 at 3x | Radeon Pro 555X | 460, 60 fps, 60 fps, 0 | 460, 60 fps, 60 fps, 0 | 48 calls, 262k tris, dpr 1.50, high |
| Laptop 1080p with the CPU slowed 4 times | Radeon Pro 555X | 582, 60 fps, 60 fps, 0 | 581, 60 fps, 60 fps, 0 | 48 calls, 262k tris, dpr 1.00, high |

The before pass started at a load of 3.3 and ended at 11. The after pass started at 2.9 and ended at 4.7. A separate Intel only pass a minute earlier, started at 2.9, gave 577 frames, 59 fps, 60 fps at the 1% low and 5 slow frames at 1080p, and 476 frames, 58 fps, 30 fps at the 1% low and 13 slow frames at 1440 by 900. The Radeon rows are unchanged. The Intel rows sit at or just under the old numbers and vary from pass to pass by more than the difference. With the blob under every standing tree still drawn on medium, the Intel rows fell to 56 and 57 fps, which is why medium skips it.

## Real life detail

Courts and fields now carry the lines and equipment of their sport, ball fields get a skinned infield and a backstop, roofs without walls are drawn as covers on posts, and fences, walls, hedges, flagpoles, benches, bike racks, street lamps, doors, pools, play pieces, stepped bleachers and roof shapes come from the map. Lines go into the one ground buffer. Covers, pool rims and doors are one mesh that shows on every tier and casts shadows. Every piece of sports gear, fence, wall, hedge and street furniture is merged into one solid mesh and one see through mesh, so a campus adds at most two draw calls for them plus one shadow call on high, and both hide on the low tier like the other props.

Counts were read with `?perf` on the production build for the film and with a counter around every WebGL draw for the yard, which has no readout, both at 1920 by 1080 on the Radeon Pro 555X. They do not depend on the machine load.

| Place | Tier | Before | After |
| --- | --- | --- | --- |
| Film, busiest beat | high | 48 calls, 262k tris | 54 calls, 269k tris |
| Film, busiest beat | medium | 41 calls, 155k tris | 46 calls, 160k tris |
| Yard, Heritage opening view | high | 41 calls, 212k tris | 47 calls, 219k tris |
| Yard, Heritage opening view | medium | 34 calls, 105k tris | 39 calls, 110k tris |

The new detail at Heritage costs about 7k triangles, so nothing had to be won back elsewhere. The film still stands under both budgets with room to spare.

Scroll test on 2026-11-13 against the production build, with `checks/scroll-perf.js` pointed at the local servers, one pass per build, Intel rows first. Another build kept the machine busy the whole time. The before pass started at a one minute load of 97 and ended at 155, and the after pass started at 155 and ended at 188. These numbers measure the busy machine more than the site. The Intel runs fell to the low tier in both passes, and the Radeon rows dropped in both. They need a quiet machine before they can stand next to the tables above.

| Run | Chip | Before frames, average, 1% low, slow frames | After frames, average, 1% low, slow frames | After readout |
| --- | --- | --- | --- | --- |
| Laptop 1920 by 1080 with `gpu=low` | Intel UHD Graphics 630 | 300, 31 fps, 10 fps, 219 | 292, 30 fps, 12 fps, 244 | 36 calls, 118k tris, dpr 1.00, low |
| Laptop 1440 by 900 at 2x with `gpu=low` | Intel UHD Graphics 630 | 232, 28 fps, 10 fps, 165 | 290, 36 fps, 8 fps, 137 | 36 calls, 118k tris, dpr 1.00, low |
| Laptop 1920 by 1080 | Radeon Pro 555X | 581, 60 fps, 60 fps, 0 | 551, 57 fps, 20 fps, 15 | 54 calls, 269k tris, dpr 1.00, high |
| Laptop 1440 by 900 at 2x | Radeon Pro 555X | 483, 59 fps, 30 fps, 6 | 468, 57 fps, 30 fps, 16 | 54 calls, 269k tris, dpr 1.50, high |
| Phone 390 by 844 at 3x | Radeon Pro 555X | 364, 47 fps, 9 fps, 38 | 410, 54 fps, 12 fps, 18 | 54 calls, 269k tris, dpr 1.50, high |
| Laptop 1080p with the CPU slowed 4 times | Radeon Pro 555X | 123, 12 fps, 3 fps, 104 | 95, 10 fps, 1 fps, 82 | 46 calls, 160k tris, dpr 1.00, medium |

Lighthouse 13.6 in its default mobile mode, one run per page, taken while another build kept the one minute load between 80 and 175. The numbers are far below the quiet machine runs above for both builds and only show that the new build is not worse. Accessibility stayed at 100 on every page.

| Page | Before score, LCP, total blocking time, load | After score, LCP, total blocking time, load |
| --- | --- | --- |
| Home | 66, 1.2 s, 4,255 ms, 110 | 69, 2.1 s, 3,524 ms, 131 |
| Yard | 43, 6.0 s, 1,848 ms, 82 | 61, 3.3 s, 1,789 ms, 172 |
| Plan | 63, 4.5 s, 977 ms, 94 | 84, 2.8 s, 469 ms, 144 |

## Reading the aerial photo

When a US school is picked, `aerial.ts` asks the Planetary Computer index for the newest NAIP photo over the campus, then reads only the tiles under the campus from the 1.2 m overview with range requests. The geotiff reader and the finder load only at that moment, 17 KB and 7 KB gzipped, in the engine worker. The finder takes 0.1 to 0.4 s of worker time on these campuses and 1.1 s on the 1.1 km Allen High School campus. The step gives up after 8 seconds and the school loads without it.

| School | Photo | Bytes read | Seconds to read |
| --- | --- | --- | --- |
| Heritage High School, Frisco TX | July 2022 | 2.9 MB | 2.3 to 3.4 s |
| Roosevelt High School, Seattle WA | October 2023 | 1.2 MB | 1.8 to 2.9 s |
| Walt Whitman High School, Bethesda MD | October 2023 | 2.8 MB | 2.3 s |
| Desert Vista High School, Phoenix AZ | June 2025 | 3.0 MB | 2.1 s |
| Allen High School, Allen TX | July 2022 | 4.3 MB | 2.5 s |

The photo is read while the weather day loads, so the school appears about 2.5 s later than before. In the yard on the production build, Roosevelt High School took 15.4 s and 17.0 s from the pick to the model with the photo and 12.9 s with the photo hosts blocked. Most of that time is the map servers, which reset connections during these runs. Heritage reads nothing at run time because its trees are baked into the campus file.

## GPU time per frame

`checks/gpu-time.js` loads the film with `?perf=gpu`. That adds two `EXT_disjoint_timer_query_webgl2` queries a frame, one around the shadow pass and one around the main pass, and counts calls and triangles for each scene part. Each screen runs twice, the second time with `hide=ground,shade`, and the difference is the ground with its shadows. A query for every draw call does not work on this machine. Each query splits the Metal render pass, the MSAA buffers get stored and reloaded, and a 9k triangle draw then reads as 8 ms.

Before is a build of the old code, after is the current build, both served as static files. Values are mean milliseconds per frame over the whole scroll. The before pass ran the Radeon screens first.

| Screen | Chip and tier | Before p50 and p99 | Before shadow, main, ground | After p50 and p99 | After shadow, main, ground |
| --- | --- | --- | --- | --- | --- |
| 1920 by 1080 | Intel UHD Graphics 630, medium | 22.1 and 26.7 | 3.4, 18.3, 8.2 | 14.2 and 17.6 | 0.2, 13.9, 4.7 |
| 1440 by 900 at 2x | Intel UHD Graphics 630, medium | 29.3 and 36.0 | 4.5, 24.2, 11.1 | 13.7 and 18.9 | 0.2, 13.4, 4.0 |
| 1920 by 1080 | Radeon Pro 555X, high | 7.5 and 9.9 | 3.3, 4.2, 1.9 | 5.4 and 6.7 | 1.0, 4.5, 2.0 |
| 1440 by 900 at 2x | Radeon Pro 555X, high | 16.1 and 17.8 | 5.6, 9.9, 4.5 | 7.1 and 9.2 | 1.0, 6.0, 2.8 |

| Pass | Before on high | Before on medium | After on high | After on medium |
| --- | --- | --- | --- | --- |
| Shadow | 14 calls, 90k tris | 14 calls, 56k tris | 15 calls, 77k tris | 9 calls, 31k tris |
| Main | 24 calls, 115k tris | 24 calls, 81k tris | 24 calls, 102k tris | 24 calls, 79k tris |

Keeping the drawing buffer on the film canvas cut the Intel shadow time at 1080p from 3.4 ms to 0.2 ms, and three.js clears it every frame anyway. The likely reason is that Chrome clears the canvas before the first draw call of a frame. That first draw was in the shadow pass, so the clear opened and stored an MSAA pass of its own.

## Profile of the slowed run

`checks/profile.js` records a CPU profile of one scroll with the processor slowed 4 times.

| Cost | Before | After |
| --- | --- | --- |
| Heat fill for the ground texture | 2.8 s of 7.9 s busy | 1.3 s of 8.8 s busy |

The heat fill used to recompute all 131 thousand grid cells every frame. It now touches only the cells on or next to the campus, with the math inlined. What remains is mostly browser internals and the page router saving the scroll position, which the test triggers far more often than a person scrolling does. The next step would be to move the blend between heat steps into the shader so no cell is touched per frame.

## Load test

`checks/load.js` runs against `astro preview` on port 4393. These were taken before the vector ground, the new models and the seven beat film went in, so the lazy 3D file is a little larger now.

| Measure | Value |
| --- | --- |
| First contentful paint | 72 ms |
| Largest contentful paint | 116 ms |
| Script bytes at page load | 72 KB gzipped in 4 files |
| Largest lazy file | three.js, React Three Fiber and drei at 293 KB gzipped |
| Film live | 1.3 s |

On the live site at https://hhs-ec-demons.github.io/shady/ the film was live 1.7 to 2.1 s after the page was requested, measured from this laptop on 2026-11-12.

## Going back to the landing page

| Server | Before | After |
| --- | --- | --- |
| Dev | 6.5 to 8.0 s | 0.7 to 0.8 s |
| Production build | not measured | 0.37 to 0.43 s |
| Live site on GitHub Pages | not measured | 0.66 to 0.75 s |

The story numbers are cached on the server, the built model and simulations are kept in memory between page changes, the page transition is 260 ms, and icons are imported one by one.

## Load on a slow phone

Lighthouse 13.6 in its default mobile mode with only the performance category. It simulates a slow 4G network and a processor 4 times slower than the machine it runs on.

Before was measured on the live site at https://hhs-ec-demons.github.io/shady/ on 2026-11-12.

| Page | Score | LCP | Total blocking time | Longest tasks | Time to interactive |
| --- | --- | --- | --- | --- | --- |
| Home | 62 | 1.0 s | 14,010 ms | 6.1 s, 3.2 s, 2.0 s, 1.0 s, 0.9 s | 16.0 s |
| Yard | 57 | 3.7 s | 5,300 ms | 3.9 s, 0.9 s, 0.5 s | 7.9 s |
| Plan | 75 | 1.9 s | 1,250 ms | not recorded | not recorded |
| Sources | 100 | not recorded | 10 ms | not recorded | not recorded |

The same old build served by `astro preview` on this laptop gave these medians of 3 runs on 2026-11-12, each run started with the one minute load under 4.

| Page | Score | LCP | Total blocking time | Longest task | Time to interactive |
| --- | --- | --- | --- | --- | --- |
| Home | 70 | 1.0 s | 2,490 ms | 920 ms | 7.9 s |
| Yard | 56 | 4.4 s | 2,203 ms | 956 ms | 5.8 s |
| Plan | 76 | 2.6 s | 936 ms | 884 ms | 3.2 s |

After is the new production build on the same local preview with the same Lighthouse settings, median of 3 runs, each started with the one minute load under 4.

| Page | Score | LCP | Total blocking time | Longest task | Time to interactive |
| --- | --- | --- | --- | --- | --- |
| Home | 90 | 1.0 s | 408 ms | 160 ms | 5.0 s |
| Yard | 88 | 2.9 s | 314 ms | 162 ms | 4.8 s |
| Plan | 96 | 2.4 s | 141 ms | 190 ms | 2.6 s |

After the deploy the live site was measured once per page with the same settings. Home scored 93 with an LCP of 0.9 s, 330 ms of total blocking time, a longest task of 155 ms and 3.7 s to interactive. Yard scored 85 with an LCP of 2.2 s, 510 ms of total blocking time, a longest task of 206 ms and 4.0 s to interactive. Another build started on this machine during the yard run and the load reached 9 by its end.

With 474 standing trees in the Heritage file the same preview gave these results on 2026-11-13, three runs per page, each started with the one minute load under 3. Home scored 92, 89 and 86 with 266, 339 and 552 ms of total blocking time. Yard scored 85, 85 and 86 with an LCP of 3.1 s, up from 2.9 s, because the campus file it waits for grew from 44 KB to 74 KB. Plan scored 95, 94 and 95. Accessibility stayed at 100 on all three pages. One extra home run started at a load of 4 scored 68 with a 2.4 s task that Lighthouse could not attribute to any script, and two home runs with the old campus file on the same build scored 90 and 91.

The first live table above was also taken on a busier machine than the local runs, which is why its blocking times are far higher than the local before table for the same build.

Sources was not measured again. On this laptop without throttling the film went live 1.1 s after the page was requested on the local preview, down from 1.6 s for the old build, and going back to the landing page took 0.38 s, down from 0.66 s.

The heat model now runs in a module Web Worker that calls the same engine functions, so its results are byte for byte the same as before. The worker builds the ground grid, the shadow backdrop and the bare day, and also the contact shadows, the rooftop units and the ground mesh data that the main thread used to build while it mounted the scene. The film goes live on the bare day while a second worker computes the sail day and the tree day, and the film switches to them when they arrive. The yard sends each plan change to the worker and drops any answer older than the latest edit. The 3D scene mounts one part per task and compiles its shaders in the background before its first frame. The yard page loads its 3D code after the readout bar has painted. The landing page now picks the film or the stills before the beat images load, so a visitor who gets the film no longer downloads stills it never shows. The two Latin web fonts and the campus file are preloaded. The yard still misses an LCP of 2.5 s because its readout bar waits for 285 KB of fonts, scripts and data in 20 requests on the simulated network.

## What keeps it fast

- The canvas renders on demand. A frame is drawn only when scroll, the pointer, an animation or the model changes something. An idle page draws nothing.
- Tiers set the pixel ratio cap at 1.5, 1.25 or 1, the shadow map at 3072, 2048 or 1024, and props at 300 cars and 150 people, 140 cars and 70 people, or none. A chip named Intel starts on medium. A frame rate drop steps down one tier, waits 5 seconds before it can step again, and does nothing if the visitor picked a tier in the footer. A tier change only resizes the canvas and the shadow map and rebuilds the props.
- One shadow casting light. Its shadow area follows the view, so close ups get sharp shadows from the same map. Cars, people, poles, nets and goalposts cast shadows only on high. On medium cars keep their contact blobs.
- Props hide when the nearest car would be under 3 pixels long. On the current campus the nearest car is still about 7 pixels in the widest film shots at 1080p, so they stay.
- The ground is one draw call of about 19 thousand vector triangles, so edges stay sharp at any zoom with no large textures. In the film a stencil test lets each pixel take only its top ground layer, the ground samples the shadow map itself instead of a second full screen shadow plane, and the backdrop only fills pixels the ground left empty.
- Close up ground detail sits behind real branches on the pixel footprint. Noise, joints, mowing bands and curb relief run only when a pixel is smaller than the feature, sheen fades out past 0.6 m a pixel, and curb relief strips collapse in the vertex shader once relief can no longer show.
- The heat texture uploads before the frame starts, so it never breaks the render pass.
- The film and yard canvases keep their drawing buffer on devices with a mouse or trackpad, so Chrome does not clear it in a pass of its own. Touch devices keep the browser default because no phone has been measured.
- The shade sail is drawn at near zero size from the first frame, so its shaders compile at load instead of mid scroll.
- Film trees use the lighter 683 triangle crown and standing trees a 79 triangle one, capped per tier. Neighbor buildings are one merged mesh.
- No allocation inside frame callbacks.
- The heat simulation runs once at load. Scrolling only blends finished results.
- Three.js loads after first paint through a lazy import.
- Geometries, materials and textures are disposed when a scene part is replaced.

## Not measured yet

- A real mid range phone. The phone row above is this laptop at phone size.
- A cold network. All load numbers are from a local server.
- Safari and Firefox.
- The Yard page under the same scroll test. It uses the same stencil and kept buffer path as the film, checked by eye on close ups and not timed.
