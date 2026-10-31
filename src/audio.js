// Música (MASTER) e notas do olhar. A música toca num AudioBufferSourceNode já descodificado; o relógio
// da obra é o da placa de som, para a imagem seguir o que se ouve. As notas do olhar são o port de
// audio/point_music.cpp (grelha de semicolcheias, pentatónica de ré menor filtrada pelos acordes).
import workletUrl from './synth.worklet.js?url';

const PENTATONIC = [2, 5, 7, 9, 0];
const LEFT_BASE = 62, RIGHT_BASE = 74;   // marimba ré 4, sino ré 5
const SOURCE_DISTANCE_M = 3;
const LOOKAHEAD = 0.06;
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export class ChordMap {
  constructor(doc) {
    this.bpm = doc?.bpm ?? 112; this.beatsPerBar = doc?.beats_per_bar ?? 4; this.bars = doc?.bars ?? [];
  }
  at(seconds) {
    const bar = seconds * this.bpm / 60 / this.beatsPerBar;
    if (bar < 0 || bar >= this.bars.length || !this.bars[Math.floor(bar)].length) return PENTATONIC;
    return this.bars[Math.floor(bar)];
  }
}
export function pointNote(elevationDeg, classes, base) {
  const target = base + 24 * smoothstep(-35, 40, elevationDeg);
  let best = base, distance = 1e9;
  for (let n = base - 2; n <= base + 26; ++n) {
    if (!classes.includes(n % 12)) continue;
    if (Math.abs(n - target) < distance) { distance = Math.abs(n - target); best = n; }
  }
  return best;
}

// PointMusic com o olhar no lugar das mãos: olhar para a esquerda toca a marimba (mão esquerda),
// para a direita o sino (mão direita). Só soa enquanto o olhar está ativo (o rato mexeu há pouco).
export class PointMusic {
  constructor(chords) { this.chords = chords; this.reset(); }
  reset() { this.lastTick = [-1, -1]; this.lastNote = [-1, -1]; this.lastSeconds = 0; }
  update(seconds, forward, active) {
    const notes = [];
    const sixteenth = 60 / this.chords.bpm / 4;
    if (seconds + 1e-6 < this.lastSeconds) this.lastTick = [-1, -1];
    this.lastSeconds = seconds;
    const nextTick = Math.ceil(seconds / sixteenth - 1e-9);
    const hand = forward[0] >= 0 ? 1 : 0;
    for (let h = 0; h < 2; ++h) if (!active || h !== hand) this.lastNote[h] = -1;
    if (!active) return notes;
    if (nextTick <= this.lastTick[hand] || nextTick * sixteenth - seconds > LOOKAHEAD) return notes;
    const reach = Math.hypot(forward[0], forward[2]);
    const elevation = Math.atan2(forward[1], Math.max(reach, 1e-3)) * 57.29578;
    const note = pointNote(elevation, this.chords.at(nextTick * sixteenth), hand === 1 ? RIGHT_BASE : LEFT_BASE);
    this.lastTick[hand] = nextTick;
    if (note === this.lastNote[hand] && nextTick % 4 !== 0) return notes;
    const strength = 1;   // o olhar aponta sempre com força total
    notes.push({ voice: hand, note, velocity: 0.5 + 0.4 * strength, seconds: nextTick * sixteenth,
      position: forward.map((v) => v * SOURCE_DISTANCE_M) });
    this.lastNote[hand] = note;
    return notes;
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.buffer = null; this.source = null;
    this.offset = 0; this.t0 = 0; this.playing = false;
    this.duration = 0;
  }
  // Ogg/Opus no Chrome e Firefox; AAC (m4a) no Safari.
  static preferredUrl(base) {
    const a = document.createElement('audio');
    return a.canPlayType('audio/ogg; codecs="opus"') ? base + '.ogg' : base + '.m4a';
  }
  async load(bytes) {
    this.buffer = await this.ctx.decodeAudioData(bytes);
    this.duration = this.buffer.duration;
  }
  async setupSynth() {
    const ctx = this.ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    this.synth = new AudioWorkletNode(ctx, 'mallet', { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [1, 1] });
    // Saturação suave do motor (tanh), depois da espacialização, como em Engine::renderBlock.
    const pre = new GainNode(ctx, { gain: 0.25 });
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; ++i) curve[i] = Math.tanh(4 * (i / 2048 - 1));
    const shaper = new WaveShaperNode(ctx, { curve, oversample: 'none' });
    // Volume do som interativo face à música (0,6 ≈ -4,4 dB, pedido do João a 2026-10-30).
    this.synthVolume = new GainNode(ctx, { gain: 0.6 });
    pre.connect(shaper).connect(this.synthVolume).connect(ctx.destination);
    this.pre = pre;
    this.panners = [0, 1].map((i) => {
      const p = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: SOURCE_DISTANCE_M, rolloffFactor: 1 });
      this.synth.connect(p, i);
      p.connect(pre);
      return p;
    });
    // Ouvinte virado para o percurso (o som vem de onde se olha). Mundo de mão esquerda (+z à frente) → Web Audio (-z).
    const l = ctx.listener;
    if (l.forwardX) { l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
    else l.setOrientation(0, 0, -1, 0, 1, 0);
  }
  // Em VR o ouvinte segue a cabeça (posição e orientação no espaço local do WebXR), como no HandSynth.
  setListener(position, forward, up) {
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(position[0], t, 0.01); l.positionY.setTargetAtTime(position[1], t, 0.01); l.positionZ.setTargetAtTime(position[2], t, 0.01);
      l.forwardX.setTargetAtTime(forward[0], t, 0.01); l.forwardY.setTargetAtTime(forward[1], t, 0.01); l.forwardZ.setTargetAtTime(forward[2], t, 0.01);
      l.upX.setTargetAtTime(up[0], t, 0.01); l.upY.setTargetAtTime(up[1], t, 0.01); l.upZ.setTargetAtTime(up[2], t, 0.01);
    } else { l.setPosition(...position); l.setOrientation(...forward, ...up); }
  }
  resetListener() { this.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]); }
  // Tempo da música que está a ser processado agora pelo grafo (para agendar).
  graphSeconds() { return this.playing ? this.ctx.currentTime - this.t0 + this.offset : this.offset; }
  // Tempo da música que se está a ouvir agora (para desenhar).
  heardSeconds() {
    if (!this.playing) return this.offset;
    const ts = this.ctx.getOutputTimestamp?.();
    let t = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return Math.min(Math.max(t - this.t0 + this.offset, this.offset - 0.05), this.graphSeconds());
  }
  play(at = this.offset) {
    this.stop();
    this.offset = Math.max(0, Math.min(at, this.duration));
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer });
    s.connect(this.ctx.destination);
    this.t0 = this.ctx.currentTime + 0.02;
    s.start(this.t0, this.offset);
    this.source = s; this.playing = true;
  }
  pause() { if (!this.playing) return; this.offset = this.graphSeconds(); this.stop(); }
  stop() {
    if (this.source) { try { this.source.stop(); } catch { /* já parado */ } this.source.disconnect(); this.source = null; }
    if (this.playing) this.synth?.port.postMessage({ type: 'clear' });
    this.playing = false;
  }
  seek(seconds) { const was = this.playing; this.stop(); this.offset = Math.max(0, Math.min(seconds, this.duration)); if (was) this.play(this.offset); }
  ended() { return this.playing && this.graphSeconds() >= this.duration; }
  // Estalo dos dedos (HandSynth::snap): «sopro» de dois dentes de serra desafinados 12 cents num filtro baixo de
  // 1,4 kHz, ataque 15 ms e queda de 0,5 s sem sustentação, ganho 0,35; nasce onde o estalo foi detetado
  // (espaço local do WebXR). Um estalo novo da mesma mão solta o anterior (release 0,3 s).
  snap(hand, note, velocity, position) {
    if (!this.synth) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.snapVoices ??= [null, null];
    const previous = this.snapVoices[hand];
    if (previous) { previous.env.gain.cancelScheduledValues(t); previous.env.gain.setTargetAtTime(0, t, 0.3 / 4); }
    const f = 440 * 2 ** ((note - 69) / 12);
    const oscillators = [0, 12].map((cents) => new OscillatorNode(ctx, { type: 'sawtooth', frequency: f, detune: cents }));
    const mixGain = new GainNode(ctx, { gain: 0.5 });
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1400, Q: 1.2 });
    const env = new GainNode(ctx, { gain: 0 });
    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: SOURCE_DISTANCE_M, rolloffFactor: 1,
      positionX: position[0], positionY: position[1], positionZ: position[2] });
    for (const o of oscillators) o.connect(mixGain);
    mixGain.connect(filter).connect(env).connect(panner).connect(this.pre);
    const peak = velocity * 0.35;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.015);
    env.gain.setTargetAtTime(0, t + 0.015, 0.5 / 4);
    const voice = {
      env,
      stop: (when) => { for (const o of oscillators) o.stop(when); },
    };
    for (const o of oscillators) o.start(t);
    voice.stop(t + 1.2);
    oscillators[0].onended = () => { panner.disconnect(); if (this.snapVoices[hand] === voice) this.snapVoices[hand] = null; };
    this.snapVoices[hand] = voice;
  }
  // Agenda as notas no relógio da placa, na semicolcheia exata.
  playNotes(notes) {
    if (!this.synth || !this.playing) return;
    for (const n of notes) {
      const when = Math.max(this.ctx.currentTime, this.t0 + n.seconds - this.offset);
      const p = this.panners[n.voice];
      // Notas do olhar: direção no mundo (mão esquerda, +z à frente). Notas das mãos (VR): espaço local do
      // WebXR, já com -z à frente como o Web Audio.
      p.positionX.setValueAtTime(n.position[0], when);
      p.positionY.setValueAtTime(n.position[1], when);
      p.positionZ.setValueAtTime(n.local ? n.position[2] : -n.position[2], when);
      this.synth.port.postMessage({ type: 'note', source: n.voice, note: n.note, velocity: n.velocity, frame: Math.round(when * this.ctx.sampleRate) });
    }
  }
}
