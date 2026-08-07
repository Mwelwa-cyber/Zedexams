#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the printed timetable's identity: subject abbreviations +
 * legend (src/utils/subjectAbbreviations.js) and the print templates
 * (src/utils/timetablePrintTemplates.js) — the official title, the
 * monochrome Ministry format, vertically spelled BREAK/LUNCH columns, and
 * the one resolution the preview, PDF, Word and Excel all share.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-print   (also via npm run test:all)
 */
import {
  deriveAbbreviation,
  resolveSubjectAbbreviation,
  buildAbbreviationLegend,
  legendLine,
} from '../src/utils/subjectAbbreviations.js'
import {
  PRINT_TEMPLATES,
  DEFAULT_PRINT_TEMPLATE,
  DEFAULT_PRINT_LAYOUT,
  CELL_TEXT_MODES,
  getPrintTemplate,
  numberToWords,
  streamFromClassName,
  officialTimetableTitle,
  resolveCellTextMode,
  verticalBandLetters,
  shouldSpellBand,
  resolvePrintSettings,
  MINISTRY_HEADER_TEXT,
} from '../src/utils/timetablePrintTemplates.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) } catch (err) {
    fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, message) { if (!cond) throw new Error(message) }
const eq = (a, b, message) => assert(a === b, `${message} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)

console.log('\nCell abbreviations\n')

test('the official learning areas derive the codes a real timetable uses', () => {
  // Straight from the reference government timetable's own handwriting.
  eq(deriveAbbreviation('English Language'), 'ENG', 'ENG')
  eq(deriveAbbreviation('Mathematics'), 'MATHS', 'MATHS')
  eq(deriveAbbreviation('Science'), 'SCIE', 'SCIE')
  eq(deriveAbbreviation('Zambian Language'), 'ZIL', 'ZIL')
  eq(deriveAbbreviation('Social Studies'), 'SS', 'SS')
  eq(deriveAbbreviation('Technology Studies'), 'TECH', 'TECH')
  eq(deriveAbbreviation('Expressive Arts'), 'EA', 'EA')
  eq(deriveAbbreviation('Home Economics'), 'HE', 'HE')
  eq(deriveAbbreviation('Literacy'), 'LIT', 'LIT')
})

test('the more specific pattern wins — the Lower Primary English area is ENG, not LIT', () => {
  eq(deriveAbbreviation('Literacy and Language — English Language'), 'ENG',
    'it is the English area, whatever the framework calls it')
  eq(deriveAbbreviation('Literacy and Language — Zambian Language'), 'ZIL',
    'and its Zambian counterpart')
})

test('a subject the school invented falls back to its initials', () => {
  eq(deriveAbbreviation('Life Skills Club'), 'LSC', 'initials of the significant words')
  eq(deriveAbbreviation('Swimming'), 'SWIMM', 'a single word is truncated')
  eq(deriveAbbreviation(''), '', 'nothing in, nothing out')
})

test('a relabelled language takes its OWN short form, and the teacher’s edit wins over both', () => {
  eq(resolveSubjectAbbreviation({ label: 'Zambian Language', displayLabel: 'Chinyanja' }), 'CHINY',
    'a school teaching Chinyanja prints CHINY, not ZIL')
  eq(resolveSubjectAbbreviation({ label: 'Zambian Language', displayLabel: 'Chinyanja', abbreviation: 'chi' }), 'CHI',
    'the teacher’s own edit outranks every derivation')
  eq(resolveSubjectAbbreviation({ label: 'Zambian Language' }), 'ZIL', 'and unlabelled stays ZIL')
})

console.log('\nThe printed key\n')

test('the key lists only the codes actually on the grid', () => {
  const subjects = [
    { label: 'English Language' },
    { label: 'Mathematics' },
    { label: 'Home Economics' },   // not placed this week
  ]
  const legend = buildAbbreviationLegend(subjects, new Set(['English Language', 'Mathematics']))
  eq(legend.length, 2, 'a key naming codes the reader cannot find is noise')
  eq(legend[0].abbr, 'ENG', 'in subject order')
})

test('a relabelled language shows both names so the learning area stays identifiable', () => {
  const legend = buildAbbreviationLegend(
    [{ label: 'Zambian Language', displayLabel: 'Chinyanja', abbreviation: 'ZIL' }],
    new Set(['Zambian Language']),
  )
  eq(legend[0].label, 'Chinyanja (Zambian Language)', 'both names')
  eq(legendLine(legend), 'ZIL = Chinyanja (Zambian Language)', 'as one printable line')
})

console.log('\nThe official title\n')

test('the Ministry title carries the grade in words AND numeral, then the stream', () => {
  eq(officialTimetableTitle({ grade: 'G4', className: 'Grade 4 A' }), 'GRADE FOUR (4) A TIME TABLE',
    'the reference document’s own title')
  eq(officialTimetableTitle({ grade: 'G4', className: '4A' }), 'GRADE FOUR (4) A TIME TABLE',
    'however the teacher wrote the class name')
  eq(officialTimetableTitle({ grade: 'G4' }), 'GRADE FOUR (4) TIME TABLE', 'a class with no stream')
  eq(officialTimetableTitle({ grade: 'G5', className: 'Grade 5 Blue' }), 'GRADE FIVE (5) BLUE TIME TABLE',
    'a named stream')
})

test('a grade with no numeral names the class rather than printing "GRADE ()"', () => {
  eq(officialTimetableTitle({ grade: 'ECE_R', className: 'Reception Red' }), 'RECEPTION RED TIME TABLE',
    'Early Childhood bands fall back to the class name')
  eq(officialTimetableTitle({}), 'TIME TABLE', 'and with nothing at all, no empty parentheses')
})

test('the stream is extracted, not guessed', () => {
  eq(streamFromClassName('Grade 4 A', 'G4'), 'A', 'the grade wording is stripped')
  eq(streamFromClassName('4A', 'G4'), 'A', 'including the joined form')
  eq(streamFromClassName('', 'G4'), '', 'nothing to extract')
  eq(numberToWords(4), 'FOUR', 'numbers to words')
  eq(numberToWords(99), '', 'outside the range a grade can occupy, nothing is claimed')
})

console.log('\nTemplates\n')

test('the two templates differ where it matters, not decoratively', () => {
  eq(PRINT_TEMPLATES.length, 2, 'two templates')
  const gov = getPrintTemplate('government')
  eq(gov.layout, 'days-as-rows', 'the Ministry format always puts days down the left')
  eq(gov.colour, false, 'and prints no colour — schools photocopy the master in black and white')
  eq(gov.spellBands, true, 'BREAK is spelled down its column')
  eq(gov.signatures, true, 'signature lines and stamp space')
  eq(gov.ministryHeader, true, 'the MINISTRY OF EDUCATION line')
  const modern = getPrintTemplate('modern')
  eq(modern.colour, true, 'the modern template colour-codes')
  eq(modern.layout, null, 'and follows the teacher’s own orientation choice')
  eq(getPrintTemplate('nonsense').id, DEFAULT_PRINT_TEMPLATE, 'an unknown id falls back')
  eq(MINISTRY_HEADER_TEXT, 'MINISTRY OF EDUCATION', 'the header line is declared once')
})

test('print orientation defaults to days-left; the screen editor keeps its own default', () => {
  eq(DEFAULT_PRINT_LAYOUT, 'days-as-rows',
    'both reference documents put days down the left on paper')
})

console.log('\nCell text\n')

test('auto measures the grid rather than guessing', () => {
  eq(CELL_TEXT_MODES.length, 3, 'automatic / full / abbreviations')
  eq(resolveCellTextMode({ mode: 'auto', columnCount: 6, template: 'modern' }), 'full',
    'a wide grid prints full names')
  eq(resolveCellTextMode({ mode: 'auto', columnCount: 12, template: 'modern' }), 'abbrev',
    'a narrow one cannot, so it prints codes')
  eq(resolveCellTextMode({ mode: 'full', columnCount: 12, template: 'modern' }), 'full',
    'an explicit choice is never overridden')
  eq(resolveCellTextMode({ mode: 'auto', columnCount: 5, template: 'government' }), 'abbrev',
    'the Ministry format uses codes by default, as the reference document does')
})

console.log('\nVertically spelled bands\n')

test('BREAK is spelled one letter per day-row', () => {
  const letters = verticalBandLetters('BREAK', 5)
  eq(letters.join(''), 'BREAK', 'one letter per Monday–Friday row')
  eq(verticalBandLetters('LUNCH', 5).join(''), 'LUNCH', 'and LUNCH the same')
  eq(verticalBandLetters('BREAK', 3).join(''), 'BRE', 'a three-day week truncates')
  eq(verticalBandLetters('BREAK', 6).length, 6, 'a six-day week pads')
  eq(verticalBandLetters('BREAK', 6)[5], '', 'with empty cells, so the column still lines up')
})

test('a band is spelled only where one letter per row can mean anything', () => {
  assert(shouldSpellBand({ template: 'government', layout: 'days-as-rows', dayCount: 5, wordLength: 5 }),
    'the Ministry format, days down the left')
  assert(!shouldSpellBand({ template: 'government', layout: 'days-as-columns', dayCount: 5, wordLength: 5 }),
    'never with days across the top — the column does not span the day rows there')
  assert(!shouldSpellBand({ template: 'modern', layout: 'days-as-rows', dayCount: 5, wordLength: 5 }),
    'and not on the modern template unless asked')
  assert(shouldSpellBand({ template: 'modern', layout: 'days-as-rows', spellBands: true, dayCount: 5, wordLength: 5 }),
    'which the teacher can do')
})

console.log('\nOne resolution, four renderers\n')

test('the government template overrides orientation and colour whatever the preferences say', () => {
  const model = {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    rows: new Array(9).fill(null).map((_, i) => ({ id: `p${i}`, kind: 'lesson' })),
    displayPreferences: {
      printTemplate: 'government',
      printLayout: 'days-as-columns',   // deliberately the wrong one
      cellText: 'auto',
      showMinistryHeader: true,
    },
  }
  const settings = resolvePrintSettings(model)
  eq(settings.layout, 'days-as-rows', 'the Ministry format decides its own orientation')
  eq(settings.colour, false, 'and prints monochrome')
  eq(settings.cellText, 'abbrev', 'with codes')
  assert(settings.showLegend, 'so the key prints')
  assert(settings.spellBands, 'and BREAK is spelled down its column')
  assert(settings.signatures, 'with signature lines')
  assert(settings.ministryHeader, 'and the Ministry header')
})

test('the modern template follows the teacher’s own orientation and keeps colour', () => {
  const model = {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    rows: new Array(6).fill(null).map((_, i) => ({ id: `p${i}`, kind: 'lesson' })),
    displayPreferences: { printTemplate: 'modern', printLayout: 'days-as-columns', cellText: 'auto' },
  }
  const settings = resolvePrintSettings(model)
  eq(settings.layout, 'days-as-columns', 'the teacher’s choice stands')
  eq(settings.colour, true, 'colour fills')
  eq(settings.cellText, 'full', 'and full names in a six-column grid')
  assert(!settings.showLegend, 'no key is needed when nothing is abbreviated')
  assert(!settings.signatures, 'and no official footer')
})

test('a timetable saved before this pass resolves to the modern template', () => {
  const settings = resolvePrintSettings({ days: ['Monday'], rows: [], displayPreferences: {} })
  eq(settings.template.id, DEFAULT_PRINT_TEMPLATE, 'nothing declared means the modern template')
  eq(settings.layout, DEFAULT_PRINT_LAYOUT, 'printed days-left, as the brief asks')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
