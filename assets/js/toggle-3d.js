// assets/js/toggle-3d.js
(function () {
  const BTN_ID     = 'btn-3d';
  const CLOSE_ID   = 'btn-3d-close';
  const OVERLAY_ID = 'viewer3d-overlay';
  const IFRAME_ID  = 'viewer3d-iframe';
  const VIEWER_URL = './viewer.html';

  let overlay, iframe, btnOpen, btnClose, svgEl;

  function qs(id) { return document.getElementById(id); }
  function isOpen() { return overlay && !overlay.hasAttribute('hidden'); }

  function getColorMap() {
    // sempre mande default (cinza) junto
    const map = window.__FVS_COLOR_MAP__ || { mode: null, colors: {}, default: '#6e7681' };
    if (!('default' in map)) map.default = '#6e7681';
    return map;
  }

  function sendColors() {
    try {
      if (!iframe || !iframe.contentWindow) return;
      const payload = getColorMap();
      iframe.contentWindow.postMessage({ type: 'fvsColorMap', payload }, '*');
    } catch (e) {
      console.warn('Falha ao enviar cores ao viewer 3D:', e);
    }
  }

  function open3D() {
    if (!overlay) return;
    overlay.removeAttribute('hidden');
    if (svgEl) svgEl.style.visibility = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // carrega o viewer se necessário
    if (!iframe.src) {
      iframe.addEventListener('load', () => {
        // ao carregar, já tenta enviar o mapa atual
        sendColors();
      }, { once: true });
      iframe.src = VIEWER_URL;
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

  function onColorMapChanged() {
    if (isOpen()) sendColors();
  }

  document.addEventListener('DOMContentLoaded', () => {
    overlay  = qs(OVERLAY_ID);
    iframe   = qs(IFRAME_ID);
    btnOpen  = qs(BTN_ID);
    btnClose = qs(CLOSE_ID);
    svgEl    = qs('svg');

    if (btnOpen)  btnOpen.addEventListener('click', () => (isOpen() ? close3D() : open3D()));
    if (btnClose) btnClose.addEventListener('click', close3D);

    // Esc fecha o 3D
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close3D();
    });
  });

  // quando o 2D recalcula as cores, reenviamos pro 3D se estiver aberto
  window.addEventListener('fvsColorMapChanged', onColorMapChanged);

  // util pra debug no console
  window.toggle3D = { open: open3D, close: close3D, sendColors, isOpen };

  // Handshake: se o iframe avisar que está pronto, reenviamos o mapa atual
  window.addEventListener('message', (e) => {
    const t = e?.data?.type;
    if (t === 'ready-3d' || t === 'requestColorMap') {
      try {
        sendColors();
      } catch (err) {
        console.warn('Falha ao responder ready-3d:', err);
      }
    }
  });
})();
