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

async function updateSubjects() {
  const klass = $('#f-class').value;
  const level = activeGradeLevel()[klass];
  const sel = $('#f-subject');
  if (!sel) return;
  const current = sel.value;

  // Default to the curriculum's hardcoded subjects for this level. They
  // still drive the dropdown for the Old syllabus and as a fallback when
  // the active CBC KB has no rows for the selected grade.
  let subjects = activeSubjectsByLevel()[level] || [];

  // On the New (CBC) syllabus, prefer the subject list the admin actually
  // uploaded — i.e. distinct subjects in the active KB for this grade.
  // If the KB has data we replace the hardcoded list; if not we keep the
  // hardcoded list. We never merge the two: a smaller, school-specific
  // list is more accurate than padding it with subjects the school may
  // not actually teach.
  if (syllabusVersion === 'new' && typeof window.__studioFetchSyllabusSubjects === 'function') {
    const grade = classToCbcGrade(klass);
    if (grade) {
      try {
        const remote = await window.__studioFetchSyllabusSubjects({ grade });
        if (Array.isArray(remote) && remote.length > 0) {
          subjects = remote;
        }
      } catch (err) {
        console.warn('updateSubjects: KB subject fetch failed', err);
      }
    }
  }

  // For Lower Primary (new syllabus, hardcoded path): split into 2 optgroups
  // (official 3 learning areas vs individual components).
  let html;
  if (level === 'lp' && subjects.some(s => s.includes('(Learning Area)'))) {
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
  await updateTopics();
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

// ---- Dynamic CBC KB bridge ----
//
// The hardcoded syllabus in 02-syllabus-new.js / 03-syllabus-old.js is
// incomplete (entire Grade 8/9 old-syllabus secondary curriculum is empty,
// plus a few language-subject gaps in primary). updateTopics() now consults
// the React-side bridge first — which queries the same Firestore CBC KB
// the React Lesson Plan Studio uses for AI grounding — and falls back to
// the hardcoded data when the KB has no entry for the (grade, subject)
// pair. Net effect: any topic admins add via the CbcKbAdmin admin UI
// shows up in the studio's topic + subtopic dropdowns automatically.

// Maps a static-studio class label (e.g. "Form 1", "Grade 8") to the
// canonical G-prefix grade ID the Firestore CBC KB stores. The KB only
// uses G1-G12; Form 1-5 are aliases for G8-G12 in the Zambian system.
function classToCbcGrade(klass) {
  if (klass.startsWith('Grade ')) return 'G' + klass.slice(6).trim();
  const formMap = { 'Form 1': 'G8', 'Form 2': 'G9', 'Form 3': 'G10', 'Form 4': 'G11', 'Form 5': 'G12' };
  return formMap[klass] || '';
}

// Maps the studio's display subject names to the snake_case IDs the CBC
// KB stores. Some are approximations (Literature in English → english,
// Additional Mathematics → mathematics) — the KB doesn't have separate
// entries for every secondary subject yet, so closely related ones share
// a base entry. When the KB returns nothing the router falls back to the
// hardcoded syllabus, so an inexact alias is strictly better than missing.
const SUBJECT_ALIAS = {
  'Mathematics': 'mathematics',
  'Additional Mathematics': 'mathematics',
  'Advanced Mathematics': 'mathematics',
  'Further Mathematics': 'mathematics',
  'English Language': 'english',
  'Literature in English': 'english',
  'Zambian Languages': 'zambian_language',
  'Integrated Science': 'integrated_science',
  'Environmental Science': 'environmental_science',
  'Science 5124': 'integrated_science',
  'Biology': 'biology',
  'Chemistry': 'chemistry',
  'Physics': 'physics',
  'Religious Education': 'religious_education',
  'Creative and Technology Studies': 'creative_and_technology_studies',
  'Social Studies': 'social_studies',
  'Physical Education and Sport': 'physical_education',
  'Physical Education': 'physical_education',
  'Civic Education': 'civic_education',
  'Computer Studies': 'technology_studies',
  'Computer Science': 'technology_studies',
  'Design and Technology': 'technology_studies',
  'Geography': 'geography',
  'History': 'history',
  'Home Management': 'home_economics',
  'Food and Nutrition': 'home_economics',
  'Fashion and Fabrics': 'home_economics',
  'Agricultural Science': 'integrated_science',
  'Art and Design': 'expressive_arts',
  'Music': 'expressive_arts',
  'Commerce': 'social_studies',
  'Principles of Accounts': 'social_studies',
  'Economics': 'social_studies',
};
function subjectToCbcSubject(name) {
  if (!name) return '';
  // Strip the "(Learning Area)" suffix used by Lower-Primary subject groups.
  const cleaned = String(name).replace(/\s*\(Learning Area\)\s*$/, '').trim();
  if (SUBJECT_ALIAS[cleaned]) return SUBJECT_ALIAS[cleaned];
  return cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Cache of the topics map for the currently-selected (class, subject), so
// updateSubtopics() doesn't re-query Firestore on every keystroke.
// Populated by updateTopics().
let currentTopicsMap = {};

async function fetchTopicsForCurrentSelection() {
  const klass = $('#f-class').value;
  const level = activeGradeLevel()[klass];
  const subj = $('#f-subject').value;

  // 1. Dynamic CBC KB — the authoritative, grade+subject-aware source the
  // admin maintains via CbcKbAdmin and the curriculum importers. Bridge
  // contract:
  //   - non-empty object → KB has data, use it.
  //   - empty object {}  → KB has no rows; fall through.
  //   - null             → fetch errored; fall through.
  //
  // IMPORTANT: only consult the KB on the New (CBC) syllabus. The KB stores
  // the 2023 CBC curriculum the admin uploads via /admin/curriculum/replace.
  // Querying it from the Old (2013) syllabus tab leaked CBC topics into the
  // old-syllabus dropdowns, which is what teachers were noticing in the
  // wild. The Old syllabus has its own hardcoded data in 03-syllabus-old.js
  // and must use that exclusively.
  if (syllabusVersion === 'new' && typeof window.__studioFetchSyllabusTopics === 'function') {
    const grade = classToCbcGrade(klass);
    const subject = subjectToCbcSubject(subj);
    if (grade && subject) {
      const remote = await window.__studioFetchSyllabusTopics({ grade, subject });
      if (remote && Object.keys(remote).length > 0) return remote;
    }
  }

  // 2. Manual curriculumTopics map (02b-curriculum-topics.js) — keyed by
  // grade only. A fallback the user can extend by editing that file when
  // the KB has no rows for the (grade, subject) pair.
  if (window.curriculumTopics && window.curriculumTopics[klass]) {
    return window.curriculumTopics[klass];
  }

  // 3. Legacy hardcoded syllabus.
  return getTopicsForClass(level, subj, klass);
}

async function updateTopics() {
  currentTopicsMap = await fetchTopicsForCurrentSelection();
  // Mirror on window so 06-generate.js's buildPrompt() can consume the same
  // topic list the dropdowns were populated from, instead of falling back to
  // the legacy hardcoded syllabus files which lag the dynamic CBC KB and
  // caused Claude to reject teacher-picked topics as "out of syllabus".
  if (typeof window !== 'undefined') window.currentTopicsMap = currentTopicsMap;
  const topicSel = $('#f-topic');
  if (!topicSel) return;
  const topics = Object.keys(currentTopicsMap);
  const placeholder = '<option value="">Select a topic…</option>';
  topicSel.innerHTML = placeholder + topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  // Reset to placeholder so the teacher consciously picks one, and so the
  // subtopic dropdown gets correctly reset below.
  topicSel.value = '';
  updateSubtopics();
}

function updateSubtopics() {
  const subSel = $('#f-subtopic');
  if (!subSel) return;
  const topic = ($('#f-topic').value || '').trim();
  const subs = currentTopicsMap[topic] || [];
  const placeholder = '<option value="">Select a sub-topic…</option>';
  subSel.innerHTML = placeholder + subs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  // Always reset the selection when the topic changes so a stale subtopic
  // from the previous topic can't leak through.
  subSel.value = '';
}

// Bind syllabus controls and seed the dropdowns. Runs on every React mount,
// since the <select> elements (#f-class, #f-subject) are fresh DOM each time
// and need to be re-populated.
function __studioInitSyllabus() {
  if (!$('#f-class')) return;

  document.querySelectorAll('#syllabus-toggle .seg').forEach(btn => {
    // Reflect the current syllabusVersion in the segmented toggle UI
    btn.classList.toggle('active', btn.dataset.version === syllabusVersion);
    btn.addEventListener('click', () => {
      const newVersion = btn.dataset.version;
      if (newVersion === syllabusVersion) return;
      syllabusVersion = newVersion;
      document.querySelectorAll('#syllabus-toggle .seg').forEach(b => b.classList.toggle('active', b === btn));
      populateClasses();
      updateSubjects().catch(err => console.warn('updateSubjects failed', err));
    });
  });

  $('#f-class').addEventListener('change', () => {
    updateSubjects().catch(err => console.warn('updateSubjects failed', err));
  });
  $('#f-subject').addEventListener('change', () => {
    updateTopics().catch(err => console.warn('updateTopics failed', err));
  });
  // Topic is now a <select>; only 'change' fires, and we always reset the
  // subtopic dropdown so a stale subtopic from the previous topic can't be
  // submitted accidentally.
  $('#f-topic').addEventListener('change', updateSubtopics);

  // Initial population
  populateClasses();
  updateSubjects().catch(err => console.warn('updateSubjects failed', err));
}

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitSyllabus);
