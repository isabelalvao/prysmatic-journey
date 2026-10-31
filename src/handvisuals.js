// O que se vê das mãos em VR, como na versão Synth do Prismatic-Pontos:
// - mãos de pontinhos (render/hand_geometry.cpp, make_hand_dots), na cor predominante da cena;
// - rasto de pontinhos que as pontas dos dedos largam ao mexer (interaction/hand_trail.cpp);
// - estalo dos dedos (interaction/hand_snap.cpp) com faíscas (render/snap_geometry.cpp).
// Shaders: port de shaders/vs_hand.sc e fs_hand.sc. Tudo se soma à cena (BLEND_ADD), com o teste de profundidade
// da cena e sem a escrever, desenhado depois de tudo o resto na vista 1.
// Articulações com os índices do OpenXR (0 palma, 1 pulso, 2–5 polegar, 6–10 indicador, … 21–25 mindinho).
import * as THREE from 'three';
import { blend } from './direction.js';

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalized = (a) => { const l = length(a); return l > 1e-6 ? scale(a, 1 / l) : [0, 0, 0]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ---- Estalo (hand_snap.cpp, «thumb-middle-release-1»): o polegar toca no médio e o médio salta para a palma ----
const SNAP_COOLDOWN = 0.55;
const SNAP_JOINTS = [0, 1, 5, 12, 14, 15];
export const snapUsable = (h) => !!h && SNAP_JOINTS.every((i) => h.points[i]);
export class SnapDetector {
  constructor() { this.reset(); }
  fresh(cooldown = 0) { return { contactSince: 0, lastContact: 0, cooldownUntil: cooldown, tip: 0, distal: 0, armed: false }; }
  reset() { this.hands = [this.fresh(), this.fresh()]; this.previous = null; }
  disarm(i) { this.hands[i] = this.fresh(this.hands[i].cooldownUntil); }
  // now em segundos; head: posição da cabeça ou null; hands: [{points[26]} | null] ×2 (metros, espaço local).
  update(now, head, hands) {
    const result = [];
    if (!head) { this.disarm(0); this.disarm(1); return result; }
    if (this.previous !== null) {
      if (now <= this.previous) this.hands = [this.fresh(), this.fresh()];
      else if (now - this.previous > 0.08) { this.disarm(0); this.disarm(1); }
    }
    this.previous = now;
    for (let i = 0; i < 2; ++i) {
      let s = this.hands[i];
      const h = hands[i];
      if (!snapUsable(h)) { this.disarm(i); continue; }
      if (now < s.cooldownUntil) continue;
      const p = h.points;
      const size = length(sub(p[1], p[12]));
      if (size < 0.035 || size > 0.16) { this.hands[i] = this.fresh(); continue; }
      const k = clamp(size / 0.08, 0.65, 1.4);
      const contact = length(sub(p[5], p[15]));
      const tip = length(sub(p[0], p[15])), distal = length(sub(p[0], p[14]));
      if (contact <= 0.024 * k) {
        if (!s.contactSince) s.contactSince = now;
        s.lastContact = now; s.tip = tip; s.distal = distal;
        if (now - s.contactSince >= 0.045) s.armed = true;
        continue;
      }
      if (s.armed && s.lastContact && now - s.lastContact <= 0.18) {
        const fold = s.tip - tip, distalFold = s.distal - distal;
        const speed = fold / (now - s.lastContact);
        if (contact >= 0.035 * k && fold >= 0.018 * k && fold <= 0.10 * k && distalFold >= 0.010 * k && speed >= 0.30 * k) {
          result.push({ hand: i, time: now, position: p[15].slice(), closing: speed });
          this.hands[i] = this.fresh(now + SNAP_COOLDOWN);
          continue;
        }
      } else { this.hands[i] = s = this.fresh(); }
      if (!s.armed) s.contactSince = 0;
    }
    return result;
  }
}
// Nota do estalo (audio/hand_synth.cpp): altura da mão face à cabeça na pentatónica de ré menor, de 60 cm abaixo
// (ré) a 30 cm acima (dó duas oitavas acima); a esquerda uma oitava abaixo; e tudo uma oitava abaixo (snap_octave_shift).
const SNAP_SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84];
export function snapNote(hand, aboveHead) {
  const t = clamp((aboveHead + 0.6) / 0.9, 0, 1);
  return SNAP_SCALE[Math.min(9, Math.floor(t * 10))] - (hand === 0 ? 12 : 0) - 12;
}
export const snapVelocity = (closing) => clamp(0.45 + 0.1 * closing, 0.45, 0.9);

// ---- Rasto das pontas dos dedos (hand_trail.cpp) ----
const TIPS = [5, 10, 15, 20, 25];
class HandTrail {
  constructor(S) {
    this.lifetime = clamp(S.HandTrailLifetime, 0.05, 10); this.spacing = clamp(S.HandTrailSpacing, 0.001, 0.2);
    this.max = clamp(Math.round(S.HandTrailMax), 1, 8192); this.rise = S.HandTrailRise; this.drift = S.HandTrailDrift;
    this.clear();
  }
  clear() { this.dots = []; this.next = 0; this.emitted = 0; this.last = [[], []]; }
  emit(position, now) {
    const dot = { position, born: now, seed: this.emitted++ };
    if (this.dots.length < this.max) this.dots.push(dot);
    else { this.dots[this.next] = dot; this.next = (this.next + 1) % this.dots.length; }
  }
  update(hand, h, now) {
    const last = this.last[hand];
    for (let f = 0; f < 5; ++f) {
      const p = h?.points[TIPS[f]];
      if (!p) { last[f] = null; continue; }
      if (!last[f]) { last[f] = p; continue; }
      const moved = length(sub(p, last[f]));
      const count = Math.min(4, Math.floor(moved / this.spacing));
      if (count <= 0) continue;
      const from = last[f];
      for (let i = 1; i <= count; ++i) this.emit(mix(from, p, i * this.spacing / moved), now);
      last[f] = moved > this.spacing * 4 ? p : mix(from, p, count * this.spacing / moved);
    }
  }
  position(dot, now) {
    const age = clamp((now - dot.born) / this.lifetime, 0, 1), ease = age * (2 - age);
    const angle = (dot.seed % 1024) * 2.399963229728653, drift = this.drift * ease;
    return [dot.position[0] + Math.cos(angle) * drift, dot.position[1] + this.rise * this.lifetime * ease, dot.position[2] + Math.sin(angle) * drift];
  }
  alpha(dot, now) {
    const age = now - dot.born;
    return age < 0 || age >= this.lifetime ? 0 : 1 - age / this.lifetime;
  }
}

// ---- Geometria (vértice: posição 3, normal 3, fade 1) ----
class Batch {
  constructor(maxVertices, maxIndices) {
    this.attrs = new Float32Array(maxVertices * 7); this.index = new Uint32Array(maxIndices);
    this.vertices = 0; this.indices = 0; this.maxVertices = maxVertices; this.maxIndices = maxIndices;
    const buffer = this.buffer = new THREE.InterleavedBuffer(this.attrs, 7);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('a_position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute('a_normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    g.setAttribute('a_texcoord0', new THREE.InterleavedBufferAttribute(buffer, 1, 6));
    const index = this.indexAttr = new THREE.BufferAttribute(this.index, 1);
    index.setUsage(THREE.DynamicDrawUsage);
    g.setIndex(index);
  }
  reset() { this.vertices = 0; this.indices = 0; }
  room(v, i) { return this.vertices + v <= this.maxVertices && this.indices + i <= this.maxIndices; }
  vertex(p, n, fade) {
    const o = this.vertices++ * 7, a = this.attrs;
    a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2]; a[o + 3] = n[0]; a[o + 4] = n[1]; a[o + 5] = n[2]; a[o + 6] = fade;
  }
  // Ponto: 4 vértices na mesma posição (o vertex shader afasta-os); fade = canto + 0,9 × brilho.
  dot(p, n, glow) {
    if (!this.room(4, 6)) return;
    const base = this.vertices;
    for (let c = 0; c < 4; ++c) this.vertex(p, n, c + 0.9 * glow);
    this.index.set([base, base + 1, base + 2, base, base + 2, base + 3], this.indices); this.indices += 6;
  }
  commit() {
    this.buffer.needsUpdate = true; this.indexAttr.needsUpdate = true;
    this.buffer.clearUpdateRanges(); this.buffer.addUpdateRange(0, this.vertices * 7);
    this.indexAttr.clearUpdateRanges(); this.indexAttr.addUpdateRange(0, this.indices);
    this.geometry.setDrawRange(0, this.indices);
  }
}

const BONES = [[1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [7, 8], [8, 9], [9, 10], [11, 12], [12, 13], [13, 14], [14, 15],
  [16, 17], [17, 18], [18, 19], [19, 20], [21, 22], [22, 23], [23, 24], [24, 25]];
const DOT_RINGS = 5, DOT_SIDES = 8, CAP_DOTS = 6, PALM_ACROSS = 6, PALM_ALONG = 4;
const PALM_BASES = [6, 11, 16, 21], PALM_KNUCKLES = [7, 12, 17, 22];

// make_hand_dots: pontos em cm no mundo (toWorld), anéis por osso, pontas arredondadas e grelha dupla na palma.
function handDots(batch, h, toWorld) {
  const points = h.points.map((p) => p && toWorld(p));
  const radii = h.radii.map((r) => (Number.isFinite(r) && r > 0 ? clamp(r, 0.001, 0.025) * 100 : 0.6));
  let palmNormal = [0, 1, 0];
  if (points[6] && points[21] && points[1] && points[12]) {
    const n = normalized(cross(sub(points[21], points[6]), sub(points[12], points[1])));
    if (length(n) > 0.5) palmNormal = n;
  }
  const wrist = points[1];
  const glow = (p) => (wrist ? clamp((length(sub(p, wrist)) - 3) / 7, 0, 1) : 1);
  const dot = (p, n) => batch.dot(p, n, glow(p));
  for (const [a, b] of BONES) {
    if (!points[a] || !points[b]) continue;
    const delta = sub(points[b], points[a]);
    if (length(delta) < 0.001) continue;
    const axis = normalized(delta);
    let side = cross(axis, palmNormal);
    if (length(side) < 0.2) side = cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    side = normalized(side);
    const up = cross(axis, side);
    for (let ring = 0; ring < DOT_RINGS; ++ring) {
      const t = (ring + 0.5) / DOT_RINGS, radius = radii[a] + (radii[b] - radii[a]) * t, centre = mix(points[a], points[b], t);
      for (let i = 0; i < DOT_SIDES; ++i) {
        const angle = TAU * (i + 0.5 * (ring % 2)) / DOT_SIDES;
        const radial = add(scale(side, Math.cos(angle)), scale(up, Math.sin(angle)));
        dot(add(centre, scale(radial, radius)), radial);
      }
    }
  }
  for (const tip of TIPS) {
    if (!points[tip] || !points[tip - 1]) continue;
    const axis = normalized(sub(points[tip], points[tip - 1]));
    if (length(axis) < 0.5) continue;
    let side = normalized(cross(axis, palmNormal));
    if (length(side) < 0.5) side = normalized(cross(axis, [1, 0, 0]));
    const up = cross(axis, side);
    for (let i = 0; i < CAP_DOTS; ++i) {
      const angle = TAU * i / CAP_DOTS;
      const n = normalized(add(scale(axis, 0.75), scale(add(scale(side, Math.cos(angle)), scale(up, Math.sin(angle))), 0.66)));
      dot(add(points[tip], scale(n, radii[tip])), n);
    }
    dot(add(points[tip], scale(axis, radii[tip])), axis);
  }
  if ([...PALM_BASES, ...PALM_KNUCKLES].every((i) => points[i]))
    for (let face = -1; face <= 1; face += 2) for (let u = 0; u < PALM_ACROSS; ++u) for (let v = 0; v < PALM_ALONG; ++v) {
      const across = 3 * (u + 0.5) / PALM_ACROSS, column = Math.min(Math.floor(across), 2);
      const f = across - column, t = (v + 0.5) / PALM_ALONG;
      const base = mix(points[PALM_BASES[column]], points[PALM_BASES[column + 1]], f);
      const knuckle = mix(points[PALM_KNUCKLES[column]], points[PALM_KNUCKLES[column + 1]], f);
      const thickness = (radii[PALM_BASES[column]] + radii[PALM_KNUCKLES[column]]) * 0.5;
      const n = scale(palmNormal, face);
      dot(add(mix(base, knuckle, t), scale(n, thickness)), n);
    }
}

// make_snap_geometry: 14 octaedros que se espalham da ponta do médio e caem um pouco, durante 0,45 s.
const SPARK_LIFETIME = 0.45, SPREAD = 1.25, POINT = 1.12;
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACES = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
const sparkFade = (snap, now) => { const age = now - snap.time; if (age < 0 || age >= SPARK_LIFETIME) return 0; const r = 1 - age / SPARK_LIFETIME; return r * r; };
function sparks(batch, snap, now, toWorld) {
  const fade = sparkFade(snap, now);
  if (fade <= 0) return;
  const t = now - snap.time, p = snap.position;
  for (let i = 0; i < 14; ++i) {
    if (!batch.room(6, 24)) return;
    const z = 1 - 2 * (i + 0.5) / 14, r = Math.sqrt(1 - z * z);
    const angle = i * Math.PI * (3 - Math.sqrt(5)) + snap.hand * 0.7;
    const travel = SPREAD * (0.012 + (0.18 + 0.025 * (i % 5)) * t);
    const centre = toWorld([p[0] + r * Math.cos(angle) * travel, p[1] + z * travel - 0.12 * t * t, p[2] + r * Math.sin(angle) * travel]);
    const radius = POINT * (0.0015 + 0.0003 * (i % 3)) * 100 * Math.sqrt(fade);
    const base = batch.vertices;
    // fade² no shader = a intensidade do estalo (2 × cor × snap_fade no original).
    for (const a of AXES) batch.vertex(add(centre, scale(a, radius)), a, Math.sqrt(fade));
    for (let k = 0; k < 24; ++k) batch.index[batch.indices++] = base + FACES[k];
  }
}

// ---- Shaders (vs_hand.sc / fs_hand.sc) ----
const VS = `precision highp float;
uniform mat4 u_view; uniform mat4 u_proj; uniform mat4 u_viewProj;
uniform vec4 u_hand_colour; uniform vec4 u_hand_style;
in vec3 a_position; in vec3 a_normal; in float a_texcoord0;
out vec3 v_normal; out vec3 v_world; out vec2 v_pattern; out vec2 v_response;
void main() {
  gl_Position = u_viewProj * vec4(a_position, 1.0);
  v_normal = (u_view * vec4(a_normal, 0.0)).xyz;
  v_world = (u_view * vec4(a_position, 1.0)).xyz;
  v_pattern = vec2(0.0); v_response = vec2(a_texcoord0, 0.0);
  if (u_hand_style.w > 0.5) {
    float corner = floor(a_texcoord0 + 0.001);
    vec2 offset = vec2(corner > 0.5 && corner < 2.5 ? 1.0 : -1.0, corner > 1.5 ? 1.0 : -1.0);
    float size = u_hand_colour.w * (u_hand_style.w > 1.5 ? a_normal.x : 1.0);
    gl_Position.xy += offset * 0.5 * size * vec2(u_proj[0][0], u_proj[1][1]);
    v_pattern = offset;
    v_response = vec2((a_texcoord0 - corner) / 0.9, u_hand_style.w);
  }
}`;
const FS = `precision highp float;
uniform vec4 u_hand_colour; uniform vec4 u_hand_style;
in vec3 v_normal; in vec3 v_world; in vec2 v_pattern; in vec2 v_response;
out vec4 fragColor;
void main() {
  float fade = v_response.x;
  float facing = abs(dot(normalize(v_normal), normalize(-v_world)));
  float rim = pow(1.0 - facing, u_hand_style.z);
  if (v_response.y > 1.5) {
    float r = length(v_pattern);
    if (r > 1.0) discard;
    fragColor = vec4(u_hand_colour.xyz * u_hand_style.x * fade * (1.0 - smoothstep(0.35, 1.0, r)), 1.0);
    return;
  }
  if (v_response.y > 0.5) {
    float r = length(v_pattern);
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.35, 1.0, r);
    fragColor = vec4(u_hand_colour.xyz * (u_hand_style.x + u_hand_style.y * rim) * mix(0.1, 1.0, fade) * core, 1.0);
    return;
  }
  fragColor = vec4(u_hand_colour.xyz * (u_hand_style.x * fade * fade * (0.6 + 0.4 * facing) + u_hand_style.y * rim * mix(0.08, 1.0, fade)), 1.0);
}`;

export class HandVisuals {
  constructor(S, world) {
    this.S = S; this.world = world;
    this.trail = new HandTrail(S);
    this.snaps = new SnapDetector();
    this.bursts = [null, null];
    this.batches = { hands: new Batch(2 * 1200 * 4, 2 * 1200 * 6), trail: new Batch(this.trail.max * 4, this.trail.max * 6), sparks: new Batch(2 * 14 * 6, 2 * 14 * 24) };
    const make = (batch, style) => {
      const m = new THREE.RawShaderMaterial({
        vertexShader: VS, fragmentShader: FS, glslVersion: THREE.GLSL3,
        uniforms: { u_view: world.shared.u_view, u_proj: world.shared.u_proj, u_viewProj: world.shared.u_viewProj,
          u_hand_colour: { value: new THREE.Vector4() }, u_hand_style: { value: new THREE.Vector4(...style) } },
        depthTest: true, depthWrite: false, depthFunc: THREE.LessDepth, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      });
      const mesh = new THREE.Mesh(batch.geometry, m);
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 1e9; mesh.visible = false;
      world.scenes[1].add(mesh);
      return mesh;
    };
    // u_hand_style: brilho de base, contorno, finura do contorno, modo (0 faíscas, 1 mãos, 2 rasto).
    this.meshes = {
      hands: make(this.batches.hands, [S.HandDotBrightness, S.HandRim, S.HandRimPower, 1]),
      trail: make(this.batches.trail, [S.HandTrailBrightness, 0, 1, 2]),
      sparks: make(this.batches.sparks, [1, 0, 1, 0]),
    };
  }
  // hand_rim_colour: cor predominante da cena (paleta, extensões quente e fria, anéis do túnel), normalizada ao máximo.
  rimColour(time) {
    const w = this.world, S = this.S, C = w.C, state = w.state;
    const ramp = (start, fade) => (S.ExtensionEnabled ? clamp((time - S[start]) / S[fade], 0, 1) : 0);
    let c = blend(state.palette[0], state.palette[1], 0.5);
    c = blend(c, blend(C.colour('WarmFirst'), C.colour('WarmSecond'), 0.5), ramp('ExtensionColourStart', 'ExtensionColourFade'));
    c = blend(c, blend(C.colour('CoolFirst'), C.colour('CoolSecond'), 0.5), ramp('ExtensionSecondStart', 'ExtensionSecondFade'));
    c = blend(c, w.ringColour(blend(C.colour('RingEven'), C.colour('RingOdd'), 0.5), time), w.comp.tunnel_light_weight);
    const peak = Math.max(c[0], c[1], c[2], 0.001);
    return [c[0] / peak, c[1] / peak, c[2] / peak];
  }
  // Uma vez por frame VR, depois de world.prepare (precisa da paleta da cena) e antes de desenhar os olhos.
  // obs: observação das mãos (Hands.obs); devolve os estalos detetados neste frame.
  update(obs, time, toWorld) {
    const now = obs.time, S = this.S, B = this.batches;
    const snaps = this.snaps.update(now, obs.head, obs.hands);
    for (const s of snaps) this.bursts[s.hand] = s;
    for (let i = 0; i < 2; ++i) if (this.bursts[i] && (!snapUsable(obs.hands[i]) || sparkFade(this.bursts[i], now) <= 0)) this.bursts[i] = null;
    if (!obs.head) { this.trail.clear(); this.bursts = [null, null]; }
    const rim = this.rimColour(time);
    B.hands.reset(); B.trail.reset(); B.sparks.reset();
    for (let i = 0; i < 2; ++i) if (obs.hands[i]) handDots(B.hands, obs.hands[i], toWorld);
    if (S.HandTrailEnabled && obs.head) {
      for (let i = 0; i < 2; ++i) this.trail.update(i, obs.hands[i], now);
      for (const dot of this.trail.dots) {
        const a = this.trail.alpha(dot, now);
        if (a <= 0 || !B.trail.room(4, 6)) continue;
        const p = toWorld(this.trail.position(dot, now)), base = B.trail.vertices;
        for (let c = 0; c < 4; ++c) B.trail.vertex(p, [0.6 + 0.4 * a, 0, 0], c + 0.9 * a);
        B.trail.index.set([base, base + 1, base + 2, base, base + 2, base + 3], B.trail.indices); B.trail.indices += 6;
      }
    }
    for (const s of this.bursts) if (s) sparks(B.sparks, s, now, toWorld);
    const M = this.meshes;
    M.hands.material.uniforms.u_hand_colour.value.set(rim[0], rim[1], rim[2], S.HandDotSize * 0.1);
    M.trail.material.uniforms.u_hand_colour.value.set(rim[0], rim[1], rim[2], S.HandTrailSize * 0.1);
    M.sparks.material.uniforms.u_hand_colour.value.set(2 * rim[0], 2 * rim[1], 2 * rim[2], 1);
    for (const k of ['hands', 'trail', 'sparks']) { B[k].commit(); M[k].visible = B[k].indices > 0; }
    return snaps;
  }
  hide() { for (const m of Object.values(this.meshes)) m.visible = false; this.trail.clear(); this.snaps.reset(); this.bursts = [null, null]; }
}
