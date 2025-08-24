// ============================
// Geometria / Torre 3D (build, recolor, explode)
// ============================

import { State } from './state.js';
import { scene } from './scene.js';
import { normAptoId } from './utils.js';
import { pickFVSColor } from './colors.js';

// Grupo raiz da torre
export let torre = null;

// "passo" (tamanho de célula) para X/Z e altura por pavimento (Y)
// Lidos do layout.meta, com fallbacks
export let stepX = 1.0;
export let stepZ = 1.0;
export let stepY = 1.0;
export let gap   = 0.0;

// Cache de alvos para picking (faces e edges)
let faceTargets = [];
let edgeTargets = [];

/**
 * Constrói a torre a partir do layout.
 * layout = { meta: { cellW, cellD, floorH, gap }, placements: [...] }
 * Cada placement: { andar, apto|nome, x, z, w, d, h }
 */
export function buildFromLayout(layout){
  // Limpa torre anterior
  if (torre && scene) {
    scene.remove(torre);
    torre.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
  torre = new THREE.Group();
  torre.name = 'Torre';
  faceTargets = [];
  edgeTargets = [];

  // Meta
  const meta = layout?.meta || {};
  stepX = Number(meta.cellW ?? 1.0) || 1.0;
  stepZ = Number(meta.cellD ?? 1.0) || 1.0;
  stepY = Number(meta.floorH ?? 1.0) || 1.0;
  gap   = Number(meta.gap   ?? 0.0)  || 0.0;

  // Constrói blocos (um box por placement — mais leve que voxel por célula)
  const placements = Array.isArray(layout?.placements) ? layout.placements : [];

  const tmpBox = new THREE.Box3();
  const tmpVec = new THREE.Vector3();

  for (const p of placements){
    const andar = Number(p.andar ?? p.floor ?? 0) || 0;
    const nome  = String(p.apto ?? p.nome ?? p.id ?? '').trim();

    const nx = Number(p.x ?? 0) || 0;
    const nz = Number(p.z ?? 0) || 0;
    const nw = Math.max(0.001, Number(p.w ?? 1) || 1);
    const nd = Math.max(0.001, Number(p.d ?? 1) || 1);
    const nh = Math.max(0.001, Number(p.h ?? 1) || 1);

    // Dimensões reais
    const w = nw * stepX - gap;
    const d = nd * stepZ - gap;
    const h = nh * stepY - gap;

    // Posição base (canto -> centro)
    const cx = (nx + nw/2) * stepX;
    const cz = (nz + nd/2) * stepZ;
    const cy = (andar + nh/2) * stepY;

    // Geometria/Material
    const geom  = new THREE.BoxGeometry(w, h, d);
    const mFace = new THREE.MeshStandardMaterial({
      color: 0x6e7681,
      metalness: 0.0,
      roughness: 0.95,
      transparent: true,
      opacity: 1.0 // será controlado por setFaceOpacity()
    });
    const mesh  = new THREE.Mesh(geom, mFace);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Edges
    const eGeom = new THREE.EdgesGeometry(geom, 35);
    const mEdge = new THREE.LineBasicMaterial({ color: 0x2a2f3a, transparent: true, opacity: 1.0 });
    const edges = new THREE.LineSegments(eGeom, mEdge);
    edges.position.copy(mesh.position);

    // Grupo do apartamento
    const g = new THREE.Group();
    g.name = nome || 'apt';
    g.userData = {
      nome,
      pavimento_origem: String(andar),
      meta: { andar, nx, nz, nw, nd, nh },
      basePos: new THREE.Vector3(cx, cy, cz), // para explode
      mesh, edges
    };
    g.add(mesh);
    g.add(edges);
    torre.add(g);

    // Cache para picking
    faceTargets.push(mesh);
    edgeTargets.push(edges);
  }

  // Centraliza a torre no origin
  const bbox = new THREE.Box3().setFromObject(torre);
  const center = bbox.getCenter(new THREE.Vector3());
  torre.position.x -= center.x;
  torre.position.y -= bbox.min.y; // encosta no "solo"
  torre.position.z -= center.z;

  // Ajusta basePos com o deslocamento aplicado
  torre.children.forEach(g=>{
    const bp = g.userData.basePos;
    if (bp) {
      bp.sub(center);
      bp.y -= bbox.min.y;
    }
    // inicia na base
    g.position.copy(g.userData.basePos);
  });

  // Adiciona à cena
  scene.add(torre);

  // Aplica opacidade e explode vigentes (estado)
  setFaceOpacity(State.faceOpacity);
  applyExplode();

  return { bbox, center };
}

/** Aplica opacidade (0..1) no material de faces. */
export function setFaceOpacity(v){
  const o = Math.max(0, Math.min(1, v));
  State.faceOpacity = o;
  if (!torre) return;
  torre.children.forEach(g=>{
    const m = g.userData?.mesh?.material;
    if (m){
      m.transparent = o < 1;
      m.opacity = o;
      m.needsUpdate = true;
    }
  });
}

/** Recolore malhas segundo o COLOR_MAP atual. */
export function recolorMeshes3D(){
  if (!torre) return;
  const cmap = State.COLOR_MAP;
  torre.children.forEach(g=>{
    const nome = g.userData?.nome || '';
    const pav  = g.userData?.pavimento_origem ?? null;
    const hex  = pickFVSColor(nome, pav, cmap);
    const m = g.userData?.mesh?.material;
    if (m && hex){
      m.color.set(hex);
      m.needsUpdate = true;
    }
  });
}

/** Explode XY/Y baseado em State.explodeXY e State.explodeY */
export function applyExplode(){
  if (!torre) return;
  const ex = Number(State.explodeXY || 0);
  const ey = Number(State.explodeY  || 0);

  // Calcula centro global para vetor de afastamento XY
  // (como já centralizamos no origin, usar basePos relativo já é suficiente)
  torre.children.forEach(g=>{
    const bp = g.userData?.basePos;
    const andar = Number(g.userData?.meta?.andar ?? 0) || 0;
    if (!bp) return;

    // Direção XY a partir do centro (normaliza para intensidade estável)
    const dir = new THREE.Vector2(bp.x, bp.z);
    const len = dir.length() || 1e-6;
    dir.multiplyScalar(1/len);

    // Offsets
    const offX = dir.x * ex;
    const offZ = dir.y * ex;
    const offY = andar * ey;

    g.position.set(bp.x + offX, bp.y + offY, bp.z + offZ);
  });
}

/** Retorna arrays atuais de alvos para raycast (faces/edges). */
export function getPickTargets(){
  return { faces: faceTargets.slice(), edges: edgeTargets.slice() };
}

/** Retorna o grupo torre (para quem precisar). */
export function getTorre(){
  return torre;
}
