// Dados exportados por tools/exporter/web_export.cpp: configuração resolvida, malhas em pontos, instâncias e graves.
import { Role } from './direction.js';

export class Beats {
  constructor(envelope, onsets, duration) { this.envelope = envelope; this.onsets = onsets; this.duration = duration; }
  // BeatEnvelope::sample (100 Hz, interpolação linear).
  sample(seconds) {
    const e = this.envelope;
    if (!Number.isFinite(seconds) || seconds < 0 || !e.length) return 0;
    const frame = seconds * 100;
    if (frame >= e.length - 1) return 0;
    const left = Math.floor(frame);
    return e[left] + (e[left + 1] - e[left]) * (frame - left);
  }
  lowerBound(t) { const o = this.onsets; let lo = 0, hi = o.length; while (lo < hi) { const m = (lo + hi) >> 1; if (o[m] < t) lo = m + 1; else hi = m; } return lo; }
  upperBound(t) { const o = this.onsets; let lo = 0, hi = o.length; while (lo < hi) { const m = (lo + hi) >> 1; if (o[m] <= t) lo = m + 1; else hi = m; } return lo; }
  pulseGroup(seconds, start) {
    if (!Number.isFinite(seconds) || !Number.isFinite(start) || seconds < start) return -1;
    const first = this.lowerBound(start), after = Math.max(first, this.upperBound(seconds));
    if (after === first) return -1;
    return (after - first - 1) % 2;
  }
}

export function parseScene(manifest, buffer) {
  const f32 = (s) => new Float32Array(buffer, s.offset, s.bytes / 4);
  const S = manifest.settings;
  const C = {
    S,
    colours: manifest.colours,
    colour: (name) => manifest.colours[name],
    families: manifest.families,
    parameters: manifest.parameters,
  };
  const meshes = {};
  for (const [id, m] of Object.entries(manifest.meshes)) {
    if (m.kind === 'dots') meshes[id] = { id, dots: true, points: f32(m), count: m.points };
    else meshes[id] = { id, dots: false, vertices: f32(m.vertices), indices: new Uint16Array(buffer, m.indices.offset, m.index_count) };
  }
  const groups = manifest.groups.map((g, index) => ({ ...g, index, instances: f32(g.instances), count: g.instances.count, radius: manifest.radii[g.mesh] }));
  const env = manifest.beats;
  const beats = new Beats(new Float32Array(buffer, env.envelope.offset, env.envelope_count),
    new Float64Array(buffer, env.onsets.offset, env.onset_count), env.duration);
  const stair = manifest.stair.map((s) => ({ group: s.group, time: s.time, fade_in: s.fade_in, instance: new Float32Array(s.instance) }));
  return {
    C, meshes, groups, beats, stair,
    extension: manifest.extension.map(f32), tunnel: f32(manifest.tunnel),
    familyColour: (role) => C.families[role].colour, Role,
  };
}
