import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  saveCreateQuizDraft,
  loadCreateQuizDraft,
  clearCreateQuizDraft,
} from './useCreateQuizDraft.js'

// The new-quiz draft autosaver guards against two things: losing typed work on
// an accidental refresh, and rehydrating DEAD runtime state — blob: URLs and
// in-memory asset ids that only mean anything while the page session is alive
// (surfacing them after a reload is the "broken-image icon on a restored
// draft" bug class the module comments call out). These pin the strip-on-save
// behaviour, the TTL expiry, and the empty-draft guards. jsdom provides
// localStorage.

const KEY = (uid) => `examprep:createquiz:draft:${uid}`
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('saveCreateQuizDraft', () => {
  it('persists form / sections / creationMode under a per-user key with a timestamp', () => {
    saveCreateQuizDraft('u1', {
      form: { title: 'My quiz' },
      sections: [{ kind: 'single', question: { text: 'Q1' } }],
      creationMode: 'manual',
    })
    const saved = JSON.parse(localStorage.getItem(KEY('u1')))
    expect(saved.form).toEqual({ title: 'My quiz' })
    expect(saved.creationMode).toBe('manual')
    expect(typeof saved.savedAt).toBe('number')
  })

  it('strips a blob: URL off a question image', () => {
    saveCreateQuizDraft('u1', {
      sections: [{ kind: 'single', question: { text: 'Q', imageUrl: 'blob:abc' } }],
    })
    const saved = JSON.parse(localStorage.getItem(KEY('u1')))
    expect(saved.sections[0].question.imageUrl).toBe('')
  })

  it('keeps a real (non-blob) image URL', () => {
    saveCreateQuizDraft('u1', {
      sections: [{ kind: 'single', question: { text: 'Q', imageUrl: 'https://cdn/x.png' } }],
    })
    const saved = JSON.parse(localStorage.getItem(KEY('u1')))
    expect(saved.sections[0].question.imageUrl).toBe('https://cdn/x.png')
  })

  it('drops runtime upload flags + imageAssetId from a question', () => {
    saveCreateQuizDraft('u1', {
      sections: [{
        kind: 'single',
        question: {
          text: 'Q', imageUploading: true, imageUploadStep: 2, imageAssetId: 'a1',
        },
      }],
    })
    const q = JSON.parse(localStorage.getItem(KEY('u1'))).sections[0].question
    expect(q.text).toBe('Q')
    expect('imageUploading' in q).toBe(false)
    expect('imageUploadStep' in q).toBe(false)
    expect('imageAssetId' in q).toBe(false)
  })

  it('strips blob imageUrl + imageAssetId from per-option media', () => {
    saveCreateQuizDraft('u1', {
      sections: [{
        kind: 'single',
        question: {
          text: 'Q',
          optionMedia: [
            { alt: 'keep', imageUrl: 'blob:dead', imageAssetId: 'a1' },
            { alt: 'plain' },
          ],
        },
      }],
    })
    const media = JSON.parse(localStorage.getItem(KEY('u1'))).sections[0].question.optionMedia
    expect('imageUrl' in media[0]).toBe(false)
    expect('imageAssetId' in media[0]).toBe(false)
    expect(media[0].alt).toBe('keep') // non-runtime fields survive
    expect(media[1].alt).toBe('plain')
  })

  it('strips runtime state inside a passage section and its nested questions', () => {
    saveCreateQuizDraft('u1', {
      sections: [{
        kind: 'passage',
        passage: {
          imageUrl: 'blob:dead',
          imageAssetId: 'p1',
          imageUploading: true,
          questions: [{ text: 'PQ', imageUrl: 'blob:q', imageAssetId: 'q1' }],
        },
      }],
    })
    const passage = JSON.parse(localStorage.getItem(KEY('u1'))).sections[0].passage
    expect(passage.imageUrl).toBe('')
    expect('imageAssetId' in passage).toBe(false)
    expect('imageUploading' in passage).toBe(false)
    expect(passage.questions[0].imageUrl).toBe('')
    expect('imageAssetId' in passage.questions[0]).toBe(false)
  })

  it('is a no-op without a userId or payload', () => {
    saveCreateQuizDraft(null, { sections: [] })
    saveCreateQuizDraft('u1', null)
    expect(localStorage.length).toBe(0)
  })
})

describe('loadCreateQuizDraft', () => {
  it('round-trips a freshly saved draft', () => {
    saveCreateQuizDraft('u1', {
      form: { title: 'T' },
      sections: [{ kind: 'single', question: { text: 'Q1' } }],
    })
    const loaded = loadCreateQuizDraft('u1')
    expect(loaded.form.title).toBe('T')
    expect(loaded.sections).toHaveLength(1)
  })

  it('returns null (and clears) an expired draft past the 7-day TTL', () => {
    const stale = {
      sections: [{ kind: 'single', question: { text: 'Q' } }],
      savedAt: Date.now() - 8 * DAY,
    }
    localStorage.setItem(KEY('u1'), JSON.stringify(stale))
    expect(loadCreateQuizDraft('u1')).toBeNull()
    expect(localStorage.getItem(KEY('u1'))).toBeNull()
  })

  it('returns null for a draft with no sections', () => {
    localStorage.setItem(KEY('u1'), JSON.stringify({ sections: [], savedAt: Date.now() }))
    expect(loadCreateQuizDraft('u1')).toBeNull()
  })

  it('returns null for missing user, missing draft, or corrupt JSON', () => {
    expect(loadCreateQuizDraft(null)).toBeNull()
    expect(loadCreateQuizDraft('nobody')).toBeNull()
    localStorage.setItem(KEY('u1'), '{ not json')
    expect(loadCreateQuizDraft('u1')).toBeNull()
  })
})

describe('clearCreateQuizDraft', () => {
  it('removes the saved draft for the user', () => {
    saveCreateQuizDraft('u1', { sections: [{ kind: 'single', question: { text: 'Q' } }] })
    expect(localStorage.getItem(KEY('u1'))).not.toBeNull()
    clearCreateQuizDraft('u1')
    expect(localStorage.getItem(KEY('u1'))).toBeNull()
  })

  it('is a no-op without a userId', () => {
    saveCreateQuizDraft('u1', { sections: [{ kind: 'single', question: { text: 'Q' } }] })
    clearCreateQuizDraft(null)
    expect(localStorage.getItem(KEY('u1'))).not.toBeNull()
  })
})
