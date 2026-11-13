import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import RAPIER from '@dimforge/rapier3d-compat';
import { Peer } from 'peerjs';

const log = (window.__log = []);
const say = (m) => { log.push(m); console.log('[spike]', m); };

// ---- render
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
say('webgl2=' + (gl instanceof WebGL2RenderingContext) + ' renderer=' + gl.getParameter(gl.RENDERER));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
cam.position.set(0, 1.6, 4);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.25, metalness: 0.6 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.8 }));
box.position.y = 0.5; box.castShadow = true; scene.add(box);
const strip = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x00e5ff, emissiveIntensity: 6 }));
strip.position.set(0, 2.4, -1); scene.add(strip);
const spot = new THREE.SpotLight(0xffb070, 60, 12, 0.6, 0.5); spot.position.set(2, 3.5, 2); spot.castShadow = true; scene.add(spot);
scene.add(new THREE.HemisphereLight(0x8090ff, 0x101010, 0.3));
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, cam));
composer.addPass(new EffectPass(cam, new BloomEffect({ intensity: 1.2, luminanceThreshold: 0.9, mipmapBlur: true }), new SMAAEffect(), new VignetteEffect(), new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
let frames = 0;
renderer.setAnimationLoop(() => { box.rotation.y += 0.01; composer.render(); frames++; window.__frames = frames; });

// ---- physics
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
for (let i = 0; i < 120; i++) world.step();
say('rapier ball y=' + body.translation().y.toFixed(3));

// ---- net
const q = new URLSearchParams(location.search);
const role = q.get('role');
if (role) {
  const opts = { host: '127.0.0.1', port: 9000, path: '/', secure: false, debug: 1 };
  const peer = new Peer(role === 'host' ? 'spike-host' : undefined, opts);
  peer.on('error', (e) => say('peer error ' + e.type));
  peer.on('open', async (id) => {
    say('open ' + id);
    if (role === 'host') {
      peer.on('connection', (c) => {
        say('incoming ' + c.label + ' reliable=' + c.reliable);
        c.on('data', (d) => { say('host got ' + JSON.stringify(d)); c.send({ pong: d.ping }); });
      });
      peer.on('call', async (call) => {
        say('host incoming call');
        let s; try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); say('host gum ok'); } catch (e) { say('host gum fail ' + e.name + ' ' + e.message); return; }
        call.answer(s);
        call.on('stream', (rs) => say('host got remote audio tracks=' + rs.getAudioTracks().length));
      });
    } else {
      const c = peer.connect('spike-host', { reliable: true, label: 'rel' });
      c.on('open', () => { say('client rel open'); c.send({ ping: 1 }); });
      c.on('data', (d) => say('client got ' + JSON.stringify(d)));
      const u = peer.connect('spike-host', { reliable: false, label: 'unrel' });
      u.on('open', () => { say('client unrel open'); u.send({ ping: 2 }); });
      u.on('data', (d) => say('client got(unrel) ' + JSON.stringify(d)));
      let s; try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); say('client gum ok'); } catch (e) { say('client gum fail ' + e.name + ' ' + e.message); return; }
      const call = peer.call('spike-host', s);
      call.on('error', (e) => say('call error ' + e));
      call.on('stream', (rs) => say('client got remote audio tracks=' + rs.getAudioTracks().length));
    }
  });
}
