// Character-controller regression test (no browser needed).
//
// Background: pushing the capsule down into the floor every frame ("stick to
// ground" gravity) makes Rapier's character controller drop the horizontal part
// of the move on a few percent of frames. In game that reads as stutter. The
// game therefore applies no vertical movement while grounded and relies on
// snap-to-ground. This file proves the difference and guards the behaviour.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();

const R = 0.32;
const H = 1.78;

function makeWorld(build) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.15, 30).setTranslation(0, -0.15, 0));
  build?.(world);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, H / 2 + 0.03, 0));
  const col = world.createCollider(RAPIER.ColliderDesc.capsule(H / 2 - R, R), body);
  const kcc = world.createCharacterController(0.02);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(0.32, 0.2, false);
  kcc.enableSnapToGround(0.3);
  kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
  kcc.setSlideEnabled(true);
  world.step();
  let vy = 0;
  let grounded = false;
  const stats = { steps: 0, stalled: 0, airborne: 0 };
  // on a slope part of the horizontal move turns into height, so the bar is lower there
  let stallBelow = 0.9;
  /** mode 'game' = what src/game/player.ts does; 'push' = the old behaviour. */
  const step = (dx, dz, dt, mode = 'game') => {
    let dy = 0;
    if (mode === 'game') {
      if (grounded && vy < 0) vy = 0;
      if (!grounded || vy > 0) {
        vy = Math.max(-40, vy - 22 * dt);
        dy = vy * dt;
      }
    } else {
      if (grounded && vy < 0) vy = -2;
      vy -= 22 * dt;
      dy = vy * dt;
    }
    kcc.computeColliderMovement(col, { x: dx, y: dy, z: dz });
    const m = kcc.computedMovement();
    grounded = kcc.computedGrounded();
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    world.step();
    stats.steps++;
    if (!grounded) stats.airborne++;
    if (Math.hypot(m.x, m.z) < Math.hypot(dx, dz) * stallBelow) stats.stalled++;
  };
  const pos = () => {
    const t = body.translation();
    return { x: t.x, y: t.y - H / 2, z: t.z };
  };
  return { step, pos, stats, setStallBar: (v) => (stallBelow = v) };
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

// --- flat floor, 20,000 frames with mixed frame times, wandering directions
function wander(mode) {
  const w = makeWorld();
  let rng = 12345;
  const rand = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
  let ang = Math.PI;
  for (let i = 0; i < 60; i++) w.step(0, 0, 1 / 120, mode); // settle
  w.stats.steps = w.stats.stalled = w.stats.airborne = 0;
  for (let i = 0; i < 20000; i++) {
    const r = rand();
    const dt = r < 0.7 ? 1 / 120 : r < 0.9 ? 1 / 60 : r < 0.97 ? 1 / 30 : 0.004;
    if (i % 300 === 0) ang += 2.2;
    const speed = i % 2000 < 1000 ? 3.5 : 5.9;
    w.step(Math.sin(ang) * speed * dt, Math.cos(ang) * speed * dt, dt, mode);
    const p = w.pos();
    if (Math.abs(p.x) > 20 || Math.abs(p.z) > 20) ang = Math.atan2(-p.x, -p.z);
  }
  return w.stats;
}
const old = wander('push');
const now = wander('game');
console.log(`old behaviour (push into floor): ${old.stalled} of ${old.steps} frames stalled (${((100 * old.stalled) / old.steps).toFixed(1)} %)`);
check('flat floor: no stalled frames in 20,000', now.stalled === 0, JSON.stringify(now));
check('flat floor: always grounded', now.airborne === 0);

const dt = 1 / 120;
{
  // curb, 0.25 m high
  const w = makeWorld((world) => world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.125, 3).setTranslation(0, 0.125, -5)));
  for (let i = 0; i < 150; i++) w.step(0, -3.5 * dt, dt);
  const p = w.pos();
  check('steps up a 0.25 m curb', p.z < -3 && Math.abs(p.y - 0.27) < 0.03, `feet ${p.y.toFixed(3)} z ${p.z.toFixed(2)}`);
}
{
  // 25 degree ramp up to a platform, then back down
  const ang = (25 * Math.PI) / 180;
  const top = Math.sin(ang) * 6;
  const zEnd = -3 - Math.cos(ang) * 6;
  const w = makeWorld((world) => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 0.1, 3)
        .setTranslation(0, Math.sin(ang) * 3 - 0.1 / Math.cos(ang), -3 - Math.cos(ang) * 3)
        .setRotation({ x: Math.sin(ang / 2), y: 0, z: 0, w: Math.cos(ang / 2) }),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, top / 2, 3).setTranslation(0, top / 2 - 0.02, zEnd - 3));
  });
  w.setStallBar(0.6);
  for (let i = 0; i < 420; i++) w.step(0, -3.5 * dt, dt);
  const up = w.pos();
  const upStats = { ...w.stats };
  for (let i = 0; i < 440; i++) w.step(0, 3.5 * dt, dt);
  const down = w.pos();
  check('walks up a 25° ramp without stalling', Math.abs(up.y - top) < 0.06 && upStats.stalled === 0, `feet ${up.y.toFixed(3)} of ${top.toFixed(3)}`);
  check('walks back down without leaving the ground', down.y < 0.05 && w.stats.airborne === 0 && w.stats.stalled === 0, JSON.stringify(w.stats));
}
{
  // walk off a 1 m ledge: fall, land, keep walking
  const w = makeWorld((world) => world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, 3).setTranslation(0, 0.5, 0)));
  for (let i = 0; i < 60; i++) w.step(0, 0, dt);
  const onTop = w.pos();
  for (let i = 0; i < 360; i++) w.step(0, 3.5 * dt, dt);
  const p = w.pos();
  check('falls off a 1 m ledge and lands', Math.abs(onTop.y - 1.02) < 0.03 && Math.abs(p.y - 0.02) < 0.03 && w.stats.airborne > 10 && w.stats.airborne < 60, `airborne frames ${w.stats.airborne}`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
