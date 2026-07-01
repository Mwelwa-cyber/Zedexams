/**
 * Regression tests for the Full Lesson Studio Word (.docx) export.
 *
 * Guards the free-plan attribution: fullLessonToDocx was the one studio
 * exporter that ignored opts.attribution entirely, so Free-plan downloads
 * shipped without the "Made with ZedExams" footer + diagonal watermark every
 * other studio applies (and paid exports could never be asserted clean).
 *
 * Run: node src/utils/fullLessonToDocx.test.js
 */

import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { buildFullLessonDocument } from './fullLessonToDocx.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const LESSON = {
  header: {
    title: 'Fractions of a Whole',
    topic: 'Fractions',
    subtopic: 'Halves and quarters',
    grade: 'Grade 5',
    subject: 'Mathematics',
    durationMinutes: 40,
  },
  objectives: ['Identify halves and quarters of shapes'],
  teaching: [{ heading: 'What is a fraction?', explanation: 'A fraction names part of a whole.' }],
  workedExamples: [{ problem: 'Shade half of the circle.', steps: ['Split the circle in two'], answer: 'One of two equal parts' }],
  homework: { task: 'Fold a paper into quarters.', answerGuide: 'Four equal parts.' },
}

async function unzip(doc) {
  return unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
}

console.log('Free-plan export carries the watermark header + attribution footer')
{
  const files = await unzip(buildFullLessonDocument(LESSON, { attribution: true }))
  const headerXml = Object.keys(files)
    .filter((n) => /word\/header\d+\.xml/.test(n))
    .map((n) => strFromU8(files[n]))
    .join('')
  const footerNames = Object.keys(files).filter((n) => /word\/footer\d+\.xml/.test(n))
  const footerXml = footerNames.map((n) => strFromU8(files[n])).join('')
  assert(headerXml.includes('textpath'), 'header part carries the diagonal watermark')
  assert(footerNames.length >= 1, 'document carries a real Word footer part')
  assert(footerXml.includes('Made with ZedExams'), 'footer carries the attribution line')
}

console.log('\nPaid / admin export stays completely clean')
for (const opts of [{ attribution: false }, undefined]) {
  const files = await unzip(buildFullLessonDocument(LESSON, opts))
  const headerXml = Object.keys(files)
    .filter((n) => /word\/header\d+\.xml/.test(n))
    .map((n) => strFromU8(files[n]))
    .join('')
  const hasFooter = Object.keys(files).some((n) => /word\/footer\d+\.xml/.test(n))
  const label = opts ? 'attribution:false' : 'opts omitted'
  assert(!headerXml.includes('textpath'), `${label}: no watermark in any header`)
  assert(!hasFooter, `${label}: no attribution footer part`)
}

console.log('\nBody content survives the signature change')
{
  const files = await unzip(buildFullLessonDocument(LESSON, { attribution: true }))
  const docXml = strFromU8(files['word/document.xml'])
  assert(docXml.includes('Fractions of a Whole'), 'title renders in the body')
  assert(docXml.includes('Identify halves and quarters'), 'objectives bullet renders in the body')
  assert(docXml.includes('Fold a paper into quarters.'), 'homework task renders in the body')
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll fullLessonToDocx assertions passed')
