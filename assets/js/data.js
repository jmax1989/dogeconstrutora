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
 * @returns {Promise<void>}
 */
export async function loadAllData(){
  try{
    // Layout
    layoutData = await fetch(LAYOUT_URL, { cache: 'no-store' }).then(r=>r.json());

    // FVS + Apartamentos
    [fvsList, apartamentos] = await Promise.all([
      fetch(FVS_LIST_URL, { cache: 'no-store' }).then(r=>r.json()).catch(()=>[]),
      fetch(APTS_URL,     { cache: 'no-store' }).then(r=>r.json()).catch(()=>[])
    ]);
  }catch(err){
    console.error('[data] erro ao carregar dados:', err);
    layoutData   = { placements: [], meta:{} };
    fvsList      = [];
    apartamentos = [];
  }
}