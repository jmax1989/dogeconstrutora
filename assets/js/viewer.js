// ============================
// Entry do Viewer DOGE
// ============================

import { initTooltip } from './utils.js';
import { State } from './state.js';
import { loadAllData, layoutData } from './data.js';
import {
  initScene,
  applyOrbitToCamera,
  render,
  orbitDelta,
  panDelta,
  zoomDelta,
  recenterCamera,
  resetRotation,              // <--- novo
  syncOrbitTargetToModel,     // <--- novo
  INITIAL_THETA,
  INITIAL_PHI
} from './scene.js';
import {
  buildFromLayout,
  getTorre,
  apply2DVisual
} from './geometry.js';
import { initOverlay2D, render2DCards, hide2D, show2D } from './overlay2d.js';
import { initPicking, selectGroup } from './picking.js';
import { initModal } from './modal.js';
import { initHUD, applyFVSAndRefresh } from './hud.js';

// ============================
// Boot
// ============================
(async function boot(){
  try {
    // UI base
    initTooltip();
    initModal();

    // Loading on
    const loading = document.getElementById('doge-loading');
    loading?.classList.remove('hidden');

    // 1) Carrega dados
    await loadAllData();

    // 2) Cena / câmera / renderer
    initScene();

    // 3) Monta a torre
    buildFromLayout(layoutData || { meta: {}, placements: [] });

    // 4) Primeiro render
    render();

    // === Fit inicial: use a MESMA pose do Reset (Home) ===
    (function fitInitialView(){
      // 1º frame: deixa layout/CSS assentarem
      requestAnimationFrame(()=>{
        // força um recálculo de aspect se algo mudou
        window.dispatchEvent(new Event('resize'));

        // 2º frame: calcula Home (BBox) e aplica Reset
        requestAnimationFrame(()=>{
          // calcula BBox, salva como Home (sem animar) e aplica exatamente a Home
          syncOrbitTargetToModel({ saveAsHome: true, animate: false });
          resetRotation();
          render();
        });
      });
    })();

    // 5) HUD (dropdowns, botões, sliders)
    initHUD();

    // 6) Aplica FVS/NC — injeta resolvers e COLOR_MAP
    applyFVSAndRefresh();

    // 7) Overlay 2D (render já com resolvers prontos)
    initOverlay2D();
    render2DCards();

    // 8) Picking (hover + click) no 3D
    initPicking();

    // 9) Loading off
    loading?.classList.add('hidden');

    // 10) Render final pós-setup
    render();

    // 11) Resize: NÃO refaça fit; apenas reaplique a órbita atual
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    window.addEventListener('resize', () => {
      if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
        lastW = window.innerWidth;
        lastH = window.innerHeight;
        applyOrbitToCamera(); // mantém alvo/raio/ângulos atuais
        render();
      }
    }, { passive: true });

    // 12) Input unificado (mouse + touch) – suave no mobile
    wireUnifiedInput();
  } catch (err){
    console.error('[viewer] erro no boot:', err);
  }
})();

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
// ESC fecha 2D se ativo (quando o modal não está aberto)
// ============================
window.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;

  const backdrop = document.getElementById('doge-modal-backdrop');
  const modalOpen = backdrop && backdrop.getAttribute('aria-hidden') === 'false';
  if (modalOpen) return;

  if (State.flatten2D >= 0.95){
    State.flatten2D = 0;
    hide2D();
    apply2DVisual(false);
    render();
  }
}, { passive:true });

// ============================
// Input unificado (Pointer Events)
// - 1 ponteiro:
//     * mouse esquerdo  -> ORBIT
//     * mouse direito   -> PAN
//     * touch           -> ORBIT
// - 2 ponteiros (touch): PINCH para zoom + PAN pelo movimento do centro
// - Wheel: zoom
// ============================
function wireUnifiedInput(){
  const cvs = document.getElementById('doge-canvas') || document.querySelector('#app canvas');
  if (!cvs) return;

  // Bloqueia gestos nativos do navegador (iOS, etc.)
  cvs.addEventListener('gesturestart',  e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gesturechange', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gestureend',    e => e.preventDefault?.(), { passive:false });

  const pointers = new Map(); // id -> {x,y,button,ptype,mode}
  let pinchPrevDist = 0;
  let pinchPrevMid  = null;

  const setModeForPointer = (pe) => {
    if (pe.pointerType === 'mouse') return (pe.button === 2) ? 'pan' : 'orbit';
    return 'orbit'; // touch 1 dedo = orbit
  };

  const getMidpoint = () => {
    const arr = [...pointers.values()];
    if (arr.length < 2) return null;
    return { x:(arr[0].x+arr[1].x)*0.5, y:(arr[0].y+arr[1].y)*0.5 };
  };

  const getDistance = () => {
    const arr = [...pointers.values()];
    if (arr.length < 2) return 0;
    return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
  };

  // Pointer Down
  cvs.addEventListener('pointerdown', (e)=>{
    cvs.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      button: e.button, ptype: e.pointerType,
      mode: setModeForPointer(e)
    });
    if (pointers.size === 2){
      pinchPrevDist = getDistance();
      pinchPrevMid  = getMidpoint();
    }
    e.preventDefault();
  }, { passive:false });

  // Pointer Move
  cvs.addEventListener('pointermove', (e)=>{
    if (!pointers.has(e.pointerId)) return;

    const p = pointers.get(e.pointerId);
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 1){
      const dx = p.x - px, dy = p.y - py;
      if (p.mode === 'pan') panDelta(dx, dy);
      else                  orbitDelta(dx, dy, p.ptype !== 'mouse');

    } else if (pointers.size === 2){
      // PINCH multiplicativo + PAN pelo centro
      const dist = getDistance();
      const mid  = getMidpoint();

      if (pinchPrevDist > 0 && dist > 0){
        let scale = dist / pinchPrevDist;
        const exponent = 0.85;
        scale = Math.pow(scale, exponent);
        scale = Math.max(0.8, Math.min(1.25, scale));
        zoomDelta({ scale }, true);
      }

      if (pinchPrevMid && mid){
        const mdx = mid.x - pinchPrevMid.x;
        const mdy = mid.y - pinchPrevMid.y;
        if (mdx || mdy) panDelta(mdx, mdy);
      }

      pinchPrevDist = dist;
      pinchPrevMid  = mid;
    }

    e.preventDefault();
  }, { passive:false });

  // Pointer Up/Cancel
  const clearPointer = (e)=>{
    pointers.delete(e.pointerId);
    if (pointers.size < 2){
      pinchPrevDist = 0;
      pinchPrevMid  = null;
    }
  };
  cvs.addEventListener('pointerup', clearPointer,        { passive:true });
  cvs.addEventListener('pointercancel', clearPointer,    { passive:true });
  cvs.addEventListener('lostpointercapture', clearPointer,{ passive:true });

  // Wheel (desktop/trackpad)
  cvs.addEventListener('wheel', (e)=>{
    e.preventDefault();

    const unit = (e.deltaMode === 1) ? 33 : (e.deltaMode === 2) ? 120 : 1;
    const dy   = e.deltaY * unit;

    let scale = Math.exp(dy * 0.0011);
    scale = Math.max(0.8, Math.min(1.25, scale));

    zoomDelta({ scale }, /*isPinch=*/false);
  }, { passive:false });

  // Botão direito = pan (somente mouse)
  cvs.addEventListener('contextmenu', e => e.preventDefault(), { passive:false });
}
