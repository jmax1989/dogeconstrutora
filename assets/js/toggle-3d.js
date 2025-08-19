// assets/js/toggle-3d.js
(function(){
  const BTN_ID = 'toggle3d';
  const VIEWER_URL = './viewer.html'; // já está no repo

  let overlay = null;
  let iframe = null;
  let open = false;

  function ensureOverlay(){
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.4); backdrop-filter:blur(4px);
      display:none; z-index:9999999; padding:0; margin:0;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fechar 3D';
    closeBtn.style.cssText = `
      position:absolute; top:12px; right:12px; z-index:2;
      background:#161b22; color:#c9d1d9; border:1px solid #30363d; border-radius:10px;
      padding:8px 10px; cursor:pointer;
    `;
    closeBtn.addEventListener('click', toggle);

    iframe = document.createElement('iframe');
    iframe.src = VIEWER_URL;
    iframe.allow = 'fullscreen';
    iframe.style.cssText = `position:absolute; inset:0; width:100%; height:100%; border:0; background:#0d1117; z-index:1;`;

    overlay.appendChild(iframe);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);

    // quando o viewer carregar, manda as cores atuais
    iframe.addEventListener('load', sendColors);
  }

  function sendColors(){
    try{
      const map = window.DOGE?.get3DColorMap?.();
      if (!map || !iframe?.contentWindow) return;
      iframe.contentWindow.postMessage({ type:'fvs-colors', payload: map }, '*');
    }catch(e){}
  }

  function onColorsUpdated(){ // recebe eventos do main.js sempre que o 2D redesenha
    if (open) sendColors();
  }

  function toggle(){
    ensureOverlay();
    open = !open;
    overlay.style.display = open ? 'block' : 'none';
    document.documentElement.style.overflow = open ? 'hidden' : '';
    document.body.style.overflow = open ? 'hidden' : '';

    if (open){
      // pede as cores atuais e começa a ouvir futuras atualizações
      window.DOGE?.emit3DColorsUpdated?.();
      sendColors();
      window.addEventListener('doge:colors-updated', onColorsUpdated);
    } else {
      window.removeEventListener('doge:colors-updated', onColorsUpdated);
    }
  }

  // exporta para debug se quiser
  window.toggle3D = { toggle, sendColors, isOpen: ()=>open };

  // botão na topbar
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.addEventListener('click', toggle);
  });
})();
