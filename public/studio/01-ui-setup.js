// Scope data-attrs to the studio container, not <html>
const studioEl = () => document.getElementById('view-plans');

// Format choice (state lives across remounts; default is 'modern')
let formatChoice = 'modern';

// Bind all studio UI handlers to the React-rendered DOM. Runs once at script
// load and again on every LessonPlanStudio remount, since React replaces the
// DOM nodes when the user navigates away and back.
function __studioInitUI() {
  const root = studioEl();
  if (!root) return;

  root.setAttribute('data-table-style', root.getAttribute('data-table-style') || 'bordered');
  root.setAttribute('data-font-pair', root.getAttribute('data-font-pair') || 'classic');

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
  const menuBtn = $('#menu-btn');
  if (menuBtn) menuBtn.addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
  const scrim = $('#scrim');
  if (scrim) scrim.addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); });

  // Home button → React Router navigation
  document.querySelectorAll('[data-go-view="home"]').forEach(btn => {
    btn.addEventListener('click', () => { if (typeof window.__studioNavigateHome === 'function') window.__studioNavigateHome(); });
  });

  // Toggles
  $$('.toggle-row').forEach(t => {
    t.addEventListener('click', () => { const on = t.dataset.on !== 'true'; t.dataset.on = on; t.classList.toggle('on', on); });
  });

  // Accordion sections — tap a header to expand/collapse its card
  $$('.lp-section-head').forEach(h => {
    h.addEventListener('click', () => {
      const sec = h.closest('.lp-section');
      if (sec) sec.classList.toggle('open');
    });
  });

  // Learning Environment — multi-select pills (Natural / Artificial / Technological)
  $$('#learning-env .le-pill').forEach(p => {
    p.addEventListener('click', () => {
      const on = p.dataset.on !== 'true';
      p.dataset.on = on;
      p.classList.toggle('active', on);
    });
  });

  // Lesson Progression — the legacy "Subtopic needs multiple lessons" toggle
  // was replaced in v14 by a full planning-mode selector
  // (12-lesson-progression.js). That module owns its own bindings; nothing
  // to wire here.

  // Format choice — sync the active card with the persisted formatChoice
  $$('#format-cards .format-card').forEach(c => {
    c.classList.toggle('active', c.dataset.format === formatChoice);
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
  const fontSize = $('#font-size');
  if (fontSize) fontSize.addEventListener('input', e => {
    studioEl().style.setProperty('--doc-font-size', e.target.value + 'pt');
    $('#font-size-val').textContent = e.target.value + 'pt';
  });

  // Auto-fill today's date if empty. <input type="date"> requires the value
  // in ISO YYYY-MM-DD; the calendar widget handles the user-facing format.
  const dateField = $('#f-date');
  if (dateField && !dateField.value) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    dateField.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitUI);
