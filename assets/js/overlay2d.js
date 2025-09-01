// ============================
// Overlay 2D (grid fixo por pavimento, sempre mostra todos os aptos)
// ============================

import { State } from './state.js';
import { hexToRgba, bestRowForName } from './utils.js';
import { pickFVSColor } from './colors.js';
import { layoutData } from './data.js';
import { openAptModal } from './modal.js';
import { getLevelIndexForName } from './geometry.js';

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

// ===== Controle de visibilidade do overlay 2D =====
//let _overlay2dEnabled = false;


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


/**
 * Constrói bandas por pavimento a partir do LAYOUT (layout-3d.json), SEM fallback.
 * Agrupa e ordena EXCLUSIVAMENTE pelo levelIndex vindo do 3D (alto → baixo).
 * Os rótulos são apenas display; não influenciam na ordenação.
 */
/**
 * Constrói bandas por pavimento a partir do LAYOUT (layout-3d.json), SEM fallback.
 * AGRUPA e ORDENA EXCLUSIVAMENTE pelo levelIndex do 3D.
 * Nenhuma heurística textual influencia a ordenação.
 */
function buildFloorsFromApartamentos(){
  const placements = Array.isArray(layoutData?.placements) ? layoutData.placements : [];
  if (!placements.length) return [];

  const split = (name)=> String(name||'').split(/\s*-\s*/g).map(s=>s.trim()).filter(Boolean);
  const join  = (parts,n)=> parts.slice(0,n).join(' - ');

  // Map<levelIndex:number, Map<rootKey:string, { apt, floor, levelIndex, ordemcol, firstIndex }>>
  const floorsByIdx = new Map();

  placements.forEach((p, idx)=>{
    const full = String(p?.nome ?? '').trim();
    if (!full) return;

    // ❗ levelIndex numérico direto do 3D — base única para a ordem
    const lvl = getLevelIndexForName(full);
    if (!Number.isFinite(lvl)) return; // se o 3D ainda não registrou, pula este item por enquanto

    const parts = split(full);

    // rótulo de exibição (NÃO usado na ordem)
    const floorLabel = `Nível ${lvl}`;

    // --- “Root” do card (não mexe na ORDEM dos pavimentos) ---
    // Preferência: até "Apartamento/Apto/Apt NNNN"
    const iApt = parts.findIndex(t => /^(Apartamento|Apto|Apt)\b/i.test(t));

    // caso não tenha "Apartamento", tentamos cortar um termo após o nível (apenas para card granulado)
    // Para isso, localizamos o token textual "Pavimento ..." se existir — novamente, só para recorte visual;
    // NÃO influencia a ordenação, que é 100% pelo lvl.
    const iPav = parts.findIndex(t => /^Pavimento\b/i.test(t));

    let rootN = (iApt >= 0) ? (iApt + 1)
               : (iPav >= 0) ? (iPav + 2)
               : Math.min(2, parts.length); // fallback mínimo: 1–2 termos

    if (rootN > parts.length) rootN = parts.length;

    // se não há nada além do 1º nível, não vira card
    if (rootN <= 1 && parts.length <= 1) return;

    const rootKey = join(parts, rootN);
    if (!rootKey) return;

    if (!floorsByIdx.has(lvl)) floorsByIdx.set(lvl, new Map());
    const byRoot = floorsByIdx.get(lvl);

    if (!byRoot.has(rootKey)){
      byRoot.set(rootKey, {
        apt: rootKey,                 // ID completo do card (casa 1:1 com FVS/hierarquia)
        floor: floorLabel,            // DISPLAY sintético; não entra na ordenação
        levelIndex: lvl,              // chave de AGRUPAMENTO e ORDENAÇÃO
        ordemcol: Number(p?.ordemcol ?? p?.ordemCol ?? p?.ordem),
        firstIndex: idx
      });
    }
  });

  // ❗ Ordenação dos pavimentos: ESTRITAMENTE por levelIndex DESC (alto → baixo)
  const sortedLvls = Array.from(floorsByIdx.keys()).sort((a,b)=> b - a);

  // Ordenação dos cards dentro do pavimento (não altera ordem de pavimento)
  const sortCards = (A,B)=>{
    const oa = Number.isFinite(A.ordemcol) ? A.ordemcol : null;
    const ob = Number.isFinite(B.ordemcol) ? B.ordemcol : null;
    if (oa!=null && ob!=null && oa!==ob) return oa - ob;

    // ordem alfanumérica com atenção a números no NOME (ex.: 2501 < 2502)
    const rx = /(\d+)/g;
    const ax = String(A.apt||'').toUpperCase();
    const bx = String(B.apt||'').toUpperCase();
    const an = ax.match(rx); const bn = bx.match(rx);
    if (an && bn){
      const na = parseInt(an[0], 10), nb = parseInt(bn[0], 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    }
    const cmp = ax.localeCompare(bx, 'pt-BR');
    if (cmp !== 0) return cmp;
    return (A.firstIndex ?? 0) - (B.firstIndex ?? 0);
  };

  // Constrói as bandas finais
  const bands = [];
  for (const lvl of sortedLvls){
    const items = Array.from(floorsByIdx.get(lvl).values()).sort(sortCards);
    bands.push({ floor: `Nível ${lvl}`, items });
  }
  return bands;
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

  const rowsMap = buildRowsLookup(); // Map<local_origem exato, row>
  const NC_MODE = !!State.NC_MODE;

  const cards = host.querySelectorAll('.card');
  cards.forEach(card=>{
    const apt = String(card.dataset.apto || '').trim(); // == local_origem do card
    const pav = String(card.dataset.pav  || '').trim();

    // Hierarquia EXATA (usa seus helpers _splitHierarchy/_joinHierarchy/bestRowForName)
    const row = bestRowForName(apt, rowsMap);

    card._row = row;
    card._hasData = !!row;

    const nc   = Math.max(0, Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0);
    const pend = Math.max(0, Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0);
    const perc = Math.max(0, Math.round(Number(row?.percentual_ultima_inspecao ?? row?.percentual ?? 0) || 0));
    const durN = Math.max(0, Math.round(Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0));

    const showData = !!row && (!NC_MODE || nc > 0);

    // badges (4 itens quando showData)
    let badges = card.querySelector('.badges');
    if (!badges){
      badges = document.createElement('div');
      badges.className = 'badges';
      card.appendChild(badges);
    }
    badges.innerHTML = '';

    if (showData){
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

    // 🔒 SÓLIDO: sem usar opacity no card
    card.style.mixBlendMode = 'normal';

    if (row){
      if (showData){
        const color = pickFVSColor(apt, pav, State.COLOR_MAP);
        const a = Math.max(0, Math.min(1, Number(State.grid2DAlpha ?? 1))); // 1 = opaco
        card.style.borderColor = color;
        card.style.backgroundColor = hexToRgba(color, a);
        card.style.opacity = '1';                   // <- garante sólido
        card.style.pointerEvents = 'auto';
        card.style.cursor = 'pointer';
        card.classList.remove('disabled');
        card.title = apt;
      }else{
        card.style.borderColor = 'rgba(110,118,129,.6)';
        // fundo cinza, mas ainda SÓLIDO
        card.style.backgroundColor = 'rgba(34,40,53,1)';
        card.style.opacity = '1';                   // <- sem translucidez
        card.style.pointerEvents = 'none';
        card.style.cursor = 'default';
        card.classList.add('disabled');
        card.title = '';
      }
    }else{
      card.style.borderColor = 'rgba(110,118,129,.6)';
      // sem dados: mantém clicável (fora de NC) mas SÓLIDO para “tampar” o 3D
      card.style.backgroundColor = 'rgba(34,40,53,1)';
      card.style.opacity = '1';                     // <- sólido
      card.style.pointerEvents = NC_MODE ? 'none' : 'auto';
      card.style.cursor = NC_MODE ? 'default' : 'pointer';
      if (NC_MODE) card.classList.add('disabled'); else card.classList.remove('disabled');
    }

    // NC mode: realce só nos que têm NC>0 (sem mexer na opacidade)
    if (NC_MODE){
      if (nc > 0){
        card.style.filter = 'none';
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

  // Ajusta a margem inferior para não cobrir o HUD
  const hud = document.getElementById('hud');
  const hudH = hud ? hud.offsetHeight : 0;
  host.style.setProperty('bottom', `${hudH}px`, 'important');

  const perFloor = buildFloorsFromApartamentos();
  const rowsMap  = buildRowsLookup();
  const NC_MODE  = !!State.NC_MODE;

  // (re)constrói DOM
  host.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const band of perFloor){
    for (const it of band.items){
      const key = it.apt; // local_origem exato do card

      // hierarquia EXATA
      const row = bestRowForName(key, rowsMap);

      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.apto = it.apt;   // local_origem
      el.dataset.pav  = it.floor; // string do pavimento
      el.dataset.key  = key;
      el._row = row;
      el._hasData = !!row;

      // 🔧 POSICIONAMENTO ABSOLUTO (centralizado no ponto x/y)
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -50%)';

      // label grande do card
      const numEl = document.createElement('div');
      numEl.className = 'num';
      numEl.textContent = it.apt;
      el.appendChild(numEl);

      // duração (mantida oculta como no seu layout)
      const durEl = document.createElement('div');
      durEl.className = 'dur';
      durEl.style.display = 'none';
      el.appendChild(durEl);

      // dados normalizados para badges
      const nc   = Math.max(0, Number(row?.qtd_nao_conformidades_ultima_inspecao ?? row?.nao_conformidades ?? 0) || 0);
      const pend = Math.max(0, Number(row?.qtd_pend_ultima_inspecao ?? row?.pendencias ?? 0) || 0);
      const perc = Math.max(0, Math.round(Number(row?.percentual_ultima_inspecao ?? row?.percentual ?? 0) || 0));
      const durN = Math.max(0, Math.round(Number(row?.duracao_real ?? row?.duracao ?? row?.duracao_inicial ?? 0) || 0));

      const showData = !!row && (!NC_MODE || nc > 0);

      if (showData){
        const badges = document.createElement('div');
        badges.className = 'badges';

        // 1ª linha: PEND | NC
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

        // 2ª linha: DURAÇÃO | PERCENTUAL
        {
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

        el.appendChild(badges);
      }

      // Visual / clicabilidade
      if (row){
        if (showData){
          const color = pickFVSColor(it.apt, it.floor, State.COLOR_MAP);
          const a = Math.max(0, Math.min(1, Number(State.grid2DAlpha ?? 0.75)));
          el.style.borderColor = color;
          el.style.backgroundColor  = hexToRgba(color, a);
          el.style.opacity     = '1';
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.classList.remove('disabled');
          el.title = it.apt;
        }else{
          el.style.borderColor = 'rgba(110,118,129,.6)';
          el.style.backgroundColor  = 'rgba(34,40,53,.95)';
          el.style.opacity     = '1';
          el.style.pointerEvents = 'none';
          el.style.cursor = 'default';
          el.classList.add('disabled');
          el.title = '';
        }
      }else{
        el.style.borderColor = 'rgba(110,118,129,.6)';
        el.style.backgroundColor  = 'rgba(34,40,53,.95)';
        el.style.opacity     = '1';
        el.style.pointerEvents = NC_MODE ? 'none' : 'auto';
        el.style.cursor = NC_MODE ? 'default' : 'pointer';
        if (NC_MODE) el.classList.add('disabled'); else el.classList.remove('disabled');
      }

      frag.appendChild(el);
      it._el = el; // referencia para posicionamento
    }
  }

  host.appendChild(frag);

  // Clique delegando para abrir modal
  host.onclick = (e) => {
    const card = e.target.closest('.card');
    if (!card || card.classList.contains('disabled')) return;

    const rowsMap2 = buildRowsLookup();
    const key = card.dataset.key || card.dataset.apto || '';
    const row = bestRowForName(key, rowsMap2);

    const apt = card.dataset.apto || '';
    const pav = card.dataset.pav  || '';
    const hex = pickFVSColor(apt, pav, State.COLOR_MAP);
    openAptModal({ id: apt, floor: pav, row, tintHex: hex });
  };

  // ====== Layout (centralização e responsividade) ======
  const paneW = Math.max(240, host.clientWidth);
  const paneH = Math.max(180, host.clientHeight);

  const RATIO = 120/72;
  const MIN_W = 60, MIN_H = 40;
  const MAX_H = 160;
  let hGap = Math.max(12, Math.floor(paneW * 0.014));
  let vGap = Math.max(10, Math.floor(paneH * 0.014));

  const Z = Math.max(0.5, Math.min(getMaxGridZoom(), Number(State.grid2DZoom || 1)));
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
    el.style.opacity = el.style.opacity || '1';
    el.style.mixBlendMode = 'normal';  // 🔒 sem blend
  });

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

  // restaura scroll se necessário
  if (_pendingScrollRestore){
    const newH = host.scrollHeight || 1;
    const oldH = _preZoomContentH || 1;
    const ratio = newH / oldH;
    const desired = ((_preZoomScrollTop + _preZoomFocalY) * ratio) - _preZoomFocalY;

    const maxScroll = Math.max(0, newH - host.clientHeight);
    host.scrollTop = Math.max(0, Math.min(maxScroll, desired));

    _pendingScrollRestore = false;
    if (!host.querySelector('.card')) {
  // se não gerou nenhum card, tenta novamente no próximo frame
  requestAnimationFrame(()=> render2DCards());
}
  }
}

// === Efeito "esfumaçado" no 3D quando o 2D estiver ativo ===
function _set3DFog(on){
  // aplica no canvas principal do THREE
  const cvs = document.querySelector('canvas');
  if (!cvs) return;
  cvs.style.transition = 'filter 140ms ease';
  // blur + redução de brilho/contraste p/ o 3D “ficar atrás”
  cvs.style.filter = on
    ? 'blur(3px) brightness(0.85) contrast(0.9) saturate(0.9)'
    : '';
}



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


