// assets/js/toggle-3d.js
(function () {
  const BTN_ID = 'btn-3d';
  const CLOSE_ID = 'btn-3d-close';
  const OVERLAY_ID = 'viewer3d-overlay';
  const IFRAME_ID = 'viewer3d-iframe';
  const VIEWER_URL = './viewer.html';

  let overlay, iframe, btnOpen, btnClose, svgEl;

  function qs(id) { return document.getElementById(id); }

  function isOpen() { return overlay && !overlay.hasAttribute('hidden'); }

  function open3D() {
    if (!overlay) return;
    overlay.removeAttribute('hidden');
    if (svgEl) svgEl.style.visibility = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    if (!iframe.src) {
      iframe.src = VIEWER_URL;
      iframe.addEventListener('load', sendColors, { once: true });
    } else {
      sendColors();
    }
  }

  function close3D() {
    if (!overlay) return;
    overlay.setAttribute('hidden', '');
    if (svgEl) svgEl.style.visibility = '';
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  function sendColors() {
    try {
      const payload = window.__FVS_COLOR_MAP__ || { mode: null, colors: {} };
      iframe?.contentWindow?.postMessage({ type: 'fvsColorMap', payload }, '*');
    } catch (e) {
      console.warn('Falha ao enviar cores ao viewer 3D:', e);
    }
  }

  function onColorMapChanged() {
    if (isOpen()) sendColors();
  }

  document.addEventListener('DOMContentLoaded', () => {
    overlay  = qs(OVERLAY_ID);
    iframe   = qs(IFRAME_ID);
    btnOpen  = qs(BTN_ID);
    btnClose = qs(CLOSE_ID);
    svgEl    = qs('svg');

    btnOpen && btnOpen.addEventListener('click', () => (isOpen() ? close3D() : open3D()));
    btnClose && btnClose.addEventListener('click', close3D);
  });

  // quando o 2D recalcula as cores, reenviamos pro 3D se estiver aberto
  window.addEventListener('fvsColorMapChanged', onColorMapChanged);

  // util pra debug
  window.toggle3D = { open: open3D, close: close3D, sendColors, isOpen };
})();

// Se o iframe pedir (handshake), reenvia o mapa atual
window.addEventListener('message', (e)=>{
  const t = e.data && e.data.type;
  if (t === 'ready-3d' || t === 'requestColorMap') {
    try {
      const payload = window.__FVS_COLOR_MAP__ || { mode:null, colors:{} };
      const iframe = document.getElementById('viewer3d-iframe');
      iframe?.contentWindow?.postMessage({ type:'fvsColorMap', payload }, '*');
    } catch (err) {
      console.warn('Falha ao responder ready-3d:', err);
    }
  }
});
