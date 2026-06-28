// Scope data-attrs to the studio container, not <html>
const studioEl = () => document.getElementById('view-plans');

// Format choice (state lives across remounts; default is 'modern')
let formatChoice = 'modern';

// ── Accessibility helpers ──────────────────────────────────────────────────
// The studio form is built from custom controls (div/button toggles, cards and
// pills) that the vanilla scripts drive by class + data-attr. These helpers
// layer the matching ARIA + keyboard semantics on top so the controls are
// operable by keyboard and announced correctly by screen readers — without
// changing the class/data-attr contract the other scripts read.

// Treat Enter / Space as activation on a non-native control.
function isActivationKey(e) {
  return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
}

// Accessible names for the accent-colour swatches (which carry no text).
const ACCENT_NAMES = {
  '#0a5454': 'Teal', '#7c2d12': 'Rust', '#1e3a8a': 'Blue', '#365314': 'Green',
  '#581c87': 'Purple', '#831843': 'Magenta', '#1c1612': 'Charcoal', '#a16207': 'Amber',
};

// Wire a single-choice card group as an ARIA radio group: roving tabindex,
// arrow-key navigation, Home/End, and Enter/Space (or click) to select.
// onSelect(card) performs the existing selection side effect.
function wireRadioGroup(container, cards, onSelect, labelFor) {
  if (!container || !cards.length) return;
  container.setAttribute('role', 'radiogroup');

  const select = (card, focus) => {
    cards.forEach(c => {
      const on = c === card;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
    onSelect(card);
    if (focus) card.focus();
  };

  cards.forEach((card, i) => {
    card.setAttribute('role', 'radio');
    if (labelFor && !card.getAttribute('aria-label')) {
      const lbl = labelFor(card);
      if (lbl) card.setAttribute('aria-label', lbl);
    }
    const checked = card.classList.contains('active');
    card.setAttribute('aria-checked', checked ? 'true' : 'false');
    card.tabIndex = checked ? 0 : -1;

    card.addEventListener('click', () => select(card, false));
    card.addEventListener('keydown', e => {
      if (isActivationKey(e)) { e.preventDefault(); select(card, false); return; }
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % cards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + cards.length) % cards.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = cards.length - 1;
      if (next >= 0) { e.preventDefault(); select(cards[next], true); }
    });
  });

  // Ensure exactly one card is in the tab order on init.
  if (!cards.some(c => c.tabIndex === 0)) cards[0].tabIndex = 0;
}

// ── Modal accessibility ────────────────────────────────────────────────────
// Close/backdrop/Escape are already wired in 11-diagrams.js. Here we add
// dialog semantics + focus management: move focus into a modal when it opens,
// trap Tab inside it, and restore focus to the opener when it closes.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let __studioModalReturnFocus = null;
let __studioModalKeydownBound = false;

function __studioShownModal() {
  return document.querySelector('.modal-scrim.show .modal');
}

function __studioFocusables(modal) {
  return Array.from(modal.querySelectorAll(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

function __studioInitModalA11y() {
  document.querySelectorAll('.modal-scrim').forEach(scrim => {
    const modal = scrim.querySelector('.modal');
    if (!modal) return;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1; // programmatic-focus fallback when empty

    const heading = modal.querySelector('.modal-head h3');
    if (heading) {
      if (!heading.id) heading.id = scrim.id + '-title';
      modal.setAttribute('aria-labelledby', heading.id);
    }

    // React replaces these nodes on remount, so a fresh observer per node is
    // correct (old nodes — and their observers — are discarded).
    const obs = new MutationObserver(() => {
      const shown = scrim.classList.contains('show');
      if (shown && !modal.dataset.a11yOpen) {
        modal.dataset.a11yOpen = '1';
        __studioModalReturnFocus = document.activeElement;
        const f = __studioFocusables(modal);
        (f[0] || modal).focus({ preventScroll: true });
      } else if (!shown && modal.dataset.a11yOpen) {
        delete modal.dataset.a11yOpen;
        const back = __studioModalReturnFocus;
        __studioModalReturnFocus = null;
        if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
      }
    });
    obs.observe(scrim, { attributes: true, attributeFilter: ['class'] });
  });

  // Trap Tab within the open modal. Bound once at document level.
  if (!__studioModalKeydownBound) {
    __studioModalKeydownBound = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const modal = __studioShownModal();
      if (!modal) return;
      const f = __studioFocusables(modal);
      if (!f.length) { e.preventDefault(); modal.focus({ preventScroll: true }); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
}

// Bind all studio UI handlers to the React-rendered DOM. Runs once at script
// load and again on every LessonPlanStudio remount, since React replaces the
// DOM nodes when the user navigates away and back.
function __studioInitUI() {
  const root = studioEl();
  if (!root) return;

  root.setAttribute('data-table-style', root.getAttribute('data-table-style') || 'bordered');
  root.setAttribute('data-font-pair', root.getAttribute('data-font-pair') || 'classic');

  // Tabs — ARIA tablist with roving tabindex + arrow-key navigation.
  const tabs = $$('.tab');
  const tablist = tabs[0] && tabs[0].parentElement;
  if (tablist) tablist.setAttribute('role', 'tablist');
  const selectTab = (tab, focus) => {
    tabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    $$('.tab-pane').forEach(p => { p.style.display = 'none'; p.setAttribute('hidden', ''); });
    const pane = $('#pane-' + tab.dataset.tab);
    if (pane) { pane.style.display = 'block'; pane.removeAttribute('hidden'); }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    const isActive = tab.classList.contains('active');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.tabIndex = isActive ? 0 : -1;
    const pane = $('#pane-' + tab.dataset.tab);
    if (pane) {
      pane.setAttribute('role', 'tabpanel');
      if (!tab.id) tab.id = 'tab-' + tab.dataset.tab;
      pane.setAttribute('aria-labelledby', tab.id);
    }
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', e => {
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next >= 0) { e.preventDefault(); selectTab(tabs[next], true); }
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

  // Toggles — ARIA switches operable by keyboard (Enter / Space).
  $$('.toggle-row').forEach(t => {
    const setOn = (on) => {
      t.dataset.on = on;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    t.setAttribute('role', 'switch');
    if (!t.hasAttribute('tabindex')) t.tabIndex = 0;
    t.setAttribute('aria-checked', t.dataset.on === 'true' ? 'true' : 'false');
    // Label the switch from its primary label text (ignores the <small> hint).
    const lbl = t.querySelector('.lbl');
    if (lbl && !t.getAttribute('aria-label')) {
      const main = lbl.childNodes[0] && lbl.childNodes[0].textContent;
      if (main) t.setAttribute('aria-label', main.trim());
    }
    t.addEventListener('click', () => setOn(t.dataset.on !== 'true'));
    t.addEventListener('keydown', e => {
      if (isActivationKey(e)) { e.preventDefault(); setOn(t.dataset.on !== 'true'); }
    });
  });

  // Accordion sections — tap/Enter a header to expand/collapse its card.
  $$('.lp-section-head').forEach(h => {
    const sec = h.closest('.lp-section');
    const body = sec && sec.querySelector('.lp-section-body');
    if (body && !body.id) {
      const key = (sec.dataset.section || Math.random().toString(36).slice(2, 7));
      body.id = 'lp-sec-' + key;
    }
    if (body) h.setAttribute('aria-controls', body.id);
    h.setAttribute('aria-expanded', sec && sec.classList.contains('open') ? 'true' : 'false');
    h.addEventListener('click', () => {
      if (!sec) return;
      const open = sec.classList.toggle('open');
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Learning Environment — multi-select pills (Natural / Artificial / Technological)
  $$('#learning-env .le-pill').forEach(p => {
    p.setAttribute('aria-pressed', p.dataset.on === 'true' ? 'true' : 'false');
    p.addEventListener('click', () => {
      const on = p.dataset.on !== 'true';
      p.dataset.on = on;
      p.classList.toggle('active', on);
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });

  // Lesson Progression — the legacy "Subtopic needs multiple lessons" toggle
  // was replaced in v14 by a full planning-mode selector
  // (12-lesson-progression.js). That module owns its own bindings; nothing
  // to wire here.

  // Format choice — single-choice toggle buttons (one is always "pressed").
  // Kept as aria-pressed buttons rather than a radiogroup because each card
  // contains its own nested "Preview" button, which a radio must not.
  const formatCards = $$('#format-cards .format-card');
  formatCards.forEach(c => {
    const on = c.dataset.format === formatChoice;
    c.classList.toggle('active', on);
    c.setAttribute('role', 'button');
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (c.tabIndex < 0) c.tabIndex = 0;
    const choose = () => {
      formatCards.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      c.classList.add('active');
      c.setAttribute('aria-pressed', 'true');
      formatChoice = c.dataset.format;
    };
    c.addEventListener('click', choose);
    c.addEventListener('keydown', e => {
      // Don't hijack Enter/Space when focus is on the nested Preview button.
      if (e.target !== c) return;
      if (isActivationKey(e)) { e.preventDefault(); choose(); }
    });
  });

  // Style controls — scoped to #view-plans, wired as ARIA radio groups.
  wireRadioGroup($('#font-pairs'), $$('#font-pairs .style-card'), (card) => {
    studioEl().setAttribute('data-font-pair', card.dataset.fontpair);
  });
  wireRadioGroup($('#table-styles'), $$('#table-styles .style-card'), (card) => {
    studioEl().setAttribute('data-table-style', card.dataset.tablestyle);
  });
  wireRadioGroup($('#accent-colors'), $$('#accent-colors .style-card'), (card) => {
    studioEl().style.setProperty('--accent', card.dataset.accent);
  }, (card) => {
    const name = ACCENT_NAMES[(card.dataset.accent || '').toLowerCase()];
    return name ? name + ' accent colour' : 'Accent colour';
  });

  const fontSize = $('#font-size');
  if (fontSize) fontSize.addEventListener('input', e => {
    studioEl().style.setProperty('--doc-font-size', e.target.value + 'pt');
    $('#font-size-val').textContent = e.target.value + 'pt';
  });

  __studioInitModalA11y();

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
