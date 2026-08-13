/**
 * pastPaperParts — deterministic post-processing for scanned past-paper imports,
 * anchored on the ranges a paper PRINTS ("Part 4: Questions 31 – 38").
 *
 * The vision model over- and under-counts and occasionally mis-reads a printed
 * number (labelling a Section B paragraph question as "31"). But ECZ / PSLE
 * papers declare their structure explicitly — every Part prints its question
 * range and its shared instruction — so we treat those ranges as GROUND TRUTH
 * and reconcile the raw extraction against them:
 *
 *   1. parseDeclaredRanges / collectDeclaredRanges — pull every "Questions X–Y"
 *      range (+ its instruction) out of the captured headings/instructions and
 *      the model's optional `parts` array.
 *   2. reconcilePaperNumbering — drop questions numbered OUTSIDE every declared
 *      range (the phantom over-count: 60 → 65), dedupe same-number reads, and
 *      when the surviving count matches the declared total, snap each question's
 *      number to the declared sequence in reading order (repairs mis-reads).
 *   3. assignPartsFromRanges — put each question in the Part whose range
 *      contains its number, and fill an EMPTY stem with that Part's instruction
 *      so a spelling/punctuation item ("Choose the correctly punctuated
 *      sentence") reads as a real question whose options are the four sentences.
 *
 * Everything here is pure + framework-free so scannedQuizImporter can call it in
 * the browser and the node tests can exercise it with plain fixtures. It only
 * ever RUNS when a paper actually declares ranges; a paper that prints none is
 * returned untouched (the existing gap heuristics still apply).
 */

// Matches a printed question range in free text. Handles the dash variants ECZ
// papers use (hyphen, en-dash, em-dash) and the word "to", an optional leading
// "(" ("(Questions 46 — 60)"), and singular/plural "question(s)".
const RANGE_RE = /questions?\s*\(?\s*(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})/gi
// A "Part N" / "Section X" label sitting near the range, captured for display.
const PART_LABEL_RE = /\b(part\s+[0-9ivx]+|section\s+[a-z0-9]+)\b/i
// Cover-page declared TOTAL — mirrors functions/teacherTools/pastPaperImportReconcile.js
// so a paper with no printed "Part" ranges but an explicit "There are 60
// questions in this paper." still gets a global 1..N range to reconcile against.
const DECLARED_COUNT_RE =
  /(?:there\s+are|this\s+paper\s+(?:has|contains)|total\s+of|consists\s+of|comprises)\s+(\d{1,3})\s+questions?/gi

/** Scan free text for an explicit "There are N questions" declaration. */
export function parseDeclaredCountFromText(texts = []) {
  for (const raw of Array.isArray(texts) ? texts : []) {
    const text = String(raw ?? '')
    if (!text) continue
    DECLARED_COUNT_RE.lastIndex = 0
    const m = DECLARED_COUNT_RE.exec(text)
    if (m) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n >= 1 && n <= 500) return n
    }
  }
  return null
}

/**
 * Extract every "Questions X–Y" range found in a list of strings. Returns
 * `[{ start, end, label, source }]` in first-seen order, with start ≤ end and
 * absurd ranges (end < start, span > 200) discarded. `label` is a nearby
 * "Part N" / "Section X" token when one appears in the same string.
 */
export function parseDeclaredRanges(texts = []) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(texts) ? texts : []) {
    const text = String(raw ?? '')
    if (!text) continue
    RANGE_RE.lastIndex = 0
    let m
    while ((m = RANGE_RE.exec(text)) !== null) {
      const start = Number(m[1])
      const end = Number(m[2])
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue
      if (start < 1 || end < start || end - start > 200) continue
      const key = `${start}-${end}`
      if (seen.has(key)) continue
      seen.add(key)
      const labelMatch = text.match(PART_LABEL_RE)
      out.push({
        start,
        end,
        label: labelMatch ? titleCaseLabel(labelMatch[1]) : '',
        source: text.trim().slice(0, 200),
      })
    }
  }
  return out
}

/**
 * Strip HTML tags to a fixpoint, so removals can't reassemble a tag
 * (e.g. "<scr<x>ipt>" losing its inner tag would otherwise re-form "<script>").
 */
function stripTags(value) {
  let out = String(value ?? '')
  let prev
  do {
    prev = out
    out = out.replace(/<[^>]*>/g, '')
  } while (out !== prev)
  return out
}

function titleCaseLabel(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    // Title-case words, but keep a Roman-numeral / letter part id upper
    // ("part iv" → "Part IV", "section b" → "Section B").
    .replace(/\b([a-z]+)\b/g, w => (/^[ivx]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .replace(/(part|section)\s+([a-z])\b/i, (_, kw, letter) => `${kw} ${letter.toUpperCase()}`)
}

/**
 * Every string on a raw merged question that might carry a printed range or a
 * shared instruction: its section heading and its shared instruction.
 */
function questionTexts(q) {
  if (!q) return []
  return [q.sectionTitle, q.sharedInstruction].filter(v => typeof v === 'string' && v.trim())
}

function walkQuestions(sections, fn) {
  ;(Array.isArray(sections) ? sections : []).forEach((section, sectionIndex) => {
    if (section?.kind === 'passage') {
      ;(section.questions || []).forEach((q, qIndex) => fn(q, { section, sectionIndex, qIndex, isPassage: true }))
    } else {
      const q = section?.question || section
      if (q) fn(q, { section, sectionIndex, qIndex: -1, isPassage: false })
    }
  })
}

/**
 * Build the canonical list of declared Parts for a merged vision result. Merges
 * three sources, in order of trust:
 *   1. the model's optional top-level `parts` array (explicit firstNumber /
 *      lastNumber / instruction / sectionTitle),
 *   2. ranges regex-scanned from passage titles / instructions / text,
 *   3. ranges regex-scanned from each question's heading + shared instruction.
 * Overlapping ranges from the weaker sources are dropped in favour of the
 * explicit ones. Each entry: `{ start, end, label, sectionTitle, instruction }`,
 * sorted by start.
 */
export function collectDeclaredRanges(merged = {}) {
  const ranges = []
  const covers = (a, b) => a.start <= b.start && a.end >= b.end
  const addRange = (r) => {
    if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.end < r.start) return
    // Skip a range already fully covered by (or duplicating) a stronger one.
    if (ranges.some(existing => covers(existing, r) || (existing.start === r.start && existing.end === r.end))) return
    ranges.push({
      start: r.start,
      end: r.end,
      label: String(r.label ?? '').trim(),
      sectionTitle: String(r.sectionTitle ?? '').trim(),
      instruction: String(r.instruction ?? '').trim(),
    })
  }

  // 1. Explicit model `parts` array.
  ;(Array.isArray(merged.parts) ? merged.parts : []).forEach(p => {
    const start = Number(p?.firstNumber)
    const end = Number(p?.lastNumber)
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) {
      addRange({
        start,
        end,
        label: String(p?.label ?? '').trim(),
        sectionTitle: String(p?.sectionTitle ?? '').trim(),
        instruction: String(p?.instruction ?? '').trim(),
      })
    }
  })

  // 2. Passage-level strings (title / instructions / passageText lead-in).
  ;(Array.isArray(merged.sections) ? merged.sections : []).forEach(section => {
    if (section?.kind !== 'passage') return
    const texts = [section.title, section.instructions, section.passageText].filter(v => typeof v === 'string' && v.trim())
    parseDeclaredRanges(texts).forEach(r => addRange({ ...r, instruction: pickInstruction(texts) }))
  })

  // 3. Per-question headings + shared instructions.
  const perQuestionTexts = []
  walkQuestions(merged.sections, q => perQuestionTexts.push(...questionTexts(q)))
  parseDeclaredRanges(perQuestionTexts).forEach(r => addRange(r))

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  return ranges
}

// A short instructional sentence from a cluster of strings — the longest one
// that isn't itself just the "Questions X–Y" / "Now do questions" scaffolding.
function pickInstruction(texts = []) {
  const candidates = (texts || [])
    .map(t => String(t ?? '').trim())
    .filter(Boolean)
    .filter(t => !/^\s*(now\s+do\s+)?questions?\b/i.test(t))
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0] ? candidates[0].slice(0, 400) : ''
}

/** The sorted set of every question number the declared ranges cover. */
export function declaredNumbers(ranges = []) {
  const set = new Set()
  ;(Array.isArray(ranges) ? ranges : []).forEach(r => {
    if (!Number.isInteger(r?.start) || !Number.isInteger(r?.end)) return
    for (let n = r.start; n <= r.end; n += 1) set.add(n)
  })
  return [...set].sort((a, b) => a - b)
}

// How "complete" a read is, for choosing which of two same-number duplicates to
// keep: prefer higher OCR confidence, then more options, then a longer stem.
function completenessScore(q) {
  const conf = Number(q?.ocrConfidence)
  const options = Array.isArray(q?.options) ? q.options.filter(o => String(o ?? '').trim()).length : 0
  const textLen = String(q?.text ?? '').trim().length
  return (Number.isFinite(conf) ? conf : 0.5) * 100 + options * 5 + Math.min(textLen, 200) / 100
}

/**
 * Reconcile a merged paper's questions against its declared ranges:
 *   - drop questions whose printed number falls outside EVERY declared range
 *     (phantom over-count),
 *   - dedupe questions sharing a number (keep the most complete read),
 *   - when the surviving count equals the declared total, snap each question's
 *     number to the declared sequence in reading order (repairs mis-reads).
 *
 * Returns a NEW `{ sections, droppedOutOfRange, droppedDuplicate, missing,
 * snapped, declaredTotal, expectedNumbers }` — never mutates the input. A paper
 * with no declared ranges (or fewer than 3 declared numbers) is returned
 * unchanged so unusual layouts are never harmed.
 *
 * `ranges` may be empty even on a continuously-numbered paper when it prints
 * no "Part" headings — in that case the caller should pass a synthesised
 * `[{start:1, end:declaredCount}]` (see synthesizeGlobalRange) built from a
 * cover-page "There are N questions" declaration, so the reconcile (and the
 * exact-set gate downstream) still has ground truth to check against.
 */
export function reconcilePaperNumbering(sections = [], ranges = []) {
  const declared = declaredNumbers(ranges)
  const empty = { droppedOutOfRange: 0, droppedDuplicate: 0, missing: [], snapped: false, declaredTotal: declared.length, expectedNumbers: [] }
  if (declared.length < 3) {
    return { sections: Array.isArray(sections) ? sections : [], ...empty }
  }
  const declaredSet = new Set(declared)

  // Ordered refs to every question, with a mutable copy we can renumber.
  const refs = []
  walkQuestions(sections, (q, ctx) => refs.push({ q: { ...q }, ctx, drop: false }))

  // 1. Drop out-of-range phantoms (numbered, but outside every declared range).
  //
  // GUARD: only trust the printed numbers as a filter when the extraction's
  // numbering actually LINES UP with the declared range — i.e. at least one
  // extracted question already falls inside it. When NONE do, the model
  // numbered on a different basis than the paper's printed numbers: the classic
  // case is importing a mid-paper slice that declares "Questions 39–45" while
  // the vision model renumbered that excerpt from 1. Dropping "out of range"
  // there deletes EVERY question and returns an empty paper — the real
  // "imported 0 questions" failure on a PSLE Section B ordering page. In that
  // case we drop nothing on number and let the count-based snap (step 3)
  // realign the questions to the declared 39–45 sequence instead.
  const numberedRefs = refs.filter(ref => {
    const n = Number(ref.q.sourceQuestionNumber)
    return Number.isInteger(n) && n > 0
  })
  const anyInRange = numberedRefs.some(ref => declaredSet.has(Number(ref.q.sourceQuestionNumber)))
  let droppedOutOfRange = 0
  if (anyInRange) {
    refs.forEach(ref => {
      const n = Number(ref.q.sourceQuestionNumber)
      if (Number.isInteger(n) && n > 0 && !declaredSet.has(n)) {
        ref.drop = true
        droppedOutOfRange += 1
      }
    })
  }

  // 2. Dedupe same-number reads — keep the most complete, drop the rest.
  const bestByNumber = new Map()
  refs.forEach(ref => {
    if (ref.drop) return
    const n = Number(ref.q.sourceQuestionNumber)
    if (!Number.isInteger(n) || n <= 0) return
    const current = bestByNumber.get(n)
    if (!current) { bestByNumber.set(n, ref); return }
    if (completenessScore(ref.q) > completenessScore(current.q)) {
      current.drop = true
      bestByNumber.set(n, ref)
    } else {
      ref.drop = true
    }
  })
  const droppedDuplicate = refs.filter(r => r.drop).length - droppedOutOfRange

  const kept = refs.filter(r => !r.drop)

  // 3. Snap to the declared sequence when the counts line up exactly — the
  //    reading order IS the paper order, so position i is declared number i.
  //    Only when every kept question is numbered (no nulls to strand) so we
  //    never fabricate a number the model never read on a partial extraction.
  let snapped = false
  const allNumbered = kept.every(r => Number.isInteger(Number(r.q.sourceQuestionNumber)) && Number(r.q.sourceQuestionNumber) > 0)
  if (kept.length === declared.length && allNumbered) {
    kept.forEach((ref, i) => { ref.q.sourceQuestionNumber = declared[i] })
    snapped = true
  }

  // Rebuild sections without the dropped questions, carrying the (possibly
  // renumbered) survivors. Drop a passage/section left with no questions.
  const nextSections = []
  let cursor = 0
  ;(Array.isArray(sections) ? sections : []).forEach((section) => {
    if (section?.kind === 'passage') {
      const newQuestions = []
      ;(section.questions || []).forEach(() => {
        const ref = refs[cursor]; cursor += 1
        if (ref && !ref.drop) newQuestions.push(ref.q)
      })
      if (newQuestions.length) nextSections.push({ ...section, questions: newQuestions })
    } else {
      const ref = refs[cursor]; cursor += 1
      if (ref && !ref.drop) nextSections.push({ ...section, question: ref.q })
    }
  })

  const presentNumbers = new Set(kept.map(r => Number(r.q.sourceQuestionNumber)).filter(Number.isInteger))
  const missing = snapped ? [] : declared.filter(n => !presentNumbers.has(n))

  return {
    sections: nextSections,
    droppedOutOfRange,
    droppedDuplicate: Math.max(0, droppedDuplicate),
    missing,
    snapped,
    declaredTotal: declared.length,
    expectedNumbers: declared,
  }
}

/**
 * Build a synthetic {start:1, end:declaredCount} global range when a paper has
 * no printed "Part" ranges at all but DOES state its total on the cover page
 * ("There are 60 questions in this paper."). Mirrors the server's
 * pastPaperImportReconcile.js so the client scanned/document importer gets the
 * same exact-count ground truth a Part-structured paper already has. Returns
 * the existing `ranges` unchanged when they're non-empty (explicit Part
 * structure is more granular ground truth) or when there's nothing to
 * synthesise from.
 */
export function synthesizeGlobalRange(ranges = [], declaredCount) {
  const existing = Array.isArray(ranges) ? ranges : []
  if (existing.length) return existing
  const n = Number(declaredCount)
  if (!Number.isInteger(n) || n < 1 || n > 500) return existing
  return [{ start: 1, end: n, label: '', sectionTitle: '', instruction: '' }]
}

/**
 * Put each question into the Part whose declared range contains its number, and
 * — for an item printed with NO stem of its own (spelling / punctuation lists,
 * where the four choices ARE the question) — fill the stem with that Part's
 * instruction so it reads as a real question. Sets `q.sectionTitle` to a
 * "Part N: Questions X–Y" label so the downstream grouping rebuilds the Part,
 * and clears the now-redundant `sharedInstruction` on a stem it promoted.
 *
 * Returns a NEW `{ sections, partsApplied, stemsFilled, instructionByLabel }`.
 * `instructionByLabel` maps each generated "Part N: Questions X–Y" label to its
 * resolved instruction so the caller can show it on the Part group. Ranges
 * without an instruction still group; they just don't fill any stems.
 */
export function assignPartsFromRanges(sections = [], ranges = []) {
  const sorted = [...(Array.isArray(ranges) ? ranges : [])]
    .filter(r => Number.isInteger(r?.start) && Number.isInteger(r?.end) && r.end >= r.start)
    .sort((a, b) => a.start - b.start)
  if (!sorted.length) return { sections: Array.isArray(sections) ? sections : [], partsApplied: 0, stemsFilled: 0, instructionByLabel: new Map() }

  const rangeFor = (n) => sorted.find(r => n >= r.start && n <= r.end) || null
  const labelFor = (r) => {
    const bits = []
    if (r.sectionTitle) bits.push(r.sectionTitle)
    if (r.label && !r.sectionTitle.toLowerCase().includes(r.label.toLowerCase())) bits.push(r.label)
    const head = bits.join(' · ') || 'Part'
    return `${head}: Questions ${r.start}–${r.end}`
  }
  // Per-part instruction: the range's own, else the most common non-empty
  // shared instruction among that part's questions (spelling/punctuation lead).
  const instructionByRange = new Map()
  const usedRanges = new Set()

  const nextSections = []
  let stemsFilled = 0
  const mapQuestion = (q) => {
    const n = Number(q?.sourceQuestionNumber)
    const r = Number.isInteger(n) ? rangeFor(n) : null
    if (!r) return q
    usedRanges.add(r)
    const next = { ...q, sectionTitle: labelFor(r) }
    const instruction = resolveInstruction(r, sections, sorted, instructionByRange)
    const hasStem = stripTags(q?.text ?? '').trim().length > 0
    if (!hasStem && instruction) {
      next.text = instruction
      // The instruction is now the question itself — don't also show it as a
      // separate shared-instruction line above the stem.
      if (String(q?.sharedInstruction ?? '').trim() === instruction) next.sharedInstruction = ''
      stemsFilled += 1
    }
    return next
  }

  ;(Array.isArray(sections) ? sections : []).forEach(section => {
    if (section?.kind === 'passage') {
      nextSections.push({ ...section, questions: (section.questions || []).map(mapQuestion) })
    } else if (section?.question) {
      nextSections.push({ ...section, question: mapQuestion(section.question) })
    } else {
      nextSections.push(section)
    }
  })

  // Map each used Part's generated label → its resolved instruction, so the
  // caller can surface the instruction on the Part group in the editor.
  const instructionByLabel = new Map()
  usedRanges.forEach(r => {
    const instruction = resolveInstruction(r, sections, sorted, instructionByRange)
    if (instruction) instructionByLabel.set(labelFor(r), instruction)
  })

  return { sections: nextSections, partsApplied: usedRanges.size, stemsFilled, instructionByLabel }
}

// Resolve a Part's instruction: its own declared instruction, else the most
// common non-empty shared instruction among the questions in its range.
function resolveInstruction(range, sections, sorted, cache) {
  if (cache.has(range)) return cache.get(range)
  let instruction = String(range.instruction ?? '').trim()
  if (!instruction) {
    const counts = new Map()
    walkQuestions(sections, q => {
      const n = Number(q?.sourceQuestionNumber)
      if (!Number.isInteger(n) || n < range.start || n > range.end) return
      const s = String(q?.sharedInstruction ?? '').trim()
      if (s) counts.set(s, (counts.get(s) || 0) + 1)
    })
    let best = ''
    let bestCount = 0
    counts.forEach((count, s) => { if (count > bestCount) { best = s; bestCount = count } })
    instruction = best
  }
  cache.set(range, instruction)
  return instruction
}
