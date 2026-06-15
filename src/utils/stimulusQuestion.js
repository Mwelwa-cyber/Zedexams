// Stimulus / source-based question detection + splitting.
//
// Real Zambian exam papers routinely print ONE diagram, passage, map, table or
// chart followed by several follow-up questions:
//
//   22. The diagram below shows the human respiratory system. Study it
//       carefully and answer the questions that follow.
//       [diagram]
//       (a) Name the parts labelled P, Q and R. (3)
//       (b) State the function of the part labelled R. (1)
//       (c) Name the gas that is breathed out during respiration. (1)
//
// When a scan / document import collapses that into a single question whose
// text holds the instruction AND every follow-up, the studio renders the whole
// blob above the diagram — the bug this module exists to fix. The helpers here
// classify such an item as a stimulus question and split it into a stem +
// sub-questions so the layout prints instruction → diagram/source → questions.
//
// Pure module (no React, no Firebase) so the rules are node-testable.

// Phrases that introduce a stimulus the follow-up questions depend on.
const STIMULUS_RE = /\b(study|look at|use|read|observe|examine|consider)\b[^.?!]*\b(diagram|picture|image|figure|photograph|photo|graph|table|passage|map|chart|source|extract|text|drawing|illustration|sketch)\b|\bthe (diagram|picture|figure|graph|table|passage|map|chart|source|extract) (below|above|opposite|shown)\b|\banswer the (questions?|following) (that follow|below)\b|\bquestions? that follow\b/i

// Which stimulus bucket a stem falls into. 'diagram' covers visual figures
// (diagram, picture, graph, drawing); 'source' covers document-study material
// (passage, table, map, chart, extract). Defaults to 'diagram'.
const SOURCE_WORDS = /\b(passage|table|extract|chart|source|text|article|report|letter|poem|dialogue)\b/i
const MAP_WORDS = /\bmap\b/i
const DIAGRAM_WORDS = /\b(diagram|picture|image|figure|photograph|photo|graph|drawing|illustration|sketch|apparatus)\b/i

// A sub-part marker: "(a)", "a)", "(i)", "1." at the start of a segment.
// We capture the label and the text up to the next marker.
const SUBPART_SPLIT_RE = /(?:^|\s)\(?([a-hA-H]|i{1,3}|iv|v|vi{0,3})\)\s+/g

// A trailing mark hint on a sub-part: "(3)", "(3 marks)", "[2]".
const MARKS_RE = /[([]\s*(\d{1,2})\s*(?:marks?|mks?|m)?\s*[)\]]\s*$/i

/**
 * Does this text read like a stimulus instruction ("study the diagram below
 * and answer the questions that follow")?
 */
export function isStimulusText(text) {
  return STIMULUS_RE.test(String(text || ''))
}

/**
 * Classify the stimulus into a passageKind: 'diagram' | 'source' | 'map'.
 * Map wins when an actual map is named; source for document study; diagram for
 * everything visual (the default).
 */
export function classifyStimulusKind(text) {
  const t = String(text || '')
  if (MAP_WORDS.test(t)) return 'map'
  // A document source only when no visual figure is named alongside it.
  if (SOURCE_WORDS.test(t) && !DIAGRAM_WORDS.test(t)) return 'source'
  return 'diagram'
}

/**
 * Split a stimulus question's full text into a stem (the instruction shown
 * before the diagram/source) and an array of sub-questions. Each sub-question
 * is { label, text, marks }. Returns null when fewer than 2 sub-parts are
 * found (not worth splitting — a plain single question).
 */
export function splitSubQuestions(text) {
  const raw = String(text || '').replace(/\r/g, '').trim()
  if (!raw) return null

  // Find every sub-part marker position.
  const markers = []
  let m
  SUBPART_SPLIT_RE.lastIndex = 0
  while ((m = SUBPART_SPLIT_RE.exec(raw)) !== null) {
    markers.push({ index: m.index, matchEnd: SUBPART_SPLIT_RE.lastIndex, label: m[1] })
  }
  if (markers.length < 2) return null

  // The stem is everything before the first marker.
  const stem = raw.slice(0, markers[0].index).trim()
  const parts = []
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].matchEnd
    const end = i + 1 < markers.length ? markers[i + 1].index : raw.length
    let body = raw.slice(start, end).trim()
    if (!body) continue
    let marks = null
    const mk = MARKS_RE.exec(body)
    if (mk) {
      marks = Number(mk[1])
      body = body.slice(0, mk.index).trim()
    }
    parts.push({ label: markers[i].label, text: body, marks })
  }
  if (parts.length < 2) return null
  return { stem, parts }
}

/**
 * Convert a flat imported question object into a stimulus passage descriptor,
 * or return null when it isn't a splittable stimulus question.
 *
 * Input `q` is the lightweight import shape: { text|prompt, marks, imageUrl,
 * imageAlt, imageDiagram, explanation }. Output is a descriptor the caller
 * feeds to createPassageSection():
 *
 *   {
 *     passageKind, title (the stem), imageUrl, imageAlt, imageDiagram,
 *     questions: [{ type:'short_answer', text, marks, answerFormat, ... }]
 *   }
 */
export function stimulusDescriptorFromQuestion(q) {
  if (!q || typeof q !== 'object') return null
  const text = String(q.text ?? q.prompt ?? '').trim()
  if (!isStimulusText(text)) return null
  const split = splitSubQuestions(text)
  if (!split) return null

  const kind = classifyStimulusKind(split.stem || text)
  // Distribute marks: prefer per-sub-part marks; otherwise leave at 1 each.
  const questions = split.parts.map((part) => {
    // A "name the parts P, Q and R" sub-part becomes labelled blanks.
    const labels = detectLabelledParts(part.text)
    const sub = {
      type: 'short_answer',
      options: [],
      correctAnswer: '',
      text: part.text,
      marks: Number.isFinite(part.marks) && part.marks > 0
        ? part.marks
        : (labels.length || 1),
    }
    if (labels.length >= 2) {
      sub.answerFormat = 'labelled_blanks'
      sub.blankLabels = labels
    } else {
      sub.answerFormat = 'lines'
      sub.answerLines = 2
    }
    return sub
  })

  return {
    passageKind: kind,
    title: split.stem,
    imageUrl: q.imageUrl || '',
    imageAlt: q.imageAlt || '',
    imageDiagram: q.imageDiagram || undefined,
    questions,
  }
}

// Detect the labelled parts a "name the parts labelled P, Q and R" sub-question
// asks about, returning ['P','Q','R'] etc. Looks for a run of single-letter /
// roman / numeric labels joined by commas / "and".
export function detectLabelledParts(text) {
  const t = String(text || '')
  if (!/\b(label|labell?ed|marked|named|shown)\b/i.test(t) && !/\bparts?\b/i.test(t)) return []
  // Capture a "P, Q and R" / "A, B, C" / "1, 2 and 3" run.
  const run = /\b([A-Z]|\d{1,2}|i{1,3}|iv|v)\b(?:\s*,\s*([A-Z]|\d{1,2}|i{1,3}|iv|v)\b)+(?:\s*(?:,?\s*and|&)\s*([A-Z]|\d{1,2}|i{1,3}|iv|v)\b)?/
  const m = run.exec(t)
  if (!m) return []
  // Re-extract every label token from the matched substring.
  const tokens = m[0].match(/\b([A-Z]|\d{1,2}|i{1,3}|iv|v)\b/g) || []
  const labels = tokens.map(s => s.trim()).filter(Boolean)
  // Guard against false positives (e.g. a single stray capital). Need 2+.
  return labels.length >= 2 ? labels.slice(0, 12) : []
}
