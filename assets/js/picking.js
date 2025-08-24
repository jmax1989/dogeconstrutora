// ============================
// Picking (raycast), Hover (tooltip) e Seleção
// ============================

import { State } from './state.js';
import { showTip, hideTip, normNameKey } from './utils.js';
import { pickFVSColor } from './colors.js';
import { camera, renderer } from './scene.js';
import { getPickTargets, stepX, stepZ } from './geometry.js';
import { openAptModal } from './modal.js';

let raycaster = null;
let mouse = null;

// Resolver injetável: recebe nomeKey normalizado -> row | null
let getRowForApt = null;
export function setRowResolver(fn){
  getRowForApt = (typeof fn === 'function') ? fn : null;
}

// ---------- helpers ----------
function isNCRow(row){
  const nc = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0;
  return nc > 0;
}

// =========== init ===========
export function initPicking(){
  if (!renderer) throw new Error('[picking] renderer não inicializado');
  if (raycaster) return; // já iniciado

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  const dom = renderer.domElement;

  // Hover (tooltip)
  dom.addEventListener('pointermove', onPointerMove, { passive: true });
  dom.addEventListener('pointerleave', ()=> hideTip(0), { passive: true });

  // Clique robusto (evita “ghost click” e drag)
  dom.addEventListener('pointerdown', onPointerDown, { passive: true });
  dom.addEventListener('pointerup',   onPointerUp,   { passive: true });
}

// ---------- estado de clique ----------
let downX = 0, downY = 0, downTS = 0;
let dragging = false;

const CLICK_MOVE_TOL = 6;   // px
const CLICK_TIME_MAX = 450; // ms

function onPointerDown(e){
  downX = e.clientX; downY = e.clientY; downTS = performance.now();
  dragging = false;
}

function onPointerUp(e){
  const dt = performance.now() - downTS;
  const dx = Math.abs(e.clientX - downX);
  const dy = Math.abs(e.clientY - downY);
  const moved = (dx > CLICK_MOVE_TOL || dy > CLICK_MOVE_TOL);
  if (!moved && dt <= CLICK_TIME_MAX){
    onPointerClick(e);
  }
}

// ========== handlers ==========
function onPointerClick(e){
  // Em 2D, o click abre modal pelos cards — não pelo 3D
  if (State.flatten2D >= 0.95) { hideTip(0); return; }

  const g = pickAtClientXY(e.clientX, e.clientY);
  if (!g) { hideTip(0); return; }

  const nome = String(g.userData?.nome || g.userData?.apto || g.name || '').trim();
  const pav  = String(g.userData?.pavimento_origem ?? g.userData?.levelIndex ?? '');
  const nameKey = normNameKey(nome);
  const row  = getRowForApt ? (getRowForApt(nameKey) || null) : null;

  // NC MODE: só pode clicar se tiver NC>0
  if (State.NC_MODE && !isNCRow(row)) {
    hideTip(0);
    return;
  }

  const hex  = pickFVSColor(nome, pav, State.COLOR_MAP);

  // (opcional) destacar leve sem “brilho branco”: mantemos edges como estão
  selectGroup(g);

  openAptModal({ id: nome, floor: pav, row, tintHex: hex });
}

let lastHoverTS = 0;
const HOVER_THROTTLE_MS = 40;

function onPointerMove(e){
  if (State.flatten2D >= 0.95) { hideTip(0); return; }
  const now = performance.now();
  if (now - lastHoverTS < HOVER_THROTTLE_MS) return;
  lastHoverTS = now;

  const g = pickAtClientXY(e.clientX, e.clientY, /*forHover=*/true);
  if (!g) { hideTip(60); return; }

  const nome = String(g.userData?.nome || g.userData?.apto || g.name || '').trim();

  // Em NC, não exibir tooltip para itens sem NC (coerente com “não clicável”)
  if (State.NC_MODE){
    const nameKey = normNameKey(nome);
    const row = getRowForApt ? (getRowForApt(nameKey) || null) : null;
    if (!isNCRow(row)) { hideTip(60); return; }
  }

  showTip(e.clientX, e.clientY, nome || 'apt');
}

// ========== núcleo de raycast ==========
export function pickAtClientXY(clientX, clientY, forHover=false){
  const targets = getPickTargets();
  const faces = targets.faces || [];
  const edges = targets.edges || [];
  if (!faces.length && !edges.length) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // 1) faces
  let inter = faces.length ? raycaster.intersectObjects(faces, false) : [];

  // 2) edges com threshold (fallback)
  if (!inter.length && edges.length){
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = Math.max(stepX, stepZ) * 0.06;
    inter = raycaster.intersectObjects(edges, false);
  }

  if (!inter.length) return null;

  const obj = inter[0].object;
  const g = obj.parent;
  if (!g || !g.userData) return null;
  return g;
}

// ========== seleção (sem brilho branco) ==========
export function selectGroup(g){
  if (!g) return;
  // Não alteramos cor das edges para “branco”; apenas marcamos no estado
  State.__SEL_GROUP__ = g;
}

export function syncSelectedColor(){
  const g = State.__SEL_GROUP__;
  if (!g) return;
  const nome = String(g.userData?.nome || g.userData?.apto || g.name || '').trim();
  const pav  = String(g.userData?.pavimento_origem ?? g.userData?.levelIndex ?? '');
  const hex  = pickFVSColor(nome, pav, State.COLOR_MAP);
  const m = g.userData?.mesh?.material;
  if (m && hex){
    m.color.set(hex);
    m.needsUpdate = true;
  }
}
