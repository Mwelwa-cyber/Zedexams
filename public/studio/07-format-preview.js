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

  // Old (2013) sample — adapted from the Grade 10 Computer Studies sample
  // lesson plan (Careers in ICT), reshaped into the old-curriculum studio
  // contract. Shown when the syllabus toggle is on Old (2013).
  const sampleDataOld = {
    topic: 'Computer Career Opportunities',
    subtopic: 'Careers in information and communication technology',
    tlAids: ['Chalk board', 'Ruler', 'Charts'],
    references: ["Longman Computer Studies Pupils' Book 10 (R. Banda, B. Dill & S. Nunkumar, 3rd ed., 2016)"],
    rationale: 'This is a lesson on careers in information and communication technology. Teacher exposition, question and answer and class discussion methods will be used. The lesson will develop pupils\' knowledge of careers in ICT and the skill of identifying careers in relation to ICT, and they will gain the value of awareness of different opportunities. This lesson is number 1 in the series of 2.',
    prerequisiteKnowledge: 'Pupils have ideas about the use of computers in everyday life.',
    specificOutcomes: [
      'Describe different careers in ICT.',
      'Identify opportunities for further education in ICT.'
    ],
    stages: [
      {
        name: 'INTRODUCTION',
        duration: '5 min',
        content: 'The nature of careers in the computer industry. There are very few careers today that do not involve the use of computer technology.',
        teacher: 'Ask pupils: "Which jobs in our community use computers?"\nExplain the importance of the topic.',
        pupils: 'Pupils answer the question and listen to the explanation.',
        methods: 'Question & Answer'
      },
      {
        name: 'DEVELOPMENT — Step 1: Computer jobs and careers',
        duration: '12 min',
        content: 'Jobs directly linked to computer technology include: computer software trainer, helpdesk support, computer and network technicians, network administrators, software and web developers, mobile app developers and security experts.',
        teacher: 'Jot the main points on the board.\nPut pupils in groups to identify careers they know.',
        pupils: 'Pupils listen and copy brief notes in their books.\nPupils discuss in groups and bring out points.',
        methods: 'Teacher Exposition / Group Work'
      },
      {
        name: 'DEVELOPMENT — Step 2: Training opportunities',
        duration: '13 min',
        content: 'Qualifications can be obtained through accredited computer training institutions, international online services or a university degree. Common qualifications include a degree in computer studies, A+ and N+ certification, MCSE, CCIE and ICDL.',
        teacher: 'Give examples of common computer qualifications.\nGuide the class discussion.',
        pupils: 'Pupils participate in the discussion and ask questions.',
        methods: 'Class Discussion'
      },
      {
        name: 'CONCLUSION',
        duration: '10 min',
        content: 'Summary of the main points of the lesson.',
        teacher: 'Emphasise the main points of the lesson.\nAsk random questions to check on pupils\' understanding.',
        pupils: 'Pupils answer the teacher\'s questions.',
        methods: 'Individual Work'
      }
    ],
    homework: 'Briefly identify careers and jobs directly linked to computer technology. (Expected answers: computer software trainer, helpdesk support, computer and network technicians, network administrators, software and web developers, mobile app developers, security experts.)'
  };

  const sampleMetaOld = {
    headerLine: 'Ministry of Education · Republic of Zambia',
    school: 'Kabwe Secondary School',
    department: '',
    teacher: 'Mr B. Banda',
    tsno: '20158502',
    klass: 'Grade 10',
    subject: 'Computer Studies',
    duration: 40,
    date: '22 March 2026',
    time: '07:30',
    term: '1',
    week: '5',
    termWeek: 'Term 1, Week 5',
    topic: 'Computer Career Opportunities',
    subtopic: 'Careers in information and communication technology',
    compactMeta: true,
    showAttendance: true,
    showEnrolment: true,
    showReflection: true,
    showVocabulary: false,
    learningEnvironments: [],
    multiLesson: false,
    lessonsTotal: 1,
    lessonsCurrent: 1,
    progressNotes: ''
  };

  function titleFor(format, isOld) {
    const era = isOld ? ' (Old 2013)' : '';
    if (format === 'classic') return `Classic${era} — preview`;
    if (format === 'classic2') return `Classic 2${era} — preview`;
    return `Modern Clean${era} — preview`;
  }

  function openPreview(format) {
    const modal = document.getElementById('modal-format-preview');
    const titleEl = document.getElementById('format-preview-title');
    const bodyEl = document.getElementById('format-preview-body');
    if (!modal || !titleEl || !bodyEl) return;

    const isOld = window.syllabusVersion === 'old';
    const renderer = isOld
      ? (format === 'classic'
        ? window.renderOldClassic
        : (format === 'classic2' ? window.renderOldClassic2 : window.renderOldModern))
      : (format === 'classic'
        ? window.renderClassic
        : (format === 'classic2' ? window.renderClassic2 : window.renderModern));
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
    const baseMeta = isOld ? sampleMetaOld : sampleMeta;
    const meta = Object.assign({}, baseMeta, {
      format,
      showEnrolment: liveToggle('t-enrolment', baseMeta.showEnrolment),
      showAttendance: liveToggle('t-attendance', baseMeta.showAttendance),
      showReflection: liveToggle('t-reflection', baseMeta.showReflection),
      showVocabulary: liveToggle('t-vocab', baseMeta.showVocabulary),
      compactMeta: liveToggle('t-compact', baseMeta.compactMeta),
    });

    titleEl.textContent = titleFor(format, isOld);
    // Wrap the rendered HTML in the same .doc-wrap / .doc structure the
    // workspace uses so all the studio CSS (tables, headings, accent bar)
    // applies automatically. The outer .format-preview-scale shrinks the
    // A4 layout to fit a modal without horizontal scroll on phones.
    bodyEl.innerHTML =
      '<div class="format-preview-scale">' +
        '<div class="doc-wrap"><div class="doc">' +
          renderer(isOld ? sampleDataOld : sampleData, meta) +
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
