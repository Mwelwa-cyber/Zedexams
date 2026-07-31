#!/usr/bin/env node
/* global console, process */
/**
 * Behavioural tests for the library smart-folder rules and indexes, against the
 * real Firestore emulator.
 *
 * Two things can only be proven here:
 *
 *   1. The rules ACTUALLY reject what they claim to — an invalid enum, a
 *      school-scoped write, a cross-author write, a rewritten `createdBy` — and
 *      actually still allow the legacy writes every unmigrated studio makes.
 *      The text checks in test:library-indexes pin the strings; this pins the
 *      decisions.
 *   2. Every query the builders can emit RUNS. A missing composite index is a
 *      FAILED_PRECONDITION at query time, in a teacher's browser, on a folder
 *      that has always worked before — so the queries are executed here rather
 *      than reasoned about.
 *
 * Run: npm run test:library-rules-emulator
 * (which wraps this in `firebase emulators:exec --only firestore`)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  collection, doc, getCountFromServer, getDocs, limit as fsLimit,
  orderBy as fsOrderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore'

// The contracts under test — imported, never re-typed. A hand-copied query list
// here would drift from the builders and go on passing while teachers saw
// missing-index errors.
import { STUDIOS, STUDIO_BY_ID } from '../src/lib/library/studios.js'
import {
  LIBRARY_META_FIELD,
  buildDocumentListQuery,
  buildFolderCountQueries,
  buildNeedsSortingQuery,
  metaPath,
} from '../src/lib/library/queries.js'
import { LIBRARY_TYPES } from '../src/config/library.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')

const PROJECT_ID = 'examsprepzambia-test'
const TEACHER_A = 'lib_teacher_a'
const TEACHER_B = 'lib_teacher_b'

const verifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: true })

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function section(label) {
  console.log(`\n${label}`)
}

/** A valid metadata block, as `saveLibraryDocument` would stamp one. */
const meta = (uid, overrides = {}) => ({
  createdBy: uid,
  studio: LIBRARY_TYPES.LESSON_PLANS,
  curriculum: 'cbc',
  grade: 'grade-4',
  term: 2,
  subject: 'mathematics',
  academicYear: 2026,
  title: 'Fractions',
  status: 'draft',
  libraryState: 'classified',
  classificationState: 'complete',
  libraryMetaVersion: 1,
  metaSource: 'user_set',
  scope: 'personal',
  schoolId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

/** A client-creatable aiGenerations document, with the library block attached. */
const generation = (uid, metaOverrides = {}) => ({
  ownerUid: uid,
  tool: 'class_timetable',
  status: 'complete',
  visibility: 'private',
  createdAt: new Date(),
  inputs: {},
  output: {},
  [LIBRARY_META_FIELD]: meta(uid, { studio: LIBRARY_TYPES.CLASS_TIMETABLES, ...metaOverrides }),
})

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:library-rules-emulator`.',
    )
  }
  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port: Number(portStr) || 8080, rules: readFileSync(RULES_PATH, 'utf8') },
  })

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', TEACHER_A), { role: 'teacher' })
    await setDoc(doc(db, 'users', TEACHER_B), { role: 'teacher' })
  })

  const teacherA = testEnv.authenticatedContext(TEACHER_A, verifiedToken(TEACHER_A)).firestore()
  const teacherB = testEnv.authenticatedContext(TEACHER_B, verifiedToken(TEACHER_B)).firestore()

  /* ── Writes ──────────────────────────────────────────────── */

  section('library metadata — writes')

  await test('a valid block is accepted', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'aiGenerations', 'lib_ok'), generation(TEACHER_A)))
  })

  await test('a legacy write with no library block still works', async () => {
    // Every studio is unmigrated until step 3+. If this ever fails, the whole
    // teacher library has stopped saving.
    await assertSucceeds(setDoc(doc(teacherA, 'aiGenerations', 'lib_legacy'), {
      ownerUid: TEACHER_A,
      tool: 'class_timetable',
      status: 'complete',
      visibility: 'private',
      createdAt: new Date(),
      inputs: {},
      output: {},
    }))
  })

  await test('an unknown grade id is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_grade'),
      generation(TEACHER_A, { grade: 'Grade 4' })))  // the LABEL, not the id
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_grade2'),
      generation(TEACHER_A, { grade: 'grade-99' })))
  })

  await test('an unknown curriculum is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_curr'),
      generation(TEACHER_A, { curriculum: 'CBC' })))
  })

  await test('a term outside 1–3, or a term as a string, is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_term'),
      generation(TEACHER_A, { term: 4 })))
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_term2'),
      generation(TEACHER_A, { term: 'Term 2' })))
  })

  await test('explicit nulls are accepted for every dimension', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'aiGenerations', 'lib_nulls'), generation(TEACHER_A, {
      curriculum: null, grade: null, term: null, subject: null,
      classificationState: 'needs_sorting',
    })))
  })

  await test('an unknown libraryState or classificationState is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_state'),
      generation(TEACHER_A, { libraryState: 'published' })))
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_bad_class'),
      generation(TEACHER_A, { classificationState: 'unsorted' })))
  })

  await test('scope: "school" is rejected until a membership model exists', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_school_scope'),
      generation(TEACHER_A, { scope: 'school' })))
  })

  await test('a non-null schoolId is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_school_id'),
      generation(TEACHER_A, { schoolId: 'school_1' })))
  })

  await test('a document authored as someone else is rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'lib_wrong_author'),
      generation(TEACHER_A, { createdBy: TEACHER_B })))
  })

  await test('createdBy is immutable on update', async () => {
    await assertFails(updateDoc(doc(teacherA, 'aiGenerations', 'lib_ok'), {
      [metaPath('createdBy')]: TEACHER_B,
    }))
  })

  await test('another teacher cannot write to my library document', async () => {
    await assertFails(updateDoc(doc(teacherB, 'aiGenerations', 'lib_ok'), {
      [metaPath('grade')]: 'grade-5',
    }))
  })

  await test('refiling my own document is allowed, as a named-field merge', async () => {
    await assertSucceeds(updateDoc(doc(teacherA, 'aiGenerations', 'lib_ok'), {
      [metaPath('grade')]: 'grade-5',
      [metaPath('term')]: 3,
      [metaPath('updatedAt')]: new Date(),
    }))
  })

  await test('an assessment carries the same block under the same rules', async () => {
    const assessment = {
      createdBy: TEACHER_A,
      title: 'End of term test',
      grade: 'G4',        // the assessments vocabulary, untouched
      term: 'Term 2',     // …a STRING here, which is why the block is nested
      subject: 'Mathematics',
      [LIBRARY_META_FIELD]: meta(TEACHER_A, { studio: LIBRARY_TYPES.ASSESSMENTS }),
    }
    await assertSucceeds(setDoc(doc(teacherA, 'assessments', 'lib_assessment'), assessment))
    await assertFails(setDoc(doc(teacherA, 'assessments', 'lib_assessment_bad'), {
      ...assessment,
      [LIBRARY_META_FIELD]: meta(TEACHER_A, {
        studio: LIBRARY_TYPES.ASSESSMENTS, scope: 'school',
      }),
    }))
  })

  /* ── Queries + indexes ───────────────────────────────────── */

  section('library queries — every emitted shape runs')

  // Seed a realistic spread so the queries have something to match.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const studio of STUDIOS.filter((s) => !s.readOnly)) {
      // Both owner fields are seeded so one fixture serves both collections;
      // the queries only ever read the studio's declared `ownerField`.
      const owner = { ownerUid: TEACHER_A, createdBy: TEACHER_A }
      for (let i = 0; i < 2; i += 1) {
        await setDoc(doc(db, studio.collection, `seed_${studio.id}_${i}`), {
          ...owner,
          [LIBRARY_META_FIELD]: meta(TEACHER_A, {
            studio: studio.id,
            grade: i === 0 ? 'grade-4' : 'grade-5',
          }),
        })
      }
      await setDoc(doc(db, studio.collection, `seed_${studio.id}_unsorted`), {
        ...owner,
        [LIBRARY_META_FIELD]: meta(TEACHER_A, {
          studio: studio.id, grade: null, classificationState: 'needs_sorting',
        }),
      })
    }
  })

  const run = (db, descriptor) => {
    const constraints = descriptor.filters.map(([field, op, value]) => where(field, op, value))
    if (descriptor.kind === 'count') {
      return getCountFromServer(query(collection(db, descriptor.collection), ...constraints))
    }
    return getDocs(query(
      collection(db, descriptor.collection),
      ...constraints,
      ...descriptor.orderBy.map(([field, dir]) => fsOrderBy(field, dir)),
      fsLimit(descriptor.limit),
    ))
  }

  for (const studio of STUDIOS.filter((s) => !s.readOnly)) {
    // Walk the studio's full hierarchy, fanning out at each level, exactly as a
    // teacher drilling down would.
    const path = {}
    const levels = [{}, ...studio.hierarchy.map((dim, i) => ({ dim, i }))]
    await test(`${studio.id}: counts + lists run at every level`, async () => {
      for (const level of levels) {
        for (const academicYear of [2026, null]) {
          const counts = buildFolderCountQueries(studio, path, { createdBy: TEACHER_A, academicYear })
          for (const descriptor of counts) await run(teacherA, descriptor)
          await run(teacherA, buildDocumentListQuery(studio, path, {
            createdBy: TEACHER_A, academicYear,
          }))
        }
        if (level.dim) {
          path[level.dim] = { curriculum: 'cbc', grade: 'grade-4', term: 2, subject: 'mathematics' }[level.dim]
        }
      }
      await run(teacherA, buildNeedsSortingQuery(studio, { createdBy: TEACHER_A }))
      await run(teacherA, buildNeedsSortingQuery(studio, { createdBy: TEACHER_A, academicYear: 2026 }))
    })
  }

  await test('the Unsorted count is one number, not one per missing field', async () => {
    const studio = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
    // The seeded unsorted document is missing curriculum? No — only grade. Add
    // one missing three, and prove the bucket still counts each document once.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), studio.collection, 'seed_three_missing'), {
        ownerUid: TEACHER_A,
        createdBy: TEACHER_A,
        [LIBRARY_META_FIELD]: meta(TEACHER_A, {
          studio: studio.id,
          curriculum: null, grade: null, term: null,
          classificationState: 'needs_sorting',
        }),
      })
    })
    const [unsorted] = buildFolderCountQueries(studio, {}, { createdBy: TEACHER_A })
      .filter((d) => d.bucket === 'unsorted')
    const snap = await run(teacherA, unsorted)
    // Two documents need sorting: one missing a grade, one missing three fields.
    if (snap.data().count !== 2) {
      throw new Error(`expected 2 needs-sorting documents, got ${snap.data().count}`)
    }
  })

  await test('working and archived documents are in no folder count', async () => {
    const studio = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      for (const state of ['working', 'archived']) {
        await setDoc(doc(db, studio.collection, `seed_${state}`), {
          ownerUid: TEACHER_A,
          createdBy: TEACHER_A,
          [LIBRARY_META_FIELD]: meta(TEACHER_A, { studio: studio.id, libraryState: state }),
        })
      }
    })
    const gradeCounts = buildFolderCountQueries(studio, { curriculum: 'cbc' }, { createdBy: TEACHER_A })
    const grade4 = gradeCounts.find((d) => d.value === 'grade-4')
    const snap = await run(teacherA, grade4)
    // Only the one classified Grade 4 seed — never the working or archived ones.
    if (snap.data().count !== 1) {
      throw new Error(`expected 1 classified Grade 4 document, got ${snap.data().count}`)
    }
  })

  await test('one teacher never sees another teacher’s counts', async () => {
    const studio = STUDIO_BY_ID[LIBRARY_TYPES.LESSON_PLANS]
    const [descriptor] = buildFolderCountQueries(studio, {}, { createdBy: TEACHER_B })
    const snap = await run(teacherB, descriptor)
    if (snap.data().count !== 0) {
      throw new Error(`teacher B sees ${snap.data().count} of teacher A's documents`)
    }
  })

  await testEnv.cleanup()

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) {
    console.error('\nFailures:')
    for (const f of failures) console.error(`  • ${f.name}: ${f.message}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
