// Comprehension passage grouping.
//
// Reading-comprehension papers (ECZ / CBC English) frequently lay out *all*
// the passages first ("Text 1", "Text 2", "Text 3") and then a single shared
// block of questions ("Now do questions 46 – 60"). The deterministic importer
// attaches that whole question run to the LAST passage it saw, leaving the
// earlier passages with zero questions — the "Text 3 shows 15 questions, Text 1
// and Text 2 show 0" bug.
//
// This module reattaches each question to the passage it actually refers to by
// keyword overlap (question stem + options + explanation vs the passage text /
// title), weighted so a word that appears in only one passage ("Kaulu",
// "semiaquatic", "netball") counts for far more than a word common to all of
// them. It is intentionally framework-free (no React, no Firebase) so the
// parser, the editor, and the node test scripts can all import it.

// Common English words that carry no discriminating signal for matching a
// question to its passage. Also folds in comprehension scaffolding words
// ("according", "passage", "question", …) that appear in nearly every stem.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
  'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'its', 'let',
  'put', 'say', 'she', 'too', 'use', 'that', 'this', 'with', 'from', 'they',
  'have', 'what', 'when', 'which', 'their', 'there', 'were', 'will', 'your',
  'about', 'would', 'these', 'those', 'other', 'into', 'than', 'then', 'them',
  'some', 'such', 'only', 'also', 'been', 'being', 'over', 'most', 'more',
  'because', 'answer', 'answers', 'question', 'questions', 'according', 'text',
  'passage', 'story', 'stories', 'following', 'word', 'words', 'means',
  'meaning', 'correct', 'best', 'right', 'option', 'options', 'choose', 'below',
  'above', 'give', 'given', 'gives', 'says', 'said', 'each', 'using', 'refer',
  'sentence', 'paragraph', 'true', 'false', 'why', 'where', 'whom', 'whose',
])

function tiptapToText(node) {
  if (!node || typeof node !== 'object') return ''
  let out = ''
  if (typeof node.text === 'string') out += `${node.text} `
  if (Array.isArray(node.content)) {
    for (const child of node.content) out += `${tiptapToText(child)} `
  }
  return out
}

// Coerce any of the rich-text shapes the codebase uses into plain text:
// Tiptap JSON object, stringified Tiptap doc, HTML string, or plain string.
export function toPlainText(value) {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (value.type === 'doc' || Array.isArray(value.content) || typeof value.text === 'string') {
      return tiptapToText(value)
    }
    return ''
  }
  const str = String(value)
  const trimmed = str.trim()
  if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') return tiptapToText(parsed)
    } catch {
      // Not JSON after all — treat as HTML / plain text below.
    }
  }
  return str.replace(/<[^>]+>/g, ' ')
}

// Tokenise a value into de-duplicated lowercase keyword tokens, dropping
// stopwords, bare numbers, and tokens shorter than 3 characters.
export function extractKeywords(value) {
  const text = toPlainText(value).toLowerCase()
  const tokens = text.replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
  const seen = new Set()
  const out = []
  for (const tok of tokens) {
    if (tok.length < 3) continue
    if (/^\d+$/.test(tok)) continue
    if (STOPWORDS.has(tok)) continue
    if (seen.has(tok)) continue
    seen.add(tok)
    out.push(tok)
  }
  return out
}

// All the keyword sources for a single question: stem + options + explanation
// (+ topic). Options matter because the answer wording often echoes the
// passage ("calabashes", "hatchlings") even when the stem is generic.
export function keywordsForQuestion(question = {}) {
  const parts = [
    toPlainText(question.text),
    toPlainText(question.explanation),
    String(question.topic ?? ''),
  ]
  const options = Array.isArray(question.options) ? question.options : []
  for (const option of options) parts.push(toPlainText(option))
  return extractKeywords(parts.join(' \n '))
}

// Assign each question to the passage it best matches.
//
// @param passageKeywordLists  string[][] — keywords for each passage (title + text)
// @param questionKeywordLists string[][] — keywords for each question, in document order
// @returns number[] — passage index assigned to each question (same order/length as input)
//
// Scoring: a question scores against passage i the sum, over its keywords that
// appear in passage i, of 1/df(keyword) where df is the number of passages
// containing that keyword. A keyword unique to one passage scores 1; a keyword
// shared by every passage scores 1/P. Questions with no overlap at all inherit
// the previous confidently-matched passage (keeps contiguous runs together),
// seeded by a proportional position so a leading no-signal question still lands
// somewhere sensible.
export function assignByKeywords(passageKeywordLists = [], questionKeywordLists = []) {
  const passageCount = passageKeywordLists.length
  if (passageCount === 0) return questionKeywordLists.map(() => 0)
  const passageSets = passageKeywordLists.map(list => new Set(list))

  const df = new Map()
  for (const set of passageSets) {
    for (const kw of set) df.set(kw, (df.get(kw) || 0) + 1)
  }
  const weightOf = kw => {
    const d = df.get(kw)
    return d ? 1 / d : 0
  }

  const total = questionKeywordLists.length
  const assignments = []
  let lastConfident = null
  questionKeywordLists.forEach((qkws, idx) => {
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < passageCount; i += 1) {
      let score = 0
      for (const kw of qkws) {
        if (passageSets[i].has(kw)) score += weightOf(kw)
      }
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestScore > 0) {
      lastConfident = bestIdx
      assignments.push(bestIdx)
    } else if (lastConfident !== null) {
      assignments.push(lastConfident)
    } else {
      const proportional = Math.min(passageCount - 1, Math.floor((idx * passageCount) / (total || 1)))
      assignments.push(proportional)
    }
  })
  return assignments
}

// Reattach a pool of questions across a set of passages by keyword match.
//
// @param passages  [{ title, text }]  — passage descriptors, in document order
// @param questions [question]         — questions to distribute, in document order
// @returns number[] — buckets[i] is the passage index each question is assigned to
export function matchQuestionsToPassages(passages = [], questions = []) {
  const passageKeywordLists = passages.map(p =>
    extractKeywords(`${p.title ?? ''} \n ${toPlainText(p.text)}`))
  const questionKeywordLists = questions.map(keywordsForQuestion)
  return assignByKeywords(passageKeywordLists, questionKeywordLists)
}

// ── Editor sections adapter ────────────────────────────────────────────────

function isComprehensionPassageSection(section) {
  return Boolean(
    section
    && section.kind === 'passage'
    && section.passage
    && (section.passage.passageKind ?? 'comprehension') !== 'map',
  )
}

function questionOrderKey(question, fallback) {
  const candidates = [question?.sourceQuestionNumber, question?.order, question?.questionNumber]
  for (const candidate of candidates) {
    const num = Number(candidate)
    if (Number.isFinite(num) && num > 0) return num
  }
  return fallback
}

// Redistribute one maximal run of consecutive comprehension passage sections.
// Returns a new array of sections (same length/order) or null if nothing moved.
function redistributeSectionRun(run) {
  const passages = run.map(section => ({
    title: section.passage?.title ?? '',
    text: section.passage?.passageText ?? '',
  }))

  // Flatten every question in the run, remembering document order.
  const pool = []
  run.forEach((section, passageIndex) => {
    ;(section.passage?.questions || []).forEach(question => {
      pool.push({ question, passageIndex, orderKey: questionOrderKey(question, pool.length + 1) })
    })
  })
  if (pool.length === 0) return null

  const assignments = matchQuestionsToPassages(passages, pool.map(entry => entry.question))

  const buckets = run.map(() => [])
  pool.forEach((entry, idx) => {
    const target = assignments[idx] ?? entry.passageIndex
    buckets[target].push(entry)
  })

  // Nothing actually moved — every question is still in its original passage.
  const moved = pool.some((entry, idx) => (assignments[idx] ?? entry.passageIndex) !== entry.passageIndex)
  if (!moved) return null

  return run.map((section, passageIndex) => {
    const ordered = [...buckets[passageIndex]].sort((a, b) => a.orderKey - b.orderKey)
    const passageId = section.passage?.id ?? section.id
    return {
      ...section,
      passage: {
        ...section.passage,
        questions: ordered.map(entry => ({
          ...entry.question,
          passageId,
          partId: section.partId ?? entry.question.partId ?? null,
        })),
      },
    }
  })
}

// Auto-group every comprehension run in an editor `sections[]` array.
// Returns `{ sections, changed }`. Pure: never mutates the input.
export function regroupComprehensionSections(sections = []) {
  const result = [...sections]
  let changed = false
  let i = 0
  while (i < result.length) {
    if (!isComprehensionPassageSection(result[i])) {
      i += 1
      continue
    }
    let j = i
    while (j < result.length && isComprehensionPassageSection(result[j])) j += 1
    if (j - i >= 2) {
      const regrouped = redistributeSectionRun(result.slice(i, j))
      if (regrouped) {
        for (let k = 0; k < regrouped.length; k += 1) result[i + k] = regrouped[k]
        changed = true
      }
    }
    i = j
  }
  return { sections: result, changed }
}

// Move a single question from one passage section to another (the manual
// "Linked passage" dropdown). Returns a new sections array; the question keeps
// its identity (localId / _id) and is appended to the destination passage,
// then the destination is re-sorted by original question number so numbering
// stays monotonic. Pure: never mutates the input.
export function moveQuestionToPassage(sections = [], fromSectionId, questionLocalId, toSectionId) {
  if (!fromSectionId || !toSectionId || fromSectionId === toSectionId) return sections
  const fromSection = sections.find(s => s.id === fromSectionId)
  const toSection = sections.find(s => s.id === toSectionId)
  if (!fromSection || !toSection || fromSection.kind !== 'passage' || toSection.kind !== 'passage') {
    return sections
  }
  const moving = (fromSection.passage?.questions || []).find(q =>
    (q.localId || q._id) === questionLocalId)
  if (!moving) return sections

  const toPassageId = toSection.passage?.id ?? toSection.id
  const relocated = {
    ...moving,
    passageId: toPassageId,
    partId: toSection.partId ?? moving.partId ?? null,
  }

  return sections.map(section => {
    if (section.id === fromSectionId) {
      return {
        ...section,
        passage: {
          ...section.passage,
          questions: (section.passage?.questions || []).filter(q =>
            (q.localId || q._id) !== questionLocalId),
        },
      }
    }
    if (section.id === toSectionId) {
      const next = [...(section.passage?.questions || []), relocated]
      next.sort((a, b) => questionOrderKey(a, 0) - questionOrderKey(b, 0))
      return {
        ...section,
        passage: { ...section.passage, questions: next },
      }
    }
    return section
  })
}

// Validation helper (import + pre-publish). Flags comprehension runs whose
// question distribution looks broken: a passage with zero questions sitting
// next to sibling passages that do have questions. Returns an array of
// `{ severity, message, passageIndex }`.
export function findComprehensionGroupingIssues(sections = []) {
  const issues = []
  let i = 0
  while (i < sections.length) {
    if (!isComprehensionPassageSection(sections[i])) {
      i += 1
      continue
    }
    let j = i
    while (j < sections.length && isComprehensionPassageSection(sections[j])) j += 1
    const run = sections.slice(i, j)
    if (run.length >= 2) {
      const counts = run.map(s => (s.passage?.questions || []).length)
      const total = counts.reduce((sum, n) => sum + n, 0)
      const empties = counts.filter(n => n === 0).length
      if (total > 0 && empties > 0) {
        issues.push({
          severity: 'error',
          message: `${empties} comprehension passage${empties === 1 ? '' : 's'} in this set ${empties === 1 ? 'has' : 'have'} no linked questions while others do — run "Auto-group comprehension questions" or move questions manually before publishing.`,
          runStart: i,
        })
      }
    }
    i = j
  }
  return issues
}
