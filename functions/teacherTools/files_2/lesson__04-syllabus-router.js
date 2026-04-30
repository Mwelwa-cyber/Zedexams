// Active syllabus router — returns the right gradeLevel/subjects/topics based on version
function activeGradeLevel() { return syllabusVersion === 'old' ? oldGradeLevel : gradeLevel; }
function activeSubjectsByLevel() { return syllabusVersion === 'old' ? oldSubjectsByLevel : subjectsByLevel; }
function activeSyllabus() { return syllabusVersion === 'old' ? oldSyllabus : syllabus; }
function activeClassOptions() { return syllabusVersion === 'old' ? oldClassOptions : newClassOptions; }

// Populate the class dropdown based on active syllabus version
function populateClasses() {
  const sel = $('#f-class');
  const opts = activeClassOptions();
  const current = sel.value;
  // Default: Grade 4 (new) or Grade 5 (old, since old is mainly used for G5+)
  const defaultClass = syllabusVersion === 'old' ? 'Grade 5' : 'Grade 4';
  sel.innerHTML = opts.map(c => {
    const sel = c === current ? ' selected' : (current === '' && c === defaultClass ? ' selected' : '');
    return `<option${sel}>${esc(c)}</option>`;
  }).join('');
  // If previously selected class isn't in the new list, fall back to default
  if (!opts.includes(current)) {
    sel.value = opts.includes(defaultClass) ? defaultClass : opts[0];
  }
}

function updateSubjects() {
  const klass = $('#f-class').value;
  const level = activeGradeLevel()[klass];
  const allSubjects = activeSubjectsByLevel()[level] || [];
  // Filter: only show subjects that actually have topics for THIS grade
  const subjects = allSubjects.filter(s => Object.keys(getTopicsForClass(level, s, klass)).length > 0);
  const sel = $('#f-subject');
  const current = sel.value;
  // For Lower Primary (new syllabus): split into 2 optgroups (official 3 learning areas vs individual components)
  let html;
  if (level === 'lp') {
    const areas = subjects.filter(s => s.includes('(Learning Area)'));
    const components = subjects.filter(s => !s.includes('(Learning Area)'));
    const opt = s => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}</option>`;
    html = `<optgroup label="Official Learning Areas (3)">${areas.map(opt).join('')}</optgroup>` +
           `<optgroup label="Individual Component Subjects">${components.map(opt).join('')}</optgroup>`;
  } else {
    html = subjects.map(s => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}</option>`).join('');
  }
  sel.innerHTML = html;
  if (!subjects.includes(current) && subjects.length) sel.value = subjects[0];
  updateTopics();
}

// Grade-aware lookup: syllabus[level][subject] can be either:
//   1. Grade-keyed: { 'G4': {topic: [...]}, 'G5': {...}, 'G6': {...} } — grade-specific
//   2. Mixed: { 'G4': {...}, '_all': {...} } — grade-specific + shared topics
//   3. Flat: { topic: [...] } — same for all grades in this level (backwards-compat)
function classToGradeTag(klass) {
  if (klass.startsWith('Grade ')) return 'G' + klass.slice(6);
  if (klass.startsWith('Form ')) return 'F' + klass.slice(5);
  return '';
}
function getTopicsForClass(level, subj, klass) {
  const syl = activeSyllabus();
  const block = (syl[level] && syl[level][subj]) || {};
  const gradeTag = classToGradeTag(klass);
  const isGradeKeyed = Object.keys(block).some(k => /^[GF]\d+$/.test(k) || k === '_all');
  if (!isGradeKeyed) return block;
  const merged = {};
  if (block['_all']) Object.assign(merged, block['_all']);
  if (block[gradeTag]) Object.assign(merged, block[gradeTag]);
  return merged;
}

function updateTopics() {
  const klass = $('#f-class').value;
  const level = activeGradeLevel()[klass];
  const subj = $('#f-subject').value;
  const topics = getTopicsForClass(level, subj, klass);
  $('#topic-list').innerHTML = Object.keys(topics).map(t => `<option value="${esc(t)}"></option>`).join('');
  updateSubtopics();
}
function updateSubtopics() {
  const klass = $('#f-class').value;
  const level = activeGradeLevel()[klass];
  const subj = $('#f-subject').value;
  const topic = $('#f-topic').value.trim();
  const topics = getTopicsForClass(level, subj, klass);
  const subs = topics[topic] || [];
  $('#subtopic-list').innerHTML = subs.map(s => `<option value="${esc(s)}"></option>`).join('');
}

// Wire up syllabus version toggle
document.querySelectorAll('#syllabus-toggle .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    const newVersion = btn.dataset.version;
    if (newVersion === syllabusVersion) return;
    syllabusVersion = newVersion;
    document.querySelectorAll('#syllabus-toggle .seg').forEach(b => b.classList.toggle('active', b === btn));
    populateClasses();
    updateSubjects();
  });
});

$('#f-class').addEventListener('change', updateSubjects);
$('#f-subject').addEventListener('change', updateTopics);
$('#f-topic').addEventListener('input', updateSubtopics);
$('#f-topic').addEventListener('change', updateSubtopics);

// Initial population
populateClasses();
updateSubjects();
