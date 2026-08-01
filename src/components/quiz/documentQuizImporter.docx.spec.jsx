// Real-pipeline DOCX extraction regression tests (jsdom DOMParser + fflate).
//
// Why this spec exists: the node test suite exercises the PARSER
// (documentQuizParserCore) on pre-extracted text blocks, but the extraction
// step itself (extractDocx → paragraphText) only runs in a DOM environment.
// The 2026-07-21 "whole paper imports as 3 mangled passages" bug lived
// exactly in that gap: <w:pPr><w:tabs><w:tab w:pos="…"/></w:tabs></w:pPr>
// tab-STOP definitions were walked as if they were tab CHARACTERS, injecting
// a phantom leading "\t" on every paragraph — invisible to every node-level
// parser test, fatal in the browser.
import { describe, it, expect, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'

vi.mock('../../utils/aiAssistant', () => ({
  structureImportedQuiz: vi.fn(async () => { throw new Error('smart import disabled in test') }),
  structureScannedQuiz: vi.fn(async () => { throw new Error('disabled') }),
}))
vi.mock('../../utils/testPaperDiagram', () => ({
  analyzePaperLayout: vi.fn(async () => ({ pages: [] })),
}))
vi.mock('../../utils/pdfjsLoader.js', () => ({
  loadPdfjs: vi.fn(async () => { throw new Error('no pdf in this spec') }),
}))

import { extractDocx, importQuizDocument } from './documentQuizImporter.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

// A paragraph in the "answer-with-reasons" generated-paper layout: explicit
// tab stops in pPr, a BOLD "N\t" (or "A\t") prefix run, then a plain run.
function tabbedPara(boldPrefix, rest) {
  return (
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="520"/></w:tabs>' +
    '<w:ind w:left="520" w:hanging="520"/></w:pPr>' +
    `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${boldPrefix}\t</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">${rest}</w:t></w:r></w:p>`
  )
}

function plainPara(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

function makeDocx(bodyXml) {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>`
  const zipped = zipSync({
    'word/document.xml': strToU8(documentXml),
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  })
  return new File([zipped], 'tabstop-paper.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

const BODY = [
  plainPara('PSLE English 2025'),
  plainPara('Part 1: Questions 1–2 — Choose the word that makes the sentence correct.'),
  tabbedPara('1', '… people have died of COVID 19 in the world.'),
  tabbedPara('A', 'Small'),
  tabbedPara('B', 'Plenty'),
  tabbedPara('C', 'Many'),
  tabbedPara('D', 'Little'),
  plainPara('Answer: C — Many ‘Many’ is used with plural countable nouns.'),
  tabbedPara('2', 'The girl can sing … she cannot dance.'),
  tabbedPara('A', 'and'),
  tabbedPara('B', 'but'),
  tabbedPara('C', 'nor'),
  tabbedPara('D', 'or'),
  plainPara('Answer: B — but Shows a contrast between two ideas.'),
].join('')

describe('extractDocx on tab-stop + bold-prefix layouts', () => {
  it('does not emit phantom tabs for pPr tab-stop definitions', async () => {
    const extracted = await extractDocx(makeDocx(BODY))
    const texts = extracted.blocks.map(b => b.text)
    // The bold "1\t" prefix must normalise to a parseable "1. …" line —
    // with no leading whitespace/tab from the pPr tab-stop definition.
    expect(texts).toContain('1. … people have died of COVID 19 in the world.')
    expect(texts).toContain('A. Small')
    expect(texts.some(t => /^\s/.test(t))).toBe(false)
  })

  it('imports every question with answers via the full document pipeline', async () => {
    const result = await importQuizDocument(makeDocx(BODY))
    const questions = result.sections
      .filter(s => s.kind !== 'passage')
      .map(s => s.question)
    expect(questions).toHaveLength(2)
    expect(String(questions[0].sourceQuestionNumber)).toBe('1')
    expect(questions[0].options).toHaveLength(4)
    expect(questions[0].correctAnswer).toBe(2)
    expect(questions[1].correctAnswer).toBe(1)
    expect(result.summary.needsReview).toBe(0)
    expect(result.summary.importerVersion).toBeTruthy()
  })

  it('rejects a non-document payload disguised as .docx before parsing (STOR-003)', async () => {
    // A "<script>" blob renamed with a .docx name + the docx MIME. The extension
    // and declared type say Word; the bytes say otherwise. It must be refused up
    // front, never handed to the ZIP/XML parser (the SEC-007 adm-zip concern).
    const evil = new File([new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e])], 'paper.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await expect(importQuizDocument(evil)).rejects.toThrow(/contents don't match/i)
  })
})
