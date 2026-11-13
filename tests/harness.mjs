// Shared test harness: local signalling server + Vite dev server + headless Chrome.
import { chromium } from 'playwright-core';
import { PeerServer } from 'peer';
import { createServer, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(root, 'test-out');

export async function startServers({ port = 5188, sigPort = 9010 } = {}) {
  const ps = PeerServer({ port: sigPort, path: '/', host: '127.0.0.1' });
  // NV_DIST=1 tests the production build in dist/ instead of the dev server
  const vite = process.env.NV_DIST
    ? await preview({ root, preview: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' })
    : await createServer({ root, server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
  if (!process.env.NV_DIST) await vite.listen();
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const base = `http://127.0.0.1:${port}/?signal=local&sigport=${sigPort}`;
  return {
    browser,
    base,
    async stop() {
      await browser.close();
      await (vite.close ? vite.close() : new Promise((r) => vite.httpServer.close(r)));
      try { ps.close?.(); } catch {}
    },
  };
}

/** Open the game in a fresh browser context (own storage = own player). */
export async function openPlayer(env, { name, quality = 'low', lang = 'en', width = 1280, height = 720, extra = '', noPause = true, renderSkip = 0, lineupFast = false } = {}) {
  const ctx = await env.browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(
    ([name, quality, lang, noPause, renderSkip, lineupFast]) => {
      localStorage.setItem('nullvault.settings.v1', JSON.stringify({ name, quality, lang, color: Math.floor(Math.random() * 6), music: 0.2 }));
      window.__nvNoTune = true;
      window.__nvNoPause = noPause;
      window.__nvRenderSkip = renderSkip;
      window.__nvLineupFast = lineupFast;
    },
    [name, quality, lang, noPause, renderSkip, lineupFast],
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
    if (process.env.NV_DEBUG) console.log(`[${name}] ${m.type()}: ${m.text()}`);
  });
  await page.goto(env.base + extra);
  page.errors = errors;
  try {
    await page.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  } catch (e) {
    console.log('BOOT FAILED', errors);
    throw e;
  }
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
