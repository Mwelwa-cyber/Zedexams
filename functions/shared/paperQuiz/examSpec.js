/**
 * What a past paper actually IS — how many questions it holds and how long it
 * runs — resolved from the paper itself.
 *
 * ⚠️ SHARED WITH THE FRONTEND, and that is the whole point of the module. The
 * exam clock is the SERVER's (`startAttempt` stamps `expiresAtMs` and nothing
 * the client says moves it), while the number a learner reads on the cover
 * before they tap Start is the BROWSER's. Those two have to be the same
 * number, and before this module they were not even the same RULE: the cover
 * defaulted to 90 minutes, the server core defaulted to 90 minutes separately,
 * the reader's "Est. time" panel guessed one minute per question, and timed
 * practice fell back to 60. Four answers to one question, on one paper.
 *
 * ── The ladder ───────────────────────────────────────────────────────────
 *
 * The paper prints its own facts on its cover — "There are 50 questions in
 * this EXPRESSIVE ARTS PAPER. You will be given EXACTLY 60 MINUTES" — so the
 * order below is simply "who read the paper, and how directly":
 *
 *   1. RECORDED  — `paper.durationMinutes`, typed by an admin in the Studio's
 *                  Details step. A human read the cover; it is also the only
 *                  override available, so it outranks everything.
 *   2. PRINTED   — `paper.printedSpec.durationMinutes`, read OFF the cover by
 *                  the importer (functions/teacherTools/pastPaperImport.js).
 *                  Exact, but a machine read it, so a human may correct it.
 *   3. OFFICIAL  — the ECZ paper length for that grade + subject. Right for
 *                  the subject, but it is the length of the CURRENT exam, and
 *                  ECZ has changed paper lengths between years — so this is an
 *                  approximation for an older paper and is labelled as one.
 *   4. ESTIMATED — from the questions the paper actually has, by type.
 *   5. DEFAULT   — 90 minutes, only when there is nothing at all to read (a
 *                  paper whose quiz has not been imported yet). An exam that
 *                  expires the instant it starts is a paper nobody can sit, so
 *                  the floor is a real number rather than zero.
 *
 * `exact` is false for rungs 3–5, and every surface that prints the number is
 * expected to say "About" when it is false. A guess presented as a fact is the
 * bug this module exists to end, not one it is allowed to re-create in nicer
 * words.
 *
 * DELIBERATELY NOT A RUNG: `quizzes/{id}.duration`. That field is the quiz
 * EDITOR's generic length dropdown and it defaults to 30 — every past-paper
 * quiz an admin has ever opened and saved carries it. Reading it would put a
 * 30-minute clock on a 60-minute paper, confidently.
 *
 * Plain ESM, no Firebase, no DOM — `neutrality.test.js` next door enforces it.
 */

/** Where a resolved duration came from. Ordered strongest first. */
export const EXAM_SPEC_SOURCE = Object.freeze({
  RECORDED: 'recorded',
  PRINTED: 'printed',
  OFFICIAL: 'official',
  ESTIMATED: 'estimated',
  DEFAULT: 'default',
})

/**
 * Admin-facing phrases for each source. Learner-facing copy is NOT here — the
 * cover says "About 60 minutes" and stops, because a twelve-year-old about to
 * sit a paper does not need the provenance of the number. An admin does, so
 * the Studio prints these.
 */
export const EXAM_SPEC_SOURCE_LABEL = Object.freeze({
  [EXAM_SPEC_SOURCE.RECORDED]: 'entered for this paper',
  [EXAM_SPEC_SOURCE.PRINTED]: "read from the paper's own instructions",
  [EXAM_SPEC_SOURCE.OFFICIAL]: 'the official ECZ length for this subject',
  [EXAM_SPEC_SOURCE.ESTIMATED]: 'estimated from the questions',
  [EXAM_SPEC_SOURCE.DEFAULT]: 'a default — nothing about this paper says',
})

export const DEFAULT_DURATION_MIN = 90
export const MIN_DURATION_MIN = 5
export const MAX_DURATION_MIN = 300

/**
 * The ECZ paper lengths, by grade and past-paper subject id.
 *
 * A MIRROR of `PSLE_2026` in src/config/examTimetable2026.js, transcribed from
 * the official timetable — duplicated rather than imported because that file is
 * ESM under `src/` and the Cloud Function cannot reach it. `test:paper-exam-
 * spec-mirror` fails the build if the two disagree in either direction, which
 * is the only thing that makes a second copy safe.
 */
export const OFFICIAL_PAPER_MINUTES = Object.freeze({
  7: Object.freeze({
    'english': 90,
    'science': 60,
    'mathematics': 90,
    'special-paper-1': 60,
    'social-studies': 75,
    'special-paper-2': 60,
    'creative-technology-studies': 75,
    'home-economics': 60,
    'expressive-arts': 75,
    'cinyanja': 60,
  }),
})

/**
 * Minutes a question of each kind is worth when nothing better is known.
 *
 * A coarse bucket, NOT the canonical type enum — `questionTypeCore.js` owns
 * that and lives in another shared area this one may not import. An unknown
 * type gets the written-answer allowance rather than the fastest one, because
 * running a learner out of time is the worse of the two errors.
 */
const MINUTES_PER_QUESTION = Object.freeze({
  choice: 1.2,
  blank: 1.5,
  written: 2.5,
  essay: 12,
})

/** Coarse bucket for the estimate. Loose on purpose — see MINUTES_PER_QUESTION. */
function questionBucket(question) {
  const type = String(question?.type || question?.questionType || '')
    .trim().toLowerCase().replace(/[\s/-]+/g, '_')
  if (!type) return Array.isArray(question?.options) && question.options.length ? 'choice' : 'written'
  if (type.includes('essay')) return 'essay'
  if (type.includes('fill') || type.includes('blank') || type.includes('cloze')) return 'blank'
  if (type.includes('mcq') || type.includes('choice') || type.includes('tf')
    || type.includes('true') || type.includes('boolean')) return 'choice'
  return 'written'
}

/** Clamp to the window an attempt may run for, or null if there is no number. */
export function clampDuration(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(n)))
}

/**
 * The time a paper's cover states, in minutes, or null.
 *
 * Written to read the sentence a Zambian exam paper actually prints — "You
 * will be given EXACTLY 60 MINUTES", "TIME: 1 hour 30 minutes", "2 hours" — and
 * to refuse everything else. It must never read "There are 50 questions" or
 * "Subject 84/1" as a time: a wrong duration is worse than none, because none
 * falls through to a rung that at least knows what subject it is looking at.
 */
export function parsePrintedDuration(text) {
  const raw = String(text == null ? '' : text)
    .replace(/[½]/g, ' 1/2')
    .replace(/[¾]/g, ' 3/4')
    .replace(/[¼]/g, ' 1/4')
    .toLowerCase()
  if (!raw.trim()) return null

  // "1 hour 30 minutes", "1 hr 30 min", "2 hours", "1 1/2 hours".
  const hours = raw.match(/(\d{1,2})\s*(?:(\d)\s*\/\s*(\d))?\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d{1,3})\s*(?:minutes?|mins?|m)\b)?/)
  if (hours) {
    const whole = Number(hours[1])
    const fraction = hours[2] && hours[3] ? Number(hours[2]) / Number(hours[3]) : 0
    const extra = hours[4] ? Number(hours[4]) : 0
    const total = whole * 60 + Math.round(fraction * 60) + extra
    return clampDuration(total)
  }

  // "60 MINUTES", "EXACTLY 60 MINUTES", "90 mins". The unit is required —
  // a bare number on an exam cover is far more often a question count,
  // a subject code or a mark total than it is a time.
  const minutes = raw.match(/(\d{1,3})\s*(?:minutes?|mins?)\b/)
  if (minutes) return clampDuration(Number(minutes[1]))

  return null
}

/** The ECZ length for a paper's grade + subject, or null when we don't hold one. */
export function officialDurationMinutes({ grade, subject } = {}) {
  const byGrade = OFFICIAL_PAPER_MINUTES[String(grade ?? '').trim()]
  if (!byGrade) return null
  const key = String(subject ?? '').trim().toLowerCase()
  return clampDuration(byGrade[key])
}

/**
 * How long the paper in front of us would take, from the questions themselves.
 *
 * Rounded UP to five minutes: an estimate printed as "62 minutes" claims a
 * precision it does not have, and of the two directions to be wrong in, the
 * one that hands a learner less time than the estimate said is the one they
 * feel.
 */
export function estimateDurationMinutes({ questions, questionCount } = {}) {
  const list = Array.isArray(questions) ? questions : null
  const count = list ? list.length : Number(questionCount)
  if (!Number.isFinite(count) || count <= 0) return null
  const raw = list
    ? list.reduce((sum, q) => sum + MINUTES_PER_QUESTION[questionBucket(q)], 0)
    : count * MINUTES_PER_QUESTION.choice
  // Settle the float BEFORE rounding up: fifty questions at 1.2 sum to
  // 60.00000000000001, which ceils to the next bracket and quietly turns a
  // clean hour into 65 minutes.
  const total = Math.round(raw * 10) / 10
  return clampDuration(Math.ceil(total / 5) * 5)
}

/** The count the paper's cover declares, when the importer read one. */
function printedQuestionCount(paper) {
  const n = Number(paper?.printedSpec?.questionCount)
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : null
}

/**
 * Everything the quiz cover, the clock and the reader panel need, from one
 * read of the paper. Every caller uses this — a surface that resolves its own
 * duration is a surface that will disagree with the clock.
 *
 * @param {object} args
 * @param {object} args.paper          the `pastPapers/{id}` document
 * @param {Array}  [args.questions]    the quiz's questions, when loaded
 * @param {number} [args.questionCount] when only the count is known
 * @returns {{durationMinutes:number, durationSource:string, exact:boolean,
 *            questionCount:number|null, declaredQuestionCount:number|null,
 *            countMatchesPaper:boolean|null, statedTime:string}}
 */
export function resolveExamSpec({ paper, questions, questionCount } = {}) {
  const recorded = clampDuration(paper?.durationMinutes ?? paper?.durationMin)
  const printed = clampDuration(paper?.printedSpec?.durationMinutes)
  const official = officialDurationMinutes({ grade: paper?.grade, subject: paper?.subject })
  const estimated = estimateDurationMinutes({ questions, questionCount })

  let durationMinutes = recorded
  let durationSource = EXAM_SPEC_SOURCE.RECORDED
  if (!durationMinutes) {
    durationMinutes = printed
    durationSource = EXAM_SPEC_SOURCE.PRINTED
  }
  if (!durationMinutes) {
    durationMinutes = official
    durationSource = EXAM_SPEC_SOURCE.OFFICIAL
  }
  if (!durationMinutes) {
    durationMinutes = estimated
    durationSource = EXAM_SPEC_SOURCE.ESTIMATED
  }
  if (!durationMinutes) {
    durationMinutes = DEFAULT_DURATION_MIN
    durationSource = EXAM_SPEC_SOURCE.DEFAULT
  }

  const held = Array.isArray(questions)
    ? questions.length
    : (Number.isFinite(Number(questionCount)) ? Number(questionCount) : null)
  const declared = printedQuestionCount(paper)

  return {
    durationMinutes,
    durationSource,
    exact: durationSource === EXAM_SPEC_SOURCE.RECORDED
      || durationSource === EXAM_SPEC_SOURCE.PRINTED,
    questionCount: held != null && held > 0 ? held : null,
    declaredQuestionCount: declared,
    // Whether the quiz holds every question the paper says it has. Null when
    // the paper never declared a total — "we do not know" is not "they agree".
    countMatchesPaper: declared == null || held == null || held <= 0
      ? null
      : declared === held,
    statedTime: typeof paper?.printedSpec?.statedTime === 'string'
      ? paper.printedSpec.statedTime
      : '',
  }
}

/**
 * The one the server asks: how long does this attempt run? Same ladder, so the
 * clock and the cover cannot disagree.
 */
export function resolveDurationMinutes(paper, questions) {
  return resolveExamSpec({ paper, questions }).durationMinutes
}
