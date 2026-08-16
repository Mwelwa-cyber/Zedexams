/**
 * Zod schemas for the `visualAssets` collection — a teacher's own saved
 * Visual Studio pictures (the personal "Picture Bank" / "My visuals").
 *
 * This is distinct from the admin-curated shared `pictureBank` collection
 * (src/utils/pictureBankService.js): `visualAssets` are owned by the teacher
 * who made them (`createdBy`), private by default, and optionally shared to
 * the school / made public for admin approval.
 *
 * Style mirrors src/shared/schemas/quiz.js: a strict WRITE schema (catch bugs before
 * a Firestore write) + a permissive read coercer (survive legacy / partial
 * docs without throwing in render).
 */

import { z } from 'zod'

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}
function safeString(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v))
}
function safeNumber(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const str = (max) =>
  z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(max))

export const VISUAL_SOURCE_TYPES = ['ai', 'upload', 'template', 'clipart']
export const VISUAL_STATUSES = ['draft', 'approved', 'published', 'rejected']
export const VISUAL_VISIBILITIES = ['private', 'school', 'public']
export const VISUAL_SAFETY = ['unreviewed', 'ok', 'flagged']

/**
 * Strict schema validated before any write to `visualAssets`.
 * `.passthrough()` keeps forward-compatible ad-hoc fields rather than
 * silently dropping them (same convention as quizWriteSchema).
 */
export const visualAssetWriteSchema = z
  .object({
    createdBy: z.string().min(1).max(200),
    createdByName: str(160).default(''),

    title: z.string().min(1).max(200),
    description: str(1000).default(''),

    // Curriculum metadata (drives the search/filter facets).
    grade: z.union([z.string().max(20), z.number().int().min(0).max(20)]).default(''),
    subject: str(100).default(''),
    topic: str(200).default(''),
    subtopic: str(200).default(''),

    style: str(60).default('bw_test_diagram'),
    useCase: str(40).default(''),
    imageType: str(40).default('diagram'),
    isLabelled: z.boolean().default(false),
    hasAnswerKey: z.boolean().default(false),
    isBlackAndWhite: z.boolean().default(true),

    // Storage references. imageUrl is the stable, CORS-safe download URL the
    // exporters read; storagePath is kept for cascade cleanup.
    imageUrl: str(2000).default(''),
    thumbnailUrl: str(2000).default(''),
    storagePath: str(500).default(''),
    width: z.number().int().min(0).max(8000).default(0),
    height: z.number().int().min(0).max(8000).default(0),

    sourceType: z.enum(VISUAL_SOURCE_TYPES).default('ai'),
    license: str(200).default(''),
    aiModel: str(120).default(''),
    aiPrompt: str(2000).default(''),
    aiCost: z.number().min(0).max(100).default(0),

    // The label set + answer key so a saved learner image can be reused with
    // its blanks/legend intact. Bounded to keep the doc small.
    labels: z
      .array(
        z.object({
          id: str(80).default(''),
          letter: str(8).default(''),
          text: str(80).default(''),
          x: z.number().min(0).max(1).default(0.5),
          y: z.number().min(0).max(1).default(0.5),
        }),
      )
      .max(40)
      .default([]),
    answerKey: str(2000).default(''),

    safetyStatus: z.enum(VISUAL_SAFETY).default('unreviewed'),
    reviewNotes: str(2000).default(''),

    status: z.enum(VISUAL_STATUSES).default('draft'),
    visibility: z.enum(VISUAL_VISIBILITIES).default('private'),
    usedIn: z.array(z.string().max(40)).max(20).default([]),
  })
  .passthrough()

export const visualAssetUpdateSchema = visualAssetWriteSchema.partial()

/** Permissive read-side coercer — never throws. */
export function coerceVisualAsset(raw) {
  if (!isPlainObject(raw)) return null
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter(isPlainObject)
        .map((l) => ({
          id: safeString(l.id),
          letter: safeString(l.letter),
          text: safeString(l.text),
          x: Math.max(0, Math.min(1, safeNumber(l.x, 0.5))),
          y: Math.max(0, Math.min(1, safeNumber(l.y, 0.5))),
        }))
    : []
  return {
    ...raw,
    id: safeString(raw.id),
    title: safeString(raw.title) || 'Untitled visual',
    grade: raw.grade == null ? '' : raw.grade,
    subject: safeString(raw.subject),
    topic: safeString(raw.topic),
    subtopic: safeString(raw.subtopic),
    imageUrl: safeString(raw.imageUrl),
    thumbnailUrl: safeString(raw.thumbnailUrl) || safeString(raw.imageUrl),
    storagePath: safeString(raw.storagePath),
    style: safeString(raw.style, 'bw_test_diagram'),
    isLabelled: Boolean(raw.isLabelled),
    hasAnswerKey: Boolean(raw.hasAnswerKey),
    isBlackAndWhite: raw.isBlackAndWhite == null ? true : Boolean(raw.isBlackAndWhite),
    status: VISUAL_STATUSES.includes(raw.status) ? raw.status : 'draft',
    visibility: VISUAL_VISIBILITIES.includes(raw.visibility) ? raw.visibility : 'private',
    safetyStatus: VISUAL_SAFETY.includes(raw.safetyStatus) ? raw.safetyStatus : 'unreviewed',
    labels,
    answerKey: safeString(raw.answerKey),
    usedIn: Array.isArray(raw.usedIn) ? raw.usedIn.map((u) => safeString(u)).filter(Boolean) : [],
  }
}
