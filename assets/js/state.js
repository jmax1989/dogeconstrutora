// ============================
// Estado global + Prefs (QS / LocalStorage)
// ============================
// em algum lugar do init do State
export const STORAGE_KEYS = {
  FVS: 'doge.viewer.fvs',
  NC:  'doge.viewer.nc',
};

export const State = {
  CURRENT_FVS: '',
  NC_MODE: false,
  COLOR_MAP: { default: '#6e7681', colors: {}, byFloor: {} },
  META_MAP: new Map(),

  // Seleção e modal
  __SEL_GROUP__: null,

  // Orbit/câmera
  radius: 28,
  theta: Math.PI * 0.25,
  phi: Math.PI * 0.35,
  orbitTarget: null,

  // Explode/opacidade/2D
  faceOpacity: 0.30,
  explodeXY: 0,
  explodeY: 0,
  flatten2D: 0
};

// ----------------------
// Query string helpers
// ----------------------
export function getQS(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
export function setQS(updates){
  const u = new URL(location.href);
  for (const [k,v] of Object.entries(updates)){
    if (v == null || v === '' || v === false) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  history.replaceState(null, '', u.toString());
}

// ----------------------
// Prefs (localStorage)
// ----------------------
export function savePrefs(){
  try{
    if (State.CURRENT_FVS) localStorage.setItem(STORAGE_KEYS.FVS, State.CURRENT_FVS);
    localStorage.setItem(STORAGE_KEYS.NC, String(!!State.NC_MODE));
  }catch(_){}
}

export function loadPrefs(){
  let fvs = null, nc = null;
  try{
    fvs = localStorage.getItem(STORAGE_KEYS.FVS);
    nc  = localStorage.getItem(STORAGE_KEYS.NC);
  }catch(_){}
  return {
    fvs: fvs || '',
    nc : (nc === 'true')
  };
}
State.grid2DRows = State.grid2DRows ?? 8; 
