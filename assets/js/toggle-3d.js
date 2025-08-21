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

/* ==== [DOGE] CONTROLES DO MODO 2D (HUD + MENSAGERIA) ==== */
(function () {
  const OVERLAY_ID = 'viewer3d-overlay';
  const IFRAME_ID  = 'viewer3d-iframe';

  let __doge2d = {
    hud: null,
    slider: null,
    pct: null,
  };

  function qs(id) { return document.getElementById(id); }

  // Cria HUD (se ainda não existir) dentro do overlay do viewer 3D
  function ensure2DHUD() {
    const overlay = qs(OVERLAY_ID);
    if (!overlay) return;

    if (!__doge2d.hud) {
      const hud = document.createElement('div');
      hud.id = 'doge-2d-hud';
      hud.style.position = 'absolute';
      hud.style.right = '16px';
      hud.style.bottom = '16px';
      hud.style.display = 'flex';
      hud.style.gap = '8px';
      hud.style.alignItems = 'center';
      hud.style.padding = '8px 12px';
      hud.style.borderRadius = '10px';
      hud.style.background = 'rgba(0,0,0,.55)';
      hud.style.backdropFilter = 'blur(4px)';
      hud.style.border = '1px solid rgba(255,255,255,.18)';
      hud.style.zIndex = '99999';

      const label = document.createElement('label');
      label.textContent = '2D';
      label.style.color = '#fff';
      label.style.font = '600 13px Inter, system-ui, sans-serif';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = '0';
      input.style.width = '240px';

      const pct = document.createElement('span');
      pct.textContent = '0%';
      pct.style.color = '#ddd';
      pct.style.font = '12px Inter, system-ui, sans-serif';
      pct.style.padding = '2px 6px';
      pct.style.borderRadius = '999px';
      pct.style.border = '1px solid rgba(255,255,255,.2)';
      pct.style.background = 'rgba(255,255,255,.06)';

      input.addEventListener('input', () => {
        pct.textContent = `${input.value}%`;
        send2DTransition(parseFloat(input.value) / 100);
      });

      hud.appendChild(label);
      hud.appendChild(input);
      hud.appendChild(pct);

      overlay.appendChild(hud);
      __doge2d.hud = hud;
      __doge2d.slider = input;
      __doge2d.pct = pct;
    }
  }

  // Envia o valor t (0..1) para o iframe do viewer
  function send2DTransition(t01) {
    try {
      const iframe = qs(IFRAME_ID);
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage({ type: 'doge-2d-set', t: t01 }, '*');
    } catch (e) {
      console.warn('Falha ao enviar doge-2d-set:', e);
    }
  }

  // Sempre que o overlay abrir, garante o HUD
  const _open = window.toggle3D?.open;
  if (_open) {
    window.toggle3D.open = function () {
      _open();
      // pequena espera para o overlay estar no DOM
      setTimeout(ensure2DHUD, 50);
    };
  } else {
    // se não existir toggle3D.open, tenta assim mesmo
    setTimeout(ensure2DHUD, 500);
  }

  // Se o viewer avisar que está pronto, reenvia o valor atual do slider (se houver)
  window.addEventListener('message', (e) => {
    const t = e?.data?.type;
    if (t === 'doge-2d-ready' && __doge2d.slider) {
      send2DTransition(parseFloat(__doge2d.slider.value) / 100);
    }
  });
})();
