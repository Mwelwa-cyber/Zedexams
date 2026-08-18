/**
 * test:study-block-render — a study note may not carry a block type that a
 * surface renders as nothing.
 *
 * The bug this exists for: `tapexplore`, `labeldiagram`, `startend` and
 * `flow` were added to the block vocabulary for the Digestive System note,
 * but the Notes Studio previewed through the legacy StudyNoteReader, which
 * has no case for them. The note was correct and complete in Firestore and
 * the studio showed an author a note with no organ pictures and no
 * label-the-diagram figure — silently, because an unhandled block type
 * renders `null` rather than throwing.
 *
 * Text-level checks, deliberately: the failure is a MISSING case, and a
 * behavioural test can only assert about the cases someone remembered to
 * write. Parsing the switch is what notices the one they didn't.
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures++; console.error(`FAIL  ${name}\n      ${err.message}`) }
}

// ── the vocabulary: keys of `blockSchemas` in studySchema.js ──────────
const schemaSrc = read('src/features/notes/lib/studySchema.js')
const schemaBody = schemaSrc.slice(
  schemaSrc.indexOf('const blockSchemas = {'),
  schemaSrc.indexOf('export const studyBlockSchema'),
)
const BLOCK_TYPES = [...schemaBody.matchAll(/^ {2}(\w+):\s*z\.object\(/gm)].map((m) => m[1])

// ── what the learner's renderer handles ──────────────────────────────
const readerSrc = read('src/features/notes/reader/ReaderBlock.jsx')
const READER_CASES = new Set([...readerSrc.matchAll(/^\s*case '(\w+)':/gm)].map((m) => m[1]))

// `glossary` is resolved into the word sheet by ReaderEngine and is never
// a block on the page. It is the ONLY type allowed to render nothing, and
// naming it here is what stops "renders nothing" becoming the default.
const NOT_RENDERED = new Set(['glossary'])

test('studySchema declares a non-trivial block vocabulary', () => {
  assert.ok(BLOCK_TYPES.length >= 20, `parsed only ${BLOCK_TYPES.length} block types — the parser has drifted`)
  for (const t of ['tapexplore', 'labeldiagram', 'startend', 'flow', 'image']) {
    assert.ok(BLOCK_TYPES.includes(t), `expected "${t}" in the block vocabulary`)
  }
})

test('every block type is rendered by ReaderBlock', () => {
  const missing = BLOCK_TYPES.filter((t) => !READER_CASES.has(t) && !NOT_RENDERED.has(t))
  assert.deepEqual(missing, [], `block types with no case in ReaderBlock.jsx: ${missing.join(', ')}`)
})

test('the guard can fail — an unknown type is reported', () => {
  const missing = ['definitely_not_a_block'].filter((t) => !READER_CASES.has(t) && !NOT_RENDERED.has(t))
  assert.deepEqual(missing, ['definitely_not_a_block'])
})

// ── the studio previews through the learner's renderer ───────────────
const editorSrc = read('src/features/notes/components/StudyNoteEditor.jsx')

test('the studio previews a reader note through the learner renderer', () => {
  assert.ok(
    /import BlocksPreview from '\.\.\/reader\/BlocksPreview'/.test(editorSrc),
    'StudyNoteEditor must import BlocksPreview',
  )
  assert.ok(
    /isReaderNote\(blocks\)/.test(editorSrc),
    'StudyNoteEditor must decide the preview with isReaderNote(blocks)',
  )
  assert.ok(
    /reader \? <BlocksPreview blocks=\{blocks\} \/> : <StudyNoteReader blocks=\{blocks\} \/>/.test(editorSrc),
    'the preview column must render BlocksPreview for a reader note and StudyNoteReader otherwise',
  )
})

// Comments stripped: this file EXPLAINS why it does not filter by mode, so
// a prose mention of planNoteView must not read as a call to it.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const previewSrc = stripComments(read('src/features/notes/reader/BlocksPreview.jsx'))

test('the authoring preview filters nothing', () => {
  // Mode placement (readerCore.planNoteView / blockPlacement) hides the key
  // points in Learn and the quiz + label game in Revise. Correct for a
  // learner, wrong for an author — a block they wrote must be on screen.
  assert.ok(
    !/planNoteView|blockPlacement|PLACEMENT/.test(previewSrc),
    'BlocksPreview must not apply Learn/Revise mode filtering',
  )
  assert.ok(/ReaderBlock/.test(previewSrc), 'BlocksPreview must render through ReaderBlock')
})

// ── every type has a human-readable name in the studio ───────────────
const blocksSrc = read('src/features/notes/lib/studyBlocks.js')
const LABELLED = new Set([
  ...[...blocksSrc.matchAll(/^ {2}(\w+):\s*'/gm)].map((m) => m[1]),
])

test('every block type has a display label', () => {
  const unlabelled = BLOCK_TYPES.filter((t) => !LABELLED.has(t))
  assert.deepEqual(unlabelled, [], `block types with no label in studyBlocks.js: ${unlabelled.join(', ')}`)
})

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
