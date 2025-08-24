// ============================
// Entry do Viewer DOGE
// ============================

import { initTooltip, normAptoId } from './utils.js';
import { State } from './state.js';
import { loadAllData, layoutData, apartamentos } from './data.js';
import { initScene, applyOrbitToCamera, recenterCamera, render } from './scene.js';
import { buildFromLayout, recolorMeshes3D, setFaceOpacity, applyExplode, getTorre } from './geometry.js';
import { initOverlay2D, setRowsResolver, render2DCards, show2D, hide2D } from './overlay2d.js';
import { initPicking, setRowResolver, selectGroup } from './picking.js';
import { initModal, openAptModal } from './modal.js';
import { initHUD, applyFVSAndRefresh } from './hud.js';

// ============================
// Boot
// ============================
(async function boot(){
  // UI base
  initTooltip();
  initModal();
  initOverlay2D();

  // Loading on
  const loading = document.getElementById('doge-loading');
  loading?.classList.remove('hidden');

  // Carrega dados
  await loadAllData();

  // Cena / câmera / renderer
  initScene();

  // Monta a torre
  const { bbox } = buildFromLayout(layoutData || { meta:{}, placements:[] });

  // Ajusta raio inicial com base no tamanho do prédio (opcional)
  if (bbox && bbox.isBox3){
    const size = bbox.getSize(new THREE.Vector3());
    const diag = Math.hypot(size.x, size.z);
    State.radius = Math.max(12, diag * 1.6); // zoom inicial proporcional
    applyOrbitToCamera();
  }

  // HUD (dropdowns, botões, sliders)
  initHUD();

  // Picking (hover + click)
  initPicking();
  import { initPicking, setRowResolver, selectGroup, setOnSelect } from './picking.js';
import { openAptModal } from './modal.js';

// ...

initPicking();
setOnSelect(({ id, floor, row }) => {
  openAptModal({ id, floor, row });
});

  // Resolvers para 2D e Modal (conforme FVS atual)
  updateResolversForCurrentFVS();

  // Primeira aplicação de FVS/NC → colore 3D e renderiza 2D
  applyFVSAndRefresh();

  // Delegação de clique nos cards 2D (abre modal)
  wireCards2DClicks();

  // Input de câmera (mouse/touch)
  wireCameraInput();

  // Loading off
  if (loading) loading.classList.add('hidden');

  // Render inicial
  render();

  // Ou loop leve (se preferir contínuo, descomente animate)
  // animate();
})().catch(err=>{
  console.error('[viewer] erro no boot:', err);
});

// ============================
// Resolvers (FVS -> rows/map) para overlay2d e picking
// ============================
function getRowsForCurrentFVS(){
  const fvs = State.CURRENT_FVS || '';
  if (!fvs || !Array.isArray(apartamentos)) return [];
  return apartamentos.filter(r => String(r.fvs || '').trim() === fvs);
}

function updateResolversForCurrentFVS(){
  const rows = getRowsForCurrentFVS();
  const map = new Map();
  for (const r of rows){
    const apt = String(r.apartamento ?? r.apto ?? r.nome ?? '').trim();
    const key = normAptoId(apt);
    if (!key) continue;
    // se houver múltiplos registros por apto, manter o “melhor” (aqui priorizamos o último)
    map.set(key, r);
  }

  // Overlay 2D recebe a fonte da lista atual
  setRowsResolver(()=> getRowsForCurrentFVS());

  // Picking precisa resolver 1 row por apto normalizado
  setRowResolver((aptKeyNorm)=> map.get(aptKeyNorm) || null);
}

// Observa mudanças na FVS/NC (via HUD) para atualizar resolvers
(function hookFVSChanges(){
  const fvsSelect = document.getElementById('fvsSelect');
  const btnNC = document.getElementById('btnNC');
  fvsSelect?.addEventListener('change', ()=>{
    updateResolversForCurrentFVS();
    // HUD já chama applyFVSAndRefresh(); aqui apenas garantimos o resolver
  });
  btnNC?.addEventListener('click', ()=>{
    // HUD já alterna NC e aplica; só sincronizamos as fontes
    updateResolversForCurrentFVS();
  });
})();

// ============================
// Delegação de clique nos cards 2D
// ============================
function wireCards2DClicks(){
  const host = document.getElementById('cards2d');
  if (!host) return;
  host.addEventListener('click', (e)=>{
    const card = e.target.closest?.('.card');
    if (!card) return;

    const apt  = card.dataset.apto || '';
    const pav  = card.dataset.pav || '';
    // Tente também selecionar no 3D (se existir grupo)
    const torre = getTorre();
    if (torre){
      const target = torre.children.find(g => String(g.userData?.nome || '').trim() === apt);
      if (target){
        selectGroup(target);
      }
    }
    // Abrir modal (row será resolvida pelo picking via setRowResolver, mas aqui chamamos direto sem ela)
    // Vamos montar uma row caso o resolver não esteja no escopo:
    const rows = getRowsForCurrentFVS();
    const row = rows.find(r => String(r.apartamento ?? r.apto ?? r.nome ?? '').trim() === apt) || null;

    openAptModal({ id: apt, floor: pav, row, tintHex: null });
  });
}

// ============================
// Controles de câmera (mouse/touch)
// - Botão esquerdo: ORBIT (theta/phi)
// - Botão direito: PAN (arrasta o alvo)
// - Roda: ZOOM (raio)
// ============================
function wireCameraInput(){
  const dom = document.querySelector('#app canvas');
  if (!dom) return;

  // Previne menu de contexto no botão direito (para pan)
  dom.addEventListener('contextmenu', e => e.preventDefault());

  let dragging = false;
  let mode = null; // 'orbit' | 'pan'
  let lastX = 0, lastY = 0;

  dom.addEventListener('mousedown', (e)=>{
    dragging = true;
    mode = (e.button === 2) ? 'pan' : 'orbit'; // direito = pan, esquerdo = orbit
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mouseup', ()=>{
    dragging = false;
    mode = null;
  });

  window.addEventListener('mousemove', (e)=>{
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (mode === 'orbit'){
      const ROT_SPEED = 0.005;
      State.theta += dx * ROT_SPEED;
      State.phi   -= dy * ROT_SPEED;
      State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
      applyOrbitToCamera();
      render();
    }else if (mode === 'pan'){
      // Pan aproximado: desloca orbitTarget nos eixos da câmera
      const PAN_SPEED = (State.radius || 20) * 0.0025;
      const dir = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0,1,0);

      camera.getWorldDirection(dir);      // para frente
      right.crossVectors(dir, up).normalize(); // direita da câmera
      const camUp = camera.up.clone().normalize();

      // mover alvo ao longo de right e up
      State.orbitTarget.addScaledVector(right, -dx * PAN_SPEED);
      State.orbitTarget.addScaledVector(camUp,  dy * PAN_SPEED);

      applyOrbitToCamera();
      render();
    }
  });

  // Zoom (wheel)
  dom.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const ZOOM_STEP = Math.max(0.5, (State.radius || 20) * 0.08);
    State.radius += delta * ZOOM_STEP;
    State.radius = Math.max(4, Math.min(400, State.radius));
    applyOrbitToCamera();
    render();
  }, { passive:false });

  // Touch: 1 dedo = orbit
  let touchActive = false;
  let tLastX=0, tLastY=0;
  dom.addEventListener('touchstart', (e)=>{
    if (e.touches.length === 1){
      touchActive = true;
      tLastX = e.touches[0].clientX;
      tLastY = e.touches[0].clientY;
    }
  }, { passive:true });
  dom.addEventListener('touchmove', (e)=>{
    if (!touchActive || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - tLastX;
    const dy = y - tLastY;
    tLastX = x; tLastY = y;

    const ROT_SPEED = 0.005;
    State.theta += dx * ROT_SPEED;
    State.phi   -= dy * ROT_SPEED;
    State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
    applyOrbitToCamera();
    render();
  }, { passive:true });
  dom.addEventListener('touchend', ()=>{ touchActive = false; }, { passive:true });
}

// ============================
// Loop (opcional)
// ============================
function animate(){
  requestAnimationFrame(animate);
  render();
}
