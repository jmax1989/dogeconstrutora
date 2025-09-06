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

// Ajuste fino
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

// Auto-fit inicial
let _autoFitTimer = null;
const AUTO_FIT_MAX_MS = 4000;
const AUTO_FIT_POLL_MS = 120;

// Pose inicial (“Home”) para o Reset
const Home = {
  has: false,
  target: new THREE.Vector3(),
  radius: 0,
  theta: 0,
  phi: 0
};

function saveHomeFromState() {
  Home.has = true;
  Home.target.copy(State.orbitTarget);
  Home.radius = State.radius;
  Home.theta = State.theta;
  Home.phi = State.phi;
}

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

  applyOrbitToCamera();

  setupUnifiedTouchGestureHandler(cvs);
  startAutoFitOnce(); // configura a pose inicial + salva Home

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
    // OBS: mantive default neutro aqui; o auto-fit usa valores específicos
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

// ---------- Auto-fit inicial (não recentra depois) ----------
function startAutoFitOnce() {
  if (_autoFitTimer) return;

  const t0 = performance.now();
  const tick = () => {
    const bb = computeCurrentBBox();
    if (bb) {
      const center = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());

      // ↓↓↓ Ajustes que evitam "cortar" o topo no load:
      const verticalOffsetRatio = -0.06; // mira um pouco ABAIXO do centro => mais “céu” visível
      const margin = 1.28;               // mais folga de enquadramento

      const desired = new THREE.Vector3(center.x, center.y + size.y * verticalOffsetRatio, center.z);

      ensureOrbitTargetVec3();

      const vfovRad = (camera.fov || 50) * Math.PI / 180;
      const idealDist = fitDistanceToBBox(bb, { vfovRad, aspect: camera.aspect || 1, margin });

      // Mantém seus theta/phi atuais; só ajusta alvo e raio
      State.orbitTarget.copy(desired);
      State.radius = idealDist;

      applyOrbitToCamera();
      render();

      // Salva a pose “Home” para o Reset
      saveHomeFromState();

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

// Permite centralizar a partir de um root conhecido (opcional)
export function syncOrbitTargetToModel({ root = null, animate = false, saveAsHome = false } = {}) {
  const bb = computeCurrentBBox(root);
  if (!bb) return;
  recenterCamera({ bbox: bb, animate });
  if (saveAsHome) saveHomeFromState();
}

// ------------- Reset View (volta exatamente ao Home) -------------
export function resetRotation() {
  if (Home.has) {
    State.orbitTarget.copy(Home.target);
    State.radius = Home.radius;
    State.theta = Home.theta;
    State.phi = Home.phi;
    applyOrbitToCamera();
    render();
  } else {
    // fallback clássico
    State.theta = 0;
    State.phi = Math.min(Math.max(1.1, ORBIT_MIN_PHI), ORBIT_MAX_PHI);
    applyOrbitToCamera();
    render();
  }
}

// ------------- Render -------------
export function render() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// ========== ROTATION (arcball em torno do centro do prédio, sem recentrar) ==========
export function orbitDelta(dx, dy, isTouch = false) {
  const ROT = isTouch ? ROT_SPEED_TOUCH : ROT_SPEED_DESKTOP;
  const yaw = dx * ROT;
  const pitch = -dy * ROT;

  // 1) Pivô = centro do modelo (se não achar, usa o target atual)
  const bb = computeCurrentBBox();
  const pivot = bb ? bb.getCenter(new THREE.Vector3()) : State.orbitTarget.clone();

  // 2) Vetores relativos ao pivô
  const P = camera.position.clone();
  const T = State.orbitTarget.clone();
  const up0 = camera.up.clone();

  const vP = P.sub(pivot);
  const vT = T.sub(pivot);

  // 3) Base atual (forward/right/up) re-ortonormalizada
  const forward0 = vT.clone().sub(vP).normalize();                  // direção de visão
  let right0 = new THREE.Vector3().crossVectors(forward0, up0).normalize();
  if (!Number.isFinite(right0.x) || right0.lengthSq() === 0) right0.set(1, 0, 0);
  const up1 = new THREE.Vector3().crossVectors(right0, forward0).normalize();

  // 4) Yaw em Y global, depois Pitch no eixo right já "yawado"
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);

  const vP1 = vP.clone().applyQuaternion(qYaw);
  const vT1 = vT.clone().applyQuaternion(qYaw);
  const forward1 = forward0.clone().applyQuaternion(qYaw);
  const right1 = right0.clone().applyQuaternion(qYaw);
  const upYaw = up1.clone().applyQuaternion(qYaw);

  const qPitch = new THREE.Quaternion().setFromAxisAngle(right1, pitch);

  // Candidatos com pitch
  const vP2 = vP1.clone().applyQuaternion(qPitch);
  const vT2 = vT1.clone().applyQuaternion(qPitch);
  const forward2 = forward1.clone().applyQuaternion(qPitch);
  const up2 = upYaw.clone().applyQuaternion(qPitch);

  // 5) Clamp de phi usando a direção de visão final (forward2)
  const phiNew = Math.acos(THREE.MathUtils.clamp(forward2.y, -1, 1));
  const outOfLimits = (phiNew < ORBIT_MIN_PHI || phiNew > ORBIT_MAX_PHI);

  // 6) Commit: rotaciona câmera, alvo e também o UP pelo mesmo quaternion
  const used_vP = outOfLimits ? vP1 : vP2;
  const used_vT = outOfLimits ? vT1 : vT2;
  const used_up = outOfLimits ? upYaw : up2;

  const Pnew = pivot.clone().add(used_vP);
  const Tnew = pivot.clone().add(used_vT);

  camera.position.copy(Pnew);
  camera.up.copy(used_up.normalize());
  State.orbitTarget.copy(Tnew);

  // Atualiza esféricas do State (compatível com applyOrbitToCamera)
  const rel = camera.position.clone().sub(State.orbitTarget);
  const r = rel.length();
  const ph = Math.acos(THREE.MathUtils.clamp(rel.y / r, -1, 1));
  const th = Math.atan2(rel.z, rel.x);

  State.radius = THREE.MathUtils.clamp(r, ZOOM_MIN, ZOOM_MAX);
  State.theta = th;
  State.phi = THREE.MathUtils.clamp(ph, ORBIT_MIN_PHI, ORBIT_MAX_PHI);

  camera.lookAt(State.orbitTarget);
  render();
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

  // Pan proporcional à distância da câmera
  const base = (State.radius || 20) * (0.0035 * PAN_FACTOR);
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  camera.getWorldDirection(dir);
  right.crossVectors(dir, up).normalize();
  const camUp = camera.up.clone().normalize();

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

// ========== TOQUE UNIFICADO ==========
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
