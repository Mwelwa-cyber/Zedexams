/**
 * Canonical parser for the 2013 Zambian curriculum.
 * ==================================================
 *
 * The 2013 syllabi were digitised from PDF tables into
 * `public/syllabi/curriculum-data-2013.json` (mirrored at
 * `functions/data/curriculum-data-2013.json`). The raw JSON is _columnar_
 * — one row per source table row, `{ type, cells: { COLUMN: value } }` — but
 * three things about the source make a naive read produce the malformed
 * hierarchy the Syllabi Studio has been showing:
 *
 *   1. A single SPECIFIC OUTCOMES cell holds MANY outcomes, each prefixed by
 *      its own 4-part code ("1.3.1.1 Identify… 1.3.1.2 Distinguish…"). Read
 *      verbatim they render as one blob and the 2nd/3rd codes look like
 *      headings.
 *   2. Column headers vary wildly across sheets (~28 spellings incl. OCR
 *      artefacts like "SPECIFIC OUTC OME", plus leading THEME/COMPONENT/UNIT
 *      columns). A hardcoded column read drops SUB-TOPIC / CONTENT on most
 *      sheets and mis-files content as sub-topics.
 *   3. Merged cells (blank TOPIC/SUB-TOPIC on continuation rows) and repeated
 *      header-echo rows (CONTENT="KNOWLEDGE", SKILLS="SKILLS", …) captured at
 *      PDF page breaks.
 *
 * This module is the ONE place that turns a raw 2013 sheet into normalized,
 * independently-addressable records. It is pure (no Firebase, no DOM, no I/O)
 * so the Syllabi Studio display, the studio pickers, the migration script and
 * the unit tests all share exactly one hierarchy classifier.
 *
 * Classification uses the curriculum CODE and the SOURCE COLUMN together — never
 * font/bold/row-width — and validates parent relationships instead of trusting
 * a regex blindly (see classifyCode / validateRecord).
 *
 * The server keeps a lock-step copy of the column-role + outcome-split logic in
 * functions/teacherTools/syllabiCurriculumData.js — keep the two in sync.
 */

// ── Code classification ──────────────────────────────────────────────────────
//
// Two numbering conventions coexist in the 2013 books:
//   • Primary (Grades 1-7): topic "1.3.0", subtopic "1.3.1", outcome "1.3.1.1"
//   • Secondary (Grades 8-12): topic "10.1", subtopic "10.1.1", outcome "10.1.1.1"
// So "ends in .0 (3-seg)" and "2-seg" both read as topics; 3-seg (not .0) is a
// subtopic; 4+ segments is a specific outcome.

export const TOPIC_CODE_PRIMARY = /^\d+\.\d+\.0$/       // 1.3.0
export const TOPIC_CODE_SECONDARY = /^\d+\.\d+$/         // 10.1
export const SUBTOPIC_CODE = /^\d+\.\d+\.[1-9]\d*$/      // 1.3.1 / 10.1.1
export const OUTCOME_CODE = /^\d+(?:\.\d+){3,}$/         // 1.3.1.1 (4+ segments)

// Any dotted-code candidate (≥2 segments), used to FIND outcome codes inside a
// glued cell. NB the OUTCOME depth is NOT fixed at 4: primary Mathematics codes
// outcomes at 3 segments ("1.3.1"), while Integrated Science / secondary books
// use 4 ("1.3.1.1"). splitSpecificOutcomes picks the dominant depth per cell.
const CODE_CANDIDATE_GLOBAL = /\d+(?:\.\d+)+/g
// Leading code (1-or-more segments) at the very start of a statement, possibly
// glued directly to the first word (OCR dropped the space): "1.3.1.1Identify".
const LEADING_CODE = /^\s*(\d+(?:\.\d+)*)/

/** Table-heading / domain-label words that must never become curriculum records. */
export const HEADER_WORDS = new Set([
  'knowledge', 'skills', 'skill', 'values', 'value', 'content', 'contents',
  'specific outcomes', 'specific outcome', 'activities', 'activity', 'topic',
  'topics', 'sub-topic', 'subtopic', 'sub topic', 'subtopics', 'theme',
  'component', 'unit', 'strand',
])

/**
 * Classify a bare curriculum code into its hierarchy tier.
 * @param {string} code e.g. "1.3.0", "1.3.1", "1.3.1.2", "10.1"
 * @returns {'topic'|'subtopic'|'outcome'|null}
 */
export function classifyCode(code) {
  const c = String(code || '').trim()
  if (!c) return null
  if (OUTCOME_CODE.test(c)) return 'outcome'
  if (TOPIC_CODE_PRIMARY.test(c)) return 'topic'
  if (SUBTOPIC_CODE.test(c)) return 'subtopic'
  if (TOPIC_CODE_SECONDARY.test(c)) return 'topic'
  return null
}

/** The dotted-code segment count (e.g. "1.3.1.2" → 4), or 0 if not a code. */
export function codeDepth(code) {
  const c = String(code || '').trim()
  if (!/^\d+(?:\.\d+)*$/.test(c)) return 0
  return c.split('.').length
}

/**
 * Expected parent code for an outcome/subtopic.
 *   outcome  "1.3.1.2" → subtopic parent "1.3.1"
 *   subtopic "1.3.1"   → topic parent "1.3.0" (primary) or "1.3" (secondary)
 * Returns null when there is no meaningful parent.
 */
export function parentCode(code) {
  const c = String(code || '').trim()
  const depth = codeDepth(c)
  if (depth <= 1) return null
  const segs = c.split('.')
  if (depth >= 4) return segs.slice(0, depth - 1).join('.')        // outcome → subtopic
  if (depth === 3) {
    // subtopic → topic: primary books zero the last segment ("1.3.1" → "1.3.0")
    return `${segs[0]}.${segs[1]}.0`
  }
  return null
}

// ── Text normalisation ───────────────────────────────────────────────────────

/**
 * Clean an extraction artefact WITHOUT rewriting official wording. Fixes only:
 * duplicate spaces, leading bullets/stray punctuation, repeated full stops, and
 * trailing OCR symbols. Preserves commas/brackets/slashes/apostrophes/hyphens/
 * semicolons/colons.
 */
export function cleanStatement(text) {
  let s = String(text == null ? '' : text)
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[•●·▪◦*\-–—\s.,;:]+/, '')  // leading bullets / stray punctuation
  s = s.replace(/\.{2,}/g, '.')                          // repeated full stops → one
  s = s.replace(/[\s.,;:•·]+$/g, (m) => (/[.)\]]$/.test(m) ? m.replace(/[\s•·,;:]+$/g, '') : ''))
  return s.trim()
}

/**
 * Split a leading curriculum code off a statement, repairing a missing space
 * between the code and the first word ("1.3.1.1Identify" → code + "Identify").
 * @returns {{ code: string|null, statement: string }}
 */
export function parseCodedStatement(raw) {
  const trimmed = String(raw == null ? '' : raw).trim()
  if (!trimmed) return { code: null, statement: '' }
  const m = trimmed.match(LEADING_CODE)
  if (!m || !m[1] || codeDepth(m[1]) < 2) {
    return { code: null, statement: cleanStatement(trimmed) }
  }
  const code = m[1]
  const statement = cleanStatement(trimmed.slice(m[0].length))
  return { code, statement }
}

// ── Splitters ────────────────────────────────────────────────────────────────

/**
 * Repair OCR punctuation INSIDE curriculum codes without touching prose. Fixes
 * only the unambiguous forms seen in the 2013 books: doubled dots between digits
 * ("10.1.3..5") and a stray space before a dot inside a code ("10.4.2 .1"). A
 * sentence-ending full stop is always preceded by a letter, so these never fire
 * on real prose (Rule 4 / Rule 5).
 */
export function repairCodePunctuation(text) {
  return String(text == null ? '' : text)
    .replace(/(\d)\s*\.\s*\.+\s*(\d)/g, '$1.$2')  // "10.1.3..5" / "10.1.3. .5"
    .replace(/(\d)\s+\.(\d)/g, '$1.$2')            // "10.4.2 .1"
}

/**
 * Split a SPECIFIC OUTCOMES cell that holds one OR MANY outcomes into discrete
 * `{ code, statement }` records. The outcome depth is detected PER CELL (3-seg
 * for primary Maths, 4-seg for Integrated Science / secondary), so the split is
 * driven by the CURRICULUM CODE STRUCTURE, never punctuation — a statement's own
 * full stops, commas or measurements are never mistaken for a boundary (Rule 5).
 *
 * @param {string} raw
 * @returns {Array<{code: string|null, statement: string}>}
 */
export function splitSpecificOutcomes(raw) {
  const trimmed = repairCodePunctuation(String(raw == null ? '' : raw).trim())
  if (!trimmed) return []

  // Collect every dotted-code candidate that starts at a real boundary (not
  // mid-number). Record its start index, code text and segment depth.
  const candidates = []
  CODE_CANDIDATE_GLOBAL.lastIndex = 0
  let m
  while ((m = CODE_CANDIDATE_GLOBAL.exec(trimmed)) !== null) {
    const idx = m.index
    const prev = idx > 0 ? trimmed[idx - 1] : ''
    if (prev && /[\d.]/.test(prev)) continue
    candidates.push({ idx, code: m[0], depth: m[0].split('.').length })
  }

  if (candidates.length === 0) {
    // No codes at all — treat the whole cell as a single (uncoded) outcome so
    // short-form syllabi still yield one selectable statement.
    return [{ code: null, statement: cleanStatement(trimmed) }]
  }

  // Real outcome codes are ≥3 segments (3 for primary Maths, 4 for Integrated
  // Science / secondary). The cell opens with its first outcome code, so the
  // outcome depth for this cell is the first candidate that is ≥3 deep. Split
  // ONLY at candidates of that exact depth — a statement's own decimals
  // ("2.5 litres … 3.2 kg", depth 2) never mark a boundary (Rule 5). Codes at
  // the same depth but under a sibling subtopic (a merged multi-subtopic cell)
  // still split correctly; genuinely-broken OCR codes fall through and the
  // parent/embedded-code validator flags the record for review rather than
  // guessing (Rule 10).
  const anchor = candidates.find((c) => c.depth >= 3)
  if (!anchor) {
    return [{ code: null, statement: cleanStatement(trimmed) }]
  }
  const starts = candidates.filter((c) => c.depth === anchor.depth).map((c) => c.idx)
  if (starts[0] !== anchor.idx) starts.unshift(anchor.idx)

  const out = []
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]
    const to = i + 1 < starts.length ? starts[i + 1] : trimmed.length
    const parsed = parseCodedStatement(trimmed.slice(from, to))
    if (parsed.code || parsed.statement) out.push(parsed)
  }
  return out
}

/**
 * Split a CONTENT / KNOWLEDGE / SKILLS / VALUES / ACTIVITIES cell into discrete
 * points. Splits on bullets first, then newlines. Never splits on bare full
 * stops (a point may contain "e.g." or a sentence), so "Head, neck, arm" stays
 * one point. Falls back to the whole (cleaned) string.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitPoints(raw) {
  const trimmed = String(raw == null ? '' : raw).trim()
  if (!trimmed) return []
  let parts
  if (/[•●·▪◦]/.test(trimmed)) {
    parts = trimmed.split(/[•●·▪◦]+/)
  } else if (trimmed.includes('\n')) {
    parts = trimmed.split(/\n+/)
  } else {
    parts = [trimmed]
  }
  return parts.map((p) => cleanStatement(p)).filter(Boolean)
}

/**
 * True when two adjacent fragments were split MID-PHRASE by a page break —
 * i.e. the second is a continuation of the first, not a new point. Signals:
 * an unclosed bracket spanning the break, no sentence-terminal punctuation on
 * the first + a lowercase start on the second, or a dangling connector word.
 *   "…environment(Plants, Rocks, animals" + "Streams, buildings)"  → true
 *   "Comparing" + "urban and rural environment"                     → true
 *   "Cooperating in" + "group work"                                 → true
 *   "Prevention of diseases." + "Ways of cleaning"                  → false
 */
export function isMidPhraseBreak(prev, next) {
  const a = String(prev || '').trim()
  const b = String(next || '').trim()
  if (!a || !b) return false
  const opens = (a.match(/\(/g) || []).length
  const closes = (a.match(/\)/g) || []).length
  if (opens > closes) return true
  if (/[.!?;:]$/.test(a)) return false
  if (/^[a-z(]/.test(b)) return true
  if (/,$/.test(a) || /\b(and|or|of|in|on|for|to|the|a|an|with|by|from|such as|e\.g)$/i.test(a)) return true
  return false
}

/**
 * Append a continuation row's points onto an existing point list, merging the
 * boundary pair into one point when the break was mid-phrase.
 */
export function joinPointLists(prev, next) {
  const a = (prev || []).filter(Boolean)
  const b = (next || []).filter(Boolean)
  if (!a.length) return [...b]
  if (!b.length) return [...a]
  if (isMidPhraseBreak(a[a.length - 1], b[0])) {
    return [...a.slice(0, -1), `${a[a.length - 1]} ${b[0]}`, ...b.slice(1)]
  }
  return [...a, ...b]
}

/**
 * Join two raw cell strings across a page break for display: glued with a
 * space when the break was mid-phrase, otherwise as separate bullet points.
 */
export function joinCellText(prevRaw, nextRaw) {
  const a = String(prevRaw || '').trim()
  const b = String(nextRaw || '').trim()
  if (!a) return b
  if (!b) return a
  return isMidPhraseBreak(a, b) ? `${a} ${b}` : `${a} • ${b}`
}

// ── Column-role resolution ───────────────────────────────────────────────────

const norm = (c) => String(c == null ? '' : c).toLowerCase().replace(/[^a-z]/g, '')

/**
 * Map a sheet's actual column headers to canonical roles, tolerating every
 * spelling and OCR artefact seen in the 2013 books. Returns the resolved
 * source column NAME for each role (or null).
 *
 * @param {string[]} columns
 * @returns {{ theme: ?string, topic: ?string, subtopic: ?string, outcomes: ?string,
 *             content: ?string[], skills: ?string, values: ?string, activities: ?string }}
 */
export function resolveColumnRoles(columns) {
  const cols = (Array.isArray(columns) ? columns : []).filter(Boolean)
  const roles = {
    theme: null, topic: null, subtopic: null, outcomes: null,
    content: [], skills: null, values: null, activities: null,
  }
  for (const col of cols) {
    const n = norm(col)
    if (!n) continue
    if (/^(theme|component|unit|strand)/.test(n)) {
      if (!roles.theme) roles.theme = col
    } else if (n.includes('subtopic')) {
      if (!roles.subtopic) roles.subtopic = col
    } else if (n === 'topic' || n === 'topics') {
      if (!roles.topic) roles.topic = col
    } else if (n.includes('specificout') || n.includes('outcome')) {
      if (!roles.outcomes) roles.outcomes = col
    } else if (n.includes('content') || n.includes('knowledge')) {
      roles.content.push(col)
    } else if (n.includes('activit')) {
      if (!roles.activities) roles.activities = col
    } else if (n.includes('skill')) {
      if (!roles.skills) roles.skills = col
    } else if (n.includes('value')) {
      if (!roles.values) roles.values = col
    }
  }
  // A sheet with a THEME/COMPONENT grouping column but no TOPIC column uses the
  // grouping column as the topic and its granular column as the subtopic.
  if (!roles.topic && roles.theme) {
    roles.topic = roles.theme
    roles.theme = null
  }
  return roles
}

/**
 * Detect and repair a COLUMN-SHIFTED row.
 *
 * At PDF page breaks the digitiser sometimes dropped the leading (empty,
 * vertically-merged) TOPIC + SUB-TOPIC cells of a continuation row, shifting
 * every remaining cell left — so outcome text lands in TOPIC, content in
 * SUB-TOPIC, skills in SPECIFIC OUTCOMES, and so on (the "1.3.1.2 Distinguish…
 * rendered as a topic heading" bug).
 *
 * The tell is unambiguous: a real TOPIC cell never starts with an
 * outcome-shaped code. When it does, we re-map each cell rightward by the
 * TOPIC→OUTCOMES column distance, leaving the leading columns blank so the
 * row inherits its merged topic/subtopic like any other continuation row.
 *
 * Returns { cells, shifted } — `cells` is the original object when no shift
 * is detected. Callers should flag records built from a shifted row for
 * review (the repair is evidence-based but still a heuristic — Rule 10).
 */
export function repairColumnShiftedRow(cells, columns, roles) {
  const src = cells || {}
  const cols = Array.isArray(columns) ? columns : []
  if (!roles || !roles.topic || !roles.outcomes) return { cells: src, shifted: false }
  const topicRaw = String(src[roles.topic] || '').trim()
  if (!topicRaw) return { cells: src, shifted: false }
  const lead = parseCodedStatement(topicRaw)
  // Only an outcome-shaped LEADING code marks a shift; topic/subtopic codes
  // (and uncoded titles) are legitimate topic-cell content.
  if (!lead.code || classifyCode(lead.code) !== 'outcome') return { cells: src, shifted: false }
  const from = cols.indexOf(roles.topic)
  const to = cols.indexOf(roles.outcomes)
  if (from < 0 || to <= from) return { cells: src, shifted: false }
  const offset = to - from
  const out = {}
  for (let j = 0; j < cols.length; j++) {
    const srcIdx = j - offset
    out[cols[j]] = srcIdx >= 0 ? String(src[cols[srcIdx]] || '') : ''
  }
  return { cells: out, shifted: true }
}

/** True when a data row is just the column-header line repeated in the body. */
export function isHeaderEchoRow(cells) {
  const values = Object.values(cells || {})
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  if (values.length === 0) return false
  return values.every((v) => HEADER_WORDS.has(v.toLowerCase()))
}

// ── Slug / id helpers ────────────────────────────────────────────────────────

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/**
 * Deterministic, stable id for a specific-outcome record. Built from
 * curriculum + grade + subject + outcome-code (never the display sentence) so
 * re-imports are idempotent and pickers can key on it.
 */
export function buildOutcomeId({ curriculumId = '2013', gradeId, subjectId, outcomeCode, subtopicCode, fallback }) {
  const tail = outcomeCode || subtopicCode || fallback || 'x'
  return [curriculumId, gradeId, subjectId, tail]
    .map((p) => slug(p))
    .filter(Boolean)
    .join('-')
}

// ── The record builder ───────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedRecord
 * @property {string} id
 * @property {string} curriculumId
 * @property {string} gradeId
 * @property {string} gradeName
 * @property {string} subjectId
 * @property {string} subjectName
 * @property {?string} theme
 * @property {{code: ?string, title: string}} topic
 * @property {{code: ?string, title: string}} subtopic
 * @property {{code: ?string, statement: string}} specificOutcome
 * @property {string[]} content
 * @property {string[]} skills
 * @property {string[]} values
 * @property {string[]} activities
 * @property {{sheet: string, rowIndex: number, rawText: string}} source
 * @property {boolean} needsReview
 * @property {string[]} reviewReasons
 */

/**
 * Parse one raw 2013 sheet into normalized, independently-addressable records —
 * one per specific outcome. Handles merged-cell inheritance, header-echo rows,
 * continuation rows, outcome splitting and content splitting.
 *
 * @param {{columns?: string[], rows?: Array}} sheet
 * @param {{ sheetName?: string, gradeId?: string, gradeName?: string,
 *           subjectId?: string, subjectName?: string, curriculumId?: string }} ctx
 * @returns {{ records: NormalizedRecord[], stats: object, issues: object[] }}
 */
export function parseSheet(sheet, ctx = {}) {
  const roles = resolveColumnRoles(sheet?.columns)
  const gradeId = ctx.gradeId || slug(ctx.gradeName || ctx.sheetName || '')
  const subjectId = ctx.subjectId || slug(ctx.subjectName || '')
  const curriculumId = ctx.curriculumId || '2013'

  const records = []
  const stats = {
    rowsInspected: 0, headerRowsRemoved: 0, continuationRowsJoined: 0,
    mergedCellsInherited: 0, combinedOutcomesDetected: 0, combinedOutcomesSplit: 0,
    columnShiftsRepaired: 0,
    outcomes: 0, subtopics: new Set(), topics: new Set(),
  }
  const issues = []

  // Topic/subtopic carry a { code, title }; parseCodedStatement yields
  // { code, statement } so we remap statement→title for the heading tiers.
  const asTitle = (raw) => { const p = parseCodedStatement(raw); return { code: p.code, title: p.statement } }

  let curTopic = { code: null, title: '' }
  let curSubtopic = { code: null, title: '' }
  let curTheme = ''
  let lastGroupRecords = []   // records emitted for the previous data row (for continuation join)

  const rows = Array.isArray(sheet?.rows) ? sheet.rows : []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.type === 'section') {
      if (row?.type === 'section') { curTopic = { code: null, title: '' }; curSubtopic = { code: null, title: '' } }
      continue
    }
    if (row.type !== 'data') continue

    if (isHeaderEchoRow(row.cells || {})) { stats.headerRowsRemoved++; continue }
    stats.rowsInspected++

    // Repair page-break rows whose cells were shifted left (outcome text in
    // the TOPIC column) before reading any column.
    const { cells, shifted } = repairColumnShiftedRow(row.cells || {}, sheet?.columns, roles)
    if (shifted) stats.columnShiftsRepaired++

    const rawTopic = roles.topic ? String(cells[roles.topic] || '').trim() : ''
    const rawSubtopic = roles.subtopic ? String(cells[roles.subtopic] || '').trim() : ''
    const rawOutcomes = roles.outcomes ? String(cells[roles.outcomes] || '').trim() : ''
    const rawTheme = roles.theme ? String(cells[roles.theme] || '').trim() : ''
    const rawContent = (roles.content || []).map((c) => String(cells[c] || '').trim()).filter(Boolean).join('\n')
    const rawSkills = roles.skills ? String(cells[roles.skills] || '').trim() : ''
    const rawValues = roles.values ? String(cells[roles.values] || '').trim() : ''
    const rawActivities = roles.activities ? String(cells[roles.activities] || '').trim() : ''

    if (rawTheme) curTheme = cleanStatement(rawTheme)

    // Merged-cell inheritance: a blank topic/subtopic on a continuation row keeps
    // the last non-blank value (vertically-merged PDF cell).
    if (rawTopic) {
      curTopic = asTitle(rawTopic)
      curSubtopic = { code: null, title: '' }  // new topic resets the subtopic scope
    } else if (curTopic.code || curTopic.title) {
      stats.mergedCellsInherited++
    }
    if (rawSubtopic) {
      curSubtopic = asTitle(rawSubtopic)
    } else if ((rawOutcomes || rawContent) && (curSubtopic.code || curSubtopic.title)) {
      stats.mergedCellsInherited++
    }

    let contentPoints = splitPoints(rawContent)
    let skillPoints = splitPoints(rawSkills)
    let valuePoints = splitPoints(rawValues)
    let activityPoints = splitPoints(rawActivities)

    // Continuation row: only content/skills/values, no topic/subtopic/outcome
    // codes — its text belongs to the previous row's record(s), not a new one.
    // joinPointLists heals boundary fragments the page break cut mid-phrase.
    const outcomeSplits = splitSpecificOutcomes(rawOutcomes)
    const hasNewIdentity = Boolean(rawTopic || rawSubtopic ||
      outcomeSplits.some((o) => o.code))
    if (!hasNewIdentity && !rawOutcomes && (contentPoints.length || skillPoints.length || valuePoints.length) && lastGroupRecords.length) {
      for (const rec of lastGroupRecords) {
        rec.content = joinPointLists(rec.content, contentPoints)
        rec.skills = joinPointLists(rec.skills, skillPoints)
        rec.values = joinPointLists(rec.values, valuePoints)
        rec.activities = joinPointLists(rec.activities, activityPoints)
        rec.source.rawText += ` ⏎ ${JSON.stringify(cells)}`
      }
      stats.continuationRowsJoined++
      continue
    }

    // A repaired column-shifted row is BY CONSTRUCTION the second half of the
    // previous physical row (the shift happened because the page break dropped
    // the leading merged cells). Its content/skills/values cells continue the
    // previous row's cells — and in the source table that one merged cell is
    // shared by every outcome of the subtopic (Rule 7 + Rule 9). So: join the
    // fragments onto the previous group's records, and let the new outcome
    // records share the same joined lists.
    const continuesPrevGroup = shifted && lastGroupRecords.length > 0 &&
      lastGroupRecords[0].subtopic.code === curSubtopic.code &&
      lastGroupRecords[0].topic.code === curTopic.code
    if (continuesPrevGroup) {
      const prev = lastGroupRecords[0]
      contentPoints = joinPointLists(prev.content, contentPoints)
      skillPoints = joinPointLists(prev.skills, skillPoints)
      valuePoints = joinPointLists(prev.values, valuePoints)
      activityPoints = joinPointLists(prev.activities, activityPoints)
      for (const rec of lastGroupRecords) {
        rec.content = [...contentPoints]
        rec.skills = [...skillPoints]
        rec.values = [...valuePoints]
        rec.activities = [...activityPoints]
        rec.source.rawText += ` ⏎ ${JSON.stringify(cells)}`
      }
    }

    if (outcomeSplits.length > 1) {
      stats.combinedOutcomesDetected++
      stats.combinedOutcomesSplit += outcomeSplits.length
    }

    stats.topics.add(curTopic.code || curTopic.title)
    if (curSubtopic.code || curSubtopic.title) stats.subtopics.add(curSubtopic.code || curSubtopic.title)

    const groupRecords = []
    const emit = (outcome) => {
      const rec = {
        id: buildOutcomeId({
          curriculumId, gradeId, subjectId,
          outcomeCode: outcome?.code, subtopicCode: curSubtopic.code,
          fallback: `${curTopic.code || slug(curTopic.title)}-r${r}-${groupRecords.length}`,
        }),
        curriculumId,
        gradeId,
        gradeName: ctx.gradeName || '',
        subjectId,
        subjectName: ctx.subjectName || '',
        theme: curTheme || null,
        topic: { ...curTopic },
        subtopic: { ...curSubtopic },
        specificOutcome: outcome ? { code: outcome.code, statement: outcome.statement } : { code: null, statement: '' },
        content: [...contentPoints],
        skills: [...skillPoints],
        values: [...valuePoints],
        activities: [...activityPoints],
        source: { sheet: ctx.sheetName || '', rowIndex: r, rawText: JSON.stringify(cells) },
        needsReview: false,
        reviewReasons: [],
      }
      const problems = validateRecord(rec)
      if (shifted) {
        // The repair is evidence-based (outcome code in the TOPIC column) but
        // still heuristic — surface it for human confirmation (Rule 10).
        problems.push('column-shifted row repaired — verify field placement')
      }
      if (problems.length) {
        rec.needsReview = true
        rec.reviewReasons = problems
        issues.push({ id: rec.id, rowIndex: r, reasons: problems, raw: cells })
      }
      records.push(rec)
      groupRecords.push(rec)
      if (outcome && outcome.statement) stats.outcomes++
    }

    if (outcomeSplits.length) {
      for (const o of outcomeSplits) emit(o)
    } else if (curSubtopic.code || curSubtopic.title || contentPoints.length) {
      // Subtopic with no listed outcomes (or a content-only subtopic) — still
      // emit one record so the subtopic is addressable, flagged for review.
      emit(null)
    }
    // A shifted row's records extend the previous group (they share one source
    // row), so a further continuation row updates all of them together.
    lastGroupRecords = continuesPrevGroup
      ? [...lastGroupRecords, ...groupRecords]
      : groupRecords
  }

  return {
    records,
    issues,
    stats: {
      ...stats,
      topics: stats.topics.size,
      subtopics: stats.subtopics.size,
    },
  }
}

// ── Validators ───────────────────────────────────────────────────────────────

/**
 * Runtime + migration validator. Returns an array of human-readable problem
 * strings; empty means the record is structurally sound. Never throws.
 */
export function validateRecord(rec) {
  const problems = []
  if (!rec || typeof rec !== 'object') return ['record is not an object']

  const oCode = rec.specificOutcome?.code || null
  const oStatement = String(rec.specificOutcome?.statement || '').trim()
  const subCode = rec.subtopic?.code || null
  const topCode = rec.topic?.code || null

  // A specific outcome must never carry a second outcome code in its statement.
  if (oStatement) {
    const extra = splitSpecificOutcomes(oStatement).filter((o) => o.code)
    if (extra.length >= 1) problems.push('outcome statement contains another outcome code')
  }
  if (oCode) {
    // Outcomes are ≥3 segments — 3 for primary Maths ("1.3.1"), 4 for
    // Integrated Science / secondary ("1.3.1.1"). Depth is scheme-dependent, so
    // shape validation only rejects clearly-too-shallow codes.
    if (codeDepth(oCode) < 3) problems.push(`outcome code ${oCode} is not outcome-shaped`)
    if (!oStatement) problems.push('specific-outcome statement is empty')
    // Parent-subtopic check: an outcome's code minus its last segment should be
    // the subtopic's code (only when a subtopic is present AND the depths line
    // up — a 3-seg Maths outcome has no subtopic tier to check against).
    if (subCode && codeDepth(oCode) === codeDepth(subCode) + 1) {
      const expected = oCode.split('.').slice(0, -1).join('.')
      if (expected !== subCode) {
        problems.push(`outcome ${oCode} does not match subtopic parent ${subCode}`)
      }
    }
  }
  // A code that is really a topic/subtopic must not be filed as an outcome.
  if (subCode && classifyCode(subCode) === 'outcome') {
    problems.push(`subtopic ${subCode} is outcome-shaped (4+ segments)`)
  }
  if (topCode && classifyCode(topCode) === 'outcome') {
    problems.push(`topic ${topCode} is outcome-shaped (4+ segments)`)
  }
  // Header-label leakage.
  for (const [field, val] of [['topic', rec.topic?.title], ['subtopic', rec.subtopic?.title], ['outcome', oStatement]]) {
    if (val && HEADER_WORDS.has(String(val).trim().toLowerCase())) {
      problems.push(`${field} is a table-heading word ("${val}")`)
    }
  }
  return problems
}

/**
 * Parse an entire raw 2013 curriculum JSON object into normalized records
 * across every subject + grade sheet. `resolveGrade`/`resolveSubject` translate
 * the raw JSON keys into ids; when omitted, slugs are used.
 *
 * @param {object} raw   subject → sheet → { columns, rows }
 * @param {object} [opts]
 * @returns {{ records: NormalizedRecord[], issues: object[], stats: object }}
 */
export function parseCurriculum2013(raw, opts = {}) {
  const resolveGrade = opts.resolveGrade || ((sheetName) => ({ gradeId: slug(sheetName), gradeName: sheetName }))
  const resolveSubject = opts.resolveSubject || ((subjectName) => ({ subjectId: slug(subjectName), subjectName }))

  const records = []
  const allIssues = []
  const agg = {
    sheets: 0, rowsInspected: 0, headerRowsRemoved: 0, continuationRowsJoined: 0,
    mergedCellsInherited: 0, combinedOutcomesDetected: 0, combinedOutcomesSplit: 0,
    columnShiftsRepaired: 0,
    outcomes: 0, topics: 0, subtopics: 0, records: 0, needsReview: 0,
  }
  const seenIds = new Set()

  for (const [subjectName, sheets] of Object.entries(raw || {})) {
    const { subjectId, subjectName: sName } = resolveSubject(subjectName)
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const { gradeId, gradeName } = resolveGrade(sheetName, subjectName)
      const { records: recs, issues, stats } = parseSheet(sheet, {
        sheetName, gradeId, gradeName, subjectId, subjectName: sName,
        curriculumId: opts.curriculumId || '2013',
      })
      agg.sheets++
      agg.rowsInspected += stats.rowsInspected
      agg.headerRowsRemoved += stats.headerRowsRemoved
      agg.continuationRowsJoined += stats.continuationRowsJoined
      agg.mergedCellsInherited += stats.mergedCellsInherited
      agg.combinedOutcomesDetected += stats.combinedOutcomesDetected
      agg.combinedOutcomesSplit += stats.combinedOutcomesSplit
      agg.columnShiftsRepaired += stats.columnShiftsRepaired
      agg.outcomes += stats.outcomes
      agg.topics += stats.topics
      agg.subtopics += stats.subtopics
      // De-duplicate ids across the whole set (idempotency).
      for (const rec of recs) {
        let id = rec.id
        let n = 2
        while (seenIds.has(id)) { id = `${rec.id}-${n++}` }
        seenIds.add(id)
        rec.id = id
        if (rec.needsReview) agg.needsReview++
        records.push(rec)
      }
      allIssues.push(...issues.map((i) => ({ ...i, subject: sName, sheet: sheetName })))
    }
  }
  agg.records = records.length
  return { records, issues: allIssues, stats: agg }
}
