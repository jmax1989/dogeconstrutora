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
  INITIAL_PHI
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
// Boot
// ============================
(async function boot(){
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
const { bbox } = buildFromLayout(layoutData || { meta:{}, placements:[] });


// ...

// No final do boot(), depois do primeiro render():
render();

// === Fit inicial adiado (garante viewport/HUD estabilizados) ===
(function fitInitialView(){
  // 1º frame: deixa layout/CSS assentarem
  requestAnimationFrame(()=>{
    // força um recálculo de aspect se algo mudou
    window.dispatchEvent(new Event('resize'));

    // 2º frame: faz o fit-to-bbox já com aspect correto
    requestAnimationFrame(()=>{
      recenterCamera({
        // sem bbox: ele computa a BBox atual da torre
        theta: INITIAL_THETA,    // 90° anti-horário (a “frente” que você pediu)
        phi:   INITIAL_PHI,      // inclinação padrão (~63°)
        margin: 1.20,            // pode ajustar se quiser mais “respiro”
        animate: false
      });
      render();
    });
  });
})();


// Enquadra 100% e coloca “de frente”
recenterCamera({ bbox, theta: INITIAL_THETA, phi: INITIAL_PHI, animate: false, margin: 1.18 });

  // 4) Ajuste inicial — mesmo enquadramento usado no recenter
  if (bbox && bbox.isBox3){
    recenterCamera({ bbox, verticalOffsetRatio: 0.12 });
  } else {
    applyOrbitToCamera();
  }

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

  // 11) Reaplica o offset vertical no resize mantendo enquadramento
  window.addEventListener('resize', ()=> {
    const torre = getTorre();
    if (!torre) return;
    const bb = new THREE.Box3().setFromObject(torre);
    if (!bb || !bb.isBox3) return;
    recenterCamera({ bbox: bb, verticalOffsetRatio: 0.12 });
  }, { passive:true });

  // 12) Input unificado (mouse + touch) – suave no mobile
  wireUnifiedInput();
})().catch(err=>{
  console.error('[viewer] erro no boot:', err);
});


// ============================
// Selecionar também o grupo 3D ao clicar num card 2D
// (o overlay já abre o modal; aqui apenas sincronizamos a seleção 3D)
// ============================
// === Input unificado (mouse + touch) ===
// Requer: orbitDelta(dx,dy,isTouch?), panDelta(dx,dy), zoomDelta(sign,isTouch?)
function wireUnifiedInput(){
  const cvs =
    document.getElementById('doge-canvas') ||
    document.querySelector('#app canvas') ||
    document.querySelector('canvas');

  if (!cvs) {
    console.warn('[input] canvas não encontrado para bind de gestos');
    return;
  }

  // -------- Mouse (desktop) --------
  let isDragging = false;
  let lastX = 0, lastY = 0;
  let dragButton = 0; // 0 nenhum, 1 esquerdo, 2 meio, 3 direito

  // rolagem = zoom proporcional (isTouch=false)
  const onWheel = (e)=>{
    // evita zoom da página
    e.preventDefault();
    const dy = e.deltaY || 0;
    const sign = dy > 0 ? +1 : -1;
    // passo calculado dentro de zoomDelta (modo desktop)
    zoomDelta(sign, /*isTouch=*/false);
  };

  const onPointerDown = (e)=>{
    // apenas primário inicia “drag de órbita”; botões 2/3 → pan
    isDragging = true;
    dragButton = (e.buttons === 4) ? 2 : (e.buttons === 2 ? 3 : 1);
    lastX = e.clientX; lastY = e.clientY;
    cvs.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e)=>{
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (dragButton === 1){
      // botão esquerdo → ORBIT
      orbitDelta(dx, dy, /*isTouch=*/false);
    } else {
      // botão do meio ou direito → PAN
      panDelta(dx, dy);
    }
  };

  const onPointerUp = (e)=>{
    isDragging = false;
    dragButton = 0;
    cvs.releasePointerCapture?.(e.pointerId);
  };

  // -------- Touch (mobile) --------
  // 1 dedo: orbit suave   |  2 dedos: pinch-zoom suave (+ pan a dois dedos)
  const touches = new Map(); // id -> {x,y}
  let lastOneX=0, lastOneY=0;
  let lastPinchDist = null;
  let lastPinchCenter = null;

  const dist = (a,b)=> Math.hypot(a.x - b.x, a.y - b.y);
  const center = (a,b)=> ({ x:(a.x+b.x)/2, y:(a.y+b.y)/2 });

  const onTouchStart = (e)=>{
    // precisamos do preventDefault para bloquear o zoom do navegador
    e.preventDefault();
    for (const t of e.changedTouches){
      touches.set(t.identifier, { x:t.clientX, y:t.clientY });
    }
    if (touches.size === 1){
      const [only] = touches.values();
      lastOneX = only.x; lastOneY = only.y;
    } else if (touches.size === 2){
      const it = touches.values();
      const A = it.next().value, B = it.next().value;
      lastPinchDist = dist(A,B);
      lastPinchCenter = center(A,B);
    }
  };

  const onTouchMove = (e)=>{
    e.preventDefault();
    for (const t of e.changedTouches){
      if (touches.has(t.identifier)){
        touches.set(t.identifier, { x:t.clientX, y:t.clientY });
      }
    }

    if (touches.size === 1){
      // ORBIT (suave)
      const [cur] = touches.values();
      const dx = cur.x - lastOneX;
      const dy = cur.y - lastOneY;
      lastOneX = cur.x; lastOneY = cur.y;
      orbitDelta(dx, dy, /*isTouch=*/true);

    } else if (touches.size >= 2){
      // PINCH-ZOOM (suave) + PAN a dois dedos
      const it = touches.values();
      const A = it.next().value, B = it.next().value;

      const d = dist(A,B);
      const c = center(A,B);

      if (lastPinchDist != null){
        // delta de zoom: sinal do gesto (abrindo/fechando)
        const delta = d - lastPinchDist;
        if (Math.abs(delta) > 0.1){
          const sign = delta > 0 ? -1 : +1; // abrir = aproximar (sign negativo reduz radius)
          zoomDelta(sign, /*isTouch=*/true);
        }
        // pan “a dois dedos”: deslocamento do centro
        const cdx = c.x - lastPinchCenter.x;
        const cdy = c.y - lastPinchCenter.y;
        if (Math.abs(cdx) + Math.abs(cdy) > 0.1){
          panDelta(cdx, cdy);
        }
      }

      lastPinchDist = d;
      lastPinchCenter = c;
    }
  };

  const onTouchEnd = (e)=>{
    e.preventDefault();
    for (const t of e.changedTouches){
      touches.delete(t.identifier);
    }
    if (touches.size < 2){
      lastPinchDist = null;
      lastPinchCenter = null;
    }
    if (touches.size === 1){
      const [only] = touches.values();
      lastOneX = only.x; lastOneY = only.y;
    }
  };

  // Bind listeners
  cvs.addEventListener('wheel', onWheel, { passive:false });

  cvs.addEventListener('pointerdown', onPointerDown, { passive:true });
  window.addEventListener('pointermove', onPointerMove, { passive:true });
  window.addEventListener('pointerup',   onPointerUp,   { passive:true });
  window.addEventListener('pointercancel', onPointerUp, { passive:true });

  // Touch separado para usar preventDefault (impede zoom do navegador)
  cvs.addEventListener('touchstart', onTouchStart, { passive:false });
  cvs.addEventListener('touchmove',  onTouchMove,  { passive:false });
  cvs.addEventListener('touchend',   onTouchEnd,   { passive:false });
  cvs.addEventListener('touchcancel',onTouchEnd,   { passive:false });
}

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
  // Aqui só garantimos que não há seleção/zoom do navegador
  cvs.addEventListener('gesturestart', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gesturechange', e => e.preventDefault?.(), { passive:false });
  cvs.addEventListener('gestureend', e => e.preventDefault?.(), { passive:false });

  // Estado de ponteiros
  const pointers = new Map(); // id -> {x,y,button,ptype,mode}
  let pinchPrevDist = 0;
  let pinchPrevMid  = null;

  const setModeForPointer = (pe) => {
    // mouse: button 2 = pan; caso contrário orbit
    if (pe.pointerType === 'mouse'){
      return (pe.button === 2) ? 'pan' : 'orbit';
    }
    // touch: 1 dedo -> orbit (pan fica para gesto de 2 dedos)
    return 'orbit';
  };

  const getMidpoint = () => {
    const arr = [...pointers.values()];
    if (arr.length < 2) return null;
    return {
      x: (arr[0].x + arr[1].x) * 0.5,
      y: (arr[0].y + arr[1].y) * 0.5
    };
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
    // Captura o ponteiro para evitar "pulos" ao sair da área
    cvs.setPointerCapture?.(e.pointerId);

    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      button: e.button,
      ptype: e.pointerType,
      mode: setModeForPointer(e)
    });

    // Se virou pinch (2 dedos), inicializa estado
    if (pointers.size === 2){
      pinchPrevDist = getDistance();
      pinchPrevMid  = getMidpoint();
    }

    // Evita texto/scroll do navegador
    e.preventDefault();
  }, { passive:false });

  // Pointer Move
  cvs.addEventListener('pointermove', (e)=>{
    if (!pointers.has(e.pointerId)) return;

    const p = pointers.get(e.pointerId);
    const prevX = p.x, prevY = p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 1){
      // 1 ponteiro: ORBIT ou PAN
      const dx = p.x - prevX;
      const dy = p.y - prevY;

      if (p.mode === 'pan'){
        panDelta(dx, dy);
      } else {
        // ORBIT – usa sensibilidade mobile igual à do 2D
        orbitDelta(dx, dy, p.ptype !== 'mouse');
      }
    } else if (pointers.size === 2){
      // 2 ponteiros: PINCH + PAN pelo centro
      const dist = getDistance();
      const mid  = getMidpoint();

      if (pinchPrevDist > 0){
        const dScale = dist - pinchPrevDist;
        if (Math.abs(dScale) > 0.5){
          // aproximação suave: sinal do delta
          zoomDelta(-Math.sign(dScale)); // gesto padrão: afastar dedos -> zoom out
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

  // Se o modal estiver aberto, deixamos o handler do modal agir.
  const modalBackdrop = document.getElementById('doge-modal-backdrop');
  const modalOpen = modalBackdrop && modalBackdrop.classList.contains('show');
  if (modalOpen) return;

  // Se 2D estiver ativo, desliga


});
