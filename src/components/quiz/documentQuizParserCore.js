import { createPartGroup, createPassageSection, createStandaloneSection } from '../../utils/quizSections.js'

const SUBJECTS = [
  'English',
  'Integrated Science',
  'Science',
  'Mathematics',
  'Social Studies',
  'Expressive Art',
  'Expressive Arts',
  'Technology Studies',
  'Cinyanja',
  'Home Economics',
]

const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[).:-]\s*(.+)$/i
const QUESTION_NO_PUNCT_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s+(.+\?)$/i
const OPTION_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])\s*[).:-])\s*(.+)$/
const OPTION_LABEL_RE = /(^|\s)(?:\(([A-Da-d])\)|([A-Da-d])\s*[).:-])\s*/g
const ANSWER_RE = /^(?:answer|correct answer|ans|key)\s*[:-]\s*(.+)$/i
const EXPLANATION_RE = /^(?:explanation|reason|because)\s*[:-]\s*(.+)$/i
const IMAGE_HINT_RE = /\b(diagram|figure|picture|image|graph|chart|map|shown|label|observe|study the|look at)\b/i
const ANSWER_KEY_HEADING_RE = /^(answers\b|answer\s+key|memorandum|marking scheme)\b/i
const ANSWER_KEY_PAIR_RE = /(?:^|\s)(\d{1,3})\s*[).:-]?\s*(?:answer\s*)?([A-D]|true|false)\b/gi
const SECTION_HEADING_RE = /^(?:spelling bee\b|elimination round\b|category\b|words\b|easy round\b|average level\b|round\s+\d+\b|tie[-\s]?breakers?\b|extra words?\b|oral recitation\b)/i
const PARA_ORDER_INSTRUCTION_RE = /each question has four paragraphs|sentences in the best order|choose the paragraph which has the sentences/i
const PARA_ORDER_DO_Q_RE = /\bnow\s+do\s+questions?\s+(\d{1,3})/i
const PARA_ORDER_QUESTION_ONLY_RE = /^\d{1,3}$/
const QUESTION_RANGE_HEADING_RE = /^(?:(?:comprehension\s+)?questions?\s+\d{1,3}\s*[–-]\s*\d{1,3}|now\s+do\s+questions?\s+\d{1,3}\s*[–-]\s*\d{1,3}|look\s+at\s+questions?\s+\d{1,3}(?:\s*[–-]\s*\d{1,3})?)$/i
// Verbs that, when they lead a non-numbered line, almost always mean the line
// is a teacher instruction rather than a question stem or an answer/explanation.
// Kept conservative — common question stems like "Find the value of x" stay
// safe because numbered questions are matched first.
const INSTRUCTION_VERBS = [
  'choose', 'select', 'pick', 'write', 'complete', 'fill', 'fill in',
  'look at', 'study', 'observe', 'examine', 'consider', 'inspect',
  'use', 'refer to', 'read', 'reread',
  'identify', 'find', 'state', 'name', 'list', 'mention',
  'underline', 'circle', 'tick', 'mark', 'highlight', 'cross out',
  'rewrite', 'rephrase', 'rearrange', 'reorder', 'arrange', 'order',
  'match', 'pair', 'connect', 'link',
  'supply', 'provide', 'give', 'put', 'place',
  'change', 'convert', 'translate', 'transform',
  'spell', 'pronounce',
  'draw', 'illustrate', 'label', 'shade', 'colour', 'color',
  'calculate', 'compute', 'work out', 'determine', 'solve', 'evaluate',
  'simplify', 'factorise', 'factorize', 'expand', 'estimate', 'round off',
  'explain', 'describe', 'discuss', 'compare', 'contrast', 'distinguish', 'differentiate',
  'classify', 'group', 'sort', 'categorise', 'categorize',
  'answer', 'attempt', 'do', 'try',
  'decide', 'judge', 'predict', 'suggest', 'recommend',
  'add', 'subtract', 'multiply', 'divide',
]
const INSTRUCTION_VERB_ALT = INSTRUCTION_VERBS
  .map(verb => verb.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+'))
  .join('|')
const STANDALONE_INSTRUCTION_RE = new RegExp(
  '^(?:' +
    // Explicit instruction marker / note
    'instructions?\\s*[:.-]|' +
    'note\\s*[:\\-]|' +
    // "For/In each", "For/In all", "For/In every", "For/In the following"
    '(?:for|in)\\s+(?:each|all|every|the\\s+following|the\\s+next)\\b|' +
    'each\\s+(?:question|sentence|of\\s+the|word|item)\\b|' +
    'every\\s+(?:question|sentence|word)\\b|' +
    // "For questions 26-30" / "Look at questions 39-45" / "Now do questions"
    '(?:for|in|from|with)\\s+questions?\\s+\\d|' +
    'look\\s+at\\s+questions?\\b|' +
    'now\\s+do\\s+questions?\\b|' +
    'questions?\\s+\\d{1,3}\\s*(?:to|–|-)\\s*\\d{1,3}\\b|' +
    // Common scaffolds
    'below\\s+(?:are|is)\\b|' +
    'the\\s+following\\b|' +
    'from\\s+the\\s+(?:options|words|sentences|choices|list|passage|paragraph|table|diagram|figure|picture|graph|chart|map|extract|story|text)\\b|' +
    // Imperative verb at start of line
    '(?:' + INSTRUCTION_VERB_ALT + ')\\s+\\b' +
  ')',
  'i',
)
// Hint that a line is an instruction, even when it does not match the strict
// detector above — used to stop the parser from dumping such lines into the
// previous question's explanation. Kept broader, but still ignores anything
// that looks like a question (ends in ?), an option (starts with A. / (A) /
// etc.), or an answer/explanation prefix.
const INSTRUCTION_HINT_RE = new RegExp(
  '(?:' +
    'instructions?\\s*[:.-]|' +
    'note\\s*[:\\-]|' +
    '\\b(?:for|in|from)\\s+questions?\\s+\\d|' +
    '\\bquestions?\\s+\\d{1,3}\\s*(?:to|–|-)\\s*\\d{1,3}\\b|' +
    '\\bnow\\s+do\\s+questions?\\b|' +
    '\\blook\\s+at\\s+(?:the\\s+)?(?:diagram|figure|picture|image|graph|chart|map|table|passage|story|text|extract|questions?)\\b|' +
    '\\b(?:for|in)\\s+(?:each|all|every|the\\s+following|the\\s+next)\\b|' +
    '^(?:' + INSTRUCTION_VERB_ALT + ')\\s+' +
  ')',
  'i',
)
const COMP_INSTRUCTION_RE = /\b(?:read\s+(?:the\s+)?(?:following|passage|story|text|extract|information|paragraph|article|poem|stories)|read\s+each\s+stor(?:y|ies)|answer\s+the\s+(?:following\s+)?questions?\s+(?:(?:that|which)\s+follow|from\s+(?:the\s+)?(?:passage|story|text|extract)|based\s+on\s+(?:the\s+)?(?:passage|story|text)|using\s+(?:the\s+)?(?:passage|story|text))|use\s+(?:the\s+)?(?:passage|text|story|information|extract)(?:\s+(?:above|below|to\s+answer))?|choose\s+(?:the\s+)?(?:correct|best|right)\s+(?:answer|option|word)\s+from\s+(?:the\s+)?(?:passage|text|story|extract)|based\s+on\s+(?:the\s+)?(?:passage|story|text|extract)|refer\s+to\s+(?:the\s+)?(?:passage|story|text|extract)|questions?\s+(?:that|which)\s+follow|stories?\s+with\s+questions?\s+on\s+each|look\s+at\s+the\s+questions?\s+(?:that|which)\s+follow|from\s+(?:the\s+)?(?:passage|story|text|extract)\s+(?:above|below)?)\b/i
const PASSAGE_LABEL_RE = /^(?:story|passage|text|extract|article|reading(?:\s+comprehension)?|comprehension)\s*(?:\d+|[IVX]+|[A-Z])?\s*(?:[:.,-]\s*.*)?$/i

export function cleanImportedText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z0-9])([.?!:;])([A-Z])/g, '$1$2 $3')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLines(text) {
  return cleanImportedText(text)
    .split(/\r?\n/)
    .map(line => cleanImportedText(line))
    .filter(Boolean)
}

function titleFromFileName(name = '') {
  return String(name || 'Imported Quiz')
    .replace(/\.(docx?|pdf)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Imported Quiz'
}

function normalizeParaOrderInstruction(text) {
  return cleanImportedText(text)
    .replace(/^instruction\s*:\s*/i, '')
    .trim()
}

function deriveParaOrderQuestionText(instruction) {
  const normalized = normalizeParaOrderInstruction(instruction)
  const sentences = normalized
    .split(/(?<=[.?!])\s+/)
    .map(sentence => cleanImportedText(sentence))
    .filter(Boolean)

  const bestSentence = sentences.find(sentence => /\bchoose\b/i.test(sentence))
    || sentences[sentences.length - 1]
    || normalized

  return cleanImportedText(
    bestSentence
      .replace(/^you must\s+/i, '')
      .replace(/^for each question,?\s*/i, ''),
  ) || 'Choose the paragraph with the sentences in the best order.'
}

function parseParaOrderOptionLine(line) {
  const text = cleanImportedText(line)
  const punctuated = text.match(/^([A-D])[).:-]\s*(.+)$/)
  const glued = text.match(/^([A-D])([A-Z].+)$/)
  const label = (punctuated?.[1] || glued?.[1] || '').toUpperCase()
  if (!label) return null

  const optionText = cleanImportedText(punctuated?.[2] || glued?.[2] || '')
  if (!optionText) return null

  return { label, text: optionText }
}

function parseRawParaOrderOptionLine(line) {
  const text = cleanImportedText(String(line || '').replace(/\n+/g, ' '))
  const match = text.match(/^([A-D])(?:[).:-]\s*|)(.+)$/)
  const label = (match?.[1] || '').toUpperCase()
  const optionText = cleanImportedText(match?.[2] || '')
  if (!label || !optionText) return null
  return { label, text: optionText }
}

function isSectionHeading(text) {
  const line = cleanImportedText(text)
  if (!line) return false
  if (SECTION_HEADING_RE.test(line)) return true
  if (/^(?:section|part|unit)\s+[A-Z0-9]/i.test(line)) return true
  return false
}

function isComprehensionInstruction(line) {
  return COMP_INSTRUCTION_RE.test(line)
}

function isPassageLabel(line) {
  return PASSAGE_LABEL_RE.test(line)
}

function isQuestionRangeHeading(line) {
  return QUESTION_RANGE_HEADING_RE.test(cleanImportedText(line))
}

function questionMatch(line) {
  const numbered = line.match(QUESTION_RE) || line.match(QUESTION_NO_PUNCT_RE)
  if (!numbered) return null
  const text = cleanImportedText(numbered[2])
  if (!text || ANSWER_KEY_HEADING_RE.test(text)) return null
  return { number: numbered[1], text }
}

function extractOptionSegments(line) {
  const text = String(line || '')
  const matches = []
  OPTION_LABEL_RE.lastIndex = 0

  let match
  while ((match = OPTION_LABEL_RE.exec(text)) !== null) {
    const prefix = match[1] || ''
    const raw = match[2] || match[3] || ''
    const label = raw.toUpperCase()
    const labelStart = match.index + prefix.length
    matches.push({
      label,
      index: label.charCodeAt(0) - 65,
      labelStart,
      valueStart: OPTION_LABEL_RE.lastIndex,
    })
  }

  if (!matches.length) return []

  const firstPrefix = cleanImportedText(text.slice(0, matches[0].labelStart)).toLowerCase()
  const startsAsOptionLine = matches[0].labelStart <= 2 || /^(options?|choices?)[:-]?$/.test(firstPrefix)
  const hasQuestionThenInlineOptions = firstPrefix.length >= 8 && matches.length >= 2
  if (!startsAsOptionLine && !hasQuestionThenInlineOptions) return []

  return matches
    .map((item, index) => {
      const next = matches[index + 1]
      return {
        ...item,
        text: cleanImportedText(text.slice(item.valueStart, next ? next.labelStart : text.length)),
      }
    })
    .filter(item => item.index >= 0 && item.index <= 3 && item.text)
}

// PRISCA / ECZ Word docs often render options as `A\tText` — after the
// universal tab→space normalisation in cleanImportedText() this becomes
// `A Text`, which OPTION_LABEL_RE rejects (it requires a punctuation marker
// like `A.`/`A)`/`A:`). Fall back to a bare-letter detector that ONLY runs
// when (a) the line starts with a single capital A-D and a space, (b) the
// caller is already accumulating a question, and (c) the rest of the line
// is short (< 240 chars — long lines are almost certainly question stems).
function extractBareLetterOption(line) {
  const text = String(line || '').trim()
  if (text.length === 0 || text.length > 240) return null
  const match = text.match(/^([A-D])\s+(\S.*)$/)
  if (!match) return null
  const label = match[1].toUpperCase()
  return {
    label,
    index: label.charCodeAt(0) - 65,
    text: cleanImportedText(match[2]),
  }
}

function splitInlineOptionsFromQuestion(rawText, fallbackQuestionText = '') {
  const text = cleanImportedText(rawText)
  const options = extractOptionSegments(text)
  if (!options.length) return { text, options: [] }

  if (options[0].labelStart <= 2) {
    const fallback = cleanImportedText(fallbackQuestionText)
    if (!fallback) return { text, options: [] }
    return { text: fallback, options }
  }

  const questionText = cleanImportedText(text.slice(0, options[0].labelStart))
  if (questionText.length < 8 || options.length < 2) return { text, options: [] }

  return { text: questionText, options }
}

function isStandaloneInstruction(line) {
  const text = cleanImportedText(line)
  if (!text) return false
  if (questionMatch(text)) return false
  if (extractOptionSegments(text).length) return false
  if (ANSWER_KEY_HEADING_RE.test(text)) return false
  if (isComprehensionInstruction(text)) return false
  return STANDALONE_INSTRUCTION_RE.test(text)
}

// Looser detector — true for any line that smells like a teacher instruction
// even when the strict patterns above miss it. The parser uses this to refuse
// to dump instruction text into the previous question's explanation field.
function looksLikeInstructionLine(line) {
  const text = cleanImportedText(line)
  if (!text) return false
  if (questionMatch(text)) return false
  if (extractOptionSegments(text).length) return false
  if (ANSWER_RE.test(text) || EXPLANATION_RE.test(text)) return false
  if (ANSWER_KEY_HEADING_RE.test(text)) return false
  if (/\?\s*$/.test(text)) return false
  if (isComprehensionInstruction(text)) return true
  if (STANDALONE_INSTRUCTION_RE.test(text)) return true
  if (INSTRUCTION_HINT_RE.test(text)) return true
  // Trailing colon at the end of a short imperative-looking line is almost
  // always a "do this:" prompt, e.g. "Match the following with the answers:".
  if (/[:.][\s)]*$/.test(text) && /^[A-Z][a-zA-Z\s,;'"-]{4,80}[:.][\s)]*$/.test(text)) return true
  return false
}

function stripInstructionPrefix(text) {
  return cleanImportedText(text).replace(/^instructions?\s*[:.-]\s*/i, '').replace(/^note\s*[:-]\s*/i, '')
}

function optionOnlyQuestionMatch(line) {
  const text = cleanImportedText(line)
  const match = text.match(/^(\d{1,3})\s*[).:-]\s*(.+)$/)
  if (!match) return null

  const optionText = cleanImportedText(match[2])
  const options = extractOptionSegments(optionText)
  if (!options.length || options[0].labelStart > 2) return null

  return {
    number: match[1],
    options: options.map(option => option.text),
  }
}

function isLikelyDocxQuestionHeading(text, block) {
  if (!block?.numberedList) return false

  const line = cleanImportedText(text)
  if (!line || isSectionHeading(line)) return false
  if (questionMatch(line)) return false
  if (ANSWER_RE.test(line) || EXPLANATION_RE.test(line)) return false
  if (/^(?:meaning|example|definition|sentence|clue|hint)\s*:/i.test(line)) return false
  if (!/[a-z]/i.test(line) || line.length > 120) return false

  const words = line.split(/\s+/)
  return /\b(noun|verb|adjective|adverb|pronoun|conjunction|preposition|interjection)\b/i.test(line)
    || words.length <= 6
}

export function metadataFromText(text, fileName) {
  const firstLines = splitLines(text).slice(0, 8)

  // Prefer header lines that look like a paper title ("…Examination 2023",
  // "Mathematics Mock Test"). The first line is often an institution name
  // ("EXAMINATIONS COUNCIL OF ZAMBIA") which makes a poor quiz title, so
  // we fall through to the filename when nothing paper-y is present.
  const PAPER_KEYWORDS_RE = /\b(examination|exam|test|paper|quiz|assessment|mock|trial|composite)\b/i
  const titleFromHeader =
    firstLines.find(line => line.length > 6 && !questionMatch(line) && !OPTION_RE.test(line) && PAPER_KEYWORDS_RE.test(line))
    || firstLines.find(line => line.length > 6 && !questionMatch(line) && !OPTION_RE.test(line))
  const title = titleFromHeader || titleFromFileName(fileName)

  // Grade detection must be scoped to the header. "A Grade 8 learner got
  // 14 marks…" inside Q60 was poisoning the paper-level grade. We also
  // accept word-spelled grades (e.g. "GRADE SEVEN") and fall back to a
  // "G7_..." style filename token.
  //
  // Word-spelled grades are checked FIRST because formal paper headers
  // tend to use them ("GRADE SEVEN COMPOSITE EXAMINATION"), whereas
  // digit-form "Grade N" often appears inside an example question
  // ("A Grade 8 learner got 14 marks…"). Preferring the word form is
  // more robust when both appear inside the header window.
  const headerOnly = firstLines.join(' ')
  const WORD_GRADES = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' }
  const headerWord = headerOnly.match(/\bgrade\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i)
  const headerDigit = !headerWord ? headerOnly.match(/\bgrade\s*(\d{1,2})\b/i) : null
  const filenameGrade = !headerWord && !headerDigit
    ? String(fileName || '').match(/(?:^|[^a-z])g(?:rade)?[\s_-]*(\d{1,2})\b/i)
    : null
  const grade = headerWord
    ? WORD_GRADES[headerWord[1].toLowerCase()]
    : headerDigit
      ? headerDigit[1]
      : filenameGrade
        ? filenameGrade[1]
        : ''

  const headerText = [title, ...firstLines].join(' ')
  const subject = SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(headerText))
    || SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
    || ''

  // Topic is intentionally omitted from imported metadata — imported papers
  // span many CBC topics and the teacher should pick (or leave blank) rather
  // than have the title silently stamped as the topic.
  return {
    title: cleanImportedText(title).slice(0, 90) || titleFromFileName(fileName),
    grade,
    subject,
  }
}

function extractAnswerKey(blocks) {
  const answers = new Map()
  let inAnswerKey = false
  // For 2-column answer-key tables (PRISCA / ECZ style) the question number
  // and the letter live in SEPARATE paragraphs/cells, so the inline
  // ANSWER_KEY_PAIR_RE never matches. We stitch them together by remembering
  // the most recent stand-alone number line and pairing it with the next
  // stand-alone letter line (and vice versa).
  let pendingNumber = null
  let pendingLetter = null

  blocks.forEach(block => {
    splitLines(block.text).forEach(line => {
      const startsAnswerKey = ANSWER_KEY_HEADING_RE.test(line)
      if (startsAnswerKey) {
        inAnswerKey = true
        pendingNumber = null
        pendingLetter = null
      }
      if (!inAnswerKey) return

      ANSWER_KEY_PAIR_RE.lastIndex = 0
      let match
      let foundInline = false
      while ((match = ANSWER_KEY_PAIR_RE.exec(line)) !== null) {
        answers.set(match[1], match[2])
        foundInline = true
      }
      if (foundInline) {
        pendingNumber = null
        pendingLetter = null
        return
      }

      // Skip likely header cells (Q#, Answer, No., #, Number).
      if (/^(?:q\s*#|q\s*no\.?|no\.?|number|answer|key|#)$/i.test(line)) return

      const trimmed = line.trim()
      const numberOnly = trimmed.match(/^(\d{1,3})\.?$/)
      const letterOnly = trimmed.match(/^([A-D])$/i)

      if (numberOnly) {
        if (pendingLetter) {
          answers.set(numberOnly[1], pendingLetter.toUpperCase())
          pendingLetter = null
        } else {
          pendingNumber = numberOnly[1]
        }
        return
      }
      if (letterOnly) {
        if (pendingNumber) {
          answers.set(pendingNumber, letterOnly[1].toUpperCase())
          pendingNumber = null
        } else {
          pendingLetter = letterOnly[1]
        }
        return
      }

      // Any other content inside the answer-key block resets the pending
      // pairing — prevents accidentally pairing across unrelated rows.
      pendingNumber = null
      pendingLetter = null
    })
  })

  return answers
}

// `options` is the persisted (blank-filtered) option list. `sourceOptions`
// is the original document order before blanks were dropped — answer-key
// letters (A/B/C/D) refer to that order, so a letter is resolved against
// sourceOptions and then mapped to its position in the filtered list.
// Without this, a blank option earlier in the list shifts every later
// letter onto the wrong option and silently mis-grades the import.
function parseAnswerIndex(rawAnswer, options, sourceOptions = options) {
  const answer = cleanImportedText(rawAnswer)
  if (!answer) return null
  const letter = answer.match(/^[A-D]/i)?.[0]?.toUpperCase()
  if (letter) {
    const origIndex = letter.charCodeAt(0) - 65
    const optText = origIndex >= 0 && origIndex < sourceOptions.length
      ? cleanImportedText(sourceOptions[origIndex])
      : ''
    if (optText) {
      const mapped = options.findIndex(option => cleanImportedText(option) === optText)
      if (mapped >= 0) return mapped
    }
    return null
  }
  const normalized = answer.toLowerCase()
  const exactIndex = options.findIndex(option => cleanImportedText(option).toLowerCase() === normalized)
  if (exactIndex >= 0) return exactIndex
  const containedIndex = options.findIndex(option =>
    cleanImportedText(option).toLowerCase().includes(normalized) ||
    normalized.includes(cleanImportedText(option).toLowerCase()),
  )
  return containedIndex >= 0 ? containedIndex : null
}

// Phase 3: assets that the parser attributed to a specific option (e.g. via
// block.optionAssetsByLetter from a DOCX table) live on current.optionAssets[i].
// They surface on the question's optionMedia[] array and must NOT also be
// picked up as the question's stem image — so we filter their IDs out of
// current.assets before computing firstAsset.
const OPTION_LETTERS_FOR_MEDIA = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function questionFromCurrent(current, answerKey = new Map()) {
  if (!current) return null

  const reviewNotes = [...current.reviewNotes]
  const text = cleanImportedText(current.textParts.join(' '))
  const sharedInstruction = cleanImportedText(current.sharedInstruction)
  const optionAssetsArr = Array.isArray(current.optionAssets) ? current.optionAssets : []
  // Phase 3: the table-block builder synthesises "(image)" as the option text
  // when a DOCX cell carries an option letter and an image but no caption.
  // Once the matching asset is attached to current.optionAssets, blank out
  // the placeholder so the learner sees an image-only option in the runner.
  const cleanedOptions = current.options.map((option, index) => {
    const cleaned = cleanImportedText(option)
    if (cleaned === '(image)' && optionAssetsArr[index]) return ''
    return cleaned
  })
  // Keep empty option strings that have an attributed image — they hold the
  // index alignment so optionMedia[i] stays parallel to options[i]. Truly
  // empty options (no text + no media) still drop out.
  const options = cleanedOptions.filter((opt, index) => Boolean(opt) || optionAssetsArr[index])
  const imageHint = IMAGE_HINT_RE.test(`${text} ${current.diagramText}`)

  // Build optionMedia from current.optionAssets and remember which assets
  // it claims so they don't double as the question's stem image.
  const optionAssets = Array.isArray(current.optionAssets) ? current.optionAssets : []
  const claimedAssetIds = new Set(
    optionAssets.filter(Boolean).map(asset => asset.id).filter(Boolean),
  )

  const stemAssets = (current.assets || []).filter(asset => !claimedAssetIds.has(asset?.id))
  const assets = stemAssets.length ? stemAssets : imageHint && current.pageAsset ? [current.pageAsset] : []
  const firstAsset = assets[0] || null
  const lowerOptions = options.map(option => option.toLowerCase())
  const isTrueFalse = options.length === 2 && lowerOptions.includes('true') && lowerOptions.includes('false')

  let type = 'short_answer'
  const answerRaw = cleanImportedText(current.answerRaw || (current.sourceNumber ? answerKey.get(String(current.sourceNumber)) : ''))
  let correctAnswer = answerRaw

  // Prefer MCQ when 4 valid options were extracted, even if the stem mentions
  // an image ("shown below", "study the picture") — the image just gets
  // attached to the question alongside its multiple-choice options.
  if (isTrueFalse) {
    type = 'truefalse'
  } else if (options.length >= 2) {
    type = 'mcq'
  } else if (imageHint || firstAsset) {
    type = 'diagram'
  }

  if (type === 'mcq' || type === 'truefalse') {
    // True/False persists a fixed ['True','False'] list, so the answer must
    // be resolved against that exact array — not the raw source order,
    // which may be reversed ("False / True") and would invert the answer.
    const index = isTrueFalse
      ? parseAnswerIndex(answerRaw, ['True', 'False'])
      : parseAnswerIndex(answerRaw, options, cleanedOptions)
    correctAnswer = index ?? 0
    if (index === null) reviewNotes.push('Correct option was not clear.')
  } else if (!correctAnswer) {
    reviewNotes.push(type === 'diagram'
      ? 'Expected answer for this diagram question was not clear.'
      : 'Expected short answer was not clear.')
  }

  if (!text) reviewNotes.push('Question text was not clear.')
  if (type === 'mcq' && options.length < 4) reviewNotes.push('Multiple-choice question has fewer than four options.')
  if (current.tableFlattened) reviewNotes.push('Question may have come from a flattened table.')

  const marksMatch = text.match(/\[?\(?(\d{1,2})\s*marks?\)?\]?/i)

  // Build the optionMedia payload only for MCQ-style questions, and only if
  // at least one option carries an image. The editor's pre-publish checklist
  // surfaces missing alt text — we seed it with a sensible default so the
  // teacher doesn't have to start from blank.
  const isMcqLike = type === 'mcq' || type === 'truefalse'
  let optionMedia
  if (isMcqLike) {
    const slots = optionAssets.map((asset, index) => {
      if (!asset) return null
      const letter = OPTION_LETTERS_FOR_MEDIA[index] || `Option ${index + 1}`
      return {
        imageAssetId: asset.id,
        // imageUrl is the transient blob: URL for the editor preview only;
        // the save pass swaps it for a Storage download URL.
        imageUrl: asset.imageUrl || '',
        alt: `Option ${letter} image (imported — please review)`,
      }
    })
    if (slots.some(Boolean)) optionMedia = slots
  }

  return {
    text,
    sharedInstruction,
    options: type === 'short_answer' || type === 'diagram'
      ? []
      : isTrueFalse
        ? ['True', 'False']
        : options,
    correctAnswer,
    explanation: cleanImportedText(current.explanationParts.join(' ')),
    topic: '',
    marks: marksMatch ? Math.max(1, Number(marksMatch[1]) || 1) : 1,
    type,
    detectedType: type,
    imageUrl: firstAsset?.imageUrl || '',
    imageAssetId: firstAsset?.id || '',
    diagramText: firstAsset
      ? cleanImportedText(current.diagramText || `Imported image from ${firstAsset.sourcePath || 'document'}.`)
      : cleanImportedText(current.diagramText),
    requiresReview: reviewNotes.length > 0 || Boolean(optionMedia),
    reviewNotes: optionMedia ? [...reviewNotes, 'Imported option images — add alt text before publishing.'] : reviewNotes,
    importWarnings: reviewNotes,
    sourcePage: current.pageNumber || null,
    sourceQuestionNumber: current.sourceNumber || null,
    partTitle: current.partTitle || '',
    imageUploading: false,
    imageUploadStep: '',
    ...(optionMedia ? { optionMedia } : {}),
  }
}

// Match a whole line that is just a bracketed image-description placeholder.
// Examples:
//   [Image Description: A black silhouette of an athlete mid-air ...]
//   [Image: a flower with stigma labelled X]
//   [refer to image in original]
//   [Diagram: trapezium with sides 18 cm (top), 7 cm (left), 26 cm (bottom)]
//   [Shapes diagram: I = square, II = rhombus, III = hexagon]
//
// The earlier regex `[^\])]*` rejected inner `)`, so any caption with nested
// parens like "(top)" / "(bottom)" failed to match and the placeholder leaked
// into the question stem. The keyword also had to be the first token after
// the opening bracket, which missed "Shapes diagram". The two clauses below
// accept the `[…]` and `(…)` forms independently and allow the keyword to
// appear anywhere inside the bracket.
// Image-description placeholders that paper authors leave for imported
// diagrams. The keyword list intentionally mirrors IMAGE_HINT_RE so any
// `[Bar graph: …]`, `[Pie chart: …]`, `[Map of Zambia: …]`, `[Table:
// rainfall totals]` style line is stripped from the question stem AND
// kept as a diagramCaption on the source block so the parser can hand
// it back as `question.diagramText`. This is what the editor shows
// learners as supplementary context next to the actual question.
const BRACKETED_IMAGE_LINE_RE = new RegExp(
  '^\\s*\\[[^\\]]*\\b(?:image(?:\\s+description)?|figure|diagram|picture|graph|chart|map|table|refer\\s+to\\s+image|see\\s+image)\\b[^\\]]*\\]\\s*$'
  + '|'
  + '^\\s*\\([^)]*\\b(?:image(?:\\s+description)?|figure|diagram|picture|graph|chart|map|table|refer\\s+to\\s+image|see\\s+image)\\b[^)]*\\)\\s*$',
  'i',
)

function stripBracketedImageDescriptions(blocks) {
  return blocks.map(block => {
    const text = String(block?.text || '')
    if (!text) return block
    const lines = text.split(/\r?\n/)
    const captions = []
    let mutated = false
    const filtered = lines.filter(line => {
      if (BRACKETED_IMAGE_LINE_RE.test(line)) {
        captions.push(line.trim())
        mutated = true
        return false
      }
      return true
    })
    if (!mutated) return block
    return {
      ...block,
      text: filtered.join('\n').trim(),
      // Sidecar so the parser can attach captions to the question they
      // belong to. Without this the description is lost when the line is
      // dropped from `text`, and the editor's diagram-description field
      // ends up empty for imported papers that use `[Diagram: …]` markers.
      diagramCaptions: [...(block.diagramCaptions || []), ...captions],
    }
  })
}

// Matches a paragraph whose entire content is a punctuated question-number
// marker — `1.`, `1)`, `Q1.`, `Question 1:`. Used by
// mergeOrphanQuestionNumbers to detect numbers that landed in their own
// paragraph (PRISCA / ECZ past papers often lay vertical-arithmetic
// questions out as `6.\n954 751\n− 362 948\n─────────`).
//
// Punctuation is REQUIRED — bare `'39'` paragraphs are used as the
// paragraph-ordering question marker pattern (see preprocessParaOrdering)
// and have their own handling. Matching them here would steal the marker
// and break the para-order fixture.
const ORPHAN_QUESTION_NUMBER_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):]\s*$/i

// Footer / disclaimer markers that ECZ / PRISCA papers leave at the bottom.
// Without this filter the stem-bleed guard treats `©G7/Mathematics/2023`
// (or `STOP! PLEASE CHECK …`) as the stem of a brand-new unnumbered
// question, ballooning the final question count by 1-2.
const DOC_FOOTER_RE = /^(?:©|\(c\)|copyright\b|all\s+rights\s+reserved\b|stop!?\s*(please|check)?\b|end\s+of\s+(exam|paper|test|questions)\b|please\s+check\s+all\s+your\s+work\b|do\s+not\s+turn\s+over\b|do\s+not\s+open\s+this\s+paper\b)/i

function looksLikeDocFooter(line) {
  const text = cleanImportedText(line)
  if (!text) return false
  if (DOC_FOOTER_RE.test(text)) return true
  // A trailing `©G7/Mathematics/2023` style header with a slash chain and
  // no spaces also shows up — match generously.
  if (/^©|^\(c\)/i.test(text)) return true
  return false
}

// Walks the block stream and merges blocks whose entire text is just a
// question-number marker (e.g. `6.`) with the next non-empty block.
//
// ECZ Grade-7 past papers in Word emit vertical-arithmetic questions as
//   `6.` / `954 751` / `− 362 948` / `─────────` / `A 691 813` …
// Before this preprocessor ran, `6.` was a stray line that failed to match
// QUESTION_RE (which requires `[).:-]\s*(.+)$`) and the parser dropped or
// misattributed Q6 entirely. By merging forward, the next paragraph picks
// up the question number prefix and the existing QUESTION_RE handles the
// merged line normally.
//
// Conservative: we DON'T merge if the next non-empty block already
// carries a question number (`5.` then `6. Find …` would collide) or an
// option label (`A.` / `(A)`), or sits inside the answer key heading.
function mergeOrphanQuestionNumbers(blocks) {
  const output = []
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const text = cleanImportedText(block?.text || '')
    const orphanMatch = text.match(ORPHAN_QUESTION_NUMBER_RE)
    if (!orphanMatch) { output.push(block); continue }

    // Find the next non-empty block.
    let j = i + 1
    while (j < blocks.length && !cleanImportedText(blocks[j]?.text || '')) j += 1
    if (j >= blocks.length) { output.push(block); continue }

    const next = blocks[j]
    const nextText = cleanImportedText(next.text || '')

    // Don't merge if the next block already starts with its own question
    // number, an option label, an answer marker, or a section heading.
    if (
      questionMatch(nextText)
      || ORPHAN_QUESTION_NUMBER_RE.test(nextText)
      || extractOptionSegments(nextText).length
      || /^([A-Da-d])\s+\S/.test(nextText) // bare-letter option line
      || ANSWER_RE.test(nextText)
      || EXPLANATION_RE.test(nextText)
      || ANSWER_KEY_HEADING_RE.test(nextText)
      || isSectionHeading(nextText)
      || isPassageLabel(nextText)
    ) {
      output.push(block)
      continue
    }

    // Merge: emit a fused block carrying both the question number and the
    // first paragraph of the stem. The parser's QUESTION_RE will match the
    // result and start a new question; later paragraphs (e.g. `− 362 948`,
    // `─────────`) attach as stem continuations via the existing
    // textParts.push path because no options have arrived yet.
    output.push({
      ...next,
      text: `${orphanMatch[1]}. ${nextText}`,
    })
    i = j // skip the consumed next block
  }
  return output
}

function preprocessParaOrdering(blocks) {
  // First strip bracketed image-description placeholders that the AI doc
  // generators insert between a question stem and its options. Lines like
  // `[Image Description: A high-jumping athlete...]` would otherwise be
  // appended to the question stem and (because they contain "image") flip
  // the question type to `diagram`, dropping the A-D options.
  blocks = stripBracketedImageDescriptions(blocks)
  const output = []
  let collecting = false
  let instruction = ''
  let buffered = []

  function flushBuffered() {
    if (!collecting) return
    if (instruction && buffered.length) {
      output.push(...buildParaOrderBlocks(buffered, instruction))
    }
    collecting = false
    instruction = ''
    buffered = []
  }

  blocks.forEach(block => {
    const text = cleanImportedText(block.text)
    if (!text) {
      if (collecting) buffered.push({ line: '', block })
      else output.push(block)
      return
    }

    const explicitInstruction = text.replace(/^instruction\s*:\s*/i, '')
    const startsParaOrdering = PARA_ORDER_INSTRUCTION_RE.test(explicitInstruction)
    const endsParaOrdering = collecting && (
      isComprehensionInstruction(text) ||
      isPassageLabel(text) ||
      /^reading comprehension\b/i.test(text) ||
      ANSWER_KEY_HEADING_RE.test(text) ||
      /^(?:part|section|unit)\s+[A-Z0-9]/i.test(text)
    )

    if (startsParaOrdering) {
      flushBuffered()
      collecting = true
      instruction = explicitInstruction
      return
    }

    if (endsParaOrdering) {
      flushBuffered()
      output.push(block)
      return
    }

    if (collecting) {
      buffered.push({ line: text, block })
      return
    }

    output.push(block)
  })

  flushBuffered()
  return output
}

function buildParaOrderBlocks(lineObjects, instruction) {
  const output = []
  const questionText = deriveParaOrderQuestionText(instruction)

  let qNum = null
  let currentOpt = ''
  let optTexts = { A: [], B: [], C: [], D: [] }
  let firstBlock = null
  const OPT_ORDER = ['A', 'B', 'C', 'D']

  function flushQuestion() {
    if (!qNum) return
    const lines = [`${qNum}. ${questionText}`]
    for (const letter of OPT_ORDER) {
      const sentences = optTexts[letter] || []
      if (sentences.length) lines.push(`${letter}. ${sentences.join(' ')}`)
    }
    output.push({
      text: lines.join('\n'),
      assets: firstBlock?.assets || [],
      source: firstBlock?.source || 'docx',
      numberedList: false,
      sharedInstruction: instruction,
    })
    qNum = null
    currentOpt = ''
    optTexts = { A: [], B: [], C: [], D: [] }
    firstBlock = null
  }

  function startQuestion(num, block) {
    flushQuestion()
    qNum = String(num)
    currentOpt = ''
    firstBlock = block
  }

  for (const { line, block } of lineObjects) {
    const text = cleanImportedText(line)
    if (!text) continue

    if (/^example$/i.test(text) || /^the answer is\b/i.test(text)) continue

    const doQMatch = text.match(PARA_ORDER_DO_Q_RE)
    if (doQMatch) {
      const inlineStart = text.match(/(\d{1,3})\s*A(?:[).:-]\s*|\s+)?(.*)$/)
      if (inlineStart) {
        startQuestion(inlineStart[1], block)
        currentOpt = 'A'
        const optionText = cleanImportedText(inlineStart[2])
        if (optionText) optTexts.A.push(optionText)
      }
      continue
    }

    const questionOnlyMatch = text.match(PARA_ORDER_QUESTION_ONLY_RE)
    if (questionOnlyMatch) {
      startQuestion(questionOnlyMatch[0], block)
      continue
    }

    const inlineQuestionOption = text.match(/^(\d{1,3})\s*([A-D])(?:[).:-]\s*|\s+)?(.*)$/)
    if (inlineQuestionOption) {
      startQuestion(inlineQuestionOption[1], block)
      currentOpt = inlineQuestionOption[2]
      const optionText = cleanImportedText(inlineQuestionOption[3])
      if (optionText) optTexts[currentOpt].push(optionText)
      continue
    }

    const nextQMatch = text.match(/^(.*[.!?'"\u2019\u201d])\s*(\d{1,3})A\s*$/)
    if (nextQMatch && qNum) {
      const textBefore = nextQMatch[1].trim()
      const newQNum = nextQMatch[2]
      if (currentOpt && textBefore) optTexts[currentOpt].push(textBefore)
      startQuestion(newQNum, block)
      continue
    }

    if (!qNum) continue

    const optionMatch = parseRawParaOrderOptionLine(text)
    if (optionMatch) {
      currentOpt = optionMatch.label
      optTexts[currentOpt].push(optionMatch.text)
      continue
    }

    if (currentOpt) optTexts[currentOpt].push(text)
  }

  flushQuestion()
  return output
}

function normalizeOptionOnlyQuestionBlock(block, instruction) {
  const text = cleanImportedText(String(block.text || '').replace(/\n+/g, ' '))
  const match = text.match(/^(\d{1,3})\s*[).:-]\s*(.+)$/)
  if (!match) return null

  const optionSegments = extractOptionSegments(cleanImportedText(match[2]))
  if (!optionSegments.length || optionSegments[0].labelStart > 2) return null

  const questionText = cleanImportedText(instruction || 'Choose the correct answer.')
  const lines = [`${match[1]}. ${questionText}`]
  optionSegments.forEach(option => {
    lines.push(`${option.label}. ${option.text}`)
  })

  return {
    ...block,
    text: lines.join('\n'),
    sharedInstruction: questionText,
  }
}

function preprocessStandaloneInstructions(blocks) {
  const output = []
  let currentInstruction = ''
  // Track whether the most-recently-seen numbered question has been
  // closed (by an Answer: marker, the next numbered question, or a
  // section break). When a question is still open, an instruction-shaped
  // line is almost always part of that question's prompt (e.g.
  // "List set A ∪ B." appearing after a Venn diagram for the current
  // question) — promoting it to a between-question sharedInstruction
  // would (a) drop it from the active question, and (b) stamp it onto
  // the next numbered question as a stale prompt.
  let insideOpenQuestion = false

  blocks.forEach(block => {
    const text = cleanImportedText(block.text)
    const singleLineText = cleanImportedText(String(block.text || '').replace(/\n+/g, ' '))
    const leadingLine = splitLines(text)[0] || singleLineText
    if (!text) {
      output.push(block)
      return
    }

    const detectedQuestion = questionMatch(leadingLine)
    const comprehensionInstruction = isComprehensionInstruction(singleLineText)
    const standaloneInstruction = isStandaloneInstruction(singleLineText)
    const sectionBreak = isSectionHeading(singleLineText) ||
      isPassageLabel(singleLineText) ||
      ANSWER_KEY_HEADING_RE.test(singleLineText)
    const isAnswerMarker = ANSWER_RE.test(singleLineText)

    if (sectionBreak || comprehensionInstruction) {
      currentInstruction = ''
      insideOpenQuestion = false
      output.push(block)
      return
    }

    if (standaloneInstruction && !detectedQuestion) {
      if (insideOpenQuestion) {
        // The line belongs to the open question (its prompt or a
        // figure-caption-style continuation); let the parser keep it
        // attached to that question instead of hoisting it.
        output.push(block)
        return
      }
      currentInstruction = stripInstructionPrefix(singleLineText)
      output.push(block)
      return
    }

    if (detectedQuestion) {
      insideOpenQuestion = true
    } else if (isAnswerMarker) {
      insideOpenQuestion = false
    }

    if (currentInstruction) {
      const normalizedOptionOnly = normalizeOptionOnlyQuestionBlock(block, currentInstruction)
      if (normalizedOptionOnly) {
        // Option-only blocks fully consume the standing instruction (the
        // instruction supplies the missing question text). Clear so it
        // doesn't repeat onto the next question.
        currentInstruction = ''
        output.push(normalizedOptionOnly)
        return
      }

      if (detectedQuestion) {
        // Hand the standing instruction to the next numbered question
        // and clear it so it doesn't leak onto every subsequent
        // question. The parser will also pick it up live from its own
        // sharedInstruction state, which is the safer source (it tracks
        // line position inside a block) — but stamping the first match
        // here keeps backwards-compatibility with the existing flow.
        // Without the clear, top-of-doc lines like "Answer ALL 60
        // questions." stamped every question forever, and a
        // per-question prompt mis-detected as a standalone instruction
        // (e.g. "List set A ∪ B." under a Venn diagram) leaked across
        // dozens of subsequent questions.
        output.push({
          ...block,
          sharedInstruction: currentInstruction,
        })
        currentInstruction = ''
        return
      }
    }

    output.push(block)
  })

  return output
}

// Detect a leading preamble instruction — the text before the first
// numbered question — so the importer can lift it to parts[0].instructions
// instead of letting it land as Q1's per-question prompt.
function extractDocumentInstruction(blocks = []) {
  const accumulated = []
  for (const block of blocks) {
    const text = cleanImportedText(String(block?.text || ''))
    if (!text) continue
    const singleLineText = cleanImportedText(text.replace(/\n+/g, ' '))
    const leadingLine = splitLines(text)[0] || singleLineText
    if (questionMatch(leadingLine)) break
    if (
      isSectionHeading(singleLineText)
      || isPassageLabel(singleLineText)
      || ANSWER_KEY_HEADING_RE.test(singleLineText)
    ) break
    if (isStandaloneInstruction(singleLineText) || looksLikeInstructionLine(singleLineText)) {
      accumulated.push(stripInstructionPrefix(singleLineText))
    }
  }
  return cleanImportedText(accumulated.join(' '))
}

function parseQuestionsFromBlocks(blocks, warnings) {
  const questions = []
  const answerKey = extractAnswerKey(blocks)
  let pendingAssets = []
  // Diagram captions stripped from text by stripBracketedImageDescriptions.
  // Buffered until the next question starts so e.g. `[Diagram: …]` between
  // a question stem and the next stem lands on the next question, not the
  // previous one whose stem already closed.
  let pendingDiagramCaptions = []
  let inAnswerKey = false
  let sharedInstruction = ''
  let compActive = false
  let compInstructions = []
  let compTitle = ''
  let compPassageParts = []
  let compSubQuestions = []
  let current = null
  // Active SECTION/PART heading. Stamped onto every question started while
  // this is non-null so processImportedQuestionBlocks can group questions
  // into parts[] downstream. Cleared by ANSWER_KEY_HEADING (no further
  // questions follow) but not by passage labels (a passage can live inside
  // a Part).
  let currentPartTitle = ''

  // Phase 3: when a DOCX table cell carries "A. <img>" / "B. <img>" / …,
  // buildDocxTableBlocks stamps the cell's first asset onto
  // `block.optionAssetsByLetter`. The parser routes each asset to the
  // matching optionAssets[] slot here. Letters > D harmlessly no-op.
  const OPTION_LETTERS_FOR_PARSER = ['A', 'B', 'C', 'D']
  function attachBlockOptionAsset(target, block, optionIndex) {
    if (!target || !block?.optionAssetsByLetter) return
    const letter = OPTION_LETTERS_FOR_PARSER[optionIndex]
    if (!letter) return
    const asset = block.optionAssetsByLetter[letter]
    if (!asset) return
    if (!Array.isArray(target.optionAssets)) target.optionAssets = []
    target.optionAssets[optionIndex] = asset
  }

  function finalizeSubQuestion() {
    if (!current) return
    const q = questionFromCurrent(current, answerKey)
    if (q) compSubQuestions.push(q)
    current = null
  }

  function finalizeStandaloneQuestion() {
    if (!current) return
    const q = questionFromCurrent(current, answerKey)
    if (q) questions.push(q)
    current = null
  }

  function pushComprehensionBlock() {
    const passage = compPassageParts.join('\n\n').trim()
    const instructions = compInstructions.join(' ').trim()
    const reviewNotes = [
      ...(!passage ? ['Passage text was not detected — please paste the passage manually.'] : []),
      ...(compSubQuestions.length === 0 ? ['No sub-questions were found for this comprehension block.'] : []),
    ]
    questions.push({
      type: 'comprehension',
      text: instructions || 'Read the passage and answer the questions that follow.',
      instructions,
      passageTitle: compTitle.trim(),
      passage,
      subQuestions: compSubQuestions,
      options: [],
      correctAnswer: '',
      explanation: '',
      topic: '',
      marks: Math.max(1, compSubQuestions.reduce((sum, q) => sum + (q.marks || 1), 0)),
      detectedType: 'comprehension',
      imageUrl: '',
      imageAssetId: '',
      diagramText: '',
      requiresReview: reviewNotes.length > 0 || compSubQuestions.some(q => q.requiresReview),
      reviewNotes,
      importWarnings: reviewNotes,
      sourcePage: null,
      sourceQuestionNumber: null,
      imageUploading: false,
      imageUploadStep: '',
    })
  }

  function finalizeComprehension() {
    finalizeSubQuestion()
    if (!compActive) return
    if (!compTitle && compSubQuestions.length === 0) {
      compActive = false
      compInstructions = []
      compTitle = ''
      compPassageParts = []
      compSubQuestions = []
      current = null
      return
    }
    if (compPassageParts.length > 0 || compSubQuestions.length > 0 || compInstructions.length > 0) {
      pushComprehensionBlock()
    }
    compActive = false
    compInstructions = []
    compTitle = ''
    compPassageParts = []
    compSubQuestions = []
    current = null
  }

  function startQuestion(text, block, sourceNumber, isSubQuestion) {
    if (isSubQuestion) finalizeSubQuestion()
    else finalizeStandaloneQuestion()

    const inline = splitInlineOptionsFromQuestion(text, !isSubQuestion ? sharedInstruction : '')
    current = {
      textParts: [inline.text],
      options: [],
      // Phase 3: parallel to options[]. Index i holds the imageAsset attributed
      // to option i (e.g. via a DOCX-table cell that said "A. <img>"). The
      // builder surfaces these on question.optionMedia and filters them out
      // of stem-asset selection so a per-option image doesn't double as the
      // question's illustration.
      optionAssets: [],
      lastOptionIndex: inline.options.length ? inline.options[inline.options.length - 1].index : null,
      answerRaw: '',
      explanationParts: [],
      reviewNotes: [],
      assets: [...pendingAssets, ...(block.assets || [])],
      pageAsset: block.pageAsset || null,
      pageNumber: block.pageNumber || null,
      diagramText: pendingDiagramCaptions.length
        ? cleanImportedText(pendingDiagramCaptions.join(' '))
        : '',
      tableFlattened: block.source === 'docx-table',
      sourceNumber,
      isSubQuestion,
      sharedInstruction: block.sharedInstruction || (!isSubQuestion ? sharedInstruction : ''),
      partTitle: currentPartTitle || '',
    }
    inline.options.forEach(opt => {
      current.options[opt.index] = opt.text
      attachBlockOptionAsset(current, block, opt.index)
    })
    pendingAssets = []
    pendingDiagramCaptions = []
    // Consumable instruction: once a question has taken the standing
    // sharedInstruction, clear it so it does not leak onto every
    // subsequent question. Top-of-doc lines like "Answer ALL 60 questions.
    // Choose the BEST answer." used to stamp every question forever,
    // and a per-question prompt like "List set A ∪ B." was carrying
    // forward to questions 36–60 once the parser misread it as a fresh
    // standalone instruction. The "for questions X–Y" multi-question
    // pattern is handled separately via question-range headings — those
    // never land in `sharedInstruction` in the first place.
    if (!isSubQuestion) sharedInstruction = ''
  }

  blocks.forEach(block => {
    const lines = splitLines(block.text)
    const blockDiagramCaptions = Array.isArray(block.diagramCaptions) ? block.diagramCaptions : []

    // Captions from a [Diagram: …] line that got stripped out: attach to
    // the active question's diagram text, otherwise buffer until the next
    // question opens.
    if (blockDiagramCaptions.length) {
      if (current) {
        current.diagramText = cleanImportedText(
          [current.diagramText, ...blockDiagramCaptions].filter(Boolean).join(' '),
        )
      } else {
        pendingDiagramCaptions.push(...blockDiagramCaptions)
      }
    }

    if (!lines.length && block.assets?.length) {
      if (current) current.assets.push(...block.assets)
      else pendingAssets.push(...block.assets)
      return
    }

    if (!lines.length) {
      // No text left in this block (e.g. it was just a `[Diagram: …]` line
      // that the stripper consumed). The caption handling above already
      // attached it; nothing else to do for this block.
      return
    }

    lines.forEach((line, lineIndex) => {
      const lineAssets = lineIndex === 0 ? (block.assets || []) : []

      if (ANSWER_KEY_HEADING_RE.test(line)) {
        finalizeComprehension()
        finalizeStandaloneQuestion()
        inAnswerKey = true
        sharedInstruction = ''
        currentPartTitle = ''
        return
      }

      if (inAnswerKey) {
        ANSWER_KEY_PAIR_RE.lastIndex = 0
        if (ANSWER_KEY_PAIR_RE.test(line) || /^[\d\sA-D).:-]+$/i.test(line)) return
        if (isComprehensionInstruction(line) || isSectionHeading(line)) {
          inAnswerKey = false
        } else {
          return
        }
      }

      const detectedQuestion = questionMatch(line)
      const answerMatch = line.match(ANSWER_RE)
      const explanationMatch = line.match(EXPLANATION_RE)
      const optionSegments = extractOptionSegments(line)
      const optionOnlyQuestion = optionOnlyQuestionMatch(line)
      const paraOrderOption = parseParaOrderOptionLine(line)
      const imageOnlyHint = IMAGE_HINT_RE.test(line)
      const isInstruction = isComprehensionInstruction(line)
      const isPassLabel = isPassageLabel(line)
      const isSectionBreak = isSectionHeading(line)
      const numberOnlyQuestion = line.match(PARA_ORDER_QUESTION_ONLY_RE)
      const explicitInstruction = /^instructions?\s*[:.-]/i.test(line)

      if (compActive) {
        if (isInstruction && !detectedQuestion) {
          if (compPassageParts.length > 0 || compSubQuestions.length > 0 || current) {
            finalizeComprehension()
            compActive = true
          }
          compInstructions.push(line)
          return
        }

        if (isPassLabel && !detectedQuestion) {
          if (compPassageParts.length > 0 || compSubQuestions.length > 0 || current) {
            finalizeSubQuestion()
            if (compTitle || compSubQuestions.length > 0) {
              pushComprehensionBlock()
            }
            const savedInstructions = [...compInstructions]
            compActive = true
            compInstructions = savedInstructions
            compTitle = ''
            compPassageParts = []
            compSubQuestions = []
            current = null
          }
          compTitle = cleanImportedText(line)
          return
        }

        if (isQuestionRangeHeading(line) && !detectedQuestion) return

        if (isSectionBreak && !isInstruction) {
          finalizeComprehension()
          currentPartTitle = cleanImportedText(line)
          if (lineAssets.length) pendingAssets.push(...lineAssets)
          return
        }

        if (detectedQuestion) {
          startQuestion(detectedQuestion.text, { ...block, assets: lineAssets }, detectedQuestion.number, true)
          return
        }

        if (current) {
          if (lineAssets.length) current.assets.push(...lineAssets)
          if (block.pageAsset && !current.pageAsset) current.pageAsset = block.pageAsset

          if (answerMatch) { current.answerRaw = answerMatch[1]; return }
          if (explanationMatch) { current.explanationParts.push(explanationMatch[1]); return }
          if (optionSegments.length) {
            optionSegments.forEach(opt => {
              current.options[opt.index] = opt.text
              current.lastOptionIndex = opt.index
              attachBlockOptionAsset(current, block, opt.index)
            })
            return
          }
          // Bare-letter fallback for tab-separated DOCX options (`A\tText`).
          const bareOption = extractBareLetterOption(line)
          if (bareOption) {
            current.options[bareOption.index] = bareOption.text
            current.lastOptionIndex = bareOption.index
            attachBlockOptionAsset(current, block, bareOption.index)
            return
          }
          // Trailing instruction text after this sub-question's options belongs
          // to the NEXT question — never to the current question's explanation.
          if (current.options.length && looksLikeInstructionLine(line)) {
            finalizeSubQuestion()
            compInstructions.push(stripInstructionPrefix(line))
            return
          }
          if (imageOnlyHint && !current.diagramText) current.diagramText = line
          if (current.options.length >= 2) {
            // Same cascade guard as the standalone path — once a comprehension
            // sub-question has its options, trailing text is almost always the
            // next sub-question whose number went missing in extraction.
            const looksLikeNextStem = /\?\s*$/.test(line)
            const alreadyAbsorbedOneExtra = current.explanationParts.length > 0
            if (looksLikeNextStem || alreadyAbsorbedOneExtra) {
              startQuestion(line, { ...block, assets: lineAssets }, null, true)
              current.reviewNotes.push('Question number was not detected — review this question.')
              return
            }
            current.explanationParts.push(line)
            current.reviewNotes.push('Extra text after options was treated as explanation.')
          } else if (block.source === 'docx-table') {
            // Same routing as the standalone path: a real `<w:tbl>` between
            // a sub-question's stem and its options is reference data, not
            // the stem itself.
            current.diagramText = cleanImportedText(
              [current.diagramText, line].filter(Boolean).join('\n'),
            )
          } else {
            current.textParts.push(line)
          }
          return
        }

        if (line.length >= 10 && !ANSWER_KEY_HEADING_RE.test(line)) {
          compPassageParts.push(line)
        }
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      if (explicitInstruction && !detectedQuestion) {
        finalizeStandaloneQuestion()
        sharedInstruction = stripInstructionPrefix(line)
        return
      }

      if (isInstruction && !detectedQuestion) {
        finalizeStandaloneQuestion()
        sharedInstruction = ''
        compActive = true
        compInstructions.push(line)
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      if (isSectionBreak || isPassLabel) {
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        finalizeStandaloneQuestion()
        sharedInstruction = ''
        // Section heading (PART A / SECTION B / UNIT 3 / etc.) opens a new
        // Part group. Passage labels ("Story 1") do NOT — those belong to
        // a comprehension passage that may live inside the active Part.
        if (isSectionBreak) {
          currentPartTitle = cleanImportedText(line)
        }
        return
      }

      if (isStandaloneInstruction(line) && !detectedQuestion) {
        // An "instruction-shaped" line inside a question that has not yet
        // received any options is almost always the question's actual
        // prompt — e.g. "List set A ∪ B." appearing after a Venn-diagram
        // figure line for the current question. Closing the question
        // here would drop its options entirely (the A/B/C/D lines arrive
        // when `current` is null and get silently discarded) and leak
        // the prompt onto every subsequent question as a stale
        // sharedInstruction. Keep the line as part of the active stem.
        if (current && !(current.options || []).some(opt => opt != null && opt !== '')) {
          current.textParts.push(line)
          return
        }
        finalizeStandaloneQuestion()
        sharedInstruction = stripInstructionPrefix(line)
        return
      }

      if (isQuestionRangeHeading(line) && !detectedQuestion) return

      if (sharedInstruction && PARA_ORDER_INSTRUCTION_RE.test(sharedInstruction) && numberOnlyQuestion) {
        startQuestion(
          deriveParaOrderQuestionText(sharedInstruction),
          { ...block, assets: lineAssets, sharedInstruction },
          numberOnlyQuestion[0],
          false,
        )
        return
      }

      if (optionOnlyQuestion) {
        startQuestion(
          sharedInstruction || 'Choose the correct answer.',
          { ...block, assets: lineAssets, sharedInstruction },
          optionOnlyQuestion.number,
          false,
        )
        current.options = optionOnlyQuestion.options
        return
      }

      if (detectedQuestion) {
        startQuestion(detectedQuestion.text, { ...block, assets: lineAssets }, detectedQuestion.number, false)
        return
      }

      if (isLikelyDocxQuestionHeading(line, block)) {
        startQuestion(line, { ...block, assets: lineAssets }, null, false)
        current.reviewNotes.push('Word list numbering was inferred for this question. Review wording before publishing.')
        return
      }

      if (!current && /\?$/.test(line)) {
        startQuestion(line, { ...block, assets: lineAssets }, null, false)
        current.reviewNotes.push('Question number was not found.')
        return
      }

      if (!current) {
        // Lines that look like teacher instructions but slipped past the
        // strict detector (e.g. "Underline the verb in each sentence.") still
        // belong to the next question — capture rather than silently drop.
        if (looksLikeInstructionLine(line)) {
          sharedInstruction = sharedInstruction
            ? cleanImportedText(`${sharedInstruction} ${stripInstructionPrefix(line)}`)
            : stripInstructionPrefix(line)
        }
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      if (lineAssets.length) current.assets.push(...lineAssets)
      if (block.pageAsset && !current.pageAsset) current.pageAsset = block.pageAsset

      if (answerMatch) { current.answerRaw = answerMatch[1]; return }
      if (explanationMatch) { current.explanationParts.push(explanationMatch[1]); return }
      if (optionSegments.length) {
        optionSegments.forEach(opt => {
          current.options[opt.index] = opt.text
          current.lastOptionIndex = opt.index
          attachBlockOptionAsset(current, block, opt.index)
        })
        return
      }
      // Bare-letter fallback for tab-separated DOCX options (`A\tText`).
      const bareOption = extractBareLetterOption(line)
      if (bareOption && !numberOnlyQuestion) {
        current.options[bareOption.index] = bareOption.text
        current.lastOptionIndex = bareOption.index
        attachBlockOptionAsset(current, block, bareOption.index)
        return
      }
      if (current.sharedInstruction && PARA_ORDER_INSTRUCTION_RE.test(current.sharedInstruction) && paraOrderOption) {
        current.lastOptionIndex = paraOrderOption.label.charCodeAt(0) - 65
        current.options[current.lastOptionIndex] = paraOrderOption.text
        return
      }
      if (
        current.sharedInstruction &&
        PARA_ORDER_INSTRUCTION_RE.test(current.sharedInstruction) &&
        Number.isInteger(current.lastOptionIndex) &&
        current.lastOptionIndex >= 0
      ) {
        current.options[current.lastOptionIndex] = cleanImportedText(
          [current.options[current.lastOptionIndex], line].filter(Boolean).join(' '),
        )
        return
      }
      // Trailing instruction text after this question's options belongs to
      // the NEXT question — never to the current question's explanation. This
      // is the most common reason imported "instructions go somewhere else".
      if (current.options.length && looksLikeInstructionLine(line)) {
        finalizeStandaloneQuestion()
        sharedInstruction = stripInstructionPrefix(line)
        return
      }
      if (imageOnlyHint && !current.diagramText) current.diagramText = line
      if (current.options.length >= 2) {
        // A complete question already has its options. Trailing text now
        // belongs to either an explanation (rare in past papers) OR the next
        // question whose number prefix went missing during extraction.
        //   - Lines ending in `?` are almost certainly the next stem.
        //   - The SECOND extra line in a row is also almost certainly the next
        //     question — explanations are usually one paragraph. Capping the
        //     absorb count stops Q2/Q3/Q4's content cascading into Q1.
        //   - Trailing footer/disclaimer lines (©…, "STOP! PLEASE CHECK…")
        //     are dropped silently — past-paper docs end with these and we
        //     don't want them spawning a phantom question.
        if (looksLikeDocFooter(line)) return
        const looksLikeNextStem = /\?\s*$/.test(line)
        const alreadyAbsorbedOneExtra = current.explanationParts.length > 0
        if (looksLikeNextStem || alreadyAbsorbedOneExtra) {
          startQuestion(line, { ...block, assets: lineAssets }, null, false)
          current.reviewNotes.push('Question number was not detected — review this question.')
          return
        }
        current.explanationParts.push(line)
        current.reviewNotes.push('Extra text after options was treated as explanation.')
      } else if (block.source === 'docx-table') {
        // The source DOCX had a real `<w:tbl>` here (e.g. Q4's oranges
        // table). buildDocxTableBlocks flattened it to text but tagged the
        // block with source='docx-table' so we know the content is reference
        // data, not part of the question stem. Route it into diagramText so
        // the editor renders it as supplementary context next to the
        // question instead of bloating the stem with `Days Monday Tuesday
        // … 42 19 0 39 1 40` glued onto a one-sentence prompt.
        current.diagramText = cleanImportedText(
          [current.diagramText, line].filter(Boolean).join('\n'),
        )
      } else {
        current.textParts.push(line)
      }
    })
  })

  if (compActive) finalizeComprehension()
  else finalizeStandaloneQuestion()

  if (!questions.length) {
    const fallbackText = cleanImportedText(blocks.map(b => b.text).join('\n')).slice(0, 1200)
    const fallbackAsset = blocks
      .flatMap(b => [...(b.assets || []), ...(b.pageAsset ? [b.pageAsset] : [])])
      .filter(Boolean)[0] || null
    const fallbackType = fallbackAsset ? 'diagram' : 'short_answer'
    warnings.push('No numbered questions were detected. One editable review question was created from the extracted text.')
    questions.push({
      text: fallbackText || (fallbackAsset ? 'Review this imported image-based question.' : 'Review imported document and write the question here.'),
      options: [],
      correctAnswer: '',
      explanation: '',
      topic: '',
      marks: 1,
      type: fallbackType,
      detectedType: fallbackType,
      imageUrl: fallbackAsset?.imageUrl || '',
      imageAssetId: fallbackAsset?.id || '',
      diagramText: fallbackAsset ? `Imported image from ${fallbackAsset.sourcePath || 'document'}.` : '',
      requiresReview: true,
      reviewNotes: [fallbackAsset ? 'Image-based question structure was not clear.' : 'Question structure was not clear.'],
      importWarnings: [fallbackAsset ? 'Image-based question structure was not clear.' : 'Question structure was not clear.'],
      sourcePage: null,
      imageUploading: false,
      imageUploadStep: '',
    })
  }

  return questions
}

// Builds the editor's `sections[]` AND the matching `parts[]` array.
// PRISCA / ECZ exam papers that include "PART A: …", "SECTION B" or
// "UNIT 3" headings get an entry per unique heading, and every section
// belonging to that heading is stamped with the part's id.
function buildImportedSections(questions = [], documentInstruction = '') {
  const partsByTitle = new Map()
  const orderedParts = []

  function ensurePart(rawTitle) {
    const title = String(rawTitle || '').trim()
    if (!title) return null
    if (partsByTitle.has(title)) return partsByTitle.get(title)
    const part = createPartGroup({ title, order: orderedParts.length })
    partsByTitle.set(title, part)
    orderedParts.push(part)
    return part
  }

  // Document-level preamble instruction (e.g. "Answer ALL 60 questions.")
  // belongs in the editor's Instructions slot, not on Q1's sharedInstruction.
  // When no explicit Part headings were detected, we create a single
  // untitled Part to own the preamble — every question lands inside it.
  let defaultPart = null
  if (documentInstruction) {
    defaultPart = createPartGroup({ title: '', instructions: documentInstruction, order: 0 })
    orderedParts.push(defaultPart)
  }

  const sections = questions.map(question => {
    const partTitle = question.passageTitle && question.partTitle
      ? question.partTitle
      : question.partTitle || ''
    const namedPart = ensurePart(partTitle)
    const part = namedPart || defaultPart
    const partId = part?.id ?? null

    if (question.type === 'comprehension' || question.detectedType === 'comprehension') {
      const passageSection = createPassageSection({
        title: question.passageTitle ?? '',
        instructions: question.instructions ?? question.text ?? '',
        passageText: question.passage ?? '',
        imageUrl: question.imageUrl ?? '',
        questions: (question.subQuestions || []).map(subQuestion => ({
          ...subQuestion,
          type: 'mcq',
          detectedType: 'mcq',
          passageId: null,
          partId,
        })),
      })
      passageSection.partId = partId
      return passageSection
    }

    const section = createStandaloneSection({ ...question, partId })
    return section
  })

  return { sections, parts: orderedParts }
}

function summarizeImportedSections(sections = []) {
  let questionCount = 0
  let images = 0
  let needsReview = 0
  let passages = 0

  sections.forEach(section => {
    if (section.kind === 'passage') {
      passages += 1
      if (section.passage?.imageUrl) images += 1
      ;(section.passage?.questions || []).forEach(question => {
        questionCount += 1
        if (question.imageUrl) images += 1
        if (question.requiresReview) needsReview += 1
      })
      return
    }

    questionCount += 1
    if (section.question?.imageUrl) images += 1
    if (section.question?.requiresReview) needsReview += 1
  })

  return {
    questions: questionCount,
    images,
    needsReview,
    passages,
  }
}

export function processImportedQuestionBlocks(blocks = [], warnings = []) {
  // Run mergeOrphanQuestionNumbers FIRST so the rest of the pipeline sees
  // `6. 954 751` instead of two stray blocks `6.` + `954 751`. Past papers
  // that lay vertical arithmetic out as separate paragraphs were dropping
  // every such question on the floor.
  const processedBlocks = preprocessStandaloneInstructions(
    preprocessParaOrdering(mergeOrphanQuestionNumbers(blocks)),
  )
  // Capture the leading "Answer ALL N questions"-style instruction before
  // any numbered question, so we can hoist it to parts[0].instructions
  // instead of stamping it onto Q1 only.
  const documentInstruction = extractDocumentInstruction(processedBlocks)
  const questions = parseQuestionsFromBlocks(processedBlocks, warnings)

  // The parser still sets sharedInstruction on the first question because
  // the legacy stamping path runs unconditionally. Strip the doc-level
  // instruction off the first standalone question so it doesn't render
  // twice (once in parts[0].instructions, once on Q1's prompt).
  if (documentInstruction && questions.length) {
    const target = questions.find(q => q.type !== 'comprehension')
    if (target && cleanImportedText(target.sharedInstruction) === documentInstruction) {
      target.sharedInstruction = ''
    }
  }

  const { sections, parts } = buildImportedSections(questions, documentInstruction)
  const summary = summarizeImportedSections(sections)

  return {
    processedBlocks,
    questions,
    sections,
    parts,
    documentInstruction,
    summary,
  }
}
