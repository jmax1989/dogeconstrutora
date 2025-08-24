// ============================
// Modal (abrir/fechar + conteúdo + tint)
// ============================

import { formatDateBR, normAptoId } from './utils.js';
import { tintFromColor } from './colors.js';
import { State } from './state.js';

let backdrop, modal, titleEl, pillEl, contentEl, closeBtn;

// foco anterior para restaurar ao fechar
let lastFocused = null;

// ---------------
// Inicialização
// ---------------
export function initModal(){
  backdrop  = document.getElementById('doge-modal-backdrop');
  modal     = document.getElementById('doge-modal');
  titleEl   = document.getElementById('doge-modal-title');
  pillEl    = document.getElementById('doge-modal-pill');
  contentEl = document.getElementById('doge-modal-content');
  closeBtn  = document.getElementById('doge-modal-close');

  if (!backdrop || !modal) return;

  closeBtn?.addEventListener('click', closeModal, { passive:true });
  backdrop.addEventListener('click', (e)=>{
    if (e.target === backdrop) closeModal();
  }, { passive:true });

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && backdrop.classList.contains('show')){
      e.stopPropagation();
      closeModal();
    }
  });

  // trap de foco simples dentro do modal
  document.addEventListener('keydown', (e)=>{
    if (!backdrop.classList.contains('show')) return;
    if (e.key !== 'Tab') return;

    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;

    const first = focusables[0];
    const last  = focusables[focusables.length-1];
    if (e.shiftKey && document.activeElement === first){
      last.focus();
      e.preventDefault();
    }else if (!e.shiftKey && document.activeElement === last){
      first.focus();
      e.preventDefault();
    }
  });
}

// ---------------
// API pública
// ---------------
/**
 * Abre o modal de apartamento.
 * @param {Object} opts
 * @param {string} opts.id  - identificação do apto (ex.: "301")
 * @param {string|number|null} [opts.floor] - pavimento, se houver
 * @param {Object|null} [opts.row] - linha original do apartamentos.json (dados detalhados)
 * @param {string|null} [opts.tintHex] - cor base #rrggbb para tonalizar o header
 */
export function openAptModal({ id, floor=null, row=null, tintHex=null }){
  if (!modal || !backdrop) return;

  lastFocused = document.activeElement;

  const aptName = String(id || '').trim();
  const aptKey  = normAptoId(aptName);

  // Título
  titleEl.textContent = aptName || 'Apartamento';

  // Pill (pavimento + FVS atual)
  const pav = (floor != null) ? String(floor) : String(row?.pavimento_origem ?? '');
  const fvs = State.CURRENT_FVS || '';
  pillEl.textContent = [pav && `Pav. ${pav}`, fvs].filter(Boolean).join(' • ');

  // Tint do header conforme a cor ativa (se não vier explícito)
  if (!tintHex){
    // escolha de cor deve ter sido calculada previamente; se não, usar default do COLOR_MAP
    tintHex = State.COLOR_MAP?.colors?.[aptKey] || State.COLOR_MAP?.default || '#6e7681';
  }
  applyModalTint(tintHex);

  // Conteúdo
  renderModalContent({ id: aptName, floor: pav, row });

  // Mostrar
  backdrop.classList.add('show');
  backdrop.setAttribute('aria-hidden','false');
  setTimeout(()=> closeBtn?.focus(), 0);
}

/** Fecha o modal e restaura foco */
export function closeModal(){
  if (!backdrop) return;
  backdrop.classList.remove('show');
  backdrop.setAttribute('aria-hidden','true');
  if (lastFocused && typeof lastFocused.focus === 'function'){
    setTimeout(()=> lastFocused.focus(), 0);
  }
}

/** Aplica tonalidade ao header do modal (vidro colorido sutil) */
export function applyModalTint(hex){
  const header = modal?.querySelector('header');
  if (!header) return;
  header.style.background = tintFromColor(hex, 0.22);
}

// ---------------
// Renderização do conteúdo
// ---------------
function renderModalContent({ id, floor, row }){
  if (!contentEl) return;

  // Helpers de formatação
  const fmt = {
    int: v => (v==null || v==='') ? '—' : String(v),
    date: v => v ? formatDateBR(v) : '—',
    bool: b => (b ? 'Sim' : 'Não')
  };

  // Campos previstos no apartamentos.json
  const pct       = row?.percentual_ultima_inspecao ?? null;
  const pend      = row?.qtd_pend_ultima_inspecao ?? null;
  const ncs       = row?.qtd_nao_conformidades_ultima_inspecao ?? null;
  const andamento = !!row?.em_andamento;

  const abertura  = row?.data_abertura ? String(row.data_abertura).slice(0,10) : '';
  const terminoI  = row?.data_termino_inicial ? String(row.data_termino_inicial).slice(0,10) : '';
  const terminoF  = row?.termino_final ? String(row.termino_final).slice(0,10) : '';

  // Reaberturas (array de datas)
  const reab = Array.isArray(row?.reaberturas) ? row.reaberturas : [];

  // Montagem do HTML
  contentEl.innerHTML = `
    <section class="row">
      <div>
        <h4>Identificação</h4>
        <div class="kv"><b>Apartamento:</b> <span>${id || '—'}</span></div>
        <div class="kv"><b>Pavimento:</b> <span>${floor || '—'}</span></div>
        <div class="kv"><b>FVS:</b> <span>${State.CURRENT_FVS || '—'}</span></div>
      </div>
    </section>

    <section class="row">
      <div>
        <h4>Status</h4>
        <div class="kv"><b>Percentual:</b> <span>${pct!=null ? `${pct}%` : '—'}</span></div>
        <div class="kv"><b>Pendências:</b> <span>${fmt.int(pend)}</span></div>
        <div class="kv"><b>Não-conformidades:</b> <span>${fmt.int(ncs)}</span></div>
        <div class="kv"><b>Em andamento:</b> <span>${fmt.bool(andamento)}</span></div>
      </div>
    </section>

    <section class="row">
      <div>
        <h4>Datas</h4>
        <div class="kv"><b>Abertura:</b> <span>${fmt.date(abertura)}</span></div>
        <div class="kv"><b>Término inicial:</b> <span>${fmt.date(terminoI)}</span></div>
        <div class="kv"><b>Término final:</b> <span>${fmt.date(terminoF)}</span></div>
      </div>
    </section>

    <section class="row">
      <div>
        <h4>Reaberturas</h4>
        ${
          reab.length
            ? `<ul class="list">${reab.map(d => `<li>${fmt.date(String(d).slice(0,10))}</li>`).join('')}</ul>`
            : `<div class="kv"><span>—</span></div>`
        }
      </div>
    </section>
  `;
}
