// ============================
// HUD (controles) — FVS / NC / Opacidade / Explode / 2D / Reset
// ============================

import { State, savePrefs, loadPrefs, getQS, setQS } from './state.js';
import { setFaceOpacity, applyExplode, recolorMeshes3D, apply2DVisual, getMaxLevelIndex, showOnlyFloor, showAllFloors, applyFloorLimit, getMaxLevel } from './geometry.js';
import {
  render2DCards, recolorCards2D, show2D, hide2D,
  setGridZoom, getNextGridZoomSymbol, zoom2DStep, getNextGridZoomSymbolFrom
} from './overlay2d.js';
import { buildColorMapForFVS, buildColorMapForFVS_NC } from './colors.js';
import { syncSelectedColor } from './picking.js';
import { recenterCamera, INITIAL_THETA, INITIAL_PHI, resetRotation, render } from './scene.js';
import { normFVSKey } from './utils.js';
import { apartamentos } from './data.js';
import { setRowsResolver as setRowsResolver2D } from './overlay2d.js';
import { setRowResolver  as setRowResolver3D } from './picking.js';
import { clear3DHighlight } from './picking.js'; // topo do arquivo

// ---- elementos
let hudEl, rowSliders, fvsSelect, btnNC, opacityRange, explodeXYRange, explodeYRange, btn2D, btnZoom2D, btnResetAll, floorLimitRange, floorLimitGroup, floorLimitValue;

// ============================
// Índice FVS -> rows / lookup por nome
// ============================
function buildFVSIndex(rows){
  const byFVS = new Map();
  for (const r of (rows || [])){
    const label = String(r?.fvs || '').trim();
    if (!label) continue;
    const key = normFVSKey(label);
    if (!key) continue;

    let bucket = byFVS.get(key);
    if (!bucket){
      bucket = { label, rows: [], rowsByNameKey: new Map(), counts:{ total:0, withNC:0 } };
      byFVS.set(key, bucket);
    }
    bucket.rows.push(r);
    bucket.counts.total++;

    const nc = Number(r?.qtd_nao_conformidades_ultima_inspecao ?? r?.nao_conformidades ?? 0) || 0;
    if (nc > 0) bucket.counts.withNC++;

    // 🔄 CHAVE PASSA A SER 'local_origem' (antes: 'apartamento')
    const kName = String(r?.local_origem ?? '').trim();
    if (kName && !bucket.rowsByNameKey.has(kName)) bucket.rowsByNameKey.set(kName, r);
  }
  return byFVS;
}

// === Compat: applyFVSAndRefresh (chamada pelo viewer.js) ===
export function applyFVSAndRefresh(){
  const fvsIndex = buildFVSIndex(apartamentos || []);

  let key = State.CURRENT_FVS_KEY || '';
  if (!key && State.CURRENT_FVS_LABEL) key = normFVSKey(State.CURRENT_FVS_LABEL);
  if (!key || !fvsIndex.has(key)) key = fvsIndex.keys().next().value || '';

  if (fvsSelect) {
    populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/!!State.NC_MODE);
    if (key && fvsIndex.has(key)) fvsSelect.value = key;
  }

  if (key) applyFVSSelection(key, fvsIndex);

  render2DCards();
  render();
}

function populateFVSSelect(selectEl, fvsIndex, showNCOnly=false){
  selectEl.innerHTML = '';
  const keys = Array.from(fvsIndex.keys()).sort((a,b)=>{
    const la = fvsIndex.get(a)?.label || a;
    const lb = fvsIndex.get(b)?.label || b;
    return la.localeCompare(lb, 'pt-BR');
  });

  for (const k of keys){
    const b = fvsIndex.get(k);
    const c = b?.counts || { total:0, withNC:0 };
    if (showNCOnly && (c.withNC || 0) === 0) continue;

    const label = showNCOnly
      ? `${b.label} (NC:${c.withNC||0})`
      : `${b.label} (${c.total||0})`;

    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
}

function applyFVSSelection(fvsKey, fvsIndex){
  const bucket = fvsIndex.get(fvsKey);
  const rows   = bucket?.rows || [];

  State.CURRENT_FVS_KEY   = fvsKey;
  State.CURRENT_FVS_LABEL = bucket?.label || '';

  setRowsResolver2D(() => rows);

  // ⚙️ Resolver 3D agora por 'local_origem'
  const byName = bucket?.rowsByNameKey || new Map();
  setRowResolver3D((raw)=> byName.get(String(raw).trim()) || null);

  State.COLOR_MAP = State.NC_MODE
    ? buildColorMapForFVS_NC(rows)
    : buildColorMapForFVS(rows);

  recolorMeshes3D();
  recolorCards2D();
  syncSelectedColor();
  render();
}

// ============================
// Inicialização pública
// ============================
export function initHUD(){
  hudEl        = document.getElementById('hud');
  fvsSelect    = document.getElementById('fvsSelect');
  btnNC        = document.getElementById('btnNC');
  btn2D        = document.getElementById('btn2D');
  btnZoom2D    = document.getElementById('btnZoom2D');
  btnResetAll  = document.getElementById('btnResetAll');

  rowSliders       = document.getElementById('row-sliders');
  opacityRange     = document.getElementById('opacity');
  explodeXYRange   = document.getElementById('explodeXY');
  explodeYRange    = document.getElementById('explodeY');

  // --- Slider de pavimento (modo solo) ---
  floorLimitRange  = document.getElementById('floorLimit');
  floorLimitValue  = document.getElementById('floorLimitValue');
  floorLimitGroup  = document.getElementById('floorLimitGroup')
                        || floorLimitRange?.closest('.control')
                        || floorLimitRange?.parentElement;

  if (!hudEl) return;

  // Prefs + QS iniciais
  const prefs = loadPrefs();
  const qsFvs = getQS('fvs');
  const qsNc  = getQS('nc');
  State.NC_MODE = (qsNc != null) ? (qsNc === '1' || qsNc === 'true') : !!prefs.nc;

  // estados visuais iniciais
  btnNC?.setAttribute('aria-pressed', String(!!State.NC_MODE));
  btnNC?.classList.toggle('active', !!State.NC_MODE);

  // sliders compactos (cabem melhor no mobile)
  [opacityRange, explodeXYRange, explodeYRange].forEach(inp=>{
    if (!inp) return;
    inp.classList.add('slim');
    inp.style.maxWidth = '140px';
  });

  // carrega valores atuais
  if (explodeXYRange) explodeXYRange.value = String(State.explodeXY ?? 0);
  if (explodeYRange)  explodeYRange.value  = String(State.explodeY  ?? 0);
  if (opacityRange)   opacityRange.value   = String(Math.round((State.faceOpacity ?? 1) * 100));

  const is2D = (State.flatten2D >= 0.95);
  btn2D?.setAttribute('aria-pressed', String(is2D));
  btn2D?.classList.toggle('active', is2D);
  if (rowSliders)      rowSliders.style.display      = is2D ? 'none' : '';
  if (floorLimitGroup) floorLimitGroup.style.display = is2D ? 'none' : '';

  // Dropdown FVS
  const fvsIndex = buildFVSIndex(apartamentos || []);
  populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/State.NC_MODE);

  // Seleção inicial
  let initialKey = '';
  const prefKey  = prefs?.fvs ? normFVSKey(prefs.fvs) : '';
  const qsKey    = qsFvs ? normFVSKey(qsFvs) : '';
  if (qsKey && fvsIndex.has(qsKey)) initialKey = qsKey;
  else if (prefKey && fvsIndex.has(prefKey)) initialKey = prefKey;
  else initialKey = fvsIndex.keys().next().value || '';

  if (initialKey){
    fvsSelect.value = initialKey;
    applyFVSSelection(initialKey, fvsIndex);
  }

  // ---- Pavimento (modo solo) - configurações iniciais ----
  const maxLvl = getMaxLevel();
  if (floorLimitRange){
    floorLimitRange.min  = '0';
    floorLimitRange.max  = String(maxLvl);
    floorLimitRange.step = '1';

    // Começa mostrando TODOS os pavimentos (modo solo desativado)
    showAllFloors();
    if (!floorLimitRange.value) floorLimitRange.value = '0';
    if (floorLimitValue) floorLimitValue.textContent = '—';

    floorLimitRange.addEventListener('input', ()=>{
      const lv = Number(floorLimitRange.value) || 0;
      showOnlyFloor(lv);
      if (floorLimitValue) floorLimitValue.textContent = `${lv}`;
      render();
    });
  }

  // Zoom 2D: ícone mostra o PRÓXIMO passo (+ ou −)
  if (btnZoom2D){
    btnZoom2D.textContent = '🔍' + getNextGridZoomSymbol();
    btnZoom2D.style.display = is2D ? 'inline-flex' : 'none';
  }

  // Listeners padrão
  wireEvents(fvsIndex);

  // Observer para mudanças no HUD (recalcula cards 2D)
  setupHudResizeObserver();

  // === Handle (grabber) para expandir/recolher o HUD ===
  const hudHandle = document.getElementById('hudHandle');
  if (hudHandle && hudEl) {
    hudHandle.setAttribute('role', 'button');
    hudHandle.setAttribute('tabindex', '0');
    hudHandle.setAttribute('aria-label', 'Mostrar ou ocultar controles');
    hudHandle.style.cursor = 'pointer';

    const syncExpanded = () => {
      const collapsed = hudEl.classList.contains('collapsed');
      hudHandle.setAttribute('aria-expanded', String(!collapsed));
    };

    const toggleHud = () => {
      hudEl.classList.toggle('collapsed');
      syncExpanded();
    };

    hudHandle.addEventListener('click', toggleHud, { passive: true });
    hudHandle.addEventListener('keydown', (e)=>{
      if (e.key==='Enter' || e.key===' '){
        e.preventDefault();
        toggleHud();
      }
    }, { passive:false });

    syncExpanded();
  }
}

// ============================
// Eventos do HUD
// ============================
function wireEvents(fvsIndex){
  // FVS change
  fvsSelect?.addEventListener('change', ()=>{
    const key = normFVSKey(fvsSelect.value);
    setQS({ fvs: key || null });
    const prefs = loadPrefs() || {};
    prefs.fvs = key;
    savePrefs(prefs);

    applyFVSSelection(key, fvsIndex);
    render2DCards();
    render();
  });

  // Corte por pavimento (granular, step=1)
  floorLimitRange?.addEventListener('input', ()=>{
    const lv = Number(floorLimitRange.value) || 0;
    showOnlyFloor(lv);
    render(); // garantir redraw
  });

  // NC toggle
  btnNC?.addEventListener('click', ()=>{
    State.NC_MODE = !State.NC_MODE;
    const on = !!State.NC_MODE;
    btnNC.setAttribute('aria-pressed', String(on));
    btnNC.classList.toggle('active', on);
    setQS({ nc: on ? '1' : null });
    const prefs = loadPrefs() || {};
    prefs.nc = on;
    savePrefs(prefs);

    populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/on);

    if (State.CURRENT_FVS_KEY && fvsIndex.has(State.CURRENT_FVS_KEY)){
      if (![...fvsSelect.options].some(o=>o.value===State.CURRENT_FVS_KEY)){
        State.CURRENT_FVS_KEY = fvsSelect.options[0]?.value || '';
      }
      if (State.CURRENT_FVS_KEY){
        fvsSelect.value = State.CURRENT_FVS_KEY;
        applyFVSSelection(State.CURRENT_FVS_KEY, fvsIndex);
      }
    }else if (fvsSelect.options.length){
      State.CURRENT_FVS_KEY = fvsSelect.options[0].value;
      fvsSelect.value = State.CURRENT_FVS_KEY;
      applyFVSSelection(State.CURRENT_FVS_KEY, fvsIndex);
    }

    render2DCards();
    render();
  });

  // Opacidade
  opacityRange?.addEventListener('input', ()=>{
    const v = Math.max(0, Math.min(100, Number(opacityRange.value)||0)) / 100;
    State.faceOpacity = v;
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

  // Reset geral (volta tudo ao padrão)
  btnResetAll?.addEventListener('click', ()=>{
    // explode → 0
    State.explodeXY = 0;
    State.explodeY  = 0;
    if (explodeXYRange) explodeXYRange.value = '0';
    if (explodeYRange)  explodeYRange.value  = '0';

    // pavimentos → todos
    const maxLvl2 = getMaxLevelIndex();
    State.floorLimit = maxLvl2;
    if (floorLimitRange) floorLimitRange.value = String(maxLvl2);
    if (floorLimitValue) floorLimitValue.textContent = '—all—';
    applyFloorLimit(maxLvl2);

    applyExplode();

    // sair do 2D
    State.flatten2D = 0;
    btn2D?.setAttribute('aria-pressed','false');
    btn2D?.classList.remove('active');
    hide2D();
    if (btnZoom2D){
      btnZoom2D.style.display = 'none';
      btnZoom2D.textContent = '🔍' + getNextGridZoomSymbolFrom(1);
    }
    if (rowSliders) rowSliders.style.display = '';

    // opacidade 100%
    State.faceOpacity = 1;
    if (opacityRange) opacityRange.value = '100';
    setFaceOpacity(1, true);

    // recentra + reseta rotação (assinatura correta)
    recenterCamera({ theta: INITIAL_THETA, phi: INITIAL_PHI, animate: false, margin: 1.18 });

    // recolore e redesenha
    recolorMeshes3D();
    render2DCards();
    render();

  });

  // Toggle 2D
  btn2D?.addEventListener('click', ()=>{
    const turningOn = !(State.flatten2D >= 0.95);

    State.flatten2D = turningOn ? 1 : 0;
    btn2D.setAttribute('aria-pressed', turningOn ? 'true' : 'false');
    btn2D.classList.toggle('active', turningOn);

    if (turningOn){
      // 🔹 LIMPA destaque 3D antes de entrar no 2D
      if (floorLimitRange) floorLimitRange.style.display = 'none';
      if (floorLimitValue) floorLimitValue.style.display = 'none';
      clear3DHighlight();

      apply2DVisual(true);
      show2D();

      // esconde a linha dos sliders no 2D
      if (rowSliders) rowSliders.style.display = 'none';

      // zoom 2D começa em 1×; ícone passa a mostrar o próximo (que é "−" para 0.75)
      if (btnZoom2D){
        btnZoom2D.style.display = 'inline-flex';
        setGridZoom(1);
        const sym = getNextGridZoomSymbolFrom(1);
        btnZoom2D.textContent = (sym === '+') ? '🔍+' : '🔍−';
      }

      render2DCards();
    }else{
      if (floorLimitRange) floorLimitRange.style.display = '';
      if (floorLimitValue) floorLimitValue.style.display = '';
      apply2DVisual(false);
      hide2D();

      // volta a 2ª linha
      if (rowSliders) rowSliders.style.display = '';

      if (btnZoom2D) btnZoom2D.style.display = 'none';
    }
    render();
  });

  // Botão de Zoom 2D
  btnZoom2D?.addEventListener('click', ()=>{
    const reached = zoom2DStep();                 // degrau exato do overlay
    const sym = getNextGridZoomSymbolFrom(reached);
    btnZoom2D.textContent = (sym === '+') ? '🔍+' : '🔍−';
  });
}

// ============================
// Observador de tamanho do HUD
// ============================
function setupHudResizeObserver(){
  if (!hudEl) return;
  if ('ResizeObserver' in window){
    const ro = new ResizeObserver(()=>{
      if (State.flatten2D >= 0.95){
        render2DCards();
      }
    });
    ro.observe(hudEl);
  }
}
