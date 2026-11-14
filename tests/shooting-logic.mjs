// Pure rules of the shooting mechanic: no browser needed.
//   node tests/shooting-logic.mjs
import * as L from '../src/game/mech/shooting-logic.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- tuning
const t1 = L.tuning('1');
const t2 = L.tuning(undefined);
const t3 = L.tuning(3);
check('difficulty defaults to 2 and clamps', t2.diff === 2 && L.tuning('7').diff === 2 && L.tuning('abc').diff === 2 && t1.diff === 1 && t3.diff === 3);
check('harder = more damage, faster drones, quicker to spot', t1.dmg < t2.dmg && t2.dmg < t3.dmg && t1.speed < t3.speed && t1.spotTime > t2.spotTime && t2.spotTime > t3.spotTime && t1.viewDist < t3.viewDist);
check('attacks are always telegraphed for at least half a second', [t1, t2, t3].every((t) => t.chargeScout >= 0.5 && t.chargeSentinel >= 0.6));
check('the sentinel hits much harder than a scout', L.projectileDamage(1, t2) >= 3 * L.projectileDamage(0, t2) && L.projectileDamage(1, t3) < L.PLAYER_HP);
check('arcade damage scale applies', L.projectileDamage(0, t2, 0.6) === 6);

// ---- vision cone (yaw 0 looks down -z)
check('sees straight ahead', L.inViewCone(0, 0, -6, 0, 13));
check('does not see behind', !L.inViewCone(0, 0, 6, 0, 13));
check('does not see beyond its range', !L.inViewCone(0, 0, -14, 0, 13));
check('sees inside the half-angle only', L.inViewCone(-3, 0, -6, 0, 13) && !L.inViewCone(-8, 0, -4, 0, 13));
check('yaw turns the cone', L.inViewCone(-6, 0, 0, Math.PI / 2, 13) && !L.inViewCone(6, 0, 0, Math.PI / 2, 13));
check('does not see straight up or down', !L.inViewCone(0, -5, -1.5, 0, 13));
check('notices anyone who bumps into it', L.inViewCone(0.3, -0.5, 0.4, 0, 13));
check('crouching shortens the range it sees you at', L.viewRange(t2, true) < L.viewRange(t2, false) * 0.7);
check('close and upright is spotted faster than far and crouched', L.sightFactor(3, 13, false) > L.sightFactor(11, 13, false) && L.sightFactor(5, 13, true) < L.sightFactor(5, 13, false));

// ---- hearing
check('crouch-walking is silent', L.moveNoise(1.7, true, t2) === 0 && L.moveNoise(5.9, true, t2) === 0);
check('standing still is silent', L.moveNoise(0, false, t2) === 0);
check('sprinting is louder than walking, a shot louder still', L.moveNoise(5.9, false, t2) > L.moveNoise(3.5, false, t2) && L.moveNoise(3.5, false, t2) > 0 && t2.hearShot > t2.hearSprint);

// ---- awareness state machine
{
  const a = { st: L.ST_UNAWARE, see: 0, sus: 0 };
  const dt = 0.1;
  L.stepAwareness(a, false, 0, false, dt, t2);
  check('nothing seen, nothing heard: stays unaware', a.st === L.ST_UNAWARE);
  L.stepAwareness(a, true, 1, false, dt, t2);
  check('first glimpse: suspicious, not alert', a.st === L.ST_SUSPICIOUS);
  let steps = 0;
  while (a.st === L.ST_SUSPICIOUS && steps < 100) {
    L.stepAwareness(a, true, 1, false, dt, t2);
    steps++;
  }
  check('staying in view raises the alarm after the spot time', a.st === L.ST_ALERT && near(steps * dt, t2.spotTime, 0.11), `${(steps * dt).toFixed(1)} s`);
  L.stepAwareness(a, false, 0, false, 10, t2);
  check('alert never calms down by itself', a.st === L.ST_ALERT);

  const b = { st: L.ST_UNAWARE, see: 0, sus: 0 };
  L.stepAwareness(b, true, 1, false, dt, t2);
  for (let i = 0; i < 4; i++) L.stepAwareness(b, true, 1, false, dt, t2); // 0.4 s in view
  let calm = 0;
  while (b.st === L.ST_SUSPICIOUS && calm < 200) {
    L.stepAwareness(b, false, 0, false, dt, t2);
    calm++;
  }
  check('breaking line of sight in time: back to unaware after about 2 s', b.st === L.ST_UNAWARE && near(calm * dt, t2.susTime, 0.11), `${(calm * dt).toFixed(1)} s`);

  const c = { st: L.ST_UNAWARE, see: 0, sus: 0 };
  L.stepAwareness(c, false, 0, true, dt, t2);
  check('a noise makes it suspicious', c.st === L.ST_SUSPICIOUS);
  for (let i = 0; i < 100; i++) L.stepAwareness(c, false, 0, true, dt, t2);
  check('noise alone never raises the alarm', c.st === L.ST_SUSPICIOUS);

  const e1 = { st: L.ST_SUSPICIOUS, see: 0, sus: 2 };
  const e3 = { st: L.ST_SUSPICIOUS, see: 0, sus: 2 };
  let n1 = 0;
  let n3 = 0;
  while (e1.st !== L.ST_ALERT && n1 < 100) (L.stepAwareness(e1, true, 1, false, dt, t1), n1++);
  while (e3.st !== L.ST_ALERT && n3 < 100) (L.stepAwareness(e3, true, 1, false, dt, t3), n3++);
  check('difficulty 1 reacts slower than difficulty 3', n1 > n3, `${n1} vs ${n3} steps`);
}

// ---- takedown (drone at origin looking down -z, so "behind" is +z)
check('takedown from behind an unaware drone', L.canTakedown(L.ST_UNAWARE, 0, 1.5, 0));
check('no takedown from the front', !L.canTakedown(L.ST_UNAWARE, 0, -1.5, 0));
check('no takedown from too far away', !L.canTakedown(L.ST_UNAWARE, 0, 3.5, 0));
check('no takedown on a suspicious or alert drone', !L.canTakedown(L.ST_SUSPICIOUS, 0, 1.5, 0) && !L.canTakedown(L.ST_ALERT, 0, 1.5, 0));

// ---- damage
check('a scout takes two hits', L.resolveHit('scout', 'body', false, 1).dmg * 2 >= L.SCOUT_HP && L.resolveHit('scout', 'core', false, -1).dmg === 1);
check('the shield absorbs everything from the front', L.resolveHit('sentinel', 'body', true, 0.9).dmg === 0 && L.resolveHit('sentinel', 'core', true, 0.9).part === 'shield');
check('the core only counts from behind', L.resolveHit('sentinel', 'core', true, -0.8).part === 'core' && L.resolveHit('sentinel', 'core', false, 0.6).part === 'body');
check('two core hits destroy a sentinel', L.resolveHit('sentinel', 'core', true, -0.8).dmg * 2 >= L.SENTINEL_HP);
check('side armour chips away slowly', L.resolveHit('sentinel', 'body', true, 0).dmg === 1);
check('an overloaded shield leaves it exposed', L.resolveHit('sentinel', 'body', false, 0.9).dmg === 2);

// ---- health
check('no regeneration right after a hit', L.regen(40, 1, 1) === 40);
check('regenerates after four seconds without damage', L.regen(40, 4.1, 1) > 40 && L.regen(99, 10, 1) === L.PLAYER_HP);
check('a downed player does not regenerate', L.regen(0, 10, 1) === 0);

// ---- waves
{
  const solo = L.wavePlan(2, 1);
  const four = L.wavePlan(2, 4);
  check('hold lasts about a minute', L.wavePlan(1, 1).holdMs === 50000 && solo.holdMs === 60000 && L.wavePlan(3, 1).holdMs === 70000);
  check('more players and more difficulty: more drones at once', four.cap > solo.cap && L.wavePlan(3, 1).cap > L.wavePlan(1, 1).cap && four.cap <= 12);
  check('waves grow, then level off', L.waveSize(0, 2, 1) < L.waveSize(4, 2, 1) && L.waveSize(20, 2, 1) === L.waveSize(40, 2, 1));
  check('a wave never exceeds the cap', L.spawnCount(5, 3, 4) === 1 && L.spawnCount(5, 4, 4) === 0 && L.spawnCount(2, 0, 4) === 2);
  let total = 0;
  for (let w = 0; w * solo.gap * 1000 < solo.holdMs; w++) total += L.waveSize(w, 2, 1);
  check('solo on difficulty 2 faces a few dozen scouts at most', total >= 20 && total <= 45, `${total} drones`);
}
check('stars: clean and fast is 3, a few fails 2, many 1', L.stars(0, 100000, 200000) === 3 && L.stars(0, 300000, 200000) === 2 && L.stars(2, 1, 200000) === 2 && L.stars(3, 1, 200000) === 1);

// ---- geometry
check('ray hits a sphere in front', near(L.raySphere(0, 0, 0, 0, 0, -1, 0, 0, -5, 1), 4));
check('ray misses a sphere to the side or behind', L.raySphere(0, 0, 0, 0, 0, -1, 3, 0, -5, 1) === -1 && L.raySphere(0, 0, 0, 0, 0, -1, 0, 0, 5, 1) === -1);
check('projectile path through a standing player hits', L.segmentHitsCapsule(-1, 1, 0, 1, 1, 0, 0, 0.25, 1.6, 0, 0.4));
check('projectile passing beside the player misses', !L.segmentHitsCapsule(-1, 1, 1, 1, 1, 1, 0, 0.25, 1.6, 0, 0.4));
check('projectile over a crouching player misses, same shot hits a standing one', !L.segmentHitsCapsule(-1, 1.6, 0, 1, 1.6, 0, 0, 0.25, 0.95, 0, 0.4) && L.segmentHitsCapsule(-1, 1.6, 0, 1, 1.6, 0, 0, 0.25, 1.63, 0, 0.4));
check('projectile that stops short misses', !L.segmentHitsCapsule(-3, 1, 0, -1, 1, 0, 0, 0.25, 1.6, 0, 0.4));
check('turning is rate-limited and takes the short way', near(L.turnTowards(0, 1, 0.25), 0.25) && near(L.turnTowards(3, -3, 0.1), 3.1) && L.turnTowards(0, 0.1, 0.25) === 0.1);
check('yawTo matches the forward convention', near(L.forwardX(L.yawTo(3, 0)), 1) && near(L.forwardZ(L.yawTo(0, -2)), -1));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
