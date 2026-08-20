#!/usr/bin/env node
/**
 * Validates the committed Grade-7 seed bundle (src/features/notes/seed/
 * grade7ScienceSeed.json) that the admin importer ships:
 *   - notes' blocks pass the study-note write schema (Firestore-safe);
 *   - every quiz item converts to a valid question via the same rowToQuestion
 *     path the CSV importer + seedImport.js use (no dropped questions);
 *   - each quiz-linked note references an existing quiz bank;
 *   - every referenced diagram exists in public/notes/.
 *
 * Run: npm run test:grade7-seed  (also via npm run test:all)
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { studyBlocksWriteSchema } = await import('../src/features/notes/lib/studySchema.js')
const { rowToQuestion } = await import('../src/utils/csvQuizImport.js')

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = JSON.parse(readFileSync(join(REPO, 'src/features/notes/seed/grade7Seed.json'), 'utf8'))

let pass = 0, fail = 0
const failures = []
function test(name, fn) { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; failures.push({ name, e }); console.log(`  XX  ${name} — ${e.message}`) } }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed') }

// Mirrors buildSeedQuestions' item→CSV-row mapping in seedImport.js (kept in sync).
function itemToRow(it, topic) {
  const opts = Array.isArray(it.options) ? it.options : []
  const letter = 'ABCD'[it.answer] || String((Number(it.answer) || 0) + 1)
  return ['mcq', String(it.q || ''), String(opts[0] || ''), String(opts[1] || ''), String(opts[2] || ''), String(opts[3] || ''),
    letter, '', topic || '', '1', '', String(it.explanation || ''), it.image ? `/notes/${it.image}` : '']
}

console.log('\ngrade-7 seed bundle')

test('43 notes (17 Science + 25 Social Studies + 1 English), 41 quiz banks', () => {
  assert(bundle.notes.length === 43, `notes=${bundle.notes.length}`)
  const bySubject = bundle.notes.reduce((m, n) => ((m[n.subject] = (m[n.subject] || 0) + 1), m), {})
  assert(bySubject['Integrated Science'] === 17, `Integrated Science=${bySubject['Integrated Science']}`)
  assert(bySubject['Social Studies'] === 25, `Social Studies=${bySubject['Social Studies']}`)
  // Conjunctions — the reader engine's reference note, and the only
  // English content published so far. It was written as a test fixture and
  // rendered by nothing but a spec and a preview page, so the topic row
  // for it said "Note coming soon" about a note that existed.
  assert(bySubject.English === 1, `English=${bySubject.English}`)
  assert(Object.keys(bundle.quizzes).length === 41, `quizzes=${Object.keys(bundle.quizzes).length}`)
})

test('every note has Firestore-safe study blocks (write schema)', () => {
  for (const n of bundle.notes) {
    const r = studyBlocksWriteSchema.safeParse(n.blocks)
    assert(r.success, `${n.seedKey}: ${r.error?.issues?.[0]?.message}`)
  }
})

test('every quiz item converts cleanly — no dropped questions (355 total)', () => {
  let total = 0
  for (const [key, items] of Object.entries(bundle.quizzes)) {
    for (const it of items) {
      const res = rowToQuestion(itemToRow(it, key))
      assert(res.status !== 'error', `${key}: ${res.errors?.[0]}`)
      assert(res.question.correctAnswer === it.answer, `${key}: answer index drifted (${res.question.correctAnswer} vs ${it.answer})`)
      total++
    }
  }
  assert(total === 355, `expected 355 questions, got ${total}`)
})

test('each quiz-linked note references an existing quiz bank (41)', () => {
  let linked = 0
  for (const n of bundle.notes) {
    for (const b of n.blocks) {
      if (b.type === 'quiz' && b.quizKey) {
        assert(bundle.quizzes[b.quizKey], `${n.seedKey} → missing bank "${b.quizKey}"`)
        linked++
      }
    }
  }
  assert(linked === 41, `expected 41 linked, got ${linked}`)
})

test('Social Studies notes carry their diagrams (≥30 image blocks across ≥24 notes)', () => {
  const ss = bundle.notes.filter((n) => n.subject === 'Social Studies')
  const withImg = ss.filter((n) => n.blocks.some((b) => b.type === 'image' && b.url))
  const totalImg = ss.reduce((s, n) => s + n.blocks.filter((b) => b.type === 'image' && b.url).length, 0)
  assert(totalImg >= 30, `Social Studies image blocks=${totalImg} (expected ≥30)`)
  assert(withImg.length >= 24, `Social Studies notes with a diagram=${withImg.length} (expected ≥24)`)
})

test('all referenced diagrams exist in public/notes/', () => {
  const imgs = new Set()
  for (const n of bundle.notes) for (const b of n.blocks) if (b.type === 'image' && b.url) imgs.add(b.url)
  for (const items of Object.values(bundle.quizzes)) for (const it of items) if (it.image) imgs.add(`/notes/${it.image}`)
  assert(imgs.size > 0, 'expected at least one diagram reference')
  for (const u of imgs) {
    assert(u.startsWith('/notes/'), `bad image url "${u}"`)
    assert(existsSync(join(REPO, 'public', u.replace(/^\//, ''))), `missing public${u}`)
  }
})

test('digestive label diagram: Small intestine is the LEFT slot, Large the RIGHT', () => {
  // The committed diagram (g7-sci-1-1-label.jpg) draws its left-column leader
  // line into the coiled central mass (the small intestine) and its right-column
  // line onto the framing colon (the large intestine). The seed once had the two
  // slots swapped, so a learner who labelled the diagram correctly was marked
  // wrong on both — this pins slot side to label so that cannot come back.
  const blocks = bundle.notes.flatMap((n) => n.blocks)
  const ld = blocks.find((b) => b.type === 'labeldiagram' && b.url === '/notes/g7-sci-1-1-label.jpg')
  assert(ld, 'digestive labeldiagram block missing')
  const byLabel = Object.fromEntries(ld.items.map((it) => [it.label, it]))
  const small = byLabel['Small intestine']
  const large = byLabel['Large intestine']
  assert(small && large, 'intestine slots missing')
  assert(small.x < 0.5, `Small intestine slot must sit in the left column (x=${small?.x})`)
  assert(large.x > 0.5, `Large intestine slot must sit in the right column (x=${large?.x})`)
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.e.stack || f.e.message}`); process.exit(1) }
