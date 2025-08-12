'use strict';

/* ===== Config ===== */
const DATA_BASE = 'https://dogeconstrutora.github.io/doge/data';
const FVS_LIST_URL = `${DATA_BASE}/fvs-list.json`;
const APARTAMENTOS_URL = `${DATA_BASE}/apartamentos.json`;
const ESTRUTURA_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYGuSxR-9vY5Uj7tIDEZXtyCaTLPuyklhHrBQEv0o1YdhLb_XYKazJnZDFpBfgmoHgqYq_Lbe1QWju/pub?output=csv';

const DEFAULT_CELL_WIDTH = 50;
const DEFAULT_CELL_HEIGHT = 30;

/* ===== DOM refs ===== */
const loadingDiv = document.getElementById('loading');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');
const modalCloseBtn = document.querySelector('#modal button.close-btn');

/* ===== Estado ===== */
const cache = { estruturaCsv:null, apartamentos:null };
let currentFvs = '';
let currentFvsItems = [];
let currentByApt = Object.create(null);

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

async function loadCSV(url){
  if(cache.estruturaCsv) return cache.estruturaCsv;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`HTTP status ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  const data = lines.map(line => line.split(',').map(cell => cell.trim()));
  cache.estruturaCsv = data;
  return data;
}

function expandRow(row){
  let lastValue = "";
  return row.map(cell => { if(cell) lastValue = cell; return lastValue; });
}

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

/* Desenho */
function draw(groups, duracoesMap, fvsSelecionada, colWidths, rowHeights){
  const svg = document.getElementById('svg');
  svg.innerHTML = '';

  const maxCols = groups.length ? Math.max(...groups.map(g => Math.max(...g.cells.map(c => c[1])))) + 1
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

  groups.forEach(group=>{
    if(group.value.toLowerCase()==='vazio') return;

    let minRow=Infinity, minCol=Infinity, maxRow=-1, maxCol=-1;
    for(const [r,c] of group.cells){
      if(r<minRow) minRow=r; if(c<minCol) minCol=c;
      if(r>maxRow) maxRow=r; if(c>maxCol) maxCol=c;
    }

    const x = cumX[minCol];
    const y = cumY[minRow];
    const width  = cumX[maxCol+1] - cumX[minCol];
    const height = cumY[maxRow+1] - cumY[minRow];

    const data = duracoesMap[group.value];
    let fillColor = getComputedStyle(document.documentElement).getPropertyValue('--gray') || '#6e7681';
    let textoCentro = '';
    if(data){
      textoCentro = `${data.duracao_real ?? ''}`;
      if(!data.data_termino_inicial){
        fillColor = '#1f6feb';
      }else{
        const pend = Number(data.qtd_pend_ultima_inspecao||0);
        fillColor = pend>0 ? '#d29922' : '#238636';
      }
    }

    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x",x); rect.setAttribute("y",y);
    rect.setAttribute("width",width); rect.setAttribute("height",height);
    rect.setAttribute("fill",fillColor); rect.setAttribute("class","cell");
    if(!data){ rect.classList.add('disabled'); }
    svg.appendChild(rect);

    const aptText = document.createElementNS("http://www.w3.org/2000/svg","text");
    aptText.setAttribute("x",x+3); aptText.setAttribute("y",y+3);
    aptText.setAttribute("class","apt-text"); aptText.textContent = group.value;
    svg.appendChild(aptText);

    const duracaoText = document.createElementNS("http://www.w3.org/2000/svg","text");
    duracaoText.setAttribute("x",x + width/2);
    duracaoText.setAttribute("y",y + height/2);
    duracaoText.setAttribute("class","duracao-text"); duracaoText.textContent = textoCentro;
    svg.appendChild(duracaoText);

    if (data) {
      rect.addEventListener('click', ()=> abrirModalDetalhes(group.value, fvsSelecionada, fillColor));
    }
  });

  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
}

async function abrirModalDetalhes(apartamento, fvsSelecionada, fillColor){
  applyModalTint(fillColor);

  modalContent.innerHTML = `<p>Carregando dados do apartamento ${apartamento}...</p>`;
  modalBackdrop.style.display = 'flex';
  lockScroll(true);
  try{
    const info = currentByApt[apartamento];
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

    const isAndamento = !info.data_termino_inicial;
    let progressMarkup = '';
    if (isAndamento) {
      const pct = Number(info.percentual_ultima_inspecao);
      if (!Number.isNaN(pct)) {
        progressMarkup = linearProgress(pct, 'var(--blue)');
      }
    }
    html += `<p class="line-progress"><span><strong>Duração inicial:</strong> ${info.duracao_inicial}</span>${progressMarkup}</p>`;

    if(info.reaberturas?.length){
      html += `<hr><table><tr><th>Código</th><th>Data Abertura</th><th>Pendências</th></tr>`;
      info.reaberturas.forEach(r=>{
        html += `<tr><td>${r.codigo ?? '-'}</td><td>${formatDateBR(r.data_abertura)}</td><td>${r.qtd_itens_pendentes}</td></tr>`;
      });
      html += `</table>`;
      html += `<p><strong>Duração reinspeções:</strong> ${info.duracao_reaberturas || 0}</p>`;
    }

    if(inmetaUrl){
      html += `
      <p>
        <a class="link-row" href="${inmetaUrl}" target="_blank" rel="noopener noreferrer">
          <span><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${pendUlt ?? '-'}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6"/>
            <path d="M10 14L21 3"/>
            <path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1-2-2h6"/>
          </svg>
        </a>
      </p>`;
    } else {
      html += `<p><strong>Última inspeção:</strong> código ${codUlt ?? '-'} | pendências ${pendUlt ?? '-'}</p>`;
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

/* Boot */
document.addEventListener('DOMContentLoaded', ()=>{
  resizeSvgArea();
  carregarFvs();
  document.getElementById('dropdown').addEventListener('change', e=>{
    carregarDuracoesEFazerDraw(e.target.value);
  });
  modalCloseBtn.addEventListener('click', fecharModal);
  modalBackdrop.addEventListener('click', e=>{ if(e.target === modalBackdrop) fecharModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && getComputedStyle(modalBackdrop).display==='flex') fecharModal(); });
});

/* Dados + draw */
async function carregarFvs(){
  const dropdown = document.getElementById('dropdown');
  dropdown.innerHTML = '<option value="">Carregando FVS...</option>';
  try{
    const res = await fetch(FVS_LIST_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP status ${res.status}`);
    const fvsList = await res.json();
    dropdown.innerHTML = '<option value="">-- Selecione uma FVS --</option>';
    for(const fvs of fvsList){
      const opt = document.createElement('option');
      opt.value = fvs; opt.textContent = fvs;
      dropdown.appendChild(opt);
    }
  }catch(e){
    dropdown.innerHTML = '<option value="">Erro ao carregar FVS</option>';
  }
}

async function carregarDuracoesEFazerDraw(fvsSelecionada){
  showLoading();
  try{
    const raw = await loadCSV(ESTRUTURA_CSV);

    const header = raw[0] || [];
    const GRID_START_COL = 2; // C
    const colWidthsRaw = header.slice(GRID_START_COL).map(v => formatFloat(v, DEFAULT_CELL_WIDTH));

    const body = raw.slice(1);
    const rowHeights = body.map(r => formatFloat(r[1], DEFAULT_CELL_HEIGHT));

    const grid = body
      .map(r => expandRow(r.slice(GRID_START_COL)))
      .map(row => row.map(normalizeCellLabel));

    const groups = groupCells(grid);

    currentFvs = fvsSelecionada || '';
    currentFvsItems = [];
    currentByApt = Object.create(null);

    let duracoesMap = {};
    if(currentFvs){
      if(!cache.apartamentos){
        const res = await fetch(APARTAMENTOS_URL, { cache: 'no-store' });
        if(!res.ok) throw new Error(`HTTP status ${res.status}`);
        cache.apartamentos = await res.json();
      }
      currentFvsItems = cache.apartamentos.filter(it => it.fvs === currentFvs);

      for(const item of currentFvsItems){
        currentByApt[item.apartamento] = item;
        duracoesMap[item.apartamento] = {
          duracao_real: item.duracao_real,
          data_termino_inicial: item.data_termino_inicial,
          qtd_pend_ultima_inspecao: item.qtd_pend_ultima_inspecao || 0,
          pavimento_origem: item.pavimento_origem || null
        };
      }
    }

    draw(groups, duracoesMap, currentFvs, colWidthsRaw, rowHeights);
  }catch(e){
    document.getElementById('svg').innerHTML = `<text x="10" y="20" fill="#c9d1d9">Erro: ${e.message}</text>`;
  }finally{
    hideLoading();
  }
}
