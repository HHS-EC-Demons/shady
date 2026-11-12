async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const out = 'site/public/beats/';
  const names = ['open', 'heat', 'walk', 'sail', 'plant', 'time', 'yours'];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(site);
  await page.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
  await page.addStyleTag({ content: '.film-beats, header { visibility: hidden !important; } .film-poster { display: none !important; }' });
  for (let beat = 0; beat < names.length; beat += 1) {
    await page.evaluate((index) => window.scrollTo({ top: index * window.innerHeight, behavior: 'instant' }), beat);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${out}${names[beat]}.jpg`, type: 'jpeg', quality: 80 });
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(2200);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '.film-beats, header { visibility: visible !important; }' });
  await page.screenshot({ path: 'site/public/og.png' });
  return names;
}
