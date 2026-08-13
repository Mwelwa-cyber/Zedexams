/**
 * A saved assessment paper, reopened.
 *
 * The defect: every question in a paper that was saved and reopened printed
 * `[object Object]` in the studio's question box, and its raw
 * `{"type":"doc",…}` on the preview page. Marks and answer options were intact,
 * so the paper looked structurally fine and had no readable question in it.
 *
 * The chain, which is why this test replays the WHOLE round trip rather than
 * unit-testing the extractor alone — no single step was doing anything obviously
 * wrong, and four of them had to line up:
 *
 *   1. `normalizeQuestionPayload` stores rich text twice: `text` as HTML and
 *      `textJSON` as the TipTap doc (contentVersion 3, deliberate).
 *   2. `hydrateStandaloneQuestion` prefers `textJSON` — so the value in studio
 *      state after a reopen is an OBJECT, where before the save it was a string.
 *   3. `richTextToPlainText` did `String(value)`, which for a doc object is the
 *      literal "[object Object]" and for the serialised doc is its raw JSON.
 *   4. The builder textarea and `assessmentPaperLayout`'s `plain()` both call it,
 *      and `PaperBlocks` renders that plain field rather than `textHtml`.
 *
 * So the assertions are on what a TEACHER sees in each surface, not on the
 * extractor's return value: the bug was invisible at every layer until those
 * two surfaces rendered.
 */
import { describe, it, expect } from 'vitest'
import {
  createStandaloneSection,
  hydrateQuizSections,
  serializeQuizSections,
} from '../../../utils/quizSections.js'
import { normalizeQuestionPayload } from '../../../utils/questionWritePayload.js'
import { buildAssessmentDocument } from '../../../utils/assessmentDocument.js'
import { richTextToPlainText, extractRichTextPlain } from '../../../utils/quizRichText.js'
import { toEditableText } from './AssessmentQuestionEditors.jsx'

const STEM = 'The main organ used for breathing in the human body is the ............'

const ASSESSMENT = {
  title: 'Grade 4 End of Term 1 Test',
  subject: 'Integrated Science',
  grade: '4',
  questions: [],
}

/** Save a paper the way the studio does, then reopen it the way the studio does. */
async function saveAndReopen(text) {
  const section = createStandaloneSection({
    text,
    type: 'mcq',
    options: ['heart', 'lungs', 'stomach', ''],
    correctAnswer: 1,
    marks: 2,
  })
  const outgoing = serializeQuizSections([section], [])
  const storedDoc = await normalizeQuestionPayload(outgoing.questions[0], 1)
  // What getAssessmentQuestions hands back: the Firestore doc plus its id.
  const { sections } = hydrateQuizSections([{ id: 'q-1', ...storedDoc }], [], [], [])
  const reserialized = serializeQuizSections(sections, [])
  const model = buildAssessmentDocument(ASSESSMENT, reserialized.questions, { mode: 'paper' })
  return {
    stored: storedDoc,
    question: sections[0].question,
    block: model.blocks.find(b => b.kind === 'question'),
  }
}

describe('a paper saved and reopened', () => {
  it('shows the question text in the builder, not [object Object]', async () => {
    const { question } = await saveAndReopen(`<p>${STEM}</p>`)
    // The precondition the whole defect rests on. If a future change stops
    // preferring textJSON this assertion is what says the test is now proving
    // something easier than the bug.
    expect(typeof question.text).toBe('object')
    expect(toEditableText(question.text)).toBe(STEM)
  })

  it('prints the question text on the preview page, not its raw JSON', async () => {
    const { block } = await saveAndReopen(`<p>${STEM}</p>`)
    // PaperBlocks renders `block.text`; `textHtml` was correct throughout and
    // is asserted only so a fix that swapped which field is rendered, rather
    // than fixing the field, still has to keep both right.
    expect(block.text).toBe(STEM)
    expect(block.textHtml).toContain(STEM)
    expect(block.text).not.toMatch(/"type"\s*:\s*"doc"/)
  })

  it('survives a second save → reopen without degrading', async () => {
    // The reopened value is an object, so the next autosave serialises an
    // object rather than the HTML string the first save had. That is a
    // different input to the same pipeline, and it is the state a paper is
    // actually in by the time a teacher edits it a third time.
    const first = await saveAndReopen(`<p>${STEM}</p>`)
    const second = await saveAndReopen(first.question.text)
    expect(toEditableText(second.question.text)).toBe(STEM)
    expect(second.block.text).toBe(STEM)
  })

  it('keeps a question the teacher typed in the rich editor', async () => {
    // What RichEditor hands to `update('text', json)` in the slide-over: a live
    // TipTap doc, never a string.
    const typed = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { textAlign: null },
        content: [{ type: 'text', text: STEM }],
      }],
    }
    const { question, block } = await saveAndReopen(typed)
    expect(toEditableText(question.text)).toBe(STEM)
    expect(block.text).toBe(STEM)
  })
})

describe('richTextToPlainText understands every shape it is handed', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: STEM }] }],
  }

  it('reads a live TipTap doc', () => {
    expect(richTextToPlainText(doc)).toBe(STEM)
  })

  it('reads a serialised TipTap doc', () => {
    expect(richTextToPlainText(JSON.stringify(doc))).toBe(STEM)
  })

  it('still reads HTML and plain strings', () => {
    expect(richTextToPlainText(`<p>${STEM}</p>`)).toBe(STEM)
    expect(richTextToPlainText(STEM)).toBe(STEM)
  })

  it('leaves ordinary text that merely starts with a brace alone', () => {
    // The cheap pre-check must not swallow real content — a maths question can
    // legitimately open with a set literal.
    expect(richTextToPlainText('{1, 2, 3} is a set of numbers')).toBe('{1, 2, 3} is a set of numbers')
    expect(richTextToPlainText('{"type": not really json')).toContain('not really json')
  })

  it('never returns the string "[object Object]" for a rich value', () => {
    for (const value of [doc, JSON.stringify(doc), `<p>${STEM}</p>`, STEM]) {
      expect(richTextToPlainText(value)).not.toContain('[object Object]')
    }
  })

  it('agrees with extractRichTextPlain, which is now the same function', () => {
    // The two used to differ, which is how one caller could be right and its
    // neighbour wrong. If they ever diverge again this fails.
    for (const value of [doc, JSON.stringify(doc), `<p>${STEM}</p>`, STEM, '', null]) {
      expect(extractRichTextPlain(value)).toBe(value == null ? '' : richTextToPlainText(value))
    }
  })
})
