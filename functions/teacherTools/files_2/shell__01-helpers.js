const $ = (s, r = document) => r.querySelector(s);
// Set logo srcs (logos are inlined as data URLs further down)
function applyLogos() {
  const sm = document.querySelectorAll('img.hub-logo, img.brand-mark-img');
  sm.forEach(img => img.src = ZED_LOGO_SM);
  const lg = document.getElementById('hub-hero-logo');
  if (lg) lg.src = ZED_LOGO_LG;
}
applyLogos();

const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
};
