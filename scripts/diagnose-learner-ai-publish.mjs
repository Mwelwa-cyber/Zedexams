/**
 * Diagnoses why approved learner-AI quizzes are not surfacing to learners.
 *
 * Run from a workstation that's authenticated against the examsprepzambia
 * project — either:
 *   - `firebase login` first (uses ADC), then `node scripts/diagnose-learner-ai-publish.mjs`
 *   - or `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/diagnose-learner-ai-publish.mjs`
 *
 * Output is plain text — pipe to a file if you want to share it.
 *
 * What it checks (in order):
 *   1. publish_skipped log entries in the last 14 days (these are the
 *      smoking gun when admin clicks Approve but no aiGeneratedContent
 *      doc was published).
 *   2. Tasks in 'approved' or 'published' status whose linked
 *      aiGeneratedContent doc is NOT actually status='published'.
 *   3. Distribution of the `grade` field across published
 *      aiGeneratedContent vs. learner profiles on users — if the
 *      strings don't match, the learner-side onSnapshot returns nothing.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'

let db
try {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) })
    console.log('auth: service account')
  } else {
    initializeApp()
    console.log('auth: application default')
  }
  db = getFirestore()
  db.settings({ projectId: 'examsprepzambia' })
} catch (err) {
  console.error('firebase init failed:', err.message)
  console.error('try: firebase login   OR   set GOOGLE_APPLICATION_CREDENTIALS')
  process.exit(1)
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000
const since = new Date(Date.now() - TWO_WEEKS_MS)

function hr(title) {
  console.log('\n' + '─'.repeat(72))
  console.log(title)
  console.log('─'.repeat(72))
}

async function checkPublishSkipped() {
  hr('1. publish_skipped log entries (last 14d)')
  const snap = await db.collection('aiAgentLogs')
    .where('action', '==', 'publish_skipped')
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
    .catch(async () => {
      // Fallback if createdAt index/field is missing — scan recent docs.
      return db.collection('aiAgentLogs')
        .where('action', '==', 'publish_skipped')
        .limit(50)
        .get()
    })
  if (snap.empty) {
    console.log('  none — approvals are not silently failing at the dispatcher')
    return
  }
  console.log(`  found ${snap.size} publish_skipped entries`)
  for (const d of snap.docs) {
    const row = d.data()
    console.log(`  · ${row.taskType || '?'}  G${row.grade || '?'} ${row.subject || ''} / ${row.topic || ''}  (taskId=${row.taskId || '?'})`)
  }
}

async function checkApprovedTasksWithoutPublishedContent() {
  hr('2. tasks marked approved/published whose content doc is not status=published')
  const taskSnap = await db.collection('aiAgentTasks')
    .where('taskType', 'in', ['practice_quiz', 'exam_quiz'])
    .where('status', 'in', ['approved', 'published'])
    .limit(200)
    .get()
  if (taskSnap.empty) {
    console.log('  no approved practice_quiz / exam_quiz tasks found')
    return
  }
  const bad = []
  for (const t of taskSnap.docs) {
    const task = t.data()
    const contentId = task.resultContentId
    if (!contentId) {
      bad.push({ taskId: t.id, contentId: null, contentStatus: '—', task })
      continue
    }
    const c = await db.collection('aiGeneratedContent').doc(contentId).get()
    const contentStatus = c.exists ? (c.data().status || 'unknown') : 'MISSING_DOC'
    if (contentStatus !== 'published') {
      bad.push({ taskId: t.id, contentId, contentStatus, task })
    }
  }
  console.log(`  checked ${taskSnap.size} tasks, ${bad.length} broken`)
  for (const b of bad.slice(0, 30)) {
    console.log(`  · task=${b.taskId} status=${b.task.status} → content=${b.contentId || '∅'} status=${b.contentStatus}  (${b.task.taskType} G${b.task.grade} ${b.task.topic || ''})`)
  }
  if (bad.length > 30) console.log(`  … ${bad.length - 30} more`)
}

async function checkGradeFieldShape() {
  hr('3. grade-field shape — content vs. learner profiles')

  const contentSnap = await db.collection('aiGeneratedContent')
    .where('status', '==', 'published')
    .where('type', 'in', ['practice_quiz', 'exam_quiz'])
    .limit(500)
    .get()
  const contentGrades = new Map()
  for (const d of contentSnap.docs) {
    const g = d.data().grade
    const key = `${typeof g}:${JSON.stringify(g)}`
    contentGrades.set(key, (contentGrades.get(key) || 0) + 1)
  }
  console.log(`  published quiz content (n=${contentSnap.size}):`)
  if (contentGrades.size === 0) {
    console.log('    NO published practice_quiz or exam_quiz content exists — learners cannot see anything because nothing is published.')
  } else {
    for (const [k, n] of [...contentGrades.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    grade=${k}  count=${n}`)
    }
  }

  const userSnap = await db.collection('users')
    .where('role', 'in', ['learner', 'student'])
    .limit(500)
    .get()
  const userGrades = new Map()
  for (const d of userSnap.docs) {
    const g = d.data().grade
    const key = `${typeof g}:${JSON.stringify(g)}`
    userGrades.set(key, (userGrades.get(key) || 0) + 1)
  }
  console.log(`\n  learner profiles (n=${userSnap.size}):`)
  if (userGrades.size === 0) {
    console.log('    no learner profiles with grade set')
  } else {
    for (const [k, n] of [...userGrades.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    grade=${k}  count=${n}`)
    }
  }

  const contentKeys = new Set(contentGrades.keys())
  const userKeys = new Set(userGrades.keys())
  const overlap = [...contentKeys].filter(k => userKeys.has(k))
  console.log(`\n  exact-match overlap (these are the grades learners will actually see content for): ${overlap.length ? overlap.join(', ') : 'NONE — this is the bug'}`)
}

async function main() {
  console.log(`scanning project=examsprepzambia  since=${since.toISOString()}`)
  await checkPublishSkipped()
  await checkApprovedTasksWithoutPublishedContent()
  await checkGradeFieldShape()
  console.log('\ndone.')
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
