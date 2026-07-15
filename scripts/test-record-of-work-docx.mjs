#!/usr/bin/env node
/**
 * Tests for the Record of Work DOCX export (Phase 3 slice 5 — export polish).
 * Packs the real document and inspects the produced OOXML, so the assertions
 * cover what Word actually renders: statutory columns unchanged, header row
 * repeating on new pages, week rows never cut across pages, landscape
 * orientation, and Page X of Y in the footer.
 *
 * Run: npm run test:record-of-work-docx
 */
import assert from 'node:assert/strict'
import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { buildRecordOfWorkDocument } from '../src/utils/recordOfWorkToDocx.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const RECORD = {
  schemaVersion: 'record-of-work-1.0',
  header: { school: 'Kabulonga Primary', teacherName: 'M. Mwelwa', grade: 'G4', subject: 'Mathematics', term: 2, year: '2026' },
  weeks: [
    { week: '1', weekEnding: '22 May 2026', topic: 'Fractions', subtopic: 'Halves', workDone: ['Taught halves', 'Class exercise'], coverage: 'full', remarks: '' },
    { week: '2', weekEnding: '29 May 2026', topic: 'A very long topic name that must wrap inside its column without breaking the table layout at all', subtopic: '', workDone: [], coverage: 'partial', remarks: 're-teach carrying tens' },
  ],
}

async function xmlOf(record, opts) {
  const buf = await Packer.toBuffer(buildRecordOfWorkDocument(record, opts))
  const files = unzipSync(new Uint8Array(buf))
  const read = (name) => (files[name] ? strFromU8(files[name]) : '')
  const footerNames = Object.keys(files).filter((n) => /^word\/footer\d*\.xml$/.test(n))
  return {
    document: read('word/document.xml'),
    footers: footerNames.map(read).join('\n'),
    headers: Object.keys(files).filter((n) => /^word\/header\d*\.xml$/.test(n)).map(read).join('\n'),
  }
}

console.log('recordOfWorkToDocx (OOXML inspection)')

const clean = await xmlOf(RECORD)

await test('statutory columns and wording are unchanged', async () => {
  for (const col of ['WEEK', 'WEEK ENDING', 'TOPIC', 'SUB-TOPIC', 'WORK DONE', 'REMARKS']) {
    assert.ok(clean.document.includes(col), `missing column ${col}`)
  }
  assert.ok(clean.document.includes('GRADE 4 MATHEMATICS RECORD OF WORK'))
  assert.ok(clean.document.includes('TERM 2 · YEAR: 2026'))
  assert.ok(clean.document.includes('CHECKED BY (H.O.D / HEAD TEACHER):'))
})

await test('the header row repeats on every page', async () => {
  assert.ok(/w:tblHeader/.test(clean.document), 'w:tblHeader missing — column headers would vanish on page 2')
})

await test('week rows are never cut across a page break', async () => {
  assert.ok(/w:cantSplit/.test(clean.document), 'w:cantSplit missing — a week row could be sliced mid-text')
})

await test('page stays landscape', async () => {
  assert.ok(/w:orient="landscape"/.test(clean.document))
})

await test('footer numbers every page (Page X of Y)', async () => {
  assert.ok(/PAGE/.test(clean.footers), 'PAGE field missing from footer')
  assert.ok(/NUMPAGES/.test(clean.footers), 'NUMPAGES field missing from footer')
})

await test('clean (paid) export carries no attribution branding', async () => {
  assert.ok(!/Made with ZedExams/.test(clean.footers))
  assert.ok(!/ZedExams\.com/.test(clean.headers))
})

await test('free-plan export keeps the attribution AND gains page numbers', async () => {
  const branded = await xmlOf(RECORD, { attribution: true })
  assert.ok(/Made with ZedExams/.test(branded.footers), 'attribution line missing')
  assert.ok(/PAGE/.test(branded.footers) && /NUMPAGES/.test(branded.footers), 'page numbers missing on free plan')
  assert.ok(/ZedExams/.test(branded.headers), 'watermark header missing')
})

await test('an empty WORK DONE cell prints an em-dash, and teacher content survives', async () => {
  assert.ok(clean.document.includes('—'))
  assert.ok(clean.document.includes('Taught halves'))
  assert.ok(clean.document.includes('re-teach carrying tens'))
  assert.ok(clean.document.includes('Partially covered'))
})

console.log(`\n${passed} tests passed.`)
