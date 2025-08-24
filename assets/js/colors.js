// ============================
// Regras de cor / Color Map
// ============================

import { normAptoId, clamp } from './utils.js';
import { State } from './state.js';

export const COLOR_DEFAULT = '#6e7681';  // cinza neutro (GitHub dark)
export const PALETTE = {
  green:  '#2ea043',
  yellow: '#d29922',
  orange: '#d27d2d',
  red:    '#f85149',
  blue:   '#58a6ff',
  gray:   COLOR_DEFAULT
};

// ------------------------------------------------------------------
// Heurísticas de status -> cor (podem ser calibradas depois)
// Recebe um "row" de apartamentos.json (o último registro por apt/FVS).
// Campos usuais: percentual_ultima_inspecao, qtd_pend_ultima_inspecao,
// qtd_nao_conformidades_ultima_inspecao, em_andamento, pavimento_origem.
// ------------------------------------------------------------------
export function colorFromRowNormal(row){
  if (!row) return PALETTE.gray;

  const pct    = Number(row.percentual_ultima_inspecao ?? 0) || 0;
  const pend   = Number(row.qtd_pend_ultima_inspecao ?? 0) || 0;
  const nc     = Number(row.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;
  const running= !!row.em_andamento;

  // Ordem de prioridade (ajuste fino se quiser):
  // 1) NC presente -> vermelho
  if (nc > 0) return PALETTE.red;
  // 2) Pendente -> amarelo/laranja
  if (pend > 0) return PALETTE.orange;
  // 3) 100% -> verde
  if (pct >= 100) return PALETTE.green;
  // 4) Em andamento -> azul
  if (running) return PALETTE.blue;

  // 5) Desconhecido/neutro
  return PALETTE.gray;
}

export function colorFromRowNC(row){
  // No modo NC destacamos apenas aptos com NC/pendências.
  if (!row) return null;
  const pend = Number(row.qtd_pend_ultima_inspecao ?? 0) || 0;
  const nc   = Number(row.qtd_nao_conformidades_ultima_inspecao ?? 0) || 0;
  if (nc > 0)   return PALETTE.red;
  if (pend > 0) return PALETTE.orange;
  return null; // sinaliza que deve cair em "desligado" / cinza fraco
}

// ------------------------------------------------------------------
// Construção do COLOR_MAP para uma FVS específica (modo normal)
// apartmentsByFVS: lista de rows filtrados para a FVS ativa.
// Retorna payload: { default, colors, byFloor }
// - colors: { [normAptoId]: '#rrggbb' }
// - byFloor: { [andar(string)]: '#rrggbb' }  (opcional; útil para FVS de pavimento)
// ------------------------------------------------------------------
export function buildColorMapForFVS(apartmentsByFVS){
  const colors = {};
  const byFloor = {}; // Se quiser colorir por pavimento (ex.: FVS de piso inteiro)

  for (const row of apartmentsByFVS){
    const aptKey = normAptoId(row.apartamento ?? row.apto ?? row.nome ?? '');
    if (!aptKey) continue;
    colors[aptKey] = colorFromRowNormal(row);

    // Se desejar mapear por piso (pavimento):
    const pav = String(row.pavimento_origem ?? '').trim();
    if (pav) {
      // Agrega por pior estado do piso (vermelho > laranja > amarelo > verde > cinza)
      const next = colors[aptKey];
      const prev = byFloor[pav];
      byFloor[pav] = worstColor(prev, next);
    }
  }

  return { default: COLOR_DEFAULT, colors, byFloor };
}

// ------------------------------------------------------------------
// Construção do COLOR_MAP para modo NC (só destaca NC/pend).
// Apartamentos sem NC/pend voltam para "cinza".
//
// Nota: Em NC, mantemos cores fortes apenas onde há problemas.
// ------------------------------------------------------------------
export function buildColorMapForFVS_NC(apartmentsByFVS){
  const colors = {};
  const byFloor = {};

  for (const row of apartmentsByFVS){
    const aptKey = normAptoId(row.apartamento ?? row.apto ?? row.nome ?? '');
    if (!aptKey) continue;

    const c = colorFromRowNC(row);
    colors[aptKey] = c || COLOR_DEFAULT;

    const pav = String(row.pavimento_origem ?? '').trim();
    if (pav){
      const next = c || COLOR_DEFAULT;
      const prev = byFloor[pav];
      byFloor[pav] = worstColor(prev, next);
    }
  }

  return { default: COLOR_DEFAULT, colors, byFloor };
}

// ------------------------------------------------------------------
// Seleção de cor por Apto/Floor usando COLOR_MAP atual do State
// ------------------------------------------------------------------
export function pickFVSColor(aptoName, floorStr = null, colorMap = State.COLOR_MAP){
  if (!colorMap) return COLOR_DEFAULT;
  const id = normAptoId(aptoName || '');
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
  // Retorna um background rgba leve para headers/pill/modal
  const {r,g,b} = hexToRgb(hex);
  const a = clamp(alpha, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}
