// Sessão WebXR (immersive-vr) com as matrizes do original (vr/view_math.cpp + Renderer::draw_vr_eye):
// espaço «local» do WebXR = espaço LOCAL do OpenXR, metros com -z à frente; a cena usa cm e +z à frente,
// olhos a vr.eye_height e vr.eye_back. Cada frame prepara a cena uma vez e desenha-a em cada olho.
import * as THREE from 'three';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function rotate(q, v) {
  const u = [q.x, q.y, q.z], a = cross(u, v), b = cross(u, a);
  return [v[0] + 2 * (q.w * a[0] + b[0]), v[1] + 2 * (q.w * a[1] + b[1]), v[2] + 2 * (q.w * a[2] + b[2])];
}

export class XRPresenter {
  constructor(renderer, S) {
    this.renderer = renderer; this.S = S;
    this.session = null; this.space = null; this.target = null;
    this.height = S.VrEyeHeight * 100; this.back = S.VrEyeBack * 100;
  }
  static async supported() {
    try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); } catch { return false; }
  }
  toWorld(p) { return [p.x * 100, this.height + p.y * 100, -this.back - p.z * 100]; }
  // make_eye_matrices: vista de mão esquerda a partir da pose (OpenXR/WebXR → cena).
  eyeMatrices(transform) {
    const q = transform.orientation;
    const eye = this.toWorld(transform.position);
    let forward = rotate(q, [0, 0, -1]); forward[2] = -forward[2]; forward = normalize(forward);
    const up = rotate(q, [0, 1, 0]); up[2] = -up[2];
    const side = normalize(cross(up, forward)), vertical = cross(forward, side);
    const view = [side[0], vertical[0], forward[0], 0, side[1], vertical[1], forward[1], 0,
      side[2], vertical[2], forward[2], 0, -dot(side, eye), -dot(vertical, eye), -dot(forward, eye), 1];
    return { eye, view, forward };
  }
  // Projeção assimétrica do olho, de mão esquerda com profundidade homogénea (como perspectiveLH),
  // a partir das tangentes do campo de visão que a matriz do WebXR traz.
  projection(m) {
    const right = (1 + m[8]) / m[0], left = (m[8] - 1) / m[0], up = (1 + m[9]) / m[5], down = (m[9] - 1) / m[5];
    const n = this.S.NearPlane * 100, f = this.S.FarPlane * 100;
    return [2 / (right - left), 0, 0, 0, 0, 2 / (up - down), 0, 0,
      -(right + left) / (right - left), -(up + down) / (up - down), (f + n) / (f - n), 1, 0, 0, -2 * f * n / (f - n), 0];
  }
  // scale: fração da resolução recomendada pelo óculos (perfil de qualidade).
  async enter({ scale = 0.75, onFrame, onEnd }) {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local'], optionalFeatures: ['hand-tracking'] });
    const gl = this.renderer.getContext();
    await gl.makeXRCompatible();
    const layer = new XRWebGLLayer(session, gl, { antialias: false, depth: false, stencil: false, alpha: false, framebufferScaleFactor: scale });
    session.updateRenderState({ baseLayer: layer, depthNear: this.S.NearPlane, depthFar: this.S.FarPlane });
    this.space = await session.requestReferenceSpace('local');
    // Alvo three.js que aponta para o framebuffer do óculos; cada olho é um viewport dentro dele.
    this.target = new THREE.WebGLRenderTarget(layer.framebufferWidth, layer.framebufferHeight, { depthBuffer: false });
    this.target.isXRRenderTarget = true;
    this.renderer.setRenderTargetFramebuffer(this.target, layer.framebuffer);
    this.session = session; this.layer = layer;
    session.addEventListener('end', () => {
      this.session = null;
      this.renderer.setRenderTarget(null);
      onEnd?.();
    });
    const loop = (_t, frame) => {
      if (!this.session) return;
      session.requestAnimationFrame(loop);
      const pose = frame.getViewerPose(this.space);
      if (!pose) return;
      const centre = this.eyeMatrices(pose.transform);
      const eyes = pose.views.map((view) => {
        const vp = layer.getViewport(view);
        return { ...this.eyeMatrices(view.transform), projection: this.projection(view.projectionMatrix), viewport: [vp.x, vp.y, vp.width, vp.height] };
      });
      onFrame(frame, pose, centre, eyes, this.target);
    };
    session.requestAnimationFrame(loop);
    return session;
  }
  end() { return this.session?.end(); }
}
