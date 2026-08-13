#!/usr/bin/env node
/**
 * Validates the Grade 4 English "Contractions" sample lesson against the
 * slide-based lesson schema it ships with.
 * Run: npm run test:contractions-lesson
 *
 * The lesson is authored as a content module the way SAMPLE_RESPIRATORY_LESSON
 * is, so this test guards that it stays a valid, loadable lesson: correct
 * CBC metadata, an end slide, and activities/answers that point at real slides.
 */

import {
  GRADE4_CONTRACTIONS_LESSON,
  GRADE4_CONTRACTIONS_QUICK_NOTES,
} from '../src/features/lessons/lib/grade4ContractionsLesson.js'
import { LESSON_SCHEMA_VERSION, SLIDE_TYPE_MAP } from '../src/features/lessons/lib/lessonConstants.js'
import { LESSON_GRADES, LESSON_SUBJECTS, LESSON_TERMS } from '../src/features/lessons/lib/lessonConstants.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const lesson = GRADE4_CONTRACTIONS_LESSON

console.log('\ngrade-4 contractions lesson\n')

test('uses the current lesson schema version', () => {
  assert(lesson.schemaVersion === LESSON_SCHEMA_VERSION, `expected v${LESSON_SCHEMA_VERSION}, got v${lesson.schemaVersion}`)
})

test('carries valid CBC metadata (Grade 4 / English)', () => {
  assert(lesson.grade === '4', `expected grade '4', got '${lesson.grade}'`)
  assert(LESSON_GRADES.includes(lesson.grade), 'grade must be a known curriculum grade')
  assert(lesson.subject === 'English', `expected subject 'English', got '${lesson.subject}'`)
  assert(LESSON_SUBJECTS.includes(lesson.subject), 'subject must be a known curriculum subject')
  assert(LESSON_TERMS.includes(lesson.term), `term '${lesson.term}' must be a known term`)
  assert(lesson.topic === 'Contractions', `expected topic 'Contractions', got '${lesson.topic}'`)
})

test('starts in draft and unpublished', () => {
  assert(lesson.status === 'draft', 'sample lessons should start as drafts')
  assert(lesson.isPublished === false, 'sample lessons should not be pre-published')
})

test('every slide uses a known slide type', () => {
  assert(Array.isArray(lesson.slides) && lesson.slides.length >= 6, 'lesson should have a full set of slides')
  for (const slide of lesson.slides) {
    assert(SLIDE_TYPE_MAP[slide.type], `unknown slide type: ${slide.type}`)
    assert(typeof slide.id === 'string' && slide.id.length > 0, 'each slide needs an id')
  }
})

test('opens on a title slide and closes on an end slide', () => {
  assert(lesson.slides[0].type === 'title', 'first slide should be a title slide')
  assert(lesson.slides[lesson.slides.length - 1].type === 'end', 'last slide should be an end slide')
})

test('includes practice activities with answers and explanations', () => {
  const questionSlides = lesson.slides.filter((s) => s.type === 'question')
  assert(questionSlides.length >= 2, `expected at least 2 activities, got ${questionSlides.length}`)
  for (const q of questionSlides) {
    assert(q.prompt.trim().length > 0, 'activity must have a prompt')
    assert(q.answer.trim().length > 0, 'activity must have an answer')
    assert(q.explanation.trim().length > 0, 'activity must have an explanation')
  }
})

test('activities and answers reference real slide ids', () => {
  const slideIds = new Set(lesson.slides.map((s) => s.id))
  assert(lesson.activities.length === lesson.answers.length, 'activities and answers should be paired')
  for (const a of lesson.activities) assert(slideIds.has(a.slideId), `activity references missing slide ${a.slideId}`)
  for (const a of lesson.answers) {
    assert(slideIds.has(a.slideId), `answer references missing slide ${a.slideId}`)
    assert(a.answer.trim().length > 0, 'answer text must not be empty')
  }
})

test('actually teaches contractions (apostrophes + the it’s/its distinction)', () => {
  const text = lesson.slides
    .map((s) => [s.title, s.body, s.subtitle, s.example, s.explanation, ...(s.bullets || [])].join(' '))
    .join(' ')
    .toLowerCase()
  assert(text.includes('apostrophe'), 'lesson should explain the apostrophe')
  assert(text.includes('don’t') || text.includes("don't"), 'lesson should show example contractions')
  assert(text.includes('it’s') && text.includes('its'), 'lesson should cover the it’s vs its distinction')
})

test('ships matching quick-lesson notes', () => {
  assert(typeof GRADE4_CONTRACTIONS_QUICK_NOTES === 'string', 'quick notes should be a string')
  assert(GRADE4_CONTRACTIONS_QUICK_NOTES.toLowerCase().includes('contraction'), 'quick notes should be about contractions')
})

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
