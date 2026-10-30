// Port de art_direction.cpp, sequence.cpp, surface_choreography.cpp, rotation_history.cpp e visual_uniforms.cpp
// (Prismatic-Pontos). Mesmas unidades do original: centímetros no mundo, segundos da música.
import { fog_red, fog_green, fog_blue, camera_y } from './curves.js';

export const Role = { Dark: 0, Hex: 1, Trace: 2, Pulse: 3, Pyramid: 4, Point: 5, Pole: 6 };
export const Stage = { Intro: 0, Dome: 1, Forest: 2 };
export const SEQUENCE_DURATION = 424.1821315192744;
const OPENING_DURATION = 120.0;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
export const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
export const reveal = (elapsed, duration) => { const p = clamp(elapsed / Math.max(duration, 0.0001), 0, 1); return p * p * (3 - 2 * p); };
export const blend = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const fmod = (a, b) => a % b;   // igual a std::fmod (sinal do dividendo)

// ---- sequence.cpp ----
function upperBound(keys, t) { let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t < keys[m][0]) hi = m; else lo = m + 1; } return lo; }
export function evaluateCurve(keys, time, fallback = 0) {
  if (!keys.length) return fallback;
  if (!Number.isFinite(time)) time = keys[0][0];
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  const r = upperBound(keys, time), a = keys[r - 1], b = keys[r];
  const duration = b[0] - a[0];
  if (duration <= 0 || a[4] === 1) return a[1];
  const alpha = (time - a[0]) / duration;
  if (a[4] === 0) return a[1] + (b[1] - a[1]) * alpha;
  const p1 = a[1] + duration * a[3] * 0.33333334, p2 = b[1] - duration * b[2] * 0.33333334;
  const lerp = (x, y) => x + (y - x) * alpha;
  const q0 = lerp(a[1], p1), q1 = lerp(p1, p2), q2 = lerp(p2, b[1]);
  return lerp(lerp(q0, q1), lerp(q1, q2));
}
export function sampleCameraPosition(s) { if (!Number.isFinite(s)) s = 0; return evaluateCurve(camera_y, clamp(s, 0, SEQUENCE_DURATION)); }
function sampleSequence(seconds) {
  if (!Number.isFinite(seconds)) seconds = 0;
  seconds = clamp(seconds, 0, SEQUENCE_DURATION);
  const forest = smooth(80, 112, seconds), tunnel = smooth(224, 232, seconds);
  const r = {
    weights: [1 - forest, forest * (1 - tunnel), tunnel],
    atmosphere: [evaluateCurve(fog_red, seconds), evaluateCurve(fog_green, seconds), evaluateCurve(fog_blue, seconds)],
    exposure: 1 - smooth(416, 424, seconds), opening_weight: 1 - smooth(120, 128, seconds), directed_extension: false,
    geometry_density_multiplier: 1, previous_exit_progress: 0, tunnel_light_weight: 1, fog_multiplier: 1,
  };
  r.weights = r.weights.map((w) => w * (1 - r.opening_weight));
  return r;
}

// ---- art_direction.cpp ----
export function sampleArtMotion(time, S) {
  const m = S.AnimationSpeed;
  return {
    points: time * m * S.PointSpeed * 100, traces: time * m * S.TraceSpeed * 100,
    pyramids: Math.max(0, time - S.PyramidStart) * m * S.PyramidRotation * Math.PI / 180,
    sky: time * m * S.SkySpeed, poles: time * m / S.PolePeriod, pole_phase_base: 0, pole_phase_seed: 0,
  };
}
export function extensionColourPresence(t, S) { return S.ExtensionEnabled ? smooth(S.ExtensionColourStart, S.ExtensionColourStart + S.ExtensionColourFade, t) : 0; }
export function redPhasePresence(t, S) { return extensionColourPresence(t, S) * (1 - smooth(S.TunnelStart, S.TunnelStart + S.TunnelFade, t)); }
export function extensionVisualEnergy(t, S) {
  if (!S.ExtensionEnabled) return 1;
  const quiet = smooth(S.QuietStart, S.QuietStart + S.QuietFade, t), recovery = smooth(S.ReturnStart, S.ReturnStart + S.ReturnFade, t);
  return 1 - (1 - S.QuietMinimum) * quiet * (1 - recovery);
}
export function directedComposition(time, S, playbackEnd) {
  const end = playbackEnd >= 0 ? playbackEnd : S.OpeningDuration;
  time = clamp(time, 0, end);
  const r = sampleSequence(time);
  r.opening_weight = 1; r.weights = [0, 0, 0]; r.exposure = 1; r.directed_extension = true; r.tunnel_light_weight = 0;
  if (S.ExtensionEnabled) {
    const forms = smooth(S.ExtensionStart, S.ExtensionStart + S.ExtensionFade, time);
    const modules = smooth(S.ExtensionModulesStart, S.ExtensionModulesStart + S.ExtensionModulesFade, time) * S.ExtensionModulesShare;
    const tunnel = smooth(S.TunnelStart, S.TunnelStart + S.TunnelFade, time);
    const landscape = forms * S.ExtensionShare;
    r.previous_exit_progress = smooth(S.PreviousExitStart, S.PreviousExitStart + S.PreviousExitDuration, time);
    const previous = time < S.PreviousExitStart + S.PreviousExitDuration ? 1 : 0;
    r.opening_weight = (1 - landscape) * previous;
    r.weights = [landscape * modules * previous, landscape * (1 - modules) * previous, tunnel];
    r.exposure = extensionVisualEnergy(time, S);
    r.geometry_density_multiplier = time >= S.TunnelStart ? 1 : 1 - (1 - S.ExtensionDensity) * forms;
    const ready = Math.max(S.TunnelStart, S.RingAlignStart) + S.RingAlignDuration * 0.25;
    r.tunnel_light_weight = smooth(ready, ready + S.TunnelGlowFade, time);
    const red = redPhasePresence(time, S);
    r.fog_multiplier = 1 - (1 - S.RedFogMultiplier) * red;
    if (time >= S.PreviousExitStart && time < S.PreviousExitStart + S.PreviousExitDuration) {
      const a = sampleSequence(S.PreviousExitStart - 0.01).atmosphere, b = sampleSequence(S.PreviousExitStart + S.PreviousExitDuration).atmosphere;
      r.atmosphere = blend(a, b, r.previous_exit_progress);
    }
    const lum = r.atmosphere[0] * 0.2126 + r.atmosphere[1] * 0.7152 + r.atmosphere[2] * 0.0722;
    const sat = 1 - (1 - S.RedSaturation) * red;
    r.atmosphere = r.atmosphere.map((c) => lum + (c - lum) * sat);
    const atm = 1 - (1 - S.RedAtmosphereMultiplier) * red;
    r.atmosphere = r.atmosphere.map((c) => c * atm);
  }
  r.exposure *= 1 - smooth(Math.max(0, end - S.FinalFade), end, time);
  return r;
}
export function directedVisualParameters(source, time, C) {
  const S = C.S, amount = extensionColourPresence(time, S);
  const cool = smooth(S.ExtensionSecondStart, S.ExtensionSecondStart + S.ExtensionSecondFade, time);
  const palette = [0, 1].map((i) => {
    const warm = C.colour(i === 0 ? 'WarmFirst' : 'WarmSecond'), blue = C.colour(i === 0 ? 'CoolFirst' : 'CoolSecond');
    return blend(source.palette[i], blend(warm, blue, cool), amount);
  });
  return { ...source, palette };
}
export function directedCameraPosition(seconds, S) {
  if (!Number.isFinite(seconds)) seconds = 0;
  seconds = clamp(seconds, 0, SEQUENCE_DURATION);
  const duration = S.OpeningDuration;
  const t = Math.max(0, Math.min(seconds, duration) - S.CameraDelay);
  const ramp = S.CameraAcceleration, speed = S.CameraSpeed * 100;
  const distance = ramp > 0 && t < ramp ? speed * (t * t * t / (ramp * ramp) - t * t * t * t / (2 * ramp * ramp * ramp)) : speed * (t - ramp * 0.5);
  const opening = (S.CameraStartZ * S.WorldScale + S.OffsetZ) * 100 + Math.max(0, distance);
  return seconds <= duration ? opening : opening + sampleCameraPosition(seconds) - sampleCameraPosition(duration);
}
export function directedCameraStep(from, to, speed, S) { return (directedCameraPosition(to, S) - directedCameraPosition(from, S)) * (speed / 0.3); }
export function openingArtPresence(role, time, start, S) {
  if (!Number.isFinite(time) || time < start) return 0;
  if (role === Role.Point) return S.PointInitial + (S.PointFinal - S.PointInitial) * smooth(0, S.PointGrowth, time);
  if (role === Role.Pyramid) return smooth(S.PyramidStart, S.PyramidStart + S.PyramidReveal, time);
  return S.InitialPresence + (1 - S.InitialPresence) * smooth(0, S.PresenceGrowth, time);
}
export const isPanelGroup = (g) => g.name.includes('SM_FogSheet');
export function directedGroupStart(g, S) {
  if (g.role === Role.Pyramid) return S.PyramidStart;
  if (isPanelGroup(g)) return S.PanelStart;
  if (g.stage === Stage.Forest) return g.start_time >= 112 ? S.GroundStart : S.ForestStart;
  return g.start_time;
}
export function directedGroupVisible(g, time, C) {
  const S = C.S;
  if (S.RemoveDarkTriangles && (g.role === Role.Pyramid || g.name.includes('SM_Pyramid_Black') || g.name.includes('SM_Pyramid_Gold') || g.name.includes('hollow_pyramid'))) return false;
  if (S.RemovePlatforms && g.stage === Stage.Forest && (g.role === Role.Hex || g.name.includes('SM_Lower_'))) return false;
  if (isPanelGroup(g) && !S.PanelEnabled) return false;
  if (!C.families[g.role].enabled || !Number.isFinite(time) || time < directedGroupStart(g, S)) return false;
  return g.stage === Stage.Forest || time < (g.stage === Stage.Dome ? S.DomeEnd : S.IntroEnd);
}
// world_point com o eixo y dos mini-pilares (mini_pole_height = y + deslocamento).
function worldPoint(m, cm, phase, variation, local) {
  const y = cm > 0 && variation === 11 ? local[1] + phase : local[1];
  return [m[0] * local[0] + m[4] * y + m[8] * local[2] + m[12], m[1] * local[0] + m[5] * y + m[9] * local[2] + m[13], m[2] * local[0] + m[6] * y + m[10] * local[2] + m[14]];
}
// Escreve a instância dirigida (com movimento) em out[o..o+20) a partir de src[s..s+20).
export function directedInstanceWithMotion(src, s, out, o, g, motion, S) {
  for (let i = 0; i < 20; ++i) out[o + i] = src[s + i];
  const padding = src[s + 19];
  if (g.role === Role.Pole) {
    const seed = padding;
    const frequency = 1 + S.PoleVariation * (2 * seed - 1);
    const phase = motion.poles * frequency + seed + motion.pole_phase_base + motion.pole_phase_seed * seed;
    const displacement = S.PoleAmplitude * 100 * Math.sin(6.283185307179586 * phase);
    if (g.floor_anchored) {
      const scale = src[s + 5];
      const minimum = S.MiniPoleMinimum * 100 - scale * (g.bounds_max[1] - g.bounds_min[1]);
      out[o + 13] = -scale * g.bounds_min[1] + Math.max(displacement, minimum);
      out[o + 16] = g.shaft_height; out[o + 17] = 0;
    } else out[o + 13] += displacement;
  }
  if (g.role === Role.Point) {
    const span = S.PointHeight * 100;
    const h = fmod(src[s + 13] - motion.points, span);
    out[o + 13] = h < 0 ? h + span : h;
    for (let c = 0; c < 3; ++c) for (let r = 0; r < 3; ++r) out[o + c * 4 + r] *= S.PointSize;
  }
  if (g.role === Role.Pyramid) {
    const angle = motion.pyramids * (S.PyramidAlternate && padding >= 0.5 ? -1 : 1);
    const c = Math.cos(angle), sn = Math.sin(angle);
    const m = src.subarray(s, s + 16);
    const pivot = worldPoint(m, src[s + 16], src[s + 17], src[s + 18], g.pivot);
    for (let col = 0; col < 3; ++col) { const k = col * 4; out[o + k] = c * m[k] + sn * m[k + 2]; out[o + k + 2] = -sn * m[k] + c * m[k + 2]; }
    const dx = m[12] - pivot[0], dz = m[14] - pivot[2];
    out[o + 12] = pivot[0] + c * dx + sn * dz; out[o + 14] = pivot[2] - sn * dx + c * dz;
  }
}

// ---- surface_choreography.cpp ----
export function spectralPieceVisibility(piece, seed, time, start, interval, revealSeconds, delay) {
  return reveal(time - start - Math.max(0, piece) * interval - clamp(seed, 0, 1) * delay, revealSeconds);
}
export function beatAlignedTime(nominal, onsets) {
  let lo = 0, hi = onsets.length; while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < nominal) lo = m + 1; else hi = m; }
  return lo < onsets.length && onsets[lo] - nominal <= 0.75 ? onsets[lo] : nominal;
}
export function rearPieceVisibility(depth, radius, S) { return 1 - reveal(-depth - Math.max(0, radius) - S.RetainBehind * 100, S.BehindFade * 100); }
export function retainedWrappedDepth(depth, radius, S) {
  const behind = (S.RetainBehind + S.BehindFade) * 100 + Math.max(0, radius);
  const span = 41600 + behind;
  let d = fmod(depth + behind, span); if (d < 0) d += span;
  return d - behind;
}
function ringWindow(S) {
  const start = Math.max(S.RingAlignStart + S.RingAlignDuration, S.RingPulseStart), end = S.OpeningDuration;
  const available = end - start, ramp = Math.min(28, available * 0.25);
  const slowEnd = end - Math.min(6, available * 0.1), slowStart = Math.max(start + ramp, slowEnd - S.RingSlowdown);
  return { start, end, ramp, slowEnd, slowStart };
}
export function sampleRingTravel(time, S) {
  const { start, end, ramp, slowEnd, slowStart } = ringWindow(S);
  if (!Number.isFinite(time) || end <= start || time <= start) return { speed_multiplier: 1, offset_seconds: 0 };
  const integral = (t, a, b) => { if (t <= a) return 0; if (t >= b) return (b - a) * 0.5 + t - b; const u = (t - a) / (b - a); return (b - a) * (u * u * u - 0.5 * u * u * u * u); };
  const extra = 3 * (S.RingSpeedPeak - 1);
  const creepEnd = Math.min(S.RingSpeedRampEnd, slowStart);
  const creepStart = clamp(S.RingSpeedRampStart, start + ramp, creepEnd);
  const creep = extra > 0 && creepEnd - creepStart >= 1;
  time = Math.min(time, end);
  return {
    speed_multiplier: 1 + 2 * reveal(time - start, ramp) + (creep ? extra * reveal(time - creepStart, creepEnd - creepStart) : 0) - (2.75 + (creep ? extra : 0)) * reveal(time - slowStart, slowEnd - slowStart),
    offset_seconds: 2 * integral(time, start, start + ramp) + (creep ? extra * integral(time, creepStart, creepEnd) : 0) - (2.75 + (creep ? extra : 0)) * integral(time, slowStart, slowEnd),
  };
}
export function ringSlowdownProgress(time, S) {
  const { start, end, slowEnd, slowStart } = ringWindow(S);
  if (!Number.isFinite(time) || end <= start) return 0;
  return reveal(time - slowStart, slowEnd - slowStart);
}
export function requiredRingLead(maxSpeed, S) {
  const speed = Math.max(0, maxSpeed), d = S.RingAlignDuration;
  return Math.max(S.RingLead, speed * d * 0.5 + 10, speed * d + 10 - 63 * S.RingSpacing);
}
export function tunnelDepartureProgress(seed, time, start, duration) {
  const delay = clamp(seed, 0, 1) * duration * 0.15;
  return reveal(time - start - delay, duration - delay);
}
const unitHash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
export function protoTunnelGap(src, s, S) {
  if (S.ProtoTunnelRadius <= 0 || S.ProtoTunnelGaps <= 0 || S.ProtoTunnelBarsPerRing > 0 || src[s + 18] === 5) return false;
  const turn = Math.atan2(src[s + 13] - 260, src[s + 12]) / 6.283185307179586 + 0.5;
  return unitHash(Math.floor(turn * 14) + 0.37, Math.floor(src[s + 14] / 1600) * 0.731) < S.ProtoTunnelGaps;
}
// directed_tunnel_instance: escreve em out[o..o+20).
export function directedTunnelInstance(src, s, out, o, time, camera, alignmentCamera, S, speedMultiplier = 1, alignmentLead = -1, animationClock = -1, ringTravel = 0) {
  for (let i = 0; i < 20; ++i) out[o + i] = src[s + i];
  const m = out, b = o;
  const colorMix = src[s + 16], phase = src[s + 17], variation = src[s + 18], padding = src[s + 19];
  if (variation === 5) {
    const pieceDuration = S.RingAlignDuration * 0.5;
    let progress = reveal(time - S.RingAlignStart - phase * pieceDuration, pieceDuration);
    const halfWidth = (S.CorridorWidth * 0.5 + S.CorridorMargin) * 100, height = S.EyeHeight * 100;
    const halfHeight = Math.max(Math.abs(height - S.CorridorFloor * 100), Math.abs(S.CorridorCeiling * 100 - height));
    const inner = Math.max(S.RingInnerRadius * 100, Math.hypot(halfWidth, halfHeight) + S.CorridorMargin * 100);
    const scale = inner / 0.796, spacing = S.RingSpacing * 100;
    const lead = (alignmentLead >= 0 ? alignmentLead : requiredRingLead(S.CameraSpeed * Math.max(1 / 0.3, speedMultiplier), S)) * 100;
    m[b + 14] = Math.fround(alignmentCamera + lead + Math.round(phase * 63) * spacing - camera - ringTravel);
    if (time >= S.RingAlignStart) progress = Math.max(progress, 1 - reveal(m[b + 14] - 1000, 3000));
    m[b + 0] = m[b + 0] + (scale - m[b + 0]) * progress;
    m[b + 5] = m[b + 5] + (scale - m[b + 5]) * progress;
    m[b + 10] = m[b + 10] + (90 - m[b + 10]) * progress;
    m[b + 12] *= 1 - progress;
    m[b + 13] = m[b + 13] + (height - m[b + 13]) * progress;
  } else {
    const proto = S.ProtoTunnelRadius * 100;
    if (proto > 0 && S.ProtoTunnelBarsPerRing <= 0) {
      const dx = m[b + 12], dy = m[b + 13] - 260, radius = Math.hypot(dx, dy);
      const turn = Math.atan2(dy, dx) / 6.283185307179586 + 0.5;
      const ja = unitHash(colorMix, phase) - 0.5, jb = unitHash(phase, colorMix + 0.5) - 0.5;
      const opening = S.ProtoTunnelArc * 0.0174532925199433;
      const arch = 1.5707963267948966 - opening * 0.5 + turn * opening + ja * 0.12;
      const target = proto + S.ProtoTunnelBand * 100 * clamp((radius - 850) / 1300 + jb * 0.3, 0, 1);
      m[b + 12] = Math.cos(arch) * target; m[b + 13] = 260 + Math.sin(arch) * target;
      const tilt = S.ProtoTunnelTilt * 0.0174532925199433;
      const delta = arch - Math.atan2(dy, dx) + jb * 2 * tilt;
      const cd = Math.cos(delta), sd = Math.sin(delta);
      for (let col = 0; col < 3; ++col) { const k = b + col * 4, x = m[k], y = m[k + 1]; m[k] = cd * x - sd * y; m[k + 1] = sd * x + cd * y; }
      const cp = Math.cos(ja * 2 * tilt), sp = Math.sin(ja * 2 * tilt);
      for (let col = 0; col < 3; ++col) { const k = b + col * 4, y = m[k + 1], z = m[k + 2]; m[k + 1] = cp * y - sp * z; m[k + 2] = sp * y + cp * z; }
    }
    const clock = animationClock >= 0 ? animationClock : time * S.AnimationSpeed;
    const seed = colorMix;
    const speed = S.ArtifactSpeedMin + (S.ArtifactSpeedMax - S.ArtifactSpeedMin) * seed;
    const amplitude = S.ArtifactDrift * 100, ph = seed * 6.283185307179586;
    const frequency = amplitude > 0 ? speed * 100 / amplitude : 0;
    const angle = clock * S.ArtifactRotation * 0.0174532925199433 * (0.35 + seed * 0.65) * (padding < 0.5 ? -1 : 1);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let col = 0; col < 3; ++col) { const k = b + col * 4, x = m[k], y = m[k + 1]; m[k] = ca * x - sa * y; m[k + 1] = sa * x + ca * y; }
    const radius = 2 * (Math.hypot(m[b], m[b + 1], m[b + 2]) + Math.hypot(m[b + 4], m[b + 5], m[b + 6]) + Math.hypot(m[b + 8], m[b + 9], m[b + 10]));
    m[b + 14] = retainedWrappedDepth(m[b + 14] - camera, radius, S);
    m[b + 12] += amplitude * Math.sin(clock * frequency + ph);
    m[b + 13] += amplitude * 0.6 * Math.sin(clock * frequency * 0.71 + ph * 1.7);
    m[b + 14] += amplitude * 0.4 * Math.sin(clock * frequency * 1.13 + ph * 0.8);
    const progress = tunnelDepartureProgress(padding, time, S.TunnelDepartureStart, S.TunnelDepartureDuration);
    const radial = Math.hypot(m[b + 12], m[b + 13] - 260);
    if (radial > 0) {
      m[b + 12] += m[b + 12] / radial * progress * S.TunnelDepartureDistance * 100;
      m[b + 13] += (m[b + 13] - 260) / radial * progress * S.TunnelDepartureDistance * 100;
    }
    m[b + 14] += progress * S.TunnelDepartureDistance * 100 * (0.25 + phase * 0.75);
    const rx = Math.abs(m[b]) + Math.abs(m[b + 4]) + Math.abs(m[b + 8]);
    const ry = Math.abs(m[b + 1]) + Math.abs(m[b + 5]) + Math.abs(m[b + 9]);
    const half = (S.CorridorWidth * 0.5 + S.CorridorMargin) * 100;
    if (m[b + 13] + ry > S.CorridorFloor * 100 && m[b + 13] - ry < S.CorridorCeiling * 100 && Math.abs(m[b + 12]) < half + rx)
      m[b + 12] = (m[b + 12] >= 0 ? 1 : -1) * (half + rx);
  }
}
export function previousPieceVisibility(seed, exit) { return 1 - reveal(clamp(exit, 0, 1) - clamp(seed, 0, 1) * 0.65, 0.35); }
export function tubePieceVisibility(rank, time, exit, st) {
  if (exit < 1) return 0;
  const rs = Math.max(st.tube_piece_reveal_seconds, 0.0001);
  return reveal(time - st.tube_start - clamp(rank, 0, 1) * Math.max(0, st.tube_build_seconds - rs), rs);
}
export function genericPieceVisibility(seed, time, start, st) {
  const rs = Math.max(st.segment_reveal_seconds, 0.0001);
  return reveal(time - start - clamp(seed, 0, 1) * Math.max(0, st.generic_forms_reveal_seconds - rs), rs);
}

// ---- rotation_history.cpp ----
export function rotationIntegral(keys, time) {
  if (!keys.length || !Number.isFinite(time)) return 0;
  let k = keys[0];
  for (const key of keys) { if (key.time <= time) k = key; else break; }
  return k.angle + (time - k.time) * k.rate;
}
export function rotationAngle(keys, birth, time) {
  if (time <= birth || !Number.isFinite(birth) || !Number.isFinite(time)) return 0;
  return Math.max(0, rotationIntegral(keys, time) - rotationIntegral(keys, birth));
}

// ---- visual_uniforms.cpp ---- (22 vec4; a linha 20 é a cor/emissão da família Point)
export function visualUniforms(C, motion, time, extension, out) {
  const S = C.S;
  const set = (row, a, b, x, y) => { out[row * 4] = a; out[row * 4 + 1] = b; out[row * 4 + 2] = x; out[row * 4 + 3] = y; };
  const tint = S.TintMix + (S.ExtensionTint - S.TintMix) * (extension ? extensionColourPresence(time, S) : 0);
  const fog = extension ? 1 - (1 - S.RedFogMultiplier) * redPhasePresence(time, S) : 1;
  set(0, S.EmissionGain, tint, S.FogBase * fog / 100, S.FogGain * fog / 100);
  set(1, S.TintStart * 100, S.TintEnd * 100, S.TintNear, S.TintFar);
  const body = C.colour('Body'), fogc = C.colour('Fog'), floor = C.colour('Floor');
  set(2, body[0], body[1], body[2], S.NormalAmbient);
  set(3, fogc[0], fogc[1], fogc[2], S.FogAtmosphere);
  set(4, S.PulseIdle, S.PulseGain, S.PulseCutoff, S.DarkPatternEmission);
  set(5, S.PointHeight * 100, S.PointEdge * 100, S.PointEmission, S.DarkPatternLines);
  set(6, S.TracePeriod * 100, S.TraceSpeed * 100, S.TraceDirection, S.TraceEmission);
  set(7, S.TracePulse, S.TraceLower, S.TraceUpper, S.TraceAA);
  set(8, S.HexEmission, S.HexPulse, S.HexNormal, S.PoleEmission);
  const r = clamp((time - S.DarkPatternStart) / S.DarkPatternReveal, 0, 1);
  set(9, S.PolePulse, S.TreeTip * 100, S.PoleTip * 100, r * r * (3 - 2 * r));
  set(10, S.PyramidLines, S.PyramidWidthMin, S.PyramidWidthMax, S.PyramidSlope);
  set(11, S.PyramidEmission, S.PyramidPulse, S.PyramidRevealSoft, S.PyramidOrder);
  set(12, S.SkyLongitude, S.SkyLatitude, S.SkyRows, S.DarkPatternWidth);
  set(13, S.SkyDensity * C.families[Role.Point].density, S.SkyInner, S.SkyOuter, S.SkyEmission);
  set(14, S.BloomScale, S.Exposure, S.Vignette, S.ToneMapping);
  set(15, S.SkyInitial, S.SkyGrowth, S.Gamma, S.VignetteScale);
  set(16, S.ReflectionBase, S.ReflectionPools, S.ReflectionFresnel, S.FresnelPower);
  set(17, S.FloorGrid * 100, S.GridIntensity, S.ReflectionDisturbance, S.RoughX);
  set(18, S.RoughY, S.FloorFog * fog / 100, S.FloorFogGain * fog / 100, S.FloorAtmosphere);
  set(19, floor[0], floor[1], floor[2], S.ReflectionEnabled);
  const pc = C.families[Role.Point];
  set(20, pc.colour[0], pc.colour[1], pc.colour[2], pc.enabled ? pc.emission : 0);
  set(21, motion.points, motion.traces, motion.pyramids, motion.sky);
  return out;
}
export { OPENING_DURATION };
