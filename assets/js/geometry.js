// geometry.js
// Construção da torre, explode, opacidade e recolor 3D.

import { State } from './state.js';
import { normAptoId, clamp01 } from './utils.js';

let _torre = null;
let _scene = null;
let _three = null;

// Materiais base (linhas fixas; faces por-apto são instanciadas)
const MAT = {
  line:    null,
  selLine: null
};

export function initGeometryDeps({ THREE, scene }) {
  _three = THREE;
  _scene = scene;
  if (!MAT.line) {
    MAT.line = new _three.LineBasicMaterial({
      color: 0xcad7ff,
      linewidth: 1,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
  }
  if (!MAT.selLine) {
    MAT.selLine = new _three.LineBasicMaterial({ color: 0xffc107, linewidth: 2 });
  }
}

export function getTorre(){
  return _torre;
}

// =============== Build (layout → grupo da torre) ===============
export function buildFromLayout(layout){
  if (!_scene || !_three) throw new Error('[geometry] initGeometryDeps não chamado');

  // (Re)cria torre
  if (_torre && _torre.parent) _torre.parent.remove(_torre);
  _torre = new _three.Group();
  _scene.add(_torre);

  const meta = layout?.meta || {};
  // gap do MODELO 3D: por padrão 0 (o “gap” visual da representação fica nos sliders)
  const gap3d = Number.isFinite(meta.gap_3d) ? Number(meta.gap_3d) : 0.0;
  const cellW = Number.isFinite(meta.cellW) ? Number(meta.cellW) : 1.2;
  const cellD = Number.isFinite(meta.cellD) ? Number(meta.cellD) : 1.2;
  const aptH  = 0.5;

  const stepX = cellW + gap3d;
  const stepZ = cellD + gap3d;
  const stepY = aptH  + gap3d;

  const placements = Array.isArray(layout?.placements) ? layout.placements : [];

  // Voxelização por nome (conjunto de posições ocupadas)
  const occByNome = new Map();
  for (const p of placements){
    const nome = String(p.nome ?? p.id ?? '').trim();
    if (!nome) continue;
    if (!occByNome.has(nome)) occByNome.set(nome, new Set());
    const occ = occByNome.get(nome);
    const baseY = (typeof p.andar === 'number') ? p.andar : 0;
    for (let gx = p.x; gx < p.x + p.w; gx++){
      for (let gz = p.z; gz < p.z + p.d; gz++){
        for (let gy = baseY; gy < baseY + p.h; gy++){
          occ.add(`${gx},${gy},${gz}`);
        }
      }
    }
  }

  // helpers de geometria
  function boundsFor(gx,gy,gz){
    const x0 = gx * stepX, x1 = x0 + cellW;
    const z0 = gz * stepZ, z1 = z0 + cellD;
    const y0 = gy * stepY, y1 = y0 + aptH;
    return {x0,x1,y0,y1,z0,z1};
  }
  function surfaceFromOcc(occ){
    if (!occ || !occ.size) return null;
    const has = (x,y,z)=> occ.has(`${x},${y},${z}`);

    const pos = [];
    const idx = [];
    let v = 0;

    const pushQuad = (a,b,c,d)=>{
      pos.push(...a, ...b, ...c, ...d);
      idx.push(v, v+1, v+2, v, v+2, v+3);
      v += 4;
    };

    for (const key of occ){
      const [gx,gy,gz] = key.split(',').map(Number);
      const B = boundsFor(gx,gy,gz);

      if (!has(gx-1,gy,gz)) pushQuad([B.x0,B.y0,B.z1],[B.x0,B.y0,B.z0],[B.x0,B.y1,B.z0],[B.x0,B.y1,B.z1]); // -X
      if (!has(gx+1,gy,gz)) pushQuad([B.x1,B.y0,B.z0],[B.x1,B.y0,B.z1],[B.x1,B.y1,B.z1],[B.x1,B.y1,B.z0]); // +X
      if (!has(gx,gy,gz-1)) pushQuad([B.x1,B.y0,B.z0],[B.x0,B.y0,B.z0],[B.x0,B.y1,B.z0],[B.x1,B.y1,B.z0]); // -Z
      if (!has(gx,gy,gz+1)) pushQuad([B.x0,B.y0,B.z1],[B.x1,B.y0,B.z1],[B.x1,B.y1,B.z1],[B.x0,B.y1,B.z1]); // +Z
      if (!has(gx,gy-1,gz)) pushQuad([B.x0,B.y0,B.z0],[B.x1,B.y0,B.z0],[B.x1,B.y0,B.z1],[B.x0,B.y0,B.z1]); // -Y
      if (!has(gx,gy+1,gz)) pushQuad([B.x0,B.y1,B.z1],[B.x1,B.y1,B.z1],[B.x1,B.y1,B.z0],[B.x0,B.y1,B.z0]); // +Y
    }

    if (!pos.length) return null;

    const geom = new _three.BufferGeometry();
    geom.setAttribute('position', new _three.Float32BufferAttribute(new Float32Array(pos), 3));
    geom.setIndex(new _three.Uint32BufferAttribute(new Uint32Array(idx), 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox(); geom.computeBoundingSphere();
    return geom;
  }

  function inflate(geom, off=0.04){
    const g = geom.clone();
    g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i=0; i<pos.count; i++){
      pos.setX(i, pos.getX(i) + nor.getX(i)*off);
      pos.setY(i, pos.getY(i) + nor.getY(i)*off);
      pos.setZ(i, pos.getZ(i) + nor.getZ(i)*off);
    }
    pos.needsUpdate = true;
    return g;
  }

  // cria grupos por apto
  for (const [nome, occ] of occByNome.entries()){
    const surf = surfaceFromOcc(occ);
    if (!surf) continue;

    // Face material (opacidade controlada adiante)
    const faceMat = new _three.MeshStandardMaterial({
      color: 0x6e7681,
      metalness: 0.05,
      roughness: 0.9,
      transparent: true,
      opacity: 1.0,          // ajustaremos via setFaceOpacity
      depthWrite: true,
      side: _three.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    const mesh  = new _three.Mesh(surf, faceMat);
    mesh.renderOrder = 1;

    const inflated = inflate(surf, 0.04);
    const edges = new _three.LineSegments(new _three.EdgesGeometry(inflated, 1), MAT.line);
    edges.renderOrder = 2;

    // piso “mínimo” (usa Y do voxel)
    let minLevel = Infinity;
    for (const key of occ){
      const gy = parseInt(key.split(',')[1], 10);
      if (gy < minLevel) minLevel = gy;
    }
    if (!Number.isFinite(minLevel)) minLevel = 0;

    const group = new _three.Group();
    group.add(mesh);
    group.add(edges);

    // metadata
    group.userData = {
      nome: String(nome),
      mesh, edges,
      levelIndex: minLevel,
      basePos: new _three.Vector3(0,0,0),
      anchor:  new _three.Vector3(0,0,0)
    };

    // centro local → anchor
    surf.computeBoundingBox();
    const bb = surf.boundingBox;
    const localCenter = new _three.Vector3();
    bb.getCenter(localCenter);
    group.__localCenter = localCenter;

    _torre.add(group);
  }

  // centraliza a torre no (0,0,0) e fixa basePos + anchor
  const bbox = new _three.Box3().setFromObject(_torre);
  const center = new _three.Vector3(); bbox.getCenter(center);
  for (const g of _torre.children){
    g.position.sub(center);
    g.userData.basePos.copy(g.position);

    const lc = g.__localCenter || new _three.Vector3();
    g.userData.anchor.set(
      g.position.x + lc.x,
      g.position.y + lc.y,
      g.position.z + lc.z
    );
    delete g.__localCenter;
  }

  // aplica opacidade inicial conforme State.faceOpacity + flatten2D
  setFaceOpacity(State.faceOpacity ?? 0.3);

  // IMPORTANTÍSSIMO: começa colado (mesmo com sliders em zero)
  applyExplode(true);

  return { bbox };
}

// =============== Explode (sempre relativo a basePos) ===============
export function applyExplode(reset=false){
  if (!_torre) return;

  const ex = Number(State.explodeXY) || 0;
  const ey = Number(State.explodeY)  || 0;

  if (reset || (Math.abs(ex) < 1e-6 && Math.abs(ey) < 1e-6)){
    for (const g of _torre.children) g.position.copy(g.userData.basePos);
    return;
  }

  // centroide dos anchors (XY)
  let sumX=0, sumZ=0, n=0;
  for (const g of _torre.children){ sumX += g.userData.anchor.x; sumZ += g.userData.anchor.z; n++; }
  const cx = n ? sumX/n : 0;
  const cz = n ? sumZ/n : 0;

  // escala do deslocamento radial (usa bounding box da torre)
  const bbox = new _three.Box3().setFromObject(_torre);
  const size = new _three.Vector3(); bbox.getSize(size);
  const step = Math.max(size.x, size.z) * 0.06; // fator proporcional ao prédio

  for (const g of _torre.children){
    const pos = g.userData.basePos.clone();

    if (ex > 0){
      const dir = new _three.Vector3(g.userData.anchor.x - cx, 0, g.userData.anchor.z - cz);
      const len = dir.length();
      if (len > 1e-6){
        dir.multiplyScalar(1/len);
        pos.addScaledVector(dir, ex * step);
      }
    }
    if (ey !== 0){
      pos.y += (g.userData.levelIndex || 0) * ey;
    }
    g.position.copy(pos);
  }
}

// =============== Opacidade (faces e linhas) ===============
export function setFaceOpacity(v){
  const base = clamp01(v);
  State.faceOpacity = base;

  // Opacidade efetiva respeita flatten2D (mais transparente no 2D)
  const t2d = clamp01(State.flatten2D || 0);
  const eff = base + (0.03 - base) * t2d; // interpola para ~0.03 no 2D

  if (!_torre) return;
  const isOpaque = eff >= 0.999;

  _torre.traverse(n=>{
    if (!n.material) return;
    if (n.isMesh){
      n.material.opacity = eff;
      n.material.transparent = !isOpaque;
      n.material.depthWrite  = isOpaque;
      n.material.needsUpdate = true;
    } else if (n.isLine || n.isLineSegments){
      const lineEff = 0.95 + (0.08 - 0.95) * t2d; // fade de linhas no 2D
      n.material.opacity     = lineEff;
      n.material.transparent = lineEff < 1;
      n.material.depthWrite  = !n.material.transparent;
      n.material.needsUpdate = true;
    }
  });
}

// =============== Recolor (usa State.COLOR_MAP) ===============
export function recolorMeshes3D(){
  if (!_torre || !State.COLOR_MAP) return;

  for (const g of _torre.children){
    const aptId = g.userData.nome || '';
    const key   = normAptoId(aptId);
    const floor = String(g.userData.levelIndex ?? 0);

    let hex = State.COLOR_MAP.colors?.[key]
           || State.COLOR_MAP.byFloor?.[floor]
           || State.COLOR_MAP.default
           || '#6e7681';

    if (hex && !hex.startsWith('#')) hex = `#${hex}`;

    const mat = g.userData.mesh?.material;
    if (mat){
      mat.color = new _three.Color(hex);
      mat.needsUpdate = true;
    }
  }

  // Reaplica opacidade efetiva (caso o material tenha sido recriado em algum fluxo)
  setFaceOpacity(State.faceOpacity ?? 0.3);
}
