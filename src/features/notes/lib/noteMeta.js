// src/features/notes/lib/noteMeta.js
//
// Pure helpers that derive the "at a glance" metadata shown on a learner note
// card — diagram count, estimated reading time, and any linked practice quiz —
// across all four note formats (study / rich_text / visual_slides / file).
//
// No React, no Firestore: imported by LearnerNoteCard and unit-testable.

import { NOTE_FORMAT } from '../../../config/curriculum'
import { studyReadingTime } from './studyBlocks'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** True for notes published within the last 7 days. */
export function isNewThisWeek(publishedAt) {
  if (!publishedAt) return false
  const d = typeof publishedAt?.toDate === 'function' ? publishedAt.toDate() : new Date(publishedAt)
  if (Number.isNaN(d.getTime())) return false
  return Date.now() - d.getTime() < SEVEN_DAYS_MS
}

/** Count visual blocks in a study note (picture descriptions + images). */
function studyDiagramCount(blocks) {
  return (blocks || []).filter((b) => b && (b.type === 'picture' || b.type === 'image')).length
}

/** Count <img>/<figure> in a rich-text body. */
function htmlDiagramCount(html) {
  if (!html || typeof html !== 'string') return 0
  const imgs = (html.match(/<img\b/gi) || []).length
  // A <figure> usually wraps an <img>; only count standalone figures with no img.
  const figs = (html.match(/<figure\b/gi) || []).length
  return Math.max(imgs, figs)
}

/** Estimated reading time for a rich-text body (~200 wpm, min 1). */
function htmlReadingTime(html) {
  if (!html || typeof html !== 'string') return 1
  const words = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/** Slides that carry an illustration. Decks vary, so we sniff common shapes. */
function deckDiagramCount(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : []
  return slides.filter((s) => s && (s.image || s.img || s.imageUrl || s.media || s.visual)).length
}

/** The linked practice quiz on a study note, or null. */
function studyQuiz(blocks) {
  const block = (blocks || []).find((b) => b && b.type === 'quiz' && b.quizId && String(b.quizId).trim())
  if (!block) return null
  return {
    quizId: String(block.quizId).trim(),
    quizTitle: block.quizTitle || 'Practice quiz',
    questionCount: typeof block.questionCount === 'number' ? block.questionCount : null,
  }
}

/**
 * Derive the card metadata for a note.
 * @returns {{ readMinutes: number|null, diagramCount: number, quiz: object|null, isNew: boolean }}
 */
export function deriveNoteMeta(note) {
  if (!note) return { readMinutes: null, diagramCount: 0, quiz: null, isNew: false }

  const isNew = isNewThisWeek(note.publishedAt)
  let readMinutes = null
  let diagramCount = 0
  let quiz = null

  switch (note.noteFormat) {
    case NOTE_FORMAT.STUDY: {
      const blocks = Array.isArray(note.blocks) ? note.blocks : []
      readMinutes = studyReadingTime(blocks)
      diagramCount = studyDiagramCount(blocks)
      quiz = studyQuiz(blocks)
      break
    }
    case NOTE_FORMAT.RICH_TEXT: {
      readMinutes = htmlReadingTime(note.content)
      diagramCount = htmlDiagramCount(note.content)
      break
    }
    case NOTE_FORMAT.VISUAL: {
      const slides = Array.isArray(note.deck?.slides) ? note.deck.slides : []
      diagramCount = deckDiagramCount(note.deck)
      readMinutes = Math.max(1, Math.round(slides.length * 0.75))
      break
    }
    case NOTE_FORMAT.FILE:
    default:
      // PDFs and unknown formats: no reliable estimate.
      readMinutes = null
      diagramCount = 0
  }

  return { readMinutes, diagramCount, quiz, isNew }
}
