// ============ STUDIO HUB: VIEW MANAGEMENT ============
const VIEWS = ['home', 'plans', 'library', 'syllabi', 'schemes', 'notes', 'worksheets', 'tests'];
const COMING_SOON = {
  notes: { mark: '🦉', name: 'Notes Studio', mascot: '🦉', title: 'Notes Studio is coming', desc: 'Generate teacher delivery notes from your lesson plans — key concepts, worked examples, common misconceptions, and discussion prompts.' },
  worksheets: { mark: '🐢', name: 'Worksheets', mascot: '🐢', title: 'Worksheets Studio is coming', desc: 'Build practice activities and exercises for pupils, mapped to the lesson topic.' },
  tests: { mark: '🦅', name: 'Tests', mascot: '🦅', title: 'Tests Studio is coming', desc: 'Build five kinds of assessments — topic tests, weekly tests, monthly tests, mid-term tests, and end-of-term tests — auto-generated from your syllabus and lesson coverage.' }
};
function showView(name) {
  const target = name === 'plans'   ? 'view-plans'
               : name === 'library' ? 'view-library'
               : name === 'syllabi' ? 'view-syllabi'
               : name === 'schemes' ? 'view-schemes'
               : name === 'home'    ? 'view-home'
               : 'view-coming-soon';
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#' + target).classList.add('active');
  if (target === 'view-coming-soon') {
    const cfg = COMING_SOON[name];
    if (cfg) {
      $('#cs-mark').textContent = cfg.mark;
      $('#cs-name').textContent = cfg.name;
      $('#cs-mascot').textContent = cfg.mascot;
      $('#cs-title').textContent = cfg.title;
      $('#cs-desc').textContent = cfg.desc;
    }
  }
  if (name === 'home') renderHub();
  if (name === 'library') renderLibrary();
  if (name === 'syllabi') renderSyllabi();
  if (name === 'schemes') initSchemesStudio();
  window.scrollTo(0, 0);
}
// Wire up all data-go-view buttons (delegated)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-go-view]');
  if (btn) { e.preventDefault(); showView(btn.dataset.goView); }
});
