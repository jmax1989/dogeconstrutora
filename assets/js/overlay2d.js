// ============================
// Overlay 2D (cards por apartamento)
// ============================

import { State } from './state.js';
import { normAptoId } from './utils.js';
import { pickFVSColor } from './colors.js';

// Elementos
let host = null;

// Fonte de dados injetável: lista de rows do apartamentos.json filtrada pela FVS atual
let getRowsForCurrentFVS = null;

/**
 * Injetar resolvedor de dados para a FVS ativa
 *   fn() => Array<row>
 */
export function setRowsResolver(fn){
  getRowsForCurrentFVS = (typeof fn === 'function') ? fn : null;
}

export function initOverlay2D(){
  host = document.getElementById('cards2d');
}

/** Mostra overlay 2D */
export function show2D(){
  if (!host) return;
  host.classList.add('active');
  host.style.pointerEvents = 'auto';
}

/** Oculta overlay 2D */
export function hide2D(){
  if (!host) return;
  host.classList.remove('active');
  host.style.pointerEvents = 'none';
}

/** Reconstrói a grade de cards conforme a FVS/NC/cores atuais */
export function render2DCards(){
  if (!host) return;

  const rows = getRowsForCurrentFVS ? (getRowsForCurrentFVS() || []) : [];
  // Se NC_MODE estiver ativo, podemos optar por ocultar cards “vazios” (sem NC/pend)
  const onlyProblems = !!State.NC_MODE;

  const frag = document.createDocumentFragment();
  const grid = document.createElement('div');
  grid.className = 'grid';

  for (const row of rows){
    const aptName = String(row.apartamento ?? row.apto ?? row.nome ?? '').trim();
    const pav     = String(row.pavimento_origem ?? '').trim();
    const idNorm  = normAptoId(aptName);
    if (!idNorm) continue;

    const color = pickFVSColor(aptName, pav, State.COLOR_MAP);

    const pend = Number(row.qtd_pend_ultima_inspecao ?? 0) || 0;
    const nc   = Number(row.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;

    // Se modo NC e não há problemas, podemos esconder ou mostrar como cinza + sem duração
    if (onlyProblems && (nc <= 0 && pend <= 0)) {
      continue; // esconder no 2D (fica mais limpo)
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.apto = aptName;
    card.dataset.pav  = pav;
    card.style.borderColor = color;
    card.style.boxShadow = `0 2px 10px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.03)`;

    // Conteúdo
    const h4 = document.createElement('h4');
    h4.textContent = aptName;
    card.appendChild(h4);

    const meta = document.createElement('div');
    meta.className = 'meta';

    // Percentual
    const pct = Number(row.percentual_ultima_inspecao ?? 0);
    const pctStr = isFinite(pct) ? `${pct}%` : '—';

    // Em NC mode, ocultar duração/percentual quando sem problemas
    const showNumbers = !(onlyProblems && (nc <= 0 && pend <= 0));

    meta.innerHTML = [
      `<span>Pav. ${pav || '—'}</span>`,
      showNumbers ? `<span>Percentual: ${pctStr}</span>` : '',
      showNumbers ? `<span>Pend.: ${pend}</span>` : '',
      showNumbers ? `<span>NC: ${nc}</span>` : ''
    ].filter(Boolean).join(' • ');
    card.appendChild(meta);

    // Clique nos cards aciona a mesma rota do 3D (o entry conectará esse handler)
    grid.appendChild(card);
  }

  frag.appendChild(grid);

  host.innerHTML = '';
  host.appendChild(frag);
}

/** Atualiza somente a coloração dos cards (sem reconstruir DOM) */
export function recolorCards2D(){
  if (!host) return;
  const cards = host.querySelectorAll('.card');
  cards.forEach(card=>{
    const apt = card.dataset.apto || '';
    const pav = card.dataset.pav || '';
    const color = pickFVSColor(apt, pav, State.COLOR_MAP);
    card.style.borderColor = color;
  });
}
