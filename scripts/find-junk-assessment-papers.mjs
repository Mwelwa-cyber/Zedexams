#!/usr/bin/env node
/**
 * scripts/find-junk-assessment-papers.mjs
 *
 * Find the library papers that B-1 created — the ones nobody wrote.
 *
 * Until this was fixed, merely OPENING /teacher/assessment-papers/new filed a
 * paper in the teacher's library. The studio seeds one empty question so the
 * builder opens as something rather than a blank rectangle; the saved School
 * Profile then pre-brands the paper, which the dirty tracker could not tell
 * from a teacher typing; and the library autosave gated on the QUESTION COUNT,
 * which the seed had already made 1. Two seconds later a paper existed:
 *
 *     End-of-Term Test · Grade 4 · Integrated Science · T1 · 1 marks
 *     · 60 min · 1 questions      ← and that one question has no text
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN  (default)         Reads only. Lists candidates. No writes.
 *   LIVE     (--live --delete) Backs up each candidate to
 *                              backups/junk_assessment_papers/<id>, then
 *                              deletes the paper and its questions.
 *
 *   Run --live alone (no --delete) to verify the backups land cleanly first.
 *
 * ── The signature, and why it is drawn tightly ────────────────────────
 *
 * A paper is a candidate only when ALL of these hold:
 *
 *   • it has exactly one question, and
 *   • that question has no text, no options, no image, no explanation, no
 *     answer — nothing a person could have typed, and
 *   • the paper has no passages and no parts, and
 *   • its totalMarks is 1 or absent (the seeded default), and
 *   • its createdAt and updatedAt are within AUTOSAVE_WINDOW_MS of each other
 *
 * That last one is what separates the machine's papers from a teacher's. The
 * junk papers were written once by the autosave and never touched again, so
 * their two timestamps are seconds apart. A teacher who opened the studio,
 * created a paper and came back to it later has a gap. When a paper cannot be
 * told apart it is reported as a NEAR MISS and NOT proposed for deletion —
 * deleting a real paper is unrecoverable and being conservative here costs
 * nothing but a longer list to read.
 *
 * ── Prerequisites for LIVE mode ───────────────────────────────────────
 *
 *   npm install --save-dev firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   node scripts/find-junk-assessment-papers.mjs               # dry run
 *   node scripts/find-junk-assessment-papers.mjs --live        # backups only
 *   node scripts/find-junk-assessment-papers.mjs --live --delete
 *
 *   --json  writes the candidate list to junk-assessment-papers.json so the
 *           reviewed list can be diffed against a later run.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const DELETE = args.has('--delete')
const JSON_OUT = args.has('--json')

// How close createdAt and updatedAt have to be for a paper to read as
// "written once by a machine and never touched". The library autosave fires on
// a 2s debounce; 90s is generous enough to cover a slow write, a retry and a
// clock skew, and still far short of any session where a person did something.
const AUTOSAVE_WINDOW_MS = 90_000

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value._seconds === 'number') return value._seconds * 1000
  return null
}

// Strip HTML/Tiptap wrapping so "<p></p>" and '{"type":"doc","content":[]}'
// both read as empty. Deliberately crude — the question is only ever "is there
// anything here at all", and a crude reading errs towards NOT deleting.
function plainText(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    try { return plainText(JSON.stringify(value).replace(/"(type|attrs|marks|content)"/g, '')) }
    catch { return '' }
  }
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[{}[\]",:]/g, ' ')
    .replace(/\b(doc|paragraph|text|null|true|false)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function questionIsUntouched(q) {
  const filled = []
  if (plainText(q?.text)) filled.push('text')
  if (plainText(q?.sharedInstruction)) filled.push('sharedInstruction')
  if (plainText(q?.explanation)) filled.push('explanation')
  if (String(q?.topic ?? '').trim()) filled.push('topic')
  if (String(q?.imageUrl ?? '').trim()) filled.push('imageUrl')
  if (String(q?.diagramText ?? '').trim()) filled.push('diagramText')
  if ((q?.options || []).some((o) => String(o ?? '').trim())) filled.push('options')
  if ((q?.statements || []).some((s) => String(s?.text ?? '').trim())) filled.push('statements')
  const answer = q?.correctAnswer
  if (typeof answer === 'string' && answer.trim()) filled.push('correctAnswer')
  if (Array.isArray(answer) && answer.length) filled.push('correctAnswer')
  if ((q?.subParts || []).length) filled.push('subParts')
  if ((q?.labels || []).length) filled.push('labels')
  if (q?.tableData) filled.push('tableData')
  return { untouched: filled.length === 0, filled }
}

async function main() {
  console.log('▶ find-junk-assessment-papers  (B-1 library pollution)')
  console.log(`  mode: ${LIVE ? (DELETE ? 'LIVE + DELETE' : 'LIVE (backup only)') : 'DRY RUN (read-only)'}`)
  console.log('')

  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app')
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore')

  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credsPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(credsPath, 'utf8'))) })
  } else {
    initializeApp({ credential: applicationDefault() })
  }
  const db = getFirestore()

  const snap = await db.collection('assessments').get()
  console.log(`  scanned ${snap.size} assessment paper(s)`)

  const junk = []
  const nearMisses = []

  for (const doc of snap.docs) {
    const data = doc.data()

    // Cheap rejects first — most papers exit here without a subcollection read.
    if ((data.questionCount ?? 0) > 1) continue
    if ((data.passages || []).length) continue
    if ((data.parts || []).length) continue
    const marks = data.totalMarks ?? 1
    if (marks > 1) continue

    const qSnap = await db.collection('assessments').doc(doc.id).collection('questions').get()
    if (qSnap.size !== 1) continue

    const question = qSnap.docs[0].data()
    const { untouched, filled } = questionIsUntouched(question)
    if (!untouched) continue

    const createdAt = toMillis(data.createdAt)
    const updatedAt = toMillis(data.updatedAt) ?? createdAt
    const gap = createdAt != null && updatedAt != null ? Math.abs(updatedAt - createdAt) : null

    const row = {
      id: doc.id,
      title: data.title ?? '(untitled)',
      createdBy: data.createdBy ?? '(unknown)',
      grade: data.grade ?? '?',
      subject: data.subject ?? '?',
      term: data.term ?? '?',
      assessmentType: data.assessmentType ?? '?',
      totalMarks: marks,
      questionCount: qSnap.size,
      createdAt: createdAt ? new Date(createdAt).toISOString() : '(none)',
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : '(none)',
      editGapMs: gap,
      questionFields: filled,
    }

    // The discriminator. An untouched question is necessary but not
    // sufficient: a teacher can genuinely have a one-question paper in
    // progress, and theirs will have been touched more than once.
    if (gap == null) {
      row.reason = 'no usable timestamps — cannot prove nobody touched it'
      nearMisses.push(row)
    } else if (gap > AUTOSAVE_WINDOW_MS) {
      row.reason = `edited ${Math.round(gap / 1000)}s after creation — somebody came back to it`
      nearMisses.push(row)
    } else {
      junk.push(row)
    }
  }

  const line = (r) =>
    `  • ${r.id}\n`
    + `      ${r.title}\n`
    + `      ${r.assessmentType} · Grade ${r.grade} · ${r.subject} · ${r.term}`
    + ` · ${r.totalMarks} mark(s) · ${r.questionCount} question(s)\n`
    + `      createdBy: ${r.createdBy}\n`
    + `      created:   ${r.createdAt}\n`
    + `      updated:   ${r.updatedAt}`
    + (r.editGapMs != null ? `   (+${Math.round(r.editGapMs / 1000)}s)` : '')
    + (r.reason ? `\n      NOT PROPOSED: ${r.reason}` : '')

  console.log('')
  if (junk.length === 0) {
    console.log('✓ No junk papers matched the signature.')
  } else {
    console.log(`⚠ ${junk.length} paper(s) match the B-1 signature — PROPOSED FOR DELETION:`)
    console.log('')
    for (const r of junk) console.log(line(r) + '\n')
  }

  if (nearMisses.length) {
    console.log(`ℹ ${nearMisses.length} paper(s) are empty but NOT proposed — read these before deciding:`)
    console.log('')
    for (const r of nearMisses) console.log(line(r) + '\n')
  }

  const byTeacher = junk.reduce((acc, r) => {
    acc[r.createdBy] = (acc[r.createdBy] || 0) + 1
    return acc
  }, {})
  if (junk.length) {
    console.log('  per teacher:')
    for (const [uid, n] of Object.entries(byTeacher).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${uid}`)
    }
    console.log('')
  }

  if (JSON_OUT) {
    writeFileSync('junk-assessment-papers.json',
      JSON.stringify({ proposed: junk, nearMisses }, null, 2))
    console.log('  wrote junk-assessment-papers.json')
  }

  if (!LIVE) {
    console.log('Dry run — nothing was written or deleted.')
    console.log('Review the list above, then re-run with --live --delete.')
    return
  }

  console.log(`Backing up ${junk.length} paper(s) to backups/junk_assessment_papers/…`)
  for (const r of junk) {
    const paper = await db.collection('assessments').doc(r.id).get()
    const questions = await db.collection('assessments').doc(r.id).collection('questions').get()
    await db.collection('backups').doc('junk_assessment_papers').collection('docs').doc(r.id).set({
      paper: paper.data(),
      questions: questions.docs.map((d) => ({ id: d.id, ...d.data() })),
      _backedUpAt: FieldValue.serverTimestamp(),
      _signature: r,
    })
  }
  console.log('  backups written.')

  if (!DELETE) {
    console.log('--live without --delete: backups only, nothing removed.')
    return
  }

  for (const r of junk) {
    const questions = await db.collection('assessments').doc(r.id).collection('questions').get()
    const batch = db.batch()
    for (const q of questions.docs) batch.delete(q.ref)
    batch.delete(db.collection('assessments').doc(r.id))
    await batch.commit()
    console.log(`  deleted ${r.id}`)
  }
  console.log(`✓ removed ${junk.length} junk paper(s). Backups remain under backups/junk_assessment_papers.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
