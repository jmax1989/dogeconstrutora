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
// ============================
// Controles de câmera com Pointer Events
// - Mouse:
//   * Esquerdo: ORBIT
//   * Direito:  PAN
//   * Wheel:    ZOOM
// - Touch:
//   * 1 dedo:   ORBIT
//   * 2 dedos:  PAN + PINCH (zoom)
// ============================
(function wireCameraInputPE(){
  const dom = document.querySelector('#app canvas');
  if (!dom) return;

  dom.addEventListener('contextmenu', e => e.preventDefault());

  const ptrs = new Map(); // id -> {x,y}
  let mode = null;        // 'orbit' | 'pan' | 'gesture'
  let last = { x:0, y:0 };

  // estado do gesto (2 dedos)
  let gStart = null; // { d, mid:{x,y}, radius0, target0:THREE.Vector3 }
  const ROT_SPEED = 0.008;               // mais “leve” que antes
  const PAN_K     = 0.0032;              // pan mais responsivo
  const ZOOM_K    = 0.0045;              // pinch sensitivity

  function getMidAndDist(){
    const a = [...ptrs.values()];
    if (a.length < 2) return null;
    const [p0, p1] = a;
    const mid = { x: (p0.x+p1.x)/2, y: (p0.y+p1.y)/2 };
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const d  = Math.hypot(dx, dy);
    return { mid, d };
  }

  dom.addEventListener('pointerdown', (e)=>{
    dom.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (ptrs.size === 1){
      // mouse: botão direito => pan; toque: 1 dedo => orbit
      mode = (e.pointerType === 'mouse' && e.button === 2) ? 'pan' : 'orbit';
      last.x = e.clientX; last.y = e.clientY;
    } else if (ptrs.size === 2){
      // inicia gesto (pinch+pan)
      mode = 'gesture';
      const md = getMidAndDist();
      gStart = {
        d: md.d || 1,
        mid: md.mid,
        radius0: State.radius,
        target0: State.orbitTarget.clone()
      };
    }
    e.preventDefault();
  }, { passive:false });

  dom.addEventListener('pointermove', (e)=>{
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (mode === 'orbit' && ptrs.size === 1){
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;

      State.theta += dx * ROT_SPEED;
      State.phi   -= dy * ROT_SPEED;
      State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
      applyOrbitToCamera();
      render();
      e.preventDefault();
    }
    else if (mode === 'pan' && ptrs.size === 1){
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;

      const dir = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0,1,0);

      camera.getWorldDirection(dir);
      right.crossVectors(dir, up).normalize();
      const camUp = camera.up.clone().normalize();

      const panSpeed = (State.radius || 20) * PAN_K;
      State.orbitTarget.addScaledVector(right, -dx * panSpeed);
      State.orbitTarget.addScaledVector(camUp,   dy * panSpeed);

      applyOrbitToCamera();
      render();
      e.preventDefault();
    }
    else if (mode === 'gesture' && ptrs.size >= 2){
      const md = getMidAndDist();
      if (!md || !gStart) return;

      // pinch → zoom
      const scale = (md.d || 1) / (gStart.d || 1);
      const zoomDelta = (1 - scale) * (State.radius || 20);
      State.radius = Math.max(4, Math.min(400, gStart.radius0 + zoomDelta * (ZOOM_K * 220)));

      // pan com o midpoint
      const dx = (md.mid.x - gStart.mid.x);
      const dy = (md.mid.y - gStart.mid.y);

      const dir = new THREE.Vector3();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0,1,0);

      camera.getWorldDirection(dir);
      right.crossVectors(dir, up).normalize();
      const camUp = camera.up.clone().normalize();

      const panSpeed = (State.radius || 20) * PAN_K;
      State.orbitTarget.copy(gStart.target0);
      State.orbitTarget.addScaledVector(right, -dx * panSpeed);
      State.orbitTarget.addScaledVector(camUp,   dy * panSpeed);

      applyOrbitToCamera();
      render();
      e.preventDefault();
    }
  }, { passive:false });

  function endPtr(id){
    ptrs.delete(id);
    if (ptrs.size === 0){
      mode = null;
      gStart = null;
    } else if (ptrs.size === 1){
      // se sair de 2 dedos para 1, volta para orbit “limpa”
      mode = 'orbit';
      const p = [...ptrs.values()][0];
      last.x = p.x; last.y = p.y;
      gStart = null;
    }
  }

  dom.addEventListener('pointerup',   e => endPtr(e.pointerId), { passive:true });
  dom.addEventListener('pointercancel', e => endPtr(e.pointerId), { passive:true });

  // Wheel (desktop)
  dom.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const step  = Math.max(0.5, (State.radius || 20) * 0.08);
    State.radius = Math.max(4, Math.min(400, State.radius + delta * step));
    applyOrbitToCamera();
    render();
  }, { passive:false });
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
