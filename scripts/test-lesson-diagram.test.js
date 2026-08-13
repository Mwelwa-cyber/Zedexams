#!/usr/bin/env node
/**
 * Lesson Plan Studio — black-and-white drawing feature.
 *
 * Guards three things that can silently regress:
 *   1. buildLessonDiagramPrompt() auto-derives a sensible prompt from the
 *      lesson's topic/sub-topic/subject/grade (the "auto from topic" UX).
 *   2. The PDF/print HTML embeds the drawing as an <img> (with an escaped URL)
 *      only when plan.lessonDiagram is present.
 *   3. buildLessonPlanDocument() embeds the drawing when given the pre-fetched
 *      bytes, and degrades to a visible note (never throws) when it can't.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 * Run: npm run test:lesson-diagram
 */

import assert from 'node:assert/strict'
import { buildLessonDiagramPrompt } from '../src/utils/lessonDiagramPrompt.js'
import { buildPrintableHtml } from '../src/engines/export-engine/lessonPlanToPdf.js'
import { buildLessonPlanDocument } from '../src/engines/export-engine/lessonPlanToDocx.js'

let pass = 0
let fail = 0
function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

/* ── 1. Prompt auto-derivation ─────────────────────────────────── */

test('buildLessonDiagramPrompt is empty without a topic', () => {
  assert.equal(buildLessonDiagramPrompt({}), '')
  assert.equal(buildLessonDiagramPrompt({ subject: 'mathematics', grade: 'G5' }), '')
})

test('buildLessonDiagramPrompt weaves topic, sub-topic, grade and subject', () => {
  const p = buildLessonDiagramPrompt({
    topic: 'Fractions',
    subtopic: 'Adding Fractions with Unlike Denominators',
    subject: 'mathematics',
    grade: 'G5',
  })
  assert.match(p, /Fractions/)
  assert.match(p, /Adding Fractions with Unlike Denominators/)
  assert.match(p, /Grade 5/)
  assert.match(p, /Mathematics/)
})

test('buildLessonDiagramPrompt does not request embedded text/colour', () => {
  // The server adds the "clean B&W line art, no text labels" guard — this
  // prompt must stay a plain WHAT-to-draw description.
  const p = buildLessonDiagramPrompt({ topic: 'Water cycle', subject: 'science', grade: 'G7' })
  assert.doesNotMatch(p, /black and white|colou?r|line art/i)
})

/* ── 2. PDF/print HTML embedding ───────────────────────────────── */

const v3Plan = {
  schemaVersion: '3.0',
  header: { topic: 'The Water Cycle', subject: 'Science' },
  stages: [{ name: 'INTRODUCTION', durationMinutes: 5, teacherActivities: ['Greet'], learnerActivities: ['Respond'] }],
}

test('PDF HTML omits the figure when there is no drawing', () => {
  const html = buildPrintableHtml(v3Plan, 'Lesson')
  assert.doesNotMatch(html, /<img/)
})

test('PDF HTML embeds the drawing with an escaped URL + caption', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/x.png?alt=media&token=abc'
  const plan = { ...v3Plan, lessonDiagram: { url, prompt: 'Water cycle diagram', size: '1365x1024' } }
  const html = buildPrintableHtml(plan, 'Lesson')
  assert.match(html, /<img /)
  // & in the query string must be HTML-escaped inside the attribute.
  assert.match(html, /alt=media&amp;token=abc/)
  assert.match(html, /Water cycle diagram/)
  assert.match(html, /TEACHING ILLUSTRATION/)
})

test('PDF HTML embeds the drawing for legacy (v1) plans too', () => {
  const legacy = {
    header: { topic: 'Shapes' },
    specificOutcomes: ['Identify shapes'],
    lessonDevelopment: { introduction: { durationMinutes: 5, teacherActivities: [], pupilActivities: [] } },
    lessonDiagram: { url: 'https://example.com/a.png', prompt: 'A square and a circle' },
  }
  const html = buildPrintableHtml(legacy, 'Lesson')
  assert.match(html, /<img /)
  assert.match(html, /Teaching Illustration/)
})

/* ── 3. DOCX embedding (sync builder) ──────────────────────────── */

// A 1x1 transparent PNG — enough bytes for docx's ImageRun to embed.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

test('DOCX builds with an embedded drawing (bytes supplied)', () => {
  const plan = { ...v3Plan, lessonDiagram: { url: 'https://example.com/a.png', prompt: 'Water cycle', size: '1365x1024' } }
  const doc = buildLessonPlanDocument(plan, { diagramImage: { bytes: TINY_PNG, type: 'png' } })
  assert.ok(doc, 'expected a Document')
})

test('DOCX degrades gracefully when the drawing bytes are missing', () => {
  const plan = { ...v3Plan, lessonDiagram: { url: 'https://example.com/a.png', prompt: 'Water cycle' } }
  // No diagramImage in opts (fetch failed / not run) — must not throw.
  const doc = buildLessonPlanDocument(plan, {})
  assert.ok(doc, 'expected a Document')
})

console.log(`\nlesson-diagram: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
