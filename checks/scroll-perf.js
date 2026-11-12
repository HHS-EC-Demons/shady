async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const runs = [
    { name: 'laptop 1080p', width: 1920, height: 1080, scale: 1 },
    { name: 'laptop 1080p on the low power chip', width: 1920, height: 1080, scale: 1, query: '&gpu=low' },
    { name: 'laptop retina 1440 by 900 at 2x', width: 1440, height: 900, scale: 2 },
    { name: 'laptop retina 1440 by 900 at 2x on the low power chip', width: 1440, height: 900, scale: 2, query: '&gpu=low' },
    { name: 'phone portrait at 3x', width: 390, height: 844, scale: 3 },
    { name: 'laptop 1080p with CPU slowed 4 times', width: 1920, height: 1080, scale: 1, slow: 4 },
  ];
  const results = [];
  const browser = page.context().browser();
  for (const run of runs) {
    const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, deviceScaleFactor: run.scale });
    const tab = await context.newPage();
    if (run.slow) {
      const session = await context.newCDPSession(tab);
      await session.send('Emulation.setCPUThrottlingRate', { rate: run.slow });
    }
    await tab.goto(`${site}?perf${run.query ?? ''}`);
    await tab.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
    await tab.waitForTimeout(1500);
    const chip = await tab.evaluate(() => {
      const canvas = document.querySelector('.film canvas');
      const gl = canvas ? canvas.getContext('webgl2') : null;
      const info = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    });
    const measured = await tab.evaluate(
      () =>
        new Promise((resolve) => {
          const film = document.querySelector('.film');
          const distance = film.getBoundingClientRect().height - window.innerHeight;
          const speed = 700;
          const frames = [];
          const started = performance.now();
          let last = started;
          const step = (now) => {
            frames.push(now - last);
            last = now;
            const y = ((now - started) / 1000) * speed;
            window.scrollTo(0, Math.min(distance, y));
            if (y < distance + 300) requestAnimationFrame(step);
            else {
              const sorted = frames.slice(2).sort((a, b) => a - b);
              const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
              const slow = sorted[Math.floor(sorted.length * 0.99)];
              resolve({
                frames: sorted.length,
                averageFps: Math.round(1000 / mean),
                onePercentLowFps: Math.round(1000 / slow),
                worstFrameMs: Math.round(sorted[sorted.length - 1]),
                over20ms: sorted.filter((value) => value > 20).length,
                readout: document.querySelector('[data-perf]')?.textContent ?? '',
              });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    results.push({ run: run.name, chip, ...measured });
    await context.close();
  }
  return results;
}
