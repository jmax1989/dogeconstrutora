// ============================
// Regras de cor / Color Map
// ============================

import { normNameKey, clamp } from './utils.js';
import { State } from './state.js';

export const COLOR_DEFAULT = '#6b7280';  // cinza neutro (tema dark)
export const PALETTE = {
  green:  '#3fb950',
  yellow: '#e3b341',
  orange: '#f0883e',
  red:    '#f85149',
  blue:   '#4493f8',
  gray:   COLOR_DEFAULT
};

// ------------------------------------------------------------------
// Heurísticas de status -> cor
// Campos usuais: percentual_ultima_inspecao, qtd_pend_ultima_inspecao,
// qtd_nao_conformidades_ultima_inspecao, data_termino_inicial, pavimento_origem.
// ------------------------------------------------------------------

// === NORMAL ===
export function colorFromRowNormal(row){
  if (!row) return PALETTE.gray;

  const nc   = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;
  const pend = Number(row?.qtd_pend_ultima_inspecao ?? 0) || 0;
  const pct  = Number(row?.percentual_ultima_inspecao);
  const terminouInicial = !!row?.data_termino_inicial;

  // Em andamento → azul (ainda não tem término inicial)
  if (!terminouInicial) return PALETTE.blue;

  // Concluído 100% sem pend/NC → verde; senão → amarelo
  const ultimaOK = (pct === 100 && pend === 0 && nc === 0);
  return ultimaOK ? PALETTE.green : PALETTE.yellow;
}

// === MODO NC ===
export function colorFromRowNC(row){
  const nc = Number(row?.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;
  return (nc > 0) ? PALETTE.red : COLOR_DEFAULT; // sem NC → neutro
}

// ------------------------------------------------------------------
// Color map por FVS (NORMAL)
// Agora a chave principal é `local_origem` (quando disponível), com
// fallback para `nome` (layout-3d.json), depois `apartamento`/apto/id/name.
// ------------------------------------------------------------------
export function buildColorMapForFVS(rows){
  const map = { default: COLOR_DEFAULT, colors: {}, byFloor: {} };
  if (!Array.isArray(rows)) return map;

  for (const r of rows){
    const key = normNameKey(
      r?.local_origem ?? r?.nome ?? r?.apartamento ?? r?.apto ?? r?.id ?? r?.name ?? ''
    );
    if (!key) continue;
    map.colors[key] = colorFromRowNormal(r);
  }

  // por pavimento: working > pending > done > default
  const agg = new Map(); // pav → {working,pending,done}
  for (const r of rows){
    const pav = (r?.pavimento_origem != null) ? String(r.pavimento_origem) : null;
    if (!pav) continue;
    const col = colorFromRowNormal(r);
    const o = agg.get(pav) || { working:0, pending:0, done:0 };
    if (col === PALETTE.blue)        o.working++;
    else if (col === PALETTE.yellow) o.pending++;
    else if (col === PALETTE.green)  o.done++;
    agg.set(pav, o);
  }
  for (const [pav, o] of agg){
    let chosen = COLOR_DEFAULT;
    if (o.working) chosen = PALETTE.blue;
    else if (o.pending) chosen = PALETTE.yellow;
    else if (o.done)    chosen = PALETTE.green;
    map.byFloor[pav] = chosen;
  }
  return map;
}

// ------------------------------------------------------------------
// Color map por FVS (NC)
// Também prioriza `local_origem` na chave.
// ------------------------------------------------------------------
export function buildColorMapForFVS_NC(rows){
  const map = { default: COLOR_DEFAULT, colors: {}, byFloor: {} };
  if (!Array.isArray(rows)) return map;

  for (const r of rows){
    const key = normNameKey(
      r?.local_origem ?? r?.nome ?? r?.apartamento ?? r?.apto ?? r?.id ?? r?.name ?? ''
    );
    if (!key) continue;
    map.colors[key] = colorFromRowNC(r);
  }

  const floors = new Map(); // pav → hasNC
  for (const r of rows){
    const pav = (r?.pavimento_origem != null) ? String(r.pavimento_origem) : null;
    if (!pav) continue;
    const hasNC = Number(r?.qtd_nao_conformidades_ultima_inspecao ?? 0) > 0;
    floors.set(pav, (floors.get(pav) || false) || hasNC);
  }
  for (const [pav, hasNC] of floors){
    map.byFloor[pav] = hasNC ? PALETTE.red : COLOR_DEFAULT;
  }
  return map;
}

// ------------------------------------------------------------------
// Seleção de cor por Apto/Floor usando COLOR_MAP atual do State
// `aptoName` aqui é o nome do layout-3d.json (campo `nome`) —
// que deve bater com `local_origem` normalizado no color map.
// ------------------------------------------------------------------
export function pickFVSColor(aptoName, floorStr = null, colorMap = State.COLOR_MAP){
  if (!colorMap) return COLOR_DEFAULT;

  const id = normNameKey(aptoName || '');
  if (id && colorMap.colors && colorMap.colors[id]) return colorMap.colors[id];

  const pav = floorStr != null ? String(floorStr).trim() : '';
  if (pav && colorMap.byFloor && colorMap.byFloor[pav]) return colorMap.byFloor[pav];

  return colorMap.default || COLOR_DEFAULT;
}

// ------------------------------------------------------------------
// Utilitários de cor
// ------------------------------------------------------------------
const ORDER = [PALETTE.red, PALETTE.orange, PALETTE.yellow, PALETTE.green, PALETTE.blue, PALETTE.gray];
function worstColor(prev, next){
  if (!prev) return next;
  const pi = ORDER.indexOf(prev);
  const ni = ORDER.indexOf(next);
  if (pi === -1) return next;
  if (ni === -1) return prev;
  // "pior" é o menor índice (vermelho domina)
  return (ni < pi) ? next : prev;
}

export function hexToRgb(hex){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 110, g: 118, b: 129 }; // gray fallback
  return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}

export function tintFromColor(hex, alpha=0.18){
  const {r,g,b} = hexToRgb(hex);
  const a = clamp(alpha, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}
