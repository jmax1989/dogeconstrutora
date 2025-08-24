// ============================
// HUD (controles) — FVS / NC / Opacidade / Explode / 2D / Reset / Câmera
// ============================

import { State, savePrefs, loadPrefs, getQS, setQS } from './state.js';
import { setFaceOpacity, applyExplode, recolorMeshes3D } from './geometry.js';
import { render2DCards, recolorCards2D, show2D, hide2D } from './overlay2d.js';
import { buildColorMapForFVS, buildColorMapForFVS_NC } from './colors.js';
import { syncSelectedColor } from './picking.js';
import { recenterCamera, resetRotation, render } from './scene.js';
import { normAptoId } from './utils.js';
import { fvsList, apartamentos } from './data.js';

// ---- elementos
let hudEl, fvsSelect, btnNC, opacityRange, explodeXYRange, explodeYRange, resetExplodeBtn, btn2D, btnRecenter, btnResetRot;

// ---- inicialização pública
export function initHUD(){
  hudEl           = document.getElementById('hud');
  fvsSelect       = document.getElementById('fvsSelect');
  btnNC           = document.getElementById('btnNC');
  opacityRange    = document.getElementById('opacity');
  explodeXYRange  = document.getElementById('explodeXY');
  explodeYRange   = document.getElementById('explodeY');
  resetExplodeBtn = document.getElementById('resetExplode');
  btn2D           = document.getElementById('btn2D');
  btnRecenter     = document.getElementById('recenter');
  btnResetRot     = document.getElementById('resetRot');

  // Prefs + QS iniciais
  const prefs = loadPrefs();
  const qsFvs = getQS('fvs');
  const qsNc  = getQS('nc');
  State.NC_MODE    = (qsNc != null) ? (qsNc === '1' || qsNc === 'true') : !!prefs.nc;
  State.CURRENT_FVS= qsFvs || prefs.fvs || '';

  btnNC.setAttribute('aria-pressed', String(!!State.NC_MODE));
  if (opacityRange) opacityRange.value = String(Math.round((State.faceOpacity ?? 1) * 100));
  if (explodeXYRange) explodeXYRange.value = String(State.explodeXY ?? 0);
  if (explodeYRange)  explodeYRange.value  = String(State.explodeY  ?? 0);
  btn2D.setAttribute('aria-pressed', String(State.flatten2D >= 0.95));

  // Dropdown FVS
  rebuildFvsDropdown();

  // Listeners
  wireEvents();

  // Observer para mudanças visuais no HUD (para recalcular overlay quando expande/recolhe)
  setupHudResizeObserver();
}

// ============================
// Dropdown FVS
// ============================
export function rebuildFvsDropdown(){
  if (!fvsSelect) return;

  const current = State.CURRENT_FVS || '';
  const onlyProblems = !!State.NC_MODE;

  // Mapeia contagens (se NC: conta apenas com pend/NC)
  const counts = new Map();
  if (Array.isArray(apartamentos) && apartamentos.length){
    // agrupa por FVS (row.fvs)
    for (const row of apartamentos){
      const fvs = String(row.fvs || row.nome || '').trim();
      if (!fvs) continue;

      if (!counts.has(fvs)) counts.set(fvs, { total:0, withProblem:0 });
      const o = counts.get(fvs);
      o.total++;

      const pend = Number(row.qtd_pend_ultima_inspecao ?? 0) || 0;
      const nc   = Number(row.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;
      if (pend>0 || nc>0) o.withProblem++;
    }
  }

  // monta opções
  fvsSelect.innerHTML = '';
  const list = Array.isArray(fvsList) ? fvsList : [];
  for (const f of list){
    const value = (typeof f === 'string') ? f : (f?.nome || f?.id || '');
    if (!value) continue;

    const c = counts.get(value);
    const label = onlyProblems
      ? `${value}${c ? ` (NC:${c.withProblem||0})` : ''}`
      : `${value}${c ? ` (${c.total||0})` : ''}`;

    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    fvsSelect.appendChild(opt);
  }

  // Seleção coerente (QS/prefs ou primeira)
  if (current && [...fvsSelect.options].some(o=>o.value===current)){
    fvsSelect.value = current;
  }else if (fvsSelect.options.length){
    fvsSelect.selectedIndex = 0;
    State.CURRENT_FVS = fvsSelect.value;
  }
}

// ============================
// Regras de FVS -> COLOR_MAP
// ============================
function getRowsForCurrentFVS(){
  const fvs = State.CURRENT_FVS || '';
  if (!fvs || !Array.isArray(apartamentos)) return [];
  return apartamentos.filter(r => String(r.fvs || '').trim() === fvs);
}

function buildColorMap(){
  const rows = getRowsForCurrentFVS();
  return State.NC_MODE ? buildColorMapForFVS_NC(rows) : buildColorMapForFVS(rows);
}

export function setFVSColorMap(payload){
  if (!payload) return;
  State.COLOR_MAP = {
    default: payload.default || '#6e7681',
    colors:  payload.colors  || {},
    byFloor: payload.byFloor || {}
  };
  recolorMeshes3D();
  recolorCards2D();
  syncSelectedColor();
  render();
}

// Aplica a FVS atual (recalcula COLOR_MAP) e atualiza 2D/3D
export function applyFVSAndRefresh(){
  const cmap = buildColorMap();
  setFVSColorMap(cmap);
  render2DCards();
  render();
}

// ============================
// Eventos do HUD
// ============================
function wireEvents(){
  // FVS change
  fvsSelect?.addEventListener('change', ()=>{
    State.CURRENT_FVS = fvsSelect.value || '';
    setQS({ fvs: State.CURRENT_FVS || null }); // atualiza QS
    savePrefs();
    applyFVSAndRefresh();
  });

  // NC toggle
  btnNC?.addEventListener('click', ()=>{
    State.NC_MODE = !State.NC_MODE;
    btnNC.setAttribute('aria-pressed', String(!!State.NC_MODE));
    setQS({ nc: State.NC_MODE ? '1' : null }); // liga/desliga na QS
    savePrefs();
    rebuildFvsDropdown();
    applyFVSAndRefresh();
  });

  // Opacidade
  opacityRange?.addEventListener('input', ()=>{
    const v = Math.max(0, Math.min(100, Number(opacityRange.value)||0)) / 100;
    setFaceOpacity(v);
    render();
  });

  // Explode XY
  explodeXYRange?.addEventListener('input', ()=>{
    State.explodeXY = Number(explodeXYRange.value) || 0;
    applyExplode();
    render();
  });

  // Explode Y
  explodeYRange?.addEventListener('input', ()=>{
    State.explodeY = Number(explodeYRange.value) || 0;
    applyExplode();
    render();
  });

  // Reset Explode (completo + sai do 2D)
  resetExplodeBtn?.addEventListener('click', ()=>{
    State.explodeXY = 0;
    State.explodeY  = 0;
    if (explodeXYRange) explodeXYRange.value = '0';
    if (explodeYRange)  explodeYRange.value  = '0';
    applyExplode();

    // Sai do 2D, restaura flag
    State.flatten2D = 0;
    btn2D?.setAttribute('aria-pressed','false');
    hide2D();

    // Opacidade padrão (mantém valor atual do State)
    setFaceOpacity(State.faceOpacity ?? 1);
    render2DCards(); // limpa/reestrutura grade 2D
    render();
  });

  // Toggle 2D
  btn2D?.addEventListener('click', ()=>{
    const on = !(State.flatten2D >= 0.95);
    if (on){
      State.flatten2D = 1;
      btn2D.setAttribute('aria-pressed','true');
      show2D();
      render2DCards();
    }else{
      State.flatten2D = 0;
      btn2D.setAttribute('aria-pressed','false');
      hide2D();
    }
    render();
  });

  // Câmera
  btnRecenter?.addEventListener('click', ()=>{
    recenterCamera(null, 28);
    render();
  });
  btnResetRot?.addEventListener('click', ()=>{
    resetRotation();
    render();
  });
}

// ============================
// Observador de tamanho do HUD
// ============================
function setupHudResizeObserver(){
  if (!hudEl) return;
  if ('ResizeObserver' in window){
    const ro = new ResizeObserver(()=>{
      // sempre que HUD muda de tamanho, podemos re-renderizar os cards 2D para ajustar layout
      if (State.flatten2D >= 0.95){
        render2DCards();
      }
    });
    ro.observe(hudEl);
  }
}
