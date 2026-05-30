// Reconciling the AI smart-import result with the deterministic parser.
//
// This module is deliberately free of any Vite-only imports (no `?url`
// asset imports, no pdfjs, no Firebase) so it can be unit-tested with plain
// `node` — see scripts/test-quiz-import-order.mjs. documentQuizImporter.js
// imports reconcileSmartSectionOrder from here.

// Signals that a source document carries the rich structure smart import
// exists to recover: stacked / inline fractions, vertical arithmetic,
// measurement units, math symbols, or a markdown-style table. A prose paper
// (English comprehension, social studies) has none of these.
//
// IMPORTANT: this is intentionally conservative on prose. Number RANGES like
// "Questions 26 – 30" or "Grade 6" must NOT register as rich structure, so
// the arithmetic clause requires an actual math operator (`= + × ÷ *`, never a
// hyphen / en-dash which doubles as a range separator) between two numbers.
const RICH_STRUCTURE_PATTERNS = [
  /\\frac\s*\{/, //                       LaTeX stacked fraction
  /\$[^$\n]+\$/, //                       $…$ inline math
  /\\\(|\\\[/, //                         \( … \) / \[ … \]
  /\[\[\s*vmath\b/i, //                   vertical-arithmetic token
  /\b\d+\s*\/\s*\d+\b/, //                literal fraction "1/2", "3 / 4"
  /[½¼¾⅓⅔⅛⅜⅝⅞√∑∏∫πθΣµΩ±×÷≤≥≠≈∞²³⁴⁵⁶⁷⁸⁹]/, // math glyphs / superscripts
  /\b\d+(?:\.\d+)?\s?(?:cm|mm|km|kg|mg|ml|°c|°f)\b/i, // measurement units
  /\bx\s*\^\s*\d/i, //                    x^2 style exponent
  /\d\s*[=+×÷*]\s*\d/, //                 arithmetic between two numbers
  /_{4,}|─{3,}|—{3,}/, //                 long rule under vertical arithmetic
]

export function documentHasRichStructure(text) {
  const s = String(text || '')
  if (!s) return false
  // A markdown table row ("| a | b |") with at least two pipes.
  if (s.split(/\r?\n/).some(line => (line.match(/\|/g) || []).length >= 2)) return true
  return RICH_STRUCTURE_PATTERNS.some(re => re.test(s))
}

// Decide whether to hand the document to the (non-deterministic) smart-import
// LLM at all. The deterministic parser is ground truth for ordering and, for
// plain prose papers, for content too — it never reorders questions or drops an
// option. Smart import ONLY adds value by recovering rich structure (fractions,
// vertical arithmetic, tables). So we only risk the LLM when:
//   1. the parser found no questions (nothing to lose), or
//   2. the parser flagged questions for review (missing option / unresolved
//      answer / flattened table — the LLM might do better), or
//   3. the document actually contains rich structure worth recovering.
//
// This is the fix for the recurring "English paper imports jumbled, a choice is
// missing" reports: a clean, complete parse of a prose paper now wins outright
// instead of being overwritten by an LLM re-read that can shuffle questions or
// merge/drop a long option.
export function shouldRunSmartImport(local, documentText) {
  const summary = local?.summary || {}
  const questions = summary.questions || 0
  if (!questions) return true
  if ((summary.needsReview || 0) > 0) return true
  return documentHasRichStructure(documentText)
}

// Normalise a question/section's text for content-matching between the AI
// smart-import result and the deterministic parser. Strips HTML, entities, a
// leading question number ("31." / "31)" / "31:"), punctuation and casing so
// that "31. Rephrase the underlined ..." and "Rephrase the underlined ..."
// compare as the same question regardless of light AI rewriting.
export function normalizeForMatch(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/^\s*\d+\s*[.)\].:]?\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A question's signature = its stem PLUS its option texts. Options matter
// because "number-only" past-paper questions (e.g. the punctuation and
// paragraph-ordering items) share an identical stem across a whole group —
// "Choose the sentence which is correctly punctuated." for Q26–Q30 — so the
// stem alone cannot tell them apart; only the options differ.
function questionSignature(q) {
  const stem = normalizeForMatch(q?.text)
  const opts = (q?.options || [])
    .map(o => normalizeForMatch(typeof o === 'string' ? o : o?.text))
    .join(' ')
  return `${stem} ${opts}`.trim()
}

// A signature used to match a smart section against a local one. Standalone
// sections key off the question; passage sections key off the title plus the
// first sub-question so two different comprehension passages don't collide.
export function sectionSignature(section) {
  if (!section) return ''
  if (section.kind === 'passage') {
    const title = normalizeForMatch(section.passage?.title)
    return `${title} ${questionSignature(section.passage?.questions?.[0])}`.trim()
  }
  return questionSignature(section.question)
}

// Similarity in [0,1]: exact normalised match scores 1, otherwise token-set
// Jaccard. Tolerates the AI lightly rewriting a stem while still recognising
// it as the same question.
export function matchScore(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter += 1
  return inter / (ta.size + tb.size - inter)
}

// Re-anchor AI smart-import sections to the deterministic parser's document
// order and carry the parser's part structure onto them.
//
// Why this exists: the deterministic parser (processImportedQuestionBlocks)
// always emits sections in true document order and is the ground truth for
// ordering. The smart import only adds value by recovering rich structure
// (fractions, vertical arithmetic, tables). But an LLM does NOT reliably
// preserve question order — it may return questions shuffled, group all the
// comprehension passages together, or split one question into two. Earlier
// reconciliation matched smart↔local sections *by position* (the Nth smart
// standalone == the Nth document standalone) and, when there were no named
// parts, used the raw AI order outright. Both assumptions break the moment the
// AI reorders, which is the recurring "questions jumbled / Q45 sitting at
// position 20, even the numbers are wrong" failure teachers reported.
//
// Instead we match each smart section to the parser section it represents *by
// content* and order the result by that section's document index. Smart
// sections with no confident local match (genuinely AI-recovered extras, e.g.
// a vertical-arithmetic question the flat parser dropped) are kept immediately
// after their AI predecessor so they don't scatter.
export function reconcileSmartSectionOrder(local, smartSections = []) {
  const localSections = Array.isArray(local?.sections) ? local.sections : []
  const localParts = local?.parts || []
  // Only keep parts that have an actual title. The deterministic parser creates
  // a blank-titled "default" part to carry the document-level instruction when
  // no explicit heading exists; keeping it would trip the "Every Part needs a
  // title" validation error.
  const namedLocalParts = localParts.filter(p => String(p.title ?? '').trim())
  const unnamedPartIds = new Set(
    localParts.filter(p => !String(p.title ?? '').trim()).map(p => p.id)
  )

  const localEntries = localSections.map((s, index) => ({
    index,
    kind: s.kind,
    sig: sectionSignature(s),
    partId: s.kind === 'passage' ? (s.partId ?? null) : (s.question?.partId ?? null),
    used: false,
  }))

  const MATCH_THRESHOLD = 0.5
  let prevKey = -1
  let fallbackBump = 0

  const decorated = smartSections.map((section, i) => {
    const sig = sectionSignature(section)
    let best = null
    let bestScore = 0
    for (const entry of localEntries) {
      if (entry.used || entry.kind !== section.kind) continue
      const score = matchScore(sig, entry.sig)
      if (score > bestScore) {
        bestScore = score
        best = entry
      }
    }
    let orderKey
    let rawPartId = null
    if (best && bestScore >= MATCH_THRESHOLD) {
      best.used = true
      orderKey = best.index
      rawPartId = best.partId
      prevKey = orderKey
      fallbackBump = 0
    } else {
      // Unmatched: keep adjacent to the AI predecessor (small positive bump)
      // so recovered extras stay where the AI put them rather than scattering.
      fallbackBump += 1
      orderKey = prevKey + fallbackBump * 1e-3
    }
    const partId = unnamedPartIds.has(rawPartId) ? null : rawPartId
    return { section, partId, orderKey, i }
  })

  // Stable sort by document-order key; ties fall back to original AI order.
  decorated.sort((a, b) => (a.orderKey - b.orderKey) || (a.i - b.i))

  // Re-derive orderIndex from the final sorted position so the array carries a
  // stable document-order key even after the AI's sections were re-anchored.
  // In-memory only (the quiz schema is .passthrough() and persistence keys off
  // the serialized `order` field) — but having it on the section lets the
  // editor/preview sort by orderIndex/array order, never by id or AI order.
  const sections = decorated.map(({ section, partId }, orderIndex) => {
    if (section.kind === 'passage') {
      return {
        ...section,
        partId,
        orderIndex,
        passage: {
          ...section.passage,
          questions: (section.passage?.questions || []).map((q, subIndex) => ({
            ...q,
            partId,
            orderIndex: subIndex,
          })),
        },
      }
    }
    if (section.kind === 'standalone') {
      return { ...section, orderIndex, question: { ...section.question, partId } }
    }
    return { ...section, orderIndex }
  })

  return { sections, parts: namedLocalParts }
}
