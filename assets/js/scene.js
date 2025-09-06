// ============================
// Cena 3D / Câmera / Renderer
// ============================

import { State } from './state.js';
// import { clamp } from './utils.js'; // (não usado)
export let scene, renderer, camera;

let _zoomAnim = null; // zoom animation frame id
let _panAnim = null;  // pan animation frame id
let _pendingPan = null; // {dx, dy}

// Alvo do orbit (reutiliza State.orbitTarget)
const ORBIT_MIN_PHI = 0.05;
const ORBIT_MAX_PHI = Math.PI - 0.05;
export const INITIAL_THETA = Math.PI / 2; // 90° anti-horário
export const INITIAL_PHI = 1.1;

// Sensibilidades
const ROT_SPEED_DESKTOP = 0.003;
const ROT_SPEED_TOUCH = 0.003;
const PAN_FACTOR = 0.3;
const ZOOM_STEP_FACTOR = 0.001;

// Canvas host
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
  // Cena + câmera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f141b);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.position.set(8, 8, 8);
  camera.up.set(0, 1, 0);

  // Luzes mínimas
  const amb = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(8, 12, 6);
  scene.add(dir);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  // Canvas: desabilita gestos do navegador (pinch-zoom, duplo toque, etc.)
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

  // Defaults seguros antes de qualquer uso
  ensureOrbitTargetVec3();
  if (!Number.isFinite(State.theta)) State.theta = Math.PI * 0.25; // ~45°
  if (!Number.isFinite(State.phi)) State.phi = Math.PI * 0.35; // inclinação
  if (!Number.isFinite(State.radius)) State.radius = 28; // distância

  // Container
  const app = getAppEl();
  app.prepend(cvs); // canvas fica atrás do grid 2D

  // Redimensiona
  window.addEventListener('resize', onResize, { passive: true });
  onResize();

  // Primeira aplicação de câmera a partir do estado
  applyOrbitToCamera();

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

// ----------------------------
// Câmera orbital (usa State.*)
// ----------------------------
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

// ---- BBox atual da "Torre" (sem importar geometry p/ evitar ciclo) ----
function computeCurrentBBox() {
  let torre = null;
  scene?.traverse(n => { if (!torre && n.name === 'Torre') torre = n; });
  if (!torre) return null;
  const bb = new THREE.Box3().setFromObject(torre);
  if (!Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
  return bb;
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

// ---------------------------------------------------------
// Recenter (retrocompat):
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
    verticalOffsetRatio = 0.10,
    target = null,
    dist = null,
    theta = null,
    phi = null,
    margin = 1.18,
    animate = false,
    dur = 280
  } = options;

  const bb = bbox || computeCurrentBBox();
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

export function resetRotation() {
  State.theta = 0;
  State.phi = Math.min(Math.max(1.1, ORBIT_MIN_PHI), ORBIT_MAX_PHI);
  applyOrbitToCamera();
  render();
}

// ----------------------------
// Render
// ----------------------------
export function render() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// =====================================================
// INPUT BASE (opcional)
// =====================================================

// ========== ROTATION ==========
// Rotation já é suave pois depende do mousemove contínuo (sem animação extra)
export function orbitDelta(dx, dy, isTouch = false) {
  const ROT = isTouch ? ROT_SPEED_TOUCH : ROT_SPEED_DESKTOP;
  State.theta += dx * ROT;
  State.phi -= dy * ROT;
  State.phi = Math.max(ORBIT_MIN_PHI, Math.min(ORBIT_MAX_PHI, State.phi));
  applyOrbitToCamera();
  render();
}

// ========== PAN (agora suavizado) ==========
export function panDelta(dx, dy) {
  ensureOrbitTargetVec3();

  // Acumula pan pendente
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

  // Suavização: aplica apenas parte do delta por frame
  const PAN_SMOOTH = 0.18; // 0.2 = mais lento, 1 = instantâneo
  let { dx, dy } = _pendingPan;
  const applyDx = dx * PAN_SMOOTH;
  const applyDy = dy * PAN_SMOOTH;
  _pendingPan.dx -= applyDx;
  _pendingPan.dy -= applyDy;

  const base = (State.radius || 20) * (0.0025 * PAN_FACTOR);
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

  // Se ainda resta delta significativo, continua animando
  if (Math.abs(_pendingPan.dx) > 0.2 || Math.abs(_pendingPan.dy) > 0.2) {
    _panAnim = requestAnimationFrame(animatePan);
  } else {
    _pendingPan = null;
    _panAnim = null;
  }
}

// ========== ZOOM (totalmente suavizado) ==========

// Zoom suave multiplicativo (estilo imagem).
// Aceita dois formatos de chamada:
//   - zoomDelta({ scale: <fator> })  -> 'scale' multiplicativo (>1=afasta, <1=aproxima)
//   - zoomDelta(delta, isPinch=false)-> delta contínuo; converte para fator internamente
export function zoomDelta(deltaOrObj = 0, isPinch = false) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ZOOM_MIN = 4, ZOOM_MAX = 400;
  const r0 = clamp(Number(State.radius) || 20, ZOOM_MIN, ZOOM_MAX);

  let factor = 1;
  if (deltaOrObj && typeof deltaOrObj === 'object' && typeof deltaOrObj.scale === 'number') {
    factor = Number(deltaOrObj.scale) || 1;
  } else {
    const delta = Number(deltaOrObj) || 0;
    if (delta === 0) return;
    const k = isPinch ? 0.35 : 0.25;
    factor = Math.exp(delta * k);
  }

  factor = clamp(factor, 0.5, 2.0);

  const target = clamp(r0 * factor, ZOOM_MIN, ZOOM_MAX);

  if (Math.abs(target - r0) < 0.01) {
    State.radius = target;
    applyOrbitToCamera();
    render();
    return;
  }

  if (_zoomAnim) { cancelAnimationFrame(_zoomAnim); _zoomAnim = null; }

  const dur = isPinch ? 60 : 120; // um pouco mais longo para suavidade
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
