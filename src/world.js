// Port de src/render/renderer.cpp (Impl::draw_scene e companhia) para three.js r187.
// Cada frame monta, pela mesma ordem do original, a lista de desenhos das duas vistas (0 reflexo do chão, 1 cena),
// com instâncias preparadas na CPU como no C++; o three.js só executa (RawShaderMaterial, instâncias, alvos HDR).
import * as THREE from 'three';
import * as D from './direction.js';
import * as SH from './shaders.gen.js';
import { theme } from './theme.js';

const { Role, Stage } = D;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const SPECTRAL_CONE_PIECES = 17, SPECTRAL_CONE_RIBS = 8, CRYSTAL_VARIANTS = 6, CRYSTAL_PIECES = 9;
const INSTANCE_FLOATS = 20;

// Lista de instâncias que cresce sem realocar a cada frame.
class InstanceList {
  constructor(n = 256) { this.data = new Float32Array(n * INSTANCE_FLOATS); this.count = 0; }
  reset() { this.count = 0; }
  reserve(n) {
    if (n * INSTANCE_FLOATS <= this.data.length) return;
    const next = new Float32Array(Math.max(n, this.data.length / INSTANCE_FLOATS * 2) * INSTANCE_FLOATS);
    next.set(this.data.subarray(0, this.count * INSTANCE_FLOATS)); this.data = next;
  }
  push() { this.reserve(this.count + 1); return this.count++ * INSTANCE_FLOATS; }
}

function lookAtLH(eye, at, up = [0, 1, 0]) {
  // bx::mtxLookAt (mão esquerda): z para a frente.
  let z = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
  let l = Math.hypot(...z); z = z.map((v) => v / l);
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  l = Math.hypot(...x); x = x.map((v) => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = (a) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1];
}
function perspectiveLH(fovyDeg, aspect, near, far) {
  // bx::mtxProj com profundidade homogénea (OpenGL, -1..1), mão esquerda.
  const h = 1 / Math.tan(fovyDeg * Math.PI / 360), w = h / aspect;
  const m = new Array(16).fill(0);
  m[0] = w; m[5] = h; m[10] = (far + near) / (far - near); m[11] = 1; m[14] = -2 * far * near / (far - near);
  return m;
}

export class World {
  constructor(renderer, data, textures) {
    this.renderer = renderer;
    this.data = data;
    this.C = data.C;
    this.S = data.C.S;
    const S = this.S;
    this.textures = textures;
    this.coneRates = [{ time: 0, angle: 0, rate: S.ConeRotation * S.AnimationSpeed * Math.PI / 180 }];
    this.rain = { target: null, colour: [0, 0, 0], coloured: false, travel: 0, time: 0 };
    this.lastTime = 0;
    this.eyeOrigin = [0, S.EyeHeight * 100, -S.EyeBack * 100];
    this.eyeView = new Float64Array(16);
    this.playbackEnd = Math.min(data.beats.duration, S.OpeningDuration);
    this.forest = data.groups.find((g) => g.stage === Stage.Forest && g.role === Role.Pole && g.mesh.startsWith('SM_Pole-') && g.count > 0) || null;
    this.buildGeometries();
    this.buildShared();
    this.scenes = [new THREE.Scene(), new THREE.Scene()];
    this.camera = new THREE.Camera();
    this.pool = new Map();
    this.used = new Map();
    this.order = [0, 0];
    this.scratch = new InstanceList(4096);
    this.opaque = new InstanceList(4096);
    this.transparent = [];
    this.transparentData = new InstanceList(4096);
    this.cometList = new InstanceList(64);
    this.cometTint = new Float32Array(52);
    this.cometPalette = [[0, 0, 0], [0, 0, 0]];
    this.buildTargets();
  }

  // ---- recursos ----
  buildGeometries() {
    this.geometries = {};
    for (const [id, m] of Object.entries(this.data.meshes)) {
      let pos, nor, uv, idx;
      if (m.dots) {
        // Quatro vértices por ponto, na mesma posição; normal × (2..5) indica o canto (make_dot_points).
        const n = m.count;
        pos = new Float32Array(n * 12); nor = new Float32Array(n * 12); uv = new Float32Array(n * 8); idx = new Uint16Array(n * 6);
        for (let p = 0; p < n; ++p) {
          const s = p * 8;
          for (let c = 0; c < 4; ++c) {
            const v = p * 4 + c, code = 2 + c;
            pos[v * 3] = m.points[s]; pos[v * 3 + 1] = m.points[s + 1]; pos[v * 3 + 2] = m.points[s + 2];
            nor[v * 3] = m.points[s + 3] * code; nor[v * 3 + 1] = m.points[s + 4] * code; nor[v * 3 + 2] = m.points[s + 5] * code;
            uv[v * 2] = m.points[s + 6]; uv[v * 2 + 1] = m.points[s + 7];
          }
          const b = p * 4;
          idx.set([b, b + 1, b + 2, b + 2, b + 3, b], p * 6);
        }
      } else {
        const n = m.vertices.length / 8;
        pos = new Float32Array(n * 3); nor = new Float32Array(n * 3); uv = new Float32Array(n * 2);
        for (let v = 0; v < n; ++v) {
          pos.set(m.vertices.subarray(v * 8, v * 8 + 3), v * 3); nor.set(m.vertices.subarray(v * 8 + 3, v * 8 + 6), v * 3);
          uv.set(m.vertices.subarray(v * 8 + 6, v * 8 + 8), v * 2);
        }
        idx = m.indices;
      }
      this.geometries[id] = {
        position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nor, 3),
        uv: new THREE.BufferAttribute(uv, 2), index: new THREE.BufferAttribute(idx, 1),
      };
    }
  }
  buildShared() {
    const v4 = (n) => ({ value: new Float32Array(4 * n) });
    this.shared = {
      u_view: { value: new THREE.Matrix4() }, u_proj: { value: new THREE.Matrix4() }, u_viewProj: { value: new THREE.Matrix4() },
      u_viewRect: { value: new THREE.Vector4() },
      u_eye: { value: new THREE.Vector4() }, u_atmosphere: { value: new THREE.Vector4() },
      u_tuning: v4(22), u_point: v4(5), u_respond: v4(17), u_trail: v4(25), u_layout: { value: new THREE.Vector4() },
      u_choreography: v4(7), u_spectral: v4(11), u_comets: v4(13), u_dots: v4(11),
    };
  }
  material(kind) {
    const vertex = kind === 'opening' ? SH.vs_opening : SH.vs_scene;
    const fragment = kind === 'opening' ? SH.fs_opening : kind === 'ground' ? SH.fs_ground : SH.fs_scene;
    const uniforms = {
      ...this.shared,
      u_scene: { value: new THREE.Vector4() }, u_clock: { value: new THREE.Vector4() },
      u_color0: { value: new THREE.Vector4() }, u_color1: { value: new THREE.Vector4() },
      u_style: { value: new THREE.Vector4() }, u_art: { value: new THREE.Vector4() },
    };
    if (kind === 'opening') { uniforms.u_family = { value: new THREE.Vector4() }; uniforms.s_detail = { value: this.textures[0] }; }
    if (kind === 'ground') uniforms.s_reflection = { value: null };
    const m = new THREE.RawShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, glslVersion: THREE.GLSL3 });
    m.side = THREE.DoubleSide;
    m.depthFunc = THREE.LessDepth;
    m.transparent = false;
    return m;
  }
  slot(meshId) {
    let list = this.pool.get(meshId);
    if (!list) { list = []; this.pool.set(meshId, list); this.used.set(meshId, 0); }
    const i = this.used.get(meshId);
    this.used.set(meshId, i + 1);
    if (i < list.length) return list[i];
    const base = this.geometries[meshId];
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('a_position', base.position);
    geometry.setAttribute('a_normal', base.normal);
    geometry.setAttribute('a_texcoord0', base.uv);
    geometry.setIndex(base.index);
    const slot = { geometry, capacity: 0, buffer: null, materials: {}, mesh: null, scene: -1 };
    slot.mesh = new THREE.Mesh(geometry, this.material('scene'));
    slot.mesh.frustumCulled = false;
    slot.mesh.matrixAutoUpdate = false;
    list.push(slot);
    return slot;
  }
  setInstances(slot, src, first, count) {
    if (count > slot.capacity) {
      slot.capacity = Math.max(count, slot.capacity * 2, 16);
      slot.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(slot.capacity * INSTANCE_FLOATS), INSTANCE_FLOATS);
      slot.buffer.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < 5; ++k) slot.geometry.setAttribute('i_data' + k, new THREE.InterleavedBufferAttribute(slot.buffer, 4, k * 4));
    }
    slot.buffer.array.set(src.subarray(first * INSTANCE_FLOATS, (first + count) * INSTANCE_FLOATS));
    slot.buffer.clearUpdateRanges();
    slot.buffer.addUpdateRange(0, count * INSTANCE_FLOATS);
    slot.buffer.needsUpdate = true;
    slot.geometry.instanceCount = count;
  }
  // Um desenho: equivalente a um bgfx::submit na vista (0 reflexo, 1 cena).
  submit(view, kind, meshId, src, first, count, u, blend, depthWrite) {
    if (count <= 0) return;
    const slot = this.slot(meshId);
    this.setInstances(slot, src, first, count);
    let m = slot.materials[kind];
    if (!m) m = slot.materials[kind] = this.material(kind);
    slot.mesh.material = m;
    const U = m.uniforms;
    U.u_scene.value.fromArray(u.scene); U.u_clock.value.fromArray(u.clock);
    U.u_color0.value.fromArray(u.color0); U.u_color1.value.fromArray(u.color1);
    U.u_style.value.fromArray(u.style); U.u_art.value.fromArray(u.art);
    if (kind === 'opening') { U.u_family.value.fromArray(u.family); U.s_detail.value = u.detail; }
    if (kind === 'ground') U.s_reflection.value = u.reflection;
    m.blending = blend ? THREE.CustomBlending : THREE.NoBlending;
    m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.depthWrite = depthWrite;
    if (slot.scene !== view) {
      if (slot.scene >= 0) this.scenes[slot.scene].remove(slot.mesh);
      this.scenes[view].add(slot.mesh); slot.scene = view;
    }
    slot.mesh.visible = true;
    slot.mesh.renderOrder = this.order[view]++;
  }

  buildTargets() {
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    const corners = new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3);
    // «position» só para o three.js saber quantos vértices desenhar; o shader lê a_position.
    this.quad.geometry.setAttribute('a_position', corners); this.quad.geometry.setAttribute('position', corners);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    const post = (fs, uniforms) => new THREE.RawShaderMaterial({ vertexShader: SH.vs_quad, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
    this.extract = post(SH.fs_extract, { s_source: { value: null } });
    this.blur = [0, 1].map(() => post(SH.fs_blur, { s_source: { value: null }, u_blur: { value: new THREE.Vector4() } }));
    this.composite = post(SH.fs_composite, {
      ...this.shared, s_source: { value: null }, s_bloom: { value: null }, u_post: { value: new THREE.Vector4() }, u_sky: { value: new THREE.Matrix4() }, u_theme: { value: new THREE.Vector4() },
      u_scene: { value: new THREE.Vector4() }, u_clock: { value: new THREE.Vector4() }, u_color0: { value: new THREE.Vector4() },
      u_color1: { value: new THREE.Vector4() }, u_style: { value: new THREE.Vector4() }, u_art: { value: new THREE.Vector4() },
      u_constellation: { value: new Float32Array(200) }, u_rain: { value: new Float32Array(16) }, u_timer: { value: new Float32Array(20) },
    });
    this.width = 0; this.height = 0;
  }
  // msaa: amostras da cena (undefined = PostMsaa da configuração; o perfil VR usa menos).
  resize(width, height, msaa = undefined) {
    if (width === this.width && height === this.height && msaa === this.msaa) return;
    this.msaa = msaa;
    this.width = width; this.height = height;
    for (const t of [this.reflectionTarget, this.sceneTarget, ...(this.blurTargets || [])]) t?.dispose();
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: THREE.NoColorSpace };
    this.reflectionTarget = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthBuffer: true });
    this.sceneTarget = new THREE.WebGLRenderTarget(width, height, { ...hdr, depthBuffer: true, samples: this.msaa ?? (this.S.PostMsaa >= 2 ? Math.min(this.S.PostMsaa, 8) : 0) });
    this.halfW = Math.max(1, width >> 1); this.halfH = Math.max(1, height >> 1);
    this.blurTargets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(this.halfW, this.halfH, { ...hdr, depthBuffer: false }));
  }

  // ---- lógica por frame (renderer.cpp) ----
  tunnelEndProgress(t) { const S = this.S; const x = clamp((t - S.TunnelEndFadeStart) / S.TunnelEndFadeDuration, 0, 1); return x * x * (3 - 2 * x); }
  ringColour(c, t) {
    const loss = this.S.RingEndDesaturation * D.ringSlowdownProgress(t, this.S);
    const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    return D.blend(c, [l, l, l], loss);
  }
  exitVisibility(seed) {
    const S = this.S;
    if (S.DotsEnabled && S.DotFallBeforeTunnel) return this.comp.previous_exit_progress < 1 ? 1 : 0;
    return D.previousPieceVisibility(seed, this.comp.previous_exit_progress);
  }
  motion(t) { return D.sampleArtMotion(t, this.S); }

  // Uniforms comuns a todo o frame (scene_uniforms + dots_uniforms, a parte que não depende do desenho).
  frameUniforms(state, time, camera) {
    const S = this.S, C = this.C, comp = this.comp, sh = this.shared, beats = this.data.beats;
    const fog = this.ringColour(theme.apply(comp.atmosphere, 'atmosphere'), time);
    sh.u_atmosphere.value.set(fog[0], fog[1], fog[2], comp.exposure);
    D.visualUniforms(C, this.motion(time), time, comp.directed_extension, sh.u_tuning.value);
    sh.u_layout.value.set(comp.geometry_density_multiplier, 25, comp.previous_exit_progress, 0);
    const glow = this.ringColour(C.colour('TunnelGlow'), time);
    const pulseGroup = beats.pulseGroup(time + S.PulseOffset, S.RingPulseStart + S.PulseOffset);
    const beat = beats.sample(time + S.PulseOffset);
    sh.u_choreography.value.set([
      time, S.ExtensionStart, S.ConeSegmentInterval, S.ConeSegmentReveal,
      0, 0, S.ConeSeedDelay, 0,
      comp.previous_exit_progress, S.TunnelStart, S.TunnelFade, S.TunnelPieceReveal,
      comp.tunnel_light_weight, comp.fog_multiplier, comp.directed_extension ? S.LedDensityScale : 1, S.GenericPieceReveal,
      S.ExtensionModulesStart, S.TunnelDepartureStart, S.TunnelDepartureDuration, S.TunnelDepartureDistance * 100,
      glow[0], glow[1], glow[2], S.TunnelGlowEmission * (1 - this.tunnelEndProgress(time)),
      pulseGroup, beat, pulseGroup >= 0 ? 1 : 0, S.ConePaletteVariants]);
    const sp = sh.u_spectral.value;
    ['ConeCyan', 'ConeMagenta', 'CrystalCyan', 'CrystalViolet'].forEach((n, i) => { const c = C.colour(n); sp.set([c[0], c[1], c[2], 1], i * 4); });
    sp.set([S.ConeEmission, S.CrystalEmission, S.CrystalBody, S.CrystalEdge], 16);
    ['RingEven', 'RingOdd', 'ConeBlue', 'ConeWhite', 'ConeViolet', 'ConeGold'].forEach((n, i) => { const c = C.colour(n); sp.set([c[0], c[1], c[2], 1], (i + 5) * 4); });
    for (let i = 5; i < 7; ++i) { const r = this.ringColour([sp[i * 4], sp[i * 4 + 1], sp[i * 4 + 2]], time); sp.set(r, i * 4); }
    sp[23] = S.RingPulseGain; sp[27] = S.RingIdleEmission;
    sh.u_comets.value.set(this.cometTint);
    const d = sh.u_dots.value;
    d.fill(0);
    d[0] = S.DotRadius * 100; d[1] = S.DotOpeningGlow; d[2] = S.DotSoftness; d[3] = S.DotExtensionGlow;
    ['DotShapeDark', 'DotShapeHex', 'DotShapeTrace', 'DotShapePulse', 'DotShapePyramids', 'DotShapePoints', 'DotShapePoles'].forEach((n, i) => { d[4 + i] = S[n]; });
    d[11] = S.DotExtensionRadius * 100;
    for (let k = 0; k < 16; ++k) {
      const n = k === 3 || k === 6 ? 'DotShapePanels' : k === 4 || k === 7 ? 'DotShapeSpheres' : k === 5 ? 'DotShapeRings' : k === 8 ? 'DotShapeCrystals' : k === 9 ? 'DotShapeCones' : 'DotShapeOthers';
      d[12 + k] = S[n];
    }
    d[28] = S.DotPyramidGlow; d[29] = S.DotPyramidMinPixels; d[30] = S.DotFallBeforeTunnel; d[31] = S.DotFallSpread;
    d[36] = S.ConeLines; d[32] = S.CometTrail / S.CometLength; d[33] = S.DotFadeStart * 100; d[34] = S.DotFadeEnd * 100; d[35] = S.DotFadeFloor;
    d[39] = S.DotStairGlow; d[37] = this.tunnelEndProgress(this.lastTime); d[38] = S.TunnelEndStagger;
    d[40] = S.DotLodStart * 100; d[41] = S.DotLodEnd * 100; d[42] = S.DotLodMinKeep; d[43] = S.DotMinScreenPx;
    this.beat = beat;
  }
  // Valores por desenho de scene_uniforms(state,time,camera,reflection,weight,kind).
  drawUniforms(state, time, camera, reflection, weight = 1, kind = 0) {
    return {
      scene: [state.light_intensity, state.pulse_strength, state.fog_density, state.geometry_density],
      clock: [time * this.S.AnimationSpeed, camera, 41600, reflection ? 1 : 0],
      color0: [...state.palette[0], 1], color1: [...state.palette[1], 1],
      style: [weight, kind, this.comp.directed_extension ? 1 : 0, 0],
      art: [this.beat, 1, time, this.comp.opening_weight],
    };
  }
  groupUniforms(u, group, presence, time) {
    u.art = [this.beat, presence, time, group.role];
    const f = this.C.families[group.role];
    u.family = [f.colour[0], f.colour[1], f.colour[2], f.emission];
    u.detail = this.textures[group.material === 1 ? 1 : group.material === 2 ? 2 : 0];
    return u;
  }
  drawDepth(m, o, camera, reflection, wrapped) {
    const x = m[o + 12]; let y = m[o + 13];
    let z = m[o + 14] - (wrapped && this.comp.directed_extension ? 0 : camera);
    if (wrapped && !this.comp.directed_extension) {
      const tunnel = m[o + 18] > 2.5 && m[o + 18] < 7.5;
      z = (z + 41600 + (tunnel ? 1600 : 0)) % 41600; if (z < 0) z += 41600; z -= tunnel ? 1600 : 0;
    }
    if (reflection) y = -y;
    const v = this.eyeView;
    return v[2] * x + v[6] * y + v[10] * z + v[14];
  }
  pushTransparent(view, meshId, group, src, o, weight, kind, presence, depth) {
    const t = this.transparentData, k = t.push();
    t.data.set(src.subarray(o, o + INSTANCE_FLOATS), k);
    this.transparent.push({ view, meshId, group, at: k, weight, kind, presence, depth, seq: this.transparent.length });
  }
  surfaceOpacity(m, o, state, time, weight, kind) {
    const S = this.S, comp = this.comp, variation = m[o + 18], padding = m[o + 19], phase = m[o + 17];
    let density = state.geometry_density;
    if (comp.directed_extension && variation > 2.5 && variation < 7.5 && variation !== 5) density *= S.ArtifactDensity;
    let opacity = weight * clamp((density - padding) * 64, 0, 1);
    if (!comp.directed_extension) return opacity;
    const st = this.choreo;
    if (variation > 7.5) {
      opacity *= this.exitVisibility(padding);
      if (variation !== 8 && variation !== 9)
        opacity *= D.genericPieceVisibility(phase, time, kind < 0.5 ? S.ExtensionModulesStart : S.ExtensionStart, st);
    }
    if (variation > 2.5 && variation < 7.5) {
      opacity *= D.tubePieceVisibility(phase, time, comp.previous_exit_progress, st);
      if (variation !== 5 && D.protoTunnelGap(m, o, S)) return 0;
      if (variation === 3 && S.ProtoTunnelBarsOnly && S.ProtoTunnelBarsPerRing <= 0 && Math.hypot(m[o], m[o + 1], m[o + 2]) < 40) return 0;
      if (variation !== 5) {
        const p = D.tunnelDepartureProgress(padding, time, S.TunnelDepartureStart, S.TunnelDepartureDuration);
        const x = clamp((p - 0.65) / 0.35, 0, 1);
        opacity *= 1 - x * x * (3 - 2 * x);
      }
    }
    return opacity;
  }
  // surface_batch: opacos desenhados já, os restantes para a ordenação global.
  surfaceBatch(view, meshId, list, state, time, camera, reflection, weight, kind) {
    const op = this.opaque; op.reset();
    const m = list.data;
    for (let i = 0; i < list.count; ++i) {
      const o = i * INSTANCE_FLOATS;
      if (!(m[o + 7] > 0)) continue;
      if (m[o + 7] < 0.99999) this.pushTransparent(view, meshId, null, m, o, weight, kind, 0, this.drawDepth(m, o, camera, reflection, true));
      else { const k = op.push(); op.data.set(m.subarray(o, o + INSTANCE_FLOATS), k); }
    }
    for (let first = 0; first < op.count; first += 2048)
      this.submit(view, 'scene', meshId, op.data, first, Math.min(2048, op.count - first), this.drawUniforms(state, time, camera, reflection, weight, kind), false, true);
  }
  boxes(view, items, state, time, camera, reflection, weight, kind) {
    const S = this.S, comp = this.comp, n = items.length / INSTANCE_FLOATS;
    const tmp = this.tmpInstance || (this.tmpInstance = new Float32Array(INSTANCE_FLOATS));
    const alignment = D.directedCameraPosition(S.RingAlignStart, S);
    const ringTravel = D.sampleRingTravel(time, S).offset_seconds * S.CameraSpeed * (state.motion_speed / 0.3) * 100;
    const prepared = (o) => {
      const variation = items[o + 18];
      if (comp.directed_extension) {
        if (variation > 2.5 && variation < 7.5) {
          D.directedTunnelInstance(items, o, tmp, 0, time, camera, alignment, S, state.motion_speed / 0.3, -1, time * S.AnimationSpeed, ringTravel);
          return;
        }
        for (let i = 0; i < INSTANCE_FLOATS; ++i) tmp[i] = items[o + i];
        const radius = 2 * (Math.hypot(items[o], items[o + 1], items[o + 2]) + Math.hypot(items[o + 4], items[o + 5], items[o + 6]) + Math.hypot(items[o + 8], items[o + 9], items[o + 10]));
        tmp[14] = D.retainedWrappedDepth(items[o + 14] - camera, radius, S);
      } else for (let i = 0; i < INSTANCE_FLOATS; ++i) tmp[i] = items[o + i];
    };
    const opacityFor = (o) => {
      let opacity = this.surfaceOpacity(items, o, state, time, weight, kind);
      if (comp.directed_extension) {
        const radius = 2 * (Math.abs(tmp[2]) + Math.abs(tmp[6]) + Math.abs(tmp[10]));
        opacity *= D.rearPieceVisibility(tmp[14] - this.eyeOrigin[2], radius, S);
      }
      return opacity;
    };
    const list = this.scratch;
    for (let first = 0; first < n;) {
      const family = items[first * INSTANCE_FLOATS + 18];
      let end = first + 1;
      while (end < n && items[end * INSTANCE_FLOATS + 18] === family) ++end;
      if (comp.directed_extension && ((family === 10 && S.RemoveDarkTriangles) || (family === 13 && S.RemovePlatforms) || (family === 6 && S.RemoveRibbons) ||
        ((family === 4 || family === 7) && S.ProtoTunnelBarsOnly))) { first = end; continue; }
      if (family === 9 && comp.directed_extension && S.ConeLines) { first = end; continue; }
      if (family === 8 || family === 9) {
        const variants = family === 8 ? S.CrystalVariants : 1;
        const pieces = family === 8 ? CRYSTAL_PIECES : SPECTRAL_CONE_PIECES;
        for (let variant = 0; variant < variants; ++variant) for (let piece = 0; piece < pieces; ++piece) {
          list.reset();
          for (let index = first; index < end; ++index) {
            const o = index * INSTANCE_FLOATS;
            if (family === 8 && Math.floor(items[o + 16] * variants) % variants !== variant) continue;
            prepared(o);
            let opacity = opacityFor(o);
            const start = family === 9 ? S.ExtensionStart : (kind < 0.5 ? S.ExtensionModulesStart : S.ExtensionStart);
            const interval = family === 9 ? S.ConeSegmentInterval : S.CrystalInterval;
            const rev = family === 9 ? S.ConeSegmentReveal : S.CrystalReveal;
            const delay = family === 9 ? S.ConeSeedDelay : S.CrystalDelay;
            let pieceStart = start + piece * interval + items[o + 17] * delay;
            if (comp.directed_extension && family === 9 && S.ConeBeatSync) pieceStart = D.beatAlignedTime(pieceStart + S.PulseOffset, this.data.beats.onsets) - S.PulseOffset;
            let progress = 1;
            if (comp.directed_extension) { progress = D.spectralPieceVisibility(0, 0, time, pieceStart, interval, rev, 0); opacity *= progress; }
            if (opacity <= 0) continue;
            tmp[7] = clamp(opacity, 0, 1);
            if (family === 9) {
              let complete = comp.directed_extension ? start + (pieces - 1) * interval + items[o + 17] * delay : 0;
              if (comp.directed_extension && S.ConeBeatSync) complete = D.beatAlignedTime(complete + S.PulseOffset, this.data.beats.onsets) - S.PulseOffset;
              if (comp.directed_extension) complete += rev;
              tmp[3] = D.rotationAngle(this.coneRates, complete, time);
              tmp[11] = piece < SPECTRAL_CONE_RIBS ? progress : 2;
            } else if (!comp.directed_extension) {
              const x = Math.hypot(tmp[0], tmp[2]), z = Math.hypot(tmp[8], tmp[10]);
              if (z > 0) { tmp[8] *= x / z; tmp[10] *= x / z; }
            }
            list.data.set(tmp, list.push());
          }
          this.surfaceBatch(view, family === 9 ? 'cone_' + piece : 'crystal_' + variant + '_' + piece, list, state, time, camera, reflection, weight, kind);
        }
      } else {
        list.reset();
        for (let index = first; index < end; ++index) {
          const o = index * INSTANCE_FLOATS;
          prepared(o);
          const opacity = opacityFor(o);
          if (opacity > 0) { tmp[7] = clamp(opacity, 0, 1); list.data.set(tmp, list.push()); }
        }
        const meshId = family === 4 || family === 7 ? 'sphere' : family === 5 ? (comp.directed_extension ? 'ring_torus' : 'torus') : family === 6 ? 'ribbon' : family === 3 ? 'panel' :
          family === 12 ? 'diamond' : family === 13 ? 'plate' : 'box';
        this.surfaceBatch(view, meshId, list, state, time, camera, reflection, weight, kind);
      }
      first = end;
    }
  }
  updateComets(state, time, camera) {
    const S = this.S, C = this.C, comp = this.comp, beats = this.data.beats;
    this.cometList.reset();
    this.cometTint.fill(0);
    this.rain.target = null;
    this.cometTint[48] = S.CometTintRadius * 100; this.cometTint[49] = S.CometTintStrength;
    if (!comp.directed_extension || !S.ConeLines || !S.DotsEnabled) return;
    const start = S.ExtensionStart, end = S.PreviousExitStart;
    if (time < start || comp.previous_exit_progress >= 1) return;
    if (state.geometry_density * comp.geometry_density_multiplier <= 0) return;
    const cool = clamp((time - S.ExtensionSecondStart) / S.ExtensionSecondFade, 0, 1);
    this.cometPalette = [D.blend(C.colour('WarmFirst'), C.colour('CoolFirst'), cool), D.blend(C.colour('WarmSecond'), C.colour('CoolSecond'), cool)];
    const capsules = [];
    const onsets = beats.onsets, offset = S.PulseOffset;
    const length = S.CometLength * 100, trail = S.CometTrail * 100;
    const lifetime = (length + trail) / (S.CometSpeed * 100);
    const interval = Math.trunc(S.CometInterval), jitter = Math.trunc(S.CometJitter);
    const first = beats.lowerBound(start + offset);
    for (let index = 0; ; ++index) {
      const seed = (index * 0.6180339887498949) % 1;
      const beat = first + index * interval + Math.trunc(seed * (jitter + 1));
      if (beat >= onsets.length) break;
      const birth = onsets[beat] - offset;
      if (birth >= end || birth > time) break;
      const age = time - birth;
      if (age > lifetime) continue;
      const side = index % 2 === 0 ? 1 : -1;
      const across = (index * 0.7548776662466927) % 1;
      const angle = (((index * 0.5698402909980532) % 1) * 2 - 1) * S.CometAngle * 0.0174532925199433;
      const dx = side * Math.sin(Math.abs(angle)), dz = Math.cos(angle);
      const x = side * (S.CometLateralMin + across * (S.CometLateralMax - S.CometLateralMin)) * 100;
      const z = D.directedCameraPosition(birth, S) - S.EyeBack * 100;
      const k = this.cometList.push(), m = this.cometList.data;
      m.set([dz, 0, -dx, 0, dx * length * 0.5, 0, dz * length * 0.5, 0, 0, 1, 0, age * S.CometSpeed * 100 / length,
        x, S.CometHeight * 100, z - camera, 1], k);
      const colorMix = Math.fround((index * 0.3819660112501051 + 0.05) % 1);
      m[k + 16] = colorMix; m[k + 17] = seed; m[k + 18] = 9; m[k + 19] = 0;
      const visibility = this.exitVisibility(across);
      m[k + 7] = clamp(visibility, 0, 1);
      const head = age * S.CometSpeed * 100 / length;
      const near = Math.min(head, 1), far = Math.max(0, near - S.CometSpeed * 100 * S.CometTintDecay / length);
      const colour = colorMix < 0.5 ? this.cometPalette[0] : this.cometPalette[1];
      this.rain.target = colour;
      const strength = visibility * (1 - clamp((head - 0.85) / 0.15, 0, 1));
      capsules.push([x + dx * length * near, m[k + 13], z - camera + dz * length * near, strength,
        x + dx * length * far, m[k + 13], z - camera + dz * length * far, 0, colour[0], colour[1], colour[2], 0]);
    }
    const count = Math.min(capsules.length, 4);
    for (let k = 0; k < count; ++k) this.cometTint.set(capsules[capsules.length - count + k], 12 * k);
  }
  drawComets(view, state, time, camera, reflection) {
    const list = this.cometList;
    if (!list.count) return;
    const cs = { ...state, palette: this.cometPalette };
    for (let first = 0; first < list.count; first += 2048)
      this.submit(view, 'scene', 'cone_line', list.data, first, Math.min(2048, list.count - first), this.drawUniforms(cs, time, camera, reflection, 1, 0), true, false);
  }
  towerInstances(group, time, out) {
    const S = this.S, comp = this.comp, beats = this.data.beats;
    out.reset();
    const count = Math.trunc(S.TowerCount);
    if (count <= 0 || !comp.directed_extension || !S.ConeLines || !S.DotsEnabled) return;
    const start = S.ExtensionStart;
    if (time < start || comp.previous_exit_progress >= 1) return;
    const offset = S.PulseOffset, back = S.EyeBack * 100, rev = S.TowerReveal * 100;
    const near = D.directedCameraPosition(start, S) - back + rev * 0.5;
    const far = D.directedCameraPosition(S.PreviousExitStart + S.PreviousExitDuration, S) - back + rev;
    const low = S.TowerLateralMin * 100, high = Math.max(low, S.TowerLateralMax * 100);
    const bias = 1 / (1 + S.TowerOuterBias);
    const base = group.instances;
    // Instante de chegada a cada torre: não depende do frame, calcula-se uma vez.
    if (!this.towerArrivals) {
      const arrival = (z) => { let a = start, b = S.OpeningDuration; for (let i = 0; i < 40; ++i) { const m = (a + b) * 0.5; if (D.directedCameraPosition(m, S) - back < z) a = m; else b = m; } return b; };
      this.towerArrivals = [];
      for (let index = 0; index < count; ++index) {
        const along = (index * 0.6180339887498949) % 1;
        const z = near + along * (far - near);
        const entered = Math.max(start, arrival(z - rev));
        const b = beats.lowerBound(entered + offset);
        this.towerArrivals.push(b < beats.onsets.length ? beats.onsets[b] - offset : null);
      }
    }
    for (let index = 0; index < count; ++index) {
      const born = this.towerArrivals[index];
      if (born === null) continue;
      const along = (index * 0.6180339887498949) % 1, across = (index * 0.7548776662466927) % 1;
      const height = S.TowerHeightMin + ((index * 0.5698402909980532) % 1) * (S.TowerHeightMax - S.TowerHeightMin);
      const z = near + along * (far - near);
      const growth = clamp((time - born) / S.TowerGrow, 0, 1);
      if (growth <= 0) continue;
      const side = across < 0.5 ? -1 : 1;
      const lateral = low + (high - low) * Math.pow((across * 2) % 1, bias);
      const k = out.push(), m = out.data;
      m.set(base.subarray(0, INSTANCE_FLOATS), k);
      for (let j = 4; j < 7; ++j) m[k + j] = m[k + j] * height * growth;
      m[k + 12] = side * lateral; m[k + 14] = z; m[k + 7] = 1; m[k + 19] = 0;
    }
  }
  drawOpening(state, time, camera) {
    const S = this.S, comp = this.comp, eye = this.eyeOrigin;
    const motion = this.motion(time);
    const visible = this.opaque, tmp = new Float32Array(INSTANCE_FLOATS);
    const stair = this.data.stair;
    for (const group of this.data.groups) {
      if (!D.directedGroupVisible(group, time, this.C)) continue;
      const start = D.directedGroupStart(group, S);
      const presence = Math.fround(D.openingArtPresence(group.role, time, start, S));
      if (presence <= 0) continue;
      let fade = 1;
      if (group.stage !== Stage.Forest) fade = clamp(((group.stage === Stage.Dome ? S.DomeEnd : S.IntroEnd) - time) / S.StageFade, 0, 1);
      visible.reset();
      const cull = Math.max(group.cull_distance * S.CullMultiplier, (S.RetainBehind + S.BehindFade) * 100);
      const density = this.C.families[group.role].density;
      const src = group.instances, rad = group.radius;
      const weight = comp.opening_weight * fade * presence;
      for (let i = 0; i < group.count; ++i) {
        const s = i * INSTANCE_FLOATS, padding = src[s + 19];
        if (padding >= (group.role === Role.Pyramid ? density : presence * density)) continue;
        D.directedInstanceWithMotion(src, s, tmp, 0, group, motion, S);
        const t = tmp;
        const dz = t[14] - camera - eye[2];
        let radius = rad * Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2] + t[4] * t[4] + t[5] * t[5] + t[6] * t[6] + t[8] * t[8] + t[9] * t[9] + t[10] * t[10]);
        if (group.floor_anchored) radius += Math.max(S.PoleAmplitude, S.MiniPoleMinimum) * 100;
        if (Math.hypot(t[12] - eye[0], t[13] - eye[1], dz) > cull + radius) continue;
        const value = Math.fround((Math.fround(padding * 1024) + 0.5) * 0.61803398875);
        const rank = value - Math.floor(value);
        const gdm = comp.geometry_density_multiplier;
        const layout = clamp((gdm - rank) * 25 + 1, 0, 1) * Math.min(1, gdm * 25) * this.exitVisibility(rank) * D.rearPieceVisibility(dz, radius, S);
        if (layout <= 0) continue;
        t[7] = clamp(layout, 0, 1);
        if (weight * layout < 0.99999) {
          for (let pass = 0; pass < 2; ++pass) this.pushTransparent(pass, group.mesh, group, t, 0, weight, 0, presence, this.drawDepth(t, 0, camera, pass === 0, false));
        } else visible.data.set(t, visible.push());
      }
      if (stair.length && time >= stair[0].time && state.geometry_density * comp.geometry_density_multiplier > 0) {
        const done = stair[stair.length - 1].time + S.DotStairHold;
        const out = 1 - clamp((time - done) / S.DotStairFade, 0, 1);
        for (const circle of stair) {
          if (circle.group !== group.index || time < circle.time || out <= 0) continue;
          const alpha = clamp((time - circle.time) / circle.fade_in, 0, 1) * out;
          tmp.set(circle.instance); tmp[7] = clamp(alpha, 0, 1);
          if (weight * alpha < 0.99999) {
            for (let pass = 0; pass < 2; ++pass) this.pushTransparent(pass, group.mesh, group, tmp, 0, weight, 0, presence, this.drawDepth(tmp, 0, camera, pass === 0, false));
          } else visible.data.set(tmp, visible.push());
        }
      }
      const submit = (list, batchWeight) => {
        for (let first = 0; first < list.count; first += 2048)
          for (let pass = 0; pass < 2; ++pass)
            this.submit(pass, 'opening', group.mesh, list.data, first, Math.min(2048, list.count - first),
              this.groupUniforms(this.drawUniforms(state, time, camera, pass === 0, batchWeight, 0), group, presence, time), false, true);
      };
      submit(visible, weight);
      if (group === this.forest && state.geometry_density * comp.geometry_density_multiplier > 0) {
        const towers = this.towers || (this.towers = new InstanceList(512));
        this.towerInstances(group, time, towers);
        submit(towers, 1);
      }
    }
  }
  flushTransparency(state, time, camera) {
    const list = this.transparent;
    list.sort((a, b) => (a.view !== b.view ? a.view - b.view : b.depth - a.depth || a.seq - b.seq));
    const data = this.transparentData.data;
    const batch = this.batch || (this.batch = new InstanceList(2048));
    for (let first = 0; first < list.length;) {
      const e = list[first];
      let end = first + 1;
      while (end < list.length && end - first < 2048) {
        const n = list[end];
        if (n.view !== e.view || n.meshId !== e.meshId || n.group !== e.group || n.weight !== e.weight || n.kind !== e.kind || n.presence !== e.presence) break;
        ++end;
      }
      batch.reset();
      for (let i = first; i < end; ++i) batch.data.set(data.subarray(list[i].at, list[i].at + INSTANCE_FLOATS), batch.push());
      let u = this.drawUniforms(state, time, camera, e.view === 0, e.weight, e.kind);
      if (e.group) u = this.groupUniforms(u, e.group, e.presence, time);
      this.submit(e.view, e.group ? 'opening' : 'scene', e.meshId, batch.data, 0, batch.count, u, true, false);
      first = end;
    }
    list.length = 0;
    this.transparentData.reset();
  }
  rainUniforms(time, out) {
    const S = this.S, comp = this.comp, rain = this.rain, C = this.C;
    out.fill(0);
    const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const enabled = S.RainEnabled && comp.directed_extension;
    const comets = enabled && S.ConeLines && S.DotsEnabled;
    const cometPresence = comets ? sm((time - S.ExtensionStart - S.RainStart) / S.RainFadeIn) * (1 - comp.previous_exit_progress) : 0;
    const tunnel = enabled ? sm((time - S.RingAlignStart) / S.RainTunnelFadeIn) : 0;
    const tunnelPresence = tunnel * (1 - this.tunnelEndProgress(time));
    const presence = Math.max(cometPresence, tunnelPresence);
    const step = time < rain.time ? 0 : Math.min(time - rain.time, 0.1);
    if (time < rain.time || presence <= 0) rain.coloured = false;
    rain.time = time;
    if (presence > 0) {
      const rings = D.sampleRingTravel(time, S).speed_multiplier / 3;
      const speed = S.RainSpeed * cometPresence * (1 - tunnel) + S.RainTunnelSpeed * rings * tunnel;
      rain.travel = (rain.travel + speed * step) % 2;
      const target = rain.target || (rain.coloured ? rain.colour : this.cometPalette[0]);
      rain.colour = rain.coloured ? D.blend(rain.colour, target, 1 - Math.exp(-step / S.RainColourSeconds)) : target;
      rain.coloured = true;
      const normal = (c) => { const p = Math.max(c[0], c[1], c[2], 0.001); return [c[0] / p, c[1] / p, c[2] / p]; };
      const w = tunnel;
      const even = normal(D.blend(rain.colour, this.ringColour(C.colour('RingEven'), time), w));
      const odd = normal(D.blend(rain.colour, this.ringColour(C.colour('RingOdd'), time), w));
      const mix = (a, b) => S[a] + (S[b] - S[a]) * tunnel;
      out.set([even[0], even[1], even[2], presence, S.RainLanes, mix('RainDensity', 'RainTunnelDensity'), S.RainLength, S.RainWidth,
        rain.travel, mix('RainBrightness', 'RainTunnelBrightness'), w, 0, odd[0], odd[1], odd[2], 0]);
    }
  }

  // Um frame completo no ecrã (Impl::draw + draw_scene). look: {yaw, pitch} em radianos.
  render(time, look, gaze) {
    const S = this.S;
    // Vista: olhos a eye_height, eye_back atrás do percurso; o rato roda a direção (mão esquerda, +z à frente).
    const eye = [0, S.EyeHeight * 100, -S.EyeBack * 100];
    const cp = Math.cos(look.pitch);
    const forward = [Math.sin(look.yaw) * cp, Math.sin(look.pitch), Math.cos(look.yaw) * cp];
    const view = lookAtLH(eye, [eye[0] + forward[0] * 3000, eye[1] + forward[1] * 3000, eye[2] + forward[2] * 3000]);
    const comp = D.directedComposition(time, S, this.playbackEnd);
    const projection = perspectiveLH(S.DesktopFov + comp.weights[2] * 12, this.width / this.height, S.NearPlane * 100, S.FarPlane * 100);
    this.prepare(time, { eye, view, forward }, gaze);
    this.drawView({ eye, view, projection }, null);
  }

  // Lógica de um frame (listas de desenho, uniforms partilhados), uma vez por frame também em VR:
  // a ordenação da transparência usa a vista central (cabeça), que serve aos dois olhos.
  prepare(time, centre, interaction) {
    const S = this.S;
    const comp = this.comp = D.directedComposition(time, S, this.playbackEnd);
    theme.update();
    const state = this.state = D.directedVisualParameters({ ...this.C.parameters, palette: this.C.parameters.palette.map((c, i) => theme.apply(c, 'palette' + i)) }, time, this.C);
    const camera = D.directedCameraPosition(time, S);
    this.camPos = camera; this.time = time;
    this.choreo = {
      tube_start: S.TunnelStart, tube_build_seconds: S.TunnelFade, tube_piece_reveal_seconds: S.TunnelPieceReveal,
      generic_forms_reveal_seconds: S.GenericPieceReveal, segment_reveal_seconds: S.ConeSegmentReveal,
    };
    if (time < this.lastTime) { this.coneRates = [{ time: 0, angle: 0, rate: S.ConeRotation * S.AnimationSpeed * Math.PI / 180 }]; }
    this.lastTime = time;
    const eye = centre.eye;
    this.eyeOrigin = eye;
    this.eyeView.set(centre.view);
    this.forward = centre.forward;
    this.shared.u_eye.value.set(eye[0], eye[1], eye[2], 0);
    interaction?.apply(this, eye, centre.forward, time, camera);
    this.updateComets(state, time, camera);
    this.frameUniforms(state, time, camera);
    // Começa a lista de desenhos.
    for (const [id] of this.pool) this.used.set(id, 0);
    for (const list of this.pool.values()) for (const s of list) s.mesh.visible = false;
    this.order = [0, 0];
    this.transparent.length = 0; this.transparentData.reset();
    if (comp.opening_weight > 0) this.drawOpening(state, time, camera);
    const ext = this.data.extension, tunnel = this.data.tunnel;
    for (let i = 0; i < 3; ++i) {
      const weight = comp.weights[i];
      if (weight <= 0) continue;
      const items = i < 2 ? ext[i] : tunnel;
      const layer = { ...state, geometry_density: state.geometry_density * comp.geometry_density_multiplier };
      if (i < 2) this.boxes(0, items, layer, time, camera, true, weight, i);
      this.boxes(1, items, layer, time, camera, false, weight, i);
    }
    this.drawComets(0, state, time, camera, true);
    this.drawComets(1, state, time, camera, false);
    if (comp.weights[2] < 1) {
      const floor = this.floorInstance || (this.floorInstance = new Float32Array([50000, 0, 0, 0, 0, 1, 0, 0, 0, 0, 50000, 0, 0, 0, 0, 1, 0, 0, 2, 0]));
      const u = this.drawUniforms(state, time, camera, false, 1 - comp.weights[2], comp.weights[1]);
      u.reflection = this.reflectionTarget.texture;
      const blend = comp.weights[2] > 0;
      this.submit(1, 'ground', 'ground', floor, 0, 1, u, blend, !blend);
    }
    this.flushTransparency(state, time, camera);
    this.extras?.(this, time, camera);
    // Composição: o que não depende do olho.
    const cu = this.composite.uniforms, u = this.drawUniforms(state, time, camera, false);
    cu.u_scene.value.fromArray(u.scene); cu.u_clock.value.fromArray(u.clock); cu.u_color0.value.fromArray(u.color0);
    cu.u_color1.value.fromArray(u.color1); cu.u_style.value.fromArray(u.style); cu.u_art.value.fromArray(u.art);
    cu.u_post.value.set(state.bloom, 0, comp.weights[2], comp.weights[1]);
    theme.ambient(cu.u_theme.value);
    this.rainUniforms(time, cu.u_rain.value);
  }

  // Desenha a cena preparada para um olho (ou para o ecrã): view/projection de mão esquerda com profundidade
  // homogénea, eye em cm. output: alvo final (null = ecrã); viewport opcional [x, y, w, h] dentro dele.
  drawView(v, output, viewport = null) {
    const renderer = this.renderer, sh = this.shared, { view, projection, eye } = v;
    sh.u_view.value.fromArray(view); sh.u_proj.value.fromArray(projection);
    sh.u_viewProj.value.multiplyMatrices(sh.u_proj.value, sh.u_view.value);
    sh.u_viewRect.value.set(0, 0, this.width, this.height);
    sh.u_eye.value.set(eye[0], eye[1], eye[2], 0);
    // Vistas 0 e 1.
    renderer.setRenderTarget(this.reflectionTarget);
    renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
    if (this.reflections !== false) renderer.render(this.scenes[0], this.camera);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear(true, true, false);
    renderer.render(this.scenes[1], this.camera);
    // Bloom: extração e desfocagem a meia resolução.
    this.extract.uniforms.s_source.value = this.sceneTarget.texture;
    this.fullScreen(this.extract, this.blurTargets[0]);
    this.blur[0].uniforms.s_source.value = this.blurTargets[0].texture; this.blur[0].uniforms.u_blur.value.set(1 / this.halfW, 0, 0, 0);
    this.fullScreen(this.blur[0], this.blurTargets[1]);
    this.blur[1].uniforms.s_source.value = this.blurTargets[1].texture; this.blur[1].uniforms.u_blur.value.set(0, 1 / this.halfH, 0, 0);
    this.fullScreen(this.blur[1], this.blurTargets[2]);
    // Composição: céu preso ao mundo, chuva, exposição, ACES, gama e vinheta.
    const cu = this.composite.uniforms;
    const sky = new Array(16).fill(0);
    for (let i = 0; i < 3; ++i) {
      sky[i] = view[i * 4] / projection[0];
      sky[4 + i] = -view[i * 4 + 1] / projection[5];
      sky[8 + i] = view[i * 4 + 2] - view[i * 4] * projection[8] / projection[0] - view[i * 4 + 1] * projection[9] / projection[5];
    }
    sky[15] = 1;
    cu.u_sky.value.fromArray(sky);
    cu.s_source.value = this.sceneTarget.texture; cu.s_bloom.value = this.blurTargets[2].texture;
    if (output && viewport) output.viewport.set(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.fullScreen(this.composite, output);
  }
  fullScreen(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.camera);
  }
  drawCount() { return this.order[0] + this.order[1]; }
}
