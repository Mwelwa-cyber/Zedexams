// ============ HUB RENDERING ============
const SUBJECT_ICONS = {
  'Mathematics': '🔢', 'English Language': '📖', 'English': '📖', 'Science': '🔬', 'Integrated Science': '🔬',
  'Biology': '🧬', 'Chemistry': '⚗️', 'Physics': '⚛️', 'Social Studies': '🌍', 'Geography': '🗺️',
  'History': '📜', 'Civic Education': '⚖️', 'Religious Education': '✝️', 'Zambian Languages': '🗣️',
  'Zambian Language': '🗣️', 'Home Economics': '🍳', 'Home Management': '🏠', 'Technology Studies': '🔧',
  'Design and Technology': '🔧', 'Computer Science': '💻', 'Information and Communication Technology': '💻',
  'Music': '🎵', 'Art and Design': '🎨', 'Physical Education': '⚽', 'Agricultural Science': '🌾',
  'Creative and Technology Studies': '🎨', 'Literature in English': '📚', 'Additional Mathematics': '📐',
  'Science 5124': '🔬', 'Food and Nutrition': '🥗', 'Fashion and Fabrics': '🧵', 'Commerce': '💼',
  'Principles of Accounts': '💹', 'Travel and Tourism': '✈️', 'Foreign Languages (French)': '🇫🇷',
  'Expressive Arts': '🎭'
};
function subjectIcon(s) { return SUBJECT_ICONS[s] || '📋'; }
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function planCard(p, withActions = false) {
  const subj = p.meta?.subject || 'Plan';
  const title = p.meta?.topic || p.meta?.subtopic || subj;
  const desc = p.meta?.subtopic && p.meta?.topic ? p.meta.subtopic : (p.data?.lessonGoal || p.data?.specificCompetence || '');
  const klass = p.meta?.klass || '';
  const isNew = (Date.now() - new Date(p.createdAt).getTime()) < 3600000;
  return `<div class="lib-card" data-plan-id="${esc(p.id)}">
    ${isNew ? '<span class="lib-card-pill new">NEW</span>' : ''}
    <div class="lib-card-icon">${subjectIcon(subj)}</div>
    <div class="lib-card-subj">${esc(subj)} · ${esc(klass)}</div>
    <div class="lib-card-title">${esc(title)}</div>
    <div class="lib-card-desc">${esc(desc)}</div>
    <div class="lib-card-meta"><span>📅 ${timeAgo(p.createdAt)}</span><span>${esc((p.meta?.format || 'modern').replace('classic2','Classic 2').replace('classic','Classic CBC').replace('modern','Modern'))}</span></div>
    ${withActions ? `<div class="lib-card-actions">
      <button data-action="open" data-id="${esc(p.id)}">Open</button>
      <button data-action="print" data-id="${esc(p.id)}">Print</button>
      <button class="danger" data-action="delete" data-id="${esc(p.id)}">Delete</button>
    </div>` : ''}
  </div>`;
}
function renderHub() {
  const lib = loadLib();
  const planCount = lib.plans.length;
  $('#count-plans').textContent = planCount === 0 ? 'EMPTY' : (planCount + ' SAVED');
  $('#stat-plans').textContent = planCount + (planCount === 1 ? ' plan' : ' plans');
  $('#prog-plans').style.width = Math.min(100, planCount * 10) + '%';

  const schemeCount = (lib.schemes || []).length;
  const schEl = $('#count-schemes');
  if (schEl) schEl.textContent = schemeCount === 0 ? '0 SAVED' : (schemeCount + ' SAVED');

  // Hero: continue latest or default welcome
  const latest = lib.plans[0];
  if (latest) {
    $('#hero-title').textContent = 'Welcome back';
    $('#hero-sub').textContent = `Pick up where you left off — your last plan was ${esc(latest.meta?.subject || 'a lesson')} for ${esc(latest.meta?.klass || 'class')}: ${esc(latest.meta?.topic || latest.title)}.`;
    $('#hero-meta').innerHTML = `<span>📅 ${timeAgo(latest.createdAt)}</span><span>📚 ${esc(latest.meta?.subject || '')}</span><span>🎓 ${esc(latest.meta?.klass || '')}</span>`;
    $('#hero-cta').textContent = '▶ Continue your latest plan';
    $('#hero-cta').onclick = () => reopenFromLibrary(latest.id);
  } else {
    $('#hero-title').textContent = 'Plan with confidence';
    $('#hero-sub').textContent = 'Build CBC-aligned lesson plans, schemes of work, teaching notes, and worksheets — all from one place.';
    $('#hero-meta').innerHTML = '<span>📚 Zambian CBC</span><span>📋 New & Old syllabi</span><span>⭐ All grades</span>';
    $('#hero-cta').textContent = '▶ Start your first plan';
    $('#hero-cta').onclick = () => showView('plans');
  }

  // Recent plans (up to 3)
  const recent = lib.plans.slice(0, 3);
  const grid = $('#recent-grid');
  if (recent.length === 0) {
    grid.innerHTML = `<div class="lib-empty" style="grid-column:1/-1"><div class="lib-empty-icon">📭</div><strong>No saved plans yet</strong><p>Generate your first lesson plan and it'll appear here.</p></div>`;
  } else {
    grid.innerHTML = recent.map(p => planCard(p, false)).join('');
    $$('#recent-grid .lib-card').forEach(c => c.addEventListener('click', () => reopenFromLibrary(c.dataset.planId)));
  }
}
function renderLibrary() {
  const lib = loadLib();
  const grid = $('#library-grid');
  $('#lib-count').textContent = lib.plans.length === 0 ? '' : `${lib.plans.length} ${lib.plans.length === 1 ? 'plan' : 'plans'}`;
  if (lib.plans.length === 0) {
    grid.innerHTML = `<div class="lib-empty" style="grid-column:1/-1"><div class="lib-empty-icon">📚</div><strong>Your library is empty</strong><p>Lesson plans you generate will be auto-saved here.</p><br><button class="hub-hero-cta" data-go-view="plans">Create your first plan</button></div>`;
    return;
  }
  grid.innerHTML = lib.plans.map(p => planCard(p, true)).join('');
  $$('#library-grid .lib-card-actions button').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.dataset.id;
      const act = b.dataset.action;
      if (act === 'open') reopenFromLibrary(id);
      else if (act === 'print') { reopenFromLibrary(id); setTimeout(() => window.print(), 400); }
      else if (act === 'delete') {
        if (confirm('Delete this lesson plan? This cannot be undone.')) {
          deleteFromLibrary(id, 'plans');
          renderLibrary();
          toast('Plan deleted');
        }
      }
    });
  });
  // Click anywhere else on the card opens it
  $$('#library-grid .lib-card').forEach(c => {
    c.addEventListener('click', e => {
      if (!e.target.closest('.lib-card-actions')) reopenFromLibrary(c.dataset.planId);
    });
  });
}
