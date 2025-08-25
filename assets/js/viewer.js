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
// ============================
// Controles de câmera (Pointer Events) — mobile friendly
// ============================
(function wireCameraInput(){
  const dom = document.querySelector('#app canvas');
  if (!dom) return;

  // Evita o browser interferir (scroll/gestos) no canvas
  dom.style.touchAction = 'none';

  const pointers = new Map();     // id -> {x,y}
  let single = { active:false, lastX:0, lastY:0 };
  let two = null;                 // { prevDist, prevMid:{x,y} }

  const dist = (a,b)=> Math.hypot(a.x-b.x, a.y-b.y);
  const mid  = (a,b)=> ({ x:(a.x+b.x)/2, y:(a.y+b.y)/2 });

  function onDown(e){
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (pointers.size === 1){
      single.active = true;
      single.lastX  = e.clientX;
      single.lastY  = e.clientY;
      two = null;
    } else if (pointers.size === 2){
      const [p0,p1] = [...pointers.values()];
      two = { prevDist: dist(p0,p1), prevMid: mid(p0,p1) };
      single.active = false;
    }
    e.preventDefault();
  }

  function onMove(e){
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

    // 1 dedo -> órbita
    if (pointers.size === 1 && single.active){
      const dx = e.clientX - single.lastX;
      const dy = e.clientY - single.lastY;
      single.lastX = e.clientX;
      single.lastY = e.clientY;

      const ROT_SPEED = 0.012;   // mais sensível
      State.theta += dx * ROT_SPEED;
      State.phi   -= dy * ROT_SPEED;
      State.phi = Math.max(0.05, Math.min(Math.PI - 0.05, State.phi));
      applyOrbitToCamera();
      render();
      e.preventDefault();
      return;
    }

    // 2+ dedos -> pinça (zoom) + pan do alvo
    if (pointers.size >= 2 && two){
      const [p0,p1] = [...pointers.values()];

      // pinch -> zoom (incremental para não "pular")
      const d = dist(p0,p1);
      const scale = d / (two.prevDist || d);
      if (scale && isFinite(scale) && scale > 0){
        const newRadius = (State.radius || 20) / scale;
        State.radius = Math.max(4, Math.min(400, newRadius));
        two.prevDist = d;
      }

      // pan a partir do deslocamento do ponto médio
      const m   = mid(p0,p1);
      const mdx = m.x - two.prevMid.x;
      const mdy = m.y - two.prevMid.y;
      two.prevMid = m;

      const PAN_SPEED = (State.radius || 20) * 0.0022;
      const dir   = new THREE.Vector3();
      const right = new THREE.Vector3();
      camera.getWorldDirection(dir);
      right.crossVectors(dir, camera.up).normalize();
      const camUp = camera.up.clone().normalize();

      State.orbitTarget.addScaledVector(right, -mdx * PAN_SPEED);
      State.orbitTarget.addScaledVector(camUp,   mdy * PAN_SPEED);

      applyOrbitToCamera();
      render();
      e.preventDefault();
      return;
    }
  }

  function onUp(e){
    pointers.delete(e.pointerId);
    if (pointers.size === 1){
      const only = [...pointers.values()][0];
      single.active = true;
      single.lastX = only.x;
      single.lastY = only.y;
      two = null;
    } else if (pointers.size === 0){
      single.active = false;
      two = null;
    }
  }

  dom.addEventListener('pointerdown',  onDown, { passive:false });
  dom.addEventListener('pointermove',  onMove, { passive:false });
  dom.addEventListener('pointerup',    onUp,   { passive:true  });
  dom.addEventListener('pointercancel',onUp,   { passive:true  });

  // Wheel/trackpad
  dom.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const ZOOM_STEP = Math.max(0.25, (State.radius || 20) * 0.06);
    State.radius += delta * ZOOM_STEP;
    State.radius = Math.max(4, Math.min(400, State.radius));
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
