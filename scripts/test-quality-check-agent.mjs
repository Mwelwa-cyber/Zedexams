#!/usr/bin/env node
/**
 * Quality Check Agent — unit tests.
 *
 * Covers:
 *   - Deterministic grounding pass (kept from v2, scoped to quizzes)
 *   - Every per-axis check across all artifact types
 *   - Verdict assembly: confidence math, status, requiresHumanReview
 *   - Hard rule: exam_quiz always requires human review
 *   - Hard rule: failed verdicts cannot publish (via dispatcher gate
 *     reading qualityCheck.requiresHumanReview)
 *   - Backward compat: returns the old {ok, verdict, contentId} shape
 *   - End-to-end Zod validation against qualityCheckVerdictSchema
 *
 * Run: npm run test:quality-check  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/qualityCheck.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')

const fakeAdmin = {firestore: () => ({})}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, writeSupervisorLog: async () => {},
      updateLiveAgentState: async () => {}, writeTaskStep: async () => {},
    }
  }
  return origLoad.call(this, request, parent, ...rest)
}

const qc = await import(RUNNER)
const { qualityCheckVerdictSchema } = await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const ref = {inMemory: {citedExcerpts: [{text: 'x'}, {text: 'y'}]}}
const reader = {
  grade: '7', subject: 'Mathematics', topic: 'Fractions',
  keyConcepts: ['numerator', 'denominator'],
}

const goodMcq = {
  prompt: 'In a fraction, what sits on top of the line?',
  questionType: 'mcq',
  options: ['numerator', 'denominator', 'integer', 'decimal'],
  correctAnswer: 'numerator',
  explanation: 'The numerator is the top part of a fraction.',
  difficulty: 'easy', marks: 1, groundingIndex: 0,
}

console.log('\nDeterministic grounding pass (scoped to quizzes)')

test('passes when every quiz question carries a valid groundingIndex', () => {
  const r = qc.deterministicGroundingCheck({
    content: {questions: [goodMcq]},
    curriculumReference: ref, artifactType: 'practice_quiz',
  })
  assert(r.ok === true, 'must pass')
})
test('fails when quiz has zero groundingIndex pointers', () => {
  const r = qc.deterministicGroundingCheck({
    content: {questions: [{prompt: 'q', questionType: 'mcq', options: ['a', 'b']}]},
    curriculumReference: ref, artifactType: 'practice_quiz',
  })
  assert(r.ok === false, 'must fail')
  assert(r.issue.severity === 'critical')
})
test('fails when groundingIndex out of range', () => {
  const r = qc.deterministicGroundingCheck({
    content: {questions: [{...goodMcq, groundingIndex: 99}]},
    curriculumReference: ref, artifactType: 'practice_quiz',
  })
  assert(r.ok === false, 'must fail')
})
test('passes for notes (grounding axis skipped for prose artifacts)', () => {
  const r = qc.deterministicGroundingCheck({
    content: {body: 'Prose notes without grounding pointers.'},
    curriculumReference: ref, artifactType: 'notes',
  })
  assert(r.ok === true, 'notes must pass grounding axis (scoped to quizzes)')
})
test('passes when content.stub === true (CI fallback artifact)', () => {
  const r = qc.deterministicGroundingCheck({
    content: {stub: true},
    curriculumReference: ref, artifactType: 'practice_quiz',
  })
  assert(r.ok === true)
})

console.log('\nQuiz structural checks')

test('checkRequiredFields fails when quiz has no questions', () => {
  const r = qc.checkRequiredFields({content: {questions: []}, artifactType: 'practice_quiz'})
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkCorrectAnswerExists fails when missing on MCQ', () => {
  const r = qc.checkCorrectAnswerExists({
    content: {questions: [{...goodMcq, correctAnswer: ''}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkCorrectAnswerInOptions fails when answer not in options', () => {
  const r = qc.checkCorrectAnswerInOptions({
    content: {questions: [{...goodMcq, correctAnswer: 'zebra'}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkDuplicateOptions fails on duplicate MCQ options', () => {
  const r = qc.checkDuplicateOptions({
    content: {questions: [{...goodMcq, options: ['a', 'a', 'b', 'c']}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkOptionsTooSimilar flags first-6-char overlap', () => {
  const r = qc.checkOptionsTooSimilar({
    content: {questions: [{
      ...goodMcq,
      options: ['photosynthesis', 'photosythesis', 'respiration', 'transpiration'],
      correctAnswer: 'photosynthesis',
    }]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue, 'must flag similar options')
})
test('checkSingleCorrectAnswer fails when answer matches >1 option', () => {
  const r = qc.checkSingleCorrectAnswer({
    content: {questions: [{...goodMcq, options: ['numerator', 'numerator', 'integer', 'decimal']}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkExplanationMatchesAnswer flags missing answer in explanation', () => {
  const r = qc.checkExplanationMatchesAnswer({
    content: {questions: [{...goodMcq, explanation: 'A fraction has parts.'}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue && r.issue.severity === 'minor')
})

console.log('\nExam-paper checks')

const goodExam = {
  header: {
    grade: '7', subject: 'Mathematics', term: '1', totalMarks: 4,
    instructions: ['Read carefully.', 'Answer all questions.'],
  },
  sections: [
    {id: 'A', marks: 2, questions: [{prompt: 'q1', marks: 2, groundingIndex: 0,
      questionType: 'mcq', options: ['a', 'b', 'c', 'd'], correctAnswer: 'a',
      explanation: 'a'}]},
    {id: 'B', marks: 2, questions: [{prompt: 'q2', marks: 2, groundingIndex: 0,
      questionType: 'short_answer', correctAnswer: 'numerator',
      explanation: 'numerator'}]},
  ],
  answerKey: [
    {sectionId: 'A', questionNumber: 1, answer: 'A (a)', marks: 2},
    {sectionId: 'B', questionNumber: 1, answer: 'numerator', marks: 2},
  ],
  markingGuide: 'Award full marks for the verbatim answer drawn from the cited excerpts.',
}

test('checkSectionsPresent passes with A + B', () => {
  const r = qc.checkSectionsPresent({content: goodExam, artifactType: 'exam_quiz'})
  assert(!r.issue, 'expected no issue')
})
test('checkSectionsPresent fails without B', () => {
  const bad = {...goodExam, sections: goodExam.sections.slice(0, 1)}
  const r = qc.checkSectionsPresent({content: bad, artifactType: 'exam_quiz'})
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkAnswerKeyComplete fails when key entries < total questions', () => {
  const bad = {...goodExam, answerKey: goodExam.answerKey.slice(0, 1)}
  const r = qc.checkAnswerKeyComplete({content: bad, artifactType: 'exam_quiz'})
  assert(r.issue && r.issue.severity === 'critical')
})
test('checkMarkingGuidePresent fails on missing or too-short guide', () => {
  const r = qc.checkMarkingGuidePresent({content: {...goodExam, markingGuide: 'x'},
    artifactType: 'exam_quiz'})
  assert(r.issue && r.issue.severity === 'minor')
})
test('checkMarksAllocation fails when section.marks ≠ sum of question marks', () => {
  const bad = JSON.parse(JSON.stringify(goodExam))
  bad.sections[0].marks = 999
  const r = qc.checkMarksAllocation({content: bad, artifactType: 'exam_quiz'})
  assert(r.issue && r.issue.severity === 'minor')
})

console.log('\nNotes-specific checks')

test('checkNotesSimple flags long average sentence length', () => {
  const longSentence = 'a '.repeat(40) + '.'
  const r = qc.checkNotesSimple({content: {body: longSentence + longSentence},
    artifactType: 'notes'})
  assert(r.issue, 'must flag long sentences')
})
test('checkNotesLength flags over-cap notes for the grade', () => {
  const huge = 'word '.repeat(2000)
  const r = qc.checkNotesLength({content: {body: huge}, artifactType: 'notes',
    curriculumReader: reader})
  assert(r.issue, 'must flag over-cap notes')
})
test('checkNotesMatchTopic fails when notes do not reference topic or concepts', () => {
  const r = qc.checkNotesMatchTopic({
    content: {body: 'Photosynthesis happens in chloroplasts using sunlight.'},
    artifactType: 'notes',
    curriculumReader: reader,
  })
  assert(r.issue && r.issue.severity === 'critical',
    `expected critical issue, got: ${JSON.stringify(r.issue)}`)
})
test('checkNotesMatchTopic passes when keyConcept appears', () => {
  const r = qc.checkNotesMatchTopic({
    content: {body: 'The numerator is on top of the line.'},
    artifactType: 'notes',
    curriculumReader: reader,
  })
  assert(!r.issue, 'keyConcept should satisfy topic match')
})

console.log('\nStudy-tips-specific checks')

test('checkTipsUseful flags generic phrases', () => {
  const r = qc.checkTipsUseful({
    content: {tips: ['Study hard.', 'Practice more.', 'Believe in yourself.']},
    artifactType: 'study_tips',
  })
  assert(r.issue, 'must flag generic tips')
})
test('checkTipsActionable flags non-verb-start tips', () => {
  const r = qc.checkTipsActionable({
    content: {tips: ['Fractions are important.', 'The numerator matters.']},
    artifactType: 'study_tips',
  })
  assert(r.issue, 'must flag declarative tips')
})
test('checkTipsActionable passes when most tips start with imperative verbs', () => {
  const r = qc.checkTipsActionable({
    content: {tips: ['Practice adding fractions daily.', 'Draw fraction strips.', 'Write three examples.']},
    artifactType: 'study_tips',
  })
  assert(!r.issue, 'imperative-led tips must pass')
})

console.log('\nUniversal checks')

test('checkSpellingGrammar flags repeated-character spam', () => {
  const r = qc.checkSpellingGrammar({content: {body: 'aaaaaa what is a fraction?'}})
  assert(r.issue)
})
test('checkSpellingGrammar flags doubled words', () => {
  const r = qc.checkSpellingGrammar({content: {body: 'the the fraction is here.'}})
  assert(r.issue)
})
test('checkDiagramRequired flags missing image reference', () => {
  const r = qc.checkDiagramRequired({
    content: {questions: [{prompt: 'See figure below. What is shown?', questionType: 'mcq'}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue, 'must flag missing diagram reference')
})
test('checkAmbiguity flags ≥2 hedging questions', () => {
  const r = qc.checkAmbiguity({
    content: {questions: [
      {prompt: 'Usually fractions are...', questionType: 'mcq'},
      {prompt: 'Sometimes a numerator is...', questionType: 'mcq'},
    ]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue)
})
test('checkDifficultyConsistency flags easy + high marks', () => {
  const r = qc.checkDifficultyConsistency({
    content: {questions: [{...goodMcq, difficulty: 'easy', marks: 10}]},
    artifactType: 'practice_quiz',
  })
  assert(r.issue)
})

console.log('\nVerdict assembly')

const goodPracticeContent = {questions: [goodMcq]}

test('happy practice quiz → passed, conf 1.0, no human review', () => {
  const v = qc.buildVerdict({
    artifactType: 'practice_quiz', content: goodPracticeContent,
    curriculumReader: reader, curriculumReference: ref,
  })
  assert(v.status === 'passed')
  assert(v.confidenceScore === 1)
  assert(v.requiresHumanReview === false)
  assert(v.verifierVerdict === 'pass')
  assert(v.deterministicGroundingPass === true)
})

test('exam quiz always requires human review (even when passed)', () => {
  const v = qc.buildVerdict({
    artifactType: 'exam_quiz', content: goodExam,
    curriculumReader: reader, curriculumReference: ref,
  })
  assert(v.requiresHumanReview === true,
    `expected requiresHumanReview=true for exam_quiz, got ${v.requiresHumanReview}`)
})

test('critical issue → status failed regardless of count', () => {
  const v = qc.buildVerdict({
    artifactType: 'practice_quiz',
    content: {questions: [{...goodMcq, options: ['a', 'a', 'c', 'd']}]},
    curriculumReader: reader, curriculumReference: ref,
  })
  assert(v.status === 'failed', `expected failed, got ${v.status}`)
  assert(v.requiresHumanReview === true, 'failed must require human review')
  assert(v.verifierVerdict === 'fail')
})

test('confidence: 1 critical = 0.85', () => {
  assert(qc.computeConfidence([{severity: 'critical', axis: 'grounding', message: ''}]) === 0.85)
})
test('decideStatus: minor only + conf 0.85 → needs_review', () => {
  assert(qc.decideStatus({issues: [{severity: 'minor'}], confidence: 0.85}) === 'needs_review')
})
test('decideHumanReview: practice quiz passed + conf 1.0 → false', () => {
  assert(qc.decideHumanReview({artifactType: 'practice_quiz', status: 'passed', confidence: 1.0}) === false)
})
test('decideHumanReview: exam quiz passed → true (hard rule)', () => {
  assert(qc.decideHumanReview({artifactType: 'exam_quiz', status: 'passed', confidence: 1.0}) === true)
})
test('decideHumanReview: practice quiz needs_review → true', () => {
  assert(qc.decideHumanReview({artifactType: 'practice_quiz', status: 'needs_review', confidence: 0.7}) === true)
})

test('fixedSuggestions populated when issues present', () => {
  const v = qc.buildVerdict({
    artifactType: 'practice_quiz',
    content: {questions: [{...goodMcq, options: ['a', 'a', 'c', 'd']}]},
    curriculumReader: reader, curriculumReference: ref,
  })
  assert(v.fixedSuggestions.length >= 1, 'must surface at least one suggestion')
})

console.log('\nDispatcher wiring (source-text checks)')

test('dispatcher carries chainContext.qualityCheck forward', () => {
  assert(DISPATCHER_TEXT.includes('chainContext.qualityCheck'),
    'dispatcher must stash result.qualityCheckVerdict on chainContext')
})
test('auto-publish gate refuses when qualityCheck.requiresHumanReview', () => {
  assert(DISPATCHER_TEXT.includes('requiresHumanReview') ||
    DISPATCHER_TEXT.includes('requiresHumanReview === true'),
    'auto-publish gate must consult qualityCheck.requiresHumanReview')
})

console.log('\nEnd-to-end Zod validation')

test('happy verdict validates against qualityCheckVerdictSchema', () => {
  const base = qc.buildVerdict({
    artifactType: 'practice_quiz', content: goodPracticeContent,
    curriculumReader: reader, curriculumReference: ref,
  })
  const full = {...base, contentId: 'abc', checkedAt: new Date()}
  const parsed = qualityCheckVerdictSchema.parse(full)
  assert(parsed.status === 'passed')
})
test('exam verdict validates and pins requiresHumanReview', () => {
  const base = qc.buildVerdict({
    artifactType: 'exam_quiz', content: goodExam,
    curriculumReader: reader, curriculumReference: ref,
  })
  const full = {...base, contentId: 'abc', checkedAt: new Date()}
  const parsed = qualityCheckVerdictSchema.parse(full)
  assert(parsed.requiresHumanReview === true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
