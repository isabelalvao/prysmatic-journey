// Esquemas de cor (teclas 1–4). Cada esquema dá uma cor a cada nome de cor da configuração
// (cones, cristais, anéis, cometas, nevoeiro, chão…), ao fundo e ao brilho do céu. 2, 3 e 4 seguem
// as imagens de referência do João (2026-10-30): verde-água néon, magenta/violeta néon, âmbar de cidade
// com acentos magenta. A transição mistura os esquemas com pesos que mudam suavemente em 4 s.
const TRANSITION_SECONDS = 4;

const srgb = (hex) => [0, 2, 4].map((i) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
});
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const WHITE_NAMES = ['Dark', 'Hex', 'Points', 'Poles', 'Pulse', 'Pyramids', 'Trace'];
const BACKGROUND_NAMES = ['Body', 'Fog', 'Floor'];

function scheme(name, o) {
  const s = { name, accentGain: o.accentGain, backgroundGain: o.backgroundGain, glowGain: o.glowGain, colours: {} };
  if (o.colours) for (const [k, v] of Object.entries(o.colours)) s.colours[k] = srgb(v);
  if (o.white) for (const k of WHITE_NAMES) s.colours[k] = srgb(o.white);
  s.background = o.background ? srgb(o.background) : null;
  s.glow = o.glow ? srgb(o.glow) : null;
  s.base = o.base ? srgb(o.base).map((v) => v * o.baseLevel) : [0, 0, 0];
  s.ambient = srgb(o.ambient).map((v) => v * o.ambientLevel);   // luz de fundo na composição (u_theme)
  return s;
}

export const SCHEMES = [
  // Original, mais intenso: as mesmas cores, acentos e fundo mais fortes, um azul ténue no céu.
  scheme('Original', { accentGain: 1.3, backgroundGain: 3, glowGain: 1.4, base: '1E3C8C', baseLevel: 0.05, ambient: '0A1A40', ambientLevel: 0.6 }),
  scheme('Esmeralda', {
    accentGain: 1.35, backgroundGain: 1, glowGain: 1.5, background: '052A2D', glow: '19C8A0', base: '0A5A5A', baseLevel: 0.14, ambient: '0A5A5A', ambientLevel: 0.4,
    white: 'E6FFF5',
    colours: {
      ConeCyan: '19E6C8', CrystalCyan: '3CFFD2', RingEven: '19E6C8', CoolFirst: '0FC8A0',
      ConeMagenta: '3CFF6E', RingOdd: '46FF5A', TunnelGlow: '2EFF8C', CoolSecond: '14B48C',
      ConeBlue: '1496B4', ConeViolet: '19A0A0', CrystalViolet: '0F8C78',
      WarmFirst: '8CFF3C', WarmSecond: 'C8FF78', ConeGold: 'B4FF64', ConeWhite: 'D2FFF0',
      palette0: 'B4FFE6', palette1: '2EC8A0',
    },
  }),
  scheme('Néon', {
    accentGain: 1.35, backgroundGain: 1, glowGain: 1.5, background: '320A46', glow: 'C828DC', base: '501470', baseLevel: 0.14, ambient: '501470', ambientLevel: 0.4,
    white: 'FFE6FF',
    colours: {
      ConeCyan: 'B45AFF', CrystalCyan: 'FF64F0', RingEven: 'FF3CDC', CoolFirst: 'A03CFF',
      ConeMagenta: 'FF1EB4', RingOdd: '8C3CFF', TunnelGlow: 'FF28C8', CoolSecond: '7828FF',
      ConeBlue: '5A50FF', ConeViolet: 'A028FF', CrystalViolet: 'C83CFF',
      WarmFirst: 'FF3C8C', WarmSecond: 'FF78C8', ConeGold: 'FF8CE6', ConeWhite: 'FFDCFF',
      palette0: 'F0C8FF', palette1: 'A03CDC',
    },
  }),
  scheme('Cidade', {
    accentGain: 1.35, backgroundGain: 1, glowGain: 1.5, background: '5A2D05', glow: 'FFA028', base: '784010', baseLevel: 0.14, ambient: '784010', ambientLevel: 0.4,
    white: 'FFF0D2',
    colours: {
      ConeCyan: 'FFB41E', CrystalCyan: 'FFD23C', RingEven: 'FFAA14', CoolFirst: 'FF961E',
      ConeMagenta: 'FF2896', RingOdd: 'FF3CB4', TunnelGlow: 'FFC832', CoolSecond: 'E61E8C',
      ConeBlue: '3CA0FF', ConeViolet: 'FF5A3C', CrystalViolet: 'FF6E28',
      WarmFirst: 'FF8C14', WarmSecond: 'FFC850', ConeGold: 'FFDC3C', ConeWhite: 'FFF0C8',
      palette0: 'FFE6B4', palette1: 'E6963C',
    },
  }),
];

// Cor de um nome no esquema s. name: nome da configuração, 'palette0', 'palette1' ou 'atmosphere'.
function schemeColour(s, c, name) {
  if (name === 'atmosphere') {
    // Brilho do céu e do horizonte: a luminância da curva do original, na cor do esquema, mais um fundo
    // constante para o céu nunca ficar preto.
    const g = s.glow ? s.glow.map((v) => v * lum(c) / lum(s.glow)) : c;
    return [0, 1, 2].map((i) => g[i] * s.glowGain + s.base[i]);
  }
  if (BACKGROUND_NAMES.includes(name)) {
    const b = s.background ? s.background.map((v) => v * Math.min(lum(c) / lum(s.background) * 6, 1)) : c;
    return b.map((v) => v * s.backgroundGain);
  }
  const t = s.colours[name] || c;
  return t.map((v) => v * s.accentGain);
}

class Theme {
  constructor() {
    this.weights = [1, 0, 0, 0];
    this.from = this.weights.slice();
    this.target = 0;
    this.start = -Infinity;
    this.index = 0;
  }
  select(index, now = performance.now() / 1000) {
    if (!SCHEMES[index] || index === this.index) return;
    this.update(now);
    this.from = this.weights.slice();
    this.target = index;
    this.start = now;
    this.index = index;
  }
  // Chamar uma vez por frame, antes de desenhar.
  update(now = performance.now() / 1000) {
    const x = Math.min(Math.max((now - this.start) / TRANSITION_SECONDS, 0), 1), k = x * x * (3 - 2 * x);
    for (let i = 0; i < SCHEMES.length; ++i) this.weights[i] = this.from[i] * (1 - k) + (i === this.target ? k : 0);
  }
  // Luz de fundo do esquema atual (rgb) e quanto se restringe ao vazio (w).
  ambient(out) {
    out.set(0, 0, 0, 0.6);
    for (let i = 0; i < SCHEMES.length; ++i) {
      const a = SCHEMES[i].ambient, w = this.weights[i];
      out.x += a[0] * w; out.y += a[1] * w; out.z += a[2] * w;
    }
    return out;
  }
  apply(c, name) {
    const out = [0, 0, 0];
    for (let i = 0; i < SCHEMES.length; ++i) {
      const w = this.weights[i];
      if (w <= 0) continue;
      const v = schemeColour(SCHEMES[i], c, name);
      out[0] += v[0] * w; out[1] += v[1] * w; out[2] += v[2] * w;
    }
    return out;
  }
}
export const theme = new Theme();
