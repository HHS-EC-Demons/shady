async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  const session = await context.newCDPSession(tab);
  await tab.goto(site);
  await tab.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
  await tab.waitForTimeout(1500);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 500 });
  await session.send('Profiler.start');
  await tab.evaluate(
    () =>
      new Promise((resolve) => {
        const film = document.querySelector('.film');
        const distance = film.getBoundingClientRect().height - window.innerHeight;
        const started = performance.now();
        const step = (now) => {
          const y = ((now - started) / 1000) * 700;
          window.scrollTo(0, Math.min(distance, y));
          if (y < distance + 200) requestAnimationFrame(step);
          else resolve(true);
        };
        requestAnimationFrame(step);
      }),
  );
  const { profile } = await session.send('Profiler.stop');
  await context.close();
  const self = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const deltas = profile.timeDeltas;
  profile.samples.forEach((id, index) => {
    const node = byId.get(id);
    const frame = node.callFrame;
    const file = frame.url.split('/').pop().split('?')[0];
    const key = `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0));
  });
  const total = (profile.endTime - profile.startTime) / 1000;
  const top = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 22)
    .map(([key, micros]) => `${Math.round(micros / 1000)} ms  ${key}`);
  return { totalMs: Math.round(total), top };
}
