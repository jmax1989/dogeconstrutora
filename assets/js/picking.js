// ============================
// Picking (raycast), Hover (tooltip) e Seleção
// Regra TRAVADA: usamos SEMPRE userData.nome (string exata) para buscar os dados.
// NADA de normalização. O setRowResolver(fn) deve receber/retornar por chave exata.
// ============================

import { State } from './state.js';
import { showTip, hideTip } from './utils.js'; // <- sem normNameKey aqui
import { pickFVSColor } from './colors.js';
import { camera, renderer } from './scene.js';
import { getPickTargets, stepX, stepZ } from './geometry.js';
import { openAptModal } from './modal.js';

let raycaster = null;
let mouse = null;

// Resolver injetável: recebe o **nome exato** (ex.: "301") -> row | null
// IMPORTANTE: em quem injeta (hud.js), construa o mapa por "nome"/"apartamento" EXATO.
let getRowForApt = null;
export function setRowResolver(fn){
  getRowForApt = (typeof fn === 'function') ? fn : null;
}

// ---------- helpers ----------
function isNCRow(row){
  const nc = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0;
  return nc > 0;
}

// Logger de depuração (liga/desliga com window.__PICK_DEBUG = true/false)
function debugLogPick(hit){
  try{
    if (!window.__PICK_DEBUG) return;
    if (!hit) return;
    const o = hit.object;
    const g = o?.parent;

    // caminho hierárquico até a raiz
    const path = [];
    let p = o;
    while (p) { path.push(p.name || p.type); p = p.parent; }
    const pathStr = path.reverse().join(' ▸ ');

    const nomeUD = String(g?.userData?.nome ?? '').trim();
    const pavUD  = String(g?.userData?.pavimento_origem ?? g?.userData?.levelIndex ?? '').trim();

    console.groupCollapsed('%c[PICK 3D]', 'background:#eef;padding:2px 6px;border-radius:6px;color:#123');
    console.log('Objeto clicado (mesh):', o);
    console.log('Grupo do apto (parent):', g);
    console.table({
      mesh_uuid: o?.uuid,
      mesh_name: o?.name || '(sem name)',
      group_name: g?.name || '(sem name)',
      apto_nome_usado: nomeUD || '(vazio)',
      pavimento_userData: pavUD || '(vazio)',
      instanceId: ('instanceId' in hit) ? hit.instanceId : null,
      faceIndex: ('faceIndex' in hit) ? hit.faceIndex : null
    });
    console.log('userData do GRUPO:', { ...g?.userData });
    console.log('hierarquia:', pathStr);
    console.groupEnd();
  }catch(_){}
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

  const pick = pickAtClientXY(e.clientX, e.clientY);
  if (!pick) { hideTip(0); return; }

  // O grupo retornado tem os dados “oficiais” do apto em userData
  const g = pick.g;
  const hit = pick.hit;

  debugLogPick(hit);

  // REGRAS TRAVADAS: usar SEMPRE userData.nome (string exata)
  const nome = String(g.userData?.nome ?? '').trim();
  const pav  = String(g.userData?.pavimento_origem ?? g.userData?.levelIndex ?? '').trim();

  if (!nome){
    console.warn('[picking] userData.nome ausente no grupo clicado; abortando.');
    hideTip(0);
    return;
  }

  const row  = getRowForApt ? (getRowForApt(nome) || null) : null;

  // NC MODE: só pode clicar se tiver NC>0
  if (State.NC_MODE && !isNCRow(row)) {
    hideTip(0);
    return;
  }

  const hex  = pickFVSColor(nome, pav, State.COLOR_MAP);

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

  const pick = pickAtClientXY(e.clientX, e.clientY, /*forHover=*/true);
  if (!pick) { hideTip(60); return; }

  const g = pick.g;
  const nome = String(g.userData?.nome ?? '').trim();

  if (!nome){ hideTip(60); return; }

  // Em NC, não exibir tooltip para itens sem NC
  if (State.NC_MODE){
    const row = getRowForApt ? (getRowForApt(nome) || null) : null;
    if (!isNCRow(row)) { hideTip(60); return; }
  }

  showTip(e.clientX, e.clientY, nome);
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

  const hit = inter[0];
  const obj = hit.object;
  const g = obj.parent;
  if (!g || !g.userData) return null;

  // Sanidade: exigimos userData.nome (regra travada)
  if (!('nome' in g.userData)) return null;

  return { g, hit };
}

// ========== seleção (sem brilho branco) ==========
export function selectGroup(g){
  if (!g) return;
  State.__SEL_GROUP__ = g;
}

export function syncSelectedColor(){
  const g = State.__SEL_GROUP__;
  if (!g) return;
  const nome = String(g.userData?.nome ?? '').trim();
  const pav  = String(g.userData?.pavimento_origem ?? g.userData?.levelIndex ?? '').trim();
  const hex  = pickFVSColor(nome, pav, State.COLOR_MAP);
  const m = g.userData?.mesh?.material;
  if (m && hex){
    m.color.set(hex);
    m.needsUpdate = true;
  }
}
