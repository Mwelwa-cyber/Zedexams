/**
 * Regression tests for the lesson-plan PDF export (buildPrintableHtml).
 *
 * Guards two things that quietly break a downloaded plan:
 *   1. Layout — the CBC header must be a two-column <table> (NOT a CSS grid).
 *      The PDF download rasterises with html2canvas 1.x, which renders
 *      `display:grid` unreliably; a <table> always lays out correctly.
 *   2. Pagination — the "don't slice through a row" rules must live in the
 *      base stylesheet, not inside @media print. html2canvas reads SCREEN
 *      computed styles to decide where to cut a page; rules hidden behind
 *      @media print are invisible to it and rows get cut in half.
 *
 * Run: node src/utils/lessonPlanToPdf.test.js
 */

import { buildPrintableHtml } from './lessonPlanToPdf.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const plan = {
  schemaVersion: '3.0',
  header: {
    school: 'Jemareen Academy',
    teacherName: 'Chibuye Dorica',
    subject: 'Mathematics and Science',
    topic: 'Exploring my World',
    subtopic: 'Grouping things',
    class: 'Grade 2A',
    date: '26th March 2026',
    time: '07:00 - 08:00',
    durationMinutes: 60,
  },
  generalCompetences: ['Communication'],
  specificCompetence: 'Group objects by attribute',
  stages: [{ name: 'INTRODUCTION', durationMinutes: 5, teacherActivities: ['Show objects'], learnerActivities: ['Observe'], assessmentCriteria: ['Names objects'] }],
}

const html = buildPrintableHtml(plan, 'CBC Lesson Plan')

console.log('lesson-plan PDF — two-column header')
assert(html.includes('<table class="meta">'), 'header is a two-column <table>')
assert(!html.includes('<div class="meta">'), 'header does NOT use a CSS-grid div (html2canvas-unsafe)')
assert(!/\.meta\{[^}]*display:grid/.test(html), 'no display:grid on the .meta header')
assert(html.includes('NAME OF TEACHER'), 'shows NAME OF TEACHER')
assert(html.includes('TOTAL NO. OF PUPILS'), 'shows TOTAL NO. OF PUPILS')
assert(html.includes('GIRLS:') && html.includes('BOYS:'), 'shows Girls / Boys fill-in fields')
assert(html.includes('Jemareen Academy'), 'shows the school masthead')
assert(html.includes('Exploring my World') && html.includes('Grouping things'), 'shows topic and sub-topic')

console.log('\nlesson-plan PDF — pagination rules are screen-visible')
assert(/tr\{[^}]*page-break-inside:avoid/.test(html), 'tr keep-together rule present')
// The print media block must NOT carry the keep-together rules — html2canvas
// renders in screen media, so they have to be in the base stylesheet. The
// @media print rule is the last thing in the <style>, so slice to </style>.
const mp = html.indexOf('@media print{')
const printBlock = mp >= 0 ? html.slice(mp, html.indexOf('</style>', mp)) : ''
assert(printBlock.length > 0, '@media print block exists')
assert(!/page-break-inside:avoid/.test(printBlock), 'keep-together rules are NOT trapped inside @media print')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll lessonPlanToPdf tests passed.')
