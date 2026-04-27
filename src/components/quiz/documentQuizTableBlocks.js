const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\).:\-]\s*(.+)$/i
const QUESTION_NO_PUNCT_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s+(.+\?)$/i
const QUESTION_NUMBER_ONLY_RE = /^(\d{1,3})[\).:]?$/
const OPTION_LABEL_ONLY_RE = /^([A-D])(?:[\).:]?)$/i
const OPTION_TEXT_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])\s*[\).:\-])\s*(.+)$/
const ANSWER_LABEL_ONLY_RE = /^(?:answer|correct answer|ans|key)$/i
const ANSWER_RE = /^(?:answer|correct answer|ans|key)\s*[:\-]?\s*(.+)$/i
const HEADER_TOKEN_RE = /^(?:q(?:uestion)?(?:\s*no\.?)?|no\.?|number|item|question|question no\.?|option(?:\s+[a-d])?|answer|correct answer|marks?|score|a|b|c|d)$/i
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z0-9])([.?!:;])([A-Z])/g, '$1$2 $3')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function questionMatch(line) {
  const normalized = cleanText(line)
  const match = normalized.match(QUESTION_RE) || normalized.match(QUESTION_NO_PUNCT_RE)
  if (!match) return null
  return { number: match[1], text: cleanText(match[2]) }
}

function normalizeAnswerCell(text) {
  const normalized = cleanText(text)
  if (!normalized) return ''
  const explicitAnswer = normalized.match(ANSWER_RE)
  if (explicitAnswer) return `Answer: ${cleanText(explicitAnswer[1])}`
  const letter = normalized.match(/^[A-D]$/i)?.[0]?.toUpperCase()
  if (letter) return `Answer: ${letter}`
  const booleanAnswer = /^(true|false)$/i.test(normalized)
  if (booleanAnswer) return `Answer: ${normalized}`
  return ''
}

function stripOptionPrefix(text) {
  const normalized = cleanText(text)
  const optionMatch = normalized.match(OPTION_TEXT_RE)
  if (optionMatch?.[3]) return cleanText(optionMatch[3])
  return normalized
}

function isHeaderRow(texts) {
  if (!texts.length || texts.length < 2) return false
  const normalized = texts.map(text => cleanText(text))
  const headerCount = normalized.filter(text => HEADER_TOKEN_RE.test(text)).length
  const hasQuestionHeader = normalized.some(text => /^(?:q(?:uestion)?(?:\s*no\.?)?|question)$/i.test(text))
  const hasOptionHeaders = normalized.filter(text => /^(?:option\s+)?[a-d]$/i.test(text)).length >= 2
  const hasAnswerHeader = normalized.some(text => /^(?:answer|correct answer|key)$/i.test(text))
  return hasQuestionHeader || hasOptionHeaders || hasAnswerHeader || headerCount >= Math.max(2, normalized.length - 1)
}

function buildWideQuestionRow(texts) {
  if (texts.length < 5) return null

  let number = ''
  let questionText = ''
  let remainder = []

  const firstQuestion = questionMatch(texts[0])
  if (firstQuestion) {
    number = firstQuestion.number
    questionText = firstQuestion.text
    remainder = texts.slice(1)
  } else {
    const numberOnly = texts[0].match(QUESTION_NUMBER_ONLY_RE)
    if (!numberOnly || !texts[1]) return null
    number = numberOnly[1]
    questionText = cleanText(texts[1])
    remainder = texts.slice(2)
  }

  if (!questionText) return null

  const nextCells = [...remainder]

  if (nextCells.length < 4) return null

  const options = nextCells.slice(0, 4).map(stripOptionPrefix).filter(Boolean)
  if (options.length < 4) return null
  const answerLine = nextCells
    .slice(4)
    .map(normalizeAnswerCell)
    .find(Boolean) || ''

  const lines = [`${number}. ${questionText}`]
  options.forEach((option, index) => {
    lines.push(`${OPTION_LETTERS[index]}. ${option}`)
  })
  if (answerLine) lines.push(answerLine)
  return lines.join('\n')
}

function buildSplitRow(texts) {
  if (texts.length === 1) return texts[0]

  if (texts.length === 2) {
    const [left, right] = texts
    const questionOnly = left.match(QUESTION_NUMBER_ONLY_RE)
    if (questionOnly) return `${questionOnly[1]}. ${right}`

    const optionOnly = left.match(OPTION_LABEL_ONLY_RE)
    if (optionOnly) return `${optionOnly[1].toUpperCase()}. ${right}`

    if (ANSWER_LABEL_ONLY_RE.test(left)) return `Answer: ${right}`
  }

  return ''
}

function createBlock(text, assets = [], source = 'docx') {
  return {
    text: cleanText(text),
    assets,
    source,
  }
}

// Recognises the ECZ "ANSWER SHEET" table format where each row carries a
// question number followed by four cells (one per option A-D), and the
// chosen answer is marked with a check mark / shading character. The four
// columns may repeat across the row (e.g. 5 columns of (No, A, B, C, D)
// per row). Returns an array of {number, letter} pairs or null.
//
// Critical: this runs on the RAW cell list (not the empty-cell-filtered
// list) so column positions survive — empty cells convey "this option was
// NOT chosen" and we need them.
const ANSWER_MARKER_RE = /^[✓✔☑■●★xX✓✔✖]+$/
const NUMBER_CELL_RE = /^\d{1,3}\.?$/

function extractAnswerSheetRow(rawCells) {
  if (!rawCells || rawCells.length < 5) return null
  const texts = rawCells.map(cell => cleanText(cell?.text || ''))
  const pairs = []

  // Walk the row in 5-cell windows: [number, A?, B?, C?, D?]
  for (let i = 0; i + 4 < texts.length; i += 5) {
    const numberCell = texts[i]
    const optionCells = texts.slice(i + 1, i + 5)
    if (!NUMBER_CELL_RE.test(numberCell)) return null
    // Find which of the 4 cells carries an answer marker. Allow plain "A"
    // text in a cell (some answer sheets just write the letter inline).
    let chosenIndex = -1
    let conflict = false
    optionCells.forEach((cellText, columnIndex) => {
      const trimmed = cellText.trim()
      if (!trimmed) return
      if (ANSWER_MARKER_RE.test(trimmed) || /^[A-D]$/i.test(trimmed)) {
        if (chosenIndex >= 0) conflict = true
        chosenIndex = columnIndex
      }
    })
    if (conflict || chosenIndex < 0) return null
    const number = String(parseInt(numberCell, 10))
    const letter = String.fromCharCode(65 + chosenIndex)
    pairs.push({ number, letter })
  }

  return pairs.length > 0 ? pairs : null
}

export function buildDocxTableBlocks(rows = []) {
  const blocks = []
  let fallbackRowCount = 0
  // Collected check-mark answer-sheet rows. Synthesised into an "ANSWER KEY"
  // block at the end so the regular extractAnswerKey() pipeline picks them up
  // and applies them to every numbered question that lacks an inline answer.
  const answerSheetPairs = []

  rows.forEach((row, index) => {
    const rawCells = (row?.cells || []).map(cell => ({
      ...cell,
      text: cleanText(cell?.text),
      assets: Array.isArray(cell?.assets) ? cell.assets : [],
    }))

    // ECZ-style answer-sheet rows: detect on raw cells so column positions
    // (which carry the meaning of "this option was chosen") survive.
    const sheetPairs = extractAnswerSheetRow(rawCells)
    if (sheetPairs) {
      answerSheetPairs.push(...sheetPairs)
      return
    }

    const cells = rawCells.filter(cell => cell.text || cell.assets.length)
    if (!cells.length) return

    const texts = cells.map(cell => cell.text).filter(Boolean)
    const assets = cells.flatMap(cell => cell.assets)

    if (!texts.length) {
      if (assets.length) blocks.push(createBlock('', assets))
      return
    }

    if (index === 0 && isHeaderRow(texts)) return

    const wideRow = buildWideQuestionRow(texts)
    if (wideRow) {
      blocks.push(createBlock(wideRow, assets))
      return
    }

    const splitRow = buildSplitRow(texts)
    if (splitRow) {
      blocks.push(createBlock(splitRow, assets))
      return
    }

    const mergedText = texts.join('\n')
    blocks.push(createBlock(mergedText, assets, texts.length > 1 ? 'docx-table' : 'docx'))
    if (texts.length > 1) fallbackRowCount += 1
  })

  if (answerSheetPairs.length > 0) {
    const synthesised = ['ANSWER KEY']
    answerSheetPairs.forEach(({ number, letter }) => {
      synthesised.push(`${number}. ${letter}`)
    })
    blocks.push(createBlock(synthesised.join('\n'), [], 'docx-answer-sheet'))
  }

  const warnings = fallbackRowCount > 0
    ? ['A complex Word table row was flattened into text. Review those questions before publishing.']
    : []

  return { blocks, warnings }
}
