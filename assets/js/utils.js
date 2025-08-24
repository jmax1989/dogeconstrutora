// ============================
// Utils gerais do Viewer DOGE
// ============================

// Clamp genérico
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Normalização ÚNICA de IDs de apartamentos
export function normAptoId(s) {
  if (s == null) return '';
  let t = String(s).trim().toUpperCase();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,'');   // remove acentos
  t = t.replace(/\b(APARTAMENTO|APTO|AP|APT|APART)\b\.?/g, ''); // remove sufixos
  t = t.replace(/[\s\-\._\/]/g, ''); // remove separadores
  return t;
}

// Atalhos de compatibilidade (se alguém chamar pelo nome antigo)
export const normAptoKey = normAptoId;
export const normApto    = normAptoId;

// Formatação de data (yyyy-mm-dd → dd/mm/yyyy)
export function formatDateBR(dateStr){
  if(!dateStr) return "";
  const parts = String(dateStr).split('-');
  if(parts.length<3) return dateStr;
  const yyyy = parseInt(parts[0],10);
  const mm = parseInt(parts[1],10)-1;
  const dd = parseInt(parts[2].substring(0,2),10);
  const d = new Date(yyyy,mm,dd);
  if(isNaN(d)) return dateStr;
  return `${String(dd).padStart(2,'0')}/${String(mm+1).padStart(2,'0')}/${yyyy}`;
}

// Tooltip helpers (reutilizáveis)
let tipEl = null;
let tipVisible = false;
let tipHideTO = null;

export function initTooltip(){
  tipEl = document.getElementById('doge-tip');
}

export function showTip(x, y, text){
  if (!tipEl) return;
  tipEl.textContent = text || '';
  if (!text) { hideTip(); return; }

  // posiciona (protege bordas)
  const pad = 10;
  const W = innerWidth, H = innerHeight;
  let tx = Math.max(pad, Math.min(W - pad, x));
  let ty = Math.max(pad, Math.min(H - pad, y));
  tipEl.style.left = tx + 'px';
  tipEl.style.top  = ty + 'px';

  tipEl.classList.add('show');
  tipEl.setAttribute('aria-hidden','false');
  tipVisible = true;

  if (tipHideTO) { clearTimeout(tipHideTO); tipHideTO = null; }
}

export function hideTip(delay=0){
  if (!tipEl || !tipVisible) return;
  if (tipHideTO) clearTimeout(tipHideTO);
  tipHideTO = setTimeout(()=>{
    tipEl.classList.remove('show');
    tipEl.setAttribute('aria-hidden','true');
    tipVisible = false;
  }, delay);
}
