// ============================
// Cena / Câmera / Renderizador (Three.js)
// ============================

import { State } from './state.js';
import { clamp } from './utils.js';

export let scene = null;
export let camera = null;
export let renderer = null;

const DEFAULT_TARGET = { x: 0, y: 0, z: 0 };

// Luzes
let ambientLight = null, dirLight1 = null, dirLight2 = null;

// ===== Render invalidation (repaint sob demanda) =====
let _rafId = 0;
let _needsRender = false;
function invalidate(){
  _needsRender = true;
  if (_rafId) return;
  _rafId = requestAnimationFrame(()=>{
    _rafId = 0;
    if (_needsRender){
      _needsRender = false;
      render();
    }
  });
}

// ===== Controles =====
let isDragging = false;
let dragMode   = 'orbit'; // 'orbit' | 'pan'
let lastX = 0, lastY = 0;
let startX = 0, startY = 0;
let moved  = false;

// ----------------------
// Inicialização
// ----------------------
export function initScene(){
  const host = document.getElementById('app');
  if (!host) throw new Error('[scene] #app não encontrado');

  scene = new THREE.Scene();

  const { width, height } = _getAppSize(host);
  camera = new THREE.PerspectiveCamera(55, width/height, 0.1, 2000);

  // Estados padrão de órbita
  if (!Number.isFinite(State.radius)) State.radius = 60;
  if (!Number.isFinite(State.theta))  State.theta  = Math.PI * 0.25;
  if (!Number.isFinite(State.phi))    State.phi    = Math.PI * 0.35;
  State.orbitTarget = new THREE.Vector3(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.userSelect  = 'none';
  host.appendChild(renderer.domElement);

  _setupLights();
  applyOrbitToCamera(); // já invalida

  _attachControls();

  window.addEventListener('resize', () => onResize(host), { passive:true });
}

// ----------------------
// Luzes
// ----------------------
function _setupLights(){
  ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight1.position.set(10, 18, 14);
  scene.add(dirLight1);

  dirLight2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dirLight2.position.set(-12, 10, -8);
  scene.add(dirLight2);
}

// ----------------------
// Resize
// ----------------------
function _getAppSize(host){
  const rect = host.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

export function onResize(host = document.getElementById('app')){
  if (!renderer || !camera || !host) return;
  const { width, height } = _getAppSize(host);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  invalidate();
}

// ----------------------
// Orbit “lite”
// ----------------------
export function applyOrbitToCamera(){
  if (!camera) return;
  const r   = Math.max(0.1, State.radius);
  const th  = State.theta;
  const ph  = clamp(State.phi, 0.01, Math.PI - 0.01);
  const tgt = State.orbitTarget || new THREE.Vector3();

  const x = tgt.x + r * Math.sin(ph) * Math.cos(th);
  const y = tgt.y + r * Math.cos(ph);
  const z = tgt.z + r * Math.sin(ph) * Math.sin(th);

  camera.position.set(x, y, z);
  camera.lookAt(tgt);
  invalidate();
}

export function recenterCamera(targetVec3 = null, radius = null){
  const tgt = targetVec3 || new THREE.Vector3(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);
  State.orbitTarget = tgt.clone();
  if (radius != null) State.radius = Math.max(0.1, radius);
  applyOrbitToCamera();
}

export function resetRotation(){
  State.theta = Math.PI * 0.25;
  State.phi   = Math.PI * 0.35;
  applyOrbitToCamera();
}

// ----------------------
// Render
// ----------------------
export function render(){
  if (!renderer || !scene || !camera) return;
  renderer.render(scene, camera);
}

// ==========================================================
// Controles (mouse/touch)
// ==========================================================
function _attachControls(){
  const dom = renderer.domElement;

  dom.addEventListener('pointerdown', onPointerDown, { passive:false });
  dom.addEventListener('pointermove', onPointerMove, { passive:false });
  dom.addEventListener('pointerup',   onPointerUp,   { passive:false });
  dom.addEventListener('pointercancel', onPointerUp, { passive:false });
  dom.addEventListener('pointerleave',  onPointerUp, { passive:false });

  dom.addEventListener('wheel', (e)=>{
    const k = 0.0018;
    const rMin = Number.isFinite(State.radiusMin) ? State.radiusMin : 2;
    const rMax = Number.isFinite(State.radiusMax) ? State.radiusMax : 500;
    const scale = Math.exp(e.deltaY * k);
    State.radius = clamp(State.radius * scale, rMin, rMax);
    applyOrbitToCamera(); // já invalida
    e.preventDefault();
  }, { passive:false });

  dom.addEventListener('contextmenu', e => e.preventDefault());
}

function onPointerDown(e){
  isDragging = true;
  moved = false;
  lastX = startX = e.clientX;
  lastY = startY = e.clientY;

  const isPanButton = (e.button === 1) || (e.button === 2);
  const isPanModKey = e.shiftKey || e.ctrlKey || e.altKey;
  dragMode = (isPanButton || isPanModKey) ? 'pan' : 'orbit';

  try { renderer.domElement.setPointerCapture(e.pointerId); } catch {}
  State.__IS_DRAGGING__ = true;

  e.preventDefault();
}

function onPointerMove(e){
  if (!isDragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > Math.max(6, 4*(window.devicePixelRatio||1))){
    moved = true;
  }

  const doPan = (dragMode === 'pan') || e.shiftKey || e.ctrlKey || e.altKey;

  if (doPan){
    panByPixels(dx, dy); // já invalida
  }else{
    State.theta += dx * 0.005;
    State.phi    = clamp(State.phi - dy * 0.005, 0.01, Math.PI - 0.01);
    applyOrbitToCamera(); // já invalida
  }

  lastX = e.clientX; lastY = e.clientY;
  e.preventDefault();
}

function onPointerUp(e){
  if (!isDragging) return;

  isDragging = false;
  State.__IS_DRAGGING__ = false;

  if (moved){
    State.__BLOCK_CLICKS_UNTIL = performance.now() + 180;
  }
  moved = false;

  // garante um último repaint após soltar
  invalidate();

  e.preventDefault();
}

// ===== util pan =====
function panByPixels(dx, dy){
  const panScale = (State.radius || 50) * 0.0025;

  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const right   = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const upv     = new THREE.Vector3().copy(camera.up).normalize();

  const tgt = State.orbitTarget || new THREE.Vector3();
  tgt.addScaledVector(right, -dx * panScale);
  tgt.addScaledVector(upv,     dy * panScale);

  State.orbitTarget = tgt;
  applyOrbitToCamera(); // já invalida
}
