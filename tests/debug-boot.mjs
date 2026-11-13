import { startServers, sleep } from './harness.mjs';
const env = await startServers();
try {
  const ctx = await env.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { localStorage.setItem('nullvault.settings.v1', JSON.stringify({ name: 'Mert', quality: 'high', lang: 'en', color: 1, music: 0.2 })); window.__nvNoTune = true; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
  page.on('console', (m) => console.log(m.type(), m.text().slice(0, 300)));
  page.on('requestfailed', (r) => console.log('reqfailed', r.url(), r.failure()?.errorText));
  await page.goto(env.base);
  for (let i = 0; i < 9; i++) {
    await sleep(4000);
    const r = await Promise.race([page.evaluate(() => ({ nv: !!window.__nv, boot: !!document.querySelector('.boot'), canvas: !!document.querySelector('canvas') })), sleep(3000).then(() => 'BLOCKED')]);
    console.log(i, JSON.stringify(r));
  }
} finally {
  await env.stop();
}
process.exit(0);
