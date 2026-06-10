// Format preview — when a teacher clicks the small "Preview" button on a
// format card, render a fully-styled sample lesson plan in that format
// inside #modal-format-preview. The sample uses the actual renderers from
// 06-generate.js so the preview is byte-for-byte what the studio would
// output for real content. No API call, no Firestore write.

(function () {
  // Sample lesson plan content — adapted from the SAMPLE LESSON PLAN in the
  // official Creative and Technology Studies Grade 2 teaching module
  // (Term 1 & 2, Appendix 1: "Tourism — Attraction sites"), reshaped into
  // the canonical studio contract from 05-system-prompts.js. All three
  // formats render this same object; only the presentation differs.
  const sampleData = {
    topic: '2.10 Tourism',
    subtopic: '2.10.1 Attraction Sites',
    generalCompetences: ['Citizenship', 'Communication', 'Environmental Sustainability'],
    specificCompetence: '2.10.1.1 Explore local attraction sites',
    lessonGoal: 'To enable learners explore local attraction sites and appreciate their importance to the community.',
    rationale: 'This lesson will focus on tourism attraction sites such as museums, waterfalls and parks. Learners will explore local attraction sites and appreciate their importance to the community. To enhance understanding, learners will be engaged in group work and discovery methods. This is lesson 1 in a series of 2.',
    priorKnowledge: 'Learners have visited or watched a trading place, city, waterfalls, show grounds or museums.',
    references: [
      'Lower Primary Syllabus, Creative and Technology Studies, page 87.',
      'Creative and Technology Studies Teaching Module Grade 2, page 87.'
    ],
    learningEnvironment: {
      natural: 'School surroundings and the local community.',
      artificial: 'Classroom with a tourism corner.',
      technological: 'Video clip of a local attraction site shown on a phone or projector.'
    },
    materials: [
      'Pictures of local attraction sites',
      'Video clip of an attraction site',
      'Brochures from local tourism centres'
    ],
    expectedStandard: 'Local attraction sites explored accordingly.',
    keyVocabulary: [
      'Tourism: visiting interesting places to learn and enjoy.',
      'Attraction site: a place many people like to visit, such as a waterfall or museum.',
      'Museum: a building where important old things are kept and shown.',
      'Heritage: the special places and traditions a community keeps and protects.'
    ],
    stages: [
      {
        name: 'INTRODUCTION',
        duration: '5 min',
        teacher: 'Ask learners: "Have you ever visited a park, waterfall or museum?"\n"What did you see there?"\nShow learners brochures or pictures of local attraction sites.',
        pupils: 'Share their experiences of places they have visited.\nRelate what they see in the pictures to their own experience.',
        assessment: 'Learners appropriately relate what they see in the pictures to their experience.'
      },
      {
        name: 'LESSON DEVELOPMENT',
        duration: '15 min',
        teacher: 'Show learners a video of an attraction site (virtual educational visit).\nAsk learners to observe activities at the site.\nAfter the virtual visit, ask learners to draw or talk about what they saw.\nDiscuss how to behave responsibly at attraction sites (no littering, respect rules, protect property).',
        pupils: 'Describe the environment and the activities taking place at the site.\nDraw what they saw or share their experience.\nDiscuss responsible behaviour at an attraction site.',
        assessment: 'Learners describe the environment and activities on attraction sites accordingly.\nLearners draw what they saw with less difficulty.'
      },
      {
        name: 'EXERCISE / ASSESSMENT',
        duration: '5 min',
        teacher: 'Ask learners to:\n1. Identify local attraction sites.\n2. Describe features of the attraction sites mentioned.\n3. Demonstrate how to behave when visiting an attraction site.',
        pupils: '1. Correctly mention local attraction sites.\n2. Describe features of attraction sites clearly.\n3. Demonstrate appropriate behaviour when visiting sites.',
        assessment: 'Learners show ability to recall and share their experience accordingly.'
      },
      {
        name: 'HOMEWORK',
        duration: '2 min',
        teacher: 'Task learners: with the help of a parent, explore a nearby attraction site in your locality (a physical visit or pictures/videos may be used).',
        pupils: 'Copy the homework task and complete it at home with a family member.',
        assessment: 'Learners copy the homework task correctly.'
      },
      {
        name: 'CONCLUSION',
        duration: '3 min',
        teacher: 'Guide the learners to bring out the main points of the lesson learnt:\n- Tourism helps people learn about their environment and culture.\n- Attraction sites such as parks, dams, waterfalls and museums are important places in the community.',
        pupils: 'Bring out the key points of the lesson (what they learnt from the tour).',
        assessment: 'Learners clearly state what they saw and learnt, mention the important ideas and explain them in their own simple words.'
      }
    ],
    remedialWork: 'Learners who struggled review the picture cards with the teacher and name two attraction sites.',
    extensionActivity: 'Fast finishers design a small poster inviting visitors to one local attraction site.'
  };

  const sampleMeta = {
    headerLine: 'Ministry of Education · Republic of Zambia',
    school: 'Mwelu Mantimpa Primary School',
    department: '',
    teacher: 'Mwamba Chanda',
    tsno: '20158502',
    klass: 'Grade 2',
    subject: 'Creative and Technology Studies',
    duration: 30,
    date: '22 March 2026',
    time: '07:30',
    term: '1',
    week: '5',
    termWeek: 'Term 1, Week 5',
    topic: '2.10 Tourism',
    subtopic: '2.10.1 Attraction Sites',
    compactMeta: true,
    showAttendance: true,
    showEnrolment: true,
    showReflection: true,
    showVocabulary: false,
    learningEnvironments: ['Natural', 'Artificial', 'Technological'],
    multiLesson: false,
    lessonsTotal: 1,
    lessonsCurrent: 1,
    progressNotes: ''
  };

  function titleFor(format) {
    if (format === 'classic') return 'Classic CBC — preview';
    if (format === 'classic2') return 'Classic 2 — preview';
    return 'Modern Clean — preview';
  }

  function openPreview(format) {
    const modal = document.getElementById('modal-format-preview');
    const titleEl = document.getElementById('format-preview-title');
    const bodyEl = document.getElementById('format-preview-body');
    if (!modal || !titleEl || !bodyEl) return;

    const renderer = format === 'classic'
      ? window.renderClassic
      : (format === 'classic2' ? window.renderClassic2 : window.renderModern);
    if (typeof renderer !== 'function') {
      if (typeof window.toast === 'function') window.toast('Preview not ready yet — try again in a moment.');
      return;
    }

    // Honour the live toggle state so the preview reflects what the teacher
    // has switched on (vocabulary, evaluation, enrolment, attendance).
    const liveToggle = (id, fallback) => {
      const el = document.getElementById(id);
      return el ? el.dataset.on === 'true' : fallback;
    };
    const meta = Object.assign({}, sampleMeta, {
      format,
      showEnrolment: liveToggle('t-enrolment', sampleMeta.showEnrolment),
      showAttendance: liveToggle('t-attendance', sampleMeta.showAttendance),
      showReflection: liveToggle('t-reflection', sampleMeta.showReflection),
      showVocabulary: liveToggle('t-vocab', sampleMeta.showVocabulary),
      compactMeta: liveToggle('t-compact', sampleMeta.compactMeta),
    });

    titleEl.textContent = titleFor(format);
    // Wrap the rendered HTML in the same .doc-wrap / .doc structure the
    // workspace uses so all the studio CSS (tables, headings, accent bar)
    // applies automatically. The outer .format-preview-scale shrinks the
    // A4 layout to fit a modal without horizontal scroll on phones.
    bodyEl.innerHTML =
      '<div class="format-preview-scale">' +
        '<div class="doc-wrap"><div class="doc">' +
          renderer(sampleData, meta) +
        '</div></div>' +
      '</div>';

    modal.classList.add('show');
  }

  function __studioInitFormatPreview() {
    const buttons = document.querySelectorAll('#format-cards [data-preview-format]');
    buttons.forEach(btn => {
      // Stop the click from also triggering the parent card's "select
      // format" handler — preview should not switch the chosen format.
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        openPreview(btn.dataset.previewFormat);
      });
    });
  }

  window.__studioRebinders = window.__studioRebinders || [];
  window.__studioRebinders.push(__studioInitFormatPreview);
})();
