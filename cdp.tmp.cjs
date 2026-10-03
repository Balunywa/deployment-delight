const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = b.contexts()[0].pages()[0]; const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 150)));
  p.on('response', r => { if (r.status() >= 500) errs.push(r.status() + ' ' + r.url()); });
  const origin = new URL(p.url()).origin; console.log('window at', p.url(), '| size', JSON.stringify(await p.evaluate(() => [innerWidth, innerHeight])));
  for (const u of ['/', '/customers/onboard', '/engagements', '/settings']) {
    await p.goto(origin + u, { waitUntil: 'load' }); await p.waitForTimeout(3000);
    console.log(u, '|', (await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  }
  await p.goto(origin + '/customers/onboard', { waitUntil: 'load' }); await p.waitForTimeout(4000);
  await p.screenshot({ path: process.env.TEMP + '/cd-app-onboard.png' });
  await p.goto(origin + '/settings', { waitUntil: 'load' }); await p.waitForTimeout(3000);
  await p.locator('section', { hasText: 'Team space' }).first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: process.env.TEMP + '/cd-app-settings.png' });
  await p.goto(origin + '/', { waitUntil: 'load' }); await p.waitForTimeout(2000);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})().catch(e => { console.log('FAILED', e.message.split('\n')[0]); process.exit(1); });
