/**
 * CI guard: no NEW hard-coded subject list may appear in a teacher studio.
 *
 * Curriculum/subject selection is fragmented (docs/architecture/06-curriculum-
 * architecture.md). The canonical catalogue (src/config/curriculumCatalog.js)
 * + shared hook (src/hooks/useCurriculumSelection.js) are the ONE source every
 * studio must use. This guard freezes the currently-known local subject lists
 * and fails the build if any OTHER teacher file starts hard-coding a subject
 * array — so the fragmentation can only shrink, never grow.
 *
 * The allowlist below is intentionally a debt ledger: each entry is a file that
 * still owns a local subject list and must migrate to the catalogue. Removing a
 * file from the allowlist (after it migrates) is expected; ADDING one requires a
 * deliberate edit here and a justification in review.
 *
 * Run: node scripts/test-curriculum-canon.mjs  (or `npm run test:curriculum-canon`)
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIR = join(ROOT, 'src/components/teacher')

// Distinct subject sentinels — labels + canonical slugs. A file that references
// ≥4 of these is almost certainly carrying its own subject list.
const SUBJECT_SENTINELS = [
  'Integrated Science', 'Expressive Art', 'Social Studies', 'Home Economics',
  'Technology Studies', 'integrated_science', 'expressive_arts', 'social_studies',
  'home_economics', 'zambian_language', "'english'", "'mathematics'",
]
const THRESHOLD = 4

// Frozen debt ledger — teacher files that still legitimately/legacy-hold a
// subject list. Migrating a studio to the catalogue should DELETE its entry.
// Adding an entry is a red flag reviewers must justify.
const ALLOWLIST = new Set([
  // Label/key plumbing + static taxonomy the catalogue itself builds on.
  'src/components/teacher/paperTaxonomy.js',
  // MIGRATED, entries deleted (see git history for this file):
  //   assessmentStudioMeta.js  — STUDIO_SUBJECTS / STUDIO_GRADES now derive
  //     from src/config/canonicalEducation.js.
  //   assessmentDeepLink.js    — the slug→label table is gone; it resolves
  //     through the canonical model.
  // Studio shell that re-exports the meta lists (STUDIO_SUBJECTS) — tracked for
  // migration onto the catalogue.
  'src/components/teacher/AssessmentStudio.jsx',
  // Printed curriculum REFERENCE tables (not selection pickers) — the subject
  // names ARE the content of the page.
  'src/components/teacher/curriculum/Primary2013Curriculum.jsx',
  'src/components/teacher/curriculum/PrimaryCurriculum.jsx',
  // Library filter surfaces (display/grouping, not curriculum selection).
  'src/components/teacher/SyllabiLibrary.jsx',
  'src/components/teacher/library/TeacherLibrary.jsx',
])

function walk(dir) {
  let out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) out = out.concat(walk(p))
    else if (/\.(jsx?|mjs)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(p)
  }
  return out
}

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('curriculum canon guard — no NEW local subject lists in teacher studios')

const offenders = []
for (const file of walk(SCAN_DIR)) {
  const text = readFileSync(file, 'utf8')
  const distinct = new Set(SUBJECT_SENTINELS.filter((s) => text.includes(s)))
  if (distinct.size >= THRESHOLD) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    offenders.push(rel)
  }
}

check('every teacher file with a hard-coded subject list is on the frozen ledger', () => {
  const unexpected = offenders.filter((f) => !ALLOWLIST.has(f))
  assert.deepEqual(
    unexpected,
    [],
    `New hard-coded subject list(s) found in a teacher studio.\n` +
      `Use the canonical catalogue (src/config/curriculumCatalog.js) via\n` +
      `useCurriculumSelection instead of a local subject array:\n  ` +
      unexpected.join('\n  '),
  )
})

check('the allowlist has not gone stale (every entry still holds a subject list)', () => {
  const stale = [...ALLOWLIST].filter((f) => !offenders.includes(f))
  assert.deepEqual(
    stale,
    [],
    `These files are on the local-subject-list ledger but no longer match — ` +
      `remove them from ALLOWLIST in this test:\n  ${stale.join('\n  ')}`,
  )
})

console.log('curriculum canon guard — the canonical API exists + is complete')

check('curriculumCatalog exports the full public interface', async () => {
  const cat = await import('../src/config/curriculumCatalog.js')
  for (const fn of [
    'getCurricula', 'getGradesForCurriculum', 'getSubjectsForGrade',
    'getTopicsForSubject', 'getSubtopicsForTopic', 'validateCurriculumSelection',
    'normalizeCurriculumId', 'normalizeGradeId', 'normalizeSubjectId',
    'getStudioSubjectIds', 'registerTopicProvider',
  ]) {
    assert.equal(typeof cat[fn], 'function', `curriculumCatalog.${fn} must be exported`)
  }
  assert.equal(typeof cat.CATALOGUE_SCHEMA_VERSION, 'string')
})

console.log(`\n✅ curriculum-canon: ${passed} checks passed (${offenders.length} ledgered files)`)
