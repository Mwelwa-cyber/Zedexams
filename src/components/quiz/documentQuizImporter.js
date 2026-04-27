import { unzipSync, strFromU8 } from 'fflate'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import { createPassageSection, createStandaloneSection } from '../../utils/quizSections.js'
import {
  metadataFromText as buildImportMetadata,
  processImportedQuestionBlocks,
} from './documentQuizParserCore.js'
import { buildDocxTableBlocks } from './documentQuizTableBlocks.js'

let pdfjsLoader = null

async function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = import('pdfjs-dist/legacy/build/pdf.mjs').then(module => {
      module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      return module
    })
  }
  return pdfjsLoader
}

export const QUIZ_DOCUMENT_ACCEPT = [
  '.doc',
  '.docx',
  '.pdf',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

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

// ─── Core Patterns ───────────────────────────────────────────────────────────
const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\).:\-]\s*(.+)$/i
const QUESTION_NO_PUNCT_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s+(.+\?)$/i

// Options: handles A. A) (A) a. a) (a) and roman numerals i. ii. iii. iv.
const OPTION_RE = /^(?:\(([A-Da-d])\)|([A-Da-d])\s*[\).:\-])\s*(.+)$/
const OPTION_LABEL_RE = /(^|\s)(?:\(([A-Da-d])\)|([A-Da-d])\s*[\).:\-])\s*/g

const ANSWER_RE = /^(?:answer|correct answer|ans|key)\s*[:\-]\s*(.+)$/i
const EXPLANATION_RE = /^(?:explanation|reason|because)\s*[:\-]\s*(.+)$/i
const IMAGE_HINT_RE = /\b(diagram|figure|picture|image|graph|chart|map|shown|label|observe|study the|look at)\b/i
const ANSWER_KEY_HEADING_RE = /^(answers\b|answer\s+key|memorandum|marking scheme)\b/i
const ANSWER_KEY_PAIR_RE = /(?:^|\s)(\d{1,3})\s*[\).:\-]?\s*(?:answer\s*)?([A-D]|true|false)\b/gi

// Named spelling/word-game section headings
const SECTION_HEADING_RE = /^(?:spelling bee\b|elimination round\b|category\b|words\b|easy round\b|average level\b|round\s+\d+\b|tie[-\s]?breakers?\b|extra words?\b|oral recitation\b)/i

// ─── Paragraph-Ordering Question Patterns (e.g. PART 5, Qs 39-45) ───────────
//
// These questions present four multi-sentence paragraphs as options A-D.
// The candidate picks the paragraph whose sentences are in the correct order.
//
// Raw document format (after XML extraction):
//   [line1 of opt A]
//   [line2 of opt A]
//   [last sentence of opt A].B          ← period + letter = option boundary
//   [line1 of opt B]
//   [last sentence of opt B].C
//   ...
//   [last sentence of opt D].40A        ← period + next question number + A
//
// First question in section arrives embedded in the "Now do questions" line:
//   "...Now do questions 39-4339A"      ← "now do questions N" triggers start
//
const PARA_ORDER_INSTRUCTION_RE = /each question has four paragraphs|sentences in the best order|choose the paragraph which has the sentences/i
const PARA_ORDER_DO_Q_RE = /\bnow\s+do\s+questions?\s+(\d{1,3})/i
const PARA_ORDER_QUESTION_ONLY_RE = /^\d{1,3}$/
const QUESTION_RANGE_HEADING_RE = /^(?:questions?\s+\d{1,3}\s*[–-]\s*\d{1,3}|now\s+do\s+questions?\s+\d{1,3}\s*[–-]\s*\d{1,3}|look\s+at\s+questions?\s+\d{1,3}(?:\s*[–-]\s*\d{1,3})?)$/i
const STANDALONE_INSTRUCTION_RE = /^(?:instruction\s*:|choose\s+(?:the|which)\b|select\s+(?:the|which)\b|write\s+(?:the|a|an)\b|complete\s+(?:the|each)\b|fill\s+in\b|look\s+at\s+questions?\b|for\s+questions?\b)/i

// ─── Comprehension / Passage Patterns ─────────────────────────────────────────

/**
 * Detects instruction lines that introduce a comprehension / passage section.
 * Must reference "passage", "story", "text", "extract", etc. or say
 * "questions that follow" to avoid matching generic standalone-section instructions.
 */
const COMP_INSTRUCTION_RE = /\b(?:read\s+(?:the\s+)?(?:following|passage|story|text|extract|information|paragraph|article|poem|stories)|read\s+each\s+stor(?:y|ies)|answer\s+the\s+(?:following\s+)?questions?\s+(?:(?:that|which)\s+follow|from\s+(?:the\s+)?(?:passage|story|text|extract)|based\s+on\s+(?:the\s+)?(?:passage|story|text)|using\s+(?:the\s+)?(?:passage|story|text))|use\s+(?:the\s+)?(?:passage|text|story|information|extract)(?:\s+(?:above|below|to\s+answer))?|choose\s+(?:the\s+)?(?:correct|best|right)\s+(?:answer|option|word)\s+from\s+(?:the\s+)?(?:passage|text|story|extract)|based\s+on\s+(?:the\s+)?(?:passage|story|text|extract)|refer\s+to\s+(?:the\s+)?(?:passage|story|text|extract)|questions?\s+(?:that|which)\s+follow|stories?\s+with\s+questions?\s+on\s+each|look\s+at\s+the\s+questions?\s+(?:that|which)\s+follow|from\s+(?:the\s+)?(?:passage|story|text|extract)\s+(?:above|below)?)\b/i

/**
 * Detects lines that label a numbered story / passage block.
 * Examples: "Story 1", "Story 2:", "Passage A", "Passage B:", "Text 1: The Fox"
 */
const PASSAGE_LABEL_RE = /^(?:story|passage|text|extract|article|reading(?:\s+comprehension)?|comprehension)\s*(?:\d+|[IVX]+|[A-Z])?\s*(?:[:.,-]\s*.*)?$/i

function makeImportId(prefix = 'import') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([a-z0-9])([.?!:;])([A-Z])/g, '$1$2 $3')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitLines(text) {
  return cleanText(text)
    .split(/\r?\n/)
    .map(line => cleanText(line))
    .filter(Boolean)
}

function normalizeParaOrderInstruction(text) {
  return cleanText(text)
    .replace(/^instruction\s*:\s*/i, '')
    .trim()
}

function deriveParaOrderQuestionText(instruction) {
  const normalized = normalizeParaOrderInstruction(instruction)
  const sentences = normalized
    .split(/(?<=[.?!])\s+/)
    .map(sentence => cleanText(sentence))
    .filter(Boolean)

  const bestSentence = sentences.find(sentence => /\bchoose\b/i.test(sentence))
    || sentences[sentences.length - 1]
    || normalized

  return cleanText(
    bestSentence
      .replace(/^you must\s+/i, '')
      .replace(/^for each question,?\s*/i, ''),
  ) || 'Choose the paragraph with the sentences in the best order.'
}

function parseParaOrderOptionLine(line) {
  const text = cleanText(line)
  const punctuated = text.match(/^([A-D])[\).:\-]\s*(.+)$/)
  const glued = text.match(/^([A-D])([A-Z].+)$/)
  const label = (punctuated?.[1] || glued?.[1] || '').toUpperCase()
  if (!label) return null

  const optionText = cleanText(punctuated?.[2] || glued?.[2] || '')
  if (!optionText) return null

  return { label, text: optionText }
}

function parseRawParaOrderOptionLine(line) {
  const text = cleanText(String(line || '').replace(/\n+/g, ' '))
  const match = text.match(/^([A-D])(?:[\).:\-]\s*|)(.+)$/)
  const label = (match?.[1] || '').toUpperCase()
  const optionText = cleanText(match?.[2] || '')
  if (!label || !optionText) return null
  return { label, text: optionText }
}

function optionOnlyQuestionMatch(line) {
  const text = cleanText(line)
  const match = text.match(/^(\d{1,3})\s*[\).:\-]\s*(.+)$/)
  if (!match) return null

  const optionText = cleanText(match[2])
  const options = extractOptionSegments(optionText)
  if (!options.length || options[0].labelStart > 2) return null

  return {
    number: match[1],
    options: options.map(option => option.text),
  }
}

/**
 * Conservative section-heading detector.
 *
 * Previously this matched ANY all-caps line with 8+ characters, which caused
 * story titles like "THE CLEVER MONKEY" to be treated as section breaks and
 * discarded, cutting off comprehension passages.
 *
 * Now it only matches:
 *  - Named word-game / round headings (SECTION_HEADING_RE)
 *  - Structural document markers: "SECTION A", "PART 1", "UNIT 3"
 */
function isSectionHeading(text) {
  const line = cleanText(text)
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
  return QUESTION_RANGE_HEADING_RE.test(cleanText(line))
}

function isStandaloneInstruction(line) {
  const text = cleanText(line)
  if (!text) return false
  if (questionMatch(text)) return false
  if (extractOptionSegments(text).length) return false
  if (ANSWER_KEY_HEADING_RE.test(text)) return false
  if (isComprehensionInstruction(text)) return false
  return STANDALONE_INSTRUCTION_RE.test(text)
}

function questionMatch(line) {
  const numbered = line.match(QUESTION_RE) || line.match(QUESTION_NO_PUNCT_RE)
  if (!numbered) return null
  const text = cleanText(numbered[2])
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

  const firstPrefix = cleanText(text.slice(0, matches[0].labelStart)).toLowerCase()
  const startsAsOptionLine = matches[0].labelStart <= 2 || /^(options?|choices?)[:\-]?$/.test(firstPrefix)
  const hasQuestionThenInlineOptions = firstPrefix.length >= 8 && matches.length >= 2
  if (!startsAsOptionLine && !hasQuestionThenInlineOptions) return []

  return matches
    .map((item, index) => {
      const next = matches[index + 1]
      return {
        ...item,
        text: cleanText(text.slice(item.valueStart, next ? next.labelStart : text.length)),
      }
    })
    .filter(item => item.index >= 0 && item.index <= 3 && item.text)
}

function splitInlineOptionsFromQuestion(rawText, fallbackQuestionText = '') {
  const text = cleanText(rawText)
  const options = extractOptionSegments(text)
  if (!options.length) return { text, options: [] }

  if (options[0].labelStart <= 2) {
    const fallback = cleanText(fallbackQuestionText)
    if (!fallback) return { text, options: [] }
    return { text: fallback, options }
  }

  const questionText = cleanText(text.slice(0, options[0].labelStart))
  if (questionText.length < 8 || options.length < 2) return { text, options: [] }

  return { text: questionText, options }
}

function titleFromFileName(name = '') {
  return String(name || 'Imported Quiz')
    .replace(/\.(docx?|pdf)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Imported Quiz'
}

function extensionFromPath(path = '') {
  return path.split('.').pop()?.toLowerCase() || ''
}

function normalizePath(path) {
  const parts = []
  path.split('/').forEach(part => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

function resolveTarget(baseDir, target) {
  if (!target) return ''
  if (/^https?:\/\//i.test(target)) return ''
  if (target.startsWith('/')) return normalizePath(target.slice(1))
  return normalizePath(`${baseDir}/${target}`)
}

function parseXml(xmlText, fileName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error(`Could not parse ${fileName}.`)
  return doc
}

function elementsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function descendantsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function attr(node, name) {
  if (!node) return ''
  return node.getAttribute(name) || node.getAttribute(`r:${name}`) || ''
}

function parseRelationships(zipEntries, relPath, baseDir) {
  const relBytes = zipEntries[relPath]
  if (!relBytes) return new Map()

  const relationships = new Map()
  const doc = parseXml(strFromU8(relBytes), relPath)
  elementsByLocalName(doc, 'Relationship').forEach(rel => {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) return
    relationships.set(id, {
      id,
      type: rel.getAttribute('Type') || '',
      target,
      path: resolveTarget(baseDir, target),
    })
  })
  return relationships
}

function makeImageAsset(bytesOrBlob, sourcePath, contentType, warnings) {
  const extension = extensionFromPath(sourcePath)
  const mime = contentType || IMAGE_MIME[extension]
  if (!mime || !Object.values(IMAGE_MIME).includes(mime)) {
    warnings.push(`Unsupported image skipped: ${sourcePath || 'unknown image'}.`)
    return null
  }

  const blob = bytesOrBlob instanceof Blob
    ? bytesOrBlob
    : new Blob([bytesOrBlob], { type: mime })
  const objectUrl = URL.createObjectURL(blob)
  const id = makeImportId('quiz-image')

  return {
    id,
    blob,
    objectUrl,
    imageUrl: objectUrl,
    contentType: mime,
    extension: extension || mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg',
    fileName: `${id}.${extension || 'jpg'}`,
    sourcePath,
  }
}

function paragraphText(paragraph) {
  const pieces = []
  ;(function walk(node) {
    Array.from(node?.childNodes || []).forEach(child => {
      if (child.nodeType !== 1) return
      if (child.localName === 't') {
        if (child.textContent) pieces.push(child.textContent)
        return
      }
      if (child.localName === 'tab') {
        // Preserve a real tab so we can detect tab-separated question /
        // option formats (`1\tStem`, `A\tAnswer`) before cleanText() strips
        // them. Replaced with a space inside normalizeTabbedQuestionLine().
        pieces.push('\t')
        return
      }
      if (child.localName === 'br' || child.localName === 'cr') {
        pieces.push('\n')
        return
      }
      walk(child)
    })
  })(paragraph)
  return normalizeTabbedQuestionLine(pieces.join(''))
}

// PRISCA / ECZ Word docs lay out questions in a 2-column table-less format:
//   `1\tWhich of the following...`  (no `.` or `)` after the number)
//   `A\tDifferent flowers`         (no `.` or `)` after the letter)
//
// Without this rewrite, only questions whose stem ends with `?` survive
// (via QUESTION_NO_PUNCT_RE), so any "Name the joint shown below." style
// stem would be silently dropped. We promote the tab into a `.` so the
// existing QUESTION_RE / OPTION_RE patterns match unchanged.
function normalizeTabbedQuestionLine(text) {
  let normalized = String(text || '')
  // `1\t…` → `1. …`
  normalized = normalized.replace(/^(\d{1,3})\t/gm, '$1. ')
  // `A\t…` → `A. …` (only single capital A-D at line start)
  normalized = normalized.replace(/^([A-Da-d])\t/gm, '$1. ')
  return cleanText(normalized)
}

/**
 * Returns the paragraph style value (e.g. "Heading1", "Normal") or empty string.
 * Used to detect document headings set via Word styles.
 */
function paragraphStyle(paragraph) {
  const pStyle = descendantsByLocalName(paragraph, 'pStyle')[0]
  return pStyle?.getAttribute('w:val') || ''
}

function paragraphHasNumbering(paragraph) {
  return descendantsByLocalName(paragraph, 'numPr').length > 0
}

function isLikelyDocxQuestionHeading(text, block) {
  if (!block?.numberedList) return false

  const line = cleanText(text)
  if (!line || isSectionHeading(line)) return false
  if (questionMatch(line)) return false
  if (ANSWER_RE.test(line) || EXPLANATION_RE.test(line)) return false
  if (/^(?:meaning|example|definition|sentence|clue|hint)\s*:/i.test(line)) return false
  if (!/[a-z]/i.test(line) || line.length > 120) return false

  const words = line.split(/\s+/)
  return /\b(noun|verb|adjective|adverb|pronoun|conjunction|preposition|interjection)\b/i.test(line)
    || words.length <= 6
}

function paragraphImages(paragraph, relationships, zipEntries, warnings) {
  const seen = new Set()
  return descendantsByLocalName(paragraph, 'blip')
    .map(blip => {
      const relId = attr(blip, 'embed') || attr(blip, 'link')
      const rel = relationships.get(relId)
      if (!rel?.path) {
        warnings.push('An image relationship could not be resolved.')
        return null
      }
      if (seen.has(rel.path)) return null
      seen.add(rel.path)
      const bytes = zipEntries[rel.path]
      if (!bytes) {
        warnings.push(`An image file was missing: ${rel.path}.`)
        return null
      }
      return makeImageAsset(bytes, rel.path, IMAGE_MIME[extensionFromPath(rel.path)], warnings)
    })
    .filter(Boolean)
}

function tableCellContent(cell, relationships, zipEntries, warnings) {
  const parts = []
  const assets = []

  Array.from(cell?.children || []).forEach(child => {
    if (child.localName === 'p') {
      const text = paragraphText(child)
      if (text) parts.push(text)
      const paragraphAssets = paragraphImages(child, relationships, zipEntries, warnings)
      if (paragraphAssets.length) assets.push(...paragraphAssets)
      return
    }

    if (child.localName === 'tbl') {
      const nestedText = descendantsByLocalName(child, 't')
        .map(node => cleanText(node.textContent))
        .filter(Boolean)
        .join('\n')
      if (nestedText) parts.push(nestedText)
    }
  })

  if (!parts.length && !assets.length) {
    const fallbackText = descendantsByLocalName(cell, 't')
      .map(node => cleanText(node.textContent))
      .filter(Boolean)
      .join('\n')
    if (fallbackText) parts.push(fallbackText)
  }

  return {
    text: parts.join('\n'),
    assets,
  }
}

function tableRows(table, relationships, zipEntries, warnings) {
  return Array.from(table?.children || [])
    .filter(child => child.localName === 'tr')
    .map(row => ({
      cells: Array.from(row.children || [])
        .filter(child => child.localName === 'tc')
        .map(cell => tableCellContent(cell, relationships, zipEntries, warnings)),
    }))
}

async function extractDocx(file) {
  const warnings = []
  const buffer = await file.arrayBuffer()
  const zipEntries = unzipSync(new Uint8Array(buffer))
  const documentBytes = zipEntries['word/document.xml']

  if (!documentBytes) {
    throw new Error('This .docx file does not contain a readable Word document body.')
  }

  const doc = parseXml(strFromU8(documentBytes), 'word/document.xml')
  const body = elementsByLocalName(doc, 'body')[0]
  const relationships = parseRelationships(zipEntries, 'word/_rels/document.xml.rels', 'word')
  const blocks = []
  const imageAssets = []

  Array.from(body?.children || []).forEach(child => {
    if (child.localName === 'p') {
      const assets = paragraphImages(child, relationships, zipEntries, warnings)
      imageAssets.push(...assets)
      const text = paragraphText(child)
      const style = paragraphStyle(child)
      const isHeading = /^heading\d*$/i.test(style)
      if (text || assets.length) {
        blocks.push({
          text,
          assets,
          source: 'docx',
          numberedList: paragraphHasNumbering(child),
          // Expose Word heading style so the parser can use it as a section signal
          headingStyle: isHeading ? style.toLowerCase() : null,
          styleVal: style,
        })
      }
      return
    }

    if (child.localName === 'tbl') {
      const rows = tableRows(child, relationships, zipEntries, warnings)
      const { blocks: tableBlocks, warnings: tableWarnings } = buildDocxTableBlocks(rows)
      if (tableBlocks.length) {
        blocks.push(...tableBlocks)
        imageAssets.push(...tableBlocks.flatMap(block => block.assets || []))
      }
      if (tableWarnings.length) warnings.push(...tableWarnings)
    }
  })

  return { blocks, imageAssets, warnings }
}

async function extractLegacyDoc(file) {
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder('windows-1252').decode(buffer)
  const cleaned = text
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
  return {
    blocks: splitLines(cleaned).map(line => ({ text: line, assets: [], source: 'doc' })),
    imageAssets: [],
    warnings: [
      'Legacy .doc extraction is best-effort. Save as .docx for better text and image extraction.',
      'Images from legacy .doc files could not be extracted in the browser.',
    ],
  }
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not render a PDF page image.')),
      type,
      quality,
    )
  })
}

/**
 * Groups PDF text items into logical lines using Y-coordinate proximity.
 * Threshold increased from 3 → 5 px to handle slight baseline variations
 * common in scanned or mixed-font PDFs.
 */
function textContentToLines(textContent) {
  const rows = []
  ;(textContent.items || []).forEach(item => {
    const str = cleanText(item.str)
    if (!str) return
    const transform = item.transform || []
    const x = Number(transform[4]) || 0
    const y = Math.round(Number(transform[5]) || 0)
    let row = rows.find(existing => Math.abs(existing.y - y) <= 5)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push({ x, str })
  })

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => cleanText(row.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' ')))
    .filter(Boolean)
}

async function renderPdfPageSnapshot(page, pageNumber, warnings) {
  try {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1.8, 1100 / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })
    await page.render({ canvasContext: context, viewport }).promise
    const blob = await canvasToBlob(canvas)
    return makeImageAsset(blob, `pdf-page-${pageNumber}.jpg`, 'image/jpeg', warnings)
  } catch (error) {
    warnings.push(`Could not create an image snapshot for PDF page ${pageNumber}.`)
    return null
  }
}

async function extractPdf(file) {
  const warnings = [
    'PDF import extracts text and attaches page snapshots to diagram-style questions. Review cropping before publishing.',
  ]
  const buffer = await file.arrayBuffer()
  const pdfjsLib = await loadPdfjs()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const blocks = []
  const imageAssets = []
  const maxSnapshotPages = 25

  if (pdf.numPages > maxSnapshotPages) {
    warnings.push(`Only the first ${maxSnapshotPages} PDF pages were considered for diagram snapshots.`)
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lines = textContentToLines(textContent)
    const pageText = lines.join('\n')

    // Only snapshot truly image-only pages (no extractable text) or pages
    // with explicit diagram/figure references. Using < 50 instead of < 180
    // prevents false-positives on pages with short but valid text content.
    const hasNoText = pageText.length < 50
    const hasImageHint = IMAGE_HINT_RE.test(pageText)
    const shouldSnapshot = pageNumber <= maxSnapshotPages && (hasNoText || hasImageHint)
    const pageAsset = shouldSnapshot ? await renderPdfPageSnapshot(page, pageNumber, warnings) : null
    if (pageAsset) imageAssets.push(pageAsset)

    if (!lines.length && pageAsset) {
      blocks.push({
        text: '',
        assets: [pageAsset],
        pageAsset,
        pageNumber,
        source: 'pdf-image',
      })
      warnings.push(`PDF page ${pageNumber} looked image-based. Review the imported diagram question before publishing.`)
      continue
    }

    lines.forEach(line => {
      blocks.push({
        text: line,
        assets: [],
        pageAsset,
        pageNumber,
        source: 'pdf',
      })
    })
  }

  return { blocks, imageAssets, warnings }
}

function metadataFromText(text, fileName) {
  const firstLines = splitLines(text).slice(0, 8)
  const title = firstLines.find(line => line.length > 6 && !questionMatch(line) && !OPTION_RE.test(line)) || titleFromFileName(fileName)
  // Support grades 1-12 (was previously restricted to 4-6, missing Grade 7+)
  const gradeMatch = text.match(/\bgrade\s*(\d{1,2})\b/i)
  const grade = gradeMatch ? gradeMatch[1] : ''
  const headerText = [title, ...firstLines].join(' ')
  const subject = SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(headerText))
    || SUBJECTS.find(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
    || ''
  return {
    title: cleanText(title).slice(0, 90) || titleFromFileName(fileName),
    grade,
    subject,
    topic: cleanText(title).slice(0, 80),
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
  const answer = cleanText(rawAnswer)
  if (!answer) return null
  const letter = answer.match(/^[A-D]/i)?.[0]?.toUpperCase()
  if (letter) {
    const index = letter.charCodeAt(0) - 65
    return index >= 0 && index < options.length ? index : null
  }
  const normalized = answer.toLowerCase()
  const exactIndex = options.findIndex(option => cleanText(option).toLowerCase() === normalized)
  if (exactIndex >= 0) return exactIndex
  const containedIndex = options.findIndex(option =>
    cleanText(option).toLowerCase().includes(normalized) ||
    normalized.includes(cleanText(option).toLowerCase()),
  )
  return containedIndex >= 0 ? containedIndex : null
}

function questionFromCurrent(current, answerKey = new Map()) {
  if (!current) return null

  const reviewNotes = [...current.reviewNotes]
  const text = cleanText(current.textParts.join(' '))
  const sharedInstruction = cleanText(current.sharedInstruction)
  const options = current.options.map(cleanText).filter(Boolean)
  const imageHint = IMAGE_HINT_RE.test(`${text} ${current.diagramText}`)
  const assets = current.assets.length ? current.assets : imageHint && current.pageAsset ? [current.pageAsset] : []
  const firstAsset = assets[0] || null
  const lowerOptions = options.map(option => option.toLowerCase())
  const isTrueFalse = options.length === 2 && lowerOptions.includes('true') && lowerOptions.includes('false')

  let type = 'short_answer'
  const answerRaw = cleanText(current.answerRaw || (current.sourceNumber ? answerKey.get(String(current.sourceNumber)) : ''))
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
    explanation: cleanText(current.explanationParts.join(' ')),
    topic: '',
    marks: marksMatch ? Math.max(1, Number(marksMatch[1]) || 1) : 1,
    type,
    detectedType: type,
    imageUrl: firstAsset?.imageUrl || '',
    imageAssetId: firstAsset?.id || '',
    diagramText: firstAsset
      ? cleanText(current.diagramText || `Imported image from ${firstAsset.sourcePath || 'document'}.`)
      : cleanText(current.diagramText),
    requiresReview: reviewNotes.length > 0,
    reviewNotes,
    importWarnings: reviewNotes,
    sourcePage: current.pageNumber || null,
    sourceQuestionNumber: current.sourceNumber || null,
    imageUploading: false,
    imageUploadStep: '',
  }
}

/**
 * Main document parser — comprehension-aware state machine.
 *
 * The parser distinguishes three document regions:
 *  1. Preamble / metadata — discarded (title, grade, subject lines)
 *  2. Comprehension blocks — instruction + passage text + numbered sub-questions
 *  3. Standalone questions — numbered MCQ / short-answer / diagram questions
 *
 * Comprehension mode is triggered whenever a line matches COMP_INSTRUCTION_RE
 * (e.g. "Read the following passage and answer the questions that follow.").
 * Inside comprehension mode:
 *  - All-caps or labelled passage headings (Story 1, Passage A) set the title.
 *  - Non-question text accumulates as passage paragraphs.
 *  - Numbered question lines start sub-questions linked to the passage.
 *  - Seeing another instruction line OR a major section heading finalises the
 *    current comprehension block and may start a new one.
 *
 * Multiple passages in one document (Story 1, Story 2, Story 3) each become
 * their own comprehension block.
 */

// ─── Paragraph-Ordering Preprocessor ─────────────────────────────────────────

/**
 * Converts "paragraph ordering" question blocks into standard numbered MCQ
 * blocks before the main parser runs.
 *
 * In this format A–D options are full multi-sentence paragraphs. The option
 * boundaries are encoded as a single capital letter appended directly to the
 * last sentence of the preceding option:
 *
 *   "People die within a short period after catching it.B"   ← end opt A
 *   "Therefore, all the people must protect themselves.C"    ← end opt B
 *   "...many lives.40A"                                      ← end Q39, start Q40
 *
 * The very first question in the section is signalled by
 * "Now do questions 39-43" text in the same line as "39A".
 *
 * Output: blocks whose text is in standard "N. question\nA. opt\nB. opt\n..."
 * format, which the main parser handles normally as MCQ questions.
 */
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
    const text = cleanText(block.text)
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

/**
 * Parses accumulated para-ordering lines into standard question blocks.
 * Handles three transition signals:
 *  1. "now do questions N"        → start question N, option A (first Q only)
 *  2. line ends with [punct][B-D] → option boundary
 *  3. line ends with [punct][N]A  → end of option D, start of question N
 */
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
    const text = cleanText(line)
    if (!text) continue

    if (/^example$/i.test(text) || /^the answer is\b/i.test(text)) continue

    // ── Signal 1: "Now do questions N" — locates the first question ──────────
    const doQMatch = text.match(PARA_ORDER_DO_Q_RE)
    if (doQMatch) {
      const inlineStart = text.match(/(\d{1,3})\s*A(?:[\).:\-]\s*|\s+)?(.*)$/)
      if (inlineStart) {
        startQuestion(inlineStart[1], block)
        currentOpt = 'A'
        const optionText = cleanText(inlineStart[2])
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
      const optionText = cleanText(inlineQuestionOption[3])
      if (optionText) optTexts[currentOpt].push(optionText)
      continue
    }

    // ── Signal 3: line ends with [punct][digits]A → Q boundary ──────────────
    // e.g. "...many lives.40A" or "...coming back.43A"
    // We require punctuation before the number to avoid false positives.
    const nextQMatch = text.match(/^(.*[.!?'"\u2019\u201d])\s*(\d{1,3})A\s*$/)
    if (nextQMatch && qNum) {
      const textBefore = nextQMatch[1].trim()
      const newQNum = nextQMatch[2]
      if (currentOpt && textBefore) optTexts[currentOpt].push(textBefore)
      startQuestion(newQNum, block)
      continue
    }

    if (!qNum) continue // still in preamble / example — skip

    const optionMatch = parseRawParaOrderOptionLine(text)
    if (optionMatch) {
      currentOpt = optionMatch.label
      optTexts[currentOpt].push(optionMatch.text)
      continue
    }

    // ── Regular sentence line — add to current option ────────────────────────
    if (currentOpt) optTexts[currentOpt].push(text)
  }

  flushQuestion()
  return output
}

function normalizeOptionOnlyQuestionBlock(block, instruction) {
  const text = cleanText(String(block.text || '').replace(/\n+/g, ' '))
  const match = text.match(/^(\d{1,3})\s*[\).:\-]\s*(.+)$/)
  if (!match) return null

  const optionSegments = extractOptionSegments(cleanText(match[2]))
  if (!optionSegments.length || optionSegments[0].labelStart > 2) return null

  const questionText = cleanText(instruction || 'Choose the correct answer.')
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
    const text = cleanText(block.text)
    const singleLineText = cleanText(String(block.text || '').replace(/\n+/g, ' '))
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
      currentInstruction = singleLineText.replace(/^instruction\s*:\s*/i, '')
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

  // ── Comprehension state ───────────────────────────────────────────────────
  let compActive = false        // currently inside a comprehension section
  let compInstructions = []     // instruction text lines collected
  let compTitle = ''            // current passage label (e.g. "Story 1")
  let compPassageParts = []     // narrative / passage paragraph lines
  let compSubQuestions = []     // finalized sub-questions for current passage

  // ── Per-question state ────────────────────────────────────────────────────
  let current = null            // question object currently being assembled

  // ── Helpers ───────────────────────────────────────────────────────────────

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
    const block = {
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
      marks: Math.max(1, compSubQuestions.reduce((s, q) => s + (q.marks || 1), 0)),
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
    }
    questions.push(block)
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
    if (isSubQuestion) {
      finalizeSubQuestion()
    } else {
      finalizeStandaloneQuestion()
    }
    const inline = splitInlineOptionsFromQuestion(
      text,
      !isSubQuestion ? sharedInstruction : '',
    )
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
    }
    inline.options.forEach(opt => { current.options[opt.index] = opt.text })
    pendingAssets = []
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  blocks.forEach(block => {
    const lines = splitLines(block.text)

    if (!lines.length && block.assets?.length) {
      if (current) current.assets.push(...block.assets)
      else pendingAssets.push(...block.assets)
      return
    }

    lines.forEach((line, lineIndex) => {
      const lineAssets = lineIndex === 0 ? (block.assets || []) : []

      // ── Answer key section ──────────────────────────────────────────────
      if (ANSWER_KEY_HEADING_RE.test(line)) {
        finalizeComprehension()
        finalizeStandaloneQuestion()
        inAnswerKey = true
        sharedInstruction = ''
        return
      }
      if (inAnswerKey) {
        ANSWER_KEY_PAIR_RE.lastIndex = 0
        if (ANSWER_KEY_PAIR_RE.test(line) || /^[\d\sA-D).:\-]+$/i.test(line)) return
        // If we see a fresh instruction or section heading, leave answer-key mode
        if (isComprehensionInstruction(line) || isSectionHeading(line)) {
          inAnswerKey = false
          // fall through to process the line normally
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
      const explicitInstruction = /^instruction\s*:/i.test(line)

      // ══════════════════════════════════════════════════════════════════════
      // COMPREHENSION MODE
      // ══════════════════════════════════════════════════════════════════════
      if (compActive) {

        // New instruction line — could begin a new passage section
        if (isInstruction && !detectedQuestion) {
          if (compPassageParts.length > 0 || compSubQuestions.length > 0 || current) {
            // Finalise what we have and start fresh
            finalizeComprehension()
            compActive = true
          }
          compInstructions.push(line)
          return
        }

        // Passage label (Story 1, Story 2, Passage A, …) inside comprehension
        if (isPassLabel && !detectedQuestion) {
          if (compPassageParts.length > 0 || compSubQuestions.length > 0 || current) {
            // New story within same section — push current passage, start new
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
          compTitle = cleanText(line)
          return
        }

        if (isQuestionRangeHeading(line) && !detectedQuestion) {
          return
        }

        // Major section break exits comprehension mode entirely
        if (isSectionBreak && !isInstruction) {
          finalizeComprehension()
          if (lineAssets.length) pendingAssets.push(...lineAssets)
          return
        }

        // Numbered question inside comprehension → sub-question
        if (detectedQuestion) {
          startQuestion(detectedQuestion.text, { ...block, assets: lineAssets }, detectedQuestion.number, true)
          return
        }

        // Inside an active sub-question
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
          if (imageOnlyHint && !current.diagramText) current.diagramText = line
          // Extra text after options → treat as explanation continuation
          if (current.options.length && !/\?$/.test(line)) {
            current.explanationParts.push(line)
          } else {
            current.textParts.push(line)
          }
          return
        }

        // No active sub-question → this is passage / story text
        if (line.length >= 10 && !ANSWER_KEY_HEADING_RE.test(line)) {
          compPassageParts.push(line)
        }
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      // ══════════════════════════════════════════════════════════════════════
      // NON-COMPREHENSION MODE
      // ══════════════════════════════════════════════════════════════════════

      if (explicitInstruction && !detectedQuestion) {
        finalizeStandaloneQuestion()
        sharedInstruction = cleanText(line).replace(/^instruction\s*:\s*/i, '')
        return
      }

      // Instruction line → enter comprehension mode
      if (isInstruction && !detectedQuestion) {
        finalizeStandaloneQuestion()
        sharedInstruction = ''
        compActive = true
        compInstructions.push(line)
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      // Section heading → finish current question, stay in standalone mode
      if (isSectionBreak || isPassLabel) {
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        finalizeStandaloneQuestion()
        sharedInstruction = ''
        return
      }

      if (isStandaloneInstruction(line) && !detectedQuestion) {
        finalizeStandaloneQuestion()
        sharedInstruction = cleanText(line).replace(/^instruction\s*:\s*/i, '')
        return
      }

      if (isQuestionRangeHeading(line) && !detectedQuestion) {
        return
      }

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

      // Numbered question
      if (detectedQuestion) {
        startQuestion(detectedQuestion.text, { ...block, assets: lineAssets }, detectedQuestion.number, false)
        return
      }

      // Docx word-list numbered items (spelling/vocabulary)
      if (isLikelyDocxQuestionHeading(line, block)) {
        startQuestion(line, { ...block, assets: lineAssets }, null, false)
        current.reviewNotes.push('Word list numbering was inferred for this question. Review wording before publishing.')
        return
      }

      // Un-numbered question ending with ?
      if (!current && /\?$/.test(line)) {
        startQuestion(line, { ...block, assets: lineAssets }, null, false)
        current.reviewNotes.push('Question number was not found.')
        return
      }

      // Nothing active — preamble / metadata text
      if (!current) {
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      // Continuing a standalone question
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
        current.options[current.lastOptionIndex] = cleanText(
          [current.options[current.lastOptionIndex], line].filter(Boolean).join(' '),
        )
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

  // ── Flush any pending state ───────────────────────────────────────────────
  if (compActive) {
    finalizeComprehension()
  } else {
    finalizeStandaloneQuestion()
  }

  // ── Fallback — nothing was parsed ─────────────────────────────────────────
  if (!questions.length) {
    const fallbackText = cleanText(blocks.map(b => b.text).join('\n')).slice(0, 1200)
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
      diagramText: fallbackAsset
        ? `Imported image from ${fallbackAsset.sourcePath || 'document'}.`
        : '',
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

function buildImportedSections(questions = []) {
  return questions.map(question => {
    if (question.type === 'comprehension' || question.detectedType === 'comprehension') {
      return createPassageSection({
        title: question.passageTitle ?? '',
        instructions: question.instructions ?? question.text ?? '',
        passageText: question.passage ?? '',
        imageUrl: question.imageUrl ?? '',
        questions: (question.subQuestions || []).map(subQuestion => ({
          ...subQuestion,
          type: 'mcq',
          detectedType: 'mcq',
          passageId: null,
        })),
      })
    }

    return createStandaloneSection(question)
  })
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

export async function importQuizDocument(file) {
  if (!file) throw new Error('Choose a Word or PDF file first.')

  const lowerName = file.name.toLowerCase()
  let extracted

  if (lowerName.endsWith('.docx')) {
    extracted = await extractDocx(file)
  } else if (lowerName.endsWith('.doc')) {
    extracted = await extractLegacyDoc(file)
  } else if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    extracted = await extractPdf(file)
  } else {
    throw new Error('Please upload a .doc, .docx, or .pdf file.')
  }

  const { processedBlocks, questions, sections, parts, summary } = processImportedQuestionBlocks(
    extracted.blocks,
    extracted.warnings,
  )
  const metadata = buildImportMetadata(
    processedBlocks.map(block => block.text).join('\n'),
    file.name,
  )
  const importStatus = summary.needsReview > 0 || extracted.warnings.length
    ? 'needs_review'
    : 'success'

  return {
    quiz: {
      ...metadata,
      mode: 'imported_document',
      importStatus,
      sourceFileName: file.name,
      sourceContentType: file.type || (
        lowerName.endsWith('.pdf') ? 'application/pdf'
          : lowerName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/msword'
      ),
      importWarnings: extracted.warnings,
    },
    sections,
    parts: parts || [],
    questions,
    imageAssets: extracted.imageAssets,
    importStatus,
    warnings: extracted.warnings,
    summary,
  }
}

export function revokeImportedQuizAssets(assets = {}) {
  Object.values(assets).forEach(asset => {
    if (asset?.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })
}
