// ============================
// Cena 3D / Câmera / Renderer
// ============================

import { State } from './state.js';

export let scene, renderer, camera;

// IDs de animação
let _zoomAnim = null;
let _panAnim = null;
let _pendingPan = null;

// Parâmetros de controle
const ORBIT_MIN_PHI = 0.05;
const ORBIT_MAX_PHI = Math.PI - 0.05;
export const INITIAL_THETA = Math.PI / 2;
export const INITIAL_PHI = 1.1;

// Ajuste fino para suavidade e resposta natural
const ROT_SPEED_DESKTOP = 0.004;
const ROT_SPEED_TOUCH = 0.004;
const PAN_FACTOR = 0.4;
const PAN_SMOOTH = 0.22;
const ZOOM_EXP_K_WHEEL = 0.27;
const ZOOM_EXP_K_PINCH = 2;
const ZOOM_FACTOR_MIN = 0.5;
const ZOOM_FACTOR_MAX = 2.0;
const ZOOM_MIN = 4;
const ZOOM_MAX = 400;

// Auto-fit inicial (opcional)
let _autoFitTimer = null;
const AUTO_FIT_MAX_MS = 4000;
const AUTO_FIT_POLL_MS = 120;

function getAppEl() {
  const el = document.getElementById('app');
  if (!el) throw new Error('[scene] #app não encontrado');
  return el;
}

function ensureOrbitTargetVec3() {
  if (!State.orbitTarget || typeof State.orbitTarget.set !== 'function') {
    State.orbitTarget = new THREE.Vector3(0, 0, 0);
  }
  return State.orbitTarget;
}

export function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f141b);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.position.set(8, 8, 8);
  camera.up.set(0, 1, 0);

  // Luzes
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(8, 12, 6);
  scene.add(dir);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const cvs = renderer.domElement;
  cvs.id = 'doge-canvas';
  Object.assign(cvs.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    touchAction: 'none',
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
    msTouchAction: 'none'
  });

  ensureOrbitTargetVec3();
  if (!Number.isFinite(State.theta)) State.theta = Math.PI * 0.25;
  if (!Number.isFinite(State.phi)) State.phi = Math.PI * 0.35;
  if (!Number.isFinite(State.radius)) State.radius = 28;

  getAppEl().prepend(cvs);

  window.addEventListener('resize', onResize, { passive: true });
  onResize();

  // Posição inicial
  applyOrbitToCamera();

  // Gestos touch
  setupUnifiedTouchGestureHandler(cvs);

  // Auto-fit inicial (apenas uma vez)
  startAutoFitOnce();

  return { scene, renderer, camera };
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}

export function applyOrbitToCamera() {
  ensureOrbitTargetVec3();

  const r = Math.max(0.1, Number(State.radius) || 20);
  const th = Number.isFinite(State.theta) ? State.theta : 0;
  const ph = Math.max(ORBIT_MIN_PHI, Math.min(ORBIT_MAX_PHI, Number(State.phi) || 1.1));

  const target = State.orbitTarget;
  const x = target.x + r * Math.sin(ph) * Math.cos(th);
  const y = target.y + r * Math.cos(ph);
  const z = target.z + r * Math.sin(ph) * Math.sin(th);

  camera.position.set(x, y, z);
  camera.lookAt(target);
}

// -------- Bounding Box Utils --------
function computeCurrentBBox(root = null) {
  const targetRoot = root || scene;
  if (!targetRoot) return null;

  const box = new THREE.Box3();
  let has = false;

  targetRoot.traverse((obj) => {
    if (!obj.visible) return;
    if (obj.isMesh && obj.geometry) {
      const geomBox = new THREE.Box3().setFromObject(obj);
      if (
        Number.isFinite(geomBox.min.x) && Number.isFinite(geomBox.max.x) &&
        Number.isFinite(geomBox.min.y) && Number.isFinite(geomBox.max.y) &&
        Number.isFinite(geomBox.min.z) && Number.isFinite(geomBox.max.z)
      ) {
        box.union(geomBox);
        has = true;
      }
    }
  });

  return has ? box : null;
}

function fitDistanceToBBox(bb, { vfovRad, aspect, margin = 1.18 }) {
  const size = bb.getSize(new THREE.Vector3());
  const h = size.y;
  const w = Math.hypot(size.x, size.z);

  const vHalf = h * 0.5;
  const hHalf = w * 0.5;

  const distV = vHalf / Math.tan(vfovRad * 0.5);
  const hfovRad = 2 * Math.atan(Math.tan(vfovRad * 0.5) * aspect);
  const distH = hHalf / Math.tan(hfovRad * 0.5);

  return Math.max(distV, distH) * margin;
}

// ------------- Camera recentre (fit) -------------
export function recenterCamera(a = undefined, b = undefined, c = undefined) {
  let options = {};
  if (a && typeof a === 'object' && !('x' in a)) {
    options = a;
  } else {
    const target = (a && typeof a === 'object' && 'x' in a) ? a : null;
    const dist = (typeof b === 'number' && isFinite(b)) ? b : null;
    const opts = (c && typeof c === 'object') ? c : {};
    options = { target, dist, ...opts };
  }

  const {
    bbox = null,
    root = null,
    verticalOffsetRatio = 0.10,
    target = null,
    dist = null,
    theta = null,
    phi = null,
    margin = 1.18,
    animate = false,
    dur = 280
  } = options;

  const bb = bbox || computeCurrentBBox(root);
  const size = bb ? bb.getSize(new THREE.Vector3()) : new THREE.Vector3(20, 20, 20);
  const ctr = bb ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);

  const cy = ctr.y + (size.y * verticalOffsetRatio);

  const vfovRad = (camera.fov || 50) * Math.PI / 180;
  const idealDist = bb
    ? fitDistanceToBBox(bb, { vfovRad, aspect: camera.aspect || 1, margin })
    : 28;

  const finalDist = (typeof dist === 'number' && isFinite(dist)) ? dist : idealDist;

  if (typeof theta === 'number' && isFinite(theta)) State.theta = theta;
  if (typeof phi === 'number' && isFinite(phi)) State.phi = Math.max(ORBIT_MIN_PHI, Math.min(ORBIT_MAX_PHI, phi));
  if (target && typeof target === 'object' && 'x' in target) ctr.copy(target);

  ensureOrbitTargetVec3();

  if (!animate) {
    State.orbitTarget.set(ctr.x, cy, ctr.z);
    State.radius = finalDist;
    applyOrbitToCamera();
    render();
    return;
  }

  const fromTarget = State.orbitTarget.clone();
  const toTarget = new THREE.Vector3(ctr.x, cy, ctr.z);
  const rFrom = Number(State.radius || 20);
  const rTo = finalDist;

  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const e = ease(k);

    State.orbitTarget.set(
      fromTarget.x + (toTarget.x - fromTarget.x) * e,
      fromTarget.y + (toTarget.y - fromTarget.y) * e,
      fromTarget.z + (toTarget.z - fromTarget.z) * e
    );
    State.radius = rFrom + (rTo - rFrom) * e;

    applyOrbitToCamera();
    if (k < 1) requestAnimationFrame(step); else render();
  };
  requestAnimationFrame(step);
}

// ---------- Auto-fit inicial ----------
function startAutoFitOnce() {
  if (_autoFitTimer) return;

  const t0 = performance.now();
  const tick = () => {
    const bb = computeCurrentBBox();
    if (bb) {
      const center = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());
      const desired = new THREE.Vector3(center.x, center.y + size.y * 0.10, center.z);

      ensureOrbitTargetVec3();
      const distToDesired = State.orbitTarget.distanceTo(desired);

      if (distToDesired > 1) {
        const vfovRad = (camera.fov || 50) * Math.PI / 180;
        const idealDist = fitDistanceToBBox(bb, { vfovRad, aspect: camera.aspect || 1, margin: 1.18 });

        State.orbitTarget.copy(desired);
        State.radius = idealDist;
        applyOrbitToCamera();
        render();
      }

      clearInterval(_autoFitTimer);
      _autoFitTimer = null;
      return;
    }

    if (performance.now() - t0 > AUTO_FIT_MAX_MS) {
      clearInterval(_autoFitTimer);
      _autoFitTimer = null;
    }
  };

  _autoFitTimer = setInterval(tick, AUTO_FIT_POLL_MS);
}

// Força centralização a partir de um root conhecido
export function syncOrbitTargetToModel({ root = null, animate = false } = {}) {
  const bb = computeCurrentBBox(root);
  if (!bb) return;
  recenterCamera({ bbox: bb, animate });
}

// ------------- Reset Camera Rotation -------------
export function resetRotation() {
  State.theta = 0;
  State.phi = Math.min(Math.max(1.1, ORBIT_MIN_PHI), ORBIT_MAX_PHI);
  applyOrbitToCamera();
  render();
}

// ------------- Render -------------
export function render() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// ========== ROTATION (gira ao redor do CENTRO do modelo, sem recentrar na tela) ==========
export function orbitDelta(dx, dy, isTouch = false) {
  const ROT = isTouch ? ROT_SPEED_TOUCH : ROT_SPEED_DESKTOP;

  // 1) Centro do modelo como pivô (se não achar, usa o target atual)
  const bb = computeCurrentBBox();
  const pivot = bb ? bb.getCenter(new THREE.Vector3()) : State.orbitTarget.clone();

  // 2) Vetores atuais relativos ao pivô
  const P = camera.position.clone();
  const T = State.orbitTarget.clone(); // ponto que a câmera está olhando
  const vP = P.clone().sub(pivot);
  const vT = T.clone().sub(pivot);

  // 3) Eixos de rotação
  const up = new THREE.Vector3(0, 1, 0);          // yaw em Y global
  const right = new THREE.Vector3().crossVectors(vP, up).normalize() || new THREE.Vector3(1,0,0);

  // 4) Quaternions de yaw/pitch
  const yaw = dx * ROT;       // arrastar para a direita => yaw positivo
  const pitch = -dy * ROT;    // arrastar para baixo => pitch negativo (padrão turntable)

  const qYaw = new THREE.Quaternion().setFromAxisAngle(up, yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitch);
  const q = new THREE.Quaternion().multiplyQuaternions(qYaw, qPitch);

  // 5) Aplica rotação aos vetores
  const vP1 = vP.clone().applyQuaternion(q);
  const vT1 = vT.clone().applyQuaternion(q);

  // 6) Calcula phi e aplica clamp (se estourar, desfaz pitch e mantém só yaw)
  const vCamToTarget = vP1.clone().sub(vT1); // direção câmera->target (em torno do pivô)
  const r = vCamToTarget.length();
  const n = vCamToTarget.clone().normalize();
  let phi = Math.acos(THREE.MathUtils.clamp(n.y, -1, 1));
  if (phi < ORBIT_MIN_PHI || phi > ORBIT_MAX_PHI) {
    // só yaw
    const vP2 = vP.clone().applyQuaternion(qYaw);
    const vT2 = vT.clone().applyQuaternion(qYaw);
    commitOrbitFromVectors(pivot, vP2, vT2);
  } else {
    commitOrbitFromVectors(pivot, vP1, vT1);
  }

  render();
}

// Converte vetores (relativos ao pivô) para State.{orbitTarget, radius, theta, phi} e aplica
function commitOrbitFromVectors(pivot, vP, vT) {
  const Tnew = pivot.clone().add(vT);
  const Pnew = pivot.clone().add(vP);

  // Atualiza State.orbitTarget
  ensureOrbitTargetVec3();
  State.orbitTarget.copy(Tnew);

  // Sféricas relativas a Tnew (para manter compatibilidade com applyOrbitToCamera)
  const v = Pnew.clone().sub(Tnew);
  const r = v.length();
  const ph = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
  const th = Math.atan2(v.z, v.x);

  State.radius = THREE.MathUtils.clamp(r, ZOOM_MIN, ZOOM_MAX);
  State.theta = th;
  State.phi = THREE.MathUtils.clamp(ph, ORBIT_MIN_PHI, ORBIT_MAX_PHI);

  applyOrbitToCamera();
}

// ========== PAN SUAVE ==========
export function panDelta(dx, dy) {
  ensureOrbitTargetVec3();
  if (_pendingPan) {
    _pendingPan.dx += dx;
    _pendingPan.dy += dy;
    return;
  }
  _pendingPan = { dx, dy };
  if (_panAnim) cancelAnimationFrame(_panAnim);
  _panAnim = requestAnimationFrame(animatePan);
}

function animatePan() {
  if (!_pendingPan) return;
  let { dx, dy } = _pendingPan;
  const applyDx = dx * PAN_SMOOTH;
  const applyDy = dy * PAN_SMOOTH;
  _pendingPan.dx -= applyDx;
  _pendingPan.dy -= applyDy;

  // Pan proporcional à distância da câmera, mas moderado
  const base = (State.radius || 20) * (0.0035 * PAN_FACTOR);
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  camera.getWorldDirection(dir);
  right.crossVectors(dir, up).normalize();
  const camUp = camera.up.clone().normalize();

  // Move camera e target juntos (mantém offset de tela)
  State.orbitTarget.addScaledVector(right, -applyDx * base);
  State.orbitTarget.addScaledVector(camUp, applyDy * base);

  applyOrbitToCamera();
  render();

  if (Math.abs(_pendingPan.dx) > 0.2 || Math.abs(_pendingPan.dy) > 0.2) {
    _panAnim = requestAnimationFrame(animatePan);
  } else {
    _pendingPan = null;
    _panAnim = null;
  }
}

// ========== ZOOM SUAVE ==========
export function zoomDelta(deltaOrObj = 0, isPinch = false) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r0 = clamp(Number(State.radius) || 20, ZOOM_MIN, ZOOM_MAX);

  let factor = 1;
  if (deltaOrObj && typeof deltaOrObj === 'object' && typeof deltaOrObj.scale === 'number') {
    factor = Number(deltaOrObj.scale) || 1;
  } else {
    const delta = Number(deltaOrObj) || 0;
    if (delta === 0) return;
    const k = isPinch ? ZOOM_EXP_K_PINCH : ZOOM_EXP_K_WHEEL;
    factor = Math.exp(delta * k);
  }

  factor = clamp(factor, ZOOM_FACTOR_MIN, ZOOM_FACTOR_MAX);
  const target = clamp(r0 * factor, ZOOM_MIN, ZOOM_MAX);

  if (Math.abs(target - r0) < 0.01) {
    State.radius = target;
    applyOrbitToCamera();
    render();
    return;
  }

  if (_zoomAnim) { cancelAnimationFrame(_zoomAnim); _zoomAnim = null; }

  const dur = isPinch ? 90 : 240;
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);

  const ratio = target / r0;
  function stepZoom(now) {
    const k = Math.min(1, (now - t0) / dur);
    const e = ease(k);
    State.radius = r0 * Math.pow(ratio, e);
    applyOrbitToCamera();
    render();
    if (k < 1) _zoomAnim = requestAnimationFrame(stepZoom);
    else _zoomAnim = null;
  }
  _zoomAnim = requestAnimationFrame(stepZoom);
}

// ========== TOQUE UNIFICADO: DISTINGUE PAN VS PINCH ==========
function setupUnifiedTouchGestureHandler(canvas) {
  let lastTouches = null;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastTouches = getTouchesInfo(e.touches);
    } else {
      lastTouches = null;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && lastTouches) {
      const now = getTouchesInfo(e.touches);
      const distDelta = now.dist - lastTouches.dist;
      const centerDeltaX = now.centerX - lastTouches.centerX;
      const centerDeltaY = now.centerY - lastTouches.centerY;

      // Critério: se a variação de distância for maior que a de centro → pinch; caso contrário, pan
      if (Math.abs(distDelta) > Math.max(Math.abs(centerDeltaX), Math.abs(centerDeltaY))) {
        zoomDelta(distDelta / 120, true);
      } else {
        panDelta(centerDeltaX, centerDeltaY);
      }
      lastTouches = now;
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      lastTouches = null;
    }
  }, { passive: false });

  function getTouchesInfo(touches) {
    const [a, b] = touches;
    const dx = b.clientX - a.clientX, dy = b.clientY - a.clientY;
    return {
      dist: Math.hypot(dx, dy),
      centerX: (a.clientX + b.clientX) / 2,
      centerY: (a.clientY + b.clientY) / 2
    };
  }
}
