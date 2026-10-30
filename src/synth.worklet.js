// Port do vrsynth Mallet (DaisySP ModalVoice + Resonator de 24 modos + Svf passa-baixo), como em
// HandSynth: fonte 0 marimba (timbre 0,2, corte 5 kHz), fonte 1 sino (timbre 0,85, corte 9 kHz).
// Cada fonte sai mono num canal próprio, para ser espacializada fora (PannerNode HRTF).
const PI = Math.PI;
const PI3 = PI * PI * PI, PI5 = PI3 * PI * PI;
const fasttan = (f) => { const f2 = f * f; return f * (PI + f2 * (0.326 * PI3 + 0.1823 * PI5 * f2)); };
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MODES = 24, MAX_VOICES = 4, SILENCE = 2e-4, SILENT_STOP = 2048;

function calcStiff(sig) {
  if (sig < 0.25) return -(0.25 - sig) * 0.25;
  if (sig < 0.3) return 0;
  if (sig < 0.9) return (sig - 0.3) / 0.6;
  sig = (sig - 0.9) * 10; sig *= sig;
  return 1.5 - Math.cos(sig * PI) * 0.5;
}
function harmonicCompensation(n, stiffness) {
  let stretch = 1;
  for (let i = 0; i < n - 1; ++i) { stretch += stiffness; stiffness *= stiffness < 0 ? 0.93 : 0.98; }
  return 1 / stretch;
}

class Voice {
  constructor(sr) {
    this.sr = sr;
    this.s1 = new Float32Array(MODES); this.s2 = new Float32Array(MODES);
    this.g = new Float32Array(MODES); this.rg = new Float32Array(MODES); this.h = new Float32Array(MODES); this.a = new Float32Array(MODES);
    this.amp = Math.cos(0.015 * 2 * PI) * 0.25;   // Resonator::Init(0.015, 24)
    this.e1 = 0; this.e2 = 0;
    this.low = 0; this.band = 0;
    this.active = false; this.trig = false; this.age = 0; this.silent = 0;
  }
  noteOn(note, velocity, age, timbre, cutoff, resonance) {
    this.accent = clamp(velocity, 0, 1); this.age = age;
    this.trig = true; this.active = true; this.silent = 0;
    const f = mtof(note);
    // ModalVoice: SetFreq, SetStructure(timbre), SetBrightness(0,3 + 0,5·timbre), damping 0,5.
    this.f0 = clamp(f / this.sr, 0, 0.25);
    const structure = clamp(timbre, 0, 1);
    const brightness0 = 0.3 + 0.5 * timbre, damping0 = 0.5;
    const brightness = brightness0 + 0.25 * this.accent * (1 - brightness0);
    const damping = damping0 + 0.25 * this.accent * (1 - damping0);
    // Filtro da excitação e amplitude do impulso.
    const ec = Math.min(2 * this.f0 * Math.pow(2, ((brightness * (2 - brightness) - 0.5) * 60) / 12), 0.499);
    this.eg = fasttan(ec); const er = 1 / 1.5;
    this.eh = 1 / (1 + er * this.eg + this.eg * this.eg); this.erg = er + this.eg;
    this.impulse = (0.12 + 0.08 * this.accent) * (1 - damping * 0.5) * Math.pow(2, (ec * ec * 24) / 12) / ec;
    // Resonator::Process: coeficientes dos modos (constantes durante a nota).
    let stiffness = calcStiff(structure);
    const f0 = (f / this.sr) * harmonicCompensation(3, stiffness);
    let b = brightness * (1 - structure * 0.3) * (1 - damping * 0.3);
    const qs = Math.pow(2, (damping * 79.7) / 12);
    let q = 500 * qs * qs;
    const qloss = b * (2 - b) * 0.85 + 0.15;
    let harmonic = f0, stretch = 1;
    for (let i = 0; i < MODES; ++i) {
      const mf = Math.min(harmonic * stretch, 0.499);
      const g = fasttan(mf), r = 1 / (1 + mf * q);
      this.g[i] = g; this.rg[i] = r + g; this.h[i] = 1 / (1 + r * g + g * g); this.a[i] = this.amp * (1 - mf * 2);
      stretch += stiffness; stiffness *= stiffness < 0 ? 0.93 : 0.98;
      harmonic += f0; q *= qloss;
    }
    // Svf (passa-baixo da voz).
    const fc = clamp(cutoff, 1e-6, this.sr / 3);
    this.freq = 2 * Math.sin(PI * Math.min(0.25, fc / (this.sr * 2)));
    this.damp = Math.min(2 * (1 - Math.pow(resonance, 0.25)), Math.min(2, 2 / this.freq - this.freq * 0.5));
    this.drive = 0.5 * resonance;
  }
  process() {
    let x = 0;
    if (this.trig) { x = this.impulse; this.trig = false; }
    // Excitação: ResonatorSvf passa-baixo, q 1,5.
    let hp = (x - this.erg * this.e1 - this.e2) * this.eh;
    let bp = this.eg * hp + this.e1; this.e1 = this.eg * hp + bp;
    let lp = this.eg * bp + this.e2; this.e2 = this.eg * bp + lp;
    const input = lp;
    let out = 0;
    const s1 = this.s1, s2 = this.s2, g = this.g, rg = this.rg, h = this.h, a = this.a;
    for (let i = 0; i < MODES; ++i) {
      const hp2 = (input - rg[i] * s1[i] - s2[i]) * h[i];
      const bp2 = g[i] * hp2 + s1[i];
      s1[i] = g[i] * hp2 + bp2;
      const lp2 = g[i] * bp2 + s2[i];
      s2[i] = g[i] * bp2 + lp2;
      out += a[i] * bp2;
    }
    // Svf com duas passagens (saída Low).
    let low = this.low, band = this.band, outLow = 0;
    for (let k = 0; k < 2; ++k) {
      const notch = out - this.damp * band;
      low = low + this.freq * band;
      const high = notch - low;
      band = this.freq * high + band - this.drive * band * band * band;
      outLow += 0.5 * low;
    }
    this.low = low; this.band = band;
    this.silent = Math.abs(outLow) < SILENCE ? this.silent + 1 : 0;
    if (this.silent > SILENT_STOP) this.active = false;
    return outLow;
  }
}

const SOURCES = [
  // Marimba mais suave que no vr-synth (corte 5 kHz e ganho 1,7 soavam estridentes no browser, João 2026-10-30).
  { timbre: 0.2, cutoff: 2600, gain: 0.35 * 1.2 },
  { timbre: 0.85, cutoff: 9000, gain: 0.35 * 1.5 },
];

class MalletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = SOURCES.map(() => Array.from({ length: MAX_VOICES }, () => new Voice(sampleRate)));
    this.pending = [];
    this.counter = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'note') { this.pending.push(m); this.pending.sort((x, y) => x.frame - y.frame); }
      else if (m.type === 'clear') this.pending.length = 0;
    };
  }
  allocate(source) {
    const list = this.voices[source];
    for (const v of list) if (!v.active) return v;
    let best = list[0];
    for (const v of list) if (v.age < best.age) best = v;
    return best;
  }
  process(_inputs, outputs) {
    const n = outputs[0][0].length;
    for (let s = 0; s < 2; ++s) outputs[s][0].fill(0);
    let pos = 0;
    const render = (to) => {
      for (let s = 0; s < 2; ++s) {
        const out = outputs[s][0], gain = SOURCES[s].gain;
        for (const v of this.voices[s]) {
          if (!v.active) continue;
          for (let i = pos; i < to; ++i) out[i] += v.process() * gain;
        }
      }
      pos = to;
    };
    while (this.pending.length && this.pending[0].frame < currentFrame + n) {
      const e = this.pending.shift();
      render(Math.max(pos, Math.min(n, e.frame - currentFrame)));
      const src = SOURCES[e.source];
      this.allocate(e.source).noteOn(e.note, e.velocity, ++this.counter, src.timbre, src.cutoff, 0.2);
    }
    render(n);
    return true;
  }
}
registerProcessor('mallet', MalletProcessor);
