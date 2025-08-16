'use strict';

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
let currentByApt = Object.create(null);   // <- indexado por aptKey(...)
let currentByPav = Object.create(null);   // <- NOVO: indexado por pavimento_origem
let ncMode = false; // modo destaque de Não Conformidades

// Metadados de FVS para filtro NC
let allFvsList = [];
const fvsMetaById = Object.create(null);

// NOVO: modo da FVS ('apt' | 'pav')
let modeByFvs = Object.create(null);

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
  // remove acentos
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  // remove prefixos comuns
  t = t.replace(/\b(APARTAMENTO|APTO|AP|APT|APART)\b\.?/g, '');
  // remove separadores comuns (espaço, hífen, underline, ponto, barra)
  t = t.replace(/[\s\-\._\/]/g, '');
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

/* ===== (NOVO) Agrupamento por pavimento ===== */
/** Cria um único grupo por linha (andar), cobrindo do primeiro ao último bloco ocupado. */
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
      groups.push({ value:`Pavimento ${r}`, floorIndex:r, cells });
    }
  }
  return groups;
}

/* ===== Desenho ===== */
function draw(groupsApt, duracoesMap, fvsSelecionada, colWidths, rowHeights){
  const svg = document.getElementById('svg');
  svg.innerHTML = '';

  // Determina se a FVS atual é por pavimento
  const isPav = !!(currentFvs && modeByFvs[currentFvs] === 'pav');

  // Se for pavimento, gera grupos por linha (andar); senão, usa agrupamento normal por apartamento
  const groups = isPav ? (()=>{
    // Precisamos da grid para calcular os grupos por pavimento
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
      // ===== MODO APARTAMENTO (como antes) =====
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
            fillColor = '#1f6feb'; // azul (em andamento)
          } else {
            const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
            fillColor = ultimaOK ? '#238636' : '#d29922'; // verde : amarelo
          }
        }
        podeClicar = true;
      }

      // Elemento:
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
      // ===== MODO PAVIMENTO (NOVO) =====
      // Descobre os apartamentos presentes no retângulo do andar
      const grid = cache.estruturaJson?.grid || [];
      const r = group.floorIndex;
      const aptosDoAndar = new Set();
      for(let c=minCol; c<=maxCol; c++){
        const raw = grid[r]?.[c];
        const lab = normalizeCellLabel(raw);
        if(lab && lab.toLowerCase()!=='vazio') aptosDoAndar.add(lab);
      }
      const aptList = Array.from(aptosDoAndar);

      // Descobrir o pavimento_origem (pega do primeiro apê com dado carregado)
      let pavId = null;
      for (const apt of aptList){
        const info = currentByApt[aptKey(apt)];
        if (info?.pavimento_origem){
          pavId = info.pavimento_origem;
          break;
        }
      }
      // Dados do pavimento (agregado/representativo)
      const pavData = pavId ? currentByPav[pavId] : null;

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
        podeClicar = true;
      }

      const g = document.createElementNS(svgNS, "g");
      g.dataset.pav = pavId || `floor-${r}`;
      if (podeClicar) {
        g.style.cursor = 'pointer';
        const titulo = pavId ? `Abrir detalhes: ${pavId}` : `Abrir detalhes: Pavimento ${r}`;
        g.setAttribute('title', titulo);
        g.addEventListener('click', ()=> abrirModalDetalhesPavimento(pavId || `Pavimento ${r}`, fillColor, aptList));
      } else {
        g.classList.add('disabled');
      }

      const rect = document.createElementNS(svgNS,"rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y);
      rect.setAttribute("width",width); rect.setAttribute("height",height);
      rect.setAttribute("fill",fillColor); rect.setAttribute("class","cell");
      g.appendChild(rect);

      const label = pavId || group.value;
      const aptText = document.createElementNS(svgNS,"text");
      aptText.setAttribute("x",x+3); aptText.setAttribute("y",y+3);
      aptText.setAttribute("class","apt-text"); aptText.textContent = label;
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
    const info = currentByApt[aptKey(apartamento)]; // <- usa chave normalizada
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

    // NC da última inspeção (campo de topo; fallback: última reabertura)
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
        if (ta !== tb) return ta - tb;            // por data (ASC)
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

/* ===== (NOVO) Modal PAVIMENTO ===== */
function abrirModalDetalhesPavimento(pavId, fillColor, aptosDoAndar){
  applyModalTint(fillColor);

  modalContent.innerHTML = `<p>Carregando dados do ${pavId}...</p>`;
  modalBackdrop.style.display = 'flex';
  lockScroll(true);

  try{
    const info = currentByPav[pavId] || null;

    let html = `<h3 style="margin:0 0 8px 0;">${pavId}</h3>`;
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

    // NC (igual ao apto)
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
        if (ta !== tb) return ta - tb;            // por data (ASC)
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
    carregarDuracoesEFazerDraw(e.target.value);
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
      carregarDuracoesEFazerDraw(currentFvs);
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

    // 3) detectar modo por FVS (NOVO → agora vai para a variável global modeByFvs)
    modeByFvs = Object.create(null); // reset
    for (const it of cache.apartamentos) {
      const f = it.fvs;
      if (!f) continue;
      const isPav = !!it.pavimento_origem;
      if (!modeByFvs[f]) modeByFvs[f] = isPav ? 'pav' : 'apt';
      if (!isPav) modeByFvs[f] = 'apt';
    }

    // 4) somar NCs por unidade deduplicada (mantém sua lógica)
    const unitNcMapByFvs = Object.create(null); // { fvsId: Map(unitKey -> nc) }
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
    // 1) carrega estrutura do próprio site
    if (!cache.estruturaJson) cache.estruturaJson = await loadJSON(ESTRUTURA_URL);
    const { colWidths, rowHeights, grid } = cache.estruturaJson;

    const groups = groupCells(grid); // agrupamento por APARTAMENTO (base)

    // 2) filtra dados por FVS e monta os mapas
    currentFvs = fvsSelecionada || '';
    currentFvsItems = [];
    currentByApt = Object.create(null);
    currentByPav = Object.create(null); // NOVO

    let duracoesMap = {};
    if(currentFvs){
      if(!cache.apartamentos){
        const res = await fetch(APARTAMENTOS_URL, { cache: 'no-store' });
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        cache.apartamentos = await res.json();
      }
      currentFvsItems = cache.apartamentos.filter(it => it.fvs === currentFvs);

      // Mapa por APT (como antes)
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

      // NOVO: Mapa por PAVIMENTO (representante por pavimento_origem)
      // Como a FVS por pavimento replica a mesma info, qualquer item serve de representante.
      // Abaixo escolho o com maior "codigo" (quando existir), senão o primeiro.
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

    // 3) desenha (draw decide se usa grupos por APTO ou por PAV)
    draw(groups, duracoesMap, currentFvs, colWidths, rowHeights);
  }catch(e){
    document.getElementById('svg').innerHTML = `<text x="10" y="20" fill="#c9d1d9">Erro: ${e.message}</text>`;
  }finally{
    hideLoading();
  }
}
