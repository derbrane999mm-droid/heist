// Two players: screenshots of another player's avatar, the pause menu (German) and the blackout aftermath.
import { startServers, openPlayer, sleep, OUT } from './harness.mjs';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });
const env = await startServers({ port: 5190, sigPort: 9012 });
try {
  const host = await openPlayer(env, { name: 'Mert', quality: 'high', renderSkip: 60 });
  const shot = async (file) => {
    await host.evaluate(() => (window.__nvRenderSkip = 0));
    await sleep(8000);
    await host.screenshot({ path: `${OUT}/${file}` });
    await host.evaluate(() => (window.__nvRenderSkip = 60));
  };
  await host.evaluate(() => window.__nv.start(null));
  await host.waitForFunction(() => window.__nv.player !== null, null, { timeout: 60000 });
  const code = await host.evaluate(() => window.__nv.session.code);
  const guest = await openPlayer(env, { name: 'Jonas', quality: 'low', width: 480, height: 270, renderSkip: 10 });
  await guest.evaluate((c) => window.__nv.start(c), code);
  await guest.waitForFunction(() => window.__nv.player !== null, null, { timeout: 150000 });
  // guest stands by the table, facing the host, flashlight on
  await guest.evaluate(() => { window.__nv.tp(-1.6, 0, 1.2, -2.2, 0); window.__nv.input.debugSet('KeyF', true); });
  await sleep(600);
  await guest.evaluate(() => window.__nv.input.debugSet('KeyF', false));
  await host.evaluate(() => window.__nv.tp(0.6, 0, 3.4, 0.75, -0.06));
  await sleep(2500);
  await shot('crew-avatar.png');
  console.log('shot avatar');

  // solve the puzzle straight away, take the kit, wait for the blackout, look at the custodian
  await host.evaluate(() => {
    const s = window.__nv.session;
    const t = s.state.tut;
    for (const d of t.order.map((c) => t.code[c])) window.__nv.interactions.debugUse('key-' + d);
  });
  await sleep(6000);
  await host.evaluate(() => window.__nv.tp(-7.6, 0, 0, Math.PI / 2, 0));
  await shot('crew-vault-open.png');
  console.log('shot vault open');
  await host.evaluate(() => window.__nv.interactions.debugUse('kit'));
  await host.evaluate(() => window.__nv.tp(-8.4, 0, 0, -Math.PI / 2, 0.03)); // turn around, back to the vault
  await host.waitForFunction(() => window.__nv.session.state.tut.moved === true, null, { timeout: 40000 });
  await sleep(5000);
  await shot('crew-custodian-moved.png');
  console.log('shot custodian moved');

  // pause menu + settings in German
  await host.evaluate(() => {
    const ui = window.__nv.ui;
    localStorage.setItem('x', '1');
    ui.showMenu('pause');
  });
  await host.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => /settings/i.test(b.textContent))?.click());
  await host.evaluate(() => [...document.querySelectorAll('.seg button')].find((b) => b.textContent === 'Deutsch')?.click());
  await shot('crew-settings-de.png');
  console.log('errors', host.errors, guest.errors);
} finally {
  await env.stop();
}
process.exit(0);
