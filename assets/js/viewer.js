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
  resetRotation,
  syncOrbitTargetToModel,
  orbitTwist            // <<< novo: roll por gesto de torção (twist)
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
    initTooltip();
    initModal();

    const loading = document.getElementById('doge-loading');
    loading?.classList.remove('hidden');

    await loadAllData();

    initScene();

    buildFromLayout(layoutData || { meta: {}, placements: [] });

    render();

    // Fit inicial = mesma Home do Reset (sem corte)
    (function fitInitialView(){
      requestAnimationFrame(()=>{
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(()=>{
          syncOrbitTargetToModel({ saveAsHome: true, animate: false });
          resetRotation();
          render();
        });
      });
    })();

    initHUD();
    applyFVSAndRefresh();

    initOverlay2D();
    render2DCards();

    initPicking();

    loading?.classList.add('hidden');
    render();

    // Resize: não refaça fit; só reaplique órbita
    let lastW = window.innerWidth, lastH = window.innerHeight;
    window.addEventListener('resize', () => {
      if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
        lastW = window.innerWidth; lastH = window.innerHeight;
        applyOrbitToCamera();
        render();
      }
    }, { passive: true });

    // Input
    wireUnifiedInput();
  } catch (err){
    console.error('[viewer] erro no boot:', err);
  }
})();

// ============================
// Seleção 3D a partir do 2D
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
// ESC fecha 2D se ativo (sem modal)
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
// - 1 ponteiro: orbit (esq) / pan (dir) / touch=orbit
// - 2 ponteiros: pinch (zoom) + pan do centro + twist (roll)
// - Wheel: zoom
// ============================
function wireUnifiedInput(){
  const cvs = document.getElementById('doge-canvas') || document.querySelector('#app canvas');
  if (!cvs) return;

  // Bloqueia gestos nativos (iOS)
  cvs.addEventListener('gesturestart',  e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gesturechange', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gestureend',    e => e.preventDefault?.(), { passive:false });

  const pointers = new Map(); // id -> {x,y,button,ptype,mode}
  let pinchPrevDist = 0;
  let pinchPrevMid  = null;
  let pinchPrevAng  = 0; // <<< ângulo entre os dedos no frame anterior

  const setModeForPointer = (pe) => {
    if (pe.pointerType === 'mouse') return (pe.button === 2) ? 'pan' : 'orbit';
    return 'orbit';
  };

  const arrPts = () => [...pointers.values()];
  const getMidpoint = () => {
    const a = arrPts(); if (a.length < 2) return null;
    return { x:(a[0].x+a[1].x)*0.5, y:(a[0].y+a[1].y)*0.5 };
  };
  const getDistance = () => {
    const a = arrPts(); if (a.length < 2) return 0;
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };
  const getAngle = () => {
    const a = arrPts(); if (a.length < 2) return 0;
    const dx = a[1].x - a[0].x;
    const dy = a[1].y - a[0].y;
    // Atenção: Y de tela cresce para baixo; atan2 já reflete isso.
    return Math.atan2(dy, dx); // rad
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
      pinchPrevAng  = getAngle();
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
      // === PINCH (zoom) ===
      const dist = getDistance();
      if (pinchPrevDist > 0 && dist > 0){
        let scale = dist / pinchPrevDist;
        const exponent = 0.85;
        scale = Math.pow(scale, exponent);
        scale = Math.max(0.8, Math.min(1.25, scale));
        zoomDelta({ scale }, true);
      }
      pinchPrevDist = dist;

      // === PAN do centro ===
      const mid  = getMidpoint();
      if (pinchPrevMid && mid){
        const mdx = mid.x - pinchPrevMid.x;
        const mdy = mid.y - pinchPrevMid.y;
        if (mdx || mdy) panDelta(mdx, mdy);
      }
      pinchPrevMid  = mid;

      // === TWIST (roll) — rotação de dois dedos ===
      const ang = getAngle();
      let dAng = ang - pinchPrevAng;
      // normaliza para [-PI, PI] para evitar saltos
      if (dAng >  Math.PI) dAng -= 2*Math.PI;
      if (dAng < -Math.PI) dAng += 2*Math.PI;

      // Sinal para “seguir o gesto”: em telas com Y pra baixo,
      // o sentido horário do par de dedos dá dAng > 0.
      // Se sentir invertido, troque por (-dAng).
      if (Math.abs(dAng) > 1e-4) {
        orbitTwist(dAng);
      }
      pinchPrevAng = ang;
    }

    e.preventDefault();
  }, { passive:false });

  // Pointer Up/Cancel
  const clearPointer = (e)=>{
    pointers.delete(e.pointerId);
    if (pointers.size < 2){
      pinchPrevDist = 0;
      pinchPrevMid  = null;
      pinchPrevAng  = 0;
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
