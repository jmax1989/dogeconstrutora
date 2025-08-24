// hud.js
import { State } from './state.js';
import { apartamentos, fvsList } from './data.js';
import { recolorMeshes3D, applyExplode } from './geometry.js';
import { render2DCards, show2D, hide2D } from './overlay2d.js';
import { selectGroup } from './picking.js';
import { applyOrbitToCamera, recenterCamera } from './scene.js';

// ===========================
// Paleta/base de cores
// ===========================
const PALETTE = {
  default: '#6e7681',  // cinza
  done:    '#238636',  // verde
  working: '#58a6ff',  // azul
  pending: '#d29922',  // amarelo
  failed:  '#ff3b30',  // vermelho (NC)
};

// ===========================
// Normalização
// ===========================
function normAptoId(s){
  if (s == null) return '';
  let t = String(s).trim().toUpperCase();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  t = t.replace(/\b(APARTAMENTO|APTO|AP|APT|APART)\b\.?/g, '');
  t = t.replace(/[\s\-\._\/]/g, '');
  return t;
}

// ===========================
// Regras de cor por row
// ===========================
function colorFromRowNormal(row){
  const nc   = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? 0);
  const pend = Number(row?.qtd_pend_ultima_inspecao ?? 0);
  const pct  = Number(row?.percentual_ultima_inspecao);
  const terminouInicial = !!row?.data_termino_inicial;

  // sem término -> azul
  if (!terminouInicial) return PALETTE.working;

  // terminou inicial: se 100% e sem pend/NC -> verde; senão amarelo
  const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
  return ultimaOK ? PALETTE.done : PALETTE.pending;
}
function colorFromRowNC(row){
  const ncs = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? 0);
  return (ncs > 0) ? PALETTE.failed : PALETTE.default;
}

// ===========================
// COLOR_MAP por FVS
// ===========================
function buildColorMapForFVS(fvsName){
  const map = { default: PALETTE.default, colors: {}, byFloor: {} };
  if (!fvsName || !Array.isArray(apartamentos)) return map;

  const rows = apartamentos.filter(r => String(r?.fvs||'').trim() === String(fvsName).trim());

  // cores por apt
  for (const r of rows){
    const aptName = r?.apartamento; if (!aptName) continue;
    map.colors[normAptoId(aptName)] = colorFromRowNormal(r);
  }

  // agregação por pavimento
  const agg = new Map(), bump=(o,k)=>o[k]=(o[k]||0)+1;
  for (const r of rows){
    const pav = (r?.pavimento_origem != null) ? String(r.pavimento_origem) : null;
    if (!pav) continue;
    const col = colorFromRowNormal(r);
    const stat = (col===PALETTE.working)?'working':(col===PALETTE.pending)?'pending':(col===PALETTE.done)?'done':'default';
    const o = agg.get(pav)||{}; bump(o,stat); agg.set(pav,o);
  }
  for (const [pav,o] of agg){
    let chosen = PALETTE.default;
    if (o.working) chosen = PALETTE.working;
    else if (o.pending) chosen = PALETTE.pending;
    else if (o.done)    chosen = PALETTE.done;
    map.byFloor[pav] = chosen;
  }
  return map;
}
function buildColorMapForFVS_NC(fvsName){
  const map = { default: PALETTE.default, colors: {}, byFloor: {} };
  if (!fvsName || !Array.isArray(apartamentos)) return map;

  const rows = apartamentos.filter(r => String(r?.fvs||'').trim() === String(fvsName).trim());
  for (const r of rows){
    const aptName = r?.apartamento; if (!aptName) continue;
    map.colors[normAptoId(aptName)] = colorFromRowNC(r);
  }
  const floors = new Map();
  for (const r of rows){
    const pav = (r?.pavimento_origem != null) ? String(r.pavimento_origem) : null;
    if (!pav) continue;
    const hasNC = Number(r?.qtd_nao_conformidades_ultima_inspecao ?? 0) > 0;
    const e = floors.get(pav) || { hasNC:false }; if (hasNC) e.hasNC = true; floors.set(pav,e);
  }
  for (const [pav,e] of floors) map.byFloor[pav] = e.hasNC ? PALETTE.failed : PALETTE.default;
  return map;
}

// picker de cor (usado também pelo modal)
function makePickFVSColor(colorMap){
  return function pickFVSColor(aptoId, floorIdx){
    const hexA = colorMap.colors[aptoId] || colorMap.colors[normAptoId(aptoId)];
    if (hexA && /^#?[0-9a-f]{6}$/i.test(hexA)) return hexA.startsWith('#') ? hexA : '#'+hexA;

    const hexF = colorMap.byFloor[String(floorIdx)];
    if (hexF && /^#?[0-9a-f]{6}$/i.test(hexF)) return hexF.startsWith('#') ? hexF : '#'+hexF;

    const defHex = colorMap.default || '#6e7681';
    return defHex.startsWith('#') ? defHex : '#'+defHex;
  };
}

// ===========================
// Persistência simples
// ===========================
const STORAGE_KEYS = {
  FVS: 'doge.viewer.fvs',
  NC:  'doge.viewer.nc',
};
function savePrefs(){
  try{
    if (State.CURRENT_FVS) localStorage.setItem(STORAGE_KEYS.FVS, State.CURRENT_FVS);
    localStorage.setItem(STORAGE_KEYS.NC, String(!!State.NC_MODE));
  }catch(_){}
}

// ===========================
// Dropdown FVS (+ contagem no modo NC)
// ===========================
function computeNcCountsByFvs(){
  const counts = {};
  if (!Array.isArray(apartamentos)) return counts;
  for (const r of apartamentos){
    const fvs = String(r?.fvs||'').trim(); if (!fvs) continue;
    const ncs = Number(r?.qtd_nao_conformidades_ultima_inspecao ?? 0);
    counts[fvs] = (counts[fvs] || 0) + (ncs > 0 ? 1 : 0);
  }
  return counts;
}
function rebuildFvsDropdown(){
  const sel = document.getElementById('fvsSelect');
  if (!sel) return;

  const counts = computeNcCountsByFvs();
  const all = Array.isArray(fvsList)
    ? fvsList.map(f => (typeof f === 'string') ? f.trim() : String(f?.nome ?? f?.id ?? '').trim())
    : [];

  const values = State.NC_MODE ? all.filter(n => (counts[n]||0) > 0) : all;

  const prev = sel.value;
  sel.innerHTML = '';
  for (const name of values){
    if (!name) continue;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = State.NC_MODE ? `${name} (${counts[name]||0})` : name;
    sel.appendChild(opt);
  }
  if (values.includes(prev)) sel.value = prev;
  else if (sel.options.length) sel.selectedIndex = 0;
  else sel.value = '';

  State.CURRENT_FVS = sel.value || '';
}

// ===========================
// API usada pelo viewer.js
// ===========================
export function applyFVSAndRefresh(){
  const fvs = State.CURRENT_FVS || '';
  let cmap = State.NC_MODE ? buildColorMapForFVS_NC(fvs) : buildColorMapForFVS(fvs);

  // publica no State para outros módulos (modal/picking/geometry)
  State.COLOR_MAP = cmap;
  State.pickFVSColor = makePickFVSColor(cmap);

  // aplica cores no 3D e re-renderiza os cards 2D
  recolorMeshes3D();        // geometry lê State.COLOR_MAP
  render2DCards();          // overlay2d lê State.pickFVSColor

  // mantém o apto selecionado coerente (se houver)
  if (State.selectedGroup){
    // reaplica o highlight sem perder a seleção
    try { selectGroup(State.selectedGroup); } catch(_){}
  }
}

// ===========================
// Inicialização dos controles do HUD
// ===========================
export function initHUD(){
  const hud = document.getElementById('hud');
  if (hud){
    // fallback de rolagem no mobile (não deixa controles "sumirem")
    hud.style.overflowX = 'auto';
    hud.style.flexWrap = 'wrap';
  }

  // --- Dropdown FVS
  const fvsSelect = document.getElementById('fvsSelect');
  rebuildFvsDropdown();
  fvsSelect?.addEventListener('change', ()=>{
    State.CURRENT_FVS = fvsSelect.value || '';
    savePrefs();
    applyFVSAndRefresh();
  });

  // --- Botão NC
  const btnNC = document.getElementById('btnNC');
  if (btnNC){
    btnNC.classList.toggle('active', !!State.NC_MODE);
    btnNC.addEventListener('click', ()=>{
      State.NC_MODE = !State.NC_MODE;
      btnNC.classList.toggle('active', State.NC_MODE);
      rebuildFvsDropdown();
      savePrefs();
      applyFVSAndRefresh();
    });
  }

  // --- Slider Opacidade (0..100)
  const opEl = document.getElementById('opacity');
  if (opEl){
    // assume que State.faceOpacity ∈ [0..1]; se não existir, default 1
    const start = Number.isFinite(State.faceOpacity) ? Math.round((State.faceOpacity||1)*100) : 100;
    opEl.value = String(start);
    opEl.addEventListener('input', ()=>{
      const v = Math.max(0, Math.min(100, Number(opEl.value) || 0));
      State.faceOpacity = v/100;
      // geometry.js expõe setFaceOpacity internamente; aqui usamos State + recolor se necessário
      // Como recolorMeshes3D não mexe em opacidade, apenas solicita re-render no overlay se preciso
      // O módulo geometry aplica a opacidade em seu loop/handler de estado.
      if (typeof State.__applyFaceOpacity === 'function'){
        State.__applyFaceOpacity(State.faceOpacity);
      }
    });
  }

  // --- Sliders Explode (XY / Y)
  const exXY = document.getElementById('explodeXY');
  const exY  = document.getElementById('explodeY');
  // força estado inicial colado
  State.explodeXY = 0;
  State.explodeY  = 0;
  if (exXY) exXY.value = '0';
  if (exY)  exY.value  = '0';
  // aplica “colado” já no load para não começar explodido
  applyExplode(0, 0);

  exXY?.addEventListener('input', ()=>{
    State.explodeXY = Number(exXY.value) || 0;
    applyExplode(State.explodeXY, State.explodeY);
  });
  exY?.addEventListener('input', ()=>{
    State.explodeY = Number(exY.value) || 0;
    applyExplode(State.explodeXY, State.explodeY);
  });

  // --- Reset Explode
  const resetExplode = document.getElementById('resetExplode');
  resetExplode?.addEventListener('click', ()=>{
    State.explodeXY = 0;
    State.explodeY  = 0;
    if (exXY) exXY.value = '0';
    if (exY)  exY.value  = '0';
    applyExplode(0, 0);
    // também sai do 2D se estiver ativo
    if (State.flatten2D >= 0.5){
      State.flatten2D = 0;
      hide2D();
      const btn2D = document.getElementById('btn2D');
      btn2D?.classList.remove('active');
    }
  });

  // --- Botão 2D
  const btn2D = document.getElementById('btn2D');
  if (btn2D){
    const sync2dBtn = ()=> btn2D.classList.toggle('active', State.flatten2D >= 0.99);
    sync2dBtn();
    btn2D.addEventListener('click', ()=>{
      const going2D = !(State.flatten2D >= 0.5);
      State.flatten2D = going2D ? 1 : 0;
      if (going2D) show2D(); else hide2D();
      sync2dBtn();
    });
  }

  // --- Botões de câmera
  const btnResetRot = document.getElementById('resetRot');
  btnResetRot?.addEventListener('click', ()=>{
    State.theta = 0;
    // mantém phi atual, apenas zera yaw
    applyOrbitToCamera();
  });

  const btnRecenter = document.getElementById('recenter');
  btnRecenter?.addEventListener('click', ()=>{
    recenterCamera(); // centraliza o alvo e restaura raio padrão interno do scene.js
  });
}
