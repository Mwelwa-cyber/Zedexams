#!/usr/bin/env node
/**
 * scripts/seed-agent-jobs.mjs
 *
 * Drop a handful of sample `agentJobs` documents so the /admin/agents
 * dashboard renders something during Phase 1 development. This is a
 * one-off helper — never run it against the production project.
 *
 * Prerequisites:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   # The account must have Firestore write access to the target project.
 *
 * Usage:
 *   node scripts/seed-agent-jobs.mjs                # dry run, prints only
 *   node scripts/seed-agent-jobs.mjs --live         # writes to Firestore
 *   node scripts/seed-agent-jobs.mjs --live --clear # clear seeded docs first
 *
 * Notes:
 *   - Seeded docs carry `seed: true` so --clear can find them.
 *   - createdBy is set to 'system' to mark them as synthetic.
 */

const args = new Set(process.argv.slice(2))
const LIVE  = args.has('--live')
const CLEAR = args.has('--clear')

const SEED_JOBS = [
  {
    agentId: 'aria',
    department: 'content',
    status: 'awaiting_approval',
    input: {
      tool: 'lesson_plan',
      grade: '6',
      subject: 'Mathematics',
      topic: 'Adding fractions with unlike denominators',
      term: 2,
      brief: 'One 60-minute lesson aligned to CBC. Include warm-up, guided practice, and exit ticket.',
    },
    output: {
      draft: {
        title: 'Adding fractions with unlike denominators',
        objectives: [
          'Find equivalent fractions using LCM of denominators.',
          'Add two fractions with unlike denominators and simplify.',
        ],
        outline: ['Warm-up (5 min)', 'I do (15 min)', 'We do (15 min)', 'You do (20 min)', 'Exit ticket (5 min)'],
      },
      alignment: { aligned: true, citations: [{ outcome: 'M.6.2.1', text: 'Add fractions with unlike denominators.' }] },
      review:    { verdict: 'approve', severity: 'low', summary: 'Clean and age-appropriate. Ready to publish.' },
    },
  },
  {
    agentId: 'cala',
    department: 'content',
    status: 'running',
    input: {
      grade: '5',
      subject: 'Integrated Science',
      topic: 'States of matter',
    },
  },
  {
    agentId: 'quill',
    department: 'qaEng',
    status: 'done',
    input: { runType: 'nightly-smoke' },
    output: {
      ranAt: new Date().toISOString(),
      passed: ['check-file-integrity', 'test-question-schema', 'test-rich-text-sanitize'],
      failed: [],
      regressions: [],
    },
  },
]

async function main() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  if (!LIVE) {
    console.log('— Dry run. Pass --live to write to Firestore. —')
    SEED_JOBS.forEach((j, i) => console.log(`#${i + 1}`, JSON.stringify(j, null, 2)))
    return
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path')
    process.exit(1)
  }

  admin.default.initializeApp()
  const db = admin.default.firestore()
  const ts = admin.default.firestore.FieldValue.serverTimestamp()

  if (CLEAR) {
    const stale = await db.collection('agentJobs').where('seed', '==', true).get()
    if (!stale.empty) {
      const batch = db.batch()
      stale.forEach(d => batch.delete(d.ref))
      await batch.commit()
      console.log(`Cleared ${stale.size} previously-seeded jobs.`)
    }
  }

  const batch = db.batch()
  SEED_JOBS.forEach(job => {
    const ref = db.collection('agentJobs').doc()
    batch.set(ref, {
      ...job,
      seed: true,
      createdBy: 'system',
      createdAt: ts,
    })
  })
  await batch.commit()
  console.log(`Seeded ${SEED_JOBS.length} agent jobs.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
