// Frame-time and flicker probe for the first-person Varga level (1440x900, real GPU).
//   node tests/probe-perf.mjs [high] [medium] [auto] [--quick] [--no-job] [--no-flicker]
// Per quality: (1) flicker: stand still at fixed spots, 12 screenshots 100 ms apart, compare them
// (mean absolute difference on 8x8-pixel blocks, so film grain averages out; bounding box of changed blocks);
// the worst pair of each spot is saved to test-out/flicker/. (2) a solo job driven by walking (keys held,
// teleport only when stuck) while every frame records its time, shader links, program count, draw calls,
// visible / shadow-casting lights and the render scale. Reports p50/p95/p99/max and every frame over 33 ms.
// 'auto' is what a new visitor gets (settings default) with the live quality tuning switched on.
import fs from 'node:fs';
import { startServers, sleep, OUT } from './harness.mjs';
import { until, pub, act } from './plan-flow.mjs';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const QUALS = args.filter((a) => !a.startsWith('--'));
const qualities = QUALS.length ? QUALS : ['high', 'medium', 'auto'];
const DO_JOB = !args.includes('--no-job');
const DO_FLICKER = !args.includes('--no-flicker');
const DIR = `${OUT}/flicker`;
fs.mkdirSync(DIR, { recursive: true });

const SEED = 6;
const TIMES = { stake: 60000, brief: 60000, board: 30000, facts: 60000, offer: 60000, decide: 60000, accuse: 60000, beat: 150, bot: 400, skill: 60000, gate: 15000 };
const POSTS = { brain: 'inside', hands: 'inside', gambler: 'lookout', bait: 'driver' };
const PREFER = ['pick', 'quiet', 'leave', 'stay', 'hide', 'slow', 'koeder'];

const DPR = Number((args.find((a) => a.startsWith('--dpr=')) ?? '--dpr=2').slice(6));
/** tests/harness.mjs openPlayer, with a device pixel ratio (a MacBook screen is 2). */
async function openPlayer(env, { name, quality, width, height, extra }) {
  const ctx = await env.browser.newContext({ viewport: { width, height }, deviceScaleFactor: DPR, permissions: ['microphone'] });
  await ctx.addInitScript(([name, quality]) => {
    localStorage.setItem('nullvault.settings.v1', JSON.stringify({ name, quality, lang: 'en', color: 1, music: 0.2 }));
    window.__nvNoTune = true;
    window.__nvNoPause = true;
    window.__nvRenderSkip = 0;
  }, [name, quality]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.goto(env.base + extra);
  page.errors = errors;
  await page.waitForFunction(() => window.__nv !== undefined, null, { timeout: 150000 });
  return page;
}

/**
 * Z-fighting scan: every visible mesh's triangles in world space, grouped by plane (normal + offset, 3 mm bins);
 * same-facing triangles of two different meshes whose boxes overlap by more than 4 cm² fight for the pixel.
 */
function zfightScan() {
  const THREE_V = (x, y, z) => ({ x, y, z });
  const groups = new Map();
  const meshes = [];
  window.__nv.engine.scene.updateMatrixWorld(true);
  window.__nv.engine.scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.visible === false || m.depthTest === false || m.depthWrite === false) return; // transparent decals use offsets
    if (m.polygonOffset) return;
    meshes.push(o);
  });
  const e = new Float32Array(16);
  let tris = 0;
  meshes.forEach((o, mi) => {
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    o.matrixWorld.toArray(e);
    const P = (i) => {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      return THREE_V(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    };
    for (let t = 0; t + 2 < n; t += 3) {
      const a = P(idx ? idx.getX(t) : t), b = P(idx ? idx.getX(t + 1) : t + 1), c = P(idx ? idx.getX(t + 2) : t + 2);
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-5) continue; // area < tiny
      nx /= len; ny /= len; nz /= len;
      // only axis-aligned-ish planes (walls, floors, ceilings) - that is where the level stacks boxes
      const ax = Math.abs(nx) > 0.999 ? 'x' : Math.abs(ny) > 0.999 ? 'y' : Math.abs(nz) > 0.999 ? 'z' : null;
      if (!ax) continue;
      const sgn = (ax === 'x' ? nx : ax === 'y' ? ny : nz) > 0 ? 1 : -1;
      const d = ax === 'x' ? a.x : ax === 'y' ? a.y : a.z;
      const bin = Math.round(d / 0.003);
      const key = ax + sgn + ':' + bin;
      const box = ax === 'x' ? [Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z), Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y)]
        : ax === 'y' ? [Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z)]
        : [Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y)];
      let arr = groups.get(key);
      if (!arr) groups.set(key, (arr = []));
      arr.push([mi, d, ...box]);
      tris++;
    }
  });
  const hits = new Map();
  for (const [key, arr] of groups) {
    const [axs, binS] = key.split(':');
    const bin = Number(binS);
    const near = [arr, groups.get(axs + ':' + (bin + 1)) || []];
    for (const other of near)
      for (let i = 0; i < arr.length; i++)
        for (let j = other === arr ? i + 1 : 0; j < other.length; j++) {
          const A = arr[i], B = other[j];
          if (A[0] === B[0]) continue;
          const ox = Math.min(A[3], B[3]) - Math.max(A[2], B[2]);
          const oy = Math.min(A[5], B[5]) - Math.max(A[4], B[4]);
          if (ox <= 0.02 || oy <= 0.02 || ox * oy < 0.0004) continue;
          const ma = meshes[A[0]], mb = meshes[B[0]];
          const name = (m) => (m.name || '') + '#' + (Array.isArray(m.material) ? m.material[0] : m.material).uuid.slice(0, 4) + ':' + ((Array.isArray(m.material) ? m.material[0] : m.material).color?.getHexString?.() ?? '');
          const k = [name(ma), name(mb)].sort().join(' vs ') + ' @' + axs + ' ' + A[1].toFixed(3);
          const h = hits.get(k) ?? { k, area: 0, at: [((A[2] + A[3]) / 2).toFixed(2), ((A[4] + A[5]) / 2).toFixed(2)], gap: Math.abs(A[1] - B[1]).toFixed(4) };
          h.area += ox * oy;
          hits.set(k, h);
        }
  }
  return { tris, meshes: meshes.length, hits: [...hits.values()].sort((a, b) => b.area - a.area).slice(0, 60) };
}

/** Per-frame recorder inside the page (rAF runs after the engine's own frame callback). */
function installProbe() {
  const nv = window.__nv;
  const r = nv.engine.renderer;
  r.info.autoReset = false; // count every pass of the frame, reset below
  const P = { frames: [], links: 0, on: false, tag: '' };
  const proto = WebGL2RenderingContext.prototype;
  if (!proto.__probed) {
    const link = proto.linkProgram;
    proto.linkProgram = function (p) {
      (window.__probeLinks = (window.__probeLinks || 0) + 1);
      return link.call(this, p);
    };
    proto.__probed = true;
  }
  // frame work = simulation + render, with the GPU synced (1-pixel read) so GPU time counts too
  const gl = r.getContext();
  const px = new Uint8Array(4);
  if (!nv.engine.__probed) {
    nv.engine.__probed = true;
    const frame = nv.engine.frame;
    nv.engine.frame = function (now) {
      const t0 = performance.now();
      frame.call(this, now);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      P.work = performance.now() - t0;
    };
  }
  let last = performance.now();
  let links = window.__probeLinks || 0;
  const loop = (now) => {
    if (P.on) {
      let n = 0, s = 0;
      nv.engine.scene.traverseVisible((o) => {
        if (o.isLight && !o.isAmbientLight) {
          n++;
          if (o.castShadow) s++;
        }
      });
      const info = nv.engine.screenshotInfo();
      const L = window.__probeLinks || 0;
      const ph = nv.session?.state?.plan?.phase ?? '';
      P.frames.push([+(now - last).toFixed(2), r.info.programs.length, r.info.render.calls, n, s, info.scale, info.quality, L - links, P.tag || ph, performance.memory?.usedJSHeapSize ?? 0, +(P.work ?? 0).toFixed(2)]);
      links = L;
    }
    r.info.reset();
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__probe = P;
}

function stats(frames, col = 0) {
  const dts = frames.map((f) => f[col]).slice(1).sort((a, b) => a - b);
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))] ?? 0;
  return { n: dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: dts[dts.length - 1] ?? 0, over33: dts.filter((d) => d > 33).length, over50: dts.filter((d) => d > 50).length };
}

/** Decode two PNG screenshots in a blank page and compare them on 8x8 blocks. */
async function diffPngs(cmp, a, b) {
  return cmp.evaluate(async ([a, b]) => {
    const load = async (s) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + s;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, c.width, c.height);
    };
    const A = await load(a), B = await load(b);
    const W = A.width, H = A.height, S = 8;
    const bw = Math.floor(W / S), bh = Math.floor(H / S);
    let sum = 0, changed = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, peak = 0;
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        let d = 0;
        for (let c = 0; c < 3; c++) {
          let sa = 0, sb = 0;
          for (let y = 0; y < S; y++)
            for (let x = 0; x < S; x++) {
              const i = ((by * S + y) * W + bx * S + x) * 4 + c;
              sa += A.data[i];
              sb += B.data[i];
            }
          d += Math.abs(sa - sb) / (S * S);
        }
        d /= 3;
        sum += d;
        if (d > peak) peak = d;
        if (d > 6) {
          changed++;
          if (bx < x0) x0 = bx;
          if (by < y0) y0 = by;
          if (bx > x1) x1 = bx;
          if (by > y1) y1 = by;
        }
      }
    return { mad: +(sum / (bw * bh)).toFixed(3), peak: +peak.toFixed(1), changed, box: changed ? [x0 * S, y0 * S, (x1 + 1) * S, (y1 + 1) * S] : null };
  }, [a.toString('base64'), b.toString('base64')]);
}

async function flickerAt(page, cmp, tag, spot) {
  await page.evaluate((s) => {
    window.__nv.tp(s.x, s.y, s.z, s.yaw, s.pitch ?? 0);
    const pl = window.__nv.player;
    pl.flashlightOn = !!s.torch;
  }, spot);
  await sleep(1800);
  // freeze the player: no drift, no walking; the camera, the hands' breathing and the world keep animating
  await page.evaluate(() => (window.__nv.player.frozen = true));
  await sleep(300);
  const shots = [];
  for (let i = 0; i < 12; i++) {
    shots.push(await page.screenshot({ scale: 'css' }));
    await sleep(100);
  }
  await page.evaluate(() => (window.__nv.player.frozen = false));
  let worst = null, sum = 0, maxChanged = 0;
  for (let i = 1; i < shots.length; i++) {
    const d = await diffPngs(cmp, shots[i - 1], shots[i]);
    sum += d.mad;
    maxChanged = Math.max(maxChanged, d.changed);
    if (!worst || d.mad > worst.mad) worst = { ...d, i };
  }
  const name = `${tag}-${spot.name}`;
  fs.writeFileSync(`${DIR}/${name}-a.png`, shots[worst.i - 1]);
  fs.writeFileSync(`${DIR}/${name}-b.png`, shots[worst.i]);
  return { spot: spot.name, meanMad: +(sum / 11).toFixed(3), worstMad: worst.mad, peak: worst.peak, maxChangedBlocks: maxChanged, box: worst.box };
}

/** During the run: stand near the guard (still) and film him walking: 24 shots, 80 ms apart. */
async function guardWatch(page, cmp, tag) {
  await sleep(1500);
  const g = await page.evaluate(() => window.__nv.level.guards?.debugState()?.guards?.[0] ?? null);
  if (!g) return null;
  await page.evaluate((g) => {
    const A = window.__nv.level.anchors;
    // a waypoint 3-6 m from the guard, looking at him
    let best = null;
    for (let i = 0; A['guard.' + i]; i++) {
      const w = A['guard.' + i];
      const d = Math.hypot(w.x - g.x, w.z - g.z);
      if (d > 3 && d < 7 && (!best || d < best.d)) best = { d, w };
    }
    const w = best ? best.w : { x: g.x + 3, z: g.z };
    window.__nv.tp(w.x, (A['in.liefer']?.y ?? 0) + 0.02, w.z, Math.atan2(-(g.x - w.x), -(g.z - w.z)), -0.15);
  }, g);
  await sleep(600);
  await page.evaluate(() => (window.__nv.player.frozen = true));
  const shots = [];
  for (let i = 0; i < 24; i++) {
    shots.push(await page.screenshot({ scale: 'css' }));
    await sleep(80);
  }
  await page.evaluate(() => (window.__nv.player.frozen = false));
  const ds = [];
  for (let i = 1; i < shots.length; i++) ds.push(await diffPngs(cmp, shots[i - 1], shots[i]));
  fs.mkdirSync(`${DIR}/guard-${tag}`, { recursive: true });
  shots.forEach((s, i) => fs.writeFileSync(`${DIR}/guard-${tag}/${String(i).padStart(2, '0')}.png`, s));
  console.log('  guard watch (consecutive diffs):', ds.map((d) => d.mad).join(' '));
  return ds;
}

/** A solo job: plan in the overlay, then walk to every objective. */
async function drivePlan(page) {
  const p = await pub(page);
  if (!p || !p.phase) return p;
  const pv = await page.evaluate(() => { const r = window.__nv.plan.view.received; return r.length ? r[r.length - 1] : null; });
  const A = (a) => act(page, a);
  switch (p.phase) {
    case 'stake': await A({ t: 'confirm' }); break;
    case 'brief': case 'facts': await A({ t: 'confirm' }); break;
    case 'scout':
      if (p.board.scout.length === 3) await A({ t: 'confirm' });
      else for (const id of ['parkhaus', 'hausmeister', 'elektriker']) if (!p.board.scout.includes(id)) await A({ t: 'scout', id });
      break;
    case 'shop':
      for (const id of ['decoder', 'stoer', 'bohrer']) if (!p.board.tools.includes(id)) await A({ t: 'tool', id });
      await A({ t: 'confirm' });
      break;
    case 'plan':
      if (p.plan.posts.brain !== POSTS.brain) await A({ t: 'post', role: 'brain', post: POSTS.brain });
      for (const s of p.seats) if (s.bot && p.plan.posts[s.role] !== POSTS[s.role]) await A({ t: 'post', role: s.role, post: POSTS[s.role] });
      if (p.plan.entrance !== 'liefer') await A({ t: 'ent', id: 'liefer' });
      else if (p.plan.targets[0] !== 'tresor') { if (!p.plan.targets.includes('tresor')) await A({ t: 'tgt', id: 'tresor' }); }
      else if (Object.entries(POSTS).every(([r, x]) => p.plan.posts[r] === x)) await A({ t: 'confirm' });
      break;
    case 'offer': if (pv?.offer && !pv.offer.answered) await A({ t: 'offer', answer: 'decline' }); break;
    case 'accuse': if (pv?.accuse && !pv.accuse.choice) await A({ t: 'accuse', target: 'pass' }); break;
    case 'run': {
      const d = p.run.decision;
      if (d && d.who === 'brain' && !d.bot) {
        const opt = d.options.find((x) => PREFER.includes(x.id)) ?? d.options[0];
        await A({ t: 'choose', id: opt.id });
      }
      break;
    }
  }
  return p;
}

const walkState = { target: '', since: 0, best: 1e9 };
async function walk(page) {
  const st = await page.evaluate(() => window.__nv.job.debugState());
  if (st.game) {
    await page.evaluate(() => ['KeyW', 'ShiftLeft'].forEach((k) => window.__nv.input.debugSet(k, false)));
    await sleep(1500); // look at the game for a moment
    await page.evaluate((id) => window.__nv.level.games[id].debugFinish(true), st.game);
    return;
  }
  if (st.skill && !st.game) {
    await page.evaluate(() => window.__nv.input.debugSet('KeyE', true));
    await sleep(120);
    await page.evaluate(() => window.__nv.input.debugSet('KeyE', false));
  }
  if (!st.at) return;
  const key = `${st.at.x},${st.at.z}`;
  const d = await page.evaluate((a) => {
    const pl = window.__nv.player;
    const dx = a.x - pl.position.x, dz = a.z - pl.position.z;
    const d = Math.hypot(dx, dz);
    const go = d > 0.8;
    if (go) {
      const want = Math.atan2(-dx, -dz);
      let dy = want - pl.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      pl.yaw += dy * 0.6; // turn like a mouse would, not instantly
    }
    window.__nv.input.debugSet('KeyW', go);
    window.__nv.input.debugSet('ShiftLeft', go && d > 3);
    return d;
  }, st.at);
  const now = Date.now();
  if (walkState.target !== key) Object.assign(walkState, { target: key, since: now, best: d });
  if (d < walkState.best - 0.3) Object.assign(walkState, { since: now, best: d });
  if (d > 0.8 && now - walkState.since > 2500) {
    // stuck on a wall: teleport like the "hold R" rescue does
    await page.evaluate(() => window.__nv.job.debugRescue());
    Object.assign(walkState, { since: now, best: 0 });
  }
}

const SPOTS = (A) => [
  { name: 'street', x: 3.5, y: 0.02, z: 11.5, yaw: 0.6, pitch: 0.05 },
  { name: 'gate', x: A.gate.x, y: A.gate.y + 0.02, z: A.gate.z + 1.5, yaw: 0.0, pitch: 0.0 },
  { name: 'yard', x: 3.2, y: 0.14, z: 2.0, yaw: 1.35, pitch: 0.05 },
  { name: 'door', x: A['door.liefer'].x + 0.6, y: A['door.liefer'].y + 0.02, z: 0.2, yaw: Math.PI / 2, pitch: 0.0 },
  { name: 'lager', x: -1.2, y: A['in.liefer'].y + 0.02, z: 3.6, yaw: 0.75, pitch: 0.05 },
  { name: 'lager-torch', x: -1.2, y: A['in.liefer'].y + 0.02, z: 3.6, yaw: 0.75, pitch: 0.05, torch: true },
  { name: 'saal', x: -9.0, y: A['in.liefer'].y + 0.02, z: -1.0, yaw: Math.PI / 2, pitch: 0.0 },
  { name: 'foyer', x: -14.6, y: A['in.liefer'].y + 0.02, z: 2.5, yaw: Math.PI / 2 - 0.4, pitch: 0.0 },
  { name: 'wache', x: -18.5, y: A['in.liefer'].y + 0.02, z: -8.0, yaw: -2.6, pitch: -0.1 },
  { name: 'safe', x: A.safe.x + 1.6, y: A.safe.y + 0.02, z: A.safe.z, yaw: Math.PI / 2, pitch: -0.05 },
  { name: 'safe-alarm', x: A.safe.x + 1.6, y: A.safe.y + 0.02, z: A.safe.z, yaw: Math.PI / 2, pitch: -0.05, alarm: true },
];

const env = await startServers({ port: 5611, sigPort: 9611 });
const summary = [];
try {
  const cmp = await (await env.browser.newContext()).newPage();
  for (const quality of qualities) {
    const page = await openPlayer(env, { name: 'Mert', quality, width: 1440, height: 900, renderSkip: 0, extra: '&level=varga' });
    await page.evaluate(([t, s, auto]) => {
      window.__nvPlanTimes = t;
      window.__nvPlanSeed = s;
      window.__nvNoTune = !auto; // a real visitor has the live tuning on
    }, [TIMES, SEED, quality === 'auto']);
    await page.evaluate(installProbe);
    await page.evaluate(() => window.__nv.start(null));
    await until(() => page.evaluate(() => !!window.__nv.player), 150000);
    const boot = await page.evaluate(() => ({ q: window.__nv.engine.quality.name, gpu: (() => { const gl = window.__nv.engine.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })(), dpr: devicePixelRatio, programs: window.__nv.engine.renderer.info.programs.length }));
    console.log(`\n=== ${quality}: preset ${boot.q}, dpr ${boot.dpr}, programs after boot ${boot.programs}, ${boot.gpu}`);
    const out = { quality, boot };
    const A = await page.evaluate(() => window.__nv.level.anchors);
    if (args.includes('--zfight')) {
      const z = await page.evaluate(zfightScan);
      out.zfight = z;
      console.log(`  z-fight scan: ${z.meshes} meshes, ${z.tris} axis-aligned triangles, ${z.hits.length} coplanar overlaps`);
      for (const h of z.hits) console.log(`    ${h.area.toFixed(3)} m²  gap ${h.gap}  ${h.k}  near ${h.at.join(',')}`);
    }

    // ---------------------------------------------------------------- free walk + idle, outside a job
    await page.evaluate(() => { window.__probe.frames = []; window.__probe.on = true; window.__probe.tag = 'walk'; });
    await page.evaluate(() => window.__nv.tp(2.0, 0.02, 9.0, 0.3, 0));
    await page.evaluate(() => ['KeyW'].forEach((k) => window.__nv.input.debugSet(k, true)));
    await sleep(QUICK ? 2500 : 5000);
    await page.evaluate(() => window.__nv.input.debugSet('KeyW', false));
    await page.evaluate(() => { window.__probe.tag = 'idle'; });
    await sleep(QUICK ? 3000 : 8000);
    const walkFrames = await page.evaluate(() => { window.__probe.on = false; return window.__probe.frames; });
    out.free = stats(walkFrames);
    out.freeWork = stats(walkFrames, 10);
    out.freeScale = [...new Set(walkFrames.map((f) => f[5]))];

    // ---------------------------------------------------------------- flicker spots
    if (DO_FLICKER) {
      out.flicker = [];
      const spots = SPOTS(A).filter((s) => !QUICK || ['yard', 'lager', 'lager-torch', 'safe-alarm', 'street'].includes(s.name));
      for (const s of spots) {
        if (s.alarm) await page.evaluate(() => window.__nv.level.interior.setAlarm(true));
        const r = await flickerAt(page, cmp, quality, s);
        if (s.alarm) await page.evaluate(() => window.__nv.level.interior.setAlarm(false));
        out.flicker.push(r);
        console.log(`  flicker ${r.spot.padEnd(12)} mean ${String(r.meanMad).padStart(6)}  worst ${String(r.worstMad).padStart(6)}  peak ${String(r.peak).padStart(5)}  blocks ${String(r.maxChangedBlocks).padStart(5)}  box ${JSON.stringify(r.box)}`);
      }
      await page.evaluate(() => (window.__nv.player.flashlightOn = false));
    }

    // ---------------------------------------------------------------- a solo job, walking
    if (DO_JOB) {
      await page.evaluate(() => window.__nv.tp(1.7, 0.02, 8.25, Math.PI / 2, -0.05));
      await page.evaluate(() => { window.__probe.frames = []; window.__probe.on = true; window.__probe.tag = ''; });
      await page.evaluate(() => window.__nv.interactions.debugUse('varga.plan'));
      const t0 = Date.now();
      let flashToggled = 0;
      let watched = false;
      const progs0 = await page.evaluate(() => window.__nv.engine.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.slice(0, 160)));
      const end = await until(async () => {
        const p = await drivePlan(page);
        if (p?.phase === 'run' && !watched && DO_FLICKER) {
          watched = true;
          out.guardWatch = await guardWatch(page, cmp, quality);
        }
        if (p?.phase === 'run') {
          await walk(page);
          // switch the flashlight now and then, like a player would
          if (Date.now() - flashToggled > 6000) {
            flashToggled = Date.now();
            await page.evaluate(() => (window.__nv.player.flashlightOn = !window.__nv.player.flashlightOn));
          }
        }
        return p?.phase === 'debrief' || (QUICK && Date.now() - t0 > 90000) ? p ?? true : false;
      }, 300000, 250);
      await page.evaluate(() => ['KeyW', 'ShiftLeft'].forEach((k) => window.__nv.input.debugSet(k, false)));
      await sleep(2000);
      const frames = await page.evaluate(() => { window.__probe.on = false; return window.__probe.frames; });
      const progs1 = await page.evaluate(() => window.__nv.engine.renderer.info.programs.map((p) => p.name + '|' + p.cacheKey.slice(0, 160)));
      out.newPrograms = progs1.filter((x) => !progs0.includes(x));
      for (const x of out.newPrograms) console.log('  new program during job:', x);
      frames.forEach((f, i) => f[7] && console.log(`  frame ${i} [${f[8]}]: ${f[7]} shader link(s), work ${f[10]} ms, dt ${f[0]}`));
      out.job = stats(frames);
      out.jobWork = stats(frames, 10);
      out.jobReached = end?.phase ?? String(!!end);
      const runFrames = frames.filter((f) => f[8] === 'run');
      out.run = stats(runFrames);
      out.programs = [frames[0]?.[1], frames[frames.length - 1]?.[1]];
      out.links = frames.reduce((s, f) => s + f[7], 0);
      out.lights = [...new Set(frames.map((f) => `${f[3]}/${f[4]}`))];
      out.scales = [];
      for (let i = 1; i < frames.length; i++) if (frames[i][5] !== frames[i - 1][5] || frames[i][6] !== frames[i - 1][6]) out.scales.push(`${frames[i][6]}@${frames[i][5].toFixed(2)}`);
      const spikes = [];
      for (let i = 1; i < frames.length; i++) {
        const f = frames[i], pf = frames[i - 1];
        if (f[0] > 33) {
          const why = [];
          if (f[7]) why.push(`${f[7]} shader links`);
          if (f[1] !== pf[1]) why.push(`programs ${pf[1]}->${f[1]}`);
          if (f[3] !== pf[3] || f[4] !== pf[4]) why.push(`lights ${pf[3]}/${pf[4]}->${f[3]}/${f[4]}`);
          if (f[5] !== pf[5] || f[6] !== pf[6]) why.push(`scale ${pf[6]}@${pf[5]}->${f[6]}@${f[5]}`);
          if (f[9] && pf[9] && f[9] < pf[9] - 2e6) why.push(`GC ${((pf[9] - f[9]) / 1e6).toFixed(1)} MB`);
          if (f[8] !== pf[8]) why.push(`phase ${pf[8]}->${f[8]}`);
          spikes.push(`${f[0].toFixed(0)}ms (work ${f[10]}) [${f[8]}] calls ${f[2]} ${why.join(', ')}`);
        }
      }
      // heap growth rate during the run (allocations per second, rough)
      let alloc = 0, secs = 0;
      for (let i = 1; i < runFrames.length; i++) {
        const d = runFrames[i][9] - runFrames[i - 1][9];
        if (d > 0) alloc += d;
        secs += runFrames[i][0] / 1000;
      }
      out.allocMBs = secs ? +(alloc / secs / 1e6).toFixed(2) : 0;
      out.calls = (() => { const c = runFrames.map((f) => f[2]).sort((a, b) => a - b); return c.length ? [c[0], c[Math.floor(c.length / 2)], c[c.length - 1]] : []; })();
      out.spikes = spikes;
      console.log(`  job reached ${out.jobReached}; frames ${out.job.n}; programs ${out.programs.join('->')}; shader links during job ${out.links}; lights(visible/shadow) ${out.lights.join(' ')}; scale changes ${out.scales.length} ${out.scales.slice(0, 12).join(' ')}`);
      console.log(`  job frame work (GPU synced) ms p50 ${out.jobWork.p50} p95 ${out.jobWork.p95} p99 ${out.jobWork.p99} max ${out.jobWork.max} >16.7ms ${frames.filter((f) => f[10] > 16.7).length}`);
      console.log(`  job frame ms p50 ${out.job.p50} p95 ${out.job.p95} p99 ${out.job.p99} max ${out.job.max} >33ms ${out.job.over33} >50ms ${out.job.over50}; run p99 ${out.run.p99} >33 ${out.run.over33}; heap growth ${out.allocMBs} MB/s; calls min/med/max ${out.calls.join('/')}`);
      for (const s of spikes.slice(0, 40)) console.log('    spike', s);
    }
    console.log(`  free walk+idle work ms: p50 ${out.freeWork.p50} p95 ${out.freeWork.p95} p99 ${out.freeWork.p99} max ${out.freeWork.max}`);
    console.log(`  free walk+idle: p50 ${out.free.p50} p95 ${out.free.p95} p99 ${out.free.p99} max ${out.free.max} >33ms ${out.free.over33}; scales ${out.freeScale.join(',')}`);
    if (page.errors.length) console.log('  page errors:', page.errors.slice(0, 5));
    summary.push(out);
    await page.context().close();
  }
} finally {
  fs.writeFileSync(`${DIR}/probe.json`, JSON.stringify(summary, null, 1));
  await env.stop();
}
process.exit(0);
