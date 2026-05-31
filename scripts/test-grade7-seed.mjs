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

test('42 notes (17 Science + 25 Social Studies), 41 quiz banks', () => {
  assert(bundle.notes.length === 42, `notes=${bundle.notes.length}`)
  const bySubject = bundle.notes.reduce((m, n) => ((m[n.subject] = (m[n.subject] || 0) + 1), m), {})
  assert(bySubject['Integrated Science'] === 17, `Integrated Science=${bySubject['Integrated Science']}`)
  assert(bySubject['Social Studies'] === 25, `Social Studies=${bySubject['Social Studies']}`)
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

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.e.stack || f.e.message}`); process.exit(1) }
