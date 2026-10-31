// Mãos em VR (WebXR hand tracking), como a versão Synth do Prismatic-Pontos:
// port de interaction/hand_response.cpp (apontar cabeça→palma, mão aberta, gestos secos → eco),
// do preenchimento de u_point/u_trail em Renderer::update_hand_response e de audio/point_music.cpp.
// Posições no espaço «local» do WebXR (metros, -z à frente), como o espaço LOCAL do OpenXR no original.
import { ResponseProfile, PointTrail, CONE_COS } from './gaze.js';
import { pointNote } from './audio.js';

const REACH_START = 0.35, REACH_FULL = 0.55;              // distância horizontal cabeça–palma (m)
const STROKE_ON = 1.0, STROKE_REARM = 0.3, STROKE_MERGE = 0.12;
const PHRASE_GAP = 1.5, PHRASE_END = 0.9, ECHO_DECAY = 0.3, PHRASE_MAX = 4;
const TRIGGER_START = 0.1, TRIGGER_FULL = 0.9;
const CONTAINED = 0.4, OPEN_CLOSED = 1.35, OPEN_OPEN = 1.75;
const ECHO_VARIED_STRETCH = 1.5;
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Lê as articulações de uma XRHand com os índices do OpenXR (o WebXR tem as mesmas 25 pela mesma ordem, sem a
// palma): points[0] é a palma do OpenXR, o centro do metacarpo médio (meio entre a base do metacarpo e a falange
// proximal do médio). points/radii: metros no espaço local; null quando a articulação não está a ser seguida.
function readHand(frame, hand, space) {
  const points = new Array(26).fill(null), radii = new Array(26).fill(0);
  let i = 1;
  for (const joint of hand.values()) {
    const pose = frame.getJointPose(joint, space);
    if (pose && !pose.emulatedPosition) {
      const p = pose.transform.position;
      if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) { points[i] = [p.x, p.y, p.z]; radii[i] = pose.radius; }
    }
    if (++i > 25) break;
  }
  const base = points[11], proximal = points[12];
  if (base && proximal) { points[0] = [(base[0] + proximal[0]) / 2, (base[1] + proximal[1]) / 2, (base[2] + proximal[2]) / 2]; radii[0] = radii[11]; }
  const palm = points[0];
  if (!palm) return null;
  // hand_openness: distância média das pontas à palma relativa à das falanges proximais.
  let ratio = 0, fingers = 0;
  for (let f = 0; f < 4; ++f) {
    const proximalJoint = points[7 + 5 * f], tip = points[10 + 5 * f];
    if (!proximalJoint || !tip) continue;
    const baseLength = len(sub(proximalJoint, palm));
    if (baseLength < 0.01) continue;
    ratio += len(sub(tip, palm)) / baseLength; ++fingers;
  }
  const open = fingers >= 3 ? smoothstep(OPEN_CLOSED, OPEN_OPEN, ratio / fingers) : 0;
  return { palm, open, points, radii };
}

class HandResponse {
  constructor() { this.style = 'same'; this.reset(); }
  reset() {
    this.rays = [0, 1].map(() => ({ valid: false, controller: false, head: [0, 0, 0], palm: [0, 0, 0], strength: 0, openness: 0 }));
    this.previous = [null, null]; this.armed = [true, true]; this.pointing = [false, false]; this.opened = [false, false]; this.source = [0, 0];
    this.lastTime = null; this.phrase = []; this.pulses = []; this.overflow = false; this.echoUntil = 0; this.fired = 0; this.echo = 0;
  }
  echoing() { return this.pulses.length > 0 || this.echoUntil > 0; }
  // obs: {time (s), head [x,y,z] ou null, hands: [{palm, open} | null] ×2, controllers: [{position, forward, trigger} | null] ×2}
  update(obs) {
    const events = [];
    if (!obs.head) { this.previous = [null, null]; for (const r of this.rays) { r.valid = false; r.strength = 0; } return events; }
    const now = obs.time;
    if (this.lastTime !== null && now <= this.lastTime) { this.previous = [null, null]; this.phrase = []; this.pulses = []; this.overflow = false; this.echoUntil = 0; this.echo = 0; }
    const dt = this.lastTime !== null && now > this.lastTime ? now - this.lastTime : 0;
    this.lastTime = now;
    const head = obs.head;
    for (let i = 0; i < 2; ++i) {
      const hand = obs.hands[i];
      const c = !hand ? obs.controllers[i] : null;
      const source = hand ? 1 : c ? 2 : 0;
      if (source !== this.source[i]) { this.previous[i] = null; this.armed[i] = true; }
      this.source[i] = source;
      const p = hand ? hand.palm : c ? c.position : null;
      const ray = this.rays[i];
      const reach = hand ? Math.hypot(hand.palm[0] - head[0], hand.palm[2] - head[2]) : 0;
      const open = hand ? hand.open : 0;
      ray.openness = open;
      const target = hand ? smoothstep(REACH_START, REACH_FULL, reach) * (CONTAINED + (1 - CONTAINED) * open)
        : c ? smoothstep(TRIGGER_START, TRIGGER_FULL, c.trigger) : 0;
      const rate = Math.min(1, dt / (target > ray.strength ? 0.05 : 0.35));
      ray.strength = dt > 0 ? ray.strength + (target - ray.strength) * rate : target;
      ray.valid = !!p; ray.controller = source === 2;
      if (hand) { ray.head = head; ray.palm = hand.palm; }
      else if (c) { ray.head = c.position; ray.palm = [c.position[0] + c.forward[0] * 0.5, c.position[1] + c.forward[1] * 0.5, c.position[2] + c.forward[2] * 0.5]; }
      if (!p) ray.strength = 0;
      if (ray.strength > 0.3 && !this.pointing[i]) { this.pointing[i] = true; events.push({ event: 'point_started', hand: i }); }
      if (ray.strength < 0.15 && this.pointing[i]) { this.pointing[i] = false; events.push({ event: 'point_ended', hand: i }); }
      if (this.pointing[i] && open > 0.6 && !this.opened[i]) { this.opened[i] = true; events.push({ event: 'hand_opened', hand: i }); }
      if ((!this.pointing[i] || open < 0.3) && this.opened[i]) { this.opened[i] = false; events.push({ event: 'hand_closed', hand: i }); }
      // Gestos secos: a palma passa de quase parada a mais de 1 m/s.
      let speed = null;
      if (p && this.previous[i] && dt > 0 && dt <= 0.25) speed = len(sub(p, this.previous[i])) / dt;
      this.previous[i] = p;
      if (speed === null) { if (!p) this.armed[i] = true; continue; }
      if (speed < STROKE_REARM) this.armed[i] = true;
      if (!this.armed[i] || speed <= STROKE_ON) continue;
      this.armed[i] = false;
      if (this.echoing()) { events.push({ event: 'stroke_ignored', hand: i }); continue; }
      const last = this.phrase[this.phrase.length - 1];
      if (last && now - last.time < STROKE_MERGE) continue;
      if (last && now - last.time > PHRASE_GAP) { this.phrase = []; this.overflow = false; }
      this.phrase.push({ time: now, position: p, hand: i });
      events.push({ event: 'stroke', hand: i, position: p });
      if (this.phrase.length > PHRASE_MAX && !this.overflow) { this.overflow = true; events.push({ event: 'phrase_discarded', hand: -1 }); }
    }
    if (this.phrase.length && !this.echoing()) {
      const quiet = now - this.phrase[this.phrase.length - 1].time;
      if (quiet >= PHRASE_END && this.phrase.length >= 2 && !this.overflow) {
        const withheld = this.style === 'none';
        events.push({ event: withheld ? 'echo_withheld' : 'echo_started', hand: -1, detail: this.style });
        if (!withheld) {
          let offset = 0;
          const n = this.phrase.length;
          for (let k = 0; k < n; ++k) {
            if (k) offset += this.style === 'varied'
              ? (this.phrase[n - k].time - this.phrase[n - k - 1].time) * ECHO_VARIED_STRETCH
              : this.phrase[k].time - this.phrase[k - 1].time;
            this.pulses.push({ time: now + offset, position: this.phrase[k].position, hand: this.phrase[k].hand });
          }
        }
        this.phrase = []; this.fired = 0;
      } else if (quiet >= PHRASE_END && (this.overflow || quiet > PHRASE_GAP)) { this.phrase = []; this.overflow = false; }
    }
    if (dt > 0) this.echo *= Math.exp(-dt / ECHO_DECAY);
    while (this.pulses.length && this.pulses[0].time <= now) {
      const pulse = this.pulses.shift();
      this.echo = 1; events.push({ event: 'echo_pulse', hand: pulse.hand, position: pulse.position, index: this.fired++ });
      if (!this.pulses.length) this.echoUntil = now + 0.4;
    }
    if (!this.pulses.length && this.echoUntil > 0 && now >= this.echoUntil) { this.echoUntil = 0; events.push({ event: 'echo_finished', hand: -1 }); }
    return events;
  }
}

// PointMusic com as mãos, tal como o original: notas da mão que aponta, na direção cabeça→palma.
class HandMusic {
  constructor(chords) { this.chords = chords; this.reset(); }
  reset() { this.pointing = [false, false]; this.lastTick = [-1, -1]; this.lastNote = [-1, -1]; this.lastSeconds = 0; }
  update(obs, events, seconds, playing) {
    const notes = [];
    const sixteenth = 60 / this.chords.bpm / 4;
    if (seconds + 1e-6 < this.lastSeconds) this.lastTick = [-1, -1];
    this.lastSeconds = seconds;
    const nextTick = Math.ceil(seconds / sixteenth - 1e-9);
    for (const e of events) {
      if (e.hand !== 0 && e.hand !== 1) continue;
      if (e.event === 'point_started') this.pointing[e.hand] = true;
      else if (e.event === 'point_ended') { this.pointing[e.hand] = false; this.lastNote[e.hand] = -1; }
    }
    if (!playing || !obs.head) return notes;
    const head = obs.head;
    for (let hand = 0; hand < 2; ++hand) {
      const h = obs.hands[hand];
      if (!this.pointing[hand] || !h) { this.lastNote[hand] = -1; continue; }
      if (nextTick <= this.lastTick[hand] || nextTick * sixteenth - seconds > 0.06) continue;
      const d = sub(h.palm, head);
      const reach = Math.hypot(d[0], d[2]), length = len(d);
      if (length < 0.05) continue;
      const elevation = Math.atan2(d[1], Math.max(reach, 1e-3)) * 57.29578;
      const note = pointNote(elevation, this.chords.at(nextTick * sixteenth), hand === 1 ? 74 : 62);
      this.lastTick[hand] = nextTick;
      if (note === this.lastNote[hand] && nextTick % 4 !== 0) continue;
      const strength = smoothstep(REACH_START, REACH_FULL, reach), k = 3 / length;
      notes.push({ voice: hand, note, velocity: 0.5 + 0.4 * strength, seconds: nextTick * sixteenth, local: true,
        position: [head[0] + d[0] * k, head[1] + d[1] * k, head[2] + d[2] * k] });
      this.lastNote[hand] = note;
    }
    return notes;
  }
}

export class Hands {
  constructor(S, chords, options = {}) {
    this.S = S;
    this.echoEnabled = options.echo !== false;
    this.profile = new ResponseProfile(20261017, S.HandResponseVariety > 0.5);
    this.trail = new PointTrail();
    this.response = new HandResponse();
    this.music = new HandMusic(chords);
    this.height = S.VrEyeHeight * 100; this.back = S.VrEyeBack * 100;
    this.lastPoint = [null, null];
    this.obs = { time: 0, head: null, hands: [null, null], controllers: [null, null] };
    this.events = [];
  }
  // tracking_to_world: metros do espaço local → cm do mundo (mão esquerda, +z à frente).
  toWorld(p) { return [p[0] * 100, this.height + p[1] * 100, -this.back - p[2] * 100]; }
  // Lê a frame XR: cabeça, mãos e comandos (quando a mão desse lado não está a ser seguida).
  observe(frame, space, pose) {
    const obs = this.obs;
    obs.time = performance.now() / 1000;
    const p = pose?.transform.position;
    obs.head = p ? [p.x, p.y, p.z] : null;
    obs.hands = [null, null]; obs.controllers = [null, null];
    obs.joints = [null, null];
    for (const source of frame.session.inputSources) {
      const i = source.handedness === 'left' ? 0 : source.handedness === 'right' ? 1 : -1;
      if (i < 0) continue;
      if (source.hand) {
        const h = readHand(frame, source.hand, space);
        if (h) { obs.hands[i] = h; obs.joints[i] = source.hand; }
      } else if (source.targetRaySpace) {
        const rp = frame.getPose(source.targetRaySpace, space);
        if (!rp) continue;
        const q = rp.transform.orientation, t = rp.transform.position;
        // (0, 0, -1) rodado pela orientação do comando.
        const f = [-(2 * (q.x * q.z + q.w * q.y)), -(2 * (q.y * q.z - q.w * q.x)), -(1 - 2 * (q.x * q.x + q.y * q.y))];
        obs.controllers[i] = { position: [t.x, t.y, t.z], forward: f, trigger: source.gamepad?.buttons[0]?.value ?? 0 };
      }
    }
    this.response.style = this.echoEnabled ? this.profile.echoStyle : 'none';
    this.events = this.response.update(obs);
    return this.events;
  }
  // Notas para agendar (chamado depois de observe).
  notes(seconds, playing) { return this.music.update(this.obs, this.events, seconds, playing); }
  // Mesma interface que o Gaze: world.prepare chama-o com a cena do frame.
  apply(world, _eye, _forward, time, camera) {
    const now = this.obs.time;
    this.profile.observe(this.events, time);
    const sh = world.shared;
    sh.u_respond.value.set(this.profile.uniforms(this.S.HandResponseSubtle, now));
    const point = sh.u_point.value;
    point.fill(0);
    const rays = [null, null];
    for (let i = 0; i < 2; ++i) {
      const ray = this.response.rays[i];
      if (!ray.valid) continue;
      const origin = this.toWorld(ray.head), palm = this.toWorld(ray.palm);
      const d = sub(palm, origin), n = len(d);
      if (!Number.isFinite(n) || n < 1) continue;
      if (ray.strength <= 0) continue;
      const dir = [d[0] / n, d[1] / n, d[2] / n];
      const values = [origin[0], origin[1], origin[2], ray.strength, dir[0], dir[1], dir[2], CONE_COS];
      point.set(values, 8 * i);
      rays[i] = { origin, direction: dir, strength: ray.strength };
      this.lastPoint[i] = values;
    }
    // Sem apontar, a memória do toque ainda afasta objetos da última linha apontada (força 0).
    for (let i = 0; i < 2; ++i)
      if (point[8 * i + 3] <= 0 && this.lastPoint[i]) { point.set(this.lastPoint[i], 8 * i); point[8 * i + 3] = 0; }
    point[16] = this.echoEnabled ? this.response.echo : 0;
    this.trail.update(now, rays, camera);
    this.trail.uniforms(now, camera, this.S.HandResponseMemory, sh.u_trail.value);
  }
}
