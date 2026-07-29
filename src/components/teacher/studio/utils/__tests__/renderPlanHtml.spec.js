import { describe, it, expect } from 'vitest'
import { renderPlanHtml } from '../renderPlanHtml'

// ── Shared sample plan ────────────────────────────────────────────────────────

const SAMPLE_PLAN = {
  topic: 'Whole Numbers',
  subtopic: 'Counting to 100',
  generalCompetences: ['Apply number concepts', 'Communicate mathematically'],
  specificCompetence: 'Count and write numbers up to 100',
  lessonGoal: 'Learners will count fluently to 100',
  rationale: 'Counting is foundational to all number work',
  priorKnowledge: 'Learners can count to 20',
  references: ['Mathematics Learner Book Grade 1', 'CBC Teacher Guide'],
  materials: ['Number cards', 'Abacus'],
  expectedStandard: 'Counts correctly to 100 without assistance',
  learningEnvironment: {
    natural: 'Outdoor counting walk',
    artificial: 'Classroom',
    technological: 'None',
  },
  stages: [
    {
      name: 'INTRODUCTION',
      duration: '5 min',
      teacher: 'Ask learners to count from 1 to 20',
      pupils: 'Count aloud together',
      assessment: 'Observe participation',
    },
    {
      name: 'LESSON DEVELOPMENT',
      duration: '25 min',
      teacher: 'Demonstrate counting to 100 with number cards',
      pupils: 'Practice counting in pairs',
      assessment: 'Check accuracy',
    },
    {
      name: 'CONCLUSION',
      duration: '10 min',
      teacher: 'Review key numbers',
      pupils: 'Share what they learned',
      assessment: 'Exit question',
    },
  ],
}

const BASE_META = {
  format: 'modern',
  showReflection: false,
  showEnrolment: false,
  showAttendance: false,
  compactMeta: false,
  teacherName: 'Mrs Banda',
  school: 'Lusaka Primary',
  date: '2026-06-27',
  time: '08:00',
  grade: 'Grade 1',
  subject: 'Mathematics',
  duration: 40,
  medium: 'English',
  lessonNumber: 1,
  totalLessons: 1,
}

// ── renderPlanHtml — illustrations (data.diagrams) ────────────────────────────

describe('renderPlanHtml — illustrations', () => {
  it('renders no <img> when there are no diagrams', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).not.toContain('<img')
  })

  it('renders an <img> for a diagram attached to a matching stage', () => {
    const plan = {
      ...SAMPLE_PLAN,
      diagrams: [{ stage: 'LESSON DEVELOPMENT', url: 'https://img.test/a.png', caption: 'Counting cards' }],
    }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).toContain('<img')
    expect(html).toContain('https://img.test/a.png')
    expect(html).toContain('Counting cards')
  })

  it('matches stage names loosely (case/punctuation-insensitive)', () => {
    const plan = {
      ...SAMPLE_PLAN,
      diagrams: [{ stage: 'lesson development', url: 'https://img.test/b.png' }],
    }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).toContain('https://img.test/b.png')
  })

  it('does not render a diagram whose stage matches no stage in the plan', () => {
    const plan = {
      ...SAMPLE_PLAN,
      diagrams: [{ stage: 'NONEXISTENT STAGE', url: 'https://img.test/c.png' }],
    }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).not.toContain('https://img.test/c.png')
  })

  it('escapes the diagram url and caption (no raw injection)', () => {
    const plan = {
      ...SAMPLE_PLAN,
      diagrams: [{ stage: 'LESSON DEVELOPMENT', url: 'https://img.test/d.png"><script>', caption: '<b>x</b>' }],
    }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
  })

  it('renders diagrams in the classic format too', () => {
    const plan = {
      ...SAMPLE_PLAN,
      diagrams: [{ stage: 'LESSON DEVELOPMENT', url: 'https://img.test/e.png' }],
    }
    const html = renderPlanHtml(plan, { ...BASE_META, format: 'classic' }, 'cbc')
    expect(html).toContain('https://img.test/e.png')
  })
})

// ── renderPlanHtml — guard rails ──────────────────────────────────────────────

describe('renderPlanHtml — guard rails', () => {
  it('returns empty string for null planJson', () => {
    expect(renderPlanHtml(null, BASE_META, 'cbc')).toBe('')
  })

  it('returns empty string for non-object planJson', () => {
    expect(renderPlanHtml('not an object', BASE_META, 'cbc')).toBe('')
  })

  it('returns a non-empty string for a valid plan', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })
})

// ── renderPlanHtml — modern format (CBC) ──────────────────────────────────────

describe('renderPlanHtml — modern format, cbc', () => {
  it('contains the school name', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('Lusaka Primary')
  })

  it('contains the specific competence', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('Count and write numbers up to 100')
  })

  it('contains the lesson goal', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('Learners will count fluently to 100')
  })

  it('contains the stage name INTRODUCTION', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('INTRODUCTION')
  })

  it('contains the stage name LESSON DEVELOPMENT', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('LESSON DEVELOPMENT')
  })

  it('contains teacher activity text', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    expect(html).toContain('Ask learners to count from 1 to 20')
  })

  it('wraps output in plan-official div', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, BASE_META, 'cbc')
    // `plan-compact` joins it from 2026-07 — the class carrying the paper-fit
    // custom properties the exporters and the preview share.
    expect(html).toMatch(/<div class="plan-official[ "]/)
    expect(html).toContain('plan-compact')
  })

  it('never includes a Key Vocabulary section (feature removed)', () => {
    const withVocab = { ...SAMPLE_PLAN, keyVocabulary: ['count', 'number', 'sequence'] }
    const html = renderPlanHtml(withVocab, { ...BASE_META, showVocabulary: true }, 'cbc')
    expect(html).not.toContain('Key Vocabulary')
  })

  it('does NOT include Lesson Evaluation when the section is off', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showReflection: false }, 'cbc')
    expect(html).not.toMatch(/LESSON EVALUATION/i)
  })

  it('includes Lesson Evaluation when the section is on', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showReflection: true }, 'cbc')
    expect(html).toContain('LESSON EVALUATION')
    // §4.5 — one ruled line per field, not two rows of underscores.
    expect(html).toContain('class="rule"')
    expect(html).not.toMatch(/_{20,}/)
  })
})

// ── renderPlanHtml — classic format (CBC) ─────────────────────────────────────

describe('renderPlanHtml — classic format, cbc', () => {
  const meta = { ...BASE_META, format: 'classic' }

  it('renders a LESSON PROGRESSION heading', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('LESSON PROGRESSION')
  })

  it('renders the STAGES column header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('STAGES')
  })

  it('renders the TEACHER\'S ACTIVITIES column header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain("TEACHER'S ACTIVITIES")
  })

  it('renders the LEARNERS\' ACTIVITIES column header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain("LEARNERS' ACTIVITIES")
  })

  it('renders SPECIFIC COMPETENCE field line', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('SPECIFIC COMPETENCE')
  })

  it('contains school name in header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('Lusaka Primary')
  })

  it('uses the shared two-column meta header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    // §4.3 — a borderless <table>, not a CSS grid: the PDF download rasterises
    // with html2canvas, which lays out display:grid unreliably.
    expect(html).toMatch(/<table class="meta[ "]/)
    expect(html).toContain('Name of Teacher')
    expect(html).toContain('No of pupils')
    // Compact metadata is the two-column form; without it every field takes a
    // full-width row (more legible, three lines longer).
    const compact = renderPlanHtml(SAMPLE_PLAN, { ...meta, compactMeta: true }, 'cbc')
    expect(compact).toContain('<table class="meta">')
  })

  it('shows topic and sub-topic in the header, not as a duplicate field line', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('Whole Numbers')
    expect(html).toContain('Counting to 100')
    // The old uppercase TOPIC: / SUB-TOPIC: field lines are gone (now in header).
    expect(html).not.toContain('<strong>TOPIC:</strong>')
    expect(html).not.toContain('<strong>SUB-TOPIC:</strong>')
  })
})

// ── renderPlanHtml — classic2 / official-cbc format ───────────────────────────

describe('renderPlanHtml — classic2 format, cbc', () => {
  const meta = { ...BASE_META, format: 'classic2' }

  it('renders TEACHER\'S ROLE column header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain("TEACHER'S ROLE")
  })

  it('renders LEARNERS\' ROLE column header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain("LEARNERS' ROLE")
  })

  it('maps official-cbc format alias to classic2', () => {
    const htmlAlias = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, format: 'official-cbc' }, 'cbc')
    const htmlDirect = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, format: 'classic2' }, 'cbc')
    expect(htmlAlias).toBe(htmlDirect)
  })
})

// ── renderPlanHtml — previous curriculum ─────────────────────────────────────

const OLD_PLAN = {
  topic: 'Plants',
  subtopic: 'Parts of a plant',
  specificOutcomes: [
    'Identify the main parts of a plant',
    'Label a diagram of a plant',
  ],
  rationale: 'Understanding plant structures is foundational to biology',
  prerequisiteKnowledge: 'Learners know what a plant looks like',
  references: ['Integrated Science Learner Book Grade 5'],
  materials: ['Plant specimens', 'Diagrams'],
  tlAids: ['Charts', 'Real plants'],
  stages: [
    {
      name: 'INTRODUCTION',
      duration: '5 min',
      content: 'Show a real plant',
      teacher: 'Display plant and ask questions',
      pupils: 'Observe and respond',
      methods: 'Question and answer',
    },
    {
      name: 'DEVELOPMENT',
      duration: '25 min',
      content: 'Label plant parts',
      teacher: 'Demonstrate labelling',
      pupils: 'Complete labelling exercise',
      methods: 'Demonstration',
    },
    {
      name: 'CONCLUSION',
      duration: '10 min',
      content: 'Review',
      teacher: 'Summarise key points',
      pupils: 'Answer exit questions',
      methods: 'Discussion',
    },
  ],
}

describe('renderPlanHtml — previous curriculum, modern format', () => {
  const meta = { ...BASE_META, format: 'modern' }

  it('contains OUTCOMES heading', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('OUTCOMES')
  })

  it('contains specific outcome text', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('Identify the main parts of a plant')
  })

  it('contains RATIONALE field', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('RATIONALE')
  })

  it('uses the OBC activity column headings (§4.6)', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain("TEACHER'S ACTIVITY")
    expect(html).toContain("LEARNER'S ACTIVITY")
  })
})

describe('renderPlanHtml — previous curriculum (§4.6 OBC parity)', () => {
  const meta = { ...BASE_META, format: 'classic' }

  it('does NOT render a CONTENT column header (dropped for legibility)', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).not.toContain('>CONTENT<')
  })

  it('uses STAGE/TIME and LEARNING POINT, not the CBC columns', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('STAGE/TIME')
    expect(html).toContain('LEARNING POINT')
    expect(html).not.toContain('ASSESSMENT CRITERIA')
    // METHODS was the pre-parity fourth column; LEARNING POINT replaced it.
    expect(html).not.toContain('>METHODS<')
  })

  it('uses the OBC field vocabulary, not relabelled CBC', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('SPECIFIC OUTCOMES')
    expect(html).toContain('PRE-REQUISITE')
    expect(html).toContain('<b>Grade:</b>')
    expect(html).not.toContain('<b>Class:</b>')
    expect(html).not.toContain('GENERAL COMPETENCES')
    expect(html).not.toContain('EXPECTED STANDARD')
  })

  it('ends in EVALUATION and LESSON LEARNT', () => {
    const html = renderPlanHtml(OLD_PLAN, { ...meta, showReflection: true }, 'previous')
    expect(html).toContain('<b>EVALUATION:</b>')
    expect(html).toContain('<b>LESSON LEARNT:</b>')
    expect(html).not.toContain('Successes')
  })

  it('renders the same document whichever format card is selected', () => {
    const classic = renderPlanHtml(OLD_PLAN, { ...BASE_META, format: 'classic' }, 'previous')
    const classic2 = renderPlanHtml(OLD_PLAN, { ...BASE_META, format: 'classic2' }, 'previous')
    expect(classic).toBe(classic2)
  })
})

// ── renderPlanHtml — compact meta header (two columns) ────────────────────────

describe('renderPlanHtml — compact meta header', () => {
  const meta = {
    ...BASE_META,
    compactMeta: true,
    teacherName: 'Chibuye Dorica',
    grade: 'Grade 2A',
    subject: 'Mathematics and Science',
    date: '26th March 2026',
    time: '07:00 – 08:00',
    duration: 60,
  }

  it('renders the two-column compact meta wrapper', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('<table class="meta">')
    expect(html).toContain('class="item"')
  })

  it('labels the teacher field "Name of Teacher", with the label underlined', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('<b>Name of Teacher:</b>')
    expect(html).toContain('Chibuye Dorica')
    expect(html).not.toContain("Teacher's name")
  })

  it('carries no horizontal rules in the header (§4.3)', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    const header = html.slice(0, html.indexOf('class="meta"'))
    expect(header).not.toMatch(/border-top|border-bottom|<hr/)
  })

  it('renders Date, Time and Duration in the header', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('26th March 2026')
    expect(html).toContain('07:00 – 08:00')
    expect(html).toContain('60 minutes')
  })

  it('keeps the pupil-count blanks with their label', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    // §1.6 — the GIRLS/BOYS blanks used to land on their own line, misaligned
    // from their labels. Label and value now share one cell.
    expect(html).toMatch(/<b>No of pupils:<\/b>\s*<span class="val">B: _+/)
  })

  it('no longer renders the Lesson Sequence row', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...meta, totalLessons: 6, lessonNumber: 1 }, 'cbc')
    expect(html).not.toContain('Lesson Sequence')
  })

  it('escapes the teacher name', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...meta, teacherName: 'John & Jane' }, 'cbc')
    expect(html).toContain('John &amp; Jane')
  })
})

// ── renderPlanHtml — XSS safety ───────────────────────────────────────────────

describe('renderPlanHtml — XSS safety', () => {
  it('escapes < and > in string fields', () => {
    const plan = { ...SAMPLE_PLAN, lessonGoal: '<script>alert("xss")</script>' }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes & in teacher name', () => {
    const meta = { ...BASE_META, teacherName: 'John & Jane' }
    const html = renderPlanHtml(SAMPLE_PLAN, meta, 'cbc')
    expect(html).toContain('John &amp; Jane')
  })
})

// ── renderPlanHtml — missing stage fallback ───────────────────────────────────

describe('renderPlanHtml — missing stages fallback', () => {
  it('renders five default stage rows when stages is empty', () => {
    const plan = { ...SAMPLE_PLAN, stages: [] }
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).toContain('INTRODUCTION')
    expect(html).toContain('LESSON DEVELOPMENT')
    expect(html).toContain('EXERCISE / ASSESSMENT')
    expect(html).toContain('HOMEWORK')
    expect(html).toContain('CONCLUSION')
  })

  it('renders default stage rows when stages is absent', () => {
    const plan = { ...SAMPLE_PLAN }
    delete plan.stages
    const html = renderPlanHtml(plan, BASE_META, 'cbc')
    expect(html).toContain('INTRODUCTION')
  })
})
