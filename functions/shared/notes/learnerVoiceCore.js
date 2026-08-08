/**
 * The learner-voice lint (§3).
 *
 * A learner note is written TO a child. The generator it replaced wrote TO the
 * teacher, and a prompt that says "never instruct the teacher" is a request,
 * not a guarantee — the model reverts to delivery language the moment a topic
 * gets hard to explain, and the sentence that comes back ("Write both words on
 * the board and say…") is addressed to somebody who is not holding the sheet.
 *
 * So the contract is checked after generation rather than only asked for
 * before it. Anything this finds names the SECTION it found it in, and the
 * runner regenerates that section alone — the rest of a good document is not
 * thrown away over one sentence.
 *
 * ## Why the rules are phrase patterns and not a classifier
 *
 * Every failure mode here is a small closed set of stock classroom phrases,
 * and a teacher reading the output has to be able to see why a sentence was
 * refused. A pattern list is inspectable; a score is not. The cost is false
 * positives, which is why each rule carries its own allowlist — "ask your
 * teacher if you are stuck" is learner voice and must survive, while "ask the
 * class" must not.
 *
 * Shared by both runtimes: the Cloud Function lints before saving, and the
 * studio can lint a teacher's own edit without a round trip.
 */

/**
 * Each rule is { id, pattern, why, allow }.
 *
 * `why` is shown to a human, so it says what is wrong with the sentence rather
 * than naming the regex. `allow` is a list of patterns that, when they match
 * the surrounding excerpt, mean this occurrence is legitimate learner voice.
 */
export const LEARNER_VOICE_RULES = Object.freeze([
  {
    id: 'board-instruction',
    pattern: /\b(?:write|draw|put|copy|show|display)[^.!?]{0,40}\bon the (?:chalk)?board\b/gi,
    why: 'tells the teacher what to put on the board',
  },
  {
    id: 'board-mention',
    pattern: /\bon the (?:chalk)?board\b/gi,
    why: 'refers to the board, which only the teacher writes on',
  },
  {
    id: 'address-the-class',
    pattern: /\b(?:ask|tell|remind|guide|show|give|get|have|let|encourage|allow|prompt|assign|instruct|question)\s+(?:the\s+|your\s+)?(?:class|learners|pupils|students|children|group|whole class)\b/gi,
    why: 'gives the teacher an instruction about the class',
    // "ask your teacher", "tell your friend", "show your work" are the
    // learner's own actions and read correctly on a handout.
    allow: [/\b(?:ask|tell|show|give)\s+your\s+(?:teacher|friend|partner|parent|work|answer)/i],
  },
  {
    id: 'possessive-class',
    pattern: /\byour\s+(?:learners|pupils|students|class)\b/gi,
    why: 'addresses the reader as somebody who has a class — the reader is in one',
  },
  {
    id: 'third-person-learners',
    pattern: /\b(?:the\s+)?(?:learners|pupils|students)\s+(?:will|should|must|can|need|often|may|are|have)\b/gi,
    why: 'writes ABOUT learners instead of to the learner',
  },
  {
    id: 'delivery-verb',
    pattern: /\b(?:emphasi[sz]e|elicit|scaffold|differentiate|recap with|model for|circulate)\b/gi,
    why: 'is lesson-delivery vocabulary, not something a learner does',
  },
  {
    id: 'use-the-example',
    pattern: /\buse the (?:worked )?example\b/gi,
    why: 'instructs the teacher on how to use the material',
  },
  {
    id: 'teacher-as-actor',
    pattern: /\bthe teacher (?:should|must|will need|needs to|can then|may then)\b/gi,
    why: 'makes the teacher the actor of the sentence',
  },
  {
    id: 'lesson-staging',
    pattern: /\b(?:during (?:this|the) lesson|at the start of the lesson|before the lesson|in (?:this|the) lesson,? (?:you|we) will teach)\b/gi,
    why: 'stages a lesson rather than teaching the reader',
  },
])

/** Strip a value down to plain text a rule can be run over. */
function asText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' • ')
  if (value && typeof value === 'object') {
    return Object.values(value).map(asText).filter(Boolean).join(' • ')
  }
  return ''
}

/** A short window of text around a match, for the human-readable report. */
function excerptAround(text, index, length) {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * Run every rule over one string.
 *
 * @returns {Array<{rule: string, why: string, phrase: string, excerpt: string}>}
 */
export function lintLearnerText(value) {
  const text = asText(value)
  if (!text) return []
  const found = []
  const seen = new Set()
  for (const rule of LEARNER_VOICE_RULES) {
    // A `g` regex carries lastIndex between calls; a fresh one per run keeps
    // the lint from depending on how many documents preceded it.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    let match
    while ((match = re.exec(text)) !== null) {
      const excerpt = excerptAround(text, match.index, match[0].length)
      if (rule.allow && rule.allow.some((a) => a.test(excerpt))) continue
      // One rule firing twice on the same phrase in the same section is one
      // finding as far as the teacher is concerned.
      const key = `${rule.id}::${match[0].toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ rule: rule.id, why: rule.why, phrase: match[0], excerpt })
      if (match[0].length === 0) re.lastIndex += 1
    }
  }
  return found
}

/**
 * The sections of a learner-notes document, in the order they are written, and
 * the field each one owns.
 *
 * This list is what makes a violation ACTIONABLE: `id` is the unit the runner
 * regenerates. A finding that cannot name one of these is a finding nobody can
 * fix, so `lintLearnerNotes` only walks these fields.
 */
export const LEARNER_SECTION_FIELDS = Object.freeze([
  { id: 'outcomes', label: 'What you will learn', field: 'learningOutcomes' },
  { id: 'sections', label: 'The notes body', field: 'sections' },
  { id: 'workedExamples', label: 'Worked examples', field: 'workedExamples' },
  { id: 'dontMixThese', label: "Don't mix these up!", field: 'dontMixThese' },
  { id: 'learnerQuestions', label: 'Questions learners ask', field: 'learnerQuestions' },
  { id: 'rememberBox', label: 'Remember!', field: 'rememberBox' },
  { id: 'exercise', label: 'Exercise', field: 'exercise' },
])

/**
 * Lint a whole learner-notes document.
 *
 * The ANSWER KEY is deliberately not linted: it is the one part of the
 * document addressed to the teacher, and flagging "Accept any answer that
 * mentions…" there would send the runner into a rewrite loop over a sentence
 * that is correct exactly as written.
 *
 * @returns {{ok: boolean, violations: Array, sections: string[]}}
 *   `sections` is the de-duplicated list of section ids needing a rewrite.
 */
export function lintLearnerNotes(notes) {
  if (!notes || typeof notes !== 'object') {
    return { ok: true, violations: [], sections: [] }
  }
  const violations = []
  for (const section of LEARNER_SECTION_FIELDS) {
    const value = notes[section.field]
    if (value == null) continue
    for (const hit of lintLearnerText(value)) {
      violations.push({ ...hit, section: section.id, sectionLabel: section.label })
    }
  }
  const sections = [...new Set(violations.map((v) => v.section))]
  return { ok: violations.length === 0, violations, sections }
}

/** One sentence a human can act on, for logs and the studio's warning strip. */
export function learnerVoiceMessage(result) {
  if (!result || result.ok) return ''
  const n = result.violations.length
  const where = result.sections.length === 1 ? 'section' : 'sections'
  return `${n} teacher-directed ${n === 1 ? 'phrase' : 'phrases'} found in ${result.sections.length} ${where}`
}
