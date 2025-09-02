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
  // 1) Detecta obra pela query string (?obra=PASTA_DA_OBRA)
  const obra = new URL(location.href).searchParams.get('obra') || '';

  // 2) Resolve caminhos (se obra existir, usa ./data/{obra}/..., senão mantém as constantes atuais)
  const base = obra ? `./data/${obra}` : null;
  const layoutUrl    = base ? `${base}/layout-3d.json`       : LAYOUT_URL;
  const fvsByObraUrl = base ? `${base}/fvs-list_by_obra.json`: null;        // preferencial
  const fvsUrl       = base ? `${base}/fvs-list.json`         : FVS_LIST_URL;
  const aptsUrl      = base ? `${base}/apartamentos.json`     : APTS_URL;

  // 3) Helper: tenta várias URLs e retorna o primeiro JSON válido
  async function fetchFirstJson(urls){
    for (const u of urls){
      if (!u) continue;
      try{
        const r = await fetch(u, { cache: 'no-store' });
        if (r.ok) return await r.json();
      }catch(_){ /* tenta próxima */ }
    }
    return []; // fallback
  }

  // 4) Helper p/ normalizar fvs-list (aceita novo e antigo)
  const normalizeFvsList = (raw) => {
    if (!raw) return [];
    // Formato novo: [{ alvo_id, fvs: [...] }, ...]
    if (Array.isArray(raw) && raw.length && raw[0] && typeof raw[0] === 'object' && Array.isArray(raw[0].fvs)){
      const all = [];
      for (const blk of raw){
        if (blk && Array.isArray(blk.fvs)) all.push(...blk.fvs);
      }
      // remove duplicadas preservando ordem
      return [...new Set(all.map(s => String(s)))];
    }
    // Formato antigo: ["FVS ...", ...]
    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === 'string')){
      return raw.map(String);
    }
    // Fallback: objeto com .fvs
    if (raw && Array.isArray(raw.fvs)) return raw.fvs.map(String);
    return [];
  };

  try{
    // Layout
    layoutData = await fetch(layoutUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { placements: [], meta:{} })
      .catch(() => ({ placements: [], meta:{} }));

    // FVS (tenta by_obra -> fvs-list da obra -> global)
    const fvsRaw = await fetchFirstJson([
      fvsByObraUrl,
      fvsUrl,
      FVS_LIST_URL
    ]);

    // Apartamentos
    const aptsRaw = await fetch(aptsUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .catch(() => []);

    fvsList      = normalizeFvsList(fvsRaw);
    apartamentos = Array.isArray(aptsRaw) ? aptsRaw : [];
  }catch(err){
    console.error('[data] erro ao carregar dados:', err);
    layoutData   = { placements: [], meta:{} };
    fvsList      = [];
    apartamentos = [];
  }
}
