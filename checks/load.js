async (page) => {
  const site = 'http://127.0.0.1:4393/';
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  await tab.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await tab.goto(site, { waitUntil: 'load' });
  const first = await tab.evaluate(() => {
    const scripts = performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('.js'));
    return {
      lcpMs: Math.round(window.__lcp),
      firstPaintMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
      scriptsAtLoad: scripts.map((entry) => [entry.name.split('/').pop(), entry.encodedBodySize]),
      headingVisible: document.querySelector('h1').getBoundingClientRect().height > 0,
    };
  });
  await tab.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
  const live = await tab.evaluate(() => {
    const scripts = performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('.js'));
    return {
      liveAtMs: Math.round(performance.now()),
      allScriptBytes: scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      scripts: scripts.length,
      lcpMs: Math.round(window.__lcp),
    };
  });
  await context.close();
  return { first, live };
}
