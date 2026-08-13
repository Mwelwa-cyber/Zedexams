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
// Two roots, because the teacher surfaces are LEAVING the first one. Phase 4
// has moved eleven of them into `src/features/`, and a scan pinned to
// `src/components/teacher` would have quietly stopped covering each as it
// migrated — the ledger below would empty out and the check would report clean
// on a codebase it had stopped looking at. `printAffectingPaths.js` records the
// same failure in its own words: a pattern for a moved file protects nothing
// and reads exactly like one that works.
const SCAN_DIRS = [join(ROOT, 'src/components/teacher'), join(ROOT, 'src/features')]

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
  'src/features/assessmentStudio/pages/AssessmentStudio.jsx',
  // Printed curriculum REFERENCE tables (not selection pickers) — the subject
  // names ARE the content of the page.
  'src/features/curriculumBrowsers/pages/Primary2013Curriculum.jsx',
  'src/features/curriculumBrowsers/pages/PrimaryCurriculum.jsx',
  // Library filter surfaces (display/grouping, not curriculum selection).
  'src/components/teacher/SyllabiLibrary.jsx',
  'src/features/teacherLibrary/pages/TeacherLibrary.jsx',
])

/**
 * PRE-EXISTING holders that this check had never looked at, surfaced the moment
 * the scan widened to `src/features/` (see SCAN_DIRS above). None of them was
 * introduced by the migration that widened it.
 *
 * Kept as its own set rather than added to ALLOWLIST, because that ledger is
 * frozen and only shrinks — folding newly-visible debt into it would disguise
 * unexamined files as reviewed exceptions. This list is the honest shape:
 * countable, separately named, and each entry is a question nobody has
 * answered yet.
 *
 * ## When it may grow, and how that stays checkable
 *
 * It said "it must never grow", which was right about the failure it guards
 * against and wrong as an absolute — a Phase 4 migration MOVING a pre-existing
 * holder into `src/features/` surfaces old debt through no fault of its own,
 * which is the same event that created the first five entries. Refusing the
 * entry would leave two bad options: fix the file inside a pure-move PR, or
 * leave the module behind in `src/utils/` for the guard's convenience.
 *
 * So the rule is not a count, it is a claim that has to be true:
 *
 *   **an entry may be added only when the subject list already existed at the
 *   file's previous path**, verifiable with `git show <before>:<old-path>`.
 *
 * A NEW local subject list — written in a feature, or added to a file that did
 * not have one — is still a failure, and is what the check is for. It shrinks
 * the ordinary way, when someone converts an entry to `useCurriculumSelection`.
 */
const UNSCANNED_UNTIL_NOW = new Set([
  'src/features/notes/pages/AdminVisualNotesGenerator.jsx',
  'src/features/notes/pages/LearnerNoteRead.jsx',
  'src/features/notes/components/NoteCard.jsx',
  'src/features/learnerSettings/lib/learnerPrefs.js',
  'src/features/classTimetable/lib/timetableCoverage.js',
  // Arrived with the image-pipeline admin move. Its subject keys predate that
  // migration — verified against the file at its `src/utils/` path, where the
  // same six `subject:` values were already present.
  'src/features/visualStudio/lib/pictureBankStarterPack.js',
  // Arrived with the past-papers move. The subjects are in the CURATED SAMPLE
  // SET the hub falls back to when Firestore returns nothing, so the archive
  // is never blank — they are fixture data, not a picker's option list, which
  // is why converting this one to `useCurriculumSelection` is not the fix it
  // is for the entries above. They predate the migration: diffing the moved
  // file against `src/components/papers/PastPapersHub.jsx` at its old path
  // shows only import lines changed.
  'src/features/papers/pages/PastPapersHub.jsx',
  // Arrived with the learner-dashboard move. Both are LEARNER surfaces, not
  // teacher studios, and neither holds a picker's option list: the subject
  // names appear in display mappings (icon and label lookups keyed by the
  // subject a result already carries). Verified to predate the migration
  // rather than assumed —
  //   git show <base>:src/components/dashboard/MyResults.jsx
  //     → 'Integrated Science', 'Social Studies'
  //   git show <base>:src/components/dashboard/StudentDashboard.jsx
  //     → 'English', 'Integrated Science', 'Science', 'Social Studies'
  // The same values are present at the old path, so the move brought them
  // into scan scope; it did not introduce them.
  'src/features/learnerDashboard/pages/MyResults.jsx',
  'src/features/learnerDashboard/pages/StudentDashboard.jsx',
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
for (const file of SCAN_DIRS.flatMap(walk)) {
  const text = readFileSync(file, 'utf8')
  const distinct = new Set(SUBJECT_SENTINELS.filter((s) => text.includes(s)))
  if (distinct.size >= THRESHOLD) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
    offenders.push(rel)
  }
}

check('every teacher file with a hard-coded subject list is on the frozen ledger', () => {
  const unexpected = offenders.filter((f) => !ALLOWLIST.has(f) && !UNSCANNED_UNTIL_NOW.has(f))
  assert.deepEqual(
    unexpected,
    [],
    `New hard-coded subject list(s) found in a teacher studio.\n` +
      `Use the canonical catalogue (src/config/curriculumCatalog.js) via\n` +
      `useCurriculumSelection instead of a local subject array:\n  ` +
      unexpected.join('\n  '),
  )
})

check('neither ledger has gone stale (every entry still holds a subject list)', () => {
  const stale = [...ALLOWLIST, ...UNSCANNED_UNTIL_NOW].filter((f) => !offenders.includes(f))
  assert.deepEqual(
    stale,
    [],
    `These files are on the local-subject-list ledger but no longer match — ` +
      `remove them from ALLOWLIST or UNSCANNED_UNTIL_NOW in this test:\n  ${stale.join('\n  ')}`,
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
