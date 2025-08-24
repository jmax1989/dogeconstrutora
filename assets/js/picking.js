// picking.js
import { State } from './state.js';
import { getTorre } from './geometry.js';
import { normAptoId, showTip, hideTip } from './utils.js';

/**
 * Picking/seleção:
 * - hover com throttle + tooltip
 * - tap robusto (mobile/desktop), sem clique fantasma
 * - highlight que respeita recolor (não “congela” cor)
 * - sem dependência do modal (evita ciclo): use setOnSelect(...)
 */

let raycaster;
let mouseNDC;

// callback a ser definido pelo viewer (ex.: openAptModal)
let onSelect = null;
export function setOnSelect(fn){ onSelect = (typeof fn === 'function') ? fn : null; }

// throttle do hover
let hoverThrottleTS = 0;
const HOVER_THROTTLE_MS = 40;

// detecção de tap
const TAP_MOVE_THRESH = 6;   // px
const TAP_TIME_MAX   = 600;  // ms
let tapState = { isDown:false, startX:0, startY:0, moved:false, downAt:0 };

// seleção atual
let selectedGroup = null;

// backups por grupo (para restaurar highlight sem travar cor/estado)
const faceBackupMap = new WeakMap(); // group -> material face (clone)
const lineBackupMap = new WeakMap(); // group -> material linha

// materiais de seleção (só contorno)
const SEL_LINE = new THREE.LineBasicMaterial({ color: 0xffc107, linewidth: 2 });
const OPACITY_BUMP = 0.18; // +18% de opacidade da face

// resolver injetado pelo viewer.js (aptKeyNorm -> row)
let rowResolver = () => null;
export function setRowResolver(fn){ if (typeof fn === 'function') rowResolver = fn; }

// ============================
// Init
// ============================
export function initPicking(){
  raycaster = new THREE.Raycaster();
  mouseNDC  = new THREE.Vector2();

  const dom = document.querySelector('#app canvas');
  if (!dom) return;

  dom.addEventListener('contextmenu', e => e.preventDefault());

  dom.addEventListener('pointerdown',   onPointerDown,   { passive:false });
  dom.addEventListener('pointermove',   onPointerMove,   { passive:false });
  dom.addEventListener('pointerup',     onPointerUp,     { passive:false });
  dom.addEventListener('pointercancel', onPointerUp,     { passive:false });

  dom.addEventListener('wheel', () => { tapState.isDown = false; }, { passive:true });
}

// ============================
// API externa
// ============================
export function selectGroup(group){
  clearSelection();
  if (!group || !group.userData) return;

  applyHighlight(group);
  selectedGroup = group;

  const aptId = String(group.userData?.nome || group.userData?.meta?.id || '').trim();
  const floor = (typeof group.userData?.levelIndex === 'number') ? group.userData.levelIndex : null;
  const row   = resolveRowFromApto(aptId);

  if (onSelect) onSelect({ id: aptId, floor, row });
}

export function refreshSelectionVisual(){
  if (!selectedGroup) return;
  removeHighlight(selectedGroup, /*keepBackups*/ true);
  applyHighlight(selectedGroup);
}

export function clearSelection(){
  if (!selectedGroup) return;
  removeHighlight(selectedGroup);
  selectedGroup = null;
}

// ============================
// Handlers
// ============================
function onPointerDown(e){
  if (e.button === 2) return; // ignora botão direito
  tapState.isDown = true;
  tapState.startX = e.clientX;
  tapState.startY = e.clientY;
  tapState.moved  = false;
  tapState.downAt = performance.now();
}

function onPointerMove(e){
  // hover (somente quando não está 100% em 2D)
  if (State.flatten2D < 0.95){
    const now = performance.now();
    if (now - hoverThrottleTS >= HOVER_THROTTLE_MS){
      hoverThrottleTS = now;
      doHoverPick(e.clientX, e.clientY);
    }
  } else {
    hideTip(0);
  }

  // tracking do tap
  if (tapState.isDown){
    const dx = e.clientX - tapState.startX;
    const dy = e.clientY - tapState.startY;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESH) tapState.moved = true;
  }
}

function onPointerUp(e){
  if (e.button === 2) return;
  const isTap = computeIsTap(e.clientX, e.clientY);
  tapState.isDown = false;
  if (!isTap) return;
  doClickPick(e.clientX, e.clientY);
}

// ============================
// Picking helpers
// ============================
function computeIsTap(x, y){
  const dt = performance.now() - tapState.downAt;
  const dx = x - tapState.startX;
  const dy = y - tapState.startY;
  const moved = Math.hypot(dx, dy) > TAP_MOVE_THRESH;
  return !moved && dt <= TAP_TIME_MAX;
}

function clientToNDC(x, y){
  const dom = document.querySelector('#app canvas');
  const rect = dom.getBoundingClientRect();
  mouseNDC.x = ((x - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((y - rect.top) / rect.height) * 2 + 1;
}

function pickGroupAt(x, y){
  const torre = getTorre();
  if (!torre) return null;

  clientToNDC(x, y);
  raycaster.setFromCamera(mouseNDC, State.camera);

  // 1) faces
  const faceObjs = torre.children.map(g => g.userData?.mesh).filter(Boolean);
  let inter = raycaster.intersectObjects(faceObjs, false);

  // 2) fallback: edges com threshold adaptativo (mais fácil acertar)
  if (!inter.length){
    const edgeObjs = torre.children.map(g => g.userData?.edges).filter(Boolean);
    const thr = Math.max(0.5, Math.min(4, (State.radius || 20) * 0.02));
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = thr;
    inter = raycaster.intersectObjects(edgeObjs, false);
  }

  if (!inter.length) return null;
  const group = inter[0].object.parent;
  return (group && group.userData) ? group : null;
}

function doHoverPick(x, y){
  const g = pickGroupAt(x, y);
  if (!g){ hideTip(50); return; }
  const apt = String(g.userData?.nome || g.userData?.meta?.id || 'apt').trim();
  showTip(x, y, apt);
}

function doClickPick(x, y){
  const g = pickGroupAt(x, y);
  if (!g){ hideTip(0); return; }
  selectGroup(g);
}

// ============================
// Highlight helpers
// ============================
function applyHighlight(group){
  if (!group?.userData) return;

  // backups (uma vez)
  if (!lineBackupMap.has(group)) lineBackupMap.set(group, group.userData.edges?.material || null);
  if (!faceBackupMap.has(group)) faceBackupMap.set(group, group.userData.mesh?.material?.clone() || null);

  // 1) linhas → material de seleção
  if (group.userData.edges && group.userData.edges.material !== SEL_LINE){
    group.userData.edges.material = SEL_LINE;
    group.userData.edges.material.needsUpdate = true;
  }

  // 2) face → aumenta opacidade atual (sem mexer na cor!)
  const mat = group.userData.mesh?.material;
  if (mat){
    const bumped = mat.clone();
    const baseOpacity = (typeof mat.opacity === 'number') ? mat.opacity : 1;
    bumped.opacity = Math.min(1, baseOpacity + OPACITY_BUMP);
    bumped.transparent = bumped.opacity < 1;
    bumped.depthWrite  = !bumped.transparent;
    group.userData.mesh.material = bumped;
  }
}

function removeHighlight(group, keepBackups=false){
  if (!group) return;

  const lineBkp = lineBackupMap.get(group);
  if (lineBkp) group.userData.edges.material = lineBkp;

  const faceBkp = faceBackupMap.get(group);
  if (faceBkp) group.userData.mesh.material = faceBkp.clone();

  if (!keepBackups){
    lineBackupMap.delete(group);
    faceBackupMap.delete(group);
  }
}

// ============================
// Row resolver
// ============================
function resolveRowFromApto(aptoId){
  const key = normAptoId(aptoId);
  try { return rowResolver(key) || null; }
  catch { return null; }
}
