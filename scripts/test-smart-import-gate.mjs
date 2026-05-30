/**
 * Regression test for the smart-import override gate.
 *
 * Root cause of the recurring "English paper imports jumbled / a choice is
 * missing" reports: importQuizDocument always handed the document to the
 * smart-import LLM and, when the LLM returned at least as many questions,
 * replaced the deterministic parser's output with the LLM's. The deterministic
 * parser is correct and complete for plain prose papers (every option, every
 * answer, true document order), but the LLM re-read does NOT reliably preserve
 * order and can merge or drop a long option — producing exactly the failure
 * teachers hit on the G7 English 2023 paper (long paragraph-ordering options,
 * and five punctuation items that share an identical stem).
 *
 * The fix (documentQuizReconcile.js#shouldRunSmartImport) keeps the
 * deterministic result unless the parse needs help (no questions / flagged for
 * review) OR the document actually carries the rich structure smart import
 * exists to recover (fractions, vertical arithmetic, tables, math symbols).
 *
 * This test exercises the REAL exported gate against the REAL parser output, so
 * it guards the code path the importer runs.
 */

import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from '../src/components/quiz/documentQuizParserCore.js'
import {
  shouldRunSmartImport,
  documentHasRichStructure,
} from '../src/components/quiz/documentQuizReconcile.js'

// ─── block helpers (match the other importer test fixtures) ────────────────

function block(text, overrides = {}) {
  return { text, assets: [], source: 'docx', numberedList: false, ...overrides }
}

// Options laid out as `A   text` (letter + spaces, no punctuation) — the exact
// shape of the real ECZ / G7 English Word export.
function mcqBlock(number, stem, options, answerLetter) {
  const answerText = options['ABCD'.indexOf(answerLetter)]
  return [
    block(`${number}. ${stem}`),
    block(`A   ${options[0]}`),
    block(`B   ${options[1]}`),
    block(`C   ${options[2]}`),
    block(`D   ${options[3]}`),
    block(`Answer: ${answerLetter}  —  ${answerText}`),
  ]
}

function rawTextFromBlocks(blocks) {
  return blocks.map(b => b.text || '').filter(Boolean).join('\n').trim()
}

function parse(blocks) {
  return processImportedQuestionBlocks(blocks, [], {
    preserveNumbering: true,
    groupComprehension: true,
  })
}

// ─── 1. Clean prose English paper → smart import is SKIPPED ─────────────────
{
  const blocks = [
    block('Grade 7 English — 2023'),
    block('SECTION A — Part 1: Questions 1 – 20'),
    block('Choose the word that makes the sentence right.'),
    ...mcqBlock(1, 'Zacheaus climbed a tree to see Jesus … he was short.', ['and', 'because', 'but', 'yet'], 'B'),
    ...mcqBlock(2, 'The children are now old enough to look after …', ['himself.', 'itself.', 'ourselves.', 'themselves.'], 'D'),
    // Identical-stem punctuation group (number-only stems) — the items the LLM
    // most often mis-anchors because only the options tell them apart.
    block('Part 3: Questions 26 – 30'),
    block('Choose the sentence which is correctly punctuated.'),
    block('26.'),
    block('A   The Bible was translated into Chitonga Cinyanja Luvale and Icibemba.'),
    block('B   The Bible was translated into Chitonga, Cinyanja, Luvale and Icibemba.'),
    block('C   The Bible was translated into, Chitonga Cinyanja Luvale and Icibemba.'),
    block('D   The Bible, was translated, into Chitonga Cinyanja Luvale and, Icibemba.'),
    block('Answer: B  —  The Bible was translated into Chitonga, Cinyanja, Luvale and Icibemba.'),
    block('27.'),
    block("A   The First Lady's Independence Day attire was nice."),
    block("B   The First Ladys Independence Day attire was nice."),
    block("C   The First Lady's, Independence Day attire was nice."),
    block("D   The First Ladys' Independence Day attire was nice."),
    block("Answer: A  —  The First Lady's Independence Day attire was nice."),
  ]

  const local = parse(blocks)
  const rawText = rawTextFromBlocks(blocks)

  // The deterministic parse is clean and complete.
  assert.equal(local.summary.needsReview, 0, 'clean prose paper should have no review flags')
  assert.ok(local.summary.questions >= 4, 'all questions should be parsed')

  // No rich structure → smart import must be skipped, so the deterministic
  // (correct) parse is what ships.
  assert.equal(documentHasRichStructure(rawText), false, 'prose paper has no rich structure')
  assert.equal(
    shouldRunSmartImport(local, rawText),
    false,
    'a clean prose parse must NOT be overwritten by the smart-import LLM',
  )
}

// ─── 2. Number ranges / grades must not look like rich structure ───────────
{
  assert.equal(documentHasRichStructure('SECTION A — Part 1: Questions 1 – 20'), false)
  assert.equal(documentHasRichStructure('Part 3: Questions 26 – 30'), false)
  assert.equal(documentHasRichStructure('The new learner is in Grade 6.'), false)
  assert.equal(documentHasRichStructure('Kamwala beat Sioma by two goals to nil.'), false)
  assert.equal(documentHasRichStructure('members in all the ten provinces of Zambia'), false)
  assert.equal(documentHasRichStructure('the war-song of the extra-curricular team'), false)
}

// ─── 3. Genuine math / science content → smart import RUNS ──────────────────
{
  assert.equal(documentHasRichStructure('Simplify \\frac{3}{4} of 12.'), true, '\\frac')
  assert.equal(documentHasRichStructure('What is 1/2 + 1/4 ?'), true, 'literal fraction')
  assert.equal(documentHasRichStructure('The area of the rectangle is 24 cm².'), true, 'unit + superscript')
  assert.equal(documentHasRichStructure('A rope is 150 cm long.'), true, 'measurement unit')
  assert.equal(documentHasRichStructure('Work out 12 × 8.'), true, 'arithmetic operator')
  assert.equal(documentHasRichStructure('Solve x^2 = 49.'), true, 'exponent + equation')
  assert.equal(documentHasRichStructure('[[vmath op=- lines=954751,362948 answer=591803]]'), true, 'vmath token')
  assert.equal(documentHasRichStructure('| Animal | Legs |\n| --- | --- |\n| Dog | 4 |'), true, 'markdown table')
}

// ─── 4. A parse that needs review still runs smart import ───────────────────
{
  // Build a "clean prose" parse but pretend it flagged review — the gate must
  // let the LLM try regardless of rich structure.
  const localFlagged = { summary: { questions: 10, needsReview: 3 } }
  assert.equal(shouldRunSmartImport(localFlagged, 'plain prose with no math'), true)

  // No questions parsed at all → always try smart import.
  const localEmpty = { summary: { questions: 0, needsReview: 0 } }
  assert.equal(shouldRunSmartImport(localEmpty, 'plain prose with no math'), true)

  // Clean parse but the document has fractions → still run smart import to
  // recover them as editor nodes.
  const localCleanMath = { summary: { questions: 10, needsReview: 0 } }
  assert.equal(shouldRunSmartImport(localCleanMath, 'Add \\frac{1}{2} and \\frac{1}{3}.'), true)
}

console.log('✓ smart-import gate: clean prose papers bypass the LLM; math/flagged papers still use it')
