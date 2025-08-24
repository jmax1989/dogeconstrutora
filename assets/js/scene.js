// ============================
// Cena / Câmera / Renderizador (Three.js)
// ============================

import { State } from './state.js';
import { clamp } from './utils.js';

export let scene = null;
export let camera = null;
export let renderer = null;

// Alvo padrão da câmera (centro da torre)
const DEFAULT_TARGET = { x: 0, y: 0, z: 0 };

// Luzes
let ambientLight = null;
let dirLight1 = null;
let dirLight2 = null;

// ----------------------
// Inicialização
// ----------------------
export function initScene(){
  const host = document.getElementById('app');
  if (!host) throw new Error('[scene] #app não encontrado');

  // Cena
  scene = new THREE.Scene();

  // Câmera (perspectiva suave)
  const { width, height } = _getAppSize(host);
  camera = new THREE.PerspectiveCamera(55, width/height, 0.1, 2000);
  State.orbitTarget = new THREE.Vector3(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  // Luzes
  _setupLights();

  // Posição inicial da câmera (usa estado)
  applyOrbitToCamera();

  // Resize
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
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return { width: w, height: h };
}

export function onResize(host = document.getElementById('app')){
  if (!renderer || !camera || !host) return;
  const { width, height } = _getAppSize(host);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// ----------------------
// Orbit "lite" (sem OrbitControls)
// ----------------------
// Usa State.radius / State.theta / State.phi e State.orbitTarget
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
}

// Recentrar na torre/mesh principal (target + raio opcional)
export function recenterCamera(targetVec3 = null, radius = null){
  const tgt = targetVec3 || new THREE.Vector3(DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z);
  State.orbitTarget = tgt.clone();
  if (radius != null) State.radius = Math.max(0.1, radius);
  applyOrbitToCamera();
}

// Resetar rotação para ângulo isométrico padrão
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
