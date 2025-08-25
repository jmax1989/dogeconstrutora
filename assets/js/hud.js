// ============================
// HUD (controles) — FVS / NC / Opacidade / Explode / 2D / Reset / Câmera
// ============================

import { State, savePrefs, loadPrefs, getQS, setQS } from './state.js';
import { setFaceOpacity, applyExplode, recolorMeshes3D, apply2DVisual } from './geometry.js';
import { render2DCards, recolorCards2D, show2D, hide2D } from './overlay2d.js';
import { buildColorMapForFVS, buildColorMapForFVS_NC } from './colors.js';
import { syncSelectedColor } from './picking.js';
import { recenterCamera, resetRotation, render } from './scene.js';
import { normFVSKey, normNameKey } from './utils.js';
import { apartamentos } from './data.js';
import { setRowsResolver as setRowsResolver2D } from './overlay2d.js';
import { setRowResolver  as setRowResolver3D } from './picking.js';

// ---- elementos
let hudEl, fvsSelect, btnNC, opacityRange, explodeXYRange, explodeYRange, resetExplodeBtn, btn2D, btnRecenter, btnResetRot;
let collapseBtn;

// ============================
// Índice FVS -> rows / lookup por nome (NC estrita = apenas NC>0)
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

    const nome = String(r?.nome ?? r?.apartamento ?? r?.apto ?? '').trim();
    const nk = normNameKey(nome);
    if (nk && !bucket.rowsByNameKey.has(nk)) bucket.rowsByNameKey.set(nk, r);
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
  const byName = bucket?.rowsByNameKey || new Map();
  setRowResolver3D((nameKey)=> byName.get(nameKey) || null);

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

  if (!hudEl) return;

  // --- cria layout em 3 linhas + handle/colapse (idempotente) ---
  ensureHudLayout();

  // Prefs + QS iniciais
  const prefs = loadPrefs();
  const qsFvs = getQS('fvs');
  const qsNc  = getQS('nc');
  State.NC_MODE = (qsNc != null) ? (qsNc === '1' || qsNc === 'true') : !!prefs.nc;

  // estados visuais iniciais
  btnNC?.setAttribute('aria-pressed', String(!!State.NC_MODE));
  btnNC?.classList.toggle('active', !!State.NC_MODE);

  if (explodeXYRange) explodeXYRange.value = String(State.explodeXY ?? 0);
  if (explodeYRange)  explodeYRange.value  = String(State.explodeY  ?? 0);

  const is2D = (State.flatten2D >= 0.95);
  btn2D?.setAttribute('aria-pressed', String(is2D));
  btn2D?.classList.toggle('active', is2D);

  // Índice FVS
  const fvsIndex = buildFVSIndex(apartamentos || []);

  // Dropdown FVS (respeita NC on/off)
  populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/State.NC_MODE);

  // Seleção inicial (QS/prefs -> key)
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

  // Listeners
  wireEvents(fvsIndex);

  // Observer para mudanças no HUD (recalcula cards 2D)
  setupHudResizeObserver();
}

// cria 3 linhas de layout + botão de colapsar
function ensureHudLayout(){
  // handle + toggle
  let handle = hudEl.querySelector('.hud-handle');
  if (!handle){
    handle = document.createElement('div');
    handle.className = 'hud-handle';
    handle.innerHTML = `
      <button id="hudToggle" class="btn sm" aria-expanded="true" title="Recolher HUD">▾</button>
    `;
    hudEl.prepend(handle);
  }
  collapseBtn = handle.querySelector('#hudToggle');
  // --- Toggle HUD pelo "grabber" (barrinha) ---
  const hudHandle = document.getElementById('hudHandle');
  if (hudHandle && hudEl) {
    // acessibilidade + UX
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
    hudHandle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleHud();
      }
    }, { passive: false });

    // estado inicial
    syncExpanded();
  }

  // linhas
  let row1 = hudEl.querySelector('.hud-row-1');
  let row2 = hudEl.querySelector('.hud-row-2');
  let row3 = hudEl.querySelector('.hud-row-3');

  if (!row1){ row1 = document.createElement('div'); row1.className = 'row hud-row-1'; hudEl.appendChild(row1); }
  if (!row2){ row2 = document.createElement('div'); row2.className = 'row hud-row-2'; hudEl.appendChild(row2); }
  if (!row3){ row3 = document.createElement('div'); row3.className = 'row hud-row-3 nowrap'; hudEl.appendChild(row3); }
  else { row3.classList.add('nowrap'); }

    // --- PURGA de contêineres antigos que ficaram vazios (roubam espaço) ---
  const leftovers = [
    'row-sliders-opacity',
    'row-camera',
    'row-fvs',
    'row-sliders-explodexy',
    'row-sliders-explodey'
  ];

  leftovers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    // Se ainda houver algum filho útil, puxamos para dentro do HUD e removemos o wrapper.
    // (em geral já movemos tudo com "put", mas por segurança:)
    while (el.firstElementChild) {
      hudEl.appendChild(el.firstElementChild);
    }

    // Remove nós de texto em branco para não “sobrar” nada
    Array.from(el.childNodes).forEach(n => {
      if (n.nodeType === 3 && !/\S/.test(n.nodeValue || '')) n.remove();
    });

    // Se ficar vazio (esperado), some com ele
    if (!el.firstElementChild) {
      el.remove();
    }
  });

  // util
  const put = (el, row) => { if (el && row && el.parentElement !== row) row.appendChild(el); };

  // ===== 1ª linha: label da FVS + dropdown + NC =====
  const lblFvs = hudEl.querySelector('label[for="fvsSelect"]');
  put(lblFvs,                 row1);
  put(document.getElementById('fvsSelect'), row1);
  put(document.getElementById('btnNC'),     row1);

  // ===== 2ª linha: recentrar + resetRot + Reset Explode + 2D =====
  put(document.getElementById('recenter'),     row2);
  put(document.getElementById('resetRot'),     row2);
  put(document.getElementById('resetExplode'), row2);
  put(document.getElementById('btn2D'),        row2);

  // ===== 3ª linha: sliders com seus labels (emoji + slider lado a lado) =====
  const op = document.getElementById('opacity');
  const ex = document.getElementById('explodeXY');
  const ey = document.getElementById('explodeY');

  const lblOp = hudEl.querySelector('label[for="opacity"]');
  const lblEx = hudEl.querySelector('label[for="explodeXY"]');
  const lblEy = hudEl.querySelector('label[for="explodeY"]');

  [op, ex, ey].forEach(r => r && r.classList.add('slim'));

  // ordem: (emoji -> slider), repetido para cada controle
  put(lblOp, row3); put(op, row3);
  put(lblEx, row3); put(ex, row3);
  put(lblEy, row3); put(ey, row3);

  // (opcional) remover a palavra "Controles" e algum botão antigo "HUD", se existirem
  hudEl.querySelector('.handle .title')?.remove();
  document.getElementById('hudToggle')?.remove();

}

// ============================
// Eventos do HUD
// ============================
function wireEvents(fvsIndex){
  // collapse
  collapseBtn?.addEventListener('click', ()=>{
    const collapsed = hudEl.classList.toggle('collapsed');
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.textContent = collapsed ? '▸' : '▾';
  });

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

  // Reset Explode + sai do 2D + opacidade 100%
  resetExplodeBtn?.addEventListener('click', ()=>{
    State.explodeXY = 0;
    State.explodeY  = 0;
    if (explodeXYRange) explodeXYRange.value = '0';
    if (explodeYRange)  explodeYRange.value  = '0';
    applyExplode();

    // Sai do 2D
    State.flatten2D = 0;
    const btn2D = document.getElementById('btn2D');
    btn2D?.setAttribute('aria-pressed','false');
    btn2D?.classList.remove('active');
    hide2D();
    apply2DVisual(false);

    // Opacidade 100%
    State.faceOpacity = 1;
    const opacityRangeEl = document.getElementById('opacity');
    if (opacityRangeEl) opacityRangeEl.value = '100';
    setFaceOpacity(1, true);

    render2DCards();
    render();
  });

  // Toggle 2D
  document.getElementById('btn2D')?.addEventListener('click', ()=>{
    const turningOn = !(State.flatten2D >= 0.95);

    State.flatten2D = turningOn ? 1 : 0;
    const btn2D = document.getElementById('btn2D');
    btn2D.setAttribute('aria-pressed', turningOn ? 'true' : 'false');
    btn2D.classList.toggle('active', turningOn);

    if (turningOn){
      apply2DVisual(true);
      show2D();
      render2DCards();
    }else{
      apply2DVisual(false);
      hide2D();
    }
    render();
  });

  // Câmera
  document.getElementById('recenter')?.addEventListener('click', ()=>{
    recenterCamera(null, 28);
    render();
  });
  document.getElementById('resetRot')?.addEventListener('click', ()=>{
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
      if (State.flatten2D >= 0.95){
        render2DCards();
      }
    });
    ro.observe(hudEl);
  }
}
