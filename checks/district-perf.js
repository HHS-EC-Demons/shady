async (page) => {
  const site = 'http://127.0.0.1:4392/';
  const frisco = { kind: 'relation', id: 6579857, name: 'Frisco', place: 'Texas, United States', lat: 33.1505998, lon: -96.8238183, extent: { south: 33.0810976, west: -96.9227866, north: 33.219578, east: -96.7327675 } };
  const address = `${site}district/?place=${encodeURIComponent(JSON.stringify(frisco))}`;
  const runs = [
    { name: 'laptop 1080p on the low power chip', width: 1920, height: 1080, scale: 1, query: '&gpu=low' },
    { name: 'laptop retina 1440 by 900 at 2x on the low power chip', width: 1440, height: 900, scale: 2, query: '&gpu=low' },
    { name: 'laptop 1080p', width: 1920, height: 1080, scale: 1 },
    { name: 'laptop retina 1440 by 900 at 2x', width: 1440, height: 900, scale: 2 },
  ];
  const hook = () => {
    const counts = { calls: 0, tris: 0 };
    window.__draws = [];
    const add = (mode, count, times) => {
      counts.calls += 1;
      if (mode === 4) counts.tris += (count / 3) * times;
    };
    const proto = WebGL2RenderingContext.prototype;
    const drawElements = proto.drawElements;
    proto.drawElements = function (mode, count, type, offset) {
      add(mode, count, 1);
      return drawElements.call(this, mode, count, type, offset);
    };
    const drawArrays = proto.drawArrays;
    proto.drawArrays = function (mode, first, count) {
      add(mode, count, 1);
      return drawArrays.call(this, mode, first, count);
    };
    const drawElementsInstanced = proto.drawElementsInstanced;
    proto.drawElementsInstanced = function (mode, count, type, offset, instances) {
      add(mode, count, instances);
      return drawElementsInstanced.call(this, mode, count, type, offset, instances);
    };
    const drawArraysInstanced = proto.drawArraysInstanced;
    proto.drawArraysInstanced = function (mode, first, count, instances) {
      add(mode, count, instances);
      return drawArraysInstanced.call(this, mode, first, count, instances);
    };
    const getExtension = proto.getExtension;
    proto.getExtension = function (name) {
      const extension = getExtension.call(this, name);
      if (name === 'WEBGL_multi_draw' && extension && !extension.__counted) {
        extension.__counted = true;
        const arrays = extension.multiDrawArraysWEBGL.bind(extension);
        extension.multiDrawArraysWEBGL = (mode, firsts, firstsOffset, counts, countsOffset, drawcount) => {
          let total = 0;
          for (let index = 0; index < drawcount; index += 1) total += counts[countsOffset + index];
          add(mode, total, 1);
          return arrays(mode, firsts, firstsOffset, counts, countsOffset, drawcount);
        };
        const elements = extension.multiDrawElementsWEBGL.bind(extension);
        extension.multiDrawElementsWEBGL = (mode, counts, countsOffset, type, offsets, offsetsOffset, drawcount) => {
          let total = 0;
          for (let index = 0; index < drawcount; index += 1) total += counts[countsOffset + index];
          add(mode, total, 1);
          return elements(mode, counts, countsOffset, type, offsets, offsetsOffset, drawcount);
        };
      }
      return extension;
    };
    const tick = () => {
      if (counts.calls > 0) window.__draws.push({ calls: counts.calls, tris: Math.round(counts.tris) });
      counts.calls = 0;
      counts.tris = 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const settled = (tab) => tab.waitForFunction(() => ['done', 'failed'].includes(document.querySelector('[data-phase]')?.dataset.phase), null, { timeout: 240000 });
  const browser = page.context().browser();
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const warm = await first.newPage();
  await warm.goto(address);
  await settled(warm);
  await warm.waitForTimeout(3000);
  const tiles = await warm.evaluate(() => document.querySelectorAll('li[data-status=done]').length);
  const state = await first.storageState({ indexedDB: true });
  await first.close();
  const results = [];
  for (const run of runs) {
    const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, deviceScaleFactor: run.scale, storageState: state });
    await context.addInitScript(hook);
    const tab = await context.newPage();
    await tab.goto(address + (run.query ?? ''));
    await settled(tab);
    await tab.waitForTimeout(3000);
    const chip = await tab.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    });
    const slider = tab.locator('[data-slot=slider]').filter({ has: tab.getByRole('slider', { name: 'Time of day' }) });
    const thumb = await slider.getByRole('slider', { name: 'Time of day' }).boundingBox();
    const track = await slider.locator('[data-slot=slider-track]').boundingBox();
    await tab.evaluate(() => {
      window.__draws = [];
      window.__gaps = [];
      let last = performance.now();
      const loop = (now) => {
        window.__gaps.push(now - last);
        last = now;
        if (!window.__stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await tab.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await tab.mouse.down();
    for (let step = 0; step <= 240; step += 1) {
      const share = step <= 120 ? 1 - step / 120 : (step - 120) / 120;
      await tab.mouse.move(track.x + track.width * share, thumb.y + thumb.height / 2);
      await tab.waitForTimeout(16);
    }
    await tab.mouse.up();
    const measured = await tab.evaluate(() => {
      window.__stop = true;
      const gaps = window.__gaps.slice(2).sort((a, b) => a - b);
      const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      const draws = window.__draws;
      return {
        frames: gaps.length,
        averageFps: Math.round(1000 / mean),
        onePercentLowFps: Math.round(1000 / gaps[Math.floor(gaps.length * 0.99)]),
        worstFrameMs: Math.round(gaps[gaps.length - 1]),
        over20ms: gaps.filter((gap) => gap > 20).length,
        drawn: draws.length,
        calls: draws.length ? Math.max(...draws.map((item) => item.calls)) : 0,
        ktris: draws.length ? Math.round(Math.max(...draws.map((item) => item.tris)) / 1000) : 0,
      };
    });
    results.push({ run: run.name, chip, tiles, ...measured });
    await context.close();
  }
  return results;
}
