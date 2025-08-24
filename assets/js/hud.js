// ============================
// HUD (controles) — FVS / NC / Opacidade / Explode / 2D / Reset / Câmera
// ============================

import { State, savePrefs, loadPrefs, getQS, setQS } from './state.js';
import { setFaceOpacity, applyExplode, recolorMeshes3D, apply2DVisual, getTorre } from './geometry.js';
import { render2DCards, recolorCards2D, show2D, hide2D } from './overlay2d.js';
import { buildColorMapForFVS, buildColorMapForFVS_NC } from './colors.js';
import { syncSelectedColor } from './picking.js';
import { applyOrbitToCamera, recenterCamera, resetRotation, render } from './scene.js';
import { normFVSKey, normNameKey } from './utils.js';
import { apartamentos } from './data.js';
import { setRowsResolver as setRowsResolver2D } from './overlay2d.js';
import { setRowResolver  as setRowResolver3D } from './picking.js';

// ---- elementos
let hudEl, fvsSelect, btnNC, opacityRange, explodeXYRange, explodeYRange, resetExplodeBtn, btn2D, btnRecenter, btnResetRot;

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

    // NC reais (não considera pendências nem "em andamento")
    const nc = Number(r?.qtd_nao_conformidades_ultima_inspecao ?? r?.nao_conformidades ?? 0) || 0;
    if (nc > 0) bucket.counts.withNC++;

    // lookup por NOME (chave normalizada)
    const nome = String(r?.nome ?? r?.apartamento ?? r?.apto ?? '').trim();
    const nk = normNameKey(nome);
    if (nk && !bucket.rowsByNameKey.has(nk)) bucket.rowsByNameKey.set(nk, r);
  }
  return byFVS;
}

// === Compat: applyFVSAndRefresh (chamada pelo viewer.js) ===
export function applyFVSAndRefresh(){
  const fvsIndex = buildFVSIndex(apartamentos || []);

  // Tenta usar a KEY atual; cai para a LABEL antiga; senão pega a primeira disponível
  let key = State.CURRENT_FVS_KEY || '';
  if (!key && State.CURRENT_FVS_LABEL) key = normFVSKey(State.CURRENT_FVS_LABEL);
  if (!key || !fvsIndex.has(key)) key = fvsIndex.keys().next().value || '';

  // Garante <select> populado corretamente (respeitando NC on/off)
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

    // Em modo NC, **só** mostra FVS com pelo menos 1 NC
    if (showNCOnly && (c.withNC || 0) === 0) continue;

    const label = showNCOnly
      ? `${b.label} (NC:${c.withNC||0})`
      : `${b.label} (${c.total||0})`;

    const opt = document.createElement('option');
    opt.value = k;          // value = KEY normalizada
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
}

function applyFVSSelection(fvsKey, fvsIndex){
  const bucket = fvsIndex.get(fvsKey);
  const rows   = bucket?.rows || [];

  // Atualiza estado da FVS
  State.CURRENT_FVS_KEY   = fvsKey;
  State.CURRENT_FVS_LABEL = bucket?.label || '';

  // Injetar resolvers
  setRowsResolver2D(() => rows); // 2D usa a lista completa da FVS
  const byName = bucket?.rowsByNameKey || new Map();
  setRowResolver3D((nameKey)=> byName.get(nameKey) || null);

  // COLOR_MAP conforme modo
  State.COLOR_MAP = State.NC_MODE
    ? buildColorMapForFVS_NC(rows)      // só vermelho onde há NC; demais cinza
    : buildColorMapForFVS(rows);

  // Recolor/refresh
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

  // Prefs + QS iniciais
  const prefs = loadPrefs();
  const qsFvs = getQS('fvs'); // pode ser KEY antiga ou label
  const qsNc  = getQS('nc');
  State.NC_MODE = (qsNc != null) ? (qsNc === '1' || qsNc === 'true') : !!prefs.nc;

  // estados visuais iniciais
  btnNC.setAttribute('aria-pressed', String(!!State.NC_MODE));
  btnNC.classList.toggle('active', !!State.NC_MODE);

  if (explodeXYRange) explodeXYRange.value = String(State.explodeXY ?? 0);
  if (explodeYRange)  explodeYRange.value  = String(State.explodeY  ?? 0);

  const is2D = (State.flatten2D >= 0.95);
  btn2D.setAttribute('aria-pressed', String(is2D));
  btn2D.classList.toggle('active', is2D);

  // Índice FVS
  const fvsIndex = buildFVSIndex(apartamentos || []);

  // Dropdown FVS (respeita NC on/off)
  populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/State.NC_MODE);

  // Seleção inicial (QS/prefs -> key)
  let initialKey = '';
  const prefKey  = prefs.fvs ? normFVSKey(prefs.fvs) : '';
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

// ============================
// Eventos do HUD
// ============================
function wireEvents(fvsIndex){
  // FVS change
  fvsSelect?.addEventListener('change', ()=>{
    const key = normFVSKey(fvsSelect.value);
    setQS({ fvs: key || null });
    const prefs = loadPrefs() || {};
    prefs.fvs = key;                // salva KEY
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

    // Recarrega dropdown filtrando por FVS com NC>0 quando ON
    populateFVSSelect(fvsSelect, fvsIndex, /*showNCOnly=*/on);

    // Mantém seleção coerente
    if (State.CURRENT_FVS_KEY && fvsIndex.has(State.CURRENT_FVS_KEY)){
      // se a FVS atual sumiu no modo NC (sem NC), pega a primeira disponível
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
    State.faceOpacity = v;          // guarda no estado
    setFaceOpacity(v);              // aplica no 3D
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
  btn2D?.addEventListener('click', ()=>{
    const turningOn = !(State.flatten2D >= 0.95);

    State.flatten2D = turningOn ? 1 : 0;
    btn2D.setAttribute('aria-pressed', turningOn ? 'true' : 'false');
    btn2D.classList.toggle('active', turningOn);

    if (turningOn){
      // 3D: faces 0 e linhas discretas (sem brilho branco)
      apply2DVisual(true);
      // 2D overlay: por cima
      show2D();
      render2DCards();
    }else{
      // 3D: restaura opacidade anterior e linhas padrão + recolor
      apply2DVisual(false);
      hide2D();
    }
    render();
  });

  // Câmera
// Câmera
btnRecenter?.addEventListener('click', ()=>{
  // Se tivermos a torre carregada, recalcula o enquadramento igual ao boot
  const torre = getTorre?.();
  if (torre) {
    const bb = new THREE.Box3().setFromObject(torre);
    const c  = bb.getCenter(new THREE.Vector3());
    const s  = bb.getSize(new THREE.Vector3());

    // alvo no centro, com “desce um pouco” (12% da altura)
    State.orbitTarget.copy(c);
    State.orbitTarget.y += s.y * 0.12;

    // raio para caber no viewport (mesma heurística do boot)
    const diag = Math.hypot(s.x, s.z);
    State.radius = Math.max(12, diag * 1.6);

    applyOrbitToCamera();
  } else {
    // fallback (se algo der errado, usa o recenter antigo)
    recenterCamera(null, 28);
  }
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
      if (State.flatten2D >= 0.95){
        render2DCards();
      }
    });
    ro.observe(hudEl);
  }
}
