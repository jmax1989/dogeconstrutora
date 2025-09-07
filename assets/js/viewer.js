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
  camera,
  orbitDelta,
  panDelta,
  zoomDelta,
  recenterCamera,
  INITIAL_THETA,
  INITIAL_PHI,
  refreshModelPivotAndFit   // <- adicionamos para hookar/logar também
} from './scene.js';
import {
  buildFromLayout,
  getTorre,
  apply2DVisual
} from './geometry.js';
import { initOverlay2D, render2DCards, hide2D } from './overlay2d.js';
import { initPicking, selectGroup } from './picking.js';
import { initModal } from './modal.js';
import { initHUD, applyFVSAndRefresh } from './hud.js';

// ============================
// DEBUG helpers (logs, hooks e watchdog anti-“coice”)
// ============================

// acesso a scene/renderer para medir projeção em tela
import { scene, renderer } from './scene.js';

// Hook: só LOGA chamadas a fits (não bloqueia)
let __DOGE_BOOT_T0 = performance.now();
function __doge_installFitHooks_LOG_ONLY() {
  if (window.__DOGE_HOOKS_ON) return;
  window.__DOGE_HOOKS_ON = true;

  const origRecenter = recenterCamera;
  const origRefresh  = refreshModelPivotAndFit;

  const wrap = (name, orig) => (...args) => {
    const t = Math.round(performance.now() - __DOGE_BOOT_T0);
    console.warn(`[DOGE:CALL ${name}] t=${t}ms`, { args });
    console.trace(`[DOGE:TRACE ${name}]`);
    return orig(...args);
  };

  window.__DOGE_ORIG_RECENTER = origRecenter;
  window.__DOGE_ORIG_REFRESH  = origRefresh;

  // @ts-ignore
  window.recenterCamera = wrap('recenterCamera', origRecenter);
  // @ts-ignore
  window.refreshModelPivotAndFit = wrap('refreshModelPivotAndFit', origRefresh);
}

// medir topo do modelo em px de tela
function __doge_worldTopToScreen() {
  const torre = getTorre?.();
  const root = torre || scene;
  const bb = new THREE.Box3().setFromObject(root);
  if (!bb) return null;
  const topCenter = new THREE.Vector3(
    (bb.min.x + bb.max.x) * 0.5,
    bb.max.y,
    (bb.min.z + bb.max.z) * 0.5
  );
  const v = topCenter.clone().project(camera);
  const size = renderer.getSize(new THREE.Vector2());
  return { x: (v.x * 0.5 + 0.5) * size.x, y: (-v.y * 0.5 + 0.5) * size.y };
}

// ============================
// Boot
// ============================
(async function boot(){
  try {
    __doge_installFitHooks_LOG_ONLY(); // logar qualquer fit chamado por terceiros

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

    // Desliga auto-fit interno se existir
    window.disableAutoFit?.();

    // 3) Monta a torre
    const { bbox } = buildFromLayout(layoutData || { meta:{}, placements:[] });

    // Primeiro render só para estabilizar GL
    render();

    // === Fit inicial controlado + watchdog anti-“coice” ===
    (function fitInitialViewGuarded(){
      // 1º frame: deixa DOM/CSS estabilizar e atualiza aspect
      requestAnimationFrame(()=>{
        window.dispatchEvent(new Event('resize'));

        // 2º frame: faz UM ÚNICO fit “de frente”
        requestAnimationFrame(()=>{
          const doFit = () => {
            const opts = {
              theta:  INITIAL_THETA,
              phi:    INITIAL_PHI,
              margin: 1.22,          // respiro um pouco maior
              animate:false
            };
            if (bbox && bbox.isBox3) opts.bbox = bbox;
            recenterCamera(opts);

            // offset vertical leve para afastar do topo (se tiver bbox)
            if (bbox && bbox.isBox3) {
              recenterCamera({ bbox, verticalOffsetRatio: 0.06, animate:false });
            }
            render();
          };

          doFit();

          // Watchdog 1.2s: se detectar corte/drift, refaz fit e loga stack 1x
          const T_GUARD = 1200;
          const t0 = performance.now();
          const target0 = { x: State.orbitTarget.x, y: State.orbitTarget.y, z: State.orbitTarget.z };
          const radius0 = State.radius;
          let logged = false;

          function guardTick(){
            const dt = performance.now() - t0;
            const scr = __doge_worldTopToScreen();
            const cutTop = scr && scr.y < 0;
            const driftTarget =
              Math.abs(State.orbitTarget.x - target0.x) > 1e-3 ||
              Math.abs(State.orbitTarget.y - target0.y) > 1e-3 ||
              Math.abs(State.orbitTarget.z - target0.z) > 1e-3 ||
              Math.abs(State.radius - radius0) > 1e-3;

            if ((cutTop || driftTarget) && !logged) {
              logged = true;
              console.warn('[DOGE:guard] drift/cut detectado em', Math.round(dt), 'ms', {
                cutTop, driftTarget, orbitTarget: {...State.orbitTarget}, radius: State.radius, scr
              });
              console.trace('[DOGE:guard:stack]');
            }

            if (cutTop || driftTarget) {
              doFit();
            }

            if (dt < T_GUARD) requestAnimationFrame(guardTick);
          }
          requestAnimationFrame(guardTick);
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

    // 10) Render inicial
    render();

    // 11) Resize: sem novo fit — só re-projeta para evitar “coice”
    window.addEventListener('resize', ()=> {
      applyOrbitToCamera();
      render();
    }, { passive:true });

    // 12) Input unificado
    wireUnifiedInput();
  } catch (err){
    console.error('[viewer] erro no boot:', err);
  }
})().catch(err=>{
  console.error('[viewer] erro no boot (outer):', err);
});

// ============================
// Selecionar também o grupo 3D ao clicar num card 2D
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

  // Importantíssimo: já definimos touch-action: none no scene.js
  cvs.addEventListener('gesturestart', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gesturechange', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gestureend', e => e.preventDefault?.(), { passive:false });

  const pointers = new Map(); // id -> {x,y,button,ptype,mode}
  let pinchPrevDist = 0;
  let pinchPrevMid  = null;

  const setModeForPointer = (pe) => {
    if (pe.pointerType === 'mouse'){
      return (pe.button === 2) ? 'pan' : 'orbit';
    }
    return 'orbit';
  };

  const getMidpoint = () => {
    const arr = [...pointers.values()];
    if (arr.length < 2) return null;
    return { x: (arr[0].x + arr[1].x) * 0.5, y: (arr[0].y + arr[1].y) * 0.5 };
  };
  const getDistance = () => {
    const arr = [...pointers.values()];
    if (arr.length < 2) return 0;
    const dx = arr[0].x - arr[1].x;
    const dy = arr[0].y - arr[1].y;
    return Math.hypot(dx, dy);
  };

  // Pointer Down
  cvs.addEventListener('pointerdown', (e)=>{
    cvs.setPointerCapture?.(e.pointerId);

    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      button: e.button,
      ptype: e.pointerType,
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
    const prevX = p.x, prevY = p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 1){
      const dx = p.x - prevX;
      const dy = p.y - prevY;

      if (p.mode === 'pan'){
        panDelta(dx, dy);
      } else {
        orbitDelta(dx, dy, p.ptype !== 'mouse');
      }
    } else if (pointers.size === 2){
      const dist = getDistance();
      const mid  = getMidpoint();

      if (pinchPrevDist > 0){
        const dScale = dist - pinchPrevDist;
        if (Math.abs(dScale) > 0.5){
          zoomDelta(-Math.sign(dScale));
        }
      }
      if (pinchPrevMid){
        const mdx = mid.x - pinchPrevMid.x;
        const mdy = mid.y - pinchPrevMid.y;
        if (Math.abs(mdx) > 0 || Math.abs(mdy) > 0){
          panDelta(mdx, mdy);
        }
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
  cvs.addEventListener('pointerup', clearPointer, { passive:true });
  cvs.addEventListener('pointercancel', clearPointer, { passive:true });
  cvs.addEventListener('lostpointercapture', clearPointer, { passive:true });

  // Wheel (desktop)
  cvs.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const sign = Math.sign(e.deltaY);
    zoomDelta(sign);
  }, { passive:false });

  // Botão direito = pan (somente mouse)
  cvs.addEventListener('contextmenu', e => e.preventDefault(), { passive:false });
}

// ============================
// ESC fecha 2D se ativo (quando o modal não está aberto)
// ============================
window.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;

  const modalBackdrop = document.getElementById('doge-modal-backdrop');
  const modalOpen = modalBackdrop && modalBackdrop.classList.contains('show');
  if (modalOpen) return;

  // (mantido conforme sua versão; se quiser, podemos restaurar o hide2D aqui)
  // if (State.flatten2D >= 0.95) { State.flatten2D = 0; hide2D(); apply2DVisual(false); render(); }
}, { passive:true });
