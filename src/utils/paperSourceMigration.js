/**
 * The decision half of the past-paper source migration.
 *
 * Pure — no Firestore, no filesystem, no flags. The script
 * (`scripts/migratePaperSources.js`) reads documents, calls `planPaperSourceMigration`,
 * prints what it returns and, only with `--apply`, writes it. Splitting it this
 * way is what makes the inference reviewable: a migration whose rules can only
 * be observed by running it against production is a migration nobody can check
 * before it runs.
 *
 * ## What it will and will not conclude
 *
 * The old archive kept a paper's provenance in prose — a hand-typed `title`, an
 * uploaded `fileName`, a Storage path. Those carry real signal ("ECZ", "PRISCA",
 * "MOCK"), and this module reads it, in a declared order, most specific first.
 *
 * What it never does is GUESS. A document nothing matches gets
 * `source: null, sourceConfidence: 'unknown'` and lands in the admin labelling
 * queue for a human. That is the whole design: an inferred source is a claim
 * about whether a paper is a real national examination, and the cost of being
 * confidently wrong about that is a learner revising from a mock believing it
 * is the real thing. A blank is recoverable; a wrong label is not, because
 * nothing downstream will ever question it again.
 */

import {
  PAPER_META_VERSION,
  SOURCE_CONFIDENCE,
  isOfficialSource,
  normalizePaperNumberToken,
} from '../config/paperSources.js'
import { canDerivePaperKey, derivedPaperTitle, paperKey } from './pastPaperNormalize.js'

/**
 * Source patterns, ordered. First match wins, so a paper whose title says both
 * "ECZ" and "mock" is read as an ECZ paper of a mock sitting rather than as a
 * school mock — the publisher is the more specific claim.
 *
 * `\b` boundaries throughout: an unanchored /mock/ matches "mockup" and, worse,
 * an unanchored /ecz/ would match nothing real but would match a UUID segment
 * in a Storage path.
 */
export const SOURCE_PATTERNS = [
  { pattern: /\bECZ\b/i, source: 'ecz' },
  { pattern: /examinations?\s+council/i, source: 'ecz' },
  { pattern: /\bPRISCA\b/i, source: 'prisca' },
  // Only reached when no publisher above matched: "mock"/"trial" says what
  // KIND of paper it is, not who wrote it, so it can only ever mean the
  // generic school mock.
  { pattern: /\bmock\b|\btrial\b/i, source: 'school_mock' },
]

/** Paper-number patterns, ordered. */
export const NUMBER_PATTERNS = [
  { pattern: /\bpaper\s*([12])\b/i, read: (m) => Number(m[1]) },
  { pattern: /\bspecial\b/i, read: () => 'special' },
]

/**
 * The free text a paper's provenance might be written into, joined into one
 * haystack. Storage paths are included because a bulk upload often names the
 * folder ("papers/ecz-2025/…") when the typed title says nothing.
 */
export function migrationHaystack(paper = {}) {
  const assets = Array.isArray(paper.assets) ? paper.assets : []
  return [
    paper.title,
    paper.fileName,
    paper.pdfFilename,
    paper.pdfPath,
    paper.markSchemePath,
    paper.examBoard,
    ...assets.flatMap((a) => [a?.filename, a?.path]),
  ].filter(Boolean).join(' \n ')
}

/** The first matching source, or null. Never a guess. */
export function inferSource(paper) {
  const hay = migrationHaystack(paper)
  for (const { pattern, source } of SOURCE_PATTERNS) {
    if (pattern.test(hay)) return source
  }
  return null
}

/**
 * The paper number, preferring one already STORED over one read out of prose.
 * A stored number is a fact somebody entered; a number in a filename is a
 * reading of it.
 */
export function inferPaperNumber(paper) {
  const stored = normalizePaperNumberToken(paper?.paperNumber)
  if (stored != null) return stored
  // "Special Paper 1" and "Special Paper 2" are ECZ SUBJECTS (Grade 7 PSLE
  // verbal and non-verbal reasoning — see SPECIAL_PAPER_SUBJECTS in
  // src/config/curriculum.js), not paper variants of another subject. The
  // digit in that name belongs to the subject, so reading it as a paper
  // number would file "Special Paper 1 — Paper 1" on every one of them.
  if (String(paper?.subject ?? '').startsWith('special-paper')) return null
  const hay = migrationHaystack(paper)
  for (const { pattern, read } of NUMBER_PATTERNS) {
    const m = hay.match(pattern)
    if (m) return read(m)
  }
  return null
}

/**
 * Plan one document's migration.
 *
 * Returns `{ action, before, after, reason }` where action is:
 *   'skip'    already at paperMetaVersion >= 1, or missing the grade/subject/
 *             year a key needs — re-running must be a no-op, and a document
 *             with no identity has nothing to key on
 *   'label'   a source was inferred
 *   'flag'    nothing matched: source null, confidence unknown, queued for a
 *             human. Still stamped and still keyed, so a second run skips it.
 */
export function planPaperMigration(paper = {}) {
  const before = {
    title: paper.title ?? null,
    source: paper.source ?? null,
    isOfficial: paper.isOfficial ?? null,
    paperNumber: paper.paperNumber ?? null,
    paperKey: paper.paperKey ?? null,
    sourceConfidence: paper.sourceConfidence ?? null,
    paperMetaVersion: paper.paperMetaVersion ?? null,
  }

  if (Number(paper.paperMetaVersion) >= PAPER_META_VERSION) {
    return { id: paper.id, action: 'skip', reason: 'already migrated', before, after: null }
  }
  if (!canDerivePaperKey(paper)) {
    return {
      id: paper.id,
      action: 'skip',
      reason: 'no grade/subject/year — nothing to key on',
      before,
      after: null,
    }
  }

  const source = inferSource(paper)
  const paperNumber = inferPaperNumber(paper)
  const fields = { ...paper, source, paperNumber }
  const after = {
    source,
    isOfficial: isOfficialSource(source),
    paperNumber,
    paperKey: paperKey(fields),
    sourceConfidence: source ? SOURCE_CONFIDENCE.INFERRED : SOURCE_CONFIDENCE.UNKNOWN,
    paperMetaVersion: PAPER_META_VERSION,
    // The prose the inference was read FROM is preserved before the derived
    // title replaces it. It is the only record of what a human once typed, and
    // an operator reviewing a wrong label needs to see what misled the match.
    legacyTitle: paper.title ?? null,
    // A source-less paper cannot compose a meaningful name, so its title is
    // left exactly as it was rather than being rewritten into something worse.
    ...(source ? { title: derivedPaperTitle(fields) } : {}),
  }

  return {
    id: paper.id,
    action: source ? 'label' : 'flag',
    reason: source ? `matched ${source}` : 'no pattern matched — queued for a human',
    before,
    after,
  }
}

/**
 * Plan a whole collection, and find the key collisions.
 *
 * A collision means two documents claim to be the same paper: same grade, year,
 * subject, source and paper number. That is either a genuine duplicate upload
 * or a mislabel, and BOTH need a person — so neither side is written. Writing
 * one and skipping the other would leave the archive looking clean while the
 * duplicate is still there.
 *
 * Papers already carrying a key (migrated earlier, or created by the wizard)
 * are passed in via `existingKeys` so a re-run collides against them too.
 */
export function planPaperSourceMigration(papers, { existingKeys = new Map(), limit = Infinity } = {}) {
  const rows = (Array.isArray(papers) ? papers : []).slice(0, limit)
  const planned = rows.map((p) => planPaperMigration(p))

  // Group every key this run would write, plus the keys already in place.
  const byKey = new Map()
  for (const [key, id] of existingKeys) {
    byKey.set(key, [{ id, existing: true }])
  }
  for (const plan of planned) {
    if (!plan.after?.paperKey) continue
    const list = byKey.get(plan.after.paperKey) || []
    // A doc re-deriving the key it already holds is not colliding with itself.
    if (list.some((e) => e.id === plan.id)) continue
    list.push({ id: plan.id, existing: false })
    byKey.set(plan.after.paperKey, list)
  }

  const collisions = []
  for (const [key, holders] of byKey) {
    if (holders.length > 1) collisions.push({ paperKey: key, ids: holders.map((h) => h.id) })
  }
  const collidingIds = new Set(collisions.flatMap((c) => c.ids))

  const writes = []
  const blocked = []
  const skipped = []
  for (const plan of planned) {
    if (plan.action === 'skip') { skipped.push(plan); continue }
    if (collidingIds.has(plan.id)) {
      blocked.push({ ...plan, reason: `paperKey collision on ${plan.after.paperKey}` })
      continue
    }
    writes.push(plan)
  }

  return {
    writes,
    blocked,
    skipped,
    collisions,
    summary: {
      read: rows.length,
      labelled: writes.filter((w) => w.action === 'label').length,
      flagged: writes.filter((w) => w.action === 'flag').length,
      blocked: blocked.length,
      skipped: skipped.length,
      collisions: collisions.length,
    },
  }
}
