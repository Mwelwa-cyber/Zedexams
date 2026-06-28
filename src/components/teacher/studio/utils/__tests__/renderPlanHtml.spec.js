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
  keyVocabulary: ['count', 'number', 'sequence'],
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
  showVocabulary: false,
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
    expect(html).toContain('class="plan-official"')
  })

  it('does NOT include Key Vocabulary section when showVocabulary is false', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showVocabulary: false }, 'cbc')
    expect(html).not.toContain('Key Vocabulary')
  })

  it('includes Key Vocabulary section when showVocabulary is true', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showVocabulary: true }, 'cbc')
    expect(html).toContain('Key Vocabulary')
    expect(html).toContain('count')
  })

  it('does NOT include Lesson Evaluation when showReflection is false', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showReflection: false }, 'cbc')
    expect(html).not.toContain('Lesson Evaluation')
  })

  it('includes Lesson Evaluation when showReflection is true', () => {
    const html = renderPlanHtml(SAMPLE_PLAN, { ...BASE_META, showReflection: true }, 'cbc')
    expect(html).toContain('Lesson Evaluation')
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

  it('contains TEACHING ACTIVITIES column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('TEACHING ACTIVITIES')
  })

  it('contains LEARNING ACTIVITIES column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('LEARNING ACTIVITIES')
  })
})

describe('renderPlanHtml — previous curriculum, classic format', () => {
  const meta = { ...BASE_META, format: 'classic' }

  it('contains CONTENT column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('CONTENT')
  })

  it('contains METHODS column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('METHODS')
  })

  it('contains SPECIFIC OUTCOMES (LSBAT) heading', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain('SPECIFIC OUTCOMES (LSBAT)')
  })
})

describe('renderPlanHtml — previous curriculum, classic2 format', () => {
  const meta = { ...BASE_META, format: 'classic2' }

  it('contains TEACHER\'S ACTIVITY column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain("TEACHER'S ACTIVITY")
  })

  it('contains PUPILS\' ACTIVITY column header', () => {
    const html = renderPlanHtml(OLD_PLAN, meta, 'previous')
    expect(html).toContain("PUPILS' ACTIVITY")
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
