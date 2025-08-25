// ============================
// Cena 3D / Câmera / Renderer
// ============================

import { State } from './state.js';
import { clamp } from './utils.js';
export let scene, renderer, camera;

// Alvo do orbit (reutiliza State.orbitTarget)
const ORBIT_MIN_PHI = 0.05;
const ORBIT_MAX_PHI = Math.PI - 0.05;

// Sensibilidades (ajustadas p/ ficar "leve" no mobile e igual ao 2D)
const ROT_SPEED_DESKTOP = 0.012;   // antes 0.005
const ROT_SPEED_TOUCH   = 0.012;
const PAN_FACTOR        = 1.8;     // pan mais solto
const ZOOM_STEP_FACTOR  = 0.08;    // mantido

// Canvas host
function getAppEl(){
  const el = document.getElementById('app');
  if (!el) throw new Error('[scene] #app não encontrado');
  return el;
}

export function initScene(){
  // Cena + câmera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f141b);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.position.set(8, 8, 8);
  camera.up.set(0,1,0);

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
    touchAction: 'none',             // <-- impede gestures nativos
    WebkitTouchCallout: 'none',
    WebkitUserSelect: 'none',
    userSelect: 'none',
    msTouchAction: 'none'
  });
  // Defaults seguros antes de qualquer uso
if (!State.orbitTarget || typeof State.orbitTarget.x !== 'number') {
  State.orbitTarget = new THREE.Vector3(0, 0, 0);
}
if (!Number.isFinite(State.theta))  State.theta  = Math.PI * 0.25; // ~45°
if (!Number.isFinite(State.phi))    State.phi    = Math.PI * 0.35; // inclinação
if (!Number.isFinite(State.radius)) State.radius = 28;             // distância


  // Container
  const app = getAppEl();
  app.prepend(cvs); // canvas fica atrás do grid 2D

  // Redimensiona
  window.addEventListener('resize', onResize, { passive:true });
  onResize();

  // Primeira aplicação de câmera a partir do estado
  applyOrbitToCamera();

  return { scene, renderer, camera };
}

function onResize(){
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
export function applyOrbitToCamera(){
  const r = Math.max(0.1, State.radius || 20);
  const th = State.theta || 0;
  const ph = Math.max(ORBIT_MIN_PHI, Math.min(ORBIT_MAX_PHI, State.phi || 1.1));

  const target = State.orbitTarget;
  const x = target.x + r * Math.sin(ph) * Math.cos(th);
  const y = target.y + r * Math.cos(ph);
  const z = target.z + r * Math.sin(ph) * Math.sin(th);

  camera.position.set(x, y, z);
  camera.lookAt(target);
}

export function recenterCamera({ bbox=null, verticalOffsetRatio=0.12 } = {}){
  // recentra mirando a bounding box atual (ou passada)
  const bb = bbox || computeCurrentBBox();
  if (!bb) return;

  const center = bb.getCenter(new THREE.Vector3());
  const size   = bb.getSize(new THREE.Vector3());

  State.orbitTarget.copy(center);
  State.orbitTarget.y += size.y * verticalOffsetRatio;

  const diag = Math.hypot(size.x, size.z);
  State.radius = Math.max(12, diag * 1.6);

  applyOrbitToCamera();
  render();
}

export function resetRotation(){
  // mantém alvo e raio; só reseta ângulos
  State.theta = 0;
  State.phi   = Math.min(Math.max(1.1, ORBIT_MIN_PHI), ORBIT_MAX_PHI);
  applyOrbitToCamera();
  render();
}

function computeCurrentBBox(){
  // procura um grupo "Torre" na cena
  let torre = null;
  scene?.traverse(n => { if (n.name === 'Torre' && !torre) torre = n; });
  if (!torre) return null;
  const bb = new THREE.Box3().setFromObject(torre);
  if (!Number.isFinite(bb.min.x)) return null;
  return bb;
}

// ----------------------------
// Render
// ----------------------------
export function render(){
  if (renderer && scene && camera){
    renderer.render(scene, camera);
  }
}

// =====================================================
// INPUT BASE (opcional): helper p/ quem quiser usar aqui
// (A maior parte do input está no viewer.js; aqui deixo
// utilitários caso seja necessário plugar algo local.)
// =====================================================

// Aplica delta de ORBIT com sensibilidade correta
export function orbitDelta(dx, dy, isTouch=false){
  const ROT = isTouch ? ROT_SPEED_TOUCH : ROT_SPEED_DESKTOP;
  State.theta += dx * ROT;
  State.phi   -= dy * ROT;
  State.phi = Math.max(ORBIT_MIN_PHI, Math.min(ORBIT_MAX_PHI, State.phi));
  applyOrbitToCamera();
  render();
}

// Aplica delta de PAN em pixels de tela
export function panDelta(dx, dy){
  const base = (State.radius || 20) * (0.0025 * PAN_FACTOR);
  // Eixos aproximados em tela
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0,1,0);
  camera.getWorldDirection(dir);
  right.crossVectors(dir, up).normalize();
  const camUp = camera.up.clone().normalize();

  State.orbitTarget.addScaledVector(right, -dx * base);
  State.orbitTarget.addScaledVector(camUp,  dy * base);
  applyOrbitToCamera();
  render();
}

// Aplica zoom relativo (delta de wheel)
export function zoomDelta(sign){
  const step = Math.max(0.5, (State.radius || 20) * ZOOM_STEP_FACTOR);
  State.radius += sign * step;
  State.radius = Math.max(4, Math.min(400, State.radius));
  applyOrbitToCamera();
  render();
}
