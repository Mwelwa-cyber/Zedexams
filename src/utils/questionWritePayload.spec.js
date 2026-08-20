/**
 * A question's extra figures survive the write — audit F-01.
 *
 * `questionSchema` has always declared `images[]`, `coerceQuestion` has always
 * read it back, `assessmentPaperLayout` renders it into print/PDF/Word, three
 * learner runners draw it through `ExtraQuestionImages`, and the Storage
 * cleanup cascade walks it to delete blobs. The one function in the middle —
 * `normalizeQuestionPayload`, which every quiz and assessment save funnels
 * through — never read `q.images`.
 *
 * That did not present as a missing field. The schema's `.default([])` meant
 * each save wrote an EMPTY ARRAY over whatever was stored, so a multi-figure
 * scanned question lost its extras on the next autosave and the save reported
 * success. These tests exist because the failure was invisible from both ends:
 * the writer looked fine and the reader looked fine.
 *
 * Vitest rather than a plain node script: the module lazily imports the editor
 * runtime (Tiptap + ProseMirror) on the save path, which needs a bundler.
 */

import { describe, it, expect } from 'vitest'
import { normalizeQuestionPayload } from './questionWritePayload.js'
import { coerceQuestion } from '../editor/schema/question.js'

/** A minimal valid MCQ, so each test states only what it is about. */
function question(overrides = {}) {
  return {
    type: 'mcq',
    text: 'Study the diagrams and answer.',
    options: ['a', 'b', 'c', 'd'],
    correctAnswer: 0,
    marks: 2,
    imageUrl: 'https://example.com/fig1.png',
    ...overrides,
  }
}

describe('normalizeQuestionPayload — extra figures', () => {
  it('persists the stacked figures instead of writing them away', async () => {
    const out = await normalizeQuestionPayload(question({
      images: [
        { url: 'https://example.com/fig2.png', alt: 'Figure 2', width: 'full' },
        { url: 'https://example.com/fig3.png', alt: 'Figure 3', width: 'half' },
      ],
    }), 1)

    expect(out.images).toHaveLength(2)
    expect(out.images[0]).toEqual({
      url: 'https://example.com/fig2.png',
      alt: 'Figure 2',
      width: 'full',
    })
    // 'half' is not a width preset; it falls back to full rather than
    // throwing, which is what every other width field in this payload does.
    expect(out.images[1].width).toBe('full')
    expect(out.images[1].url).toBe('https://example.com/fig3.png')
  })

  it('round-trips through the read side unchanged', async () => {
    const written = await normalizeQuestionPayload(question({
      images: [{ url: 'https://example.com/fig2.png', alt: 'A leaf', width: 'medium' }],
    }), 1)

    // The exact shape a Firestore read hands the runners and the exporters.
    const read = coerceQuestion({ id: 'q1', ...written })
    expect(read.images).toEqual([
      { url: 'https://example.com/fig2.png', alt: 'A leaf', width: 'medium' },
    ])
  })

  it('leaves a single-image question with an empty array, as before', async () => {
    const out = await normalizeQuestionPayload(question(), 1)
    expect(out.images).toEqual([])
  })

  it('drops entries a renderer would never draw', async () => {
    const out = await normalizeQuestionPayload(question({
      images: [
        { url: '', alt: 'blank' },
        { url: '   ', alt: 'whitespace' },
        null,
        'not-an-object',
        { alt: 'no url at all' },
        { url: 'https://example.com/real.png', alt: 'kept' },
      ],
    }), 1)

    expect(out.images).toEqual([
      { url: 'https://example.com/real.png', alt: 'kept', width: 'full' },
    ])
  })

  it('keeps the six the schema admits rather than failing the save', async () => {
    // A scanner that yielded seven figures is not something the teacher in
    // front of the editor chose or can act on, so the cap slices — it does
    // not turn a save that used to succeed into a validation error.
    const out = await normalizeQuestionPayload(question({
      images: Array.from({ length: 7 }, (_, i) => ({
        url: `https://example.com/fig${i}.png`,
        alt: `Figure ${i}`,
      })),
    }), 1)

    expect(out.images).toHaveLength(6)
    expect(out.images[5].url).toBe('https://example.com/fig5.png')
  })

  it('strips the import-only keys that must not reach Firestore', async () => {
    const out = await normalizeQuestionPayload(question({
      images: [{
        url: 'https://example.com/fig2.png',
        alt: 'Figure 2',
        imageAssetId: 'transient-import-id',
      }],
    }), 1)

    expect(out.images[0]).toEqual({
      url: 'https://example.com/fig2.png',
      alt: 'Figure 2',
      width: 'full',
    })
    expect(out.images[0]).not.toHaveProperty('imageAssetId')
  })
})
