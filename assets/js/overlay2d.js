// ============================
// Overlay 2D (grid fixo por pavimento, sempre mostra todos os aptos)
// ============================

import { State } from './state.js';
import { normNameKey, hexToRgba } from './utils.js';
import { pickFVSColor } from './colors.js';
import { apartamentos } from './data.js';
import { openAptModal } from './modal.js';

// Elemento host
let host = null;

// Resolver injetado (opcional) que retorna as linhas da FVS ativa,
// usado apenas para enriquecer cor/NC dos cards (sem filtrar grade)
let getRowsForCurrentFVS = null;

/** Permite injetar o resolvedor de linhas da FVS ativa */
export function setRowsResolver(fn){
  getRowsForCurrentFVS = (typeof fn === 'function') ? fn : null;
}

/** Inicializa referencias do overlay 2D */
export function initOverlay2D(){
  host = document.getElementById('cards2d');
}

/* ===== Zoom do grid (nº de linhas) ===== */
const GRID_MIN_ROWS = 4;
const GRID_MAX_ROWS = 24;
let _zoomHandlersWired = false;

function getGridRows(){
  if (!Number.isFinite(State.grid2DRows)) State.grid2DRows = 8;
  return Math.max(GRID_MIN_ROWS, Math.min(GRID_MAX_ROWS, Math.round(State.grid2DRows)));
}
function setGridRows(n){
  State.grid2DRows = Math.max(GRID_MIN_ROWS, Math.min(GRID_MAX_ROWS, Math.round(n)));
  render2DCards();
}

/** Exibe o 2D */
export function show2D(){
  if (!host) initOverlay2D();
  if (!host) return;
  host.classList.add('active');
  host.style.pointerEvents = 'auto';
  render2DCards();

  // Wire de zoom (desktop + mobile) apenas uma vez
  if (!_zoomHandlersWired){
    _zoomHandlersWired = true;

    // Desktop/trackpad: Ctrl + roda (no trackpad, pinch vira wheel com ctrlKey=true)
    host.addEventListener('wheel', (e)=>{
      if (!host.classList.contains('active')) return;
      if (!e.ctrlKey) return; // sem Ctrl deixa rolar normalmente
      e.preventDefault();
      const cur = getGridRows();
      const step = (e.deltaY > 0) ? +1 : -1; // down = mais linhas (mais cards)
      setGridRows(cur + step);
    }, { passive:false });

    // Mobile: pinch com 2 dedos
    let pinchStartDist = 0;
    let pinchStartRows = 0;
    let pinchActive = false;
    const dist = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

    host.addEventListener('touchstart', (e)=>{
      if (!host.classList.contains('active')) return;
      if (e.touches.length === 2){
        pinchActive = true;
        pinchStartDist = dist(e.touches[0], e.touches[1]);
        pinchStartRows = getGridRows();
      }
    }, { passive:true });

    host.addEventListener('touchmove', (e)=>{
      if (!pinchActive) return;
      if (e.touches.length !== 2) return;
      e.preventDefault(); // evita zoom do browser/scroll
      const d = dist(e.touches[0], e.touches[1]);
      if (pinchStartDist <= 0) return;
      const scale = d / pinchStartDist;     // >1 = zoom in
      const rows = pinchStartRows / Math.pow(scale, 1.0); // zoom in -> menos linhas
      setGridRows(rows);
    }, { passive:false });

    host.addEventListener('touchend', ()=>{
      pinchActive = false;
      pinchStartDist = 0;
    }, { passive:true });
  }
}

/** Oculta o 2D */
export function hide2D(){
  if (!host) initOverlay2D();
  if (!host) return;
  host.classList.remove('active');
  host.style.pointerEvents = 'none';
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
  if (Number.isFinite(n)) return 10_000 + n; // maior = mais alto, vamos ordenar desc
  const map = { AT: 50_000, COB: 50_000, PH: 50_000, LAZ: 100, TER: 0, TÉR: 0, GAR: -100 };
  if (s in map) return map[s];
  return -1_000_000 + (fallbackIndex||0);
}

/** Monta mapa pavimento -> lista completa de apartamentos daquele pavimento (sem duplicatas) */
function buildFloorsFromApartamentos(){
  // floor -> Map(aptoKey -> { apt, floor, ordemcol, firstIndex })
  const floorsMap = new Map();
  const seenOrder = new Map();

  (apartamentos || []).forEach((ap, idx)=>{
    const aptRaw  = String(ap.nome ?? ap.apartamento ?? ap.apto ?? '').trim();
    const floor   = String(ap.pavimento ?? ap.pavimento_origem ?? ap.pav ?? '').trim();
    if (!aptRaw || !floor) return;

    const aptKey = normNameKey(aptRaw);
    if (!aptKey) return;

    if (!floorsMap.has(floor)) {
      floorsMap.set(floor, new Map());
      seenOrder.set(floor, floorsMap.size - 1);
    }
    const byApt = floorsMap.get(floor);

    if (!byApt.has(aptKey)) {
      byApt.set(aptKey, {
        apt: aptRaw,
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

/** Constrói lookup das linhas da FVS ativa: nomeKey -> row (para cor/NC) */
function buildRowsLookup(){
  const rows = (getRowsForCurrentFVS ? (getRowsForCurrentFVS() || []) : []);
  const map = new Map();
  for (const r of rows){
    const aptName = String(r.nome ?? r.apartamento ?? r.apto ?? '').trim();
    const key = normNameKey(aptName);
    if (!key) continue;
    map.set(key, r);
  }
  return map;
}

/** NC estrita (apenas NC > 0 conta) */
function hasNC(row){
  if (!row) return false;
  const nc = Number(row.qtd_nao_conformidades_ultima_inspecao ?? row.nao_conformidades ?? 0) || 0;
  return nc > 0;
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
  host.style.overflow = 'hidden';

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
      const key = normNameKey(it.apt);
      const row = rowsMap.get(key) || null;

      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.apto = it.apt;
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

      // Dados brutos para badges
      const nc   = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0;
      const pend = Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0;
      const perc = Number(row?.percentual_ultima_inspecao ?? row?.percentual);
      const durN = Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0;

      // === NC mode: só mostra badges se TIVER NC; senão “sem dados” e sem clique
      const showData = !NC_MODE || hasNC(row);

      // Badges
      const badges = document.createElement('div');
      badges.className = 'badges';
      if (showData){
        // 1ª linha: PEND (esq) | NC (dir)
        {
          const rowTop = document.createElement('div');
          rowTop.className = 'badge-row';

          const left  = document.createElement('div'); left.className  = 'slot left';
          const right = document.createElement('div'); right.className = 'slot right';

          if (pend > 0){
            const b = document.createElement('span');
            b.className = 'badge pend';
            b.textContent = String(pend);
            b.title = `Pendências: ${pend}`;
            left.appendChild(b);
          }
          if (nc > 0){
            const b = document.createElement('span');
            b.className = 'badge nc';
            b.textContent = String(nc);
            b.title = `Não conformidades: ${nc}`;
            right.appendChild(b);
          }

          if (left.childElementCount || right.childElementCount){
            rowTop.append(left, right);
            badges.appendChild(rowTop);
          }
        }

        // 2ª linha: DURAÇÃO (esq) | PERCENTUAL (dir)
        {
          const rowBottom = document.createElement('div');
          rowBottom.className = 'badge-row';

          const left  = document.createElement('div'); left.className  = 'slot left';
          const right = document.createElement('div'); right.className = 'slot right';

          if (durN > 0){
            const b = document.createElement('span');
            b.className = 'badge dur';
            b.textContent = String(Math.round(durN));
            b.title = `Duração (dias): ${Math.round(durN)}`;
            left.appendChild(b);
          }
          if (Number.isFinite(perc)){
            const b = document.createElement('span');
            b.className = 'badge percent';
            b.textContent = `${Math.round(perc)}%`;
            b.title = `Percentual executado`;
            right.appendChild(b);
          }

          if (left.childElementCount || right.childElementCount){
            rowBottom.append(left, right);
            badges.appendChild(rowBottom);
          }
        }
      }
      if (badges.childElementCount) el.appendChild(badges);

      // Visual / clicabilidade
      if (row){
        const color = pickFVSColor(it.apt, it.floor, State.COLOR_MAP);
        if (showData){
          // normal
          const a = Math.max(0, Math.min(1, Number(State.grid2DAlpha ?? 0.5)));
          el.style.borderColor = color;
          el.style.backgroundColor = hexToRgba(color, a);
          el.style.opacity = '1';
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.classList.remove('disabled');
          el.title = it.apt;
        }else{
          // “sem dados” + não clicável
          el.style.borderColor = 'rgba(110,118,129,.6)';
          el.style.backgroundColor  = 'rgba(34,40,53,.60)';
          el.style.opacity     = '0.85';
          el.style.pointerEvents = 'none';
          el.style.cursor = 'default';
          el.classList.add('disabled');
          el.title = '';
        }
      }else{
        // sem dados mesmo fora do NC
        el.style.borderColor = 'rgba(110,118,129,.6)';
        el.style.backgroundColor  = 'rgba(34,40,53,.60)';
        el.style.opacity     = '0.85';
        el.style.pointerEvents = NC_MODE ? 'none' : 'auto';
        el.style.cursor = NC_MODE ? 'default' : 'pointer';
        if (NC_MODE) el.classList.add('disabled'); else el.classList.remove('disabled');
      }

      // Realce NC-mode apenas para quem tem NC
      if (NC_MODE){
        if (hasNC(row)){
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
  // Delegação de clique: abre o modal com a ROW correta (mesmo em 2D/NC)
  host.onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card || card.classList.contains('disabled')) return; // sem clique nos “cinza”

    // 1) preferir a row guardada no card
    let row = card._row || null;

    // 2) fallback: lookup fresco pela key do card
    if (!row) {
      const rowsMap2 = buildRowsLookup();
      row = rowsMap2.get(card.dataset.key || '') || null;
      if (!row) row = rowsMap2.get(normNameKey(card.dataset.apto || '')) || null;
    }

    const apt = card.dataset.apto || '';
    const pav = card.dataset.pav  || '';
    const hex = pickFVSColor(apt, pav, State.COLOR_MAP);
    openAptModal({ id: apt, floor: pav, row, tintHex: hex });
  };

  // ==== ZOOM do GRID: wheel e pinch (Pointer Events) ====
attach2DZoomHandlers(host);

function setRows(n){
  const r = Math.max(3, Math.min(20, Math.round(n)));
  if (r !== State.grid2DRows){
    State.grid2DRows = r;
    render2DCards();
  }
}

function attach2DZoomHandlers(el){
  // wheel (desktop) — mais linhas quando rola pra cima (mais conteúdo), menos linhas ao rolar pra baixo
  el.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    setRows((State.grid2DRows || 8) + dir); // delta de 1 linha por notch
  }, { passive:false });

  // Pointer Events para pinch
  const ptrs = new Map();
  let start = null; // { d, rows0 }

  el.addEventListener('pointerdown', (e)=>{
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if (ptrs.size === 2){
      const a = [...ptrs.values()];
      const dx = a[1].x - a[0].x, dy = a[1].y - a[0].y;
      start = { d: Math.hypot(dx,dy) || 1, rows0: (State.grid2DRows || 8) };
    }
  });
  el.addEventListener('pointermove', (e)=>{
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (ptrs.size === 2 && start){
      const a = [...ptrs.values()];
      const dx = a[1].x - a[0].x, dy = a[1].y - a[0].y;
      const d = Math.hypot(dx,dy) || 1;
      const scale = d / (start.d || 1);

      // scale > 1  => "aproxima" => menos linhas (cards maiores)
      // scale < 1  => "afasta"   => mais linhas
      const newRows = start.rows0 / Math.max(0.25, Math.min(4, scale));
      setRows(newRows);
    }
  }, { passive:true });
  function end(id){ ptrs.delete(id); if (ptrs.size < 2) start = null; }
  el.addEventListener('pointerup', end, { passive:true });
  el.addEventListener('pointercancel', end, { passive:true });
}


  // ====== Layout ======
  const paneW = Math.max(240, host.clientWidth);
  const paneH = Math.max(180, host.clientHeight);

  const RATIO = 120/72;
  const MIN_W = 60, MIN_H = 40;
  const MAX_H = 160;
  let hGap = Math.max(12, Math.floor(paneW * 0.014));
  let vGap = Math.max(10, Math.floor(paneH * 0.014));

 const TARGET_ROWS = Math.max(3, Math.min(20, Math.round(State.grid2DRows || 8)));


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

  host.style.overflowY = 'auto';
  host.style.overflowX = 'hidden';
}

/** Recolore apenas (quando trocar FVS/tema) mantendo grade fixa */
export function recolorCards2D(){
  if (!host) return;

  const rowsMap = buildRowsLookup();
  const NC_MODE = !!State.NC_MODE;

  const cards = host.querySelectorAll('.card');
  cards.forEach(card=>{
    const apt = card.dataset.apto || '';
    const pav = card.dataset.pav  || '';
    const key = normNameKey(apt);
    const row = rowsMap.get(key) || null;

    card._row = row;
    card._hasData = !!row;

    // dados para badges
    const nc   = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0;
    const pend = Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0;
    const perc = Number(row?.percentual_ultima_inspecao ?? row?.percentual);
    const durN = Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0;

    // NC estrito
    const showData = !NC_MODE || hasNC(row);

    // badges
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

      if (pend > 0){
        const b = document.createElement('span');
        b.className = 'badge pend';
        b.textContent = String(pend);
        b.title = `Pendências: ${pend}`;
        left.appendChild(b);
      }
      if (nc > 0){
        const b = document.createElement('span');
        b.className = 'badge nc';
        b.textContent = String(nc);
        b.title = `Não conformidades: ${nc}`;
        right.appendChild(b);
      }
      if (left.childElementCount || right.childElementCount){
        rowTop.append(left, right);
        badges.appendChild(rowTop);
      }

      // 2ª linha
      const rowBottom = document.createElement('div');
      rowBottom.className = 'badge-row';
      const left2  = document.createElement('div'); left2.className  = 'slot left';
      const right2 = document.createElement('div'); right2.className = 'slot right';
      if (durN > 0){
        const b = document.createElement('span');
        b.className = 'badge dur';
        b.textContent = String(Math.round(durN));
        b.title = `Duração (dias): ${Math.round(durN)}`;
        left2.appendChild(b);
      }
      if (Number.isFinite(perc)){
        const b = document.createElement('span');
        b.className = 'badge percent';
        b.textContent = `${Math.round(perc)}%`;
        b.title = `Percentual executado`;
        right2.appendChild(b);
      }
      if (left2.childElementCount || right2.childElementCount){
        rowBottom.append(left2, right2);
        badges.appendChild(rowBottom);
      }
    }

    // Recolorir borda + fundo translúcido
    if (row){
      if (showData){
        const color = pickFVSColor(apt, pav, State.COLOR_MAP);
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
      if (hasNC(row)){
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
