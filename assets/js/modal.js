// modal.js
// Modal de detalhes do apartamento (abre no próprio viewer, sem iframe)

import { State } from './state.js';
import { apartamentos } from './data.js';
import { normAptoId } from './utils.js';

// refs DOM
let _backdrop, _modal, _title, _pill, _content, _closeBtn;

// guard contra "ghost-click" (tap abre modal e clica no link que surgiu no mesmo lugar)
let _openTs = 0;
const GHOST_GUARD_MS = 450;

export function initModal(){
  _backdrop = document.getElementById('doge-modal-backdrop');
  _modal    = document.getElementById('doge-modal');
  _title    = document.getElementById('doge-modal-title');
  _pill     = document.getElementById('doge-modal-pill');
  _content  = document.getElementById('doge-modal-content');
  _closeBtn = document.getElementById('doge-modal-close');

  if (!_backdrop || !_modal) return;

  // estado inicial
  _backdrop.style.display = 'none';
  _modal.style.display    = 'none';

  // clique fora fecha
  _backdrop.addEventListener('click', (e)=>{
    if (e.target === _backdrop) closeModal();
  });

  // fechar no botão
  _closeBtn?.addEventListener('click', closeModal);

  // fechar no ESC
  window.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && isOpen()) closeModal();
  });

  // Anti-ghost-click dentro do modal:
  // - bloqueia clique em links nos primeiros N ms após abrir
  // - e ainda impede o primeiro clique se estivermos no período de guarda
  _modal.addEventListener('click', (e)=>{
    const a = e.target.closest?.('a');
    if (!a) return;
    const now = performance.now();
    if (now - _openTs < GHOST_GUARD_MS){
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  // evita bubbling do link para o backdrop
  _modal.addEventListener('click', (e)=>{
    if (e.target.closest?.('a')) {
      e.stopPropagation();
    }
  });
}

function isOpen(){
  return _backdrop && _backdrop.style.display !== 'none';
}

export function closeModal(){
  if (!_backdrop || !_modal) return;
  _backdrop.style.display = 'none';
  _modal.style.display    = 'none';
}

// =========================
// Helpers visuais
// =========================
function hexToRgb(hex){
  const m = String(hex||'').replace('#','').match(/^([0-9a-f]{6})$/i);
  if (!m) return { r:88, g:166, b:255 }; // fallback azul
  const n = parseInt(m[1],16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function tintFromColor(hex){
  const {r,g,b} = hexToRgb(hex || '#58a6ff');
  return `linear-gradient(to bottom, rgba(${r},${g},${b},.12), rgba(0,0,0,0) 40%)`;
}
function setModalTint(hex){
  const el = _modal;
  if (!el) return;
  const {r,g,b} = hexToRgb(hex || '#58a6ff');
  el.style.setProperty('--modal-tint-strong', `rgba(${r},${g},${b},0.20)`);
  el.style.setProperty('--modal-tint-soft',   `rgba(${r},${g},${b},0.10)`);
  el.style.setProperty('--modal-border',      `rgba(${r},${g},${b},0.28)`);
}
function formatDateBR(dateStr){
  if(!dateStr) return '';
  const p = String(dateStr).split('-');
  if (p.length<3) return dateStr;
  const yyyy = +p[0], mm = (+p[1])-1, dd = +(p[2].slice(0,2));
  const d = new Date(yyyy, mm, dd);
  if (isNaN(d)) return dateStr;
  return `${String(dd).padStart(2,'0')}/${String(mm+1).padStart(2,'0')}/${yyyy}`;
}
function getUltimaInspecaoInfo(reaberturas){
  if(!Array.isArray(reaberturas)||reaberturas.length===0){
    return { codigo_ultima_inspecao:null, qtd_pend_ultima_inspecao:0 };
  }
  let best=null;
  for (const r of reaberturas){
    const c = Number(r.codigo);
    if(!Number.isNaN(c)){
      if(!best || c>best.c) best = { c, q:Number(r.qtd_itens_pendentes)||0 };
    }
  }
  if(best) return { codigo_ultima_inspecao:String(best.c), qtd_pend_ultima_inspecao:best.q };
  const last = reaberturas[reaberturas.length-1];
  return { codigo_ultima_inspecao: last.codigo ?? null, qtd_pend_ultima_inspecao: Number(last.qtd_itens_pendentes) || 0 };
}
function linearProgress(pct, color){
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const c = color || 'var(--blue)';
  return `
    <span class="q-linear-progress q-linear-progress--sm" style="color:${c}">
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

// =========================
// openAptModal
// =========================
export function openAptModal({ id, floor=null, row=null, tintHex=null }){
  if (!_modal || !_backdrop) return;

  const aptName = String(id||'').trim();
  const keyNorm = normAptoId(aptName);

  // resolve row se não vier pronta
  let r = row;
  if (!r){
    const fvs = State.CURRENT_FVS || '';
    if (fvs && Array.isArray(apartamentos)){
      r = apartamentos
        .filter(x => String(x.fvs||'').trim() === fvs)
        .find(x => normAptoId(String(x.apartamento ?? x.apto ?? x.nome ?? '')) === keyNorm) || null;
    }
  }

  // Título e cor/tinta (usa pick da FVS atual; se não tiver, usa tintHex ou fallback)
  const hex = (typeof State.pickFVSColor === 'function')
    ? State.pickFVSColor(aptName, floor ?? r?.pavimento_origem ?? null)
    : (tintHex || '#58a6ff');

  _title.textContent = aptName || 'Apartamento';
  setModalTint(hex);
  _modal.querySelector('header').style.background = tintFromColor(hex);

  // Se não achou row, abre simples
  if (!r){
    _pill.textContent = '';
    _content.innerHTML = `<p>Sem dados para o apartamento ${aptName}.</p>`;
    showModalWithGuard();
    return;
  }

  // Campos (espelha o index)
  let codUlt = r.codigo_ultima_inspecao;
  let pendUlt = r.qtd_pend_ultima_inspecao;
  if (codUlt == null){
    const aux = getUltimaInspecaoInfo(r.reaberturas);
    codUlt  = aux.codigo_ultima_inspecao;
    pendUlt = aux.qtd_pend_ultima_inspecao;
  }

  // NC da última inspeção
  let ncUlt = r.qtd_nao_conformidades_ultima_inspecao;
  if (ncUlt == null && Array.isArray(r.reaberturas) && r.reaberturas.length){
    const lastReab = r.reaberturas[r.reaberturas.length - 1];
    ncUlt = Number(lastReab.qtd_nao_conformidades);
  }

  const idLink = r.id_ultima_inspecao || r.id;
  const inmetaUrl = idLink
    ? `https://app.inmeta.com.br/app/360/servico/inspecoes/realizadas?inspecao=${encodeURIComponent(idLink)}`
    : null;

  _pill.textContent = (r.duracao_real != null)
    ? `Duração: ${r.duracao_real} dia${Number(r.duracao_real)===1?'':'s'}`
    : (r.percentual_ultima_inspecao != null ? `Progresso: ${r.percentual_ultima_inspecao}%` : '');

  let html = '';
  html += `<p><strong>Apartamento:</strong> ${r.apartamento}</p>`;
  if (r.pavimento_origem){
    html += `<p><strong>Pavimento origem:</strong> ${r.pavimento_origem}</p>`;
  }
  html += `<p><strong>Início:</strong> ${formatDateBR(r.data_abertura)}</p>`;
  if (r.data_termino_inicial){
    html += `<p><strong>Término:</strong> ${formatDateBR(r.data_termino_inicial)}</p>`;
  }

  // progress (azul = sem término; amarelo = terminou inicial mas ainda pendências/NC ou pct<100)
  const pct = Number(r.percentual_ultima_inspecao);
  if (!Number.isNaN(pct)){
    const isBlue = !r.data_termino_inicial;
    const hasPendOrNc = (Number(r.qtd_pend_ultima_inspecao||0)>0) || (Number(ncUlt||0)>0) || pct<100;
    const color = isBlue ? 'var(--blue)' : (hasPendOrNc ? 'var(--yellow)' : 'var(--green)');
    html += `<p class="line-progress"><span><strong>Duração inicial:</strong> ${r.duracao_inicial}</span>${linearProgress(pct, color)}</p>`;
  } else {
    html += `<p><strong>Duração inicial:</strong> ${r.duracao_inicial ?? '-'}</p>`;
  }

  if (ncUlt != null && !Number.isNaN(Number(ncUlt)) && Number(ncUlt) > 0){
    html += `<p><strong>Não conformidades:</strong> ${Number(ncUlt)}</p>`;
  }

  // reinspeções (ordenadas)
  if (r.reaberturas?.length){
    const toTime = (d)=> {
      const [yy, mm, dd] = (d || '').split('-').map(x => parseInt(x,10));
      const t = new Date(yy, (mm||1)-1, dd||1).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const reabs = [...r.reaberturas].sort((a,b)=>{
      const ta = toTime(a.data_abertura), tb = toTime(b.data_abertura);
      if (ta !== tb) return ta - tb;
      const pa = Number(a.qtd_itens_pendentes)||0;
      const pb = Number(b.qtd_itens_pendentes)||0;
      if (pa !== pb) return pa - pb;
      const na = Number(a.qtd_nao_conformidades)||0;
      const nb = Number(b.qtd_nao_conformidades)||0;
      if (na !== nb) return na - nb;
      return String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'pt-BR', { numeric: true });
    });

    html += `<hr><table><tr><th>Código</th><th>Data Abertura</th><th>Pendências</th><th>Não conformidades</th></tr>`;
    reabs.forEach(rr=>{
      html += `<tr>
        <td>${rr.codigo ?? '-'}</td>
        <td>${formatDateBR(rr.data_abertura)}</td>
        <td>${rr.qtd_itens_pendentes}</td>
        <td>${rr.qtd_nao_conformidades ?? '-'}</td>
      </tr>`;
    });
    html += `</table>`;
    html += `<p><strong>Duração reinspeções:</strong> ${r.duracao_reaberturas || 0}</p>`;
  }

  // link inmeta — com data-attr para inspeção do guard (sem mudanças visuais)
  if (inmetaUrl){
    html += `
    <p>
      <a class="link-row" href="${inmetaUrl}" target="_blank" rel="noopener noreferrer" data-safe-link="1">
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

  html += `<p><strong>Duração total:</strong> ${r.duracao_real ?? '-'}</p>`;
  if (r.termino_final){
    html += `<p><strong>Término final:</strong> ${formatDateBR(r.termino_final)}</p>`;
  }

  _content.innerHTML = html;
  animateProgressBars(_content);

  showModalWithGuard();
}

// mostra modal e ativa “janela de guarda” que bloqueia cliques iniciais em links
function showModalWithGuard(){
  _openTs = performance.now();

  // 1) abre
  _backdrop.style.display = 'flex';
  _modal.style.display    = 'block';

  // 2) protege conteúdo por alguns ms para impedir o primeiro click automático
  _content.style.pointerEvents = 'none';
  setTimeout(()=>{ _content.style.pointerEvents = ''; }, GHOST_GUARD_MS);

  // 3) força reflow para CSS transitions do progress etc.
  void _modal.offsetHeight;
}
