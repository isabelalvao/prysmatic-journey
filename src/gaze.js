// O olhar (rato) no lugar das mãos: port de interaction/response_profile.cpp e point_trail.cpp, e do
// preenchimento de u_point em Renderer::update_hand_response. Uma só «mão» (vaga 0) aponta da posição
// dos olhos na direção do olhar, sempre com força 1; não há eco, pontos nas mãos nem retícula.
export const CONE_COS = 0.985;               // ~10° de meia abertura
const EPISODE_DEGREES = 30;           // um olhar que se afasta mais do que isto começa um episódio novo
const ACTIVE_SECONDS = 1.5;           // o olhar conta como «a apontar» até 1,5 s depois de o rato parar

// ---- ResponseProfile ----
const FAMILIES = 8, PROPERTIES = 7;
const P = { light: 0, levitate: 1, grow: 2, stretch: 3, rotate: 4, part: 5, widen: 6 };
const CEILINGS = [
  [1, 45, 0.5, 0, 0, 0, 0.4],
  [1, 30, 2.0, 1.0, 0, 0, 0],
  [1, 30, 0, 0.6, 0, 0, 0.6],
  [1, 30, 0.25, 0, 0.9, 0, 0.3],
  [1, 30, 0.2, 0.35, 0.6, 0, 0.25],
  [1, 40, 0.3, 0, 0.8, 0, 0],
  [1, 30, 0, 0, 0, 0, 0.35],
  [1, 40, 0.25, 0, 0.5, 120, 0],
].map((r) => r.map(Math.fround));
const ROTATION = [
  [P.levitate, P.grow, P.widen],
  [P.grow, P.levitate, P.stretch],
  [P.stretch, P.levitate, P.widen],
  [P.rotate, P.grow, P.levitate, P.widen],
  [P.stretch, P.rotate, P.levitate, P.grow, P.widen],
  [P.levitate, P.rotate, P.grow],
  [P.widen, P.levitate],
  [P.part, P.levitate, P.grow, P.rotate],
];
function mix(x) {
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
const ECHO_BOUNCE = 0.15, ECHO_JUMP_CM = 15, KNOB_SECONDS = 0.35;

function familyPresent(f, t) {
  switch (f) {
    case 0: return t < 120;
    case 1: return t < 60;
    case 2: case 3: return t < 208;
    case 4: case 5: case 7: return t >= 136;
    case 6: return t >= 224;
    default: return false;
  }
}

export class ResponseProfile {
  constructor(seed = 20261017, variety = true) {
    this.seed = seed; this.variety = variety;
    this.weight = Array.from({ length: FAMILIES }, () => new Float32Array(PROPERTIES));
    this.dominant = new Array(FAMILIES).fill(0);
    this.current = new Float32Array(68);
    this.episode = 0; this.started = false; this.lastTime = 0;
    this.echoStyle = 'same'; this.echoFamily = -1; this.echoes = 0; this.pointing = [false, false];
    this.applyEpisode();
  }
  applyEpisode() {
    for (let f = 0; f < FAMILIES; ++f) {
      const w = this.weight[f];
      w.fill(0); w[P.light] = 1;
      const list = ROTATION[f];
      let dominant = 0;
      if (this.variety && this.episode > 0) {
        const offset = mix((this.seed ^ Math.imul(f, 0x9e3779b9)) >>> 0) % list.length;
        dominant = (this.episode + offset) % list.length;
        if (dominant === this.dominant[f]) dominant = (dominant + 1) % list.length;
      }
      this.dominant[f] = dominant;
      w[list[dominant]] = 1;
    }
    this.variation = this.variety ? 1 : 0;
  }
  // Equivale a «point_started» sem nenhuma mão a apontar antes.
  startEpisode() {
    if (this.started) ++this.episode;
    this.started = true;
    this.applyEpisode();
  }
  // ResponseProfile::observe com os eventos do reflexo (mãos); scene: segundos da obra.
  observe(events, scene) {
    for (const e of events) {
      if (e.event === 'point_started' && (e.hand === 0 || e.hand === 1)) {
        if (!this.pointing[0] && !this.pointing[1]) this.startEpisode();
        this.pointing[e.hand] = true;
      } else if (e.event === 'point_ended' && (e.hand === 0 || e.hand === 1)) {
        this.pointing[e.hand] = false;
      } else if (e.event === 'echo_started' || e.event === 'echo_withheld') {
        ++this.echoes;
        const cycle = ['same', 'varied', 'other_family'];
        const next = this.variety ? cycle[this.echoes % 3] : 'same';
        if (this.echoStyle !== 'none') this.echoStyle = next;
      }
    }
    if (this.echoStyle === 'other_family') {
      const present = [];
      for (let f = 0; f < FAMILIES; ++f) if (familyPresent(f, scene)) present.push(f);
      this.echoFamily = present.length ? present[Math.floor(this.echoes / 3) % present.length] : -1;
      if (this.echoFamily < 0) this.echoStyle = 'same';
    } else this.echoFamily = -1;
  }
  target(subtle) {
    const scale = Math.min(Math.max(Number.isFinite(subtle) ? subtle : 0.45, 0.15), 1);   // intensidade subtil
    const v = new Float32Array(68);
    for (let f = 0; f < FAMILIES; ++f) {
      for (let p = 0; p < PROPERTIES; ++p) v[8 * f + p] = CEILINGS[f][p] * this.weight[f][p] * scale;
      // Que famílias respondem ao eco (no olhar o nível de eco é sempre 0).
      v[8 * f + 7] = this.echoStyle === 'same' || this.echoStyle === 'varied' || (this.echoStyle === 'other_family' && this.echoFamily === f) ? 1 : 0;
    }
    v[64] = this.variation; v[65] = (this.seed % 997) * 0.01; v[66] = ECHO_BOUNCE * scale; v[67] = ECHO_JUMP_CM * scale;
    return v;
  }
  uniforms(subtle, now) {
    const target = this.target(subtle);
    const dt = this.lastTime > 0 && now > this.lastTime ? now - this.lastTime : 0;
    const rate = !this.started || this.lastTime === 0 ? 1 : Math.min(1, dt / KNOB_SECONDS);
    for (let i = 0; i < 68; ++i) this.current[i] += (target[i] - this.current[i]) * rate;
    if (now > 0) this.lastTime = now;
    return this.current;
  }
  describe() {
    const names = ['light', 'levitate', 'grow', 'stretch', 'rotate', 'part', 'widen'];
    const fam = ['stones', 'points', 'lines', 'shapes', 'cones', 'crystals', 'rings', 'parting'];
    return `episode=${this.episode} ` + fam.map((n, f) => n + '=' + names[ROTATION[f][this.dominant[f]]]).join(' ');
  }
}

// ---- PointTrail (point_trail.cpp): seis amostras por mão, de 0,25 em 0,25 s ----
const TRAIL_SAMPLES = 6, TRAIL_INTERVAL = 0.25, TRAIL_MAX = 3, TRAIL_JUMP_CM = 2000;
export class PointTrail {
  constructor() { this.reset(); }
  reset() { this.samples = [[], []]; this.next = [0, 0]; this.lastSample = 0; this.lastTime = 0; this.started = false; }
  // rays: [esquerda, direita], cada um {origin, direction, strength} no espaço do mundo (cm).
  update(now, rays, camera) {
    if (this.started && now < this.lastTime) this.reset();
    if (now <= 0) return;
    if (!this.started) { this.started = true; this.lastSample = now - TRAIL_INTERVAL; }
    this.lastTime = now;
    if (now - this.lastSample < TRAIL_INTERVAL) return;
    this.lastSample = now;
    for (let hand = 0; hand < 2; ++hand) {
      const ray = rays[hand];
      if (!ray || !(ray.strength > 0)) continue;
      this.samples[hand][this.next[hand]] = { origin: ray.origin.slice(), direction: ray.direction.slice(), strength: ray.strength, camera, time: now };
      this.next[hand] = (this.next[hand] + 1) % TRAIL_SAMPLES;
    }
  }
  uniforms(now, camera, memory, out) {
    out.fill(0);
    out[96] = CONE_COS;
    if (!(memory > 0)) return out;
    memory = Math.min(memory, TRAIL_MAX);
    for (let hand = 0; hand < 2; ++hand)
      for (let i = 0; i < TRAIL_SAMPLES; ++i) {
        const s = this.samples[hand][i];
        if (!s || s.time > now) continue;
        const age = now - s.time, shift = camera - s.camera;
        if (age >= memory || !Number.isFinite(shift) || Math.abs(shift) > TRAIL_JUMP_CM) continue;
        const t = age / memory, fade = 1 - t * t * (3 - 2 * t);
        const o = 8 * (hand * TRAIL_SAMPLES + i);
        out[o] = s.origin[0]; out[o + 1] = s.origin[1]; out[o + 2] = s.origin[2]; out[o + 3] = s.strength * fade;
        out[o + 4] = s.direction[0]; out[o + 5] = s.direction[1]; out[o + 6] = s.direction[2]; out[o + 7] = shift;
      }
    return out;
  }
}

// ---- O olhar ----
export class Gaze {
  constructor(S) {
    this.S = S;
    this.profile = new ResponseProfile(20261017, S.HandResponseVariety > 0.5);
    this.trail = new PointTrail();
    this.lastMove = -Infinity;
    this.anchor = null;
    this.pointing = false;
    this.ray = { origin: [0, 0, 0], direction: [0, 0, 1], strength: 1 };
  }
  // Chamado quando o rato mexe a vista (tempo real em segundos).
  moved(now) { this.lastMove = now; }
  active(now) { return now - this.lastMove < ACTIVE_SECONDS; }
  // Preenche u_point, u_respond e u_trail; world.render chama-o depois de saber a vista.
  apply(world, eye, forward, _time, camera) {
    const now = performance.now() / 1000;
    const active = this.active(now);
    // Episódios: começa um quando o olhar volta a mexer depois de parado, ou quando se afasta
    // mais de 30° da direção onde o episódio começou.
    if (active && (!this.pointing || !this.anchor ||
        forward[0] * this.anchor[0] + forward[1] * this.anchor[1] + forward[2] * this.anchor[2] < Math.cos(EPISODE_DEGREES * Math.PI / 180))) {
      this.profile.startEpisode();
      this.anchor = forward.slice();
    }
    this.pointing = active;
    const sh = world.shared;
    sh.u_respond.value.set(this.profile.uniforms(this.S.HandResponseSubtle, now));
    const p = sh.u_point.value;
    p.fill(0);
    p.set([eye[0], eye[1], eye[2], 1, forward[0], forward[1], forward[2], CONE_COS], 0);
    this.ray.origin = eye; this.ray.direction = forward;
    this.trail.update(now, [this.ray, null], camera);
    this.trail.uniforms(now, camera, this.S.HandResponseMemory, sh.u_trail.value);
  }
}
