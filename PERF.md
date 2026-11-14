# Performance

Measured 2026-11-12 on a 2018 MacBook Pro in headless Chrome. The page asks for the fast chip, the Radeon Pro 555X. Add `gpu=low` to the page address to force the Intel UHD Graphics 630, which stands in for a laptop with only integrated graphics. Every row names the chip that drew it. Passes 1 to 3 started with the one minute load average under 3. Pass 4 is a separate check run after the others and started at 3.0.

## Budget and result

| Budget | Result |
| --- | --- |
| 60 fps while scrolling at 1080p on integrated graphics | Intel UHD Graphics 630 at 1080p on the medium tier, 60 fps average and 60 fps at the 1% low in passes 2, 3 and 4 on 2026-11-12. The standing trees and the detail round brought it down to about 40 fps on a quiet machine. After the fixes in Integrated graphics after the detail round its GPU time per frame is 10 to 15 percent lower, and under loads of 43 to 285 it scrolled at 51 to 55 fps where the code before the fixes gave 43 to 51 under loads of 43 to 56. A quiet machine pass is still to be taken. Since the real models went in on 2026-11-14 the medium tier draws without antialiasing, which halves its GPU time per frame to about 9 ms at 1080p, so the chip now has room for 60 fps. Every frame rate run of that day was taken under loads of 13 to 356 and none of them can show it |
| 60 fps while scrolling on the fast chip | Radeon Pro 555X at 1080p and at 1440 by 900 at 2x on the high tier, 60 fps average and 60 fps at the 1% low in all four passes |
| At most 130 draw calls on high and 100 on medium, from 2026-11-14 | 116 at the busiest beat on high and 85 on medium with the real models, up from 54 and 46, and at most 113 and 85 in Firefox |
| At most 700k triangles on high and 320k on medium, from 2026-11-14 | 552k at the busiest beat on high and 180k on medium with the real models, both counting the shadow pass, up from 269k and 160k |
| Models add at most 2.5 MB over the wire | 1.37 MB at a school without conifers and 1.87 MB with them, as served without compression, or 1.04 MB and 1.47 MB if the host compresses them |
| Initial JavaScript under 350 KB gzipped | 72 KB before the 3D code is asked for, from the earlier load test and not measured again |
| Largest Contentful Paint under 2.5 s | 116 ms on a local server, from the earlier load test and not measured again |
| HTML content visible before the 3D is ready | Heading painted at 72 ms and film live at 1.3 s, from the earlier load test and not measured again |

## Real models

On 2026-11-14 the clay trees, cars, light poles and people were replaced by real models, with their makers on the sources page. Each model is a compressed GLB file in `site/public/models`, trees in three levels of detail and the rest in two, with textures shared between models. The near levels, where few models are drawn, are batched meshes, one per material for every model and level together and drawn with one multi draw call each. The far levels, where most of the 480 trees and 300 cars sit, are instanced meshes, one per model and material. A first try batched every level, and it held 60 fps of GPU time but not of frames on the fast chip, 34 to 48 fps where the old build gave 57 to 60, because Chrome on this Mac splits a multi draw call into one Metal draw per model and that came to several thousand a frame. The batches also skip three.js per object culling and sorting, which cost about 9 ms of processor time a frame in that first try. Instead each set of models works out its levels and which models are in view only when the camera has moved 6 percent of the way to the nearest model or turned 3 degrees, with a margin around the view so nothing pops in at the edges, and shadow casters keep a wider margin. In the shadow pass the far levels of cars, people and poles are one merged mesh per model.

Measured against the production build on `astro preview`, with the build from before the change served beside it as static files and measured in turn. Another session ran large builds most of the night and the one minute load moved between 8 and 356, so the frame rates show the busy machine. The comparisons rest on GPU time per frame from timer queries and on main thread time, taken with the two builds in turn so the load hits both alike.

### What each tier draws

Distances are for a 10 m tree or a car on a screen 1080 pixels tall. They grow with the size of the model and the height of the screen, and a model moves to a farther level only 15 percent past the edge, so it does not flicker.

| Tier | Antialiasing | Trees | Cars, people and poles | Shadow pass |
| --- | --- | --- | --- | --- |
| High | 4x | detailed within 150 m, middle level to 400 m, far level beyond | detailed within 70 m, simple beyond | trees from the middle level or farther, props from the simple level |
| Medium | none | detailed within 70 m, middle level to 220 m, far level beyond | detailed within 40 m, simple beyond | trees from the far level, props cast none |
| Low | none | detailed within 35 m, middle level to 120 m, far level beyond | none | trees from the far level |

### Antialiasing on the Intel chip

Three choices for the medium tier, scrolled with the real models in at 1920 by 1080 with `gpu=low`, GPU time per frame over the whole scroll, two runs each at loads of 30 to 124.

| Choice | p50 | p99 |
| --- | --- | --- |
| 4x as before | 18.4 ms | 22.3 ms |
| None | 9.0 and 9.1 ms | 11.2 and 11.5 ms |
| None with the pixel ratio raised to 1.5 | 15.0 and 15.1 ms | 18.6 and 18.4 ms |

Only no antialiasing keeps the slowest frames under 16.7 ms. Close up pictures of roof edges, court lines and leaf edges on medium show light stair steps on roof edges and thin lines, and leaf edges look the same as on high because leaves are alpha tested either way. Alpha to coverage was tried on high and made crowns pale and speckled, so every tier uses a plain alpha test at the cutoff the models carry.

### Busiest beat

Calls and triangles from the `?perf` readout, sampled every frame while the film scrolls at 300 px a second, both counting the shadow pass. These do not depend on the load.

| Tier | Before | After |
| --- | --- | --- |
| High | 54 calls, 269k tris | at most 116 calls and 552k tris |
| Medium | 46 calls, 160k tris | at most 85 calls and 180k tris |
| Medium on the Intel chip | 46 calls, 160k tris | at most 85 calls and 180k tris |
| Low | 36 calls, 118k tris | at most 53 calls and 87k tris |

Most of the new triangles on high are the 300 cars, about 370 triangles each in their simple level and drawn twice with their shadows. Most of the new calls are the instanced far levels, one per model and material that has something in view.

### GPU time per frame over the scroll

The before build at loads of 92 to 149 and the final after build at loads of 49 to 97, after earlier passes with the first after builds that agreed within 0.5 ms. Shadow and main are the mean milliseconds of each pass.

| Screen | Chip and tier | Before p50 and p99 | Before shadow and main | After p50 and p99 | After shadow and main |
| --- | --- | --- | --- | --- | --- |
| 1920 by 1080 | Intel UHD Graphics 630, medium | 18.48 and 21.19 | 0.32 and 17.91 | 8.56 and 11.73 | 0.37 and 8.20 |
| 1440 by 900 at 2x | Intel UHD Graphics 630, medium | 18.78 and 21.35 | 0.37 and 18.05 | 8.66 and 11.30 | 0.37 and 8.39 |
| 1920 by 1080 | Radeon Pro 555X, high | 4.89 and 6.02 | 0.96 and 3.89 | 6.24 and 8.75 | 1.47 and 4.65 |
| 1440 by 900 at 2x | Radeon Pro 555X, high | 6.29 and 7.99 | 0.96 and 5.31 | 7.95 and 11.85 | 1.49 and 6.55 |

The Intel chip spends half the time it did, almost all of it from dropping antialiasing. The Radeon spends 1.4 to 1.7 ms more for the detailed trees and cars it now draws and their shadows, and stays under half a frame.

### Main thread time per frame

Chrome's task time per frame over the whole scroll from its Performance metrics, Radeon Pro 555X at 1920 by 1080 on high with the `?perf` readout on, the two builds in turn at loads of 8 to 14. The middle rows hide one part each with `hide=`.

| Shown | Before, task time and frame rate | After, task time and frame rate |
| --- | --- | --- |
| Everything | 3.69 ms, 60 fps | 5.81 ms, 60 fps |
| Without cars, people and poles | 3.27 ms, 60 fps | 4.96 ms, 60 fps |
| Without trees | 4.26 ms, 59 fps | 4.40 ms, 60 fps |

The models add about 2 ms of main thread work a frame on this chip, most of it the trees, and the frame stays well inside 16.7 ms.

### Scroll test

`checks/scroll-perf.js` on both builds, after first, in the quietest stretch of the night. The after pass ran while the one minute load rose from 9 to 23 and the before pass while it stayed between 23 and 20. Neither build pins a tier here, so a slow run can step down mid scroll, and the readout names the tier it ended on.

| Run | Chip | Before frames, average, 1% low, slow frames, end tier | After frames, average, 1% low, slow frames, end tier |
| --- | --- | --- | --- |
| Laptop 1920 by 1080 with `gpu=low` | Intel UHD Graphics 630 | 344, 35 fps, 20 fps, 215, low | 567, 59 fps, 30 fps, 11, medium |
| Laptop 1440 by 900 at 2x with `gpu=low` | Intel UHD Graphics 630 | 274, 34 fps, 15 fps, 186, medium | 361, 44 fps, 9 fps, 59, medium |
| Laptop 1920 by 1080 | Radeon Pro 555X | 512, 53 fps, 15 fps, 37, high | 491, 51 fps, 12 fps, 41, high |
| Laptop 1440 by 900 at 2x | Radeon Pro 555X | 429, 53 fps, 15 fps, 35, high | 429, 53 fps, 30 fps, 52, high |
| Phone 390 by 844 at 3x | Radeon Pro 555X | 460, 60 fps, 60 fps, 0, high | 400, 52 fps, 20 fps, 39, high |
| Laptop 1080p with the CPU slowed 4 times | Radeon Pro 555X | 206, 21 fps, 7 fps, 115, medium | 174, 18 fps, 3 fps, 116, medium |

The Intel chip at 1080p now holds medium and scrolls at 59 fps where the old build fell to low and gave 35. The Radeon rows sit within a few frames of the old build except the phone size row, which lost 8 fps. The slowed processor row is close to the old build, and both fell to medium. Two passes earlier in the night at loads of 30 to 133 gave the first, fully batched build 34 to 50 fps on the Radeon, which is what led to the instanced far levels above. The after build measured here is two small changes older than the final code, which caches each model's top level, works out levels after 6 percent of movement or 3 degrees of turn instead of 4 percent and 2 degrees, and makes colour buffers up front. A quiet machine pass is still to be taken.

### Yard

`checks/yard-perf.js` on both builds, after first, with its draw counter now also counting multi draw calls. Each cell gives frames, average, 1% low and the most draw calls and triangles seen in a frame. The after pass ran at loads of 10 to 17 and the before pass at 17 to 69, so the before rows lost more to the machine.

| Run | Place | Before orbit | After orbit | Before time slider | After time slider |
| --- | --- | --- | --- | --- | --- |
| 1920 by 1080 with `gpu=low` | Heritage | 566, 26 fps, 12, 29 calls, 68k | 613, 55 fps, 60, 70 calls, 171k | 815, 54 fps, 20 | 503, 60 fps, 60 |
| 1920 by 1080 with `gpu=low` | Roosevelt High School | 507, 28 fps, 15, 47 calls, 61k | 839, 58 fps, 30, 80 calls, 86k | 751, 54 fps, 20 | 556, 60 fps, 60 |
| 1440 by 900 at 2x with `gpu=low` | Heritage | 837, 36 fps, 10 | 758, 59 fps, 30 | 681, 57 fps, 30 | 546, 59 fps, 60 |
| 1440 by 900 at 2x with `gpu=low` | Roosevelt High School | 668, 49 fps, 20 | 1011, 53 fps, 20 | 544, 59 fps, 30 | 551, 59 fps, 60 |
| 1920 by 1080 | Heritage | 689, 60 fps, 60, 47 calls, 219k | 548, 60 fps, 60, 90 calls, 428k | 615, 60 fps, 60 | 498, 59 fps, 60 |
| 1920 by 1080 | Roosevelt High School | 816, 58 fps, 30, 53 calls, 78k | 558, 59 fps, 30, 101 calls, 133k | 502, 60 fps, 60 | 513, 60 fps, 60 |
| 1440 by 900 at 2x | Heritage | 581, 57 fps, 30 | 641, 58 fps, 20 | 610, 59 fps, 60 | 657, 55 fps, 20 |
| 1440 by 900 at 2x | Roosevelt High School | 759, 47 fps, 8 | 765, 51 fps, 10 | 764, 57 fps, 20 | 611, 59 fps, 60 |

The Intel rows gain the most, again from the medium tier dropping antialiasing. The after Heritage orbit on Intel had one 617 ms frame. Some instanced far levels and batches only learned they needed per model colours when they first came into view, so their shaders compiled mid orbit. The final code gives every coloured batch and instanced mesh its colour buffer when it is built, so the shaders compile with the rest of the scene before the first frame. A recheck of the final code at loads of 42 to 178 had no frame over 150 ms in that orbit, but the load was too high for its frame rates to say more.


### Browsers without multi draw

Firefox has no `WEBGL_multi_draw`, and three.js would then draw each near model of a batch on its own, 290 to 491 calls a frame on high in a review. Where the extension is missing every level is an instanced mesh instead. The `?perf` readout in Firefox on high gave 93, 107, 105, 104, 113, 98 and 105 calls at the seven beats, and 73, 70, 63, 69, 78, 68 and 85 on medium. Chromium gave 93, 86, 91, 83, 106, 78 and 105 on high, and WebKit the same within one call.

### When a model file fails

Models load in five kinds, broadleaf trees, conifers, cars, poles and people. A kind whose model or texture files fail falls back to its old clay shapes and the others stay real. A failure is never kept. The kind is tried once more four seconds later and again on the next school or page, and the scene swaps in the models when they arrive. Textures are fetched and decoded by the site itself, once each, so a missing texture shows only the browser's own failed request.

### Low tier up close

The low tier used to draw every tree at its far level, which smeared leaf cards and flat triangles over a close tree. It now draws the detailed level within 35 m and the middle level within 120 m. GPU time per frame on the Intel chip at 1920 by 1080 in the yard, median of 60 frames, far level only against the new levels, at loads of 58 to 184.

| View | Far level only | New low tier |
| --- | --- | --- |
| Whole campus | 5.61 ms | 5.40 and 5.56 ms |
| 50 m from a tree, looking at it | 6.24 ms | 6.62 and 6.75 ms |
| 20 m from a tree | 6.97 ms | 10.15 and 10.55 ms |
| 50 m from a tree, at eye height | 6.02 ms | 6.12 and 6.23 ms |
| 120 m from a tree | 6.30 ms | 7.22 and 7.66 ms |

The closest view costs about 3.5 ms more because the detailed crown has many leaf cards over each pixel, and stays well inside a frame.

### Page weight

The film and the yard fetch `far.glb` and its far leaf textures at the same moment as the campus and keep the loading picture up until both are in. The full files follow after the first picture, see Far level first below. Only pages that draw 3D fetch them, and never with a preload link. At a school without conifers that is 18 files and 5 textures, 1.37 MB as `astro preview` serves them and 1.04 MB if the host compresses them, plus the 113 KB pack. A school with conifers adds 2 files and 3 textures, 0.49 MB. The district page draws no trees and loads none.

### Far level first

A review on 2026-11-14 found the yard's first picture 2.7 times later on slow 4G with the real models, 14.0 s where the build before them gave 5.2 s, because every model file had to arrive before the gate opened. The models now load in two steps.

- `far.glb` holds only the far level of every model, the third level of the 8 trees and the second of the 6 cars, 4 people and 2 poles, 20 nodes and 7,855 vertices in 115,924 bytes. Its JSON is 46 KB of that, mostly the 103 compressed buffer views, so it misses the 80 KB aim. It points at the same far leaf textures as the full files, and only the ones the wanted kinds use are fetched. The pages start fetching it and its textures before three.js has arrived, and the yard starts fetching its scene code at the same time instead of after the models.
- The gate opens when the campus and the pack are in, and everything draws at its far level. Level choice clamps to the levels that have arrived, so a close tree shows its far crown until its full file is in, never a hole.
- After the first picture the full files follow one kind at a time, broadleaf, cars, poles, people, then conifers where the campus has them. Each crowd rebuilds only when its own kinds change step, builds in slices of one geometry or 256 members per task, uploads its textures one per task, compiles its shaders and the matching shadow depth shaders off the main thread, reads their uniforms one program per task, and only then swaps in. The swap keeps every position and tint. Meshopt decoding runs in two workers and each mesh is converted in its own task.
- A kind whose pack step fails falls back to its clay shapes. A kind whose full files fail stays at its far level. Each is tried once more four seconds later.

Measured on the production build served with gzip for text files as GitHub Pages does, against the build from before the real models, in headless Chromium with an empty cache. The slow profile is 1.6 Mbps down, 750 kbps up, 150 ms latency and the processor slowed 4 times. First picture is the moment the loading picture goes, near levels is the last geometry upload after the last full file. Total blocking time runs from the first paint to 3 s after near levels.

| Page, slow profile | Before the models | Two steps, final build | Two steps, without the early fetch |
| --- | --- | --- | --- |
| Yard first picture | 6.57, 6.60, 6.67 s at load 5 | 7.73 s at load 6, then 8.37 and 13.67 s as the load rose to 16 | 8.39, 8.50, 8.28 s at loads 15 to 6 |
| Yard near levels | same as first picture | 15.9 and 16.9 s | 16.5 to 16.8 s |
| Yard bytes at first picture and at near levels | 648 KB | 922 KB and 2,143 KB | 921 KB and 2,142 KB |
| Yard total blocking time | 794 to 878 ms | 1,089 and 1,918 ms | 1,109 to 1,438 ms |
| Yard longest task, after the first picture | 210 to 234 ms | 254 and 375 ms | 265 to 292 ms |
| Landing film live | 6.45 to 6.73 s at load 5 | 8.56 s at load 6, then 9.15 and 10.49 s | 8.66 to 9.10 s |
| Landing near levels | same as live | 16.6 and 17.9 s | 16.6 to 18.6 s |
| Landing bytes at live and at near levels | 735 KB | 1,016 KB and 2,237 KB | 1,015 KB and 2,236 KB |
| Landing longest task after live | none over 50 ms | 117 and 226 ms | 95 to 256 ms |

| Page, no throttling, loads 9 to 6 | Before the models | Two steps, without the early fetch |
| --- | --- | --- |
| Yard first picture | 1.52 to 1.58 s | 1.59 to 1.64 s |
| Yard near levels | same | 2.45 to 2.60 s |
| Yard longest task after the first picture | 69 to 81 ms | 96 to 118 ms |
| Landing live | 1.66 to 1.70 s | 1.69 to 1.78 s |
| Landing near levels | same | 2.39 to 2.50 s |
| Landing longest task after live | none over 50 ms | 62 to 87 ms |

On the slow profile the yard's first picture now comes about 1.1 s after the build before the models, inside the 1.5 s aim, where the single step build was 8.8 s behind on slow 4G. The landing film still goes live about 2 s after the old build, about 280 KB more over a 1.6 Mbps line plus the pack's decoding on the slowed processor. Phase two still has tasks over 200 ms on the slowed processor and up to about 120 ms without throttling, so the 50 ms aim is not met. A profile at a load near 75, taken before the slicing, showed the worst of them were shader programs being checked on first use and crowd building, which the final build moves into separate tasks. It was not profiled again. The frame gaps while phase two ran were at most 117 to 433 ms on the slow profile and 67 to 117 ms without throttling.

Blocked files, on the dev build at loads of 127 to 180. One car file blocked kept every car at its far level while the other kinds went full. One near leaf texture blocked kept the broadleaf trees at their far level. A far leaf texture blocked gave clay broadleaf trees, as did the whole texture folder, with cars, poles and people real. The pack alone blocked gave clay shapes at the first picture and the full models once phase two arrived. No page errors in any case. The retry four seconds later fell inside each block, so none of them came back on that page.

With both steps in, the seven beats look as before in Chromium, WebKit and Firefox, and the opening beat at live differs from the same beat after phase two in 0.11 percent of pixels. Scrolling straight to the close beats right after live on the slow network showed far crowns and no hole or flash. Firefox gave 93, 107, 101, 104, 117, 99 and 105 calls on high and 73, 70, 66, 69, 78, 69 and 85 on medium. The Intel chip on medium at the busiest beat took 8.42 ms of GPU time per frame at the median and 10.64 ms at the 99th percentile, at loads of 205 to 271.

### Prepare only what is seen

A runner comparison on 2026-11-14 with Lighthouse, software rendering and the processor slowed 4 times found the first picture fixed but the main thread busier than with the single step, because phase two parsed, converted, uploaded and compiled every kind right after the first picture. Now the full files are only downloaded after the first picture, as bytes at low priority one at a time, and not at all when the browser reports saving data or a 3g or slower link. A kind's nearer levels are prepared only when a model of that kind on screen sits inside its middle level distance, or once the page has been up 6 s after the first picture and the main thread is idle. A whole campus view never needs them. Until then everything draws from its far level.

Profile of the landing page before this change, in Chromium with SwiftShader, the processor slowed 4 times, the slow profile network and an empty cache, from load until the near levels were in, at load 13. Self time, leaving out idle time, 1,787 ms of unattributed native work and 131 ms of garbage collection.

| Cost | Self time |
| --- | --- |
| `getProgramInfoLog`, waiting for a shader program to link | 217 ms |
| Unnamed native code | 206 ms |
| `floatGeometry` in `library.ts` | 185 ms |
| `fetch` | 124 ms |
| `texSubImage2D`, texture uploads | 107 ms |
| `getProgram` in three.js | 102 ms |
| `setProgram` in three.js | 98 ms |
| `shaderSource` | 97 ms |
| `nextTask` in `stages.tsx` | 95 ms |
| `replaceLightNums` in three.js, building shader text | 87 ms |

What changed besides the demand rule. Converting a full file now reuses the far level parts from the pack, so that level is neither converted nor uploaded twice. The warm up reads the uniforms of a shader program only once. The scene tree takes a library that changes only when the set of kinds changes, and each crowd listens for its own kinds, so a library notice no longer renders the whole scene again. Building a whole new crowd when a kind arrives, instead of adding its near levels to the crowd on screen, is left as it is because it is the riskier change, and the depth shaders are still compiled before the swap because they would otherwise compile in the middle of a frame.

Runner-like runs on this Mac, three per build, loads 21 falling to 13. Old is the build before the real models. Times are from navigation, totals run to 5 s and to 20 s after the first picture.

| Page left alone | Old | Round 3 | Now |
| --- | --- | --- | --- |
| Landing live | 6.90, 8.47, 7.10 s | 8.40, 10.49, 8.59 s | 15.41, 9.77, 8.81 s |
| Landing blocking time to live plus 5 s | 0.97, 2.08, 1.36 s | 1.14, 3.07, 1.20 s | 6.80, 2.14, 1.35 s |
| Landing script time to live plus 5 s | 2.26, 3.79, 2.51 s | 2.14, 4.21, 2.33 s | 6.85, 3.45, 2.43 s |
| Landing blocking and script time to 20 s | as above | 1.44 and 2.83, 3.66 and 4.98, 1.59 and 2.89 s | 8.89 and 7.70, 3.62 and 4.67, 1.59 and 2.75 s |
| Landing near levels in | at live | 17.4, 19.9, 17.4 s | 28.3, 21.7, 17.9 s |
| Yard first picture | 8.13, 9.35, 6.92 s | 12.82, 8.75, 7.41 s | 15.72, 13.62, 7.28 s |
| Yard blocking time to first picture plus 5 s | 2.01, 2.96, 0.85 s | 6.39, 2.41, 0.84 s | 9.00, 6.97, 0.79 s |
| Yard script time to first picture plus 5 s | 3.16, 4.26, 2.35 s | 6.80, 3.27, 2.19 s | 8.81, 7.48, 2.35 s |
| Yard blocking and script time to 20 s | as above | 8.11 and 8.06, 3.33 and 4.41, 1.09 and 2.58 s | 10.86 and 10.40, 7.15 and 8.18, 1.04 and 2.92 s |
| Yard near levels in | at first picture | 25.3, 18.8, 15.5 s | 31.8, 23.8, 16.2 s |
| Bytes in all, landing and yard | 728 and 645 KB | 2,230 and 2,139 KB | 2,230 and 2,140 KB |

The third run of each, at the lowest load, puts the new build within 1.3 times the old one up to 5 s after the first picture on both pages and level with round 3 over 20 s. The first two runs of the new build were the slowest of their group, including their first picture, which this change does not touch, and the machine was also running another session's builds, so these runs cannot show a gain over round 3 either way. The new build always ran last in its group.

| Interacting, now | Run 1 | Run 2 |
| --- | --- | --- |
| Landing scrolled to the heat beat at live, longest task after live | 632 ms | 1,857 ms |
| Yard zoomed to about 40 m right after the first picture, longest task after it | 949 ms | 619 ms |

The 200 ms aim for the interacting runs is not met. In a profile of the zoom the worst task was one `getProgramInfoLog` call in the warm up that waited 17 s for the software graphics process, which was still drawing the zoomed frames, and round 3 had the same pattern with 17.4 s.

Lighthouse 13 run on this Mac the way `checks/perf.yml` runs it, one run each, loads 9 to 27. Its simulated slowdown on a busy machine gives much larger numbers than the GitHub runner, so only the order within a row says anything.

| Lighthouse | Old | Round 3 | Now |
| --- | --- | --- | --- |
| Landing blocking time | 24.6 s | 21.2 s | 7.0 s |
| Landing script time | 23.7 s | 23.7 s | 9.3 s |
| Landing longest task | 6.2 s | 10.0 s | 3.9 s |
| Yard first big paint | 6.3 s | 11.0 s | 8.9 s |
| Yard blocking time | 35.9 s | 44.7 s | 36.9 s |
| Yard script time | 37.4 s | 52.3 s | 39.1 s |

With one car file blocked on the dev build the cars stayed at their far level while broadleaf trees, poles and people went full once the page was idle, and no app error was logged.

### Lighter first download

The pack is now one mesh with one primitive per material, each model kept as a range of vertices and indices in the primitive, which cut its JSON from 46 KB to 13 KB. It also holds the far level of the new benches, bike racks, walkway lamps and playground pieces, and it is 88.9 KB in all. It points at 256 px copies of the far leaf textures, 14 to 16 KB each, and the 512 px ones arrive with the full files. Phase one at a school without conifers fell from 239 KB to 116 KB. At the whole campus view at 1920 by 1080 on high, the 256 px crowns differ from the 512 px ones in 0.01 percent of pixels.

On the slow profile on this Mac, at loads of 12 falling to 9, the yard's first picture came at 6.91, 8.24 and 6.72 s on the build before the models, 8.28, 8.75 and 7.84 s on round 4 and 8.77, 7.81 and 8.65 s now. The pack and its textures now arrive before three.js does. The time left is main thread work after three.js arrives.

With the small props in, the busiest beat draws 109 calls and 455k triangles on high, 78 calls and 150k on medium and 46 calls and 66k on low. Firefox stays at 115 calls or fewer on high. The Intel chip on medium at the busiest beat took 8.66 ms of GPU time per frame at the median.

## Roofs and walls

On 2026-11-14 the buildings got real roofs and walls. Campus roofs show the USDA aerial photo of that roof, with the shadows baked into the photo lifted, tree crowns over the roof removed and a plain rim about 1.5 m wide in the roof's own colour. Dark and strongly coloured roofs are pulled toward a light tone so no roof is darker than the hottest ground colours, and a coloured roof keeps about a third of its colour. The site's guessed rooftop units sink out of sight wherever a roof has a photo, because the photo shows the real ones. Neighbouring buildings keep their plain clay look. Walls get a brick texture tinted by each building's tone, and the windows are a dark cool pane with a thin light frame and a faint sky tint at grazing angles.

### What it costs

| Item | Bytes | When it loads |
| --- | --- | --- |
| Heritage roof photo, `heritage-roofs.webp` | 3,040 | with the scene, before the film goes live |
| Brick texture, `masonry.webp` | 17,684 | with the scene, before the film goes live |
| Roof and wall code in the scene bundle | 4.4 KB and 1.7 KB gzipped in the first round, a little more since and not measured again | with the scene |
| Roof pass for a searched school, `roofpass` | 9.5 KB, 4.0 KB gzipped | only when a searched school asks for roofs |
| Sharp photo read for a searched school | 0.77 MB at Roosevelt High School, 3.24 MB at Cass Technical High School, 2.86 MB at Wimberley High School | after the model and the photo trees are shown |
| A searched school's dressed roofs, kept with the campus | 2 to 8 KB of WebP, or 58 to 71 KB of PNG in WebKit | stored in the browser |

In four runs of the film on the production build the Heritage roofs were fully in 0.26 to 0.31 s before the film went live, on high and on medium, so the roofs never fade in during the film.

GPU time per frame on the Intel chip with `?perf=gpu&gpu=low` on medium at 1920 by 1080, 240 frames at each beat, the live site and this build in turn. The heat beat is the busiest.

| Beat | Live site, run 1 and run 2 | With roofs and walls, run 1 and run 2 | Load |
| --- | --- | --- | --- |
| Heat | 9.81 and 8.54 ms | 9.06 and 9.52 ms | 115 falling to 20 |
| Plant | 9.09 and 8.05 ms | 7.80 and 8.56 ms | same runs |
| Yours | 8.01 and 6.64 ms | 6.73 and 7.82 ms | same runs |

The differences sit inside the spread between runs, so the roofs and walls cost nothing measurable. Calls and triangles at each beat are the same as on the live site. The shadow pass stayed between 0.35 and 0.48 ms.

### When a searched school gets its roofs

A school in the United States without roofs gets a separate roof pass after its model and its photo trees are shown. The pass reads the aerial photo at its own 0.6 m over the tiles that hold a campus building, and only reads the 1.2 m overview when the buildings span more than 36 ha. It runs only on a device with a mouse or trackpad and only when the browser does not report saving data or a `slow-2g`, `2g` or `3g` link. On a touch device or a slow link the roofs stay plain with their guessed rooftop units and nothing extra is downloaded. A failed or blocked read leaves the plain roofs and logs nothing, and the pass is tried again on the next page load, never in a loop. A school outside the United States never asks. Schools opened from the District page and schools saved before roofs existed get their roofs the same way the next time they are opened.

From the search to the roofs on the production build, in two passes at loads of 25 to 138, the model showed after 7.1 to 8.6 s and the roofs were fully in after 11.1 to 13.4 s at Roosevelt High School, Cass Technical High School and Wimberley High School.

### What each tier shows

Every tier shows the roof photos, the brick and the glass. The brick fades out once a pixel covers more than about 8 cm of wall, so it is never drawn in the wide film shots. Close views on medium and low, which have no antialiasing, were checked still and in bursts of frames while the camera slid and turned slowly. The brick and the roof photo held steady with no shimmer or crawling lines, because both are mipmapped and the brick fades before its courses get thinner than a pixel. The thin outline drawn around campus buildings broke into dashes along roof edges on medium, on the live site as well, because it sat at the same depth as the roof. The buildings are now drawn slightly behind their outlines, and the sunk rooftop units sit 0.5 m under the roof so no corner pokes through.

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

Heritage now carries 478 trees found in the aerial photo, where it had none from the map before. Four of them came with the rebuild after the merge, in a courtyard of the main building that the map now draws as open ground. Standing trees use a 79 triangle crown and a 10 triangle trunk in a quieter green, so they are told apart from planned trees and stay cheap. The high tier draws at most 600 of them, medium 250 and low 150, campus trees first and then the largest. Below the high tier they skip the soft blob under each tree, and their trunks never cast shadows.

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

## Integrated graphics after the detail round

On 2026-11-13 the film fell to about 40 fps on average and 15 to 20 fps at the 1% low on the Intel chip, measured on a quiet machine against the dev server. Four production builds from that day were served side by side with `astro preview` and measured in turn. Build A is the site before the day's work, build B adds the standing trees, build C adds the real life detail round, and build D is the current code with the District page and the polish rounds. Another session ran large builds for most of the evening and the one minute load swung between 4 and 430, so every number below names its load. Where the load was high the comparison rests on GPU time per frame, taken with the builds in turn so the load hits each one alike.

### Which round cost the frames

Scroll test on the Intel chip with `?perf&gpu=low`, three passes per build. GPU time is the mean per frame over the whole scroll from `checks/gpu-time.js` style timer queries, split into the shadow pass and the main pass. Calls and triangles are the readout at the busiest beat and count the shadow pass.

| Build | 1080p average and 1% low, with the load | 1440 by 900 at 2x average and 1% low, with the load | GPU per frame at 1080p, shadow pass and main pass | GPU per frame at 1440 by 900 at 2x | Busiest beat |
| --- | --- | --- | --- | --- | --- |
| A, before the day | 55 and 30 fps at 4.5, 47 and 30 at 7, 52 and 30 at 66 | 52 and 30 at 5, 43 and 15 at 47, 37 and 9 at 96 after falling to low | 19.7 ms, 0.27 and 19.5 | 20.6 ms | 38 calls, 112k tris |
| B, standing trees | 55 and 30 at 5.5, 43 and 30 at 47, 51 and 30 at 72 | 47 and 30 at 5, 40 and 20 at 66, 51 and 30 at 66 | 20.4 ms, 0.36 and 20.1 | 20.8 ms | 41 calls, 155k tris |
| C, real life detail | 47 and 30 at 5, 40 and 20 at 66, 50 and 30 at 44 | 50 and 30 at 7, 39 and 20 at 56, 49 and 30 at 72 | 20.8 ms, 0.35 and 20.5 | 21.1 ms | 46 calls, 160k tris |
| D, current code | 51 and 30 at 7, 43 and 30 at 56, 50 and 30 at 43 | 47 and 30 at 7, 46 and 15 at 47, 51 and 30 at 44 | 20.8 ms, 0.34 and 20.5 | 21.3 ms | 46 calls, 160k tris |

The first pass of each build ran at 8 pm with the load between 4.5 and 7, and the other two ran just after 10 pm. GPU time is the mean of two passes taken with the builds in turn at about 9.20 pm, when the load was between 175 and 430, so it is higher than on a quiet machine but the same for every build. The 1% low sits at 30, 20 or 15 because frames land on whole multiples of 16.7 ms.

GPU time per frame rose by about 0.9 ms from build A to build D, about 5 percent. The standing trees added 0.3 to 0.7 ms and the detail round 0.3 to 0.4 ms. The polish rounds and the District page added nothing to the film. Medians at fixed camera positions on each of the seven beats agree, with A at 15.0 ms, B at 15.4 ms, C at 15.8 ms and D at 15.5 ms at loads between 77 and 150.

No single change cost the frames. Build A already spent about 14 ms of the 16.7 ms frame on the GPU, so the two small rises pushed the busiest beats past one frame and the frame rate fell in whole frame steps. The cost is fill. With antialiasing off the frames at four of the beats took 9.8 to 12.4 ms instead of 14 to 19 ms, and an empty frame took 0.8 ms instead of 3.1 ms, so most of the time goes to writing four samples for every pixel the scene covers.

### Where the time goes

Each part was switched off in the current build at all seven beats, with every frame drawn once with the part and once without it in turn, so the load falls on both alike. The table gives the time saved by switching the part off on the medium tier at 1080p. The load was between 40 and 100.

| Part | Saved per frame |
| --- | --- |
| Ground with its shadows | 3.1 to 5.9 ms |
| Backdrop under the ground | 1.5 to 3.0 ms in the close beats and 5 ms in the opening shot |
| Buildings | up to 2.9 ms, of which the window, joint and gravel shading is 0.3 to 1.4 ms |
| Close up ground noise grain and curb shading | 0.4 to 0.9 ms in the close beats and nothing in the wide ones |
| Props together | 0.2 to 0.8 ms |
| Ground lines, crossings, centre lines and pool lanes | up to 0.6 ms |
| Standing trees with their shadows | up to 0.4 ms |
| See through fences and nets | up to 0.4 ms |
| Covers | up to 0.4 ms |
| Shadow pass in all | 0.25 to 0.4 ms |
| Sun path, hour dots, building edges and blobs | within the noise of 0.2 ms |

Nothing in the film renders when nothing moves, no part rebuilds per frame, and the shadow pass stays under half a millisecond. The hour label fade lives only in the yard and writes styles straight to the labels without React state. Turning the shadow sample pattern with one sine and cosine instead of five, and drawing the bottom ground layer with depth instead of stencil, were tried and gave nothing measurable, so they were dropped.

### What changed

- The backdrop under the ground had been a disc drawn under the whole campus and only hidden by the stencil, so it was still rasterized behind every ground pixel. It now has a hole the size of the ground grid, less 4 m so the edges overlap, and it no longer writes depth. It looks the same on every tier.
- Building walls now skip the window, sill, base and joint shading where that shading fades to nothing, on roofs and on walls too far away to show windows, and skip the gravel noise on everything but flat roofs. The output is the same.
- On the medium and low tiers the ground no longer draws its fine noise grain and no longer shades the curb bevels in close views. Paving joints, mowing stripes, lines and shadows stay.

Before and after on the Intel chip at 1080p and 1440 by 900 at 2x, builds in turn.

| Measure | D, current code | After | Load |
| --- | --- | --- | --- |
| 1080p, average, 1% low and slow frames, pass 1 | 43 fps, 30 fps, 163 | 52 fps, 30 fps, 71 | 47 to 56 |
| 1440 by 900 at 2x, pass 1 | 46 fps, 15 fps, 95 | 51 fps, 30 fps, 65 | 47 to 56 |
| 1080p, pass 2 | 50 fps, 30 fps, 101 | 53 fps, 20 fps, 57 | 43 to 54 |
| 1440 by 900 at 2x, pass 2 | 51 fps, 30 fps, 75 | 55 fps, 30 fps, 44 | 43 to 54 |
| GPU per frame over the scroll at 1080p, two passes | 20.8 ms | 18.6 ms | 175 to 430 |
| GPU per frame over the scroll at 1440 by 900 at 2x, two passes | 21.3 ms | 18.0 ms | 175 to 430 |
| GPU per frame over the scroll at 1080p, two more passes | 20.0 and 21.0 ms | 17.9 and 18.7 ms | 33 to 152 |
| GPU per frame at the seven beats, mean of three pairs | 20.0 ms | 18.1 ms | 52 to 85 |
| Busiest beat on medium | 46 calls, 160k tris | 46 calls, 160k tris | any |
| Busiest beat on high | 54 calls, 269k tris | 54 calls, 269k tris | any |

The fixed beat pairs were taken before the medium grain change, which saves another 0.4 to 0.9 ms in the close beats. Slow frames are frames over 20 ms. Every after run had fewer slow frames than the run of D next to it.

### What the medium tier leaves out

Since 2026-11-14 the medium tier draws without antialiasing, shows the detailed tree model only within 70 m and the middle one within 220 m where high uses 150 m and 400 m, both for a 10 m tree on a 1080 pixel tall screen, shows the detailed cars and people only within 40 m where high uses 70 m, and draws tree shadows from the far level. Since 2026-11-13 the medium tier no longer draws the fine noise grain on grass, asphalt, concrete, courts and soil, or the curb bevel shading along paths, courts and patches in close views. It already left out the soft blob under each standing tree, every standing tree past the first 250, the shadows of cars, people, poles, nets, goalposts, sports gear, fences and street furniture, and it draws 140 cars instead of 300 and 70 people instead of 150. Its shadow map is 2048 instead of 3072 and its pixel ratio stops at 1.25. The low tier also leaves out every prop and keeps 150 standing trees.

### Yard and District

`checks/yard-perf.js` opens the yard at Heritage and at Roosevelt High School in Seattle, drags the view around for four seconds, then drags the time slider across the day and back, and reports frames, draw calls and triangles for each. A school link clears the page address once the yard reads it, so the check puts `gpu=low` back on the address, or the searched school would open on the fast chip. `checks/district-perf.js` loads the 48 Frisco schools once, keeps the browser storage and scrubs the District time slider on each screen. Both count draws with a wrapper around every WebGL draw call because those pages have no readout.

GPU time per frame on the medium tier at the opening view and at one turned view, Intel chip at 1920 by 1080, builds in turn, two pairs each.

| Yard | D, current code | After | Calls and triangles | Load |
| --- | --- | --- | --- | --- |
| Heritage | 16.3 ms | 14.1 ms | 39 calls, 110k tris | 34 to 40 |
| Roosevelt High School | 14.1 ms | 13.2 ms | 45 calls, 61k tris | 10 to 37 |

The frame rate runs of the yard check came at loads between 96 and 322. Both builds fell to the low tier while orbiting and gave 23 to 37 fps orbiting and 55 to 57 fps scrubbing the time slider, so those runs show the busy machine and not the site, and the yard still needs a quiet pass.

District with 48 Frisco tiles on the new build, two passes, load 6 to 13. The District page does not use the scene code that changed.

| Screen | Chip | Frames | Average | 1% low | Worst frame | Frames over 20 ms | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920 by 1080 with `gpu=low` | Intel | 494 and 533 | 60 fps | 60 fps | 17 ms | 0 | 7 | 76k |
| 1440 by 900 at 2x with `gpu=low` | Intel | 491 and 494 | 60 fps | 60 fps | 17 and 33 ms | 0 and 2 | 7 | 76k |

### Final scroll test

`checks/scroll-perf.js` on the new production build, two passes in fresh browsers. Pass 1 started at a load of 285 and ended at 100, and pass 2 started at 90 and ended at 52, so the Intel rows and the slowed processor row show the busy machine. The CPU slowed 4 times row fell to the low tier in pass 1.

| Run | Chip | Pass 1 frames, average, 1% low, slow frames | Pass 2 frames, average, 1% low, slow frames | Readout |
| --- | --- | --- | --- | --- |
| Laptop 1920 by 1080 with `gpu=low` | Intel UHD Graphics 630 | 497, 51 fps, 20 fps, 70 | 522, 54 fps, 30 fps, 59 | 46 calls, 160k tris, dpr 1.00, medium |
| Laptop 1440 by 900 at 2x with `gpu=low` | Intel UHD Graphics 630 | 431, 53 fps, 30 fps, 58 | 438, 54 fps, 20 fps, 46 | 46 calls, 160k tris, dpr 1.25, medium |
| Laptop 1920 by 1080 | Radeon Pro 555X | 581, 60 fps, 60 fps, 0 | 581, 60 fps, 60 fps, 0 | 54 calls, 269k tris, dpr 1.00, high |
| Laptop 1440 by 900 at 2x | Radeon Pro 555X | 488, 60 fps, 60 fps, 0 | 488, 60 fps, 60 fps, 0 | 54 calls, 269k tris, dpr 1.50, high |
| Phone 390 by 844 at 3x | Radeon Pro 555X | 460, 60 fps, 60 fps, 0 | 458, 60 fps, 60 fps, 2 | 54 calls, 269k tris, dpr 1.50, high |
| Laptop 1080p with the CPU slowed 4 times | Radeon Pro 555X | 238, 24 fps, 6 fps, 164 | 113, 12 fps, 5 fps, 106 | 46 calls, 160k tris, dpr 1.00 |

`checks/gpu-time.js` on the new build at a load of 50 to 54. The backdrop now has a hole under the ground, so hiding the ground also hides the backdrop that sat under it, and the last column counts both.

| Screen | Chip and tier | p50 and p99 | Shadow and main | Ground and the backdrop under it |
| --- | --- | --- | --- | --- |
| 1920 by 1080 | Intel UHD Graphics 630, medium | 18.8 and 22.5 | 0.33 and 18.2 | 10.8 |
| 1440 by 900 at 2x | Intel UHD Graphics 630, medium | 15.8 and 19.3 | 0.30 and 15.4 | 8.7 |
| 1920 by 1080 | Radeon Pro 555X, high | 5.2 and 6.8 | 1.08 and 4.26 | 2.0 |
| 1440 by 900 at 2x | Radeon Pro 555X, high | 6.5 and 9.7 | 1.05 and 5.58 | 2.5 |

No run of the day had a quiet machine for long enough, so the tables above that were marked as taken under load still wait for a quiet pass, and so do the Intel rows here. The numbers that hold whatever the load are the GPU comparisons taken with the builds in turn, which put the new build 10 to 15 percent under the code before the fixes and 6 to 13 percent under the site before that day.

## Reading the aerial photo

When a US school is picked, `aerial.ts` asks the Planetary Computer index for the newest NAIP photo over the campus, then reads only the tiles under the campus from the 1.2 m overview with range requests. The geotiff reader and the finder load only at that moment, 17 KB and 7 KB gzipped, in the engine worker. The finder takes 0.1 to 0.4 s of worker time on these campuses and 1.1 s on the 1.1 km Allen High School campus. The school waits at most 2.5 s for the photo. After that it shows without the standing trees, the photo keeps loading in the background for up to 60 s, and the trees then appear without changing the time, the tool or the plan.

| School | Photo | Bytes read | Seconds to read |
| --- | --- | --- | --- |
| Heritage High School, Frisco TX | July 2022 | 2.9 MB | 2.3 to 3.4 s |
| Roosevelt High School, Seattle WA | October 2023 | 1.2 MB | 1.8 to 2.9 s |
| Walt Whitman High School, Bethesda MD | October 2023 | 2.8 MB | 2.3 s |
| Desert Vista High School, Phoenix AZ | June 2025 | 3.0 MB | 2.1 s |
| Allen High School, Allen TX | July 2022 | 4.3 MB | 2.5 s |

The photo is read while the weather day loads. Before the merge Roosevelt High School took 15.4 s and 17.0 s from the pick to the model with the photo and 12.9 s with the photo hosts blocked, mostly waiting on map servers that reset connections. After the merge, on 2026-11-13 with another build holding the one minute load between 67 and 101, picking it from the landing page showed its name after 5.5 s and its 54 photo trees after 5.7 s, in 4 map requests, 2 weather requests and 10 photo requests. Opening it again from the browser cache took 1.5 to 2.1 s in four runs at loads between 45 and 190, with no map or photo requests. With every photo request held back 5 s the model showed after 4.9 s without the photo trees and they arrived after 40 s, because the photo reader makes about ten requests one after another. Heritage reads nothing at run time because its trees are baked into the campus file.

## After the merge

On 2026-11-13 the merged build was checked on `astro preview` at 1920 by 1080. The busiest film beat drew 48 calls and 263k triangles on high and 41 calls and 155k triangles on medium, the same as before the merge apart from 1k triangles for the four new trees. The yard at Heritage drew 39 calls and 213k triangles on high and 25 calls and 65k triangles on medium. Ten planned trees raised that to 89 calls and 264k triangles on high and 75 calls and 115k triangles on medium, because each planned tree is still its own set of draw calls.

One scroll pass was taken with the one minute load at 33 at the start and 56 at the end, so it measures the shared machine more than the site. Intel at 1080p gave 352 frames, 36 fps, 20 fps at the 1% low and 211 slow frames, and fell to the low tier. Intel at 1440 by 900 gave 282 frames, 35 fps, 15 fps at the 1% low and 183 slow frames on medium. Radeon at 1080p gave 470 frames, 49 fps, 20 fps at the 1% low and 96 slow frames. Radeon at 1440 by 900 gave 487 frames at 60 fps with 2 slow frames, and the phone size gave 460 frames at 60 fps with none. The run with the processor slowed 4 times gave 175 frames at 18 fps and fell to medium. These rows need to be taken again on a quiet machine before they replace the passes above.

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

After the merge on 2026-11-13 only one run per page was taken, because another build kept the one minute load far above 4 for over an hour. Home scored 73 with an LCP of 2.7 s and 1,098 ms of total blocking time, started at a load of 153. Yard scored 38 with an LCP of 7.0 s, 7,525 ms of total blocking time and a 4.1 s task inside React, started at 93. Plan scored 92 with an LCP of 2.6 s and 270 ms of total blocking time, started at 62. Accessibility stayed at 100 on all three pages. Lighthouse slows the processor 4 times on top of the shared machine, so these runs cannot be compared with the tables above and need to be taken again on a quiet machine. The rebuilt campus file is 73 KB and 14.5 KB gzipped, down from 74 KB and 15.2 KB.

The first live table above was also taken on a busier machine than the local runs, which is why its blocking times are far higher than the local before table for the same build.

Sources was not measured again. On this laptop without throttling the film went live 1.1 s after the page was requested on the local preview, down from 1.6 s for the old build, and going back to the landing page took 0.38 s, down from 0.66 s.

The heat model now runs in a module Web Worker that calls the same engine functions, so its results are byte for byte the same as before. The worker builds the ground grid, the shadow backdrop and the bare day, and also the contact shadows, the rooftop units and the ground mesh data that the main thread used to build while it mounted the scene. The film goes live on the bare day while a second worker computes the sail day and the tree day, and the film switches to them when they arrive. The yard sends each plan change to the worker and drops any answer older than the latest edit. The 3D scene mounts one part per task and compiles its shaders in the background before its first frame. The yard page loads its 3D code after the readout bar has painted. The landing page now picks the film or the stills before the beat images load, so a visitor who gets the film no longer downloads stills it never shows. The two Latin web fonts and the campus file are preloaded. The yard still misses an LCP of 2.5 s because its readout bar waits for 285 KB of fonts, scripts and data in 20 requests on the simulated network.

## What keeps it fast

- The canvas renders on demand. A frame is drawn only when scroll, the pointer, an animation or the model changes something. An idle page draws nothing.
- Tiers set the pixel ratio cap at 1.5, 1.25 or 1, the shadow map at 3072, 2048 or 1024, and props at 300 cars and 150 people, 140 cars and 70 people, or none. Only the high tier draws with 4x antialiasing and the fine noise grain and curb shading on the ground. A chip named Intel starts on medium. A frame rate drop steps down one tier, waits 5 seconds before it can step again, and does nothing if the visitor picked a tier in the footer. A tier change resizes the canvas and the shadow map and rebuilds the props and the model batches. A change between high and medium also builds a new canvas, because antialiasing is fixed when a canvas is made.
- One shadow casting light. Its shadow area follows the view, so close ups get sharp shadows from the same map. Cars, people, poles, nets and goalposts cast shadows only on high. On medium cars keep their contact blobs. Trees cast on every tier, but the shadow pass draws them from a cheaper level than the colour pass, the middle level on high and the far level on medium and low, through a second set of batches on a layer only the shadow camera sees. Leaf shadows keep the alpha test, so they are leaf shaped.
- Props hide when the nearest car would be under 3 pixels long. On the current campus the nearest car is still about 7 pixels in the widest film shots at 1080p, so they stay.
- The ground is one draw call of about 19 thousand vector triangles, so edges stay sharp at any zoom with no large textures. In the film and the yard a stencil test lets each pixel take only its top ground layer, the ground samples the shadow map itself instead of a second full screen shadow plane, and the backdrop only fills pixels the ground left empty. The backdrop has a hole the size of the ground grid, so it is not even rasterized behind the ground, and it writes no depth.
- Close up ground detail sits behind real branches on the pixel footprint. Noise, joints, mowing bands and curb relief run only when a pixel is smaller than the feature, sheen fades out past 0.6 m a pixel, and curb relief strips collapse in the vertex shader once relief can no longer show.
- Building walls skip the window, sill, base and joint shading wherever it fades to nothing, on roofs and on walls too far away to show windows, and skip the gravel noise on everything but flat roofs.
- The heat texture uploads before the frame starts, so it never breaks the render pass.
- The film and yard canvases keep their drawing buffer on devices with a mouse or trackpad, so Chrome does not clear it in a pass of its own. Touch devices keep the browser default because no phone has been measured.
- The shade sail is drawn at near zero size from the first frame, so its shaders compile at load instead of mid scroll.
- Trees, cars, light poles and people are real models in three levels of detail for trees and two for the rest. The near levels of every model that share a material are one batched mesh drawn with one multi draw call, and the far levels are one instanced mesh per model and material, so a whole campus of trees costs about twenty draw calls with their shadows. Each model picks its level and whether it is in view from its distance to the camera, scaled by its size and the screen height, with a 15 percent dead band, and this is worked out again only when the camera has moved 6 percent of the way to the nearest model or turned 3 degrees. Standing trees stay capped per tier. Neighbor buildings are one merged mesh.
- Leaves are alpha cut cards drawn with an alpha test and no blending. Far levels are a small opaque core with a few large cards, so 480 far trees add little fill.
- No allocation inside frame callbacks.
- The heat simulation runs once at load. Scrolling only blends finished results.
- Three.js loads after first paint through a lazy import.
- Geometries, materials and textures are disposed when a scene part is replaced.

## Not measured yet

- A real mid range phone. The phone row above is this laptop at phone size.
- A cold network. All load numbers are from a local server.
- Safari and Firefox frame rates. Firefox has no multi draw extension, so there every level of every model is an instanced mesh instead of a batch. Its film then makes 93 to 113 draw calls a frame on high and 63 to 85 on medium.
- The real models on a slow network. The film and the yard wait for 1.38 MB of models before they show, which adds several seconds on a slow phone connection.
- The yard and District pages on a quiet machine. `checks/yard-perf.js` and `checks/district-perf.js` time them the same way as the film, and the runs above were taken under load.

## District

The District page models up to 48 schools of one city or district on the same hottest day and shows them as clay tiles on one canvas, hottest first, with an ordered list under it. Everything below was measured on 2026-11-13 against the production build on `astro preview` in headless Chrome at 1440 by 900. Other builds kept the one minute load between 5 and 160 for the whole session and it never stayed under 4 for ten minutes, so every row names the load it ran at.

### Three places from a cold cache

Overpass reset every connection from this machine all session, so schools were listed through the Photon fallback and campuses came from the OpenStreetMap API. Seconds count from picking the place in the search list. The photo step reads the full aerial photo for the 12 hottest US schools after every tile has filled.

| Place | Schools found | Shown | First tile | All tiles | Photo step done | Failed schools | Load at start and end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Frisco, Texas | 78 | 48 | 2.3 s | 25.0 s | 63.5 s | 0 | 29 and 15 |
| Tempe, Arizona | 42 | 42 | 2.5 s | 23.3 s | 45.3 s | 0 | 15 and 13 |
| Kelowna, British Columbia | 25 | 25 | 2.2 s | 13.2 s | no photo outside the US | 0 | 13 and 12 |

| Host | Frisco | Tempe | Kelowna |
| --- | --- | --- | --- |
| overpass-api.de | 5 requests, all reset | 5, all reset | 5, all reset |
| photon.komoot.io | 3 requests, 10 KB | 3, 6 KB | 3, 5 KB |
| archive-api.open-meteo.com | 2 requests, 4 KB | 2, 4 KB | 2, 4 KB |
| api.openstreetmap.org | 96 requests, 1.0 MB | 84, 1.4 MB | 50, 0.4 MB |
| planetarycomputer.microsoft.com | 12 requests, 0.3 MB | 12, 0.3 MB | none |
| naipeuwest.blob.core.windows.net | 159 requests, 26.4 MB | 105, 15.5 MB | none |
| All outside hosts | 27.7 MB | 17.2 MB | 0.44 MB |

The page itself added 0.29 MB. At most 2 schools are in flight, and inside the district worker every request waits for the one before it on the same host, so no host ever had two requests open at once in these runs. The weather service was asked once per place. Reopening each place from its link read everything from the browser and filled every tile in 0.3 s with no request to any map, weather or photo host. Summaries and campuses are kept for 30 days.

### Photo step

Reading a coarser overview of the same photo was tried first on five schools. The 2.4 m overview agreed with the full read within 0.8 points on four of them but still took 0.9 to 1.7 MB a school, about 60 MB for 48 schools, because the photo is stored in 512 pixel tiles that must be read whole. The 4.8 m overview cost about 1 MB a school and missed by 2.6 points at Roosevelt High School. The fifth school, Tempe High School, gave no photo with either read. So the page models every school from map data first and then reads the full photo for the 12 hottest schools in the background, never on a connection that reports data saving or a 2g or 3g type. That cost 26.7 MB in Frisco and 15.8 MB in Tempe. A school that already has photo trees in the yard's own cache is modelled from that campus.

### Hand over to the yard and agreement

| School | Photo trees on the tile | Tile | Yard at the same hour | Seconds until the yard showed the name |
| --- | --- | --- | --- | --- |
| William and Abbie Allen Elementary | yes | 51% at 2.30 pm | 51% | 0.6 |
| Lebanon Trail High School | yes | 36% at 2 pm and 6% at 10 am | 36% and 6% | 3.2 |
| Otis Spears Elementary | yes | 25% at 2 pm | 25% | 0.7 |
| Billy Gene Phillips Elementary | no | 20% at 2 pm | 19% | 1.3 |
| Bessie Gunstream Elementary | no | 12% at 2 pm | 11% | 1.6 |

Tiles with photo trees match the yard exactly. The two map only tiles are one point higher because the yard reads the photo after it opens. Going back to the District page picks up that photo campus from the yard's cache and the tile then read 19%.

### Budget and frame rate

Scrubbing the time slider back and forth across the whole day on Frisco with 48 tiles.

| Screen | Chip | Frames | Average | 1% low | Worst frame | Frames over 20 ms | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920 by 1080 with `gpu=low` | Intel | 683 | 60 fps | 60 fps | 17 ms | 0 | 7 | 76k |
| 1440 by 900 at 2x with `gpu=low` | Intel | 582 | 60 fps | 60 fps | 50 ms | 1 | 7 | 76k |
| 1920 by 1080 | Radeon | 481 | 60 fps | 60 fps | 17 ms | 0 | 7 | 76k |
| 1440 by 900 at 2x | Radeon | 485 | 60 fps | 60 fps | 17 ms | 0 | 7 | 76k |

The load was 44 at the start and 19 at the end. Draw calls and triangles count the shadow pass. The slabs and their heat tops are two instanced meshes, all buildings are one batched mesh, and the heat of every tile for every hour sits in one 96 by 96 layered texture, so moving the slider changes one number.

### Load on a slow phone

Lighthouse 13.6 in its default mobile mode. The District page without a place scored 100, 99 and 94 for performance with an LCP of 0.8 s and 70 to 280 ms of total blocking time, and 100 for accessibility on every run, at loads of 9, 11 and 8. Its heading is in the page HTML, and the store, the worker client and the 3D code load only after a place is picked. A run opened straight on Kelowna, which loads the whole district while Lighthouse watches, scored 100 for accessibility and 51 for performance at a load of 58.

Home, yard and plan were measured one after the other against a build of the same code without the District page.

| Page | This build | Same code without District | Script bytes, this build and without |
| --- | --- | --- | --- |
| Home | 74, 67, 69, 84, 70, 67, 71 | 86, 85, 69, 82, 82, 69, 68 | 471 KB and 467 KB |
| Yard | 64, 76, 51 | 63, 57, 58 | 499 KB and 494 KB |
| Plan | 90, 81, 87 | 90, 91, 89 | 129 KB and 127 KB |

The load ranged from 8 to 113 during these runs, so neither build came near the numbers above that were taken under 3. The traces of both builds show the same tasks in the same order. In the second set of home runs, which started with the build without District each time, the pairs came out 84 and 82, 70 and 82, 67 and 69, and 71 and 68. No District code loads on these pages. The few extra kilobytes are Rollup splitting the modules both pages share, such as the search list, the slider and the heat ramp, into chunks of their own.
