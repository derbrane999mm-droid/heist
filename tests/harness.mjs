// Shared test harness: local signalling server + Vite dev server + headless Chrome.
import { chromium } from 'playwright-core';
import { PeerServer } from 'peer';
import { createServer, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(root, 'test-out');

/** Local Chrome. NV_CHROME overrides the path. */
function chromePath() {
  if (process.env.NV_CHROME) return process.env.NV_CHROME;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  }[process.platform] ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found. Set NV_CHROME to the browser executable.');
  return found;
}

/** Real GPU by default. NV_SOFTWARE=1 forces software rendering (machines without a GPU). */
function gpuArgs() {
  if (process.env.NV_SOFTWARE) return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const args = ['--enable-gpu', '--ignore-gpu-blocklist'];
  if (process.platform === 'darwin') args.push('--use-angle=metal');
  return args;
}

export async function startServers({ port = 5188, sigPort = 9010 } = {}) {
  const ps = PeerServer({ port: sigPort, path: '/', host: '127.0.0.1' });
  // NV_DIST=1 tests the production build in dist/ instead of the dev server
  const vite = process.env.NV_DIST
    ? await preview({ root, preview: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' })
    : // No file watcher and no hot reload: a source file edited while a test runs (by a person or by another
      // agent) must not reload the test's pages. Own dependency cache per port, so servers started at the
      // same moment do not rewrite one shared cache.
      await createServer({ root, cacheDir: path.join(root, 'node_modules', '.vite-test', String(port)), server: { port, host: '127.0.0.1', strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
  if (!process.env.NV_DIST) await vite.listen();
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: !process.env.NV_HEADED,
    args: [
      ...gpuArgs(),
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
