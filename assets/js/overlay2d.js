// ============================
// Overlay 2D (grid fixo por pavimento, sempre mostra todos os aptos)
// ============================

import { State } from './state.js';
import { normNameKey, hexToRgba } from './utils.js';
import { pickFVSColor } from './colors.js';
import { apartamentos } from './data.js';
import { openAptModal } from './modal.js';

let host = null;
let getRowsForCurrentFVS = null;

// guarda valores para preservar posição durante mudanças de zoom programáticas
let _preZoomScrollTop = 0;
let _preZoomContentH  = 0;
let _preZoomFocalY    = 0;  // posição dentro do host (px)
let _pendingScrollRestore = false;

/** Permite injetar o resolvedor de linhas da FVS ativa */
export function setRowsResolver(fn){
  getRowsForCurrentFVS = (typeof fn === 'function') ? fn : null;
}

export function initOverlay2D(){
  host = document.getElementById('cards2d');
  if (!host) return;

  // comportamento de rolagem fixo (sem pinch/zoom nativo)
  host.style.overflowY = 'auto';
  host.style.overflowX = 'hidden';
  host.style.touchAction = 'pan-y';
  host.style.webkitOverflowScrolling = 'touch';

  // defaults do estado de zoom
  if (State.grid2DZoom == null) State.grid2DZoom = 1;

  // IMPORTANTE: desabilitado qualquer binding de pinch/wheel-zoom aqui.
  // O zoom agora é apenas por botão (hud.js chamará setGridZoom/zoom2DStep).
}

/* ---------- helpers ---------- */

/** Encontra o índice mais próximo no ciclo para o valor atual (considera animação). */
function _nearestStop(val, stops){
  let best = stops[0], bd = Math.abs(val - best);
  for (const v of stops){
    const d = Math.abs(val - v);
    if (d < bd){ best = v; bd = d; }
  }
  return best;
}
function _nextStop(cur, stops){
  const i = stops.indexOf(cur);
  return stops[(i + 1) % stops.length];
}

/* ---------- API de zoom por botão (ciclo fixo) ---------- */

// Degraus do ciclo (padrão atual): 1 → 0.75 → 0.5 → 4 → 2 → (volta 1)
const Z_STOPS = [1, 0.75, 0.5, 4, 2];

export function getMaxGridZoom(){ return 4; } // teto = 4×

/** Anima pra um zoom alvo e preserva posição de leitura. */
let _zoomRAF = null;
export function setGridZoom(targetZ){
  if (!host) initOverlay2D();
  if (!host) return;

  const ZMIN = 0.5; // mínimo efetivo do layout (0.5 porque 0.25 foi aposentado neste ciclo)
  const ZMAX = getMaxGridZoom();
  const to = Math.max(ZMIN, Math.min(ZMAX, Number(targetZ) || 1));

  // capturar o foco vertical pra restaurar depois
  const rect = host.getBoundingClientRect();
  _preZoomFocalY    = rect.height * 0.5;
  _preZoomScrollTop = host.scrollTop;
  _preZoomContentH  = host.scrollHeight;
  _pendingScrollRestore = true;

  // cancela animação anterior, se houver
  if (_zoomRAF) { cancelAnimationFrame(_zoomRAF); _zoomRAF = null; }

  const from = Number(State.grid2DZoom || 1);
  if (Math.abs(to - from) < 1e-4){
    State.grid2DZoom = _nearestStop(to, Z_STOPS); // snap
    render2DCards();
    return;
  }

  const start = performance.now();
  const dur   = 140; // ms
  const ease  = t => 1 - Math.pow(1 - t, 3); // easeOutCubic

  const step = (now)=>{
    const k = Math.min(1, (now - start) / dur);
    const z = from + (to - from) * ease(k);
    State.grid2DZoom = z;
    render2DCards();
    if (k < 1){
      _zoomRAF = requestAnimationFrame(step);
    } else {
      _zoomRAF = null;
      // snap no fim pra cair exatamente no degrau
      State.grid2DZoom = _nearestStop(to, Z_STOPS);
      render2DCards();
    }
  };
  _zoomRAF = requestAnimationFrame(step);
}

/** Reseta para 1×. */
export function resetGridZoom(){ setGridZoom(1); }

/** Avança no ciclo e retorna o novo degrau (ex.: 1→0.75→0.5→4→2→1). */
export function zoom2DStep(){
  const cur  = _nearestStop(Number(State.grid2DZoom || 1), Z_STOPS);
  const next = _nextStop(cur, Z_STOPS);
  setGridZoom(next);
  return next;
}

/** Retorna o símbolo do botão considerando o PRÓXIMO passo do ciclo. */
export function getNextGridZoomSymbol(){
  const cur = _nearestStop(Number(State.grid2DZoom || 1), Z_STOPS);
  const nxt = _nextStop(cur, Z_STOPS);
  return (nxt > cur) ? '+' : '−';
}
export function getNextGridZoomSymbolFrom(val){
  const cur = _nearestStop(Number(val || 1), Z_STOPS);
  const nxt = _nextStop(cur, Z_STOPS);
  return (nxt > cur) ? '+' : '−';
}

/* ===== Helpers ===== */

function compareApt(a, b){
  const rx = /(\d+)/g;
  const ax = String(a||'').toUpperCase();
  const bx = String(b||'').toUpperCase();
  const an = ax.match(rx); const bn = bx.match(rx);
  if (an && bn){
    const na = parseInt(an[0], 10), nb = parseInt(bn[0], 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  }
  return ax.localeCompare(bx, 'pt-BR');
}

function floorOrderValue(floorStr, fallbackIndex){
  const s = String(floorStr ?? '').trim().toUpperCase();
  const n = Number(s);
  if (Number.isFinite(n)) return 10_000 + n;
  const map = { AT: 50_000, COB: 50_000, PH: 50_000, LAZ: 100, TER: 0, TÉR: 0, GAR: -100 };
  if (s in map) return map[s];
  return -1_000_000 + (fallbackIndex||0);
}

/**
 * Constrói bandas por pavimento a partir de apartamentos.json
 * CHAVE: usa local_origem (antes: apartamento)
 */
function buildFloorsFromApartamentos(){
  const floorsMap = new Map();
  const seenOrder = new Map();

  (apartamentos || []).forEach((ap, idx)=>{
    const aptRaw  = String(ap.local_origem ?? '').trim();  // <<< TROCA PRINCIPAL
    const floor   = String(ap.pavimento ?? ap.pavimento_origem ?? ap.pav ?? '').trim();
    if (!aptRaw || !floor) return;

    const aptKey = aptRaw; // mantemos cru para casar com layout/picking
    if (!floorsMap.has(floor)) {
      floorsMap.set(floor, new Map());
      seenOrder.set(floor, floorsMap.size - 1);
    }
    const byApt = floorsMap.get(floor);

    if (!byApt.has(aptKey)) {
      byApt.set(aptKey, {
        apt: aptRaw,    // ← vai para dataset.apto
        floor,
        ordemcol: (Number(ap.ordemcol) ?? Number(ap.ordemCol) ?? Number(ap.ordem)),
        firstIndex: idx
      });
    }
  });

  for (const [floor, mapApt] of floorsMap.entries()){
    const arr = Array.from(mapApt.values());
    arr.sort((A,B)=>{
      const oa = Number.isFinite(A.ordemcol) ? A.ordemcol : null;
      const ob = Number.isFinite(B.ordemcol) ? B.ordemcol : null;
      if (oa!=null && ob!=null && oa!==ob) return oa - ob;
      const cmp = compareApt(A.apt, B.apt);
      if (cmp !== 0) return cmp;
      return (A.firstIndex ?? 0) - (B.firstIndex ?? 0);
    });
    floorsMap.set(floor, arr);
  }

  const floors = Array.from(floorsMap.keys()).sort((fa, fb)=>{
    const va = floorOrderValue(fa, seenOrder.get(fa));
    const vb = floorOrderValue(fb, seenOrder.get(fb));
    return vb - va;
  });

  return floors.map(f => ({ floor: f, items: floorsMap.get(f) || [] }));
}

/**
 * Mapa de lookup para a FVS ativa.
 * CHAVE: usa local_origem (antes: apartamento)
 */
function buildRowsLookup(){
  const rows = (getRowsForCurrentFVS ? (getRowsForCurrentFVS() || []) : []);
  const map = new Map();
  for (const r of rows){
    const aptName = String(r.local_origem ?? '').trim(); // <<< TROCA PRINCIPAL
    const key = aptName;
    if (!key) continue;
    map.set(key, r);
  }
  return map;
}

function hasNC(row){
  if (!row) return false;
  const nc = Number(row.qtd_nao_conformidades_ultima_inspecao ?? row.nao_conformidades ?? 0) || 0;
  return nc > 0;
}

// Recolore apenas (quando trocar FVS/tema) mantendo grade fixa
export function recolorCards2D(){
  if (!host) return;

  const rowsMap = buildRowsLookup();
  const NC_MODE = !!State.NC_MODE;

  const cards = host.querySelectorAll('.card');
  cards.forEach(card=>{
    const apt = card.dataset.apto || ''; // agora contém local_origem
    const pav = card.dataset.pav  || '';
    const key = apt;
    const row = rowsMap.get(key) || null;

    card._row = row;
    card._hasData = !!row;

    // valores normalizados
    const nc   = Math.max(0, Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0);
    const pend = Math.max(0, Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0);
    const perc = Math.max(0, Math.round(Number(row?.percentual_ultima_inspecao ?? row?.percentual ?? 0) || 0));
    const durN = Math.max(0, Math.round(Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0));

    const showData = !!row && (!NC_MODE || nc > 0);

    // badges (sempre 4 quando showData)
    let badges = card.querySelector('.badges');
    if (!badges){
      badges = document.createElement('div');
      badges.className = 'badges';
      card.appendChild(badges);
    }
    badges.innerHTML = '';

    if (showData){
      // 1ª linha
      const rowTop = document.createElement('div');
      rowTop.className = 'badge-row';
      const left  = document.createElement('div'); left.className  = 'slot left';
      const right = document.createElement('div'); right.className = 'slot right';

      const bPend = document.createElement('span');
      bPend.className = 'badge pend';
      bPend.textContent = String(pend);
      bPend.title = `Pendências: ${pend}`;
      left.appendChild(bPend);

      const bNc = document.createElement('span');
      bNc.className = 'badge nc';
      bNc.textContent = String(nc);
      bNc.title = `Não conformidades: ${nc}`;
      right.appendChild(bNc);

      rowTop.append(left, right);
      badges.appendChild(rowTop);

      // 2ª linha
      const rowBottom = document.createElement('div');
      rowBottom.className = 'badge-row';
      const left2  = document.createElement('div'); left2.className  = 'slot left';
      const right2 = document.createElement('div'); right2.className = 'slot right';

      const bDur = document.createElement('span');
      bDur.className = 'badge dur';
      bDur.textContent = String(durN);
      bDur.title = `Duração (dias): ${durN}`;
      left2.appendChild(bDur);

      const bPct = document.createElement('span');
      bPct.className = 'badge percent';
      bPct.textContent = `${perc}%`;
      bPct.title = `Percentual executado`;
      right2.appendChild(bPct);

      rowBottom.append(left2, right2);
      badges.appendChild(rowBottom);
    }

    // Recolorir + clique
    if (row){
      if (showData){
        const color = pickFVSColor(apt, pav, State.COLOR_MAP); // apt = local_origem
        const a = Math.max(0, Math.min(1, Number(State.grid2DAlpha ?? 0.5)));
        card.style.borderColor = color;
        card.style.backgroundColor = hexToRgba(color, a);
        card.style.opacity = '1';
        card.style.pointerEvents = 'auto';
        card.style.cursor = 'pointer';
        card.classList.remove('disabled');
        card.title = apt;
      }else{
        card.style.borderColor = 'rgba(110,118,129,.6)';
        card.style.backgroundColor = 'rgba(34,40,53,.60)';
        card.style.opacity = '0.85';
        card.style.pointerEvents = 'none';
        card.style.cursor = 'default';
        card.classList.add('disabled');
        card.title = '';
      }
    }else{
      card.style.borderColor = 'rgba(110,118,129,.6)';
      card.style.backgroundColor = 'rgba(34,40,53,.60)';
      card.style.opacity = '0.85';
      card.style.pointerEvents = NC_MODE ? 'none' : 'auto';
      card.style.cursor = NC_MODE ? 'default' : 'pointer';
      if (NC_MODE) card.classList.add('disabled'); else card.classList.remove('disabled');
    }

    // NC-mode: realce somente nos que têm NC
    if (NC_MODE){
      if (nc > 0){
        card.style.filter = 'none';
        card.style.opacity = '1';
        card.style.boxShadow = '0 0 0 2px rgba(248,81,73,.22)';
      }else{
        card.style.filter = 'none';
        card.style.boxShadow = 'none';
      }
    }else{
      card.style.filter = 'none';
      card.style.boxShadow = 'none';
    }
  });
}


/* ===== Render ===== */
export function render2DCards(){
  if (!host) initOverlay2D();
  if (!host) return;

  // host ocupa viewport (acima do HUD)
  const hud = document.getElementById('hud');
  const hudH = hud ? hud.offsetHeight : 0;
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.right = '0';
  host.style.setProperty('bottom', `${hudH}px`, 'important');

  // Base da grade
  const perFloor = buildFloorsFromApartamentos();

  // Dados da FVS ativa
  const rowsMap = buildRowsLookup();
  const NC_MODE = !!State.NC_MODE;

  // (re)constrói DOM
  host.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const band of perFloor){
    for (const it of band.items){
      const key = it.apt; // local_origem
      const row = rowsMap.get(key) || null;

      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.apto = it.apt;  // agora = local_origem
      el.dataset.pav  = it.floor;
      el.dataset.key = key;
      el._row = row;
      el._hasData = !!row;

      // Label do apto (hover)
      const numEl = document.createElement('div');
      numEl.className = 'num';
      numEl.textContent = it.apt;
      el.appendChild(numEl);

      // (antigo) duração no canto — mantido oculto
      const durEl = document.createElement('div');
      durEl.className = 'dur';
      durEl.style.display = 'none';
      el.appendChild(durEl);

      // Dados brutos
      const nc   = Math.max(0, Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0);
      const pend = Math.max(0, Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0);
      const perc = Math.max(0, Math.round(Number(row?.percentual_ultima_inspecao ?? row?.percentual ?? 0) || 0));
      const durN = Math.max(0, Math.round(Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0));

      // NC-mode: só mostra badges se TIVER NC; senão “sem dados” e não clicável
      const showData = !!row && (!NC_MODE || nc > 0);

      // Badges (sempre 4 quando showData = true)
      if (showData){
        const badges = document.createElement('div');
        badges.className = 'badges';

        // 1ª linha: PEND (esq) | NC (dir)
        {
          const rowTop = document.createElement('div');
          rowTop.className = 'badge-row';

          const left  = document.createElement('div'); left.className  = 'slot left';
          const right = document.createElement('div'); right.className = 'slot right';

          const bPend = document.createElement('span');
          bPend.className = 'badge pend';
          bPend.textContent = String(pend);
          bPend.title = `Pendências: ${pend}`;
          left.appendChild(bPend);

          const bNc = document.createElement('span');
          bNc.className = 'badge nc';
          bNc.textContent = String(nc);
          bNc.title = `Não conformidades: ${nc}`;
          right.appendChild(bNc);

          rowTop.append(left, right);
          badges.appendChild(rowTop);
        }

        // 2ª linha: DURAÇÃO (esq) | PERCENTUAL (dir)
        {
          const rowBottom = document.createElement('div');
          rowBottom.className = 'badge-row';

          const left  = document.createElement('div'); left.className  = 'slot left';
          const right = document.createElement('div'); right.className = 'slot right';

          const bDur = document.createElement('span');
          bDur.className = 'badge dur';
          bDur.textContent = String(durN);
          bDur.title = `Duração (dias): ${durN}`;
          left.appendChild(bDur);

          const bPct = document.createElement('span');
          bPct.className = 'badge percent';
          bPct.textContent = `${perc}%`;
          bPct.title = `Percentual executado`;
          right.appendChild(bPct);

          rowBottom.append(left, right);
          badges.appendChild(rowBottom);
        }

        el.appendChild(badges);
      }

      // Visual / clicabilidade
      if (row){
        const color = pickFVSColor(it.apt, it.floor, State.COLOR_MAP); // it.apt = local_origem
        if (showData){
          const a = Math.max(0, Math.min(1, Number(State.grid2DAlpha ?? 0.5)));
          el.style.borderColor = color;
          el.style.backgroundColor  = hexToRgba(color, a);
          el.style.opacity     = '1';
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.classList.remove('disabled');
          el.title = it.apt;
        }else{
          el.style.borderColor = 'rgba(110,118,129,.6)';
          el.style.backgroundColor  = 'rgba(34,40,53,.60)';
          el.style.opacity     = '0.85';
          el.style.pointerEvents = 'none';
          el.style.cursor = 'default';
          el.classList.add('disabled');
          el.title = '';
        }
      }else{
        // sem dados (fora do NC) mantém clique normal apenas quando NC_MODE=false
        el.style.borderColor = 'rgba(110,118,129,.6)';
        el.style.backgroundColor  = 'rgba(34,40,53,.60)';
        el.style.opacity     = '0.85';
        el.style.pointerEvents = NC_MODE ? 'none' : 'auto';
        el.style.cursor = NC_MODE ? 'default' : 'pointer';
        if (NC_MODE) el.classList.add('disabled'); else el.classList.remove('disabled');
      }

      // Realce NC-mode apenas para quem tem NC
      if (NC_MODE){
        if (nc > 0){
          el.style.filter = 'none';
          el.style.opacity = '1';
          el.style.boxShadow = '0 0 0 2px rgba(248,81,73,.22)';
        }else{
          el.style.filter = 'none';
          el.style.boxShadow = 'none';
        }
      }else{
        el.style.filter = 'none';
        el.style.boxShadow = 'none';
      }

      frag.appendChild(el);
      it._el = el; // para layout
    }
  }

  host.appendChild(frag);

  // Delegação de clique (mantida)
  host.onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card || card.classList.contains('disabled')) return;

    let row = card._row || null;
    if (!row) {
      const rowsMap2 = buildRowsLookup();
      row = rowsMap2.get(card.dataset.key || '') || rowsMap2.get(card.dataset.apto || '') || null;
    }

    const apt = card.dataset.apto || ''; // local_origem
    const pav = card.dataset.pav  || '';
    const hex = pickFVSColor(apt, pav, State.COLOR_MAP);
    openAptModal({ id: apt, floor: pav, row, tintHex: hex });
  };

  // ====== Layout ======
  const paneW = Math.max(240, host.clientWidth);
  const paneH = Math.max(180, host.clientHeight);

  const RATIO = 120/72;
  const MIN_W = 60, MIN_H = 40;
  const MAX_H = 160;
  let hGap = Math.max(12, Math.floor(paneW * 0.014));
  let vGap = Math.max(10, Math.floor(paneH * 0.014));

  const Z = Math.max(0.5, Math.min(getMaxGridZoom(), Number(State.grid2DZoom || 1)));
  // base 8 linhas; com Z maior, menos linhas → cards maiores (efeito “zoom”)
  const TARGET_ROWS = Math.max(1, Math.round(8 / Z));

  let cardH = Math.floor((paneH - (TARGET_ROWS-1)*vGap) / TARGET_ROWS);
  cardH = Math.max(MIN_H, Math.min(cardH, MAX_H));
  let cardW = Math.max(MIN_W, Math.floor(cardH * RATIO));
  let fontPx = Math.max(10, Math.floor(cardH * 0.24));

  const colsPerFloor = perFloor.map(b => Math.max(1, b.items.length));
  const calcTW = (cols) => cols*cardW + Math.max(0, cols-1)*hGap;
  let TWmax = Math.max(...colsPerFloor.map(calcTW));

  if (TWmax > paneW){
    const sx = paneW / TWmax;
    cardW = Math.max(MIN_W, Math.floor(cardW * sx));
    hGap  = Math.max(8, Math.floor(hGap  * sx));
  }

  const cards = host.querySelectorAll('.card');
  cards.forEach(el=>{
    el.style.width = `${cardW}px`;
    el.style.height = `${cardH}px`;
    el.style.fontSize = `${fontPx}px`;
    el.style.opacity = el.style.opacity || '0.95';
  });

  // CSS vars para dimensionar badges
  const badgeFont = Math.max(8,  Math.min(16, Math.round(cardH * 0.15)));
  const badgePadV = Math.max(2,  Math.round(cardH * 0.055));
  const badgePadH = Math.max(4,  Math.round(cardW * 0.08));
  const badgeMinW = Math.max(18, Math.round(cardW * 0.18));
  const badgeGap  = Math.max(3,  Math.round(cardW * 0.04));
  const badgeTop  = Math.max(3,  Math.round(cardH * 0.05));

  host.style.setProperty('--badge-font', `${badgeFont}px`);
  host.style.setProperty('--badge-pad-v', `${badgePadV}px`);
  host.style.setProperty('--badge-pad-h', `${badgePadH}px`);
  host.style.setProperty('--badge-minw', `${badgeMinW}px`);
  host.style.setProperty('--badge-gap',  `${badgeGap}px`);
  host.style.setProperty('--badge-top',  `${badgeTop}px`);

  const originX = Math.floor(paneW/2);
  const topPad  = 16;
  let cursorY   = topPad;

  for (let r = 0; r < perFloor.length; r++){
    const band = perFloor[r];
    const cols = Math.max(1, band.items.length);
    const TWf  = calcTW(cols);
    const rowCenterY = cursorY + Math.floor(cardH/2);

    for (let c = 0; c < band.items.length; c++){
      const it = band.items[c];
      const el = it._el;
      if (!el) continue;
      const x = originX - Math.floor(TWf/2) + c*(cardW + hGap) + Math.floor(cardW/2);
      const y = rowCenterY;
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
    }

    cursorY += cardH + (r < perFloor.length-1 ? vGap : 0);
  }

  // ===== Restaurar a posição de leitura após mudança de zoom =====
  if (_pendingScrollRestore){
    const newH = host.scrollHeight || 1;
    const oldH = _preZoomContentH || 1;
    const ratio = newH / oldH;
    const desired = ((_preZoomScrollTop + _preZoomFocalY) * ratio) - _preZoomFocalY;

    const maxScroll = Math.max(0, newH - host.clientHeight);
    host.scrollTop = Math.max(0, Math.min(maxScroll, desired));

    _pendingScrollRestore = false;
  }
}

/* ===== Visibilidade do overlay ===== */
export function show2D(){
  if (!host) initOverlay2D();
  if (!host) return;
  host.classList.add('active');
  host.style.pointerEvents = 'auto';
  render2DCards();
}

export function hide2D(){
  if (!host) initOverlay2D();
  if (!host) return;
  host.classList.remove('active');
  host.style.pointerEvents = 'none';
}
