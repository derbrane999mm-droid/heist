// Pure rules of the night watchman: no browser needed.
//   node tests/guard-logic.mjs
import * as L from '../src/game/mech/guard-logic.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const DT = 0.05;
const run = (sim, secs, players = [], ctx) => {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) L.step(sim, DT, players, ctx);
};
const player = (pid, x, z, o = {}) => ({ pid, x, y: 0, z, crouch: false, moving: true, light: false, speed: 0, ...o });
// a square loop 10 x 10 m, counter-clockwise seen from above
const SQUARE = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 0, z: -10 },
  { x: 0, y: 0, z: -10 },
];
/** Distance from (x, z) to the closest segment of the loop. */
const offRoute = (route, x, z) => {
  let best = Infinity;
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    const b = route[(i + 1) % route.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
};
const drain = (sim) => sim.events.splice(0);

// ---- tuning
check('difficulty defaults to 2 and clamps', L.guardTuning(undefined).speed === L.guardTuning(2).speed && L.guardTuning('9').speed === L.guardTuning(2).speed);
check('harder: faster, sees further, notices quicker', L.guardTuning(1).speed < L.guardTuning(3).speed && L.guardTuning(1).viewDist < L.guardTuning(3).viewDist && L.guardTuning(1).closeTime > L.guardTuning(3).closeTime);
check('guard count follows difficulty', L.guardCount(1) === 1 && L.guardCount(2) === 2 && L.guardCount(3) === 3);
check('speed option overrides', L.guardTuning(2, 0.9).speed === 0.9);

// ---- route following
{
  const sim = L.createSim({ routes: [SQUARE] });
  const g = sim.guards[0];
  let maxOff = 0;
  const visited = new Set();
  for (let i = 0; i < Math.round(60 / DT); i++) {
    L.step(sim, DT, []);
    maxOff = Math.max(maxOff, offRoute(SQUARE, g.x, g.z));
    visited.add(g.wp);
  }
  check('walks the loop and stays on the route', maxOff < 0.25 && visited.size === 4, `max off ${maxOff.toFixed(2)} m, waypoints ${[...visited]}`);
  check('nobody around: stays calm, no events', g.st === L.ST_PATROL && sim.events.length === 0);
  const sim2 = L.createSim({ routes: [SQUARE] });
  const g2 = sim2.guards[0];
  const x0 = g2.x;
  run(sim2, 2);
  check('walks at about his speed', Math.abs(g2.x - x0 - 2 * sim2.tun.speed) < 0.4, `${(g2.x - x0).toFixed(2)} m in 2 s`);
  const sim3 = L.createSim({ routes: [[{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0, yaw: Math.PI / 2 }]] });
  run(sim3, 4.6);
  check('pauses at a waypoint with a yaw and looks that way', sim3.guards[0].mode === L.M_PAUSE && Math.abs(L.angleDelta(sim3.guards[0].yaw, Math.PI / 2)) < 0.2);
}

// ---- vision
{
  const sim = L.createSim({ routes: [[{ x: 0, y: 0, z: 0 }]], walls: [{ x: 0, z: -5, sx: 4, sz: 0.4 }], hide: [{ x: 6, z: -4, r: 1 }] });
  const g = sim.guards[0];
  g.yaw = 0; // looks down -z
  check('sees a player ahead in the cone', L.sees(sim, g, player('a', 1, -3)) > 0);
  check('does not see behind him', L.sees(sim, g, player('a', 0, 4)) < 0);
  check('does not see outside the ~70 degree cone', L.sees(sim, g, player('a', 5, -3)) < 0 && L.sees(sim, g, player('a', 1.5, -3)) > 0);
  check('does not see beyond 12 m', L.sees(sim, g, player('a', 5.5, -11)) < 0 && L.sees(sim, g, player('a', 5, -10.5)) > 0);
  check('does not see through a wall', L.sees(sim, g, player('a', 0, -8)) < 0 && L.sees(sim, g, player('a', 3.5, -8)) > 0);
  check('crouching or standing still in the dark: shorter range', L.sees(sim, g, player('a', 3, -8, { crouch: true })) < 0 && L.sees(sim, g, player('a', 3, -10.5, { moving: false })) < 0);
  check('a lit flashlight is seen from further away', L.sees(sim, g, player('a', 6, -13, { light: true })) > 0 && L.sees(sim, g, player('a', 6, -13)) < 0);
  check('the physics test can veto', L.sees(sim, g, player('a', 1, -3), { los: () => false }) < 0);
  check('notices someone bumping into him from behind', L.sees(sim, g, player('a', 0, 0.7)) > 0);
  g.yaw = L.yawTo(6, -4);
  check('does not see into a hiding spot ...', L.sees(sim, g, player('a', 6, -4)) < 0);
  g.x = 5.2;
  g.z = -3;
  g.yaw = L.yawTo(0.8, -1);
  check('... unless he stands within 1.5 m of it', L.sees(sim, g, player('a', 6, -4)) > 0);
  check('segment vs box', L.segmentHitsBox(-1, 0, 1, 0, { x: 0, z: 0, sx: 0.2, sz: 0.2 }) && !L.segmentHitsBox(-1, 1, 1, 1, { x: 0, z: 0, sx: 0.2, sz: 0.2 }));
}

// ---- detection meter
{
  const mk = () => {
    const sim = L.createSim({ routes: [[{ x: 0, y: 0, z: 0 }]] });
    sim.guards[0].yaw = 0;
    return sim;
  };
  const sim = mk();
  const p = player('a', 0, -2.5);
  L.step(sim, DT, [p]);
  check('a glimpse starts the meter but is no alarm', sim.meters.a > 0 && sim.meters.a < 0.1 && sim.guards[0].st === L.ST_PATROL);
  let t = DT;
  while (sim.guards[0].st !== L.ST_ALERT && t < 10) {
    L.step(sim, DT, [p]);
    t += DT;
  }
  const ev = drain(sim);
  check('close up: alert after about 1.5 s', Math.abs(t - 1.5) < 0.25, `${t.toFixed(2)} s`);
  check('events: suspicious, then alert with the player id', ev.length === 2 && ev[0].type === 'suspicious' && ev[1].type === 'alert' && ev[1].pid === 'a' && ev[1].guard === 0, JSON.stringify(ev));

  const far = mk();
  const pf = player('a', 0, -10);
  let tf = 0;
  while (far.guards[0].st !== L.ST_ALERT && tf < 20) {
    L.step(far, DT, [pf]);
    tf += DT;
  }
  check('far away it takes longer', tf > 3, `${tf.toFixed(2)} s`);

  const dec = mk();
  const pd = player('a', 0, -3);
  run(dec, 0.6, [pd]);
  const m0 = dec.meters.a;
  run(dec, 1, [player('a', 0, 5)]);
  const m1 = dec.meters.a;
  run(dec, 6, [player('a', 0, 5)]);
  check('meter decays out of sight', m0 > 0.3 && m1 < m0 && dec.meters.a === 0, `${m0.toFixed(2)} -> ${m1.toFixed(2)} -> ${dec.meters.a}`);
  check('a short glimpse makes him suspicious, not alert', dec.guards[0].st !== L.ST_ALERT && drain(dec).some((e) => e.type === 'suspicious'));

  const two = mk();
  run(two, 0.5, [player('a', 0, -3), player('b', 0, 6)]);
  check('meters are per player', two.meters.a > 0.2 && two.meters.b === 0);

  const hid = L.createSim({ routes: [[{ x: 0, y: 0, z: 0 }]], hide: [{ x: 0, z: -4, r: 1 }] });
  hid.guards[0].yaw = 0;
  run(hid, 4, [player('a', 0, -4, { moving: false })]);
  check('a player in a hiding spot never fills the meter', hid.meters.a === 0 && hid.events.length === 0);
}

// ---- hearing: walk over, look around, back to the route
{
  const sim = L.createSim({ routes: [SQUARE] });
  const g = sim.guards[0];
  run(sim, 1);
  const heard = L.noise(sim, 3, 3, 6);
  check('a noise in range is heard', heard === 1 && g.st === L.ST_SUSPICIOUS && drain(sim).some((e) => e.type === 'suspicious' && e.x === 3));
  run(sim, 0.5);
  check('first he stops and turns', g.mode === L.M_TURN);
  let reached = false;
  let looked = false;
  for (let i = 0; i < Math.round(15 / DT) && g.st !== L.ST_PATROL; i++) {
    L.step(sim, DT, []);
    if (Math.hypot(g.x - 3, g.z - 3) < 1.2) reached = true;
    if (g.mode === L.M_LOOK) looked = true;
  }
  check('then walks to the spot and looks around', reached && looked);
  const ev = drain(sim);
  check('then calms down and returns to the route', g.st === L.ST_PATROL && ev.some((e) => e.type === 'calm'));
  run(sim, 8);
  check('back on the route afterwards', g.mode === L.M_WALK && offRoute(SQUARE, g.x, g.z) < 0.3, `${offRoute(SQUARE, g.x, g.z).toFixed(2)} m off`);
  const far = L.createSim({ routes: [SQUARE] });
  check('a noise out of range is not heard', L.noise(far, 30, 30, 5) === 0 && far.guards[0].st === L.ST_PATROL);
  const wall = L.createSim({ routes: [SQUARE], walls: [{ x: 3, z: 2, sx: 8, sz: 0.4 }] });
  L.noise(wall, 3, 4, 8);
  run(wall, 3);
  check('does not walk through a wall to a noise behind it', wall.guards[0].z < 1.8 && wall.guards[0].st === L.ST_SUSPICIOUS);
  const steps = L.createSim({ routes: [SQUARE] });
  run(steps, 0.5, [player('a', 1.5, 2, { speed: 3.5 })]);
  const crept = L.createSim({ routes: [SQUARE] });
  run(crept, 0.5, [player('a', 1.5, 2, { speed: 1.6, crouch: true })]);
  check('hears footsteps behind him, but not someone crouching', steps.guards[0].st === L.ST_SUSPICIOUS && crept.guards[0].st === L.ST_PATROL);
}

// ---- distraction
{
  const sim = L.createSim({ routes: [SQUARE, SQUARE.slice(2).concat(SQUARE.slice(0, 2))] });
  run(sim, 0.2);
  check('distraction pulls the nearest guard', L.distract(sim, 9, -11) === true && sim.guards[1].st === L.ST_SUSPICIOUS && sim.guards[0].st === L.ST_PATROL);
  check('event names the guard and the spot', drain(sim).some((e) => e.type === 'suspicious' && e.guard === 1 && e.x === 9));
  check('second distraction inside the cooldown is refused', L.distract(sim, 0, 1) === false && sim.guards[0].st === L.ST_PATROL);
  run(sim, sim.tun.distractCooldown);
  drain(sim);
  check('after the cooldown it works again', L.distract(sim, 0, 1) === true && sim.events.some((e) => e.type === 'suspicious' && e.x === 0));
}

// ---- alert lasts, then calms down
{
  const sim = L.createSim({ routes: [SQUARE] });
  sim.hold = true;
  sim.guards[0].yaw = L.yawTo(1, 0);
  run(sim, 3, [player('a', 4, 0)]);
  check('staying in view: alert', sim.guards[0].st === L.ST_ALERT);
  sim.hold = false;
  run(sim, 2, [player('a', 4, 20)]);
  check('alert does not end the moment he loses you', sim.guards[0].st === L.ST_ALERT);
  run(sim, 25, [player('a', 4, 20)]);
  check('a while later he gives up and is back on patrol', sim.guards[0].st === L.ST_PATROL && sim.events.some((e) => e.type === 'calm'));
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
