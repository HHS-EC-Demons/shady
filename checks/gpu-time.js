async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const screens = [
    { name: 'laptop 1080p on the low power chip', width: 1920, height: 1080, scale: 1, query: '&gpu=low', tier: 'medium' },
    { name: 'laptop retina 1440 by 900 at 2x on the low power chip', width: 1440, height: 900, scale: 2, query: '&gpu=low', tier: 'medium' },
    { name: 'laptop 1080p', width: 1920, height: 1080, scale: 1, tier: 'high' },
    { name: 'laptop retina 1440 by 900 at 2x', width: 1440, height: 900, scale: 2, tier: 'high' },
  ];
  const hides = ['', 'ground,shade'];
  const runs = screens.flatMap((screen) => hides.map((hide) => ({ ...screen, hide })));
  const results = [];
  const browser = page.context().browser();
  for (const run of runs) {
    const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, deviceScaleFactor: run.scale });
    await context.addInitScript((value) => window.localStorage.setItem('shady.quality', value), run.tier);
    const tab = await context.newPage();
    await tab.goto(`${site}?perf=gpu${run.query ?? ''}${run.hide ? `&hide=${run.hide}` : ''}`);
    await tab.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
    await tab.waitForTimeout(1500);
    const read = () => tab.evaluate(() => JSON.parse(document.querySelector('[data-perf]')?.dataset.gpu ?? '{"frames":0,"lost":0,"parts":{},"perFrame":[],"shadowPerFrame":[]}'));
    const before = await read();
    const frameTimes = await tab.evaluate(
      () =>
        new Promise((resolve) => {
          const film = document.querySelector('.film');
          const distance = film.getBoundingClientRect().height - window.innerHeight;
          const frames = [];
          const started = performance.now();
          let last = started;
          const step = (now) => {
            frames.push(now - last);
            last = now;
            const y = ((now - started) / 1000) * 700;
            window.scrollTo(0, Math.min(distance, y));
            if (y < distance + 300) requestAnimationFrame(step);
            else resolve(frames.slice(2));
          };
          requestAnimationFrame(step);
        }),
    );
    await tab.waitForTimeout(600);
    const after = await read();
    const readout = await tab.evaluate(() => document.querySelector('[data-perf]')?.textContent ?? '');
    const frames = Math.max(1, after.frames - before.frames);
    const round = (value) => Math.round(value * 100) / 100;
    const passes = {};
    for (const [key, value] of Object.entries(after.parts)) {
      const old = before.parts[key] ?? { ms: 0, calls: 0, tris: 0 };
      const [pass, part] = key.split(':');
      passes[pass] ??= { ms: 0, calls: 0, ktris: 0, parts: {} };
      if (!part) passes[pass].ms = round((value.ms - old.ms) / frames);
      else {
        const calls = Math.round((value.calls - old.calls) / frames);
        const ktris = Math.round((value.tris - old.tris) / frames / 100) / 10;
        passes[pass].calls += calls;
        passes[pass].ktris = Math.round((passes[pass].ktris + ktris) * 10) / 10;
        passes[pass].parts[part] = `${calls} calls, ${ktris}k tris`;
      }
    }
    const gpu = after.perFrame.slice(before.perFrame.length).sort((a, b) => a - b);
    const shadows = after.shadowPerFrame.slice(before.shadowPerFrame.length).sort((a, b) => a - b);
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    results.push({
      run: run.name + (run.hide ? `, ${run.hide} hidden` : ''),
      readout,
      averageFps: Math.round(1000 / mean),
      onePercentLowFps: Math.round(1000 / sorted[Math.floor(sorted.length * 0.99)]),
      gpuFrames: after.frames - before.frames,
      lost: after.lost - before.lost,
      gpuMsP50: round(gpu[Math.floor(gpu.length * 0.5)] ?? 0),
      gpuMsP99: round(gpu[Math.floor(gpu.length * 0.99)] ?? 0),
      shadowMsP99: round(shadows[Math.floor(shadows.length * 0.99)] ?? 0),
      ...passes,
    });
    await context.close();
  }
  return results;
}
