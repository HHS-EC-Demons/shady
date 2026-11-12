# Performance

Measured 2026-11-11 on a 2018 MacBook Pro. The headless browser rendered on the Intel UHD Graphics 630 integrated chip through ANGLE Metal, so these are integrated graphics numbers. The Radeon was not used.

## Budget and result

| Budget | Result |
| --- | --- |
| 60 fps while scrolling at 1080p on integrated graphics | 60 fps average, 60 fps at the 1% low, worst frame 17 ms |
| Under 100 draw calls | 31 at the busiest beat |
| Under 300k triangles | 77k at the busiest beat |
| Initial JavaScript under 350 KB gzipped | 72 KB before the 3D code is asked for |
| Largest Contentful Paint under 2.5 s | 116 ms on a local server, so network time comes on top |
| HTML content visible before the 3D is ready | Heading painted at 72 ms, film live at 1.3 s |

## Scroll test

`checks/scroll-perf.js` scrolls the whole film at a steady 700 px a second and records every frame time. Run it from the project root with `playwright-cli run-code --filename=checks/scroll-perf.js` while the dev server is on port 4392 and nothing else is using the machine.

| Run | Frames | Average | 1% low | Worst frame | Frames over 20 ms | Pixel ratio used |
| --- | --- | --- | --- | --- | --- | --- |
| Laptop 1920 by 1080 | 581 | 60 fps | 60 fps | 17 ms | 0 | 1.0 |
| Laptop 1440 by 900 at 2x | 487 | 60 fps | 60 fps | 33 ms | 1 | 1.5 |
| Phone 390 by 844 at 3x | 459 | 60 fps | 60 fps | 33 ms | 1 | 1.5 |
| Laptop 1080p, CPU slowed 4 times | 522 | 54 fps | 15 fps | 150 ms | 34 | 1.0 |

The slowed run is the weak spot. Before the last fix it averaged 45 fps with 107 slow frames.

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

## Going back to the landing page

| Server | Before | After |
| --- | --- | --- |
| Dev | 6.5 to 8.0 s | 0.7 to 0.8 s |
| Production build | not measured | 0.37 to 0.43 s |

The story numbers are cached on the server, the built model and simulations are kept in memory between page changes, the page transition is 260 ms, and icons are imported one by one.

## What keeps it fast

- The canvas renders on demand. A frame is drawn only when scroll, the pointer, an animation or the model changes something. An idle page draws nothing.
- Pixel ratio is capped by tier at 2, 1.5 or 1. A frame rate drop steps the tier down unless the visitor picked one in the footer.
- One shadow casting light. Its shadow area follows the view, so close ups get sharp shadows from the same map.
- The ground is one draw call of about 14 thousand vector triangles, so edges stay sharp at any zoom with no large textures.
- Film trees are two instanced meshes using a lighter 683 triangle crown. Neighbor buildings are one merged mesh.
- No allocation inside frame callbacks.
- The heat simulation runs once at load. Scrolling only blends finished results.
- Three.js loads after first paint through a lazy import.
- Geometries, materials and textures are disposed when a scene part is replaced.

## Not measured yet

- A real mid range phone. The phone row above is this laptop at phone size.
- A cold network. All load numbers are from a local server.
- Safari and Firefox.
- The Yard page under the same scroll test.
