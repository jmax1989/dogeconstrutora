// assets/js/toggle-3d.js
const btn3d    = document.getElementById('btn-3d');
const overlay  = document.getElementById('viewer3d-overlay');
const iframe   = document.getElementById('viewer3d-iframe');
const closeBtn = document.getElementById('btn-3d-close');

// Caminho RELATIVO para funcionar no GitHub Pages do repositório.
// O viewer já busca data/layout-3d.json por padrão.
const VIEWER_URL = 'viewer.html';

let showing3D = false;
let prevOverflow = '';

function open3D(){
  if (!iframe.src) iframe.src = VIEWER_URL; // carrega na 1ª vez
  overlay.hidden = false;
  showing3D = true;

  // trava scroll da página 2D enquanto o overlay está aberto
  const root = document.documentElement;
  prevOverflow = root.style.overflow;
  root.style.overflow = 'hidden';

  // feedback visual opcional no botão
  btn3d?.classList.add('is-active');
}

function close3D(){
  overlay.hidden = true;
  showing3D = false;

  // libera scroll
  document.documentElement.style.overflow = prevOverflow;

  // feedback visual opcional no botão
  btn3d?.classList.remove('is-active');
}

btn3d?.addEventListener('click', () => (showing3D ? close3D() : open3D()));
closeBtn?.addEventListener('click', close3D);

// Fechar com ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && showing3D) close3D();
});

// (opcional) abrir direto via hash ou query, ex.: index.html#3d
if (location.hash === '#3d') {
  // aguarda o frame para garantir que os elementos existem
  requestAnimationFrame(open3D);
}
