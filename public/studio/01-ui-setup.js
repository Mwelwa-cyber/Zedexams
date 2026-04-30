// Scope data-attrs to the studio container, not <html>
const studioEl = () => document.getElementById('view-plans');

studioEl().setAttribute('data-table-style', 'bordered');
studioEl().setAttribute('data-font-pair', 'classic');

// Tabs
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.tab-pane').forEach(p => p.style.display = 'none');
    $('#pane-' + tab.dataset.tab).style.display = 'block';
  });
});

// Mobile menu
$('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
$('#scrim').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); });

// Home button → React Router navigation
document.querySelectorAll('[data-go-view="home"]').forEach(btn => {
  btn.addEventListener('click', () => { if (typeof window.__studioNavigateHome === 'function') window.__studioNavigateHome(); });
});

// Toggles
$$('.toggle-row').forEach(t => {
  t.addEventListener('click', () => { const on = t.dataset.on !== 'true'; t.dataset.on = on; t.classList.toggle('on', on); });
});

// Format choice
let formatChoice = 'modern';
$$('#format-cards .format-card').forEach(c => {
  c.addEventListener('click', () => { $$('#format-cards .format-card').forEach(x => x.classList.remove('active')); c.classList.add('active'); formatChoice = c.dataset.format; });
});

// Style controls — scoped to #view-plans
$$('#font-pairs .style-card').forEach(c => c.addEventListener('click', () => {
  $$('#font-pairs .style-card').forEach(x => x.classList.remove('active')); c.classList.add('active');
  studioEl().setAttribute('data-font-pair', c.dataset.fontpair);
}));
$$('#table-styles .style-card').forEach(c => c.addEventListener('click', () => {
  $$('#table-styles .style-card').forEach(x => x.classList.remove('active')); c.classList.add('active');
  studioEl().setAttribute('data-table-style', c.dataset.tablestyle);
}));
$$('#accent-colors .style-card').forEach(c => c.addEventListener('click', () => {
  $$('#accent-colors .style-card').forEach(x => x.classList.remove('active')); c.classList.add('active');
  studioEl().style.setProperty('--accent', c.dataset.accent);
}));
$('#font-size').addEventListener('input', e => {
  studioEl().style.setProperty('--doc-font-size', e.target.value + 'pt');
  $('#font-size-val').textContent = e.target.value + 'pt';
});

// Auto-fill today's date
(function autofillDate() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const d = new Date();
  $('#f-date').value = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
})();
