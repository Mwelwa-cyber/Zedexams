import { unzipSync, strFromU8 } from 'fflate'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

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

const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})[\).:\-]\s+(.+)$/i
const OPTION_RE = /^(?:\(([A-D])\)|([A-D])\s*[\).:\-\]])\s+(.+)$/i
const OPTION_LABEL_RE = /(^|\s)(?:\(([A-D])\)|([A-D])\s*[\).:\-\]])\s*/gi
const ANSWER_RE = /^(?:answer|correct answer|ans|key)\s*[:\-]\s*(.+)$/i
const EXPLANATION_RE = /^(?:explanation|reason|because)\s*[:\-]\s*(.+)$/i
const IMAGE_HINT_RE = /\b(diagram|figure|picture|image|graph|chart|map|shown|label|observe|study the|look at)\b/i

function makeImportId(prefix = 'import') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
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

function extractOptionSegments(line) {
  const text = String(line || '')
  const matches = []
  OPTION_LABEL_RE.lastIndex = 0

  let match
  while ((match = OPTION_LABEL_RE.exec(text)) !== null) {
    const prefix = match[1] || ''
    const label = (match[2] || match[3] || '').toUpperCase()
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
  const hasQuestionThenInlineOptions = firstPrefix.includes('?') && matches.length >= 2
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

function splitInlineOptionsFromQuestion(rawText) {
  const text = cleanText(rawText)
  const options = extractOptionSegments(text)
  if (!options.length || options[0].labelStart <= 2) return { text, options: [] }

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
  descendantsByLocalName(paragraph, 't').forEach(node => {
    if (node.textContent) pieces.push(node.textContent)
  })
  descendantsByLocalName(paragraph, 'tab').forEach(() => pieces.push(' '))
  descendantsByLocalName(paragraph, 'br').forEach(() => pieces.push('\n'))
  return cleanText(pieces.join(' '))
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
      if (text || assets.length) blocks.push({ text, assets, source: 'docx' })
      return
    }

    if (child.localName === 'tbl') {
      const text = descendantsByLocalName(child, 't')
        .map(node => cleanText(node.textContent))
        .filter(Boolean)
        .join('\n')
      if (text) {
        blocks.push({ text, assets: [], source: 'docx-table' })
        warnings.push('A table was flattened into text. Review those questions before publishing.')
      }
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
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render a PDF page image.')), type, quality)
  })
}

function textContentToLines(textContent) {
  const rows = []
  ;(textContent.items || []).forEach(item => {
    const str = cleanText(item.str)
    if (!str) return
    const transform = item.transform || []
    const x = Number(transform[4]) || 0
    const y = Math.round(Number(transform[5]) || 0)
    let row = rows.find(existing => Math.abs(existing.y - y) <= 3)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push({ x, str })
  })

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' '))
    .map(cleanText)
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
    const shouldSnapshot = pageNumber <= maxSnapshotPages && (IMAGE_HINT_RE.test(pageText) || pageText.length < 180)
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
  const title = firstLines.find(line => line.length > 6 && !QUESTION_RE.test(line) && !OPTION_RE.test(line)) || titleFromFileName(fileName)
  const grade = text.match(/\bgrade\s*(4|5|6)\b/i)?.[1] || ''
  const subject = SUBJECTS.find(subject => new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) || ''
  return {
    title: cleanText(title).slice(0, 90) || titleFromFileName(fileName),
    grade,
    subject,
    topic: cleanText(title).slice(0, 80),
  }
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
  const containedIndex = options.findIndex(option => cleanText(option).toLowerCase().includes(normalized) || normalized.includes(cleanText(option).toLowerCase()))
  return containedIndex >= 0 ? containedIndex : null
}

function questionFromCurrent(current) {
  if (!current) return null

  const reviewNotes = [...current.reviewNotes]
  const text = cleanText(current.textParts.join(' '))
  const options = current.options.map(cleanText).filter(Boolean)
  const imageHint = IMAGE_HINT_RE.test(`${text} ${current.diagramText}`)
  const assets = current.assets.length ? current.assets : imageHint && current.pageAsset ? [current.pageAsset] : []
  const firstAsset = assets[0] || null
  const lowerOptions = options.map(option => option.toLowerCase())
  const isTrueFalse = options.length === 2 && lowerOptions.includes('true') && lowerOptions.includes('false')

  let type = 'short_answer'
  let correctAnswer = cleanText(current.answerRaw)

  if (imageHint || firstAsset) {
    type = 'diagram'
  } else if (isTrueFalse) {
    type = 'truefalse'
  } else if (options.length >= 2) {
    type = 'mcq'
  }

  if (type === 'mcq' || type === 'truefalse') {
    const index = parseAnswerIndex(current.answerRaw, options)
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
    imageUploading: false,
    imageUploadStep: '',
  }
}

function parseQuestionsFromBlocks(blocks, warnings) {
  const questions = []
  let current = null
  let pendingAssets = []

  function startQuestion(text, block) {
    const finalized = questionFromCurrent(current)
    if (finalized) questions.push(finalized)
    const inline = splitInlineOptionsFromQuestion(text)
    current = {
      textParts: [inline.text],
      options: [],
      answerRaw: '',
      explanationParts: [],
      reviewNotes: [],
      assets: [...pendingAssets, ...(block.assets || [])],
      pageAsset: block.pageAsset || null,
      pageNumber: block.pageNumber || null,
      diagramText: '',
      tableFlattened: block.source === 'docx-table',
    }
    inline.options.forEach(option => {
      current.options[option.index] = option.text
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
      const questionMatch = line.match(QUESTION_RE)
      const answerMatch = line.match(ANSWER_RE)
      const explanationMatch = line.match(EXPLANATION_RE)
      const optionSegments = extractOptionSegments(line)
      const imageOnlyHint = IMAGE_HINT_RE.test(line)

      if (questionMatch) {
        startQuestion(questionMatch[2], { ...block, assets: lineAssets })
        return
      }

      if (!current && /\?$/.test(line)) {
        startQuestion(line, { ...block, assets: lineAssets })
        current.reviewNotes.push('Question number was not found.')
        return
      }

      if (!current) {
        if (lineAssets.length) pendingAssets.push(...lineAssets)
        return
      }

      if (lineAssets.length) current.assets.push(...lineAssets)
      if (block.pageAsset && !current.pageAsset) current.pageAsset = block.pageAsset

      if (answerMatch) {
        current.answerRaw = answerMatch[1]
        return
      }

      if (explanationMatch) {
        current.explanationParts.push(explanationMatch[1])
        return
      }

      if (optionSegments.length) {
        optionSegments.forEach(option => {
          current.options[option.index] = option.text
        })
        return
      }

      if (imageOnlyHint && !current.diagramText) {
        current.diagramText = line
      }

      if (current.options.length && !/\?$/.test(line)) {
        current.explanationParts.push(line)
        current.reviewNotes.push('Extra text after options was treated as explanation.')
      } else {
        current.textParts.push(line)
      }
    })
  })

  const finalized = questionFromCurrent(current)
  if (finalized) questions.push(finalized)

  if (!questions.length) {
    const fallbackText = cleanText(blocks.map(block => block.text).join('\n')).slice(0, 1200)
    const fallbackAsset = blocks
      .flatMap(block => [...(block.assets || []), ...(block.pageAsset ? [block.pageAsset] : [])])
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

  const allText = extracted.blocks.map(block => block.text).join('\n')
  const metadata = metadataFromText(allText, file.name)
  const questions = parseQuestionsFromBlocks(extracted.blocks, extracted.warnings)
  const importStatus = questions.some(question => question.requiresReview) || extracted.warnings.length
    ? 'needs_review'
    : 'success'

  return {
    quiz: {
      ...metadata,
      mode: 'imported_document',
      importStatus,
      sourceFileName: file.name,
      sourceContentType: file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : lowerName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'),
      importWarnings: extracted.warnings,
    },
    questions,
    imageAssets: extracted.imageAssets,
    importStatus,
    warnings: extracted.warnings,
    summary: {
      questions: questions.length,
      images: questions.filter(question => question.imageAssetId).length,
      needsReview: questions.filter(question => question.requiresReview).length,
    },
  }
}

export function revokeImportedQuizAssets(assets = {}) {
  Object.values(assets).forEach(asset => {
    if (asset?.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  })
}
