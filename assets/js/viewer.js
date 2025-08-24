// ============================
// Entry do Viewer DOGE
// ============================

import { initTooltip } from './utils.js';
import { State } from './state.js';
import { loadAllData, layoutData } from './data.js';
import { initScene, applyOrbitToCamera, render, camera } from './scene.js';
import { buildFromLayout, recolorMeshes3D, setFaceOpacity, applyExplode, getTorre, apply2DVisual } from './geometry.js';
import { initOverlay2D, render2DCards, hide2D } from './overlay2d.js';
import { initPicking, selectGroup } from './picking.js';
import { initModal } from './modal.js';
import { initHUD, applyFVSAndRefresh } from './hud.js';

// ============================
// Boot
// ============================
(async function boot(){
  // UI base
  initTooltip();
  initModal();

  // Loading on
  const loading = document.getElementById('doge-loading');
  loading?.classList.remove('hidden');

  // 1) Carrega dados primeiro
  await loadAllData();

  // 2) Cena / câmera / renderer
  initScene();

  // 3) Monta a torre
  const { bbox } = buildFromLayout(layoutData || { meta:{}, placements:[] });

  // 4) Ajuste inicial: mantém o tamanho atual e só desce um pouco o prédio no enquadramento
  if (bbox && bbox.isBox3){
    const center = bbox.getCenter(new THREE.Vector3());
    const size   = bbox.getSize(new THREE.Vector3());

    // mira no centro e sobe um pouco o alvo para o prédio “descer” na tela
    State.orbitTarget.copy(center);
    State.orbitTarget.y += size.y * 0.12;

    // mantém seu raio existente (se já definido) ou calcula um baseado no XZ
    const diag = Math.hypot(size.x, size.z);
    State.radius = Math.max(State.radius || 12, diag * 1.6);

    applyOrbitToCamera();
  }

  // 5) HUD (dropdowns, botões, sliders)
  initHUD();

  // 6) Aplica FVS/NC — isso também injeta resolvers para 2D/3D e atualiza COLOR_MAP
  applyFVSAndRefresh();

  // 7) Overlay 2D (render já com resolvers prontos)
  initOverlay2D();
  render2DCards();

  // 8) Picking (hover + click) no 3D
  initPicking();

  // 9) Loading off
  if (loading) loading.classList.add('hidden');

  // 10) Render inicial
  render();

  // 11) Reaplica o offset vertical do alvo em resize (mantendo o “descer”)
  window.addEventListener('resize', ()=>{
    const torre = getTorre();
    if (!torre) return;
    const bb = new THREE.Box3().setFromObject(torre);
    if (!bb || !bb.isBox3) return;

    const c = bb.getCenter(new THREE.Vector3());
    const s = bb.getSize(new THREE.Vector3());
    State.orbitTarget.copy(c);
    State.orbitTarget.y += s.y * 0.12;

    applyOrbitToCamera();
    render();
  }, { passive:true });

})().catch(err=>{
  console.error('[viewer] erro no boot:', err);
});

// ============================
// Selecionar também o grupo 3D ao clicar num card 2D
// (o overlay já abre o modal; aqui apenas sincronizamos a seleção 3D)
// ============================
(function wireSelect3DFrom2D(){
  const host = document.getElementById('cards2d');
  if (!host) return;
  host.addEventListener('click', (e)=>{
    const card = e.target.closest?.('.card');
    if (!card || card.classList.contains('disabled')) return;

    const apt = card.dataset.apto || '';
    const torre = getTorre();
    if (!torre) return;

    const target = torre.children.find(g => String(g.userData?.nome || '').trim() === apt);
    if (target) {
      selectGroup(target);
      render();
    }
  });
})();

// ============================
// Controles de câmera (mouse/touch)
// - Botão esquerdo: ORBIT (theta/phi)
// - Botão direito: PAN (arrasta o alvo)
// - Roda: ZOOM (raio)
// ============================
(function wireCameraInput(){
  const dom = document.querySelector('#app canvas');
  if (!dom) return;

  // Previne menu de contexto no botão direito (para pan)
  dom.addEventListener('contextmenu', e => e.preventDefault());

  let dragging = false;
  let mode = null; // 'orbit' | 'pan'
  let lastX = 0, lastY = 0;

  // Ganhos mais responsivos (alinhados ao “feeling” do 2D)
  const ROT_SPEED_MOUSE  = 0.011;  // antes 0.005
  const ROT_SPEED_TOUCH  = 0.011;  // antes 0.005
  const PAN_GAIN         = 0.0050; // antes 0.0025
  const ZOOM_FACTOR      = 0.08;   // mantenho

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
      State.theta += dx * ROT_SPEED_MOUSE;
      State.phi   -= dy * ROT_SPEED_MOUSE;
      State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
      applyOrbitToCamera();
      render();
    }else if (mode === 'pan'){
      // Pan aproximado: desloca orbitTarget nos eixos da câmera
      const PAN_SPEED = (State.radius || 20) * PAN_GAIN;
      const dir = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0,1,0);

      camera.getWorldDirection(dir);           // para frente
      right.crossVectors(dir, up).normalize(); // direita da câmera
      const camUp = camera.up.clone().normalize();

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
    const ZOOM_STEP = Math.max(0.5, (State.radius || 20) * ZOOM_FACTOR);
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

    State.theta += dx * ROT_SPEED_TOUCH;
    State.phi   -= dy * ROT_SPEED_TOUCH;
    State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
    applyOrbitToCamera();
    render();
  }, { passive:true });
  dom.addEventListener('touchend', ()=>{ touchActive = false; }, { passive:true });
})();

// ============================
// ESC fecha 2D se ativo (quando o modal não está aberto)
// ============================
window.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;

  // Se o modal estiver aberto, deixamos o handler do modal agir.
  const modalBackdrop = document.getElementById('doge-modal-backdrop');
  const modalOpen = modalBackdrop && modalBackdrop.classList.contains('show');
  if (modalOpen) return;

  // Se 2D estiver ativo, desliga
  if (State.flatten2D >= 0.95) {
    State.flatten2D = 0;

    const btn2D = document.getElementById('btn2D');
    btn2D?.setAttribute('aria-pressed','false');
    btn2D?.classList.remove('active');

    hide2D();
    apply2DVisual(false);
    render();
  }
});
