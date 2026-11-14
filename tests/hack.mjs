// Hacking terminals (calib level "hack"): host + client, then a late joiner.
// Run: node tests/hack.mjs
import { startServers, openPlayer, sleep } from './harness.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 30000, step = 250) => {
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hackState = (page) => page.evaluate(() => window.__nv.session?.state?.hack ?? null);
const st = (page, id) => page.evaluate((id) => window.__nv.session?.state?.hack?.[id] ?? null, id);
const view = (page, term) => page.evaluate((term) => window.__nv.level.hack.view(term), term);
const overlay = (page) => page.evaluate(() => window.__nv.level.hack.overlay());
const use = (page, id) => page.evaluate((id) => window.__nv.interactions.debugUse(id), id);
const intent = (page, args) => page.evaluate((a) => window.__nv.session.intent('hack.move', a), args);
const pos = (page) => page.evaluate(() => window.__nv.player.position.toArray());
/** One key press. Press and release in one go: the game sees the press on its next frame, and nothing repeats. */
const tap = (page, code) =>
  page.evaluate((c) => {
    window.__nv.input.debugSet(c, true);
    window.__nv.input.debugSet(c, false);
  }, code);
const hold = async (page, code, ms) => {
  await page.evaluate((c) => window.__nv.input.debugSet(c, true), code);
  await sleep(ms);
  await page.evaluate((c) => window.__nv.input.debugSet(c, false), code);
  await sleep(200);
};

const env = await startServers({ port: 5240, sigPort: 9240 });
const opt = { width: 420, height: 240, quality: 'low', renderSkip: 12, extra: '&level=hack&diff=1' };
try {
  const host = await openPlayer(env, { ...opt, name: 'Host' });
  await host.evaluate(() => window.__nv.start(null));
  await until(() => host.evaluate(() => !!window.__nv.player));
  const code = await host.evaluate(() => window.__nv.session.code);
  const cli = await openPlayer(env, { ...opt, name: 'Anna', lang: 'de' });
  await cli.evaluate((c) => window.__nv.start(c), code);
  await until(async () => (await host.evaluate(() => window.__nv.session.players.size)) === 2 && (await cli.evaluate(() => window.__nv.session?.players.size ?? 0)) === 2, 90000);
  await until(() => cli.evaluate(() => !!window.__nv.player), 60000);
  const cliPid = await cli.evaluate(() => window.__nv.session.pid);
  const hostPid = await host.evaluate(() => window.__nv.session.pid);

  /** Teleport a player in front of a terminal and wait until the host knows they are there. */
  const goTo = async (page, pid, term) => {
    await page.evaluate((term) => window.__nv.tp(...window.__nv.level.hack.stand(term)), term);
    return until(() =>
      host.evaluate(
        ([pid, term]) => {
          const p = window.__nv.session.poseOf(pid);
          const s = window.__nv.level.hack.stand(term);
          return !!p && Math.hypot(p.x - s[0], p.z - s[2]) < 0.6;
        },
        [pid, term],
      ),
    );
  };
  const openAt = async (page, pid, term) => {
    await goTo(page, pid, term);
    const ok = await use(page, term);
    await sleep(700); // the key that opened it is swallowed for one frame
    return ok;
  };

  // ---- same puzzle on both peers
  const h0 = await hackState(host);
  const c0 = await until(async () => {
    const c = await hackState(cli);
    return c && same(c, await hackState(host)) ? c : false;
  });
  check('level "hack" is registered and builds three stations', !!h0 && same(Object.keys(h0).sort(), ['cipher', 'signal', 'trace']));
  check('difficulty 1 from the URL: 4x4 trace, 2 dials, 3 symbols', h0.trace.n === 4 && h0.trace.ice.length === 2 && h0.signal.dials.length === 2 && h0.cipher.code.length === 3 && h0.cipher.symbols.length === 6);
  check('host and client hold the same puzzle state', !!c0);
  const obj0 = await cli.evaluate(() => window.__nv.level.objective());
  check('objective counts the systems (German client)', obj0.length === 3 && obj0[0].includes('0/3') && obj0[1].includes('TRACE') && obj0[1].includes('CIPHER'), obj0[0]);

  // ---- split information: each terminal view only holds its own half
  const v = {};
  for (const term of ['hack-trace-a', 'hack-trace-b', 'hack-signal-a', 'hack-signal-b', 'hack-cipher-a', 'hack-cipher-b']) v[term] = await view(cli, term);
  check('trace: router view has the tiles, never the ICE', Array.isArray(v['hack-trace-a'].tiles) && !JSON.stringify(v['hack-trace-a']).includes('ice') && !('hit' in v['hack-trace-a']));
  check('trace: ICE map has the ICE, never the tiles', same(v['hack-trace-b'].ice, h0.trace.ice) && !('tiles' in v['hack-trace-b']) && !('rot' in v['hack-trace-b']));
  check('signal: tuner view has the dials, never the target', Array.isArray(v['hack-signal-a'].dials) && !('tgt' in v['hack-signal-a']) && !('match' in v['hack-signal-a']));
  check('signal: scope has the target wave', typeof v['hack-signal-b'].tgt?.f === 'number' && !('dials' in v['hack-signal-b']));
  check('cipher: keypad view has the code, never the table', same(v['hack-cipher-a'].code, h0.cipher.code) && !('rows' in v['hack-cipher-a']));
  check('cipher: key table has symbol-digit pairs, never the code', v['hack-cipher-b'].rows.length === 6 && !('code' in v['hack-cipher-b']));
  check('no terminal view carries a stored solution', Object.values(v).every((x) => !/"(sol|target|map|seed)"/.test(JSON.stringify(x))));

  // ---- and the room keeps the halves apart: from one terminal you cannot read its partner's screen
  const sight = await host.evaluate(() => {
    const hk = window.__nv.level.hack;
    const out = { own: [], partner: [] };
    for (const st of hk.stations()) {
      out.own.push(hk.readable(`hack-${st}-a`, `hack-${st}-a`), hk.readable(`hack-${st}-b`, `hack-${st}-b`));
      out.partner.push(hk.readable(`hack-${st}-a`, `hack-${st}-b`), hk.readable(`hack-${st}-b`, `hack-${st}-a`));
    }
    return out;
  });
  check('every terminal screen is readable from in front of it (control)', sight.own.length === 6 && sight.own.every((x) => x === true));
  check('no screen is readable from its partner terminal (racks and walls block it)', sight.partner.length === 6 && sight.partner.every((x) => x === false), JSON.stringify(sight.partner));

  // ---- the exit is shut
  await host.evaluate(() => window.__nv.tp(0, 0.02, -5.2, 0, 0));
  await hold(host, 'KeyW', 2500);
  const zShut = (await pos(host))[2];
  check('exit door is shut while systems are locked', zShut > -6.45, `z=${zShut.toFixed(2)}`);

  // ---- two players at the two terminals of one puzzle
  check('client opens the router terminal', (await openAt(cli, cliPid, 'hack-trace-a')) === true);
  check('host opens the ICE map of the same puzzle', (await openAt(host, hostPid, 'hack-trace-b')) === true);
  let oc = await overlay(cli);
  let oh = await overlay(host);
  check('the overlay opens and freezes the player', !!oc && oc.visible && oc.term === 'hack-trace-a' && (await cli.evaluate(() => window.__nv.player.frozen)) === true);
  check('router overlay is drawn from a view without ICE', !!oc?.view && !JSON.stringify(oc.view).includes('ice') && oc.status.includes('0'));
  check('ICE map overlay shows the ICE and lists the cells', !!oh?.view && same(oh.view.ice, h0.trace.ice) && /[A-D][1-4]/.test(oh.status), oh?.status);
  check('one line says what to do, in the player language', oc.hint.includes('ICE') && oc.hint.includes('Kacheln') && oh.hint.includes('ICE') && oh.hint.includes('router'), oc.hint);
  check('a terminal cannot be opened twice', (await use(cli, 'hack-trace-a')) === false);

  // keyboard: D moves the cursor, E rotates the tile under it
  const p0 = await pos(cli);
  const cur0 = oc.cursor ?? h0.trace.src * 4;
  const moved = cur0 % 4 < 3 ? cur0 + 1 : cur0;
  await tap(cli, 'KeyD');
  oc = (await until(async () => {
    const o = await overlay(cli);
    return o && o.cursor === moved ? o : false;
  }, 8000)) || (await overlay(cli));
  check('D moves the cursor, not the player', oc.cursor === moved && same(await pos(cli), p0), `cursor ${cur0} -> ${oc.cursor}`);
  // E turns the tile under the cursor. Whatever that does (a plain turn, or a strike if it wakes ICE),
  // the host must end up exactly where the rule function says.
  const expected = await cli.evaluate((cell) => {
    const L = window.__nv.level.hack.logic;
    return L.traceRotate(window.__nv.session.state.hack.trace, cell, 1);
  }, moved);
  await tap(cli, 'KeyE');
  const afterMove = await until(async () => {
    const s = await st(host, 'trace');
    return s.moves === 1 ? s : false;
  });
  check('a move made by the client appears on the host', !!afterMove && expected.result !== 'invalid' && same(afterMove, expected.state), `cell ${moved}: ${expected.result}`);
  const traceStrikes = afterMove ? afterMove.strikes : 0;
  check('and comes back to the client', !!(await until(async () => same(await st(cli, 'trace'), await st(host, 'trace')))));
  oh = await until(async () => {
    const o = await overlay(host);
    const c = await overlay(cli);
    return o && c && same(o.view.on, c.view.on) && same(c.view.rot, afterMove.rot) ? o : false;
  });
  check('both open terminals follow the move', !!oh);

  // Q leaves
  await tap(cli, 'KeyQ');
  const closed = await until(async () => (await overlay(cli)) === null, 8000);
  check('Q closes the overlay and frees the player', !!closed && (await cli.evaluate(() => window.__nv.player.frozen)) === false);
  await host.evaluate(() => window.__nv.level.hack.close());

  // ---- the host validates every move
  await cli.evaluate(() => window.__nv.tp(0, 0.02, 4.6, 0, 0));
  await until(() => host.evaluate((pid) => Math.abs(window.__nv.session.poseOf(pid).z - 4.6) < 0.5, cliPid));
  await intent(cli, { s: 'trace', c: 0, d: 1 });
  await sleep(900);
  check('host refuses a move from a player who is not at the terminal', (await st(host, 'trace')).moves === 1);
  await goTo(cli, cliPid, 'hack-trace-a');
  for (const bad of [{ s: 'trace', c: 99, d: 1 }, { s: 'trace', c: 0, d: 5 }, { s: 'trace', c: '0', d: 1 }, { s: 'nope', c: 0, d: 1 }, { s: 'trace', k: 1 }, null]) await intent(cli, bad);
  await sleep(900);
  check('host refuses malformed moves', (await st(host, 'trace')).moves === 1);

  // ---- a wrong entry: strike, on both peers, and the key table is dealt again
  await goTo(cli, cliPid, 'hack-cipher-a');
  const wrong = await cli.evaluate(() => {
    const L = window.__nv.level.hack.logic;
    const s = window.__nv.session.state.hack.cipher;
    const sol = L.cipherSolution(s);
    sol[0] = (sol[0] % 6) + 1;
    return sol;
  });
  for (const k of wrong) await intent(cli, { s: 'cipher', k });
  await until(async () => (await st(host, 'cipher')).entered.length === 3);
  check('typed digits are replicated', same((await st(cli, 'cipher')).entered, wrong) || (await st(cli, 'cipher')).entered.length === 3);
  await intent(cli, { s: 'cipher', k: 'ok' });
  const struck = await until(async () => {
    const a = await st(host, 'cipher');
    const b = await st(cli, 'cipher');
    return a.total === 1 && same(a, b) ? a : false;
  });
  check('a wrong code is a strike on both peers', !!struck && struck.strikes === 1 && struck.entered.length === 0 && !struck.solved);
  check('the wrong entry reshuffles the key table, the code stays', !!struck && same(struck.code, h0.cipher.code) && !(same(struck.map, h0.cipher.map) && same(struck.symbols, h0.cipher.symbols)));

  // ---- solve Trace through intents (client, alone at the router)
  await goTo(cli, cliPid, 'hack-trace-a');
  await cli.evaluate(() => window.__nv.level.hack.solve('trace'));
  const traceDone = await until(async () => (await st(host, 'trace')).solved && (await st(cli, 'trace')).solved);
  check('trace: solved through intents on both peers, without a strike', !!traceDone && (await st(host, 'trace')).strikes === traceStrikes);
  check('a solved terminal can no longer be opened', (await use(cli, 'hack-trace-a')) === false && (await view(cli, 'hack-trace-b')).solved === true);

  // ---- solve Signal (host tunes): lock first, win only after the hold time
  await host.evaluate(() => {
    window.__sig = [];
    window.__nv.session.onEvent((n, a) => {
      if (n === 'hack.fx' && a.s === 'signal') window.__sig.push([a.k, window.__nv.session.hostNow()]);
    });
  });
  await goTo(host, hostPid, 'hack-signal-a');
  await host.evaluate(() => window.__nv.level.hack.solve('signal'));
  const sigDone = await until(async () => (await st(host, 'signal')).solved && (await st(cli, 'signal')).solved);
  const sig = await host.evaluate(() => window.__sig);
  const lockAt = sig.find((e) => e[0] === 'lock')?.[1];
  const solvedAt = sig.find((e) => e[0] === 'solved')?.[1];
  check('signal: solved on both peers', !!sigDone);
  check('signal: it locks first and wins after holding 1.5 s', lockAt !== undefined && solvedAt !== undefined && solvedAt - lockAt >= 1500 && solvedAt - lockAt < 6000, `${Math.round(solvedAt - lockAt)} ms`);
  check('nothing is open early', (await host.evaluate(() => window.__nv.session.state.calib?.result ?? null)) === null && (await host.evaluate(() => window.__nv.session.state.hackroom.doneAt)) === null);

  // ---- a late joiner gets the current state
  const late = await openPlayer(env, { ...opt, name: 'Late' });
  await late.evaluate((c) => window.__nv.start(c), code);
  const lateOk = await until(async () => {
    const l = await hackState(late);
    return l && same(l, await hackState(host));
  }, 90000);
  await until(() => late.evaluate(() => !!window.__nv.player), 60000);
  check('late joiner receives the current puzzle state', !!lateOk);
  const lateObj = await late.evaluate(() => window.__nv.level.objective());
  check('late joiner sees two systems down, one to go', lateObj[0]?.includes('2/3') && lateObj[1]?.includes('CIPHER') && !lateObj[1]?.includes('TRACE'), lateObj.join(' | '));
  const lv = await view(late, 'hack-cipher-b');
  check('late joiner terminals show the reshuffled table', lv.rows.length === 6 && lv.rows.every((r, i) => r.g === struck.symbols[i] && r.d === struck.map[i]) && (await view(late, 'hack-trace-a')).solved === true);

  // ---- solve Cipher: everything is done
  await goTo(cli, cliPid, 'hack-cipher-a');
  await cli.evaluate(() => window.__nv.level.hack.solve('cipher'));
  const result = await until(async () => {
    const rs = await Promise.all([host, cli, late].map((p) => p.evaluate(() => window.__nv.session.state.calib?.result ?? null)));
    return rs.every((r) => r && same(r, rs[0])) ? rs[0] : false;
  });
  check('cipher: solved through intents on every peer', (await st(late, 'cipher')).solved === true && (await st(host, 'cipher')).solved === true);
  check('solving all three sets calib.result for everyone', !!result, JSON.stringify(result));
  check('calib.result: level, difficulty, time, strikes as fails, stars', !!result && result.level === 'hack' && result.diff === 1 && result.timeMs > 0 && result.fails === 1 + traceStrikes && [1, 2, 3].includes(result.stars));
  const card = await until(() => cli.evaluate(() => document.querySelector('.hk-end:not(.hidden)')?.textContent ?? ''));
  check('end card is shown (German)', typeof card === 'string' && card.includes('SYSTEME GEKNACKT') && card.includes('★'), String(card).slice(0, 60));
  check('objective says the exit is open', (await host.evaluate(() => window.__nv.level.objective()))[0].toLowerCase().includes('exit'));
  await sleep(3200); // door slides open
  await host.evaluate(() => window.__nv.tp(0, 0.02, -5.2, 0, 0));
  await hold(host, 'KeyW', 2800);
  const zOpen = (await pos(host))[2];
  check('the exit door is open: the host walks through', zOpen < -7.2, `z=${zOpen.toFixed(2)}`);

  const missing = await host.evaluate(() => window.__nv.missingTranslations());
  check('every text exists in English and German', missing.length === 0, missing.join(', '));
  const errors = [host, cli, late].flatMap((p) => p.errors);
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' || '));
} catch (e) {
  console.log('TEST CRASHED', e);
  failed++;
} finally {
  await env.stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
