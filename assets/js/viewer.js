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
  orbitTwist            // roll por gesto de torção (twist)
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

// === DEBUG: medir top do prédio em pixels de tela ===
import { scene, renderer, camera } from './scene.js';

function __doge_getBBoxRoot() {
  const torre = getTorre?.();
  return torre || scene;
}
function __doge_computeBBox(root) {
  try {
    const bb = new THREE.Box3().setFromObject(root);
    if (!Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
    return bb;
  } catch (e) {
    return null;
  }
}
function __doge_worldToScreen(v3) {
  const v = v3.clone().project(camera);
  const size = renderer.getSize(new THREE.Vector2());
  return {
    x: (v.x * 0.5 + 0.5) * size.x,
    y: (-v.y * 0.5 + 0.5) * size.y,
    w: size.x,
    h: size.y
  };
}
function __doge_measureScreen(label = '') {
  const root = __doge_getBBoxRoot();
  const bb = __doge_computeBBox(root);
  if (!bb) {
    console.log('[DOGE:measure]', label, 'bbox=null');
    return null;
  }
  const topCenter = new THREE.Vector3(
    (bb.min.x + bb.max.x) * 0.5,
    bb.max.y,
    (bb.min.z + bb.max.z) * 0.5
  );
  const scr = __doge_worldToScreen(topCenter);
  const info = {
    label,
    topPx: { x: Math.round(scr.x), y: Math.round(scr.y) },
    viewport: { w: scr.w, h: scr.h },
    marginTopPx: Math.round(scr.y),
    cutTop: scr.y < 0,
    orbitTarget: { x: +State.orbitTarget.x.toFixed?.(3) ?? State.orbitTarget.x, y: +State.orbitTarget.y?.toFixed?.(3) ?? State.orbitTarget.y, z: +State.orbitTarget.z?.toFixed?.(3) ?? State.orbitTarget.z },
    radius: Number(State.radius).toFixed(3),
    theta: Number(State.theta).toFixed(3),
    phi: Number(State.phi).toFixed(3),
    camPos: {
      x: Number(camera.position.x).toFixed(3),
      y: Number(camera.position.y).toFixed(3),
      z: Number(camera.position.z).toFixed(3)
    }
  };
  console.log('[DOGE:measure]', info);
  return info;
}
function __doge_watchForJumps(ms = 2000, pxJump = 8) {
  let prevY = null;
  const t0 = performance.now();
  function tick() {
    const m = __doge_measureScreen('watch');
    if (m) {
      if (prevY !== null) {
        const dy = m.topPx.y - prevY;
        if (Math.abs(dy) >= pxJump) {
          console.warn('[DOGE:jump]', `ΔY=${Math.round(dy)}px`, 'em', Math.round(performance.now() - t0), 'ms');
          console.warn('[DOGE:jump:after]', m);
        }
      }
      prevY = m.topPx.y;
    }
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

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

    __doge_measureScreen('apos build (antes do 1o render)');
    render();
    __doge_measureScreen('apos 1o render');

    // Fit inicial = mesma Home do Reset (sem corte)
    (function fitInitialView(){
      requestAnimationFrame(()=>{
        __doge_measureScreen('fit: antes de resize');
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(()=>{
          __doge_measureScreen('fit: antes de syncOrbitTargetToModel');
          syncOrbitTargetToModel({ saveAsHome: true, animate: false });
          __doge_measureScreen('fit: antes de resetRotation');
          resetRotation();
          render();
          __doge_measureScreen('fit: apos resetRotation');
          __doge_watchForJumps(2000, 8);
        });
      });
    })();

    initHUD();
    applyFVSAndRefresh();

    initOverlay2D();
    render2DCards();

    initPicking();

    loading?.classList.add('hidden');

    __doge_measureScreen('final do boot (antes do render final)');
    render();
    __doge_measureScreen('final do boot (apos render final)');

    // Resize: não refaça fit; só reaplique órbita
    let lastW = window.innerWidth, lastH = window.innerHeight;
    window.addEventListener('resize', () => {
      if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
        __doge_measureScreen('resize: antes');
        lastW = window.innerWidth; lastH = window.innerHeight;
        applyOrbitToCamera();
        render();
        __doge_measureScreen('resize: apos');
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
// Tracking da tecla Space (Space + esquerdo = Pan)
// ============================
let __spacePressed = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { __spacePressed = true; e.preventDefault(); }
}, { passive:false });
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') __spacePressed = false;
}, { passive:true });

// ============================
// Input unificado (Pointer Events)
// PC:
//   - Pan: botão do meio OU Space + esquerdo
//   - Orbit (yaw/pitch): botão esquerdo
//   - Twist (roll): botão direito
//   - Zoom: scroll
// Touch:
//   - 1 dedo = orbit
//   - 2 dedos = pinch (zoom) + pan do centro + twist (ângulo entre dedos)
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
  let pinchPrevAng  = 0; // ângulo entre dedos no frame anterior

  // sensibilidade do twist com botão direito (mouse)
  const TWIST_SENS_MOUSE = 0.012; // ajuste aqui se quiser mais/menos sensível

  const setModeForPointer = (pe) => {
    if (pe.pointerType === 'mouse') {
      if (pe.button === 1) return 'pan';                 // botão do meio
      if (pe.button === 2) return 'twist';               // botão direito
      if (pe.button === 0 && __spacePressed) return 'pan'; // Space + esquerdo
      return 'orbit';                                    // esquerdo
    }
    // touch 1 dedo = orbit
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

      switch (p.mode) {
        case 'pan':
          panDelta(dx, dy);
          break;
        case 'twist':
          // botão direito: roll em torno do eixo de visão
          // segue o movimento horizontal (troque o sinal se preferir o inverso)
          orbitTwist(dx * TWIST_SENS_MOUSE);
          break;
        default: // 'orbit'
          orbitDelta(dx, dy, p.ptype !== 'mouse'); // yaw/pitch (sem roll)
      }

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
      if (dAng >  Math.PI) dAng -= 2*Math.PI;
      if (dAng < -Math.PI) dAng += 2*Math.PI;

      // Se preferir o sentido oposto no seu device, troque para orbitTwist(+dAng)
      if (Math.abs(dAng) > 1e-4) {
        orbitTwist(-dAng);
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

  // Wheel (desktop/trackpad) = zoom
  cvs.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const unit = (e.deltaMode === 1) ? 33 : (e.deltaMode === 2) ? 120 : 1;
    const dy   = e.deltaY * unit;
    let scale = Math.exp(dy * 0.0011);
    scale = Math.max(0.8, Math.min(1.25, scale));
    zoomDelta({ scale }, /*isPinch=*/false);
  }, { passive:false });

  // Bloqueia menu do botão direito (necessário para twist com right-drag)
  cvs.addEventListener('contextmenu', e => e.preventDefault(), { passive:false });
}
