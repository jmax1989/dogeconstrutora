// assets/js/toggle-3d.js
(function () {
  // IDs/seletores usados pelo index.html (overlay + iframe do viewer)
  const BTN_ID     = 'btn-3d';            // botão "Abrir 3D" (opcional)
  const CLOSE_ID   = 'btn-3d-close';      // botão "Fechar 3D" (opcional)
  const OVERLAY_ID = 'viewer3d-overlay';  // overlay que contém o iframe
  const IFRAME_ID  = 'viewer3d-iframe';   // iframe onde o viewer.html é carregado
  const VIEWER_URL = './viewer.html';     // página do viewer

  let overlay, iframe, btnOpen, btnClose;

  // Utilitários
  const qs = (id) => document.getElementById(id);
  const isOpen = () => overlay && !overlay.hasAttribute('hidden');

  // ======= MAPA DE CORES (FVS) =======
  // Espera que main.js/popule window.__FVS_COLOR_MAP__
  function getColorMap() {
    // Sempre manda também um default (cinza) para casos sem status
    const map = window.__FVS_COLOR_MAP__ || { mode: null, colors: {}, default: '#6e7681' };
    // Clona para evitar mutações acidentais
    return JSON.parse(JSON.stringify(map));
  }

  function postToViewer(payload) {
    try {
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(payload, '*');
    } catch (err) {
      console.warn('postToViewer falhou:', err);
    }
  }

  function sendColors() {
    const map = getColorMap();
    postToViewer({ type: 'colorMap', payload: map });
  }

  // ======= ABRIR / FECHAR 3D =======
  function ensureViewerLoaded() {
    if (!iframe) return;
    const src = String(iframe.getAttribute('src') || '');
    if (!src) {
      // carrega o viewer no iframe quando abrir a primeira vez
      iframe.setAttribute('src', VIEWER_URL);
    }
  }

  function open3D() {
    ensureViewerLoaded();
    if (overlay) overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';

    // Tenta já enviar o mapa de cores (o viewer também pode pedir via handshake)
    sendColors();
  }

  function close3D() {
    if (overlay) overlay.setAttribute('hidden', 'hidden');
    document.body.style.overflow = '';
  }

  // ======= INICIALIZAÇÃO =======
  function init() {
    overlay  = qs(OVERLAY_ID);
    iframe   = qs(IFRAME_ID);
    btnOpen  = qs(BTN_ID);
    btnClose = qs(CLOSE_ID);

    if (btnOpen)  btnOpen.addEventListener('click', open3D);
    if (btnClose) btnClose.addEventListener('click', close3D);

    // Se a página quiser abrir o 3D programaticamente:
    window.toggle3D = { open: open3D, close: close3D, sendColors, isOpen };
  }

  // ======= MENSAGERIA (viewer → index) =======
  window.addEventListener('message', (e) => {
    const data = e?.data;
    if (!data || !data.type) return;

    // Handshake básico do viewer pedindo cores
    // (o viewer.html deve enviar {type:'ready-3d'} ou {type:'requestColorMap'})
    if (data.type === 'ready-3d' || data.type === 'requestColorMap') {
      sendColors();
      return;
    }

    // Caso o viewer queira fechar o overlay:
    if (data.type === 'doge-close-3d') {
      close3D();
      return;
    }

    // Outros tipos podem ser tratados aqui no futuro
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
