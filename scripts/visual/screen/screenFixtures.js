/**
 * The learner-SCREEN visual fixture set — a third render family (§4.6).
 *
 * `scripts/visual/fixtures.js` protects printed papers. This protects what a
 * learner sees on a phone, which is the first engine code they will meet and is
 * measured by nothing today.
 *
 * ## Why this is a separate family and not a third `target`
 *
 * The paper stages render `buildPrintableHtml` / `buildDocxDocument` through
 * Chromium and LibreOffice and compare A4 pages under an anchor contract. None
 * of that applies here: there are no pages, no pagination, no `.docx`, and the
 * unit of comparison is a viewport rather than a sheet. What IS shared is the
 * part worth sharing — `baselineIdentity`, `assertComparableEnvironment`,
 * `comparePages` and the CI-only baseline writers — so this reuses those and
 * brings its own stage.
 *
 * ## The render path is client-side, and that was a finding, not a preference
 *
 * The obvious cheap implementation is `renderToStaticMarkup` — no browser, no
 * bundler, fast. It is **structurally incapable of measuring the thing this
 * gate exists for**, and it was measured rather than assumed:
 *
 *     renderToStaticMarkup(<RichContent value={a 3/4 fraction doc} />)
 *       → '<span class="rich-content">Simplify /</span>'
 *
 * `RichContent` renders rich content from a `useEffect` and hydrates KaTeX in a
 * `setTimeout`. Under SSR no effect runs, so the fraction collapses to a bare
 * slash — the exact "slash form" §4.1 forbids. An SSR gate would have recorded
 * visibly wrong output as the reference and stayed green forever afterwards.
 *
 * So the stage mounts the components in a real Chromium with `createRoot`,
 * waits for fonts and hydration, and screenshots. Verified end to end while
 * designing this: the fraction renders as `.math-frac-num` over
 * `.math-frac-den` — stacked, no slash on the page — inside the §4 single
 * column with A/B/C/D badges.
 *
 * ## Named page checks
 *
 * Each fixture declares `pageChecks` — assertions the stage runs IN THE PAGE
 * before the screenshot, implemented in `screenStage.mjs`. A pixel baseline
 * answers "did this change"; it cannot answer "was it ever right", and a
 * baseline recorded from wrong output looks identical to one recorded from
 * right output forever after. `stackedNotation` is the check that would have
 * caught #2128 — it measures that the numerator's box sits ABOVE the
 * denominator's, which class-presence alone cannot tell you.
 *
 * An empty list is allowed and must still be written down: absent, a fixture
 * opts out of every check silently.
 *
 * ## A fixture validates itself
 *
 * Same rule as the paper set, for the same reason: someone edits a fixture,
 * drops the maths, and the maths fixture keeps passing because a page with no
 * maths renders consistently too. Every fixture declares `protects` and a
 * `requires` predicate list checked BEFORE rendering.
 *
 * ## Determinism
 *
 * No clock, no ids, no network. Fonts arrive inlined as data URIs through the
 * bundle, so a screenshot cannot depend on a font request succeeding.
 *
 * ## IDs are permanent
 *
 * `scr-001` … never change: baselines and update commands key on them, so a
 * fixture can be retitled without orphaning its baselines.
 */

/** Viewports every fixture is captured at. */
export const SCREEN_VIEWPORTS = Object.freeze([
  // The width the §4 layout claim is actually about. A two-column grid
  // survives a desktop viewport and fails here, which is where the learners are.
  Object.freeze({ id: 'phone', width: 390, height: 844, deviceScaleFactor: 2 }),
  Object.freeze({ id: 'desktop', width: 1024, height: 768, deviceScaleFactor: 1 }),
])

/** Rich helpers — the canonical `RichContent` envelope the engine reads. */
const plain = (text) => ({ version: 1, tiptapDoc: null, plainTextFallback: text })
const doc = (content, fallback) => ({ version: 1, tiptapDoc: { type: 'doc', content }, plainTextFallback: fallback })
const para = (...content) => ({ type: 'paragraph', content })
const text = (value) => ({ type: 'text', text: value })
/** The stored shape of a stacked fraction — `MathFraction.js`'s own attributes. */
const fraction = (num, den, whole = '') => ({ type: 'mathFraction', attrs: { whole, num, den } })

const question = (over) => ({
  id: 'q1', type: 'mcq', marks: 1, topicIds: [], answerKey: {}, correctIndex: 1,
  prompt: plain('Question'), options: [], ...over,
})

/* ── predicates ──────────────────────────────────────────────────────────── */

const hasOptions = (n) => ({
  name: `${n} answer choices`,
  test: (f) => f.question.options.length === n,
})
const hasStackedFraction = {
  name: 'a stacked fraction in the prompt',
  test: (f) => JSON.stringify(f.question.prompt.tiptapDoc ?? {}).includes('mathFraction'),
}
const promptHasNoSlashForm = {
  // The failure §4.1 names. A fixture whose SOURCE contains "3/4" could render
  // a slash and look correct against a baseline recorded from the same source.
  name: 'no slash form anywhere in the source',
  test: (f) => !JSON.stringify(f.question).includes('/'),
}
const everyOptionLongerThan = (chars) => ({
  // EVERY option, not merely one. The fixture's purpose is a question whose
  // choices are all sentences — that is what forces a full-width row. With
  // `some`, three of four could be shortened to a word and the fixture would
  // keep passing while testing the layout against short rows. A control proved
  // exactly that.
  name: `every option longer than ${chars} characters`,
  test: (f) => f.question.options.length > 0
    && f.question.options.every((o) => (o.plainTextFallback ?? '').length > chars),
})
const isRevealed = { name: 'verdicts revealed', test: (f) => f.revealed === true }
const isUnrevealed = { name: 'verdicts NOT revealed', test: (f) => f.revealed !== true }
const hasAnswer = { name: 'an answered option', test: (f) => typeof f.answer === 'number' }

/* ── the fixtures ────────────────────────────────────────────────────────── */

export const SCREEN_FIXTURES = [
  {
    id: 'scr-001',
    pageChecks: ['letteredChoices', 'singleColumn', 'noVerdictLeak'],
    title: 'Four-option MCQ, unanswered',
    protects: ['the §4 single vertical column', 'A/B/C/D letter badges', 'the unanswered resting state'],
    requires: [hasOptions(4), isUnrevealed],
    answer: null,
    revealed: false,
    number: 1,
    question: question({
      prompt: plain('What is the capital city of Zambia?'),
      options: ['Ndola', 'Lusaka', 'Kitwe', 'Livingstone'].map(plain),
    }),
  },
  {
    id: 'scr-002',
    pageChecks: ['letteredChoices', 'singleColumn', 'noVerdictLeak'],
    title: 'Four-option MCQ, answered but not revealed',
    protects: ['the selected state', 'that NO verdict is painted before reveal'],
    requires: [hasOptions(4), hasAnswer, isUnrevealed],
    answer: 2,
    revealed: false,
    number: 2,
    question: question({
      prompt: plain('Which river forms the border with Zimbabwe?'),
      options: ['Kafue', 'Luangwa', 'Zambezi', 'Chambeshi'].map(plain),
      correctIndex: 2,
    }),
  },
  {
    id: 'scr-003',
    pageChecks: ['letteredChoices', 'singleColumn'],
    title: 'Revealed, answered wrongly',
    protects: ['the correct/incorrect verdict pair', 'the ✓ and ✗ marks that stop colour being the only signal'],
    requires: [hasOptions(4), hasAnswer, isRevealed],
    answer: 0,
    revealed: true,
    number: 3,
    question: question({
      prompt: plain('Which of these is a mammal?'),
      options: ['Crocodile', 'Elephant', 'Tilapia', 'Python'].map(plain),
      correctIndex: 1,
    }),
  },
  {
    id: 'scr-004',
    pageChecks: ['letteredChoices', 'singleColumn'],
    title: 'Five options — the D4 defect\'s shape',
    protects: ['that a fifth option is lettered E rather than left blank'],
    requires: [hasOptions(5)],
    answer: null,
    revealed: false,
    number: 4,
    question: question({
      prompt: plain('Which province is Kabwe in?'),
      options: ['Copperbelt', 'Central', 'Lusaka', 'Southern', 'Northern'].map(plain),
      correctIndex: 1,
    }),
  },
  {
    id: 'scr-005',
    pageChecks: ['letteredChoices', 'singleColumn'],
    title: 'Long options — the reason the column is vertical',
    protects: ['that a sentence-length option gets a full-width row and wraps rather than truncating'],
    requires: [hasOptions(4), everyOptionLongerThan(70)],
    answer: null,
    revealed: false,
    number: 5,
    question: question({
      prompt: plain('Why do farmers in Zambia practise crop rotation?'),
      options: [
        'Because it keeps the soil fertile by varying the nutrients each crop takes out and puts back',
        'Because it makes the harvest arrive earlier in the season than it otherwise would',
        'Because it reduces the amount of rainfall the field needs over the growing season',
        'Because it allows the same crop to be planted in the same field every single year',
      ].map(plain),
      correctIndex: 0,
    }),
  },
  {
    id: 'scr-006',
    pageChecks: ['stackedNotation', 'letteredChoices', 'singleColumn'],
    title: 'School notation — a stacked fraction in the prompt',
    protects: [
      '§4.1 school notation: a stacked fraction with a horizontal bar',
      'that KaTeX hydration ran at all — the reason this gate renders client-side',
    ],
    requires: [hasStackedFraction, promptHasNoSlashForm, hasOptions(4)],
    answer: null,
    revealed: false,
    number: 6,
    question: question({
      marks: 2,
      topicIds: ['Fractions'],
      prompt: doc(
        [para(text('Simplify '), fraction('6', '8'), text(' to its lowest terms.'))],
        'Simplify to its lowest terms.',
      ),
      options: [
        doc([para(fraction('1', '2'))], 'one half'),
        doc([para(fraction('3', '4'))], 'three quarters'),
        doc([para(fraction('2', '3'))], 'two thirds'),
        doc([para(fraction('1', '4'))], 'one quarter'),
      ],
      correctIndex: 1,
    }),
  },
  {
    id: 'scr-007',
    pageChecks: ['letteredChoices', 'singleColumn'],
    title: 'True/false',
    protects: ['that a two-choice question is lettered A and B, not left unlettered'],
    requires: [hasOptions(2)],
    answer: null,
    revealed: false,
    number: 7,
    question: question({
      type: 'tf',
      prompt: plain('Water boils at 100 degrees Celsius at sea level.'),
      options: ['True', 'False'].map(plain),
      correctIndex: 0,
    }),
  },
  {
    id: 'scr-008',
    pageChecks: [],
    title: 'A question stored with no answer choices',
    protects: ['that an unanswerable question is REPORTED to the learner, not drawn as a bare prompt'],
    requires: [hasOptions(0)],
    answer: null,
    revealed: false,
    number: 8,
    question: question({ prompt: plain('This question lost its choices.'), options: [] }),
  },
]

/** Look one up. */
export function screenFixture(id) {
  return SCREEN_FIXTURES.find((f) => f.id === id) || null
}

/**
 * Everything wrong with one fixture, as sentences.
 *
 * Returns problems rather than throwing so a run can report every broken
 * fixture at once instead of stopping at the first.
 */
export function screenFixtureProblems(fixture) {
  const problems = []
  const where = fixture?.id ?? '(no id)'

  if (!/^scr-\d{3}$/.test(fixture?.id ?? '')) problems.push(`${where}: id must look like scr-001`)
  if (!fixture?.title) problems.push(`${where}: has no title`)
  if (!Array.isArray(fixture?.protects) || fixture.protects.length === 0) {
    problems.push(`${where}: declares nothing it protects — a fixture nobody can name the purpose of is one nobody can tell is still needed`)
  }
  if (!Array.isArray(fixture?.requires) || fixture.requires.length === 0) {
    problems.push(`${where}: declares no requirement, so nothing checks its purpose is still in it`)
  }
  if (!fixture?.question) problems.push(`${where}: has no question`)
  // `pageChecks` must be DECLARED, even as an empty list. Absent, a fixture
  // silently opts out of every named check and its baseline records whatever
  // it drew — which is how the fraction bug would have been enshrined.
  if (!Array.isArray(fixture?.pageChecks)) {
    problems.push(`${where}: declares no pageChecks list (use [] to opt out deliberately)`)
  }

  for (const requirement of fixture?.requires ?? []) {
    let held = false
    try {
      held = requirement.test(fixture) === true
    } catch (err) {
      problems.push(`${where}: requirement "${requirement.name}" threw — ${err.message}`)
      continue
    }
    if (!held) problems.push(`${where}: no longer contains ${requirement.name}`)
  }
  return problems
}

/** Every problem across the set, plus the duplicate-id check no fixture can make alone. */
export function validateAllScreenFixtures(fixtures = SCREEN_FIXTURES) {
  const problems = fixtures.flatMap(screenFixtureProblems)
  const ids = fixtures.map((f) => f?.id)
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i)
  for (const id of new Set(duplicated)) problems.push(`${id}: duplicated — baselines key on the id`)
  return problems
}

/** Every baseline this set expects: one per fixture per viewport. */
export function screenBaselineTargets(fixtures = SCREEN_FIXTURES) {
  return fixtures.flatMap((f) => SCREEN_VIEWPORTS.map((v) => `${f.id}/${v.id}`))
}
