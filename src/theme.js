// Esquemas de cor (teclas 1–4). Cada esquema é uma transformação linear das cores da configuração
// (rotação de matiz e saturação, em RGB linear). Por isso as relações entre cores do original
// mantêm-se, e a transição é só uma interpolação entre duas matrizes.
const TRANSITION_SECONDS = 4;

function hueSaturation(degrees, saturation, tint = [1, 1, 1]) {
  // Rotação de matiz à volta do eixo cinzento (luminâncias Rec. 709) e escala da saturação.
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const hue = [
    lr + c * (1 - lr) + s * -lr, lg + c * -lg + s * -lg, lb + c * -lb + s * (1 - lb),
    lr + c * -lr + s * 0.143, lg + c * (1 - lg) + s * 0.14, lb + c * -lb + s * -0.283,
    lr + c * -lr + s * -(1 - lr), lg + c * -lg + s * lg, lb + c * (1 - lb) + s * lb,
  ];
  const m = new Array(9);
  for (let r = 0; r < 3; ++r)
    for (let k = 0; k < 3; ++k) {
      const grey = [lr, lg, lb][k];
      m[r * 3 + k] = (grey + (hue[r * 3 + k] - grey) * saturation) * tint[r];
    }
  return m;
}

export const SCHEMES = [
  { name: 'Original', matrix: hueSaturation(0, 1) },
  { name: 'Âmbar', matrix: hueSaturation(165, 0.85, [1.04, 0.97, 0.9]) },   // ciano → laranja; menos saturado para o magenta rodado não ficar verde-ácido
  { name: 'Esmeralda', matrix: hueSaturation(-75, 0.9) },     // ciano → verde, azul → turquesa, magenta → vermelho
  { name: 'Prata', matrix: hueSaturation(0, 0.12, [0.92, 0.97, 1.05]) },
];

class Theme {
  constructor() {
    this.current = SCHEMES[0].matrix.slice();
    this.from = this.current.slice();
    this.to = this.current;
    this.start = -Infinity;
    this.index = 0;
  }
  select(index, now = performance.now() / 1000) {
    if (!SCHEMES[index] || index === this.index) return;
    this.update(now);
    this.from = this.current.slice();
    this.to = SCHEMES[index].matrix;
    this.start = now;
    this.index = index;
  }
  // Chamar uma vez por frame, antes de desenhar.
  update(now = performance.now() / 1000) {
    const x = Math.min(Math.max((now - this.start) / TRANSITION_SECONDS, 0), 1), k = x * x * (3 - 2 * x);
    for (let i = 0; i < 9; ++i) this.current[i] = this.from[i] + (this.to[i] - this.from[i]) * k;
  }
  apply(c) {
    const m = this.current;
    return [
      Math.max(0, m[0] * c[0] + m[1] * c[1] + m[2] * c[2]),
      Math.max(0, m[3] * c[0] + m[4] * c[1] + m[5] * c[2]),
      Math.max(0, m[6] * c[0] + m[7] * c[1] + m[8] * c[2]),
    ];
  }
}
export const theme = new Theme();
