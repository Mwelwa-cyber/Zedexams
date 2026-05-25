// Format preview — when a teacher clicks the small "Preview" button on a
// format card, render a fully-styled sample lesson plan in that format
// inside #modal-format-preview. The sample uses the actual renderers from
// 06-generate.js so the preview is byte-for-byte what the studio would
// output for real content. No API call, no Firestore write.

(function () {
  // Sample lesson plan content. Realistic enough that the teacher sees how
  // headings, tables, columns, evaluations and reflection sections look.
  // The classic / classic2 formats need extra fields (generalCompetences,
  // lessonGoal, etc.) so we include them all on the same object — the
  // modern renderer ignores what it doesn't use.
  const sampleData = {
    topic: 'Plants',
    subtopic: 'Photosynthesis',
    specificOutcomes: [
      'Describe how green plants make their own food.',
      'State the requirements for photosynthesis.',
      'Explain the importance of photosynthesis to living things.'
    ],
    keyCompetencies: ['Observation', 'Critical thinking', 'Communication'],
    values: ['Curiosity', 'Respect for nature', 'Teamwork'],
    prerequisiteKnowledge: [
      'Parts of a flowering plant.',
      'Functions of the leaf.',
      'Sources of energy in the environment.'
    ],
    materials: [
      'Live potted plant',
      'Chart of a leaf with labelled parts',
      'Iodine solution and a starch-tested leaf'
    ],
    references: [
      "Integrated Science Pupil's Book 6 (Ministry of Education).",
      "Teacher's Guide Grade 6 — Plants unit."
    ],
    stages: [
      {
        name: 'Introduction',
        duration: '5 min',
        teacher: 'Greets the pupils.\nReviews parts of a plant through quick oral questions.',
        pupils: 'Respond to greetings.\nName parts of a plant from a chart.',
        assessment: 'Oral answers identifying leaf, stem and root.'
      },
      {
        name: 'Lesson Development',
        duration: '25 min',
        teacher: 'Explains photosynthesis using a labelled chart.\nDemonstrates the iodine test on a leaf.\nLeads pupils through the word equation.',
        pupils: 'Listen and take notes.\nObserve the iodine test results.\nCopy the word equation into their books.',
        assessment: 'Pupils correctly write the word equation for photosynthesis.'
      },
      {
        name: 'Conclusion',
        duration: '10 min',
        teacher: 'Summarises the lesson.\nGives a short oral quiz.\nAssigns homework.',
        pupils: 'Respond to the quiz.\nWrite down the homework task.',
        assessment: 'Correct oral answers to summary questions.'
      }
    ],
    assessment: {
      formative: ['Oral questioning during the lesson.', 'Quick written check at the end of the lesson.'],
      summative: 'Short end-of-week written test on photosynthesis.',
      successCriteria: 'Pupil can state the requirements and word equation for photosynthesis.'
    },
    differentiation: {
      struggling: ['Pair with a stronger learner.', 'Use simpler diagrams and local examples.'],
      advanced: ['Research the balanced chemical equation.', 'Explain limiting factors for photosynthesis.']
    },
    homework: 'Draw and label a leaf, then describe in two sentences where photosynthesis takes place.',
    // Fields used only by Classic / Classic 2:
    generalCompetences: 'Critical thinking; Communication; Co-operation',
    specificCompetence: 'Describes how green plants make food through photosynthesis.',
    majorLearningPoint: 'Photosynthesis is the process by which green plants use sunlight to make food.',
    lessonGoal: 'By the end of the lesson, pupils should be able to describe photosynthesis and state its requirements.',
    rationale: 'Understanding photosynthesis is the foundation for food chains, ecology and human dependence on plants.',
    priorKnowledge: 'Pupils know the parts of a plant and the functions of the leaf.',
    learningEnvironment: {
      natural: 'School garden where pupils observe living leaves.',
      artificial: 'Classroom chart and iodine-test demonstration.',
      technological: 'Short video clip on photosynthesis (if available).'
    },
    // NOTE: the classic renderer expects `materials` and `references` as
    // strings, not arrays. Override on render below for the classic formats.
    expectedStandards: 'Pupils correctly explain photosynthesis using a word equation and name its requirements.'
  };

  const sampleMeta = {
    headerLine: 'Ministry of Education · Republic of Zambia',
    school: 'Jemareen Primary School',
    department: 'Science Department',
    teacher: 'Mr. Mwelwa',
    tsno: '20158502',
    klass: 'Grade 6',
    subject: 'Integrated Science',
    duration: 40,
    date: '25 May 2026',
    time: '10:00',
    term: '2',
    week: '5',
    termWeek: 'Term 2, Week 5',
    topic: 'Plants',
    subtopic: 'Photosynthesis',
    compactMeta: true,
    showAttendance: true,
    showEnrolment: false,
    showReflection: true,
    learningEnvironments: ['Natural', 'Artificial'],
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

  function dataFor(format) {
    // The classic renderers concatenate materials/references with esc()
    // (string), while modern expects arrays. Reshape for each.
    if (format === 'modern') return sampleData;
    return Object.assign({}, sampleData, {
      materials: 'Live potted plant; chart of a labelled leaf; iodine solution.',
      references: "Integrated Science Pupil's Book 6 (MoE); Teacher's Guide Grade 6."
    });
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

    titleEl.textContent = titleFor(format);
    // Wrap the rendered HTML in the same .doc-wrap / .doc structure the
    // workspace uses so all the studio CSS (tables, headings, accent bar)
    // applies automatically. The outer .format-preview-scale shrinks the
    // A4 layout to fit a modal without horizontal scroll on phones.
    bodyEl.innerHTML =
      '<div class="format-preview-scale">' +
        '<div class="doc-wrap"><div class="doc">' +
          renderer(dataFor(format), Object.assign({}, sampleMeta, { format })) +
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
