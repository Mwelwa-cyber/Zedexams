/**
 * src/documentEngine/validationEngine.js
 *
 * ESM twin of `functions/documentEngine/validationEngineCore.js` — the shared
 * Document Understanding Engine's validation stage, for the browser (live editor
 * re-validation + the pre-publish checklist). `src/` (ESM) and `functions/`
 * (CJS) cannot import each other, so this is a hand-kept mirror pinned in
 * lockstep by `scripts/test-document-engine-parity.mjs` (the same pattern as
 * `src/utils/questionType.js` ↔ the server assessment schema).
 *
 * The small pure helpers (parseSourceNumber, findSourceNumberGaps, canonicalType)
 * are reimplemented locally with identical logic so the two engines produce
 * byte-identical results — the parity test runs both on the same fixtures and
 * deep-equals every output.
 */

export const UNCLEAR_TOKEN = '[UNCLEAR]'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Mirror of the server's SUPPORTED_TYPES / TYPE_ALIASES (pastPaperImportHelpers).
const SUPPORTED_TYPES = new Set([
  'mcq', 'tf', 'short_answer', 'fill_blanks', 'essay', 'numeric',
])
const TYPE_ALIASES = {
  multiple_choice: 'mcq',
  'multiple choice': 'mcq',
  multiplechoice: 'mcq',
  choice: 'mcq',
  truefalse: 'tf',
  true_false: 'tf',
  'true/false': 'tf',
  'true false': 'tf',
  boolean: 'tf',
  fill: 'fill_blanks',
  fill_blank: 'fill_blanks',
  fill_in_blank: 'fill_blanks',
  fill_in_the_blank: 'fill_blanks',
  fill_in_the_blanks: 'fill_blanks',
  'fill in the blank': 'fill_blanks',
  'fill in the blanks': 'fill_blanks',
  gap_fill: 'fill_blanks',
  cloze: 'fill_blanks',
  short: 'short_answer',
  'short answer': 'short_answer',
  shortanswer: 'short_answer',
  short_response: 'short_answer',
  structured: 'short_answer',
  matching: 'short_answer',
  match: 'short_answer',
  sequence: 'short_answer',
  ordering: 'short_answer',
  diagram: 'short_answer',
  label: 'short_answer',
  table: 'short_answer',
  calculation: 'numeric',
  essay: 'essay',
  long_answer: 'essay',
  extended: 'essay',
}

const ANSWER_KEY_HEADING_RE =
  /\b(answers?|answer\s*key|marking\s*(?:scheme|key|guide)|mark\s*scheme|memorandum|\bmemo\b)\b/i
const ANSWER_KEY_PAIR_RE =
  /(?:^|\s)(\d{1,3})\s*[).:-]?\s*(?:answer\s*[:-]?\s*)?([A-E]|true|false)\b/gi

function str(v) {
  return v == null ? '' : String(v)
}

function uniqueSortedInts(list) {
  return Array.from(new Set(list.filter((n) => Number.isInteger(n)))).sort(
    (a, b) => a - b,
  )
}

function canonicalType(raw) {
  const key = str(raw).trim().toLowerCase()
  if (!key) return ''
  if (SUPPORTED_TYPES.has(key)) return key
  return TYPE_ALIASES[key] || ''
}

function parseSourceNumber(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  const m = str(v).match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null
}

export function findSourceNumberGaps(questions) {
  const nums = (Array.isArray(questions) ? questions : [])
    .map((q) => parseSourceNumber(q && q.sourceNumber))
    .filter((n) => n != null)
  if (nums.length < 3) return []
  if (nums.length < (Array.isArray(questions) ? questions.length : 0) * 0.6) {
    return []
  }
  const set = new Set(nums)
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  if (hi - lo > 500) return []
  const missing = []
  for (let n = lo; n <= hi; n++) {
    if (!set.has(n)) missing.push(n)
  }
  return missing
}

function resolveType(question) {
  const q = question || {}
  const t = canonicalType(q.type)
  if (t) return t
  return Array.isArray(q.options) && q.options.length >= 2 ? 'mcq' : 'short_answer'
}

export function analyzeNumbering(questions) {
  const list = Array.isArray(questions) ? questions : []
  const numbered = list
    .map((q, i) => ({ num: parseSourceNumber(q && q.sourceNumber), i }))
    .filter((s) => s.num != null)

  const reliable = numbered.length >= 3 && numbered.length >= list.length * 0.6

  if (!reliable) {
    return {
      reliable: false,
      count: numbered.length,
      missing: [],
      duplicates: [],
      outOfOrder: [],
      restarts: [],
    }
  }

  const missing = findSourceNumberGaps(list)
  const duplicates = []
  const outOfOrder = []
  const restarts = []

  let runStart = null
  let prev = null
  const seenInRun = new Set()

  for (const { num, i } of numbered) {
    if (prev == null) {
      runStart = num
      seenInRun.clear()
      seenInRun.add(num)
      prev = num
      continue
    }
    if (num < prev && num <= runStart) {
      restarts.push({ at: i, value: num })
      runStart = num
      seenInRun.clear()
      seenInRun.add(num)
      prev = num
      continue
    }
    if (seenInRun.has(num)) {
      duplicates.push(num)
    } else if (num < prev) {
      outOfOrder.push(num)
    }
    seenInRun.add(num)
    prev = num
  }

  return {
    reliable: true,
    count: numbered.length,
    missing,
    duplicates: uniqueSortedInts(duplicates),
    outOfOrder: uniqueSortedInts(outOfOrder),
    restarts,
  }
}

function optionLetter(opt) {
  const m = str(opt).trim().match(/^\(?([A-Ha-h])\s*[).:-]/)
  return m ? m[1].toUpperCase() : null
}

export function analyzeMcqCompleteness(question, label = 'Question') {
  const q = question || {}
  if (resolveType(q) !== 'mcq') return null

  const options = (Array.isArray(q.options) ? q.options : [])
    .map((o) => str(o).trim())
    .filter(Boolean)

  if (options.length < 2) {
    return { severity: 'error', missingLetters: [], message: `${label} — has fewer than 2 options` }
  }

  const letters = options.map(optionLetter)
  const labeled = letters.filter(Boolean)
  if (labeled.length >= 2 && labeled.length === options.length) {
    const present = new Set(labeled)
    const maxIdx = Math.max(...labeled.map((l) => OPTION_LETTERS.indexOf(l)))
    const missingLetters = []
    for (let k = 0; k <= maxIdx; k++) {
      if (!present.has(OPTION_LETTERS[k])) missingLetters.push(OPTION_LETTERS[k])
    }
    if (missingLetters.length) {
      return {
        severity: 'error',
        missingLetters,
        message: `${label} — Missing Option ${missingLetters.join(', ')}`,
      }
    }
    return null
  }

  if (options.length < 4) {
    const missingLetters = OPTION_LETTERS.slice(options.length, 4)
    return {
      severity: 'warning',
      missingLetters,
      message: `${label} — only ${options.length} options (expected 4: missing ${missingLetters.join(', ')})`,
    }
  }
  return null
}

export function detectUnclear(question) {
  const q = question || {}
  const hits = []
  const scan = (field, value) => {
    const s = str(value)
    if (!s) return
    let idx = s.indexOf(UNCLEAR_TOKEN)
    while (idx !== -1) {
      hits.push({ field, index: idx })
      idx = s.indexOf(UNCLEAR_TOKEN, idx + UNCLEAR_TOKEN.length)
    }
  }
  scan('prompt', q.prompt)
  scan('explanation', q.explanation)
  ;(Array.isArray(q.options) ? q.options : []).forEach((o, i) => scan(`option[${i}]`, o))
  if (q.passage) {
    scan('passage.text', q.passage.text)
    scan('passage.title', q.passage.title)
  }
  return hits
}

export function analyzeAgainstManifest(questions, expectedNumbers) {
  const expected = Array.isArray(expectedNumbers)
    ? expectedNumbers.filter((n) => Number.isInteger(n))
    : []
  if (!expected.length) return null

  const expectedSet = new Set(expected)
  const actualNums = []
  ;(Array.isArray(questions) ? questions : []).forEach((q) => {
    const n = parseSourceNumber(q && q.sourceNumber)
    if (n != null) actualNums.push(n)
  })
  const actualSet = new Set(actualNums)

  const missing = expected.filter((n) => !actualSet.has(n))
  const extras = uniqueSortedInts(actualNums.filter((n) => !expectedSet.has(n)))

  const counts = new Map()
  actualNums.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1))
  const duplicates = uniqueSortedInts(
    [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n),
  )

  return {
    expectedCount: expected.length,
    actualCount: actualNums.length,
    missing,
    extras,
    duplicates,
    exact:
      missing.length === 0 && extras.length === 0 && duplicates.length === 0 &&
      actualNums.length === expected.length,
  }
}

export function detectAnswerKeyBlock(block) {
  const text = typeof block === 'string' ? block : str(block && block.prompt)
  const t = text.trim()
  if (!t) return false
  const firstLine = (t.split(/\r?\n/)[0] || t).slice(0, 80)
  if (ANSWER_KEY_HEADING_RE.test(firstLine)) return true
  ANSWER_KEY_PAIR_RE.lastIndex = 0
  const pairs = t.match(ANSWER_KEY_PAIR_RE) || []
  const words = t.split(/\s+/).filter(Boolean).length
  return pairs.length >= 5 && pairs.length >= words * 0.3
}

export function mergeContinuations(questions) {
  const list = Array.isArray(questions) ? questions : []
  const out = []
  let merged = 0
  for (const q of list) {
    const prev = out[out.length - 1]
    const num = parseSourceNumber(q && q.sourceNumber)
    const hasOptions = Array.isArray(q && q.options) && q.options.length > 0
    const promptText = str(q && q.prompt).trim()
    const prevPrompt = str(prev && prev.prompt).trim()
    const prevEndsOpen = prevPrompt && !/[.?!:;)"']\s*$/.test(prevPrompt)
    const looksLikeTail =
      prev &&
      num == null &&
      !hasOptions &&
      promptText &&
      prevEndsOpen &&
      /^[a-z(]|^(and|or|but|the|a|an|to|of|in|on|for|with|that|which)\b/.test(promptText)
    if (looksLikeTail) {
      prev.prompt = `${prevPrompt} ${promptText}`.trim()
      merged += 1
      continue
    }
    out.push(q)
  }
  return { questions: out, merged }
}

export function computeValidationStatus(question) {
  const q = question || {}
  if (!str(q.prompt).trim()) return 'error'
  const mcq = analyzeMcqCompleteness(q)
  if (mcq && mcq.severity === 'error') return 'error'
  const unclear = detectUnclear(q)
  const noAnswer = !q.answerKnown && resolveType(q) !== 'essay'
  if ((mcq && mcq.severity === 'warning') || unclear.length || noAnswer) {
    return 'warning'
  }
  return 'ok'
}

export function gateImport(input) {
  const questions = Array.isArray(input)
    ? input
    : input && Array.isArray(input.questions)
      ? input.questions
      : []
  const expectedNumbers = input && !Array.isArray(input) ? input.expectedNumbers : undefined

  const blockers = []
  const warnings = []
  const numbering = analyzeNumbering(questions)
  const manifest = analyzeAgainstManifest(questions, expectedNumbers)

  if (!questions.length) {
    blockers.push('No questions could be extracted from this paper.')
    return { ok: false, blockers, warnings, numbering, manifest }
  }

  // Missing numbers: prefer the manifest's exact declared set (catches a
  // truncated tail past the observed max) — else fall back to the gap check.
  if (manifest) {
    if (manifest.missing.length) {
      const shown = manifest.missing.slice(0, 20).join(', ')
      blockers.push(`Missing questions: ${shown}${manifest.missing.length > 20 ? ', …' : ''}`)
    }
    if (manifest.extras.length) {
      const shown = manifest.extras.slice(0, 20).join(', ')
      blockers.push(
        `Unexpected extra question number(s) not declared on the paper: ${shown}` +
          `${manifest.extras.length > 20 ? ', …' : ''} (the paper declares ${manifest.expectedCount} question(s)).`,
      )
    }
    if (manifest.duplicates.length) {
      blockers.push(
        `Duplicate question number(s) must be resolved before import: ${manifest.duplicates.join(', ')}`,
      )
    }
  } else if (numbering.missing.length) {
    const shown = numbering.missing.slice(0, 20).join(', ')
    blockers.push(`Missing questions: ${shown}${numbering.missing.length > 20 ? ', …' : ''}`)
  }

  const keyBlocks = questions.filter(detectAnswerKeyBlock).length
  if (keyBlocks) {
    blockers.push(
      `An answer key / marking scheme was detected among the questions ` +
        `(${keyBlocks} block${keyBlocks === 1 ? '' : 's'}). Remove it before ` +
        `importing — a key must not become a quiz question.`,
    )
  }

  if (numbering.duplicates.length) {
    warnings.push(`Duplicate question number(s): ${numbering.duplicates.join(', ')}`)
  }
  if (numbering.outOfOrder.length) {
    warnings.push(`Out-of-order question number(s): ${numbering.outOfOrder.join(', ')}`)
  }
  if (numbering.restarts.length) {
    warnings.push(
      `Numbering restarts ${numbering.restarts.length} time(s) — expected for ` +
        `multi-section papers, but confirm the sections are correct.`,
    )
  }

  let unclearTotal = 0
  questions.forEach((q, i) => {
    unclearTotal += detectUnclear(q).length
    const mcq = analyzeMcqCompleteness(
      q,
      `Question ${parseSourceNumber(q && q.sourceNumber) || i + 1}`,
    )
    if (mcq) warnings.push(mcq.message)
  })
  if (unclearTotal) {
    warnings.push(`${unclearTotal} unreadable [UNCLEAR] span(s) — review before publishing.`)
  }

  const noAnswer = questions.filter(
    (q) => !q.answerKnown && resolveType(q) !== 'essay',
  ).length
  if (noAnswer) {
    warnings.push(
      `${noAnswer} question(s) have no answer set — the paper printed no key, ` +
        `so set the correct answer before publishing.`,
    )
  }

  const emptyPrompt = questions.filter((q) => !str(q && q.prompt).trim()).length
  if (emptyPrompt) {
    warnings.push(
      `${emptyPrompt} question(s) still have no question text after Part-` +
        `instruction reconciliation — add a stem manually before publishing.`,
    )
  }

  return { ok: blockers.length === 0, blockers, warnings, numbering, manifest }
}
