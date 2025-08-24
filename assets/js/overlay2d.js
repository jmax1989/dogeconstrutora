// overlay2d.js
import { State } from './state.js';

// ================================
// Internals
// ================================
let host;                     // #cards2d
let built = false;
let cardsByKey = new Map();   // norm(apto) -> { el, numEl, durEl }
let getRows = () => [];       // resolver injetado pelo viewer.js
let resizeRAF = null;

// Utils
function normAptoId(s){
  if (s == null) return '';
  let t = String(s).trim().toUpperCase();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  t = t.replace(/\b(APARTAMENTO|APTO|AP|APT|APART)\b\.?/g, '');
  t = t.replace(/[\s\-\._\/]/g, '');
  return t;
}

// ================================
// Público: init + resolvers
// ================================
export function initOverlay2D(){
  host = document.getElementById('cards2d');
  if (!host){
    host = document.createElement('div');
    host.id = 'cards2d';
    document.getElementById('app')?.appendChild(host);
  }

  // posição/base
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.right = '0';
  host.style.bottom = '0';   // ajustado em runtime pelo HUD
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.display = 'none';
  host.style.overflow = 'hidden';

  // Re-render em resize
  window.addEventListener('resize', ()=> {
    if (State.flatten2D <= 0) return;
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(()=> render2DCards());
  });

  // Watch HUD height (evita sobreposição)
  observeHudHeight();
}

export function setRowsResolver(fn){
  if (typeof fn === 'function') getRows = fn;
}

// ================================
// Público: mostrar/ocultar
// ================================
export function show2D(){
  State.flatten2D = 1;
  host.style.display = 'block';
  host.style.pointerEvents = 'auto';
  host.style.opacity = '1';
  ensureCardsBuilt();
  render2DCards();
}

export function hide2D(){
  State.flatten2D = 0;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.display = 'none';
}

// ================================
// Construção dos cards
// ================================
function ensureCardsBuilt(){
  const rows = getRowsSafe();
  // Se já construímos para a FVS atual e a cardinalidade é a mesma, reaproveita
  if (built && cardsByKey.size && rows.length && approxSameKeys(rows)) {
    return;
  }

  // Recria do zero garantindo limpeza
  host.innerHTML = '';
  cardsByKey.clear();

  for (const r of rows){
    const apto = String(r.apartamento ?? r.apto ?? r.nome ?? '').trim();
    if (!apto) continue;
    const key  = normAptoId(apto);

    const el   = document.createElement('div');
    el.className = 'card';
    el.dataset.apto = apto;
    el.dataset.pav  = String(r.pavimento_origem ?? '');

    // Conteúdo interno: número + duração
    const numEl = document.createElement('div');
    numEl.className = 'num';
    numEl.textContent = apto;
    el.appendChild(numEl);

    const durEl = document.createElement('div');
    durEl.className = 'dur';
    el.appendChild(durEl);

    host.appendChild(el);
    cardsByKey.set(key, { el, numEl, durEl, apto });
  }

  built = true;
}

function approxSameKeys(rows){
  // evita reconstrução se o conjunto de apartamentos é o mesmo
  const need = new Set(rows.map(r => normAptoId(String(r.apartamento ?? r.apto ?? r.nome ?? '').trim())));
  if (need.size !== cardsByKey.size) return false;
  for (const k of need) if (!cardsByKey.has(k)) return false;
  return true;
}

function getRowsSafe(){
  try { 
    const arr = getRows() || [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ================================
// Render principal (layout + cores + textos)
// ================================
export function render2DCards(){
  ensureCardsBuilt();

  const rows = getRowsSafe();
  if (!rows.length){
    host.style.display = 'none';
    return;
  }
  host.style.display = (State.flatten2D > 0) ? 'block' : 'none';

  // 1) Modelo de grade por pavimento (linha) e ordemcol (coluna)
  const model = buildGridModel(rows);

  // 2) Área útil (reserva HUD)
  const hud = document.getElementById('hud');
  const hudH = hud ? hud.offsetHeight : 0;

  host.style.bottom = `${hudH}px`; // impede sobrepor o HUD
  forceReflow(host);

  const availW = Math.max(240, host.clientWidth);
  const availH = Math.max(180, host.clientHeight);

  // 3) Métricas responsivas
  const { cardW, cardH, hGap, vGap, cardGapY, TW, TH, useScroll } =
    computeLayoutMetrics(model, availW, availH);

  host.style.overflowY = useScroll ? 'auto' : 'hidden';

  // 4) Aplicar tamanhos/tipografia/cores
  const fontPx = Math.max(8, Math.round(Math.min(cardW, cardH) * 0.18));
  for (const { el } of cardsByKey.values()){
    el.style.width = `${cardW}px`;
    el.style.height = `${cardH}px`;
    el.style.fontSize = `${fontPx}px`;
    el.style.opacity = String(0.15 + 0.85*State.flatten2D);
  }

  // texto + duração sem "d"
  for (const r of rows){
    const apto = String(r.apartamento ?? r.apto ?? r.nome ?? '').trim();
    const key  = normAptoId(apto);
    const entry = cardsByKey.get(key);
    if (!entry) continue;

    entry.numEl.textContent = apto;

    if (State.NC_MODE){
      entry.durEl.style.display = 'none';
      entry.durEl.textContent   = '';
    } else {
      const dur = getDurationFromRow(r);
      if (dur != null && dur !== ''){
        entry.durEl.style.display = '';
        entry.durEl.textContent   = `${dur}`;
      } else {
        entry.durEl.style.display = 'none';
        entry.durEl.textContent   = '';
      }
    }
  }

  // 5) Cores de fundo por FVS (usa pickFVSColor do State)
  for (const r of rows){
    const apto = String(r.apartamento ?? r.apto ?? r.nome ?? '').trim();
    const key  = normAptoId(apto);
    const entry = cardsByKey.get(key);
    if (!entry) continue;

    const pav = (r.pavimento_origem != null) ? r.pavimento_origem : null;
    const bg  = (typeof State.pickFVSColor === 'function')
      ? State.pickFVSColor(apto, pav)
      : (State.COLOR_MAP?.default || '#6e7681');

    entry.el.style.background = bg;
  }

  // 6) Posicionamento absoluto
  const originX = Math.floor(availW/2);
  const originY = useScroll
    ? (8 + Math.floor(cardH/2))
    : (Math.floor(availH/2 - TH/2) + Math.floor(cardH/2));

  let cursorY = useScroll ? (originY - Math.floor(cardH/2)) : (originY - TH/2);

  for (let r = 0; r < model.rows.length; r++){
    const floorKey = model.rows[r];
    const cols = model.cols;
    const slotsThisRow = model.slotsPerRow[r];

    // altura da "faixa" do pavimento considerando empilhamento no mesmo col
    const bandH = slotsThisRow*cardH + Math.max(0, slotsThisRow-1)*cardGapY;
    const rowCenterY = cursorY + bandH/2;

    for (let c = 0; c < cols.length; c++){
      const colKey = cols[c];
      const arr = model.map.get(`${floorKey}|${colKey}`) || [];

      const colCenterX = originX - (TW/2) + c*(cardW + hGap) + cardW/2;
      const topBand = rowCenterY - (arr.length*cardH)/2;

      for (let k = 0; k < arr.length; k++){
        const key = arr[k];
        const entry = cardsByKey.get(key);
        if (!entry) continue;

        const x = colCenterX;
        const y = topBand + cardH*(k + 0.5);

        entry.el.style.position = 'absolute';
        entry.el.style.left = `${x}px`;
        entry.el.style.top  = `${y}px`;
      }
    }

    cursorY += bandH + (r < model.rows.length-1 ? vGap : 0);
  }

  if (useScroll) host.scrollTop = 0;
}

// ================================
// Grid model
// ================================
function buildGridModel(rows){
  // Agrupar por pavimento (linha), ordemcol (coluna). Fallbacks:
  // - pavimento_origem ausente -> 0
  // - ordemcol ausente -> ordena por nome e indexa
  const byFloor = new Map();

  for (const r of rows){
    const apto = String(r.apartamento ?? r.apto ?? r.nome ?? '').trim();
    if (!apto) continue;
    const key  = normAptoId(apto);
    const pav  = Number.isFinite(Number(r.pavimento_origem)) ? Number(r.pavimento_origem) : 0;

    if (!byFloor.has(pav)) byFloor.set(pav, []);
    byFloor.get(pav).push({ key, apto, ordem: r.ordemcol, z: r.zindex ?? r.z ?? 0 });
  }

  // floors: desc (topo primeiro)
  const rowsKeys = Array.from(byFloor.keys()).sort((a,b)=> b-a);

  // para cada piso, ordenar e determinar colIdx
  const map = new Map();
  const allCols = new Set();
  const slotsPerRow = [];

  for (const pav of rowsKeys){
    const items = byFloor.get(pav);

    const hasOrdem = items.some(it => Number.isFinite(Number(it.ordem)));
    let perCol = new Map();

    if (hasOrdem){
      // usa ordemcol direta
      for (const it of items){
        const col = Number.isFinite(Number(it.ordem)) ? Math.max(0, Math.floor(Number(it.ordem)-1)) : 0;
        if (!perCol.has(col)) perCol.set(col, []);
        perCol.get(col).push(it);
      }
    } else {
      // fallback: ordena alfabeticamente por apto e indexa
      items.sort((a,b)=> a.apto.localeCompare(b.apto, 'pt-BR', { numeric:true }));
      items.forEach((it, idx)=>{
        const col = idx;
        if (!perCol.has(col)) perCol.set(col, []);
        perCol.get(col).push(it);
      });
    }

    // dentro de cada coluna, empilhar por z (asc)
    let maxStack = 1;
    for (const col of perCol.keys()){
      const arr = perCol.get(col).sort((a,b)=> (Number(a.z)||0) - (Number(b.z)||0));
      maxStack = Math.max(maxStack, arr.length);
      for (const it of arr){
        allCols.add(col);
        const k = `${pav}|${col}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(it.key);
      }
    }
    slotsPerRow.push(maxStack);
  }

  const cols = Array.from(allCols).sort((a,b)=> a-b);

  return {
    rows: rowsKeys,  // pavimentos (desc)
    cols,            // colunas (asc)
    map,             // `${pav}|${col}` -> [keys...]
    slotsPerRow      // altura (em cards) necessária por pavimento
  };
}

// ================================
// Layout metrics (sem sobreposição)
// ================================
function computeLayoutMetrics(model, availW, availH){
  const rows = model.rows.length;
  const cols = model.cols.length;

  // Card ratio baseado no CSS base (120x72)
  const RATIO = 120/72;
  const MIN_W = 44, MIN_H = 18;
  let hGap = Math.max(8, Math.floor(availW * 0.012));
  let vGap = Math.max(6, Math.floor(availH * 0.012));

  const slotsSum = model.slotsPerRow.reduce((s,v)=> s+v, 0);

  // estima altura base por slot (empilhamento conta como slots)
  let cardH = Math.floor((availH - Math.max(0, rows-1)*vGap) / Math.max(1, slotsSum));
  cardH = Math.max(MIN_H, cardH);
  let cardW = Math.max(MIN_W, Math.floor(cardH * RATIO));

  // gap vertical entre cards do MESMO slot (stack)
  let cardGapY = Math.max(6, Math.floor(cardH * 0.12));

  const totalW = () => cols*cardW + Math.max(0, cols-1)*hGap;
  // totalH precisa considerar o empilhamento por linha
  const totalH = () => {
    let H = 0;
    for (let i=0; i<rows; i++){
      const slots = model.slotsPerRow[i];
      const bandH = slots*cardH + Math.max(0, slots-1)*cardGapY;
      H += bandH + (i < rows-1 ? vGap : 0);
    }
    return H;
  };

  let TW = totalW(), TH = totalH();

  // Se estourou em largura, escala proporcionalmente
  if (TW > availW){
    const sx = availW / TW;
    cardW = Math.max(MIN_W, Math.floor(cardW * sx));
    hGap  = Math.max(6, Math.floor(hGap  * sx));
    TW = totalW(); TH = totalH();
  }

  // Se ainda estourar em altura, tenta reduzir gaps/altura
  let useScroll = false; let guard = 400;
  while (TH > availH && guard-- > 0){
    if (vGap > 2) vGap -= 1;
    else if (cardGapY > 2) cardGapY -= 1;
    else if (cardH > MIN_H) cardH -= 1;
    else { useScroll = true; break; }
    TW = totalW(); TH = totalH();
  }

  return { cardW, cardH, hGap, vGap, cardGapY, TW, TH, useScroll };
}

// ================================
// Duração (sem “d”)
// ================================
function getDurationFromRow(r){
  // Preferência: duracao_real > (duracao_inicial + duracao_reaberturas) > duracao_inicial
  const real = r?.duracao_real;
  if (real != null && real !== '') return String(real);

  const ini  = Number(r?.duracao_inicial ?? NaN);
  const reab = Number(r?.duracao_reaberturas ?? NaN);
  if (!Number.isNaN(ini) && !Number.isNaN(reab)) return String(ini + reab);
  if (!Number.isNaN(ini)) return String(ini);

  return '';
}

// ================================
// Helpers
// ================================
function forceReflow(el){ void el && el.offsetHeight; }

// Observa HUD height para re-render estável
function observeHudHeight(){
  const hud = document.getElementById('hud');
  if (!hud) return;
  let last = hud.offsetHeight;
  const tick = ()=>{
    const h = hud.offsetHeight;
    if (State.flatten2D > 0 && h !== last){
      last = h;
      render2DCards();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
