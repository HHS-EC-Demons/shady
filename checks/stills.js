async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const out = 'site/public/';
  const names = ['open', 'heat', 'walk', 'sail', 'plant', 'time', 'yours'];
  const hide = '.film-beats, header { visibility: hidden !important; } .film-poster { display: none !important; }';
  const open = async (tab) => {
    await tab.goto(site, { timeout: 120000 });
    await tab.waitForFunction(() => document.querySelector('.film').dataset.mode === 'live', null, { timeout: 120000 });
    await tab.addStyleTag({ content: hide });
  };
  const visit = async (tab, beat) => {
    await tab.evaluate((index) => window.scrollTo({ top: index * window.innerHeight, behavior: 'instant' }), beat);
    await tab.waitForTimeout(2200);
  };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  for (let beat = 0; beat < names.length; beat += 1) {
    await visit(page, beat);
    await page.screenshot({ path: `${out}beats/${names[beat]}.jpg`, type: 'jpeg', quality: 80 });
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(2200);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: '.film-beats, header { visibility: visible !important; }' });
  await page.screenshot({ path: `${out}og.png` });
  const phone = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const tab = await phone.newPage();
  const tall = [];
  try {
    await open(tab);
    for (let beat = 0; beat < names.length; beat += 1) {
      await visit(tab, beat);
      let quality = 85;
      let shot = await tab.screenshot({ path: `${out}beats/${names[beat]}-tall.jpg`, type: 'jpeg', quality });
      while (shot.length >= 110000 && quality > 40) {
        quality -= 5;
        shot = await tab.screenshot({ path: `${out}beats/${names[beat]}-tall.jpg`, type: 'jpeg', quality });
      }
      tall.push([names[beat], quality, shot.length]);
    }
  } finally {
    await phone.close();
  }
  return { wide: names, tall };
}
