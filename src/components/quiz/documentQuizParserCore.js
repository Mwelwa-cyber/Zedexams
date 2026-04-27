import { createPartGroup, createPassageSection, createStandaloneSection } from '../../utils/quizSections.js'

const SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]

const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\).:\-]\s*(.+)$/i
const QUESTION_NO_PUNCT_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s+(.+\?)$/i
const OPTION_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])\s*[\).:\-])\s*(.+)$/
const OPTION_LABEL_RE = /(^|\s)(?:\(([A-Da-d])\)|([A-Da-d])\s*[\).:\-])\s*/g
const ANSWER_RE = /^(?:answer|correct answer|ans|key)\s*[:\-]\s*(.+)$/i
const EXPLANATION_RE = /^(?:explanation|reason|because)\s*[:\-]\s*(.+)$/i
const IMAGE_HINT_RE = /\b(diagram|figure|picture|image|graph|chart|map|shown|label|observe|study the|look at)\b/i
const ANSWER_KEY_HEADING_RE = /^(answers\b|answer\s+key|memorandum|marking scheme)\b/i
const ANSWER_KEY_PAIR_RE = /(?:^|\s)(\d{1,3})\s*[\).:\-]?\s*(?:answer\s*)?([A-D]|true|false)\b/gi
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
  const punctuated = text.match(/^([A-D])[\).:\-]\s*(.+)$/)
  const glued = text.match(/^([A-D])([A-Z].+)$/)
  const label = (punctuated?.[1] || glued?.[1] || '').toUpperCase()
  if (!label) return null

  const optionText = cleanImportedText(punctuated?.[2] || glued?.[2] || '')
  if (!optionText) return null

  return { label, text: optionText }
}

function parseRawParaOrderOptionLine(line) {
  const text = cleanImportedText(String(line || '').replace(/\n+/g, ' '))
  const match = text.match(/^([A-D])(?:[\).:\-]\s*|)(.+)$/)
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
  const startsAsOptionLine = matches[0].labelStart <= 2 || /^(options?|choices?)[:\-]?$/.test(firstPrefix)
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
  return cleanImportedText(text).replace(/^instructions?\s*[:.-]\s*/i, '').replace(/^note\s*[:\-]\s*/i, '')
}

function optionOnlyQuestionMatch(line) {
  const text = cleanImportedText(line)
  const match = text.match(/^(\d{1,3})\s*[\).:\-]\s*(.+)$/)
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
  const title = firstLines.find(line => line.length > 6 && !questionMatch(line) && !OPTION_RE.test(line)) || titleFromFileName(fileName)
  const gradeMatch = text.match(/\bgrade\s*(\d{1,2})\b/i)
  const grade = gradeMatch ? gradeMatch[1] : ''
  const headerText = [title, ...firstLines].join(' ')
  const subject = SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(headerText))
    || SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
    || ''

  return {
    title: cleanImportedText(title).slice(0, 90) || titleFromFileName(fileName),
    grade,
    subject,
    topic: cleanImportedText(title).slice(0, 80),
  }
}

function extractAnswerKey(blocks) {
  const answers = new Map()
  let inAnswerKey = false

  blocks.forEach(block => {
    splitLines(block.text).forEach(line => {
      const startsAnswerKey = ANSWER_KEY_HEADING_RE.test(line)
      if (startsAnswerKey) inAnswerKey = true
      if (!inAnswerKey) return

      ANSWER_KEY_PAIR_RE.lastIndex = 0
      let match
      while ((match = ANSWER_KEY_PAIR_RE.exec(line)) !== null) {
        answers.set(match[1], match[2])
      }
    })
  })

  return answers
}

function parseAnswerIndex(rawAnswer, options) {
  const answer = cleanImportedText(rawAnswer)
  if (!answer) return null
  const letter = answer.match(/^[A-D]/i)?.[0]?.toUpperCase()
  if (letter) {
    const index = letter.charCodeAt(0) - 65
    return index >= 0 && index < options.length ? index : null
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

function questionFromCurrent(current, answerKey = new Map()) {
  if (!current) return null

  const reviewNotes = [...current.reviewNotes]
  const text = cleanImportedText(current.textParts.join(' '))
  const sharedInstruction = cleanImportedText(current.sharedInstruction)
  const options = current.options.map(cleanImportedText).filter(Boolean)
  const imageHint = IMAGE_HINT_RE.test(`${text} ${current.diagramText}`)
  const assets = current.assets.length ? current.assets : imageHint && current.pageAsset ? [current.pageAsset] : []
  const firstAsset = assets[0] || null
  const lowerOptions = options.map(option => option.toLowerCase())
  const isTrueFalse = options.length === 2 && lowerOptions.includes('true') && lowerOptions.includes('false')

  let type = 'short_answer'
  const answerRaw = cleanImportedText(current.answerRaw || (current.sourceNumber ? answerKey.get(String(current.sourceNumber)) : ''))
  let correctAnswer = answerRaw

  if (imageHint || firstAsset) {
    type = 'diagram'
  } else if (isTrueFalse) {
    type = 'truefalse'
  } else if (options.length >= 2) {
    type = 'mcq'
  }

  if (type === 'mcq' || type === 'truefalse') {
    const index = parseAnswerIndex(answerRaw, options)
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
    requiresReview: reviewNotes.length > 0,
    reviewNotes,
    importWarnings: reviewNotes,
    sourcePage: current.pageNumber || null,
    sourceQuestionNumber: current.sourceNumber || null,
    partTitle: current.partTitle || '',
    imageUploading: false,
    imageUploadStep: '',
  }
}

function preprocessParaOrdering(blocks) {
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
      const inlineStart = text.match(/(\d{1,3})\s*A(?:[\).:\-]\s*|\s+)?(.*)$/)
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

    const inlineQuestionOption = text.match(/^(\d{1,3})\s*([A-D])(?:[\).:\-]\s*|\s+)?(.*)$/)
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
  const match = text.match(/^(\d{1,3})\s*[\).:\-]\s*(.+)$/)
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

    if (sectionBreak || comprehensionInstruction) {
      currentInstruction = ''
      output.push(block)
      return
    }

    if (standaloneInstruction && !detectedQuestion) {
      currentInstruction = stripInstructionPrefix(singleLineText)
      output.push(block)
      return
    }

    if (currentInstruction) {
      const normalizedOptionOnly = normalizeOptionOnlyQuestionBlock(block, currentInstruction)
      if (normalizedOptionOnly) {
        output.push(normalizedOptionOnly)
        return
      }

      if (detectedQuestion) {
        output.push({
          ...block,
          sharedInstruction: currentInstruction,
        })
        return
      }
    }

    output.push(block)
  })

  return output
}

function parseQuestionsFromBlocks(blocks, warnings) {
  const questions = []
  const answerKey = extractAnswerKey(blocks)
  let pendingAssets = []
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
      lastOptionIndex: inline.options.length ? inline.options[inline.options.length - 1].index : null,
      answerRaw: '',
      explanationParts: [],
      reviewNotes: [],
      assets: [...pendingAssets, ...(block.assets || [])],
      pageAsset: block.pageAsset || null,
      pageNumber: block.pageNumber || null,
      diagramText: '',
      tableFlattened: block.source === 'docx-table',
      sourceNumber,
      isSubQuestion,
      sharedInstruction: block.sharedInstruction || (!isSubQuestion ? sharedInstruction : ''),
      partTitle: currentPartTitle || '',
    }
    inline.options.forEach(opt => {
      current.options[opt.index] = opt.text
    })
    pendingAssets = []
  }

  blocks.forEach(block => {
    const lines = splitLines(block.text)

    if (!lines.length && block.assets?.length) {
      if (current) current.assets.push(...block.assets)
      else pendingAssets.push(...block.assets)
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
        if (ANSWER_KEY_PAIR_RE.test(line) || /^[\d\sA-D).:\-]+$/i.test(line)) return
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
            })
            return
          }
          // Bare-letter fallback for tab-separated DOCX options (`A\tText`).
          const bareOption = extractBareLetterOption(line)
          if (bareOption) {
            current.options[bareOption.index] = bareOption.text
            current.lastOptionIndex = bareOption.index
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
          if (current.options.length && !/\?$/.test(line)) {
            current.explanationParts.push(line)
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
        })
        return
      }
      // Bare-letter fallback for tab-separated DOCX options (`A\tText`).
      const bareOption = extractBareLetterOption(line)
      if (bareOption && !numberOnlyQuestion) {
        current.options[bareOption.index] = bareOption.text
        current.lastOptionIndex = bareOption.index
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
      if (current.options.length && !/\?$/.test(line)) {
        current.explanationParts.push(line)
        current.reviewNotes.push('Extra text after options was treated as explanation.')
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
function buildImportedSections(questions = []) {
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

  const sections = questions.map(question => {
    const partTitle = question.passageTitle && question.partTitle
      ? question.partTitle
      : question.partTitle || ''
    const part = ensurePart(partTitle)
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
  const processedBlocks = preprocessStandaloneInstructions(
    preprocessParaOrdering(blocks),
  )
  const questions = parseQuestionsFromBlocks(processedBlocks, warnings)
  const { sections, parts } = buildImportedSections(questions)
  const summary = summarizeImportedSections(sections)

  return {
    processedBlocks,
    questions,
    sections,
    parts,
    summary,
  }
}
