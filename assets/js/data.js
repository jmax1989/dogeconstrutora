// ============================
// Data fetchers (layout / fvs / apartamentos)
// ============================

const LAYOUT_URL   = './data/layout-3d.json';
const FVS_LIST_URL = './data/fvs-list.json';
const APTS_URL     = './data/apartamentos.json';

export let layoutData   = null;
export let fvsList      = [];
export let apartamentos = [];

/**
 * Carrega todos os arquivos necessários em paralelo.
 * - Suporta estrutura por obra (?obra=PASTA) -> ./data/{obra}/...
 * - Mantém fallback para as URLs padrão (sem obra)
 * - Tenta primeiro fvs-list_by_obra.json; se não existir, usa fvs-list.json (obra) e depois global
 * - Normaliza fvs-list no formato novo ([{alvo_id, fvs: [...] }]) e antigo ([ "FVS ..." ])
 */
export async function loadAllData(){
  // 1) Detecta obra pela query string (?obra=PASTA_DA_OBRA) ou pelo cache
  const qs        = new URL(location.href).searchParams;
  const obraQS    = qs.get('obra') || '';
  const obraCache = localStorage.getItem('obraId') || '';
  const obra      = obraQS || obraCache;

  // Se vier pela QS, atualiza o cache
  if (obraQS) {
    try { localStorage.setItem('obraId', obraQS); } catch(_) {}
  }

  // 2) Se não houver obra definida ainda, devolve vazio (HUD abrirá o modal)
  if (!obra){
    layoutData   = { placements: [], meta:{} };
    fvsList      = [];
    apartamentos = [];
    return;
  }

  // 3) Caminhos por obra (sem fallbacks globais)
  const base        = `./data/${obra}`;
  const layoutUrl   = `${base}/layout-3d.json`;
  const fvsByObraUrl= `${base}/fvs-list_by_obra.json`;
  const aptsUrl     = `${base}/apartamentos.json`;

  // 4) Normalizador do fvs-list (suporta novo e antigo)
  const normalizeFvsList = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw) && raw.length && typeof raw[0] === 'object' && Array.isArray(raw[0].fvs)){
      const all = [];
      for (const blk of raw){ if (blk && Array.isArray(blk.fvs)) all.push(...blk.fvs); }
      return [...new Set(all.map(s => String(s)))];
    }
    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === 'string')){
      return raw.map(String);
    }
    if (raw && Array.isArray(raw.fvs)) return raw.fvs.map(String);
    return [];
  };

  try{
    // Layout (obrigatório por obra)
    layoutData = await fetch(layoutUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('layout-3d.json não encontrado')))
      .catch(err => {
        console.error('[data] layout:', err);
        return { placements: [], meta:{} };
      });

    // FVS (somente fvs-list_by_obra.json)
    const fvsRaw = await fetch(fvsByObraUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fvs-list_by_obra.json não encontrado')))
      .catch(err => {
        console.error('[data] fvs-list_by_obra:', err);
        return [];
      });

    // Apartamentos (somente por obra)
    const aptsRaw = await fetch(aptsUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('apartamentos.json não encontrado')))
      .catch(err => {
        console.error('[data] apartamentos:', err);
        return [];
      });

    fvsList      = normalizeFvsList(fvsRaw);
    apartamentos = Array.isArray(aptsRaw) ? aptsRaw : [];
  }catch(err){
    console.error('[data] erro ao carregar dados:', err);
    layoutData   = { placements: [], meta:{} };
    fvsList      = [];
    apartamentos = [];
  }
}

