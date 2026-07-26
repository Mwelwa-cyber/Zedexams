/**
 * The visual regression fixture set (§4.6).
 *
 * Eight papers, each deterministic and each existing to protect something
 * specific about printed output. The set is small on purpose: a fixture that
 * does not protect a named printed feature costs CI time and tells a reviewer
 * nothing.
 *
 * ## A fixture validates itself
 *
 * The failure mode this guards is quiet and total. Someone edits fixture data,
 * accidentally drops the long-division block, and the long-division fixture
 * keeps passing — because a paper with no long division renders consistently
 * too. The suite reports green while the thing it exists to watch is no longer
 * being watched at all.
 *
 * So every fixture declares `protects` — the printed features it is for — and a
 * `requires` predicate list that must find each of them in the fixture's own
 * data. Validation runs BEFORE rendering: a fixture whose purpose has gone
 * missing fails immediately rather than passing quietly.
 *
 * ## Determinism
 *
 * Nothing here reads the clock, generates an id, or reaches the network. Dates,
 * names, candidate numbers and question data are literals. `RENDER_SETTINGS`
 * pins the rest (page size, dpi, locale, time zone, the fixed date). An asset
 * must be committed and local — a fixture that could fetch a logo could produce
 * a "valid" baseline out of a failed request.
 *
 * ## IDs are permanent
 *
 * `vr-001` … `vr-008` never change. Baselines, summaries and update commands all
 * key on the ID, so a fixture can be retitled without orphaning its baselines.
 */

/** Every rendering target a fixture can declare. */
export const RENDER_TARGETS = ['browser-print', 'docx']

/** Region classifications. `maths` and `label` get the strict cluster limit. */
export const REGION_TYPES = ['maths', 'label', 'body', 'header', 'table', 'diagram']

/* ── shared deterministic values ────────────────────────────────────────── */

const SCHOOL = {
  schoolName: 'Kabulonga Primary School',
  address: 'PO Box 30001, Lusaka',
  emisNumber: '10203040',
  motto: 'Knowledge is light',
}

/** The one committed logo. A data URI so no request can be made for it. */
const LOGO_DATA_URI = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOUlEQVR42u3NMQEAAAgDoJnc'
  + '/3AtYUBzVwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD8dLwADAV0/EwAAAABJ'
  + 'RU5ErkJggg=='

/**
 * A committed, inked diagram. A data URI, for the same reason as the logo.
 *
 * It replaced the logo, which the diagram fixtures were reusing as their figure
 * — and the logo is a 16×16 near-blank PNG, so the "labelled diagram" fixtures
 * rendered a figure with no visible ink at all. Their own `requires` predicates
 * passed, because those check the fixture DATA: labels present, leader
 * coordinates finite, identify mode set. Every one of those was true of a paper
 * whose diagram printed nothing.
 *
 * So this one is drawn: an outline with a chamfered corner, internal divisions,
 * two vessels leaving the top and a hatched region — thin strokes and small
 * detail, which is what the fixtures exist to watch, and enough distinct parts
 * for four leader lines to point at different places.
 */
const DIAGRAM_DATA_URI = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAB6UlEQVR4Ae3BMW4jUQxEweeG'
  + 'bsCAEe9/sB8x+GfwOhlgQlszBmVtV318fsHGCBslhlQGr6QymCBslLBRwkYJGyVslLBRwkZ9'
  + 'fH7hCZXB/2b15m4PLli9eRWVwerNb6oMVm/uJOzbVm8qgzsJGyXsR1ZvKoO7CPux1ZvK4A7C'
  + 'nrJ6UxlcJWyUsKet3lQGVwi7ZPWmMniWsMtWbyqDZwgbJewWqzeVwU8Ju83qTWXwE8JutXpT'
  + 'GXyXsFHCbrd6Uxl8h7BRwkYJGyVslLBRwkYJGyVslLBRwkYJGyVslLBRwkYJGyVslLBRwkYJ'
  + 'G/XggsrArnlwwerNq6gM/iJho4SNEjZK2KgHb6Qy+GsevJHVm1dRGXyHsFHCRgkbJWyUsFHC'
  + 'RombVQZnlcFZZXBWGZxVBmeVwVll8E6EjRI2StgocbPVm8rgsHpTGRxWbyqDw+pNZXBYvakM'
  + 'Dqs3lcFh9aYyeBfCRgkbJWyUsFHCRgkbJX7B6k1lcFi9qQwOqzeVwWH1pjI4rN5UBofVm8rg'
  + 'sHpTGbwDYaOEjRI2SvyS1Zuz1Zuz1Zuz1Zuz1Zuz1Zuz1Zt3IGyUsFHCRgkbJWyUsFEPLqgM'
  + 'Xkll8Nc8eNLqjV0nbJSwUcJGCRslbJSwUcJGCRslbJSwUcJGCRv1Dx1HfuGpJcxiAAAAAElF'
  + 'TkSuQmCC'

/** A deterministic enlarged SVG: fine diagonals, curves, arrowheads, labels. */
const ENLARGED_SVG = {
  libraryKey: 'vr-enlarged-vector',
  params: {},
  // Committed inline so the fixture cannot depend on the catalog changing.
  svg: [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">',
    // Fine diagonals — the case that exposes raster fallback and resampling.
    '<path d="M4 76 L116 4" stroke="#1c1612" stroke-width="0.4" fill="none"/>',
    '<path d="M4 4 L116 76" stroke="#1c1612" stroke-width="0.4" fill="none"/>',
    // A curve.
    '<path d="M10 60 Q60 10 110 60" stroke="#1c1612" stroke-width="0.6" fill="none"/>',
    // An arrowhead: three thin strokes meeting, which blurs first under raster.
    '<path d="M100 40 L110 40 M110 40 L106 36 M110 40 L106 44"'
    + ' stroke="#1c1612" stroke-width="0.5" fill="none"/>',
    // Small text — 3px, deliberately at the edge of legibility.
    '<text x="12" y="20" font-size="3" font-family="Arial" fill="#1c1612">axis</text>',
    '<text x="90" y="70" font-size="3" font-family="Arial" fill="#1c1612">50 mm</text>',
    '</svg>',
  ].join(''),
}

const vertical = (operator, lines, answer, working = false) =>
  `<div class="vert-arith" data-vertical-arithmetic="1" data-operator="${operator}"`
  + ` data-lines="${lines.join('|')}" data-answer="${answer}"`
  + `${working ? ' data-working="true"' : ''}></div>`

const fraction = (whole, num, den) =>
  `<span class="math-frac" data-math-fraction="1" data-whole="${whole}"`
  + ` data-num="${num}" data-den="${den}"></span>`

/* ── the eight ──────────────────────────────────────────────────────────── */

export const VISUAL_FIXTURES = [
  {
    id: 'vr-001',
    title: 'Fractions and mixed numbers',
    targets: ['browser-print', 'docx'],
    protects: [
      'stacked fraction bars',
      'mixed numbers',
      'small denominators',
      'marks printed beside a glyph',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [{ type: 'maths', anchor: 'question_1' }, { type: 'maths', anchor: 'question_2' }],
    together: [],
    assessment: {
      ...SCHOOL,
      title: 'Fractions Test',
      subject: 'Mathematics',
      grade: '7',
      framework: '2023',
      totalMarks: 6,
      duration: 40,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'short_answer', marks: 2,
        text: `<p>Simplify ${fraction('', '6', '8')} and give your answer in its lowest terms.</p>`,
      },
      {
        id: 'q2', order: 2, type: 'short_answer', marks: 2,
        text: `<p>Write ${fraction('1', '1', '2')} as an improper fraction.</p>`,
      },
      {
        id: 'q3', order: 3, type: 'mcq', marks: 2,
        text: `<p>Which is equal to ${fraction('', '1', '4')}?</p>`,
        options: [
          `${fraction('', '2', '8')}`, `${fraction('', '1', '2')}`,
          `${fraction('', '3', '4')}`, `${fraction('', '2', '3')}`,
        ],
        correctAnswer: 0,
      },
    ],
    // Its own purpose, checked before anything renders.
    requires: [
      ['a stacked fraction', (f) => f.questions.some((q) => /math-frac/.test(q.text || ''))],
      ['a mixed number', (f) => f.questions.some((q) => /data-whole="1"/.test(q.text || ''))],
      ['marks on every question', (f) => f.questions.every((q) => Number(q.marks) > 0)],
    ],
  },

  {
    id: 'vr-002',
    title: 'Long division',
    targets: ['browser-print', 'docx'],
    protects: [
      'the division bracket',
      'the quotient above the bracket',
      'subtraction rules inside the working',
      'the remainder',
      'an empty learner-working version',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [{ type: 'maths', anchor: 'question_1' }, { type: 'maths', anchor: 'question_2' }],
    together: [],
    assessment: {
      ...SCHOOL,
      title: 'Long Division Test',
      subject: 'Mathematics',
      grade: '6',
      framework: '2023',
      totalMarks: 8,
      duration: 45,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'structured', marks: 4,
        text: '<p>Divide 852 by 4. Show your working.</p>',
        // The learner's version: the frame with nothing filled in.
        richContent: `<p>${vertical('÷', ['852', '4'], '', true)}</p>`,
        answerLines: 6,
      },
      {
        id: 'q2', order: 2, type: 'structured', marks: 4,
        text: '<p>Divide 947 by 5 and state the remainder.</p>',
        richContent: `<p>${vertical('÷', ['947', '5'], '', true)}</p>`,
        answerLines: 6,
      },
    ],
    requires: [
      ['a division layout', (f) => f.questions.some((q) => /data-operator="÷"/.test(q.richContent || ''))],
      ['learner working space', (f) => f.questions.some((q) => /data-working="true"/.test(q.richContent || ''))],
      ['an unfilled answer', (f) => f.questions.some((q) => /data-answer=""/.test(q.richContent || ''))],
      ['a remainder question', (f) => f.questions.some((q) => /remainder/i.test(q.text || ''))],
    ],
  },

  {
    id: 'vr-003',
    title: 'Vertical arithmetic',
    targets: ['browser-print', 'docx'],
    protects: [
      'carrying',
      'regrouping across a place value',
      'aligned decimal points',
      'multiplication partial products',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [
      { type: 'maths', anchor: 'question_1' }, { type: 'maths', anchor: 'question_2' },
      { type: 'maths', anchor: 'question_3' }, { type: 'maths', anchor: 'question_4' },
    ],
    together: [],
    assessment: {
      ...SCHOOL,
      title: 'Column Arithmetic',
      subject: 'Mathematics',
      grade: '5',
      framework: '2023',
      totalMarks: 8,
      duration: 40,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'structured', marks: 2,
        text: '<p>Work out the addition. Carry where you need to.</p>',
        richContent: `<p>${vertical('+', ['478', '265'], '', true)}</p>`,
      },
      {
        id: 'q2', order: 2, type: 'structured', marks: 2,
        text: '<p>Work out the subtraction. Regroup where you need to.</p>',
        richContent: `<p>${vertical('−', ['802', '347'], '', true)}</p>`,
      },
      {
        id: 'q3', order: 3, type: 'structured', marks: 2,
        text: '<p>Add these amounts. Keep the decimal points in line.</p>',
        richContent: `<p>${vertical('+', ['12.75', '3.40'], '', true)}</p>`,
      },
      {
        id: 'q4', order: 4, type: 'structured', marks: 2,
        text: '<p>Multiply. Show each partial product.</p>',
        richContent: `<p>${vertical('×', ['346', '24'], '', true)}</p>`,
      },
    ],
    requires: [
      ['an addition with carrying', (f) => f.questions.some((q) => /data-operator="\+"/.test(q.richContent || ''))],
      ['a subtraction needing regrouping', (f) => f.questions.some((q) => /data-operator="−"/.test(q.richContent || ''))],
      ['a multiplication', (f) => f.questions.some((q) => /data-operator="×"/.test(q.richContent || ''))],
      ['aligned decimals', (f) => f.questions.some((q) => /data-lines="[^"]*\d+\.\d+/.test(q.richContent || ''))],
    ],
  },

  {
    id: 'vr-004',
    title: 'Science diagrams, learner and marking scheme',
    // The fixture that carries BOTH renderings, so drift between them is visible.
    targets: ['browser-print', 'docx'],
    renderBothModes: true,
    protects: [
      'thin leader lines',
      'arrowheads',
      'small diagram labels',
      'the unlabelled learner figure',
      'the labelled marking-scheme figure',
      'question-answer identity across both copies',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [
      { type: 'diagram', anchor: 'diagram_1' },
      { type: 'label', anchor: 'diagram_1' },
    ],
    together: [['diagram_1', 'question_1'], ['answer_1', 'question_1']],
    assessment: {
      ...SCHOOL,
      title: 'The Heart',
      subject: 'Integrated Science',
      grade: '7',
      framework: '2023',
      totalMarks: 4,
      duration: 30,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'diagram', marks: 4,
        text: '<p>Name the parts of the heart.</p>',
        imageUrl: DIAGRAM_DATA_URI,
        imageAlt: 'A diagram of the heart',
        diagramMode: 'identify',
        diagramLabels: [
          { x: 0.25, y: 0.3, tx: 0.4, ty: 0.35, text: 'Aorta' },
          { x: 0.6, y: 0.55, tx: 0.5, ty: 0.6, text: 'Left ventricle' },
          { x: 0.3, y: 0.75, tx: 0.42, ty: 0.7, text: 'Vena cava' },
          { x: 0.75, y: 0.25, tx: 0.62, ty: 0.32, text: 'Right atrium' },
        ],
      },
    ],
    requires: [
      ['a labelled diagram', (f) => f.questions.some((q) => (q.diagramLabels || []).length >= 3)],
      ['leader lines', (f) => f.questions.some((q) => (q.diagramLabels || []).some((l) => Number.isFinite(l.tx)))],
      ['identify mode, so the learner copy is unlabelled', (f) => f.questions.some((q) => q.diagramMode === 'identify')],
      ['both copies rendered', (f) => f.renderBothModes === true],
      ['answer tied to its question', (f) => f.together.some(([a, b]) => a === 'answer_1' && b === 'question_1')],
    ],
  },

  {
    id: 'vr-005',
    title: 'Tables, graphs and geometry',
    targets: ['browser-print', 'docx'],
    protects: [
      'narrow table rules',
      'axis labels',
      'plotted points',
      'dimension text',
      'angle marks',
      'geometric shapes',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [
      { type: 'table', anchor: 'question_1' },
      { type: 'diagram', anchor: 'diagram_2' },
      { type: 'label', anchor: 'diagram_2' },
    ],
    together: [['diagram_2', 'question_2']],
    assessment: {
      ...SCHOOL,
      title: 'Data and Shape',
      subject: 'Mathematics',
      grade: '8',
      framework: '2023',
      totalMarks: 6,
      duration: 40,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'short_answer', marks: 3,
        text: '<p>Study the table and answer the question.</p>',
        tableData: {
          headers: ['Crop', 'Hectares', 'Yield (t)'],
          rows: [['Maize', '120', '480'], ['Groundnuts', '45', '90'], ['Cassava', '60', '300']],
        },
      },
      {
        id: 'q2', order: 2, type: 'short_answer', marks: 3,
        text: '<p>Find the size of the marked angle.</p>',
        imageDiagram: ENLARGED_SVG,
      },
    ],
    requires: [
      ['a table with rules', (f) => f.questions.some((q) => (q.tableData?.rows || []).length >= 2)],
      ['a geometric figure', (f) => f.questions.some((q) => q.imageDiagram)],
      ['axis or dimension labels', (f) => f.questions.some((q) => /text/.test(q.imageDiagram?.svg || ''))],
    ],
  },

  {
    id: 'vr-006',
    title: 'Multi-page paper with controlled page breaks',
    targets: ['browser-print', 'docx'],
    protects: [
      'section boundaries',
      'question blocks that must not split',
      'answer spaces',
      'explicit page placement',
      'page numbering across pages',
    ],
    expectedPageCount: 3,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [],
    // Declared page membership, which is what makes a move reportable.
    expectedAnchorPages: { question_1: 1, question_8: 2, question_14: 3 },
    together: [],
    assessment: {
      ...SCHOOL,
      title: 'End of Term Examination',
      subject: 'English',
      grade: '7',
      framework: '2023',
      totalMarks: 40,
      duration: 90,
      date: '2026-01-15',
      showNameField: true,
      showDateField: true,
      showMarksField: true,
    },
    // Eighteen questions with generous answer space: deterministic, and long
    // enough that a spacing change moves a question across a page boundary.
    questions: Array.from({ length: 18 }, (_, i) => ({
      id: `q${i + 1}`,
      order: i + 1,
      type: 'short_answer',
      marks: 2,
      text: `<p>Question ${i + 1}. Write a full sentence about the passage you read.</p>`,
      answerLines: 4,
    })),
    requires: [
      ['enough questions to span pages', (f) => f.questions.length >= 12],
      ['answer space on every question', (f) => f.questions.every((q) => Number(q.answerLines) > 0)],
      ['more than one expected page', (f) => Number(f.expectedPageCount) > 1],
      ['declared page membership', (f) => Object.keys(f.expectedAnchorPages || {}).length >= 2],
    ],
  },

  {
    id: 'vr-007',
    title: 'Branded school header',
    targets: ['browser-print', 'docx'],
    protects: [
      'the school logo',
      'candidate name and class fields',
      'total marks',
      'duration',
      'page numbering',
      'the school footer',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    grayscale: false,
    regions: [{ type: 'header', anchor: 'header' }],
    together: [],
    assessment: {
      ...SCHOOL,
      schoolLogoUrl: LOGO_DATA_URI,
      title: 'Mid-Term Test',
      subject: 'Social Studies',
      grade: '6',
      framework: '2023',
      paperName: 'Paper 1',
      totalMarks: 20,
      duration: 60,
      date: '2026-01-15',
      showNameField: true,
      showDateField: true,
      showClassField: true,
      showMarksField: true,
      footerCode: 'SS/6/2026/P1',
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'short_answer', marks: 20,
        text: '<p>Name the ten provinces of Zambia.</p>',
        answerLines: 10,
      },
    ],
    requires: [
      ['a logo', (f) => Boolean(f.assessment.schoolLogoUrl)],
      // The logo must be local. A fetched logo could fail and still produce a
      // consistent — and wrong — baseline.
      ['a LOCAL logo', (f) => /^data:/.test(f.assessment.schoolLogoUrl || '')],
      ['candidate fields', (f) => f.assessment.showNameField && f.assessment.showClassField],
      ['total marks and duration', (f) => Number(f.assessment.totalMarks) > 0 && Number(f.assessment.duration) > 0],
      ['a footer', (f) => Boolean(f.assessment.footerCode)],
    ],
  },

  {
    id: 'vr-008',
    title: 'Photocopy output and an enlarged vector diagram',
    targets: ['browser-print', 'docx'],
    protects: [
      'grayscale legibility',
      'very thin features',
      'fine diagonals',
      'curves',
      'small text inside a figure',
      'an enlarged SVG that must stay vector',
    ],
    expectedPageCount: 1,
    forbidTrailingBlankPage: true,
    // The one fixture rendered in grayscale, because that is the sheet a Zambian
    // learner actually receives.
    grayscale: true,
    requiresGrayscaleLegibility: true,
    regions: [{ type: 'diagram', anchor: 'diagram_1' }, { type: 'label', anchor: 'diagram_1' }],
    together: [['diagram_1', 'question_1']],
    assessment: {
      ...SCHOOL,
      title: 'Measurement',
      subject: 'Mathematics',
      grade: '8',
      framework: '2023',
      totalMarks: 4,
      duration: 30,
      date: '2026-01-15',
      showNameField: true,
    },
    questions: [
      {
        id: 'q1', order: 1, type: 'short_answer', marks: 4,
        text: '<p>Measure the marked length and give your answer in millimetres.</p>',
        imageDiagram: ENLARGED_SVG,
        // Deliberately large so resampling, clipping and intrinsic-dimension
        // errors are visible rather than hidden by a small print size.
        imageWidth: 'large',
      },
    ],
    requires: [
      ['grayscale rendering', (f) => f.grayscale === true],
      ['an enlarged vector figure', (f) => f.questions.some((q) => q.imageDiagram && q.imageWidth === 'large')],
      ['fine diagonals', (f) => /stroke-width="0\.[0-9]/.test(f.questions[0]?.imageDiagram?.svg || '')],
      ['a curve', (f) => / Q\d/.test(f.questions[0]?.imageDiagram?.svg || '')],
      ['small text in the figure', (f) => /font-size="[1-4]"/.test(f.questions[0]?.imageDiagram?.svg || '')],
      ['a known viewBox', (f) => /viewBox="0 0 \d+ \d+"/.test(f.questions[0]?.imageDiagram?.svg || '')],
    ],
  },
]

/** Fixture by permanent ID. */
export function fixtureById(id) {
  return VISUAL_FIXTURES.find((f) => f.id === id) || null
}

/**
 * Validate one fixture's contract, INCLUDING that its declared purpose is
 * actually present in its data.
 *
 * Returns a list of problems; [] is the pass. Run before rendering — a fixture
 * whose long-division block was accidentally deleted must fail here rather than
 * render a consistent paper with no long division in it and report green.
 */
export function validateFixture(fixture) {
  const problems = []
  if (!fixture || typeof fixture !== 'object') return ['not a fixture object']
  if (!/^vr-\d{3}$/.test(fixture.id || '')) problems.push('id must be a permanent vr-NNN identifier')
  if (!fixture.title) problems.push('no title')
  const targets = Array.isArray(fixture.targets) ? fixture.targets : []
  if (!targets.length) problems.push('declares no rendering target')
  for (const t of targets) {
    if (!RENDER_TARGETS.includes(t)) problems.push(`unknown rendering target "${t}"`)
  }
  if (!(Number(fixture.expectedPageCount) > 0)) problems.push('no expected page count')
  if (typeof fixture.forbidTrailingBlankPage !== 'boolean') {
    problems.push('must state whether a trailing blank page is forbidden')
  }
  if (typeof fixture.grayscale !== 'boolean') problems.push('must state its grayscale mode')
  for (const region of fixture.regions || []) {
    if (!REGION_TYPES.includes(region.type)) problems.push(`unknown region type "${region.type}"`)
    if (!region.anchor) problems.push(`region of type "${region.type}" has no anchor`)
  }
  for (const pair of fixture.together || []) {
    if (!Array.isArray(pair) || pair.length !== 2) problems.push('a togetherness pair must be two anchor IDs')
  }
  if (!Array.isArray(fixture.protects) || !fixture.protects.length) {
    problems.push('declares no printed feature that it protects')
  }
  if (!Array.isArray(fixture.questions) || !fixture.questions.length) {
    problems.push('has no questions')
  }
  if (!fixture.assessment) problems.push('has no assessment header')

  // Determinism: nothing may carry today's date or a generated id.
  const serialised = JSON.stringify({ a: fixture.assessment, q: fixture.questions })
  if (/\bnew Date\b|Date\.now/.test(serialised)) problems.push('fixture data must not read the clock')
  if (fixture.assessment && !/^\d{4}-\d{2}-\d{2}$/.test(String(fixture.assessment.date || ''))) {
    problems.push('assessment.date must be a fixed literal date')
  }
  // Assets must be local. A fetched asset could fail and still produce a
  // consistent baseline of a paper missing its figure.
  //
  // XML namespace declarations are stripped first. `http://www.w3.org/2000/svg`
  // is an IDENTIFIER, not an address — nothing ever requests it — and a check
  // that flagged every inline SVG would be the over-broad kind that gets
  // switched off. What actually fetches is a src/href/url() pointing outward.
  const withoutNamespaces = serialised.replace(/xmlns(:\w+)?=\\?"[^"\\]*\\?"/g, '')
  for (const url of withoutNamespaces.match(/https?:\/\/[^"'\\ )]+/g) || []) {
    problems.push(`fixture data reaches the network: ${url}`)
  }

  // The part that matters: is the fixture's purpose still in its data?
  for (const [what, predicate] of fixture.requires || []) {
    let ok = false
    try {
      ok = Boolean(predicate(fixture))
    } catch (err) {
      problems.push(`checking "${what}" threw: ${err.message}`)
      continue
    }
    if (!ok) {
      problems.push(
        `declares that it protects "${what}" but its data no longer contains it — `
        + 'this fixture would render consistently while testing nothing',
      )
    }
  }
  return problems
}

/** Validate the whole set. Returns {id: problems[]} for failing fixtures only. */
export function validateAllFixtures(fixtures = VISUAL_FIXTURES) {
  const out = {}
  const seen = new Set()
  for (const fixture of fixtures) {
    const problems = validateFixture(fixture)
    if (seen.has(fixture?.id)) problems.push('duplicate fixture id')
    seen.add(fixture?.id)
    if (problems.length) out[fixture?.id || '(no id)'] = problems
  }
  return out
}
