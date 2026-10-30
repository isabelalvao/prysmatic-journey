// Silent Orbit no browser: preload completo (música, geometria, texturas, shaders) antes de começar;
// o rato controla a vista (pointer lock) e o olhar faz o que as mãos faziam na versão Synth.
import * as THREE from 'three';
import { parseScene } from './data.js';
import { World } from './world.js';
import { Gaze } from './gaze.js';
import { AudioEngine, ChordMap, PointMusic } from './audio.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const BASE = import.meta.env.BASE_URL;
const $ = (id) => document.getElementById(id);
const overlay = $('overlay'), bar = $('bar'), status = $('status'), start = $('start'), hint = $('hint'), hud = $('hud');

// ---- preload ----
async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) { const b = await response.arrayBuffer(); onProgress(b.byteLength, b.byteLength); return b; }
  const reader = response.body.getReader();
  const out = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > out.length) {   // content-length comprimido: crescer
      const bigger = new Uint8Array(Math.max(out.length * 2, received + value.length)); bigger.set(out.subarray(0, received));
      return finishGrow(reader, bigger, received, value, total, onProgress);
    }
    out.set(value, received); received += value.length;
    onProgress(received, total);
  }
  onProgress(total, total);
  return out.buffer.slice(0, received);
}
async function finishGrow(reader, buffer, received, value, total, onProgress) {
  buffer.set(value, received); received += value.length;
  for (;;) {
    const { done, value: v } = await reader.read();
    if (done) break;
    if (received + v.length > buffer.length) { const b = new Uint8Array(buffer.length * 2); b.set(buffer.subarray(0, received)); buffer = b; }
    buffer.set(v, received); received += v.length; onProgress(Math.min(received, total), total);
  }
  onProgress(total, total);
  return buffer.buffer.slice(0, received);
}

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, (t) => {
    // Como no bgfx: RGBA8 linear, sem mipmaps, repetição, origem em cima (flipY desligado).
    t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true; resolve(t);
  }, undefined, reject));
}

const weights = { manifest: 1, scene: 25, audio: 50, decode: 8, build: 6, warm: 10 };
const done = {};
function progress(key, fraction, text) {
  done[key] = Math.min(Math.max(fraction, 0), 1);
  let sum = 0, all = 0;
  for (const [k, w] of Object.entries(weights)) { all += w; sum += (done[k] || 0) * w; }
  bar.style.width = `${(100 * sum / all).toFixed(1)}%`;
  if (text) status.textContent = text;
}

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // a composição já aplica ACES e gama
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
const scale = Number(params.get('scale')) || Math.min(window.devicePixelRatio || 1, 2);

let world, gaze, audio, music, data;
const look = { yaw: 0, pitch: 0 };

function size() {
  const w = Math.max(1, Math.round(window.innerWidth * scale)), h = Math.max(1, Math.round(window.innerHeight * scale));
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  canvas.style.width = '100vw'; canvas.style.height = '100vh';
  world?.resize(w, h);
}

async function preload() {
  try {
    progress('manifest', 0, 'A carregar a cena…');
    const [manifest, chords, textures] = await Promise.all([
      fetch(BASE + 'data/manifest.json').then((r) => r.json()),
      fetch(BASE + 'data/chords.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      Promise.all([0, 1, 2].map((i) => loadTexture(`${BASE}textures/detail${i}.png`))),
    ]);
    progress('manifest', 1);
    audio = new AudioEngine();
    const audioUrl = BASE + AudioEngine.preferredUrl('audio/silent-orbit');
    const [scene, sound] = await Promise.all([
      fetchWithProgress(BASE + 'data/scene.bin', (r, t) => progress('scene', r / t, 'A carregar a geometria e a música…')),
      fetchWithProgress(audioUrl, (r, t) => progress('audio', r / t)),
    ]);
    progress('decode', 0, 'A descodificar a música…');
    await audio.load(sound);
    await audio.setupSynth();
    progress('decode', 1, 'A preparar a geometria…');
    await new Promise((r) => setTimeout(r, 0));
    data = parseScene(manifest, scene);
    world = new World(renderer, data, textures);
    gaze = new Gaze(data.C.S);
    music = new PointMusic(new ChordMap(chords));
    size();
    progress('build', 1, 'A compilar os shaders…');
    // Aquecimento: desenhar momentos de todas as fases cria os materiais, as instâncias e os programas
    // da GPU antes de a música começar (por trás do ecrã de carregamento).
    const end = world.playbackEnd;
    const samples = [1, 20, 45, 70, 100, 130, 150, 175, 200, 225, 250, 275, 300, end - 2].filter((t) => t < end);
    for (let i = 0; i < samples.length; ++i) {
      world.render(samples[i], look, null);
      await new Promise((r) => requestAnimationFrame(r));
      progress('warm', (i + 1) / samples.length);
    }
    world.render(0, look, null);
    progress('warm', 1, 'Pronto.');
    start.disabled = false;
    start.textContent = 'Começar';
    hint.textContent = 'Usa auscultadores. Move o rato para olhar; Esc liberta o rato.';
  } catch (e) {
    console.error(e);
    status.textContent = `Não foi possível carregar: ${e.message}`;
  }
}

// ---- interação ----
let started = false, ended = false;
const SENSITIVITY = 0.0022;
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  look.yaw += e.movementX * SENSITIVITY;
  look.pitch = Math.min(Math.max(look.pitch - e.movementY * SENSITIVITY, -80 * Math.PI / 180), 80 * Math.PI / 180);
  if (e.movementX || e.movementY) gaze?.moved(performance.now() / 1000);
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  $('lock').hidden = locked || !started || ended;
});
canvas.addEventListener('click', () => { if (started && !ended) canvas.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => canvas.requestPointerLock()); });
$('lock').addEventListener('click', () => canvas.requestPointerLock());

start.addEventListener('click', async () => {
  await audio.ctx.resume();
  overlay.hidden = true;
  started = true; ended = false;
  look.yaw = 0; look.pitch = 0;
  music.reset();
  audio.play(Number(params.get('t')) || 0);
  canvas.requestPointerLock?.();
});
window.addEventListener('keydown', (e) => {
  if (!started || !DEBUG) return;
  if (e.code === 'Space') { audio.playing ? audio.pause() : audio.play(audio.offset); e.preventDefault(); }
  if (e.code === 'ArrowRight') { audio.seek(audio.graphSeconds() + 10); music.reset(); }
  if (e.code === 'ArrowLeft') { audio.seek(audio.graphSeconds() - 10); music.reset(); }
});
window.addEventListener('resize', size);

// ---- ciclo ----
let frames = 0, fpsTime = performance.now(), fps = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!world || !started) return;
  const now = performance.now();
  let t = audio.heardSeconds();
  if (t >= world.playbackEnd || audio.ended()) {
    if (!ended) {
      ended = true; audio.stop(); document.exitPointerLock?.();
      overlay.hidden = false; status.textContent = 'Fim.'; start.textContent = 'Recomeçar'; hint.textContent = '';
      $('lock').hidden = true;
    }
    t = world.playbackEnd - 1e-3;
  }
  world.render(t, look, gaze);
  if (!ended) audio.playNotes(music.update(audio.graphSeconds(), world.forward, gaze.active(now / 1000)));
  ++frames;
  if (now - fpsTime > 500) { fps = frames * 1000 / (now - fpsTime); frames = 0; fpsTime = now; }
  if (DEBUG) hud.textContent = `t ${t.toFixed(2)} s · ${fps.toFixed(0)} fps · ${world.drawCount()} desenhos · ${gaze.profile.describe()}`;
}

// Modo de captura (testes): ?capture=t1,t2,… desenha esses tempos sem música nem interação.
window.__silentOrbit = {
  get world() { return world; }, get gaze() { return gaze; }, get audio() { return audio; }, THREE,
  ready: () => !!world && !start.disabled,
  renderAt: (t, yaw = 0, pitch = 0, gazeOn = false) => {
    look.yaw = yaw; look.pitch = pitch;
    if (gazeOn) gaze.moved(performance.now() / 1000);
    world.render(t, look, gazeOn ? gaze : null);
    return world.drawCount();
  },
};

hud.hidden = !DEBUG;
requestAnimationFrame(frame);
preload();
