// Connection check (src/net/diag.ts) and net.json / URL-parameter handling (src/net/netconfig.ts).
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 20000, step = 200) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
};
const IP4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const IP6 = /[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,}/i;

/** A page with its own context, where `/net.json` can be stubbed and RTCPeerConnection configs are recorded. */
async function open(env, name, { netJson, extra = '', lang = 'en' } = {}) {
  const ctx = await env.browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
  await ctx.addInitScript(
    ([name, lang]) => {
      localStorage.setItem('nullvault.settings.v1', JSON.stringify({ name, quality: 'low', lang, color: 1, music: 0 }));
      window.__nvNoTune = true;
      window.__nvNoPause = true;
      window.__nvRenderSkip = 12;
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s) => void (window.__copied = s) } });
      window.__pcs = [];
      const Orig = window.RTCPeerConnection;
      window.RTCPeerConnection = function (cfg, ...r) {
        const pc = new Orig(cfg, ...r);
        const rec = { cfg: JSON.parse(JSON.stringify(cfg ?? {})), data: false, media: false };
        window.__pcs.push(rec);
        const cdc = pc.createDataChannel.bind(pc);
        pc.createDataChannel = (...a) => ((rec.data = true), cdc(...a));
        const at = pc.addTrack.bind(pc);
        pc.addTrack = (...a) => ((rec.media = true), at(...a));
        return pc;
      };
      window.RTCPeerConnection.prototype = Orig.prototype;
    },
    [name, lang],
  );
  await ctx.route('**/net.json', (route) =>
    netJson === undefined ? route.fulfill({ status: 404, body: 'nope' }) : route.fulfill({ status: 200, contentType: 'application/json', body: typeof netJson === 'string' ? netJson : JSON.stringify(netJson) }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.errors = errors;
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/net\.json|404/.test(m.text()) && errors.push('console: ' + m.text()));
  await page.goto(env.base + extra);
  await page.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  return page;
}

const env = await startServers({ port: 5581, sigPort: 9581 });
try {
  // ---------------------------------------------------------------- connection check, both languages
  for (const lang of ['en', 'de']) {
    const p = await open(env, 'Diag' + lang, { lang });
    check(`[${lang}] translations complete`, (await p.evaluate(() => window.__nv.missingTranslations())).length === 0, JSON.stringify(await p.evaluate(() => window.__nv.missingTranslations())));
    const btnText = lang === 'de' ? 'Verbindung testen' : 'Test connection';
    await p.getByRole('button', { name: btnText }).click();
    const done = await until(() => p.evaluate(() => document.querySelector('.nd-panel')?.dataset.state === 'done'), 40000);
    check(`[${lang}] check runs to a verdict`, !!done);
    const info = await p.evaluate(() => ({ r: window.__nvDiag?.result, rep: window.__nvDiag?.report, verdicts: [...document.querySelectorAll('.nd-v')].map((e) => e.textContent), steps: [...document.querySelectorAll('.nd-step')].map((e) => e.className) }));
    check(`[${lang}] host candidates found`, (info.r?.ice.host ?? 0) > 0, JSON.stringify(info.r?.ice));
    check(`[${lang}] signalling reached`, info.r?.signal.ok === true, JSON.stringify(info.r?.signal));
    check(`[${lang}] microphone live`, info.r?.mic.state === 'ok', JSON.stringify(info.r?.mic));
    check(`[${lang}] WebGL reported`, info.r?.gl.ok === true && info.r.gl.renderer.length > 0, info.r?.gl.renderer);
    check(`[${lang}] verdict lines shown`, info.verdicts.length >= 2 && info.steps.every((c) => !c.includes('run')), info.verdicts.join(' | '));
    check(`[${lang}] verdict says no relay set up`, info.verdicts.some((v) => (lang === 'de' ? /Kein Relay|Testmodus/ : /No relay|Test mode/).test(v)));
    await p.getByRole('button', { name: lang === 'de' ? 'Kopieren' : 'Copy' }).click();
    const copied = await until(() => p.evaluate(() => window.__copied));
    check(`[${lang}] report copied`, typeof copied === 'string' && copied.length > 40, String(copied).split('\n').length + ' lines');
    check(`[${lang}] report has no IP-looking strings`, !IP4.test(copied) && !IP6.test(copied), copied);
    check(`[${lang}] report in the right language`, lang === 'de' ? /Verbindungstest/.test(copied) : /Connection check/.test(copied));
    if (lang === 'en') console.log(copied);
    check(`[${lang}] no page errors`, p.errors.length === 0, p.errors.join('; '));
    await p.context().close();
  }

  // ---------------------------------------------------------------- net.json reaches data AND voice
  const cfg = {
    iceServers: [
      { urls: 'stun:127.0.0.1:3999' },
      { urls: ['turn:127.0.0.1:3998?transport=udp', 'turn:127.0.0.1:3998?transport=tcp'], username: 'u', credential: 'c' },
      { urls: 'http://not-ice' }, // invalid: dropped
    ],
    peer: { host: 'ignored.invalid', port: 1 }, // ?signal=local wins over it
  };
  const host = await open(env, 'Host', { netJson: cfg });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player));
  const code = await host.evaluate(() => window.__nv.session.code);
  const guest = await open(env, 'Guest', { netJson: cfg });
  await guest.evaluate((c) => window.__nv.start(c), code);
  const joined = await until(() => guest.evaluate(() => window.__nv.session?.players.size === 2), 60000);
  check('guest joined with configured ICE servers', !!joined);
  const voiceUp = await until(async () => (await Promise.all([host, guest].map((p) => p.evaluate(() => window.__nv.voice?.connectedCount() ?? 0)))).every((n) => n >= 1), 60000);
  check('voice link established', !!voiceUp);
  for (const [nm, p] of [['host', host], ['guest', guest]]) {
    // PeerJS builds one throw-away connection with its own default config to probe browser features (no offer, no traffic)
    const pcs = (await p.evaluate(() => window.__pcs)).filter((x) => !JSON.stringify(x.cfg).includes('peerjs.com'));
    const want = (c) => {
      const flat = (c.iceServers ?? []).flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
      return flat.includes('stun:127.0.0.1:3999') && flat.includes('turn:127.0.0.1:3998?transport=tcp') && !flat.some((u) => u.startsWith('http')) && c.iceServers.some((s) => s.username === 'u' && s.credential === 'c');
    };
    const data = pcs.filter((x) => !x.media); // the answering side never calls createDataChannel
    const media = pcs.filter((x) => x.media);
    check(`${nm}: data connection uses net.json ICE servers`, data.length > 0 && data.every((x) => want(x.cfg)), `${data.length} pcs`);
    check(`${nm}: voice connection uses net.json ICE servers`, media.length > 0 && media.every((x) => want(x.cfg)), `${media.length} pcs`);
    check(`${nm}: built-in test mode keeps no public STUN`, pcs.every((x) => !JSON.stringify(x.cfg).includes('google.com')));
  }
  // crew-list note: no "kein Ton" while voice works
  const note = await host.evaluate(() => document.querySelectorAll('.nd-novoice').length);
  check('no "no sound" note while voice works', note === 0);
  // force the note: pretend the voice of the guest never came up
  const forced = await host.evaluate(() => {
    const v = window.__nv.voice;
    const pid = [...window.__nv.session.players.keys()].find((k) => k !== window.__nv.session.pid);
    return v.noVoice(pid, -1) === false && v.noVoice(pid, 0) === false;
  });
  check('noVoice false for a player whose voice plays', forced);
  check('no page errors (host, guest)', host.errors.length + guest.errors.length === 0, [...host.errors, ...guest.errors].join('; '));
  await host.context().close();
  await guest.context().close();

  // ---------------------------------------------------------------- invalid / missing net.json, URL parameters
  const bad = await open(env, 'Bad', { netJson: '{ this is not json' });
  check('invalid net.json: boots with defaults, no error', bad.errors.length === 0 && (await bad.evaluate(() => !!window.__nv.ui)));
  await bad.context().close();
  const miss = await open(env, 'Miss', { extra: '&turn=turn:127.0.0.1:3997&turnuser=a&turnpass=b&relay=1' });
  await miss.getByRole('button', { name: 'Test connection' }).click();
  await until(() => miss.evaluate(() => document.querySelector('.nd-panel')?.dataset.state === 'done'), 40000);
  const mpcs = await miss.evaluate(() => window.__pcs.filter((x) => x.data));
  const last = mpcs[mpcs.length - 1]?.cfg;
  check('?turn= adds one TURN server', !!last && last.iceServers.length === 1 && last.iceServers[0].urls === 'turn:127.0.0.1:3997' && last.iceServers[0].username === 'a' && last.iceServers[0].credential === 'b', JSON.stringify(last));
  check('?relay=1 forces iceTransportPolicy relay', last?.iceTransportPolicy === 'relay');
  const mv = await miss.evaluate(() => window.__nvDiag?.verdicts.map((v) => v.key));
  check('unreachable relay is reported', !!mv?.includes('nd.v.relayForcedFail'), JSON.stringify(mv));
  await miss.context().close();
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
