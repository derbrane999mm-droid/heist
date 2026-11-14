import * as THREE from 'three';
import { Engine } from './core/engine';
import { Physics } from './core/physics';
import { AudioEngine } from './core/audio';
import { Input } from './core/input';
import { settings, playerId } from './core/settings';
import { t, missingTranslations } from './core/i18n';
import { createMaterials } from './game/materials';
import { Interactions } from './game/interact';
import { Viewmodel } from './game/viewmodel';
import { initRealMats, texturesReady } from './game/realmats';
import { preloadModels } from './game/models';
import { Player } from './game/player';
import { Avatar } from './game/avatar';
import { LEVELS, LEVEL_MODELS } from './game/levels';
import type { Level } from './game/level';
import { Session, normalizeCode, MAX_PLAYERS, type JoinError } from './net/session';
import { Voice } from './net/voice';
import { UI, type CrewRow } from './ui/ui';
import { LineupView, installLineupHost, roleOf } from './game/lineup';
import { resetCampaign } from './core/save';

type Mode = 'menu' | 'playing';

async function boot() {
  const t0 = performance.now();
  const stage = (name: string) => console.debug(`[nv] ${name} +${Math.round(performance.now() - t0)}ms`);
  const q = new URLSearchParams(location.search);
  const invite = normalizeCode(q.get('c') || location.hash.replace('#', '') || '');
  let mode: Mode = 'menu';
  let session: Session | null = null;
  let voice: Voice | null = null;
  let player: Player | null = null;
  let level: Level;
  const avatars = new Map<string, Avatar>();

  const ui = new UI(
    document.getElementById('ui')!,
    {
      onCreate: () => void start(null),
      onJoin: (code) => void start(code),
      onResume: () => void resume(),
      onLeave: () => leave(),
      onInvite: () => void copyInvite(),
      onSound: (k) => audio.play(k),
      onReset: () => resetCampaign(),
    },
    invite.length === 5 ? invite : null,
  );

  let engine: Engine;
  try {
    engine = new Engine(document.getElementById('view')!);
  } catch (e) {
    console.error('[nv] renderer failed to start', e);
    ui.fatal(t('err.webgl'));
    return;
  }
  const audio = new AudioEngine();
  const input = new Input(engine.renderer.domElement);
  stage('engine');

  // fonts first: in-world screens are drawn to canvases with them
  try {
    await Promise.all([
      document.fonts.load('600 32px "Chakra Petch"'),
      document.fonts.load('700 32px "Chakra Petch"'),
      document.fonts.load('500 32px "Chakra Petch"'),
      document.fonts.load('400 32px "Chakra Petch"'),
      document.fonts.load('500 32px "JetBrains Mono"'),
    ]);
  } catch {
    /* fall back to system fonts */
  }

  stage('fonts');
  const physics = await Physics.create();
  stage('physics');
  const mats = createMaterials(Math.min(8, engine.renderer.capabilities.getMaxAnisotropy()), engine.quality.name !== 'low');
  stage('materials');
  await initRealMats(Math.min(8, engine.renderer.capabilities.getMaxAnisotropy()));
  const interactions = new Interactions(physics, input);
  const lineupView = new LineupView(document.getElementById('ui')!, input, audio, ui);
  // Every light that can ever exist is created now. The number of lights is part
  // of each compiled shader, so adding one later would recompile everything.
  const flashlight = Player.createFlashlight(engine);
  const viewmodel = new Viewmodel(engine, flashlight);
  await viewmodel.ready;
  const lightPool: THREE.SpotLight[] = [];
  const lightHome = new THREE.Group();
  engine.scene.add(lightHome);
  for (let i = 0; i < MAX_PLAYERS - 1; i++) {
    const l = new THREE.SpotLight(0xdfe9ff, 0, 18, 0.44, 0.5, 1.5);
    lightHome.add(l, l.target);
    lightPool.push(l);
  }
  engine.onQualityApplied = (qp) => {
    flashlight.castShadow = qp.shadows && qp.name !== 'medium';
  };

  const levelName = q.get('level') ?? 'hideout';
  await preloadModels(LEVEL_MODELS[levelName] ?? []);
  const options = Object.fromEntries(q.entries());
  level = (LEVELS[levelName] ?? LEVELS.hideout)({ engine, physics, audio, mats, interactions, input, ui, player: () => player, options });

  await texturesReady();
  // compile everything behind the loading screen (including a crew member's suit)
  {
    const dummy = new Avatar(engine.scene, 'warm-up', 0, lightPool[0]);
    dummy.group.visible = true;
    dummy.group.position.set(0, 0, 3);
    level.menuCamera(0, engine.camera);
    engine.warmUp();
    dummy.dispose();
  }
  stage('level');
  void document.fonts.ready.then(() => level.redraw());

  engine.onAutoQuality = (qn) => ui.toast(t('toast.quality', { q: t('set.q.' + qn) }));

  // -------------------------------------------------------------- session flow

  function describeJoinError(e: JoinError, code: string): string {
    switch (e) {
      case 'not-found':
        return t('toast.notFound', { code });
      case 'blocked':
        return t('toast.blocked');
      case 'no-server':
        return t('toast.noServer');
      case 'full':
        return t('toast.full');
      case 'version':
        return t('toast.version');
      default:
        return t('err.webgl');
    }
  }

  async function start(joinCode: string | null) {
    if (session) return;
    audio.init();
    const code = joinCode !== null ? normalizeCode(joinCode) : null;
    if (code !== null && code.length !== 5) {
      ui.setError(t('toast.notFound', { code: code || '—' }));
      return;
    }
    ui.setError('');
    ui.setBusy(true);
    const name = settings.get('name') || 'Crew ' + Math.floor(10 + Math.random() * 89);
    const pid = playerId() + (q.get('pid') ?? ''); // ?pid= lets one browser run several test players
    let s: Session;
    try {
      s = code === null ? await Session.host(pid, name, settings.get('color')) : await Session.join(code, pid, name, settings.get('color'));
    } catch (e) {
      ui.setBusy(false);
      ui.setError(describeJoinError(e as JoinError, code ?? ''));
      return;
    }
    session = s;

    if (s.peer) {
      voice = new Voice(audio, s.peer);
      const mic = voice.enableMic();
      const ok = await Promise.race([mic, new Promise<null>((r) => window.setTimeout(() => r(null), 12000))]);
      if (ok === false) ui.toast(t('toast.micDenied'), 'warn', 6000);
      void mic.then((granted) => {
        if (ok === null && !granted) ui.toast(t('toast.micDenied'), 'warn', 6000);
      });
    }
    if (session !== s) return; // left while waiting for the microphone prompt

    const order = [...s.players.keys()];
    const sp = level.spawn(Math.max(0, order.indexOf(s.pid)));
    player = new Player(engine, physics, input, audio, sp.pos, sp.yaw, flashlight);

    s.onRoster = (joined, left) => {
      syncCrew();
      if (joined && joined.pid !== s.pid) {
        ui.toast(t('toast.joined', { name: joined.name }));
        audio.play('join');
      }
      if (left) {
        ui.toast(t('toast.left', { name: left.name }));
        audio.play('leave');
      }
    };
    s.onPose = (p, pose) => avatars.get(p)?.push(pose, performance.now() / 1000);
    s.onStatus = (st) => {
      if (st === 'reconnecting') ui.toast(t('toast.reconnecting'), 'warn');
      else if (st === 'online') ui.toast(t('toast.reconnected'));
      else if (st === 'closed') {
        leave();
        ui.setError(t('toast.hostLost'));
      }
    };
    level.attach(s);
    if (s.isHost) installLineupHost(s);
    lineupView.attach(s);
    syncCrew();

    mode = 'playing';
    ui.clearSubtitles();
    ui.showMenu('none');
    audio.startAmbience();
    if (s.status === 'offline') ui.toast(t('toast.offline'), 'warn', 9000);
    window.setTimeout(() => ui.fadeHint(), 30000);
    const locked = await input.lock();
    if (!locked || !input.locked) {
      window.setTimeout(() => {
        if (mode === 'playing' && !input.locked && !(window as any).__nvNoPause) ui.showMenu('pause');
      }, 250);
    }
  }

  function syncCrew() {
    if (!session) return;
    for (const p of session.players.values()) {
      if (p.pid === session.pid) continue;
      const a = avatars.get(p.pid);
      if (!a) avatars.set(p.pid, new Avatar(engine.scene, p.name, p.color, lightPool.pop() ?? null));
      else a.setName(p.name, p.color);
    }
    for (const [pid, a] of avatars) {
      if (!session.players.has(pid)) {
        const l = a.releaseLight();
        if (l) lightPool.push(l);
        a.dispose();
        avatars.delete(pid);
      }
    }
    voice?.sync(session.remotePeers());
  }

  async function resume() {
    if (mode !== 'playing') return;
    audio.init();
    const ok = await input.lock();
    if (ok) ui.showMenu('none');
  }

  function leave() {
    if (!session) return;
    lineupView.detach();
    level.detach();
    voice?.dispose();
    voice = null;
    session.leave();
    session = null;
    for (const a of avatars.values()) {
      const l = a.releaseLight();
      if (l) lightPool.push(l);
      a.dispose();
    }
    avatars.clear();
    player?.body.dispose();
    player = null;
    flashlight.intensity = 0;
    mode = 'menu';
    input.unlock();
    ui.clearSubtitles();
    ui.setPrompt(null);
    ui.setObjective([]);
    ui.showMenu('main');
  }

  async function copyInvite() {
    if (!session?.code) return;
    const url = `${location.origin}${location.pathname}?c=${session.code}`;
    try {
      await navigator.clipboard.writeText(url);
      ui.toast(t('menu.invite.done'));
    } catch {
      ui.toast(url, '', 12000);
    }
  }

  input.onLockChange = (locked) => {
    if (mode !== 'playing') return;
    if (!locked) {
      if (!(window as any).__nvNoPause) ui.showMenu('pause');
    } else ui.showMenu('none');
  };

  window.addEventListener('beforeunload', () => session?.leave());

  // -------------------------------------------------------------- frame loop

  let slowTick = 0;
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  engine.onUpdate((dt, time) => {
    const playing = mode === 'playing' && player !== null && session !== null;
    const inControl = playing && (input.locked || (window as any).__nvNoPause === true);
    input.enabled = inControl;
    viewmodel.setVisible(playing);

    if (playing) {
      player!.control = inControl;
      player!.update(dt);
      session!.sendPose(player!.pose());
      interactions.update(player!.eye, player!.forward, player!.body.collider, inControl);
      viewmodel.update(dt, player!, interactions, physics);
      ui.setPrompt(interactions.promptText);
      lineupView.update();

      if (input.justPressed('mute')) {
        settings.set('micMuted', !settings.get('micMuted'));
        audio.play('ui');
      }
      voice?.setTalkHeld(input.held('talk'));
    } else {
      level.menuCamera(time, engine.camera);
      input.consumeMouse();
    }

    const now = performance.now() / 1000;
    for (const [pid, a] of avatars) {
      a.update(dt, now, time);
      voice?.setPosition(pid, a.headPos);
    }

    level.update(dt, time);
    physics.step();

    engine.camera.getWorldPosition(camPos);
    engine.camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(engine.camera.quaternion);
    audio.setListener(camPos, fwd, up);

    slowTick += dt;
    if (slowTick > 0.1) {
      slowTick = 0;
      voice?.update();
      if (session) {
        const rows: CrewRow[] = [];
        for (const p of session.players.values()) {
          const you = p.pid === session.pid;
          const talking = you ? (voice?.speaking ?? false) : (voice?.isTalking(p.pid) ?? false);
          const role = roleOf(session, p.pid);
          const roleLabel = role ? t(`role.${role}.short`) : '';
          rows.push({ name: p.name, role: roleLabel, color: p.color, you, host: p.host, talking });
          if (!you) {
            const av = avatars.get(p.pid);
            av?.setTalking(talking);
            av?.setRole(roleLabel);
          }
        }
        ui.setCrew(session.code, rows);
        ui.setMic(voice ? voice.micState() : 'off', voice?.speaking ?? false);
        ui.setObjective(level.objective());
        ui.setStats(settings.get('showFps') ? `${Math.round(engine.fps)} fps${session.isHost ? '' : ` · ${Math.round(session.ping)} ms`}` : '');
      }
    }
    input.endFrame();
  });

  engine.start();
  ui.showMenu('main');
  ui.hideBoot();

  // test / debug hooks
  (window as any).__nv = {
    engine,
    input,
    ui,
    interactions,
    get session() {
      return session;
    },
    get player() {
      return player;
    },
    get voice() {
      return voice;
    },
    avatars,
    viewmodel,
    start,
    leave,
    level,
    lineupView,
    missingTranslations,
    /** Teleport the local player (tests and screenshots). */
    tp(x: number, y: number, z: number, yaw = 0, pitch = 0) {
      if (!player) return;
      player.teleport(new THREE.Vector3(x, y, z), yaw);
      player.pitch = pitch;
    },
  };
}

void boot();
