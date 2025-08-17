'use strict';

(function(){
  const btn = document.getElementById('btn-toggle-3d');
  if (!btn) return;
  btn.addEventListener('click', ()=>{
    if (typeof window.THREE === 'undefined') {
      alert('Three.js não foi carregado. Confira a ORDEM dos <script> no index.html.');
      console.error('THREE undefined: verifique three.min.js e OrbitControls ANTES do main.js.');
    }
  }, { once: true });
})();


/* ===== Config ===== */
const DATA_BASE = './data';
const FVS_LIST_URL = `${DATA_BASE}/fvs-list.json`;
const APARTAMENTOS_URL = `${DATA_BASE}/apartamentos.json`;
const ESTRUTURA_URL = `${DATA_BASE}/estrutura.json`;

const DEFAULT_CELL_WIDTH = 50;
const DEFAULT_CELL_HEIGHT = 30;

/* ===== DOM refs ===== */
const loadingDiv = document.getElementById('loading');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');
const modalCloseBtn = document.querySelector('#modal button.close-btn');

/* ===== Estado ===== */
const cache = { estruturaJson:null, apartamentos:null };
let currentFvs = '';
let currentFvsItems = [];
let currentByApt = Object.create(null);   // indexado por aptKey(...)
let currentByPav = Object.create(null);   // indexado por pavimento_origem (chave técnica)
let ncMode = false; // modo destaque de Não Conformidades

// Metadados de FVS para filtro NC
let allFvsList = [];
const fvsMetaById = Object.create(null);

// modo da FVS ('apt' | 'pav')
let modeByFvs = Object.create(null);

// rótulos reais dos pavimentos (por linha)
let rowLabels = []; // rowLabels[r] => nome/label do pavimento na linha r

/* ======== NOVO: estado 3D ======== */
let _3d = {
  enabled: false,
  inited: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  raycaster: null,
  mouse: null,
  instApt: null,
  instSlab: null,
  metaApt: new Map(),
  metaSlab: new Map(),
  explode: 0,
  visibleFloors: 5,
  xray: false,
  // derivados de estrutura
  frontWidth: 6,
  backWidth: 6,
  cellDepth: 3.5,
  aptHeight: 3,
  floorGap: 0.3,
  gap: 0.4,
  floorsParsed: [],
  // UI refs
  appEl: null,
  uiEl: null,
  modeSel: null,
  floorRange: null,
  floorCountLabel: null,
  explodeRange: null,
  xrayBtn: null,
  animReq: 0
};

/* ===== Utils ===== */
const showLoading = ()=> loadingDiv.classList.add('show');
const hideLoading = ()=> loadingDiv.classList.remove('show');

function lockScroll(lock){
  document.documentElement.style.overflow = lock ? 'hidden' : '';
  document.body.style.overflow = lock ? 'hidden' : '';
}

function resizeSvgArea(){
  const topbar = document.getElementById('dropdown-container');
  const container = document.getElementById('svg-container');
  const topH = topbar.getBoundingClientRect().height;
  const vh = window.innerHeight;
  const cs = getComputedStyle(container);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const available = Math.max(300, vh - topH);
  container.style.height = (available - padY) + 'px';
}
window.addEventListener('resize', resizeSvgArea);

function groupCells(grid){
  const visited = Array.from({ length:grid.length }, () => Array(grid[0].length).fill(false));
  const groups = [];
  const rows = grid.length; const cols = grid[0].length;
  const directions = [[0,1],[1,0],[-1,0],[0,-1]];
  function bfs(r,c,value){
    const queue = [[r,c]]; const group = [];
    while(queue.length){
      const [x,y] = queue.shift();
      if(x<0||x>=rows||y<0||y>=cols||visited[x][y]||grid[x][y]!==value) continue;
      visited[x][y] = true; group.push([x,y]);
      for(const [dx,dy] of directions) queue.push([x+dx,y+dy]);
    }
    return group;
  }
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const cellValue = grid[r][c];
      if(!visited[r][c] && cellValue && cellValue.toLowerCase()!=="vazio"){
        const group = bfs(r,c,cellValue);
        groups.push({ value:cellValue, cells:group });
      }
    }
  }
  return groups;
}

function formatFloat(v, fallback){
  const n = parseFloat(String(v??'').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function formatDateBR(dateStr){
  if(!dateStr) return "";
  const parts = dateStr.split('-');
  if(parts.length<3) return dateStr;
  const yyyy = parseInt(parts[0],10);
  const mm = parseInt(parts[1],10)-1;
  const dd = parseInt(parts[2].substring(0,2),10);
  const d = new Date(yyyy,mm,dd);
  if(isNaN(d)) return dateStr;
  return `${String(dd).padStart(2,'0')}/${String(mm+1).padStart(2,'0')}/${yyyy}`;
}

function normalizeCellLabel(cell){
  if(cell == null) return '';
  let s = String(cell).trim();
  if(!s) return '';
  if (s.toLowerCase() === 'vazio') return 'vazio';
  if (s[0] === '!') s = s.slice(1);
  return s;
}

function getUltimaInspecaoInfo(reaberturas){
  if(!Array.isArray(reaberturas)||reaberturas.length===0){
    return { codigo_ultima_inspecao:null, qtd_pend_ultima_inspecao:0 };
  }
  let best=null;
  for(const r of reaberturas){
    const c = Number(r.codigo);
    if(!Number.isNaN(c)){
      if(!best || c>best.c) best = { c, q:Number(r.qtd_itens_pendentes)||0 };
    }
  }
  if(best) return { codigo_ultima_inspecao:String(best.c), qtd_pend_ultima_inspecao:best.q };
  const last = reaberturas[reaberturas.length-1];
  return { codigo_ultima_inspecao: last.codigo ?? null, qtd_pend_ultima_inspecao: Number(last.qtd_itens_pendentes) || 0 };
}

/* Normaliza o texto do apartamento para usar como chave: "Apartamento 101-A" -> "101A" */
function aptKey(s){
  if (s == null) return '';
  let t = String(s).trim().toUpperCase();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,''); // remove acentos
  t = t.replace(/\b(APARTAMENTO|APTO|AP|APT|APART)\b\.?/g, ''); // prefixos
  t = t.replace(/[\s\-\._\/]/g, ''); // separadores
  return t;
}

/* Progress bar (sem ARIA) */
function linearProgress(pct, overrideColor){
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = overrideColor || 'var(--blue)';
  return `
    <span class="q-linear-progress q-linear-progress--sm" style="color:${color}">
      <span class="q-linear-progress__track">
        <span class="q-linear-progress__bar" data-w="${p}%"></span>
      </span>
      <span class="q-linear-progress__label">${p}%</span>
    </span>`;
}
function animateProgressBars(root=document){
  const bars = root.querySelectorAll('.q-linear-progress__bar[data-w]');
  requestAnimationFrame(()=> bars.forEach(b => { b.style.width = b.dataset.w; }));
}

/* Modal tint */
function hexToRgb(hex){
  const h = hex.replace('#','').trim();
  if (h.length === 3) {
    const r = parseInt(h[0]+h[0],16), g = parseInt(h[1]+h[1],16), b = parseInt(h[2]+h[2],16);
    return [r,g,b];
  }
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return [r,g,b];
}
const rgbaStr = ([r,g,b], a)=> `rgba(${r}, ${g}, ${b}, ${a})`;
function applyModalTint(fillHex){
  try{
    const modal = document.getElementById('modal');
    const [r,g,b] = hexToRgb(fillHex || '#58a6ff');
    modal.style.setProperty('--modal-tint-strong', rgbaStr([r,g,b], 0.20));
    modal.style.setProperty('--modal-tint-soft',   rgbaStr([r,g,b], 0.10));
    modal.style.setProperty('--modal-border',      rgbaStr([r,g,b], 0.28));
  }catch(e){ console.warn('Tint modal error:', e); }
}

/* ====== SVG helpers ====== */
function clearSvg(){
  const svg = document.getElementById('svg');
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 0 0`);
}

/* ===== Carregadores ===== */
async function loadJSON(url){
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

/* ===== Row labels (NOMES DOS PAVIMENTOS via apartamentos.json) ===== */
function buildRowLabelsFromApartamentos(ejson, apartamentos){
  const grid = Array.isArray(ejson.grid) ? ejson.grid : [];
  const n = grid.length;

  const aptBest = new Map();
  const hasName = (it) => {
    const cands = [ it.pavimento_nome, it.pavimento_label, it.pavimento, it.nome_pavimento ];
    return cands.some(v => v != null && String(v).trim() !== '');
  };
  for (const it of apartamentos || []) {
    const k = aptKey(it.apartamento);
    const prev = aptBest.get(k);
    if (!prev) {
      aptBest.set(k, it);
    } else if (!hasName(prev) && hasName(it)) {
      aptBest.set(k, it);
    }
  }

  const pavLabelFromItem = (it)=>{
    const cand = it.pavimento_nome ?? it.pavimento_label ?? it.pavimento ?? it.nome_pavimento;
    if (cand != null && String(cand).trim() !== '') return String(cand).trim();
    if (it.pavimento_origem != null) return String(it.pavimento_origem).trim();
    return '';
  };

  const labels = new Array(n).fill('');
  for (let r = 0; r < n; r++){
    if (r === 0) { labels[r] = ''; continue; } // linha 1 é cabeçalho

    const firstCol = (grid[r] && grid[r][0]) ? String(grid[r][0]).trim() : '';
    if (firstCol && firstCol.toLowerCase() !== 'vazio') {
      labels[r] = firstCol;
      continue;
    }

    let label = '';
    for (let c = 1; c < (grid[r]?.length || 0); c++){
      const raw = normalizeCellLabel(grid[r][c]);
      if (!raw || raw.toLowerCase()==='vazio') continue;
      const it = aptBest.get(aptKey(raw));
      if (it) {
        label = pavLabelFromItem(it);
        if (label) break;
      }
    }

    if (!label) {
      for (let c = 1; c < (grid[r]?.length || 0); c++){
        const raw = normalizeCellLabel(grid[r][c]);
        if (!raw || raw.toLowerCase()==='vazio') continue;
        if (/^[A-Za-zÀ-ÿ]{2,6}$/.test(raw)) { label = raw; break; }
        const m = raw.match(/^(\d{1,4})/);
        if (m) { label = String(Math.floor(parseInt(m[1],10)/100)); break; }
        label = raw; break;
      }
    }
    labels[r] = label || '';
  }
  return labels;
}

/* ===== Agrupamento por pavimento ===== */
function buildFloorGroupsFromGrid(grid){
  const groups = [];
  for(let r=0; r<grid.length; r++){
    let first = null, last = null;
    for(let c=0; c<grid[r].length; c++){
      const v = grid[r][c];
      if(v && v.toLowerCase()!=='vazio'){
        if(first===null) first = c;
        last = c;
      }
    }
    if(first!==null){
      const cells = [];
      for(let c=first; c<=last; c++) cells.push([r,c]);
      const label = (rowLabels[r] ?? '').toString().trim() || `Pavimento ${r}`;
      groups.push({ value: label, floorIndex: r, cells });
    }
  }
  return groups;
}

/* ===== Desenho 2D ===== */
function draw(groupsApt, duracoesMap, fvsSelecionada, colWidths, rowHeights){
  const svg = document.getElementById('svg');
  svg.innerHTML = '';

  const isPav = !!(currentFvs && modeByFvs[currentFvs] === 'pav');

  const groups = isPav ? (()=>{
    const grid = cache.estruturaJson?.grid || [];
    return buildFloorGroupsFromGrid(grid);
  })() : groupsApt;

  const maxCols = groups.length
    ? Math.max(...groups.map(g => Math.max(...g.cells.map(c => c[1])))) + 1
    : (colWidths?.length || 0);

  const colW = Array.from({length: maxCols}, (_,i) => formatFloat(colWidths[i], DEFAULT_CELL_WIDTH));

  const cumX = [0];
  for(let i=0;i<colW.length;i++) cumX.push(cumX[i] + (colW[i]||DEFAULT_CELL_WIDTH));
  const cumY = [0];
  for(let i=0;i<rowHeights.length;i++) cumY.push(cumY[i] + formatFloat(rowHeights[i], DEFAULT_CELL_HEIGHT));

  const totalW = cumX[cumX.length-1] || 0;
  const totalH = cumY[cumY.length-1] || 0;

  if(!fvsSelecionada){
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.innerHTML = '';
    return;
  }

  const svgNS = "http://www.w3.org/2000/svg";

  groups.forEach(group=>{
    if (!group?.cells?.length) return;

    let minRow=Infinity, minCol=Infinity, maxRow=-1, maxCol=-1;
    for (const [r,c] of group.cells){
      if (r<minRow) minRow=r; if (c<minCol) minCol=c;
      if (r>maxRow) maxRow=r; if (c>maxCol) maxCol=c;
    }

    const x = cumX[minCol];
    const y = cumY[minRow];
    const width  = cumX[maxCol+1] - cumX[minCol];
    const height = cumY[maxRow+1] - cumY[minRow];

    let fillColor = getComputedStyle(document.documentElement).getPropertyValue('--gray') || '#6e7681';
    let textoCentro = '';
    let podeClicar = false;

    if (!isPav) {
      // ===== APARTAMENTO =====
      const key = aptKey(group.value);
      const data = duracoesMap[key];

      if (data) {
        textoCentro = `${data.duracao_real ?? ''}`;

        const pend = Number(data.qtd_pend_ultima_inspecao || 0);
        const nc   = Number(data.qtd_nc_ultima_inspecao || 0);
        const pct  = Number(data.percentual_ultima_inspecao);
        const terminouInicial = !!data.data_termino_inicial;

        if (ncMode) {
          fillColor = (nc > 0) ? '#f85149' : fillColor;
          if (nc === 0) textoCentro = '';
        } else {
          if (!terminouInicial) {
            fillColor = '#1f6feb';
          } else {
            const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
            fillColor = ultimaOK ? '#238636' : '#d29922';
          }
        }
        podeClicar = true;
      }

      const g = document.createElementNS(svgNS, "g");
      g.dataset.apto = group.value;
      if (podeClicar) {
        g.style.cursor = 'pointer';
        g.setAttribute('title', `Abrir detalhes: ${group.value}`);
        g.addEventListener('click', ()=> abrirModalDetalhes(group.value, fvsSelecionada, fillColor));
      } else {
        g.classList.add('disabled');
      }

      const rect = document.createElementNS(svgNS,"rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y);
      rect.setAttribute("width",width); rect.setAttribute("height",height);
      rect.setAttribute("fill",fillColor); rect.setAttribute("class","cell");
      g.appendChild(rect);

      const aptText = document.createElementNS(svgNS,"text");
      aptText.setAttribute("x",x+3); aptText.setAttribute("y",y+3);
      aptText.setAttribute("class","apt-text"); aptText.textContent = group.value;
      aptText.setAttribute("pointer-events","none");
      g.appendChild(aptText);

      const duracaoText = document.createElementNS(svgNS,"text");
      duracaoText.setAttribute("x",x + width/2);
      duracaoText.setAttribute("y",y + height/2);
      duracaoText.setAttribute("class","duracao-text"); duracaoText.textContent = textoCentro;
      duracaoText.setAttribute("pointer-events","none");
      g.appendChild(duracaoText);

      svg.appendChild(g);
    } else {
      // ===== PAVIMENTO =====
      const displayLabel = group.value;

      const grid = cache.estruturaJson?.grid || [];
      const r = group.floorIndex;
      const aptosDoAndar = new Set();
      for(let c=minCol; c<=maxCol; c++){
        const raw = grid[r]?.[c];
        const lab = normalizeCellLabel(raw);
        if(lab && lab.toLowerCase()!=='vazio') aptosDoAndar.add(lab);
      }
      const aptList = Array.from(aptosDoAndar);

      let pavKey = null;
      for (const apt of aptList){
        const info = currentByApt[aptKey(apt)];
        if (info?.pavimento_origem){
          pavKey = info.pavimento_origem;
          break;
        }
      }

      const pavData = pavKey ? currentByPav[pavKey] : null;

      if (pavData) {
        textoCentro = `${pavData.duracao_real ?? ''}`;

        const pend = Number(pavData.qtd_pend_ultima_inspecao || 0);
        const nc   = Number(pavData.qtd_nao_conformidades_ultima_inspecao || pavData.qtd_nc_ultima_inspecao || 0);
        const pct  = Number(pavData.percentual_ultima_inspecao);
        const terminouInicial = !!pavData.data_termino_inicial;

        if (ncMode) {
          fillColor = (nc > 0) ? '#f85149' : fillColor;
          if (nc === 0) textoCentro = '';
        } else {
          if (!terminouInicial) {
            fillColor = '#1f6feb';
          } else {
            const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
            fillColor = ultimaOK ? '#238636' : '#d29922';
          }
        }
      }

      const g = document.createElementNS(svgNS, "g");
      g.dataset.pav = pavKey || `floor-${r}`;
      if (pavKey || aptList.length) {
        g.style.cursor = 'pointer';
        g.setAttribute('title', `Abrir detalhes: ${displayLabel}`);
        g.addEventListener('click', ()=> abrirModalDetalhesPavimento(pavKey, displayLabel, fillColor, aptList));
      } else {
        g.classList.add('disabled');
      }

      const rect = document.createElementNS(svgNS,"rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y);
      rect.setAttribute("width",width); rect.setAttribute("height",height);
      rect.setAttribute("fill",fillColor); rect.setAttribute("class","cell");
      g.appendChild(rect);

      const aptText = document.createElementNS(svgNS,"text");
      aptText.setAttribute("x",x+3); aptText.setAttribute("y",y+3);
      aptText.setAttribute("class","apt-text");
      aptText.textContent = displayLabel;
      aptText.setAttribute("pointer-events","none");
      g.appendChild(aptText);

      const duracaoText = document.createElementNS(svgNS,"text");
      duracaoText.setAttribute("x",x + width/2);
      duracaoText.setAttribute("y",y + height/2);
      duracaoText.setAttribute("class","duracao-text"); duracaoText.textContent = textoCentro;
      duracaoText.setAttribute("pointer-events","none");
      g.appendChild(duracaoText);

      svg.appendChild(g);
    }
  });

  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
}

/* ===== Modal (APTO) ===== */
async function abrirModalDetalhes(apartamento, fvsSelecionada, fillColor){
  applyModalTint(fillColor);

  modalContent.innerHTML = `<p>Carregando dados do apartamento ${apartamento}...</p>`;
  modalBackdrop.style.display = 'flex';
  lockScroll(true);
  try{
    const info = currentByApt[aptKey(apartamento)];
    if(!info){
      modalContent.innerHTML = `<p>Sem dados para o apartamento ${apartamento}.</p>`;
      return;
    }

    let codUlt = info.codigo_ultima_inspecao;
    let pendUlt = info.qtd_pend_ultima_inspecao;
    if(codUlt == null){
      const aux = getUltimaInspecaoInfo(info.reaberturas);
      codUlt = aux.codigo_ultima_inspecao;
      pendUlt = aux.qtd_pend_ultima_inspecao;
    }

    let ncUlt = info.qtd_nao_conformidades_ultima_inspecao;
    if (ncUlt == null && Array.isArray(info.reaberturas) && info.reaberturas.length) {
      const lastReab = info.reaberturas[info.reaberturas.length - 1];
      ncUlt = Number(lastReab.qtd_nao_conformidades);
    }

    const idLink = info.id_ultima_inspecao || info.id;
    const inmetaUrl = idLink
      ? `https://app.inmeta.com.br/app/360/servico/inspecoes/realizadas?inspecao=${encodeURIComponent(idLink)}`
      : null;

    let html = `<p><strong>Apartamento:</strong> ${info.apartamento}</p>`;
    if (info.pavimento_origem) {
      html += `<p><strong>Pavimento origem:</strong> ${info.pavimento_origem}</p>`;
    }
    html += `<p><strong>Início:</strong> ${formatDateBR(info.data_abertura)}</p>`;
    if(info.data_termino_inicial){
      html += `<p><strong>Término:</strong> ${formatDateBR(info.data_termino_inicial)}</p>`;
    }

    let progressMarkup = '';
    const pct = Number(info.percentual_ultima_inspecao);
    if (!Number.isNaN(pct)) {
      if (!info.data_termino_inicial) {
        progressMarkup = linearProgress(pct, 'var(--blue)');
      } else if ((Number((info.qtd_pend_ultima_inspecao||0))>0) || (Number((ncUlt||0))>0) || pct<100) {
        progressMarkup = linearProgress(pct, 'var(--yellow)');
      }
    }
    html += `<p class="line-progress"><span><strong>Duração inicial:</strong> ${info.duracao_inicial}</span>${progressMarkup}</p>`;

    if (ncUlt != null && !Number.isNaN(Number(ncUlt)) && Number(ncUlt) > 0) {
      html += `<p><strong>Não conformidades:</strong> ${Number(ncUlt)}</p>`;
    }

    if(info.reaberturas?.length){
      const toTime = (d) => {
        const [yy, mm, dd] = (d || '').split('-').map(x => parseInt(x, 10));
        const t = new Date(yy, (mm||1)-1, dd||1).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      const reabs = [...info.reaberturas].sort((a, b) => {
        const ta = toTime(a.data_abertura), tb = toTime(b.data_abertura);
        if (ta !== tb) return ta - tb;
        const pa = Number(a.qtd_itens_pendentes) || 0;
        const pb = Number(b.qtd_itens_pendentes) || 0;
        if (pa !== pb) return pa - pb;
        const na = Number(a.qtd_nao_conformidades) || 0;
        const nb = Number(b.qtd_nao_conformidades) || 0;
        if (na !== nb) return na - nb;
        return String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'pt-BR', { numeric: true });
      });

      html += `<hr><table><tr><th>Código</th><th>Data Abertura</th><th>Pendências</th><th>Não conformidades</th></tr>`;
      reabs.forEach(r => {
        html += `<tr>
          <td>${r.codigo ?? '-'}</td>
          <td>${formatDateBR(r.data_abertura)}</td>
          <td>${r.qtd_itens_pendentes}</td>
          <td>${r.qtd_nao_conformidades ?? '-'}</td>
        </tr>`;
      });
      html += `</table>`;
      html += `<p><strong>Duração reinspeções:</strong> ${info.duracao_reaberturas || 0}</p>`;
    }

    if(inmetaUrl){
      html += `
      <p>
        <a class="link-row" href="${inmetaUrl}" target="_blank" rel="noopener noreferrer">
          <span><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${info.qtd_pend_ultima_inspecao ?? '-'}${(ncUlt!=null)?` | NC ${ncUlt}`:''}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1-2-2h6"/>
          </svg>
        </a>
      </p>`;
    } else {
      html += `<p><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${info.qtd_pend_ultima_inspecao ?? '-'}${(ncUlt!=null)?` | NC ${ncUlt}`:''}</p>`;
    }

    html += `<p><strong>Duração total:</strong> ${info.duracao_real}</p>`;
    if(info.termino_final){
      html += `<p><strong>Término final:</strong> ${formatDateBR(info.termino_final)}</p>`;
    }
    modalContent.innerHTML = html;
    animateProgressBars(modalContent);
  }catch(err){
    modalContent.innerHTML = `<p>Erro ao carregar dados: ${err.message}</p>`;
  }
}

function fecharModal(){
  modalBackdrop.style.display = 'none';
  modalContent.innerHTML = '';
  lockScroll(false);
}

/* ===== Modal (PAVIMENTO) ===== */
function abrirModalDetalhesPavimento(pavKey, displayLabel, fillColor, aptosDoAndar){
  applyModalTint(fillColor);

  modalContent.innerHTML = `<p>Carregando dados do ${displayLabel}...</p>`;
  modalBackdrop.style.display = 'flex';
  lockScroll(true);

  try{
    const info = pavKey ? (currentByPav[pavKey] || null) : null;

    let html = `<h3 style="margin:0 0 8px 0;">${displayLabel}</h3>`;
    if (Array.isArray(aptosDoAndar) && aptosDoAndar.length){
      html += `<p><strong>Apartamentos:</strong> ${aptosDoAndar.join(', ')}</p>`;
    }

    if(!info){
      html += `<p>Sem dados desta FVS para o pavimento.</p>`;
      modalContent.innerHTML = html;
      return;
    }

    let codUlt = info.codigo_ultima_inspecao;
    let pendUlt = info.qtd_pend_ultima_inspecao;

    if(codUlt == null){
      const aux = getUltimaInspecaoInfo(info.reaberturas);
      codUlt = aux.codigo_ultima_inspecao;
      pendUlt = aux.qtd_pend_ultima_inspecao;
    }

    let ncUlt = info.qtd_nao_conformidades_ultima_inspecao;
    if (ncUlt == null && Array.isArray(info.reaberturas) && info.reaberturas.length) {
      const lastReab = info.reaberturas[info.reaberturas.length - 1];
      ncUlt = Number(lastReab.qtd_nao_conformidades);
    }

    const idLink = info.id_ultima_inspecao || info.id;
    const inmetaUrl = idLink
      ? `https://app.inmeta.com.br/app/360/servico/inspecoes/realizadas?inspecao=${encodeURIComponent(idLink)}`
      : null;

    html += `<p><strong>Início:</strong> ${formatDateBR(info.data_abertura)}</p>`;
    if(info.data_termino_inicial){
      html += `<p><strong>Término:</strong> ${formatDateBR(info.data_termino_inicial)}</p>`;
    }

    let progressMarkup = '';
    const pct = Number(info.percentual_ultima_inspecao);
    if (!Number.isNaN(pct)) {
      if (!info.data_termino_inicial) {
        progressMarkup = linearProgress(pct, 'var(--blue)');
      } else if ((Number((info.qtd_pend_ultima_inspecao||0))>0) || (Number((ncUlt||0))>0) || pct<100) {
        progressMarkup = linearProgress(pct, 'var(--yellow)');
      }
    }
    html += `<p class="line-progress"><span><strong>Duração inicial:</strong> ${info.duracao_inicial}</span>${progressMarkup}</p>`;

    if (ncUlt != null && !Number.isNaN(Number(ncUlt)) && Number(ncUlt) > 0) {
      html += `<p><strong>Não conformidades:</strong> ${Number(ncUlt)}</p>`;
    }

    if(info.reaberturas?.length){
      const toTime = (d) => {
        const [yy, mm, dd] = (d || '').split('-').map(x => parseInt(x, 10));
        const t = new Date(yy, (mm||1)-1, dd||1).getTime();
        return Number.isFinite(t) ? t : 0;
      };
      const reabs = [...info.reaberturas].sort((a, b) => {
        const ta = toTime(a.data_abertura), tb = toTime(b.data_abertura);
        if (ta !== tb) return ta - tb;
        const pa = Number(a.qtd_itens_pendentes) || 0;
        const pb = Number(b.qtd_itens_pendentes) || 0;
        if (pa !== pb) return pa - pb;
        const na = Number(a.qtd_nao_conformidades) || 0;
        const nb = Number(b.qtd_nao_conformidades) || 0;
        if (na !== nb) return na - nb;
        return String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'pt-BR', { numeric: true });
      });

      html += `<hr><table><tr><th>Código</th><th>Data Abertura</th><th>Pendências</th><th>Não conformidades</th></tr>`;
      reabs.forEach(r => {
        html += `<tr>
          <td>${r.codigo ?? '-'}</td>
          <td>${formatDateBR(r.data_abertura)}</td>
          <td>${r.qtd_itens_pendentes}</td>
          <td>${r.qtd_nao_conformidades ?? '-'}</td>
        </tr>`;
      });
      html += `</table>`;
      html += `<p><strong>Duração reinspeções:</strong> ${info.duracao_reaberturas || 0}</p>`;
    }

    if(inmetaUrl){
      html += `
      <p>
        <a class="link-row" href="${inmetaUrl}" target="_blank" rel="noopener noreferrer">
          <span><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${pendUlt ?? '-'}${(ncUlt!=null)?` | NC ${ncUlt}`:''}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1-2-2h6"/>
          </svg>
        </a>
      </p>`;
    } else {
      html += `<p><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${pendUlt ?? '-'}${(ncUlt!=null)?` | NC ${ncUlt}`:''}</p>`;
    }

    html += `<p><strong>Duração total:</strong> ${info.duracao_real}</p>`;
    if(info.termino_final){
      html += `<p><strong>Término final:</strong> ${formatDateBR(info.termino_final)}</p>`;
    }

    modalContent.innerHTML = html;
    animateProgressBars(modalContent);
  }catch(err){
    modalContent.innerHTML = `<p>Erro ao carregar dados: ${err.message}</p>`;
  }
}

/* ===== Dropdown de FVS com filtro por NC ===== */
function renderFvsDropdown(preserveValue=true){
  const dropdown = document.getElementById('dropdown');
  const prev = preserveValue ? dropdown.value : '';

  const list = ncMode
    ? allFvsList.filter(id => (fvsMetaById[id]?.ncCount ?? 0) > 0)
    : allFvsList.slice();

  if (!list.length) {
    dropdown.innerHTML = `<option value="">Nenhuma FVS com NC</option>`;
    return;
  }

  const opts = ['<option value="">-- Selecione uma FVS --</option>']
    .concat(list.map(id => {
      const meta = fvsMetaById[id];
      const labelNC = (meta && meta.ncCount > 0) ? ` (${meta.ncCount} NC)` : '';
      return `<option value="${id}">${id}${labelNC}</option>`;
    }));
  dropdown.innerHTML = opts.join('');

  if (prev && list.includes(prev)) {
    dropdown.value = prev;
  } else if (ncMode && prev && !list.includes(prev)) {
    dropdown.value = '';
    currentFvs = '';
    clearSvg();
  }
}

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', ()=>{
  resizeSvgArea();
  carregarFvs();

  document.getElementById('dropdown').addEventListener('change', e=>{
    carregarDuracoesEFazerDraw(e.target.value).then(()=> {
      // sincroniza UI 3D se estiver ativa
      if (_3d.enabled) sync3DModeFromFVS();
      recolor3D();
    });
  });

  modalCloseBtn.addEventListener('click', fecharModal);
  modalBackdrop.addEventListener('click', e=>{ if(e.target === modalBackdrop) fecharModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && getComputedStyle(modalBackdrop).display==='flex') fecharModal(); });

  const btnNc = document.getElementById('btn-nc');
  if (btnNc) {
    btnNc.addEventListener('click', ()=>{
      ncMode = !ncMode;
      btnNc.classList.toggle('is-active', ncMode);
      renderFvsDropdown(true);
      carregarDuracoesEFazerDraw(currentFvs).then(()=>{
        if (_3d.enabled) recolor3D();
      });
    });
  }

  // ===== NOVO: toggle 3D
  const btn3d = document.getElementById('btn-toggle-3d');
  const svgContainer = document.getElementById('svg-container');
  _3d.appEl = document.getElementById('app3d');
  _3d.uiEl = document.getElementById('ui-3d');
  _3d.modeSel = document.getElementById('mode-3d');
  _3d.floorRange = document.getElementById('floorRange-3d');
  _3d.floorCountLabel = document.getElementById('floorCountLabel-3d');
  _3d.explodeRange = document.getElementById('explodeRange-3d');
  _3d.xrayBtn = document.getElementById('xrayBtn-3d');

  if (btn3d) {
    btn3d.addEventListener('click', ()=>{
      _3d.enabled = !_3d.enabled;
      btn3d.setAttribute('aria-pressed', String(_3d.enabled));
      btn3d.classList.toggle('is-active', _3d.enabled);
      svgContainer.style.display = _3d.enabled ? 'none' : '';
      _3d.appEl.style.display = _3d.enabled ? 'block' : 'none';
      _3d.uiEl.style.display = _3d.enabled ? 'flex' : 'none';
      _3d.appEl.setAttribute('aria-hidden', String(!_3d.enabled));
      _3d.uiEl.setAttribute('aria-hidden', String(!_3d.enabled));

      if (_3d.enabled && !_3d.inited) {
        init3D().then(()=>{
          build3DFromData();
          sync3DModeFromFVS();
          start3DLoop();
        }).catch(err=>{
          console.error('Erro init3D:', err);
        });
      } else if (_3d.enabled) {
        // atualizar quando retornar ao 3D
        build3DFromData();
        sync3DModeFromFVS();
        start3DLoop();
      } else {
        stop3DLoop();
      }
    });
  }
});

/* ===== Dados + draw ===== */
async function carregarFvs(){
  const dropdown = document.getElementById('dropdown');
  dropdown.innerHTML = '<option value="">Carregando FVS...</option>';
  try{
    // 1) lista bruta de FVS
    const res = await fetch(FVS_LIST_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    allFvsList = await res.json();

    // 2) garantir apartamentos no cache
    if(!cache.apartamentos){
      const ra = await fetch(APARTAMENTOS_URL, { cache: 'no-store' });
      if(!ra.ok) throw new Error(`HTTP ${ra.status}`);
      cache.apartamentos = await ra.json();
    }

    // 3) detectar modo por FVS (apt/pav) reaproveitando seus dados
    modeByFvs = Object.create(null);
    for (const it of cache.apartamentos) {
      const f = it.fvs;
      if (!f) continue;
      const isPav = !!it.pavimento_origem;
      if (!modeByFvs[f]) modeByFvs[f] = isPav ? 'pav' : 'apt';
      if (!isPav) modeByFvs[f] = 'apt';
    }

    // 4) somar NCs por unidade deduplicada
    const unitNcMapByFvs = Object.create(null);
    for (const it of cache.apartamentos) {
      const f = it.fvs;
      if (!f) continue;
      const mode = modeByFvs[f] || 'apt';
      if (mode === 'apt' && it.pavimento_origem) continue;
      const key = (mode === 'apt') ? aptKey(it.apartamento) : it.pavimento_origem;
      if (!key) continue;
      const ncItems = Number(it.qtd_nao_conformidades_ultima_inspecao || 0);
      if (!unitNcMapByFvs[f]) unitNcMapByFvs[f] = new Map();
      const prev = unitNcMapByFvs[f].get(key) || 0;
      unitNcMapByFvs[f].set(key, Math.max(prev, ncItems));
    }

    // 5) preencher metadados (ncCount)
    for (const k of Object.keys(fvsMetaById)) delete fvsMetaById[k];
    allFvsList.forEach(id => {
      const map = unitNcMapByFvs[id];
      const sum = map ? Array.from(map.values()).reduce((a,b)=>a+b,0) : 0;
      fvsMetaById[id] = { ncCount: sum };
    });

    // 6) render dropdown
    renderFvsDropdown(false);
  }catch(e){
    console.error(e);
    dropdown.innerHTML = '<option value="">Erro ao carregar FVS</option>';
  }
}

async function carregarDuracoesEFazerDraw(fvsSelecionada){
  showLoading();
  try{
    // 1) carrega estrutura
    if (!cache.estruturaJson) cache.estruturaJson = await loadJSON(ESTRUTURA_URL);
    const { colWidths, rowHeights, grid } = cache.estruturaJson;

    // 2) garantir apartamentos no cache
    if(!cache.apartamentos){
      const ra = await fetch(APARTAMENTOS_URL, { cache: 'no-store' });
      if(!ra.ok) throw new Error(`HTTP ${ra.status}`);
      cache.apartamentos = await ra.json();
    }

    // 3) rótulos por linha
    rowLabels = buildRowLabelsFromApartamentos(cache.estruturaJson, cache.apartamentos);

    const groups = groupCells(grid); // agrupamento por APARTAMENTO (base)

    // 4) filtra dados por FVS e monta os mapas
    currentFvs = fvsSelecionada || '';
    currentFvsItems = [];
    currentByApt = Object.create(null);
    currentByPav = Object.create(null);

    let duracoesMap = {};
    if(currentFvs){
      currentFvsItems = cache.apartamentos.filter(it => it.fvs === currentFvs);

      // Mapa por APT
      for(const item of currentFvsItems){
        const k = aptKey(item.apartamento);
        currentByApt[k] = item;
        duracoesMap[k] = {
          duracao_real: item.duracao_real,
          data_termino_inicial: item.data_termino_inicial,
          qtd_pend_ultima_inspecao: item.qtd_pend_ultima_inspecao || 0,
          qtd_nc_ultima_inspecao: item.qtd_nao_conformidades_ultima_inspecao || 0,
          percentual_ultima_inspecao: Number(item.percentual_ultima_inspecao) || null,
          pavimento_origem: item.pavimento_origem || null,
          duracao_inicial: item.duracao_inicial,
          reaberturas: item.reaberturas || [],
          id_ultima_inspecao: item.id_ultima_inspecao,
          id: item.id,
          data_abertura: item.data_abertura,
          termino_final: item.termino_final
        };
      }

      // Mapa por PAVIMENTO (representante por pavimento_origem)
      const bucket = Object.create(null); // pavId -> array de itens
      for (const it of currentFvsItems){
        const pavId = it.pavimento_origem;
        if (!pavId) continue;
        if (!bucket[pavId]) bucket[pavId] = [];
        bucket[pavId].push(it);
      }
      for (const pavId of Object.keys(bucket)){
        const arr = bucket[pavId];
        let best = arr[0];
        let bestCodigo = Number(arr[0]?.codigo_ultima_inspecao);
        for (let i=1;i<arr.length;i++){
          const cand = arr[i];
          const c = Number(cand.codigo_ultima_inspecao);
          if (Number.isFinite(c) && (!Number.isFinite(bestCodigo) || c > bestCodigo)){
            best = cand; bestCodigo = c;
          }
        }
        currentByPav[pavId] = best;
      }
    }

    // 5) desenha 2D
    draw(groups, duracoesMap, currentFvs, colWidths, rowHeights);

    // 6) se 3D está ativo, reconstrói conforme dados novos
    if (_3d.enabled) {
      build3DFromData();
      sync3DModeFromFVS();
      recolor3D();
    }
  }catch(e){
    document.getElementById('svg').innerHTML = `<text x="10" y="20" fill="#c9d1d9">Erro: ${e.message}</text>`;
  }finally{
    hideLoading();
  }
}

/* ===================== 3D ===================== */
function parseEstrutura3D(json){
  const rows = json.grid || [];
  const floors = [];
  for (let r=0;r<rows.length;r++){
    const line = rows[r];
    if (!line) continue;
    const tokens = line.slice(1,5);
    const special = new Set(["AT","LAZ","GAR","TER","vazio"]);
    if (tokens.every(t=> special.has(String(t)))){
      const tag = tokens.find(t=> t!=="vazio");
      floors.push({ type: String(tag||'LAJE'), apartments: [], label: String(tag||'LAJE'), rowIndex: r });
      continue;
    }
    const set = new Set();
    for (const t of tokens){
      const v = String(t).trim();
      if (!v || special.has(v)) continue;
      if (/^\d+$/.test(v)) set.add(v);
    }
    if (set.size===0) continue;
    const any = [...set][0];
    const floorNumber = Math.floor(parseInt(any,10)/100);
    floors.push({
      type: 'andar',
      label: rowLabels[r] || `${floorNumber}º`,
      rowIndex: r,
      apartments: [...set].map(id => ({ id, floor: floorNumber }))
    });
  }
  return floors;
}

function compute3DLayoutFromEstrutura(){
  const colW = cache.estruturaJson?.colWidths || [];
  // col 1..4 são úteis; usamos escala aproximada
  const SCALE = 0.05;
  _3d.frontWidth = ((colW[1]||60)+(colW[2]||60)) * SCALE;
  _3d.backWidth  = ((colW[3]||60)+(colW[4]||60)) * SCALE;
  _3d.cellDepth = 3.5;
  _3d.gap = 0.4;
  _3d.aptHeight = 3;
  _3d.floorGap = 0.3;
}

function lastDigit(apId){
  const s = String(apId).trim();
  return parseInt(s[s.length-1], 10);
}

// finais 1/2 = frente; 3/4 = fundo. Ímpar=esq, Par=dir
function positionFromAptFinal3D(apId){
  const d = lastDigit(apId);
  const isFront = (d===1 || d===2);
  const isLeft = (d%2===1);
  const halfFront = _3d.frontWidth/2;
  const halfBack  = _3d.backWidth/2;
  const x = isFront
    ? (isLeft ? -halfFront/2 : +halfFront/2)
    : (isLeft ? -halfBack/2  : +halfBack/2);
  const z = isFront ? -_3d.cellDepth/2 : +_3d.cellDepth/2;
  const label = `${isFront?'frente':'fundo'}-${isLeft?'esq':'dir'}`;
  return { x, z, isFront, label };
}

function colorForUnit(info){
  // mesma lógica do 2D
  let fill = '#6e7681'; // gray
  if (!info) return fill;

  const pend = Number(info.qtd_pend_ultima_inspecao || 0);
  const nc   = Number(info.qtd_nao_conformidades_ultima_inspecao || info.qtd_nc_ultima_inspecao || 0);
  const pct  = Number(info.percentual_ultima_inspecao);
  const terminouInicial = !!info.data_termino_inicial;

  if (ncMode) return (nc > 0) ? '#f85149' : fill;

  if (!terminouInicial) return '#1f6feb'; // azul

  const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
  return ultimaOK ? '#238636' : '#d29922';
}

async function init3D(){
  if (_3d.inited) return;
  if (!cache.estruturaJson) cache.estruturaJson = await loadJSON(ESTRUTURA_URL);
  if (!cache.apartamentos) cache.apartamentos = await loadJSON(APARTAMENTOS_URL);

  compute3DLayoutFromEstrutura();
  _3d.floorsParsed = parseEstrutura3D(cache.estruturaJson);

  // Cena
  _3d.scene = new THREE.Scene();
  _3d.scene.background = new THREE.Color('#0d1117');

  const aspect = window.innerWidth / window.innerHeight;
  _3d.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
  _3d.camera.position.set(14, 16, 22);

  _3d.renderer = new THREE.WebGLRenderer({ antialias:true });
  _3d.renderer.setSize(window.innerWidth, window.innerHeight);
  _3d.renderer.setPixelRatio(window.devicePixelRatio);
  _3d.renderer.shadowMap.enabled = true;
  _3d.appEl.innerHTML = '';
  _3d.appEl.appendChild(_3d.renderer.domElement);

  _3d.controls = new OrbitControls(_3d.camera, _3d.renderer.domElement);
  _3d.controls.target.set(0, 10, 0);
  _3d.controls.update();

  const hemi = new THREE.HemisphereLight('#c9d1d9', '#0a0c10', 0.6);
  _3d.scene.add(hemi);

  const dir = new THREE.DirectionalLight('#ffffff', 0.9);
  dir.position.set(10, 20, 10);
  dir.castShadow = true;
  _3d.scene.add(dir);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.5, 40),
    new THREE.MeshStandardMaterial({ color:'#11161c', roughness:0.9 })
  );
  base.position.y = -0.3;
  base.receiveShadow = true;
  _3d.scene.add(base);

  _3d.raycaster = new THREE.Raycaster();
  _3d.mouse = new THREE.Vector2();
  _3d.renderer.domElement.addEventListener('pointerdown', on3DPointerDown);

  window.addEventListener('resize', ()=>{
    _3d.camera.aspect = window.innerWidth / window.innerHeight;
    _3d.camera.updateProjectionMatrix();
    _3d.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // UI handlers
  _3d.floorRange.max = String(_3d.floorsParsed.length);
  _3d.floorRange.value = String(Math.min(5, _3d.floorsParsed.length));
  _3d.visibleFloors = parseInt(_3d.floorRange.value, 10);
  _3d.floorCountLabel.textContent = `${_3d.visibleFloors}/${_3d.floorsParsed.length}`;

  _3d.floorRange.addEventListener('input', ()=>{
    _3d.visibleFloors = parseInt(_3d.floorRange.value, 10);
    _3d.floorCountLabel.textContent = `${_3d.visibleFloors}/${_3d.floorsParsed.length}`;
    update3DVisibility();
  });
  _3d.explodeRange.addEventListener('input', ()=>{
    _3d.explode = parseFloat(_3d.explodeRange.value);
    update3DTransforms();
  });
  _3d.xrayBtn.addEventListener('click', ()=>{
    _3d.xray = !_3d.xray;
    _3d.xrayBtn.textContent = `Modo raio-X: ${_3d.xray ? 'on' : 'off'}`;
    update3DXray();
  });
  _3d.modeSel.addEventListener('change', ()=>{
    set3DMode(_3d.modeSel.value);
  });

  _3d.inited = true;
}

function start3DLoop(){
  if (_3d.animReq) return;
  const loop = () => {
    _3d.animReq = requestAnimationFrame(loop);
    _3d.renderer.render(_3d.scene, _3d.camera);
  };
  loop();
}
function stop3DLoop(){
  if (_3d.animReq) cancelAnimationFrame(_3d.animReq);
  _3d.animReq = 0;
}

function clear3DMeshes(){
  if (_3d.instApt){
    _3d.scene.remove(_3d.instApt);
    _3d.instApt.geometry.dispose();
    _3d.instApt.material.dispose();
    _3d.instApt = null;
  }
  if (_3d.instSlab){
    _3d.scene.remove(_3d.instSlab);
    _3d.instSlab.geometry.dispose();
    _3d.instSlab.material.dispose();
    _3d.instSlab = null;
  }
  _3d.metaApt.clear();
  _3d.metaSlab.clear();
}

function build3DFromData(){
  if (!_3d.inited) return;
  clear3DMeshes();

  // Recalcula layout (caso colWidths mudem)
  compute3DLayoutFromEstrutura();
  _3d.floorsParsed = parseEstrutura3D(cache.estruturaJson);

  build3DApartments();
  build3DSlabs();

  // modo inicial conforme FVS (sincronizado depois também)
  set3DMode('apartamento');
  update3DVisibility();
  recolor3D();
}

function build3DApartments(){
  const floorsOnly = _3d.floorsParsed.filter(f=> f.type === 'andar');
  const totalApts = floorsOnly.reduce((acc,f)=> acc + Math.max(1, f.apartments.length), 0);

  const geom = new THREE.BoxGeometry(
    (Math.max(_3d.frontWidth, _3d.backWidth)/2) - _3d.gap, // largura aproximada do apto por face
    _3d.aptHeight,
    _3d.cellDepth - _3d.gap
  );
  const mat  = new THREE.MeshStandardMaterial({ color:'#8b949e', roughness:0.8, metalness:0.05 });
  _3d.instApt = new THREE.InstancedMesh(geom, mat, totalApts);
  _3d.instApt.castShadow = true; _3d.instApt.receiveShadow = true;
  _3d.instApt.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let idx = 0;

  floorsOnly.forEach((f, fi)=>{
    const y = fi * (_3d.aptHeight + _3d.floorGap) + _3d.aptHeight/2;
    // usa apartamentos únicos
    const uniq = new Map();
    for (const ap of (f.apartments||[])) if (!uniq.has(ap.id)) uniq.set(ap.id, ap);
    for (const ap of uniq.values()){
      const pos = positionFromAptFinal3D(ap.id);
      dummy.position.set(pos.x, y, pos.z);
      dummy.rotation.set(0,0,0);
      dummy.updateMatrix();
      _3d.instApt.setMatrixAt(idx, dummy.matrix);

      const info = currentByApt[aptKey(ap.id)];
      _3d.instApt.setColorAt(idx, color.set(colorForUnit(info)));

      _3d.metaApt.set(idx, { id: ap.id, floor: f.label, posLabel: pos.label, isFront: pos.isFront });
      idx++;
    }
  });
  if (_3d.instApt.instanceColor) _3d.instApt.instanceColor.needsUpdate = true;
  _3d.scene.add(_3d.instApt);
}

function build3DSlabs(){
  const total = _3d.floorsParsed.length;
  const slabX = Math.max(_3d.frontWidth, _3d.backWidth) + _3d.gap;
  const slabZ = (_3d.cellDepth*2) + _3d.gap;

  const geom = new THREE.BoxGeometry(slabX, 0.4, slabZ);
  const mat  = new THREE.MeshStandardMaterial({ color:'#374151', roughness:0.9 });
  _3d.instSlab = new THREE.InstancedMesh(geom, mat, total);
  _3d.instSlab.castShadow = true; _3d.instSlab.receiveShadow = true;
  _3d.instSlab.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i=0;i<_3d.floorsParsed.length;i++){
    const y = i * (_3d.aptHeight + _3d.floorGap) + 0.2;
    dummy.position.set(0, y, 0);
    dummy.rotation.set(0,0,0);
    dummy.updateMatrix();
    _3d.instSlab.setMatrixAt(i, dummy.matrix);

    const f = _3d.floorsParsed[i];
    const c = f.type==='andar' ? '#374151'
            : (f.label==='LAZ' ? '#6b7280' : (f.label==='GAR' ? '#4b5563' : '#4b5563'));
    _3d.instSlab.setColorAt(i, color.set(c));
    _3d.metaSlab.set(i, { label: f.label || f.type, rowIndex: f.rowIndex });
  }
  if (_3d.instSlab.instanceColor) _3d.instSlab.instanceColor.needsUpdate = true;
  _3d.scene.add(_3d.instSlab);
}

function update3DTransforms(){
  if (!_3d.instApt) return;
  const dummy = new THREE.Object3D();
  let idx = 0;
  const floorsOnly = _3d.floorsParsed.filter(f=> f.type==='andar');
  floorsOnly.forEach((f, fi)=>{
    const y = fi * (_3d.aptHeight + _3d.floorGap) + _3d.aptHeight/2;
    const uniq = new Map();
    for (const ap of (f.apartments||[])) if (!uniq.has(ap.id)) uniq.set(ap.id, ap);
    for (const ap of uniq.values()){
      const pos = positionFromAptFinal3D(ap.id);
      const z = pos.z + (pos.isFront ? -_3d.explode : +_3d.explode);
      dummy.position.set(pos.x, y, z);
      dummy.rotation.set(0,0,0);
      dummy.updateMatrix();
      _3d.instApt.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
  });
  _3d.instApt.instanceMatrix.needsUpdate = true;
}

function update3DVisibility(){
  const dummy = new THREE.Object3D();

  if (_3d.instApt){
    let idx=0;
    const floorsOnly = _3d.floorsParsed.filter(f=> f.type==='andar');
    floorsOnly.forEach((f,fi)=>{
      const vis = (fi < _3d.visibleFloors);
      const uniqCount = new Map();
      for (const ap of (f.apartments||[])) if (!uniqCount.has(ap.id)) uniqCount.set(ap.id, ap);
      uniqCount.forEach(()=>{
        _3d.instApt.getMatrixAt(idx, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.position.y = vis ? (fi * (_3d.aptHeight + _3d.floorGap) + _3d.aptHeight/2) : -1000;
        dummy.updateMatrix();
        _3d.instApt.setMatrixAt(idx, dummy.matrix);
        idx++;
      });
    });
    _3d.instApt.instanceMatrix.needsUpdate = true;
  }

  if (_3d.instSlab){
    for (let i=0;i<_3d.floorsParsed.length;i++){
      const vis = (i < _3d.visibleFloors);
      _3d.instSlab.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.position.y = vis ? (i * (_3d.aptHeight + _3d.floorGap) + 0.2) : -1000;
      dummy.updateMatrix();
      _3d.instSlab.setMatrixAt(i, dummy.matrix);
    }
    _3d.instSlab.instanceMatrix.needsUpdate = true;
  }
}

function update3DXray(){
  [_3d.instApt, _3d.instSlab].forEach(mesh=>{
    if (!mesh) return;
    mesh.material.transparent = _3d.xray;
    mesh.material.opacity = _3d.xray ? 0.4 : 1.0;
    mesh.material.depthWrite = !_3d.xray;
    mesh.material.needsUpdate = true;
  });
}

function set3DMode(mode){
  if (!_3d.instApt || !_3d.instSlab) return;
  const aptVisible = (mode === 'apartamento');
  _3d.instApt.visible = aptVisible;
  _3d.instSlab.visible = !aptVisible;
  _3d.modeSel.value = mode;
}

function sync3DModeFromFVS(){
  if (!currentFvs) return;
  const m = modeByFvs[currentFvs] === 'pav' ? 'andar' : 'apartamento';
  set3DMode(m);
}

function recolor3D(){
  // recolorir apartamentos
  if (_3d.instApt){
    const color = new THREE.Color();
    for (let i=0;i<_3d.instApt.count;i++){
      const meta = _3d.metaApt.get(i);
      const info = meta ? currentByApt[aptKey(meta.id)] : null;
      _3d.instApt.setColorAt(i, color.set(colorForUnit(info)));
    }
    if (_3d.instApt.instanceColor) _3d.instApt.instanceColor.needsUpdate = true;
  }

  // recolorir lajes por pavimento usando representativo
  if (_3d.instSlab){
    const color = new THREE.Color();
    for (let i=0;i<_3d.instSlab.count;i++){
      const meta = _3d.metaSlab.get(i);
      let fill = '#374151';
      if (meta){
        // achar pavKey pelo primeiro apto da linha
        const row = cache.estruturaJson.grid[meta.rowIndex] || [];
        const ids = [];
        for (let c=1;c<=4;c++){
          const raw = normalizeCellLabel(row[c]);
          if (raw && raw.toLowerCase()!=='vazio' && /^\d+$/.test(raw)) ids.push(raw);
        }
        let pavKey = null;
        for (const ap of ids){
          const info = currentByApt[aptKey(ap)];
          if (info?.pavimento_origem){ pavKey = info.pavimento_origem; break; }
        }
        const infoPav = pavKey ? currentByPav[pavKey] : null;
        fill = colorForUnit(infoPav);
      }
      _3d.instSlab.setColorAt(i, color.set(fill));
    }
    if (_3d.instSlab.instanceColor) _3d.instSlab.instanceColor.needsUpdate = true;
  }
}

function on3DPointerDown(e){
  const rect = _3d.renderer.domElement.getBoundingClientRect();
  _3d.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _3d.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _3d.raycaster.setFromCamera(_3d.mouse, _3d.camera);

  const mode = _3d.modeSel.value;
  const obj = (mode === 'apartamento') ? _3d.instApt : _3d.instSlab;
  const hits = _3d.raycaster.intersectObject(obj, true);
  if (!hits.length) return;

  const id = hits[0].instanceId;
  if (mode === 'apartamento'){
    const m = _3d.metaApt.get(id);
    if (m) abrirModalDetalhes(m.id, currentFvs, '#8b949e');
  } else {
    const m = _3d.metaSlab.get(id);
    if (!m) return;

    // reunir aptos da linha pra passar ao modal
    const row = cache.estruturaJson.grid[m.rowIndex] || [];
    const ids = [];
    for (let c=1;c<=4;c++){
      const raw = normalizeCellLabel(row[c]);
      if (raw && raw.toLowerCase()!=='vazio' && /^\d+$/.test(raw)) ids.push(raw);
    }

    // pavKey (se houver)
    let pavKey = null;
    for (const ap of ids){
      const info = currentByApt[aptKey(ap)];
      if (info?.pavimento_origem){ pavKey = info.pavimento_origem; break; }
    }

    abrirModalDetalhesPavimento(pavKey, m.label, '#8b949e', ids);
  }
}
/* =================== FIM 3D =================== */
