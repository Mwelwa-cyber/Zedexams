/**
 * Server code that reads an `aiGenerations` document directly.
 *
 * ## Why this guard exists
 *
 * `teacherLibraryItems` holds the teacher's EDITED lesson plan;
 * `aiGenerations` holds what the model returned. Any server path that reaches
 * for the second when it wanted the first keeps working perfectly and serves
 * content the teacher rejected — no error, no failing test. Three paths were in
 * that state when the split was designed: the download endpoint, the notes
 * generator, and the template-bank trigger.
 *
 * `resolveLessonPlanArtifact` fixes the three that exist today. This fixes the
 * fourth, which does not exist yet: the Teaching Kit tool somebody adds next
 * quarter, written by copying a reader that predates the split.
 *
 * It is the same shape as the reverse-caller guard that caught Aria — ask the
 * question from the direction the bug travels, because a checklist only covers
 * what its author already knew.
 *
 * ## Classification is per FILE, never per directory
 *
 * A directory-wide allowance would exempt every file added to it later, which
 * is precisely the case this is meant to catch. Each legitimate reader is named
 * with the reason it is allowed to reach the collection directly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage'])

/**
 * Files permitted to read `aiGenerations` directly, each with its reason.
 *
 * "It is infrastructure" is not a reason. The question every entry answers is:
 * why can this read the operation record without risking serving a teacher
 * their pre-edit plan?
 */
export const CLASSIFIED_DIRECT_READERS = Object.freeze({
  'functions/lessonPlanLibrary/resolveLessonPlanArtifact.js':
    'IS the resolver. Reads aiGenerations only after teacherLibraryItems is '
    + 'proven absent, and reads it under a pinned source for tickets.',
  'functions/accountDeletion.js':
    'Deletes by ownerUid across every collection. Never interprets a document '
    + 'as a lesson plan, so it cannot serve the wrong one.',
  'functions/aiOperations.js':
    'Operation administration — reserve/settle/resume. Reads the operation AS '
    + 'an operation, which is what the record is for.',
  'functions/agents/runners/pubo.js':
    'The publisher. Flips a reserved generation public after admin approval; '
    + 'reads it as an operation record, never as a lesson plan to render.',
  // ── Resume paths: a generator reading back its OWN result ──────────────
  // Each reads aiGenerations/{idempotencyKey} — the document IT wrote, keyed
  // by the operation it is resuming — to answer a duplicate request without a
  // second provider call. There is no teacher-edited version of a result the
  // teacher has not received yet, so no downgrade is possible.
  'functions/teacherTools/generateAssessment.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateFlashcards.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateHomework.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateRubric.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateSbaTask.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/regenerateAssessmentQuestion.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateSchemeOfWork.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/studioLessonPlan.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/reviseQuestion.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/reviseLessonSection.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/suggestAnswer.js': 'Resume path: reads back its own operation result.',
  'functions/teacherTools/generateWorksheet.js': 'Resume path: reads back its own operation result.',
})

/**
 * The readers this guard was BUILT to find, still unmigrated.
 *
 * Listed explicitly so the scanner is red on purpose rather than red by
 * accident, and so each one disappears from here as its migration lands. An
 * empty list is the completion condition.
 */
export const KNOWN_UNMIGRATED_READERS = Object.freeze({
  'functions/libraryDownload.js':
    'Ticket mint and stream both read aiGenerations directly and take '
    + 'output || data. After the split this serves the RAW model output for a '
    + 'plan the teacher edited. Migrate to resolveLessonPlanArtifact at mint '
    + 'and readPinnedArtifact at redemption.',
  'functions/teacherTools/generateNotes.js':
    'loadLessonPlan reads aiGenerations/{lessonPlanId}, and notesPlanSource '
    + 'prefers output over data — so notes would be generated from the plan '
    + 'the teacher rejected. Migrate to resolveLessonPlanArtifact.',
})

/**
 * Ways to reach `aiGenerations/{id}` in this codebase.
 *
 * The indirect form matters as much as the direct one: assigning the
 * collection to a variable and calling `.doc()` on it later is the shape a
 * reader takes once it grows past a few lines, and a pattern that only caught
 * the one-liner would pass exactly the files most worth checking.
 */
const DIRECT_PATTERNS = Object.freeze([
  // db.collection('aiGenerations').doc(...) / admin.firestore().collection(...)
  { id: 'collection-doc', re: /\.collection\(\s*["'`]aiGenerations["'`]\s*\)\s*\.\s*doc\s*\(/g },
  // db.doc(`aiGenerations/${id}`)
  { id: 'doc-path', re: /\.doc\(\s*[`"']aiGenerations\//g },
])

/**
 * `const generations = db.collection('aiGenerations')` … `generations.doc(id)`
 *
 * Tracked through the ASSIGNED VARIABLE rather than by looking for a nearby
 * `.get(`. A first version did the latter and reported cron.js, cbcKnowledge.js
 * and pubo.js — none of which read a generation document. Two were collection
 * QUERIES (`.where(...).get()`), one was a match whose window happened to span
 * an unrelated statement. Three false alarms out of eleven is how a guard
 * becomes something people switch off.
 */
function aliasedDocReads(text) {
  const hits = []
  const assign = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.collection\(\s*["'`]aiGenerations["'`]\s*\)/g
  let a
  while ((a = assign.exec(text)) !== null) {
    const name = a[1]
    const use = new RegExp(`\\b${name}\\s*\\.\\s*doc\\s*\\(`, 'g')
    let u
    while ((u = use.exec(text)) !== null) {
      if (!isRead(text, u.index)) continue
      hits.push({ pattern: 'collection-alias', line: text.slice(0, u.index).split('\n').length })
    }
  }
  return hits
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full)
  }
  return out
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Does this file read the collection in a way that could yield a lesson plan?
 *
 * `collection-alias` alone is not enough — a query for admin listing is not a
 * per-document artefact read. It counts only when the file ALSO calls `.doc(`
 * on something, which is the shape that resolves one plan.
 */
export function scanFileForDirectReads(absPath, root) {
  const rel = relative(root, absPath).split('\\').join('/')
  const text = stripComments(readFileSync(absPath, 'utf8'))
  const hits = []

  for (const { id, re } of DIRECT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      // WRITES are not the hazard. Every generator writes its own result to
      // aiGenerations/{idempotencyKey}; that is the design. The hazard is
      // READING a document and treating what comes back as a lesson plan,
      // because that is where the teacher's edits get silently skipped.
      if (!isRead(text, m.index)) continue
      hits.push({ pattern: id, line: text.slice(0, m.index).split('\n').length })
    }
  }
  hits.push(...aliasedDocReads(text))

  return hits.length ? { file: rel, hits } : null
}

/** Is this document reference read back, rather than written to? */
function isRead(text, at) {
  // A generous window: the ref is often built, awaited and read across a few
  // lines. Erring long risks a false positive, which surfaces as a
  // classification someone has to write — visible. Erring short risks a false
  // negative, which is silent, and silence is what this exists to prevent.
  const window = text.slice(at, at + 320)
  return /\.\s*get\s*\(/.test(window)
}

/** Every direct `aiGenerations` document read under `functions/`. */
export function scanLessonPlanArtifactReads(root) {
  return walk(join(root, 'functions'))
    .map((f) => scanFileForDirectReads(f, root))
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** The reads that are NOT classified — i.e. the ones that must be migrated. */
export function unclassifiedDirectReads(root) {
  return scanLessonPlanArtifactReads(root)
    .filter((r) => !Object.prototype.hasOwnProperty.call(CLASSIFIED_DIRECT_READERS, r.file))
}
