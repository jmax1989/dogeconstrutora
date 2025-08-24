// ============================
// Picking (raycast), Hover (tooltip) e Seleção
// ============================

import { State } from './state.js';
import { showTip, hideTip, normAptoId } from './utils.js';
import { pickFVSColor } from './colors.js';
import { camera, renderer } from './scene.js';
import { getPickTargets, stepX, stepZ } from './geometry.js';
import { openAptModal } from './modal.js';

let raycaster = null;
let mouse = null;

// Função injetável para recuperar a "row" do apartamentos.json pela FVS ativa.
let getRowForApt = null;

/**
 * Permite injetar um resolvedor de dados:
 *   fn(aptoIdNormalizado) => row | null
 */
export function setRowResolver(fn){
  getRowForApt = (typeof fn === 'function') ? fn : null;
}

/** Inicializa o picking (registra listeners uma única vez). */
export function initPicking(){
  if (!renderer) throw new Error('[picking] renderer não inicializado');
  if (raycaster) return; // evita duplicar

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  const dom = renderer.domElement;

  // Click / tap -> seleção
  dom.addEventListener('click', onPointerClick, { passive: true });

  // Hover (tooltip)
  dom.addEventListener('pointermove', onPointerMove, { passive: true });
  dom.addEventListener('pointerleave', ()=> hideTip(0), { passive: true });
}

// ============================
// Handlers
// ============================

function onPointerClick(e){
  if (State.flatten2D >= 0.95) { hideTip(0); return; }
  const g = pickAtClientXY(e.clientX, e.clientY);
  if (!g) { hideTip(0); return; }

  selectGroup(g);

  // Coleta dados para o modal
  const nome   = String(g.userData?.nome || '').trim();
  const pav    = String(g.userData?.pavimento_origem ?? '');
  const hex    = pickFVSColor(nome, pav, State.COLOR_MAP);
  const aptKey = normAptoId(nome);
  const row    = getRowForApt ? (getRowForApt(aptKey) || null) : null;

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

  const nome = String(g.userData?.nome || '').trim();
  showTip(e.clientX, e.clientY, nome || 'apt');
}

// ============================
// Núcleo de Raycast
// ============================

/**
 * Faz o raycast no ponto do cliente.
 * Retorna o Group do apartamento (ou null).
 */
export function pickAtClientXY(clientX, clientY, forHover=false){
  const targets = getPickTargets();
  const faces = targets.faces || [];
  const edges = targets.edges || [];
  if (!faces.length && !edges.length) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // 1) Tenta nas faces (mais preciso)
  let inter = faces.length ? raycaster.intersectObjects(faces, false) : [];

  // 2) Se não achou, tenta edges com threshold
  if (!inter.length && edges.length){
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = Math.max(stepX, stepZ) * 0.06;
    inter = raycaster.intersectObjects(edges, false);
  }

  if (!inter.length) return null;

  // O mesh/edges estão dentro de um Group g (apartamento)
  const obj = inter[0].object;
  const g = obj.parent;
  if (!g || !g.userData) return null;
  return g;
}

// ============================
// Seleção e destaque
// ============================

/**
 * Destaca visualmente o grupo selecionado e limpa o anterior.
 */
export function selectGroup(g){
  if (!g) return;

  // limpa anterior
  if (State.__SEL_GROUP__ && State.__SEL_GROUP__ !== g){
    restoreHighlight(State.__SEL_GROUP__);
  }

  // aplica highlight no atual
  applyHighlight(g);
  State.__SEL_GROUP__ = g;
}

/** Reaplica a cor do selecionado quando o COLOR_MAP muda (ex: troca FVS/NC). */
export function syncSelectedColor(){
  const g = State.__SEL_GROUP__;
  if (!g) return;
  const nome = String(g.userData?.nome || '').trim();
  const pav  = String(g.userData?.pavimento_origem ?? '');
  const hex  = pickFVSColor(nome, pav, State.COLOR_MAP);
  const m = g.userData?.mesh?.material;
  if (m && hex){
    m.color.set(hex);
    m.needsUpdate = true;
  }
  // mantém edges destacados
  highlightEdges(g, true);
}

function applyHighlight(g){
  // 1) cor do mesh: mantém a atual (já baseada na FVS)
  // 2) destacar as edges (cor mais clara e opacidade maior)
  highlightEdges(g, true);
}

function restoreHighlight(g){
  highlightEdges(g, false);
}

function highlightEdges(g, on){
  const line = g.userData?.edges;
  if (!line || !line.material) return;
  const mat = line.material;

  if (on){
    // Destaque
    mat.color.set(0xffffff);
    mat.opacity = 1.0;
  }else{
    // Volta ao padrão do tema (mesma usada na criação)
    mat.color.set(0x2a2f3a);
    mat.opacity = 1.0;
  }
  mat.needsUpdate = true;
}
