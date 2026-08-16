/**
 * Zod schemas for the `diagramAssets` collection — the curriculum Diagram
 * Library (Visual Studio v2, spec 1A).
 *
 * One asset is ONE data model; the four printable versions (teacher words /
 * learner P,Q,R / answer key / picture only) are projections derived at render
 * time from `labels`, never four saved images. Two consequences the schema
 * enforces:
 *
 *   • Letters (P, Q, R…) are NEVER stored. They are derived at render time
 *     from reading order (sort anchor.y, then anchor.x) so add/delete cannot
 *     skip or duplicate a letter. Any `letter` field on a label is stripped
 *     on write (zod strips unknown keys on non-passthrough objects).
 *   • Label coordinates are normalized 0–1 (`anchor` = the point ON the part,
 *     `box` = where the label box sits) so the same data renders on a phone
 *     canvas, an A4 paper block, and the learner app's drag-the-label zones.
 *
 * Distinct from `src/shared/schemas/visualAsset.js` (a teacher's flattened, baked
 * PNGs — "My Visuals"): a diagramAsset stores the SOURCE art + label data and
 * is consumed by ID (`assetId` + `version`) from papers, notes, worksheets and
 * the learner app. Style mirrors visualAsset.js: strict write schema +
 * permissive read coercer that never throws on legacy/partial docs.
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
function clamp01(v, fallback = 0.5) {
  return Math.max(0, Math.min(1, safeNumber(v, fallback)))
}

const str = (max) =>
  z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(max))

export const DIAGRAM_ART_TYPES = ['raster', 'svg', 'template']
export const DIAGRAM_PROVENANCES = ['ai-generated', 'uploaded', 'template', 'bank']
export const DIAGRAM_STATUSES = ['draft', 'approved', 'published', 'rejected']
export const DIAGRAM_SCOPES = ['private', 'school', 'public']
export const DIAGRAM_VARIANT_KINDS = [
  'simpler', 'more-detailed', 'different-example', 'unlabelled', 'colour-teaching',
]
export const MAX_DIAGRAM_LABELS = 40
export const MAX_DIAGRAM_HISTORY = 30

/** A normalized 0–1 point. */
const point = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

/**
 * The art the labels sit on. One of three kinds, discriminated by `type`:
 *   raster   → storagePath (+ url, the CORS-safe download URL renderers read)
 *   svg      → svgSource (inline SVG markup, renderer-sanitised before use)
 *   template → templateId + params (parametric engine renders deterministic SVG)
 * Kept a single object rather than a zod union so a legacy/partial doc coerces
 * instead of failing wholesale; `type` decides which fields are meaningful.
 */
const artSchema = z.object({
  type: z.enum(DIAGRAM_ART_TYPES),
  storagePath: str(500).default(''),
  url: str(2000).default(''),
  svgSource: str(200000).default(''),
  templateId: str(80).default(''),
  params: z.record(z.string(), z.any()).default({}),
})

/**
 * A label: the word, where it points (`anchor`) and where its box sits
 * (`box`). NO letter field — letters are a render-time projection. Unknown
 * keys (including a stray `letter`) are stripped by zod's default behaviour.
 */
const labelSchema = z.object({
  id: str(80).default(''),
  word: z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(80)),
  anchor: point,
  box: point,
  confidence: z.number().min(0).max(1).optional(),
})

const followUpSchema = z.object({
  text: z.string().min(1).max(500),
  marks: z.number().int().min(0).max(50).optional(),
})

/**
 * A named history stage (spec 3D): Original → AI labelled → Teacher edited →
 * Paper version, plus assistant commands. Art is immutable per asset, so a
 * snapshot only carries labels + template params and stays small.
 */
const historyStageSchema = z.object({
  stage: str(40).default(''),
  label: str(120).default(''),
  snapshot: z.object({
    labels: z.array(labelSchema).max(MAX_DIAGRAM_LABELS).default([]),
    params: z.record(z.string(), z.any()).default({}),
  }),
  at: z.number().int().min(0).default(0),
  by: str(200).default(''),
})

/**
 * Strict schema validated before any write to `diagramAssets`.
 * `.passthrough()` at the TOP level keeps forward-compatible ad-hoc fields
 * (same convention as visualAssetWriteSchema); nested label/history objects
 * stay strict-stripping so derived data can never be persisted.
 */
export const diagramAssetWriteSchema = z
  .object({
    createdBy: z.string().min(1).max(200),
    createdByName: str(160).default(''),

    title: z.string().min(1).max(200),
    description: str(1000).default(''),

    art: artSchema,
    labels: z.array(labelSchema).max(MAX_DIAGRAM_LABELS).default([]),

    instruction: str(500).default(''),
    followUpQuestions: z.array(followUpSchema).max(20).default([]),

    // Curriculum taxonomy — grades/subjects come from the canonical config
    // (src/config/curriculum.js + educationLevels.js), never a second registry.
    subject: str(100).default(''),
    grade: z.union([z.string().max(20), z.number().int().min(0).max(20)]).default(''),
    topic: str(200).default(''),
    subtopic: str(200).default(''),
    curriculum: str(20).default(''),

    style: str(60).default('bw-line'),
    // Educational purpose (spec 2A) — drives defaults, not hard modes.
    purpose: str(40).default(''),

    provenance: z.enum(DIAGRAM_PROVENANCES).default('ai-generated'),
    status: z.enum(DIAGRAM_STATUSES).default('draft'),
    scope: z.enum(DIAGRAM_SCOPES).default('private'),

    // Consumers reference `assetId + version`; bump on any label/param edit.
    version: z.number().int().min(1).max(1000000).default(1),

    // Related-visuals family (spec 3E). familyId groups variants under one
    // Library card; variantOf points at the source asset.
    familyId: str(80).default(''),
    variantOf: str(80).default(''),
    variantKind: z.preprocess(
      (v) => (v == null ? '' : String(v)),
      z.union([z.enum(DIAGRAM_VARIANT_KINDS), z.literal('')]),
    ).default(''),

    history: z.array(historyStageSchema).max(MAX_DIAGRAM_HISTORY).default([]),

    // Migration bookkeeping: the legacy doc this asset was derived from
    // (`pictureBank/{id}` or `visualAssets/{id}`), which is also what makes
    // the migration idempotent.
    migratedFrom: str(160).default(''),
  })
  .passthrough()

export const diagramAssetUpdateSchema = diagramAssetWriteSchema.partial()

function coerceLabel(l) {
  if (!isPlainObject(l)) return null
  const word = safeString(l.word ?? l.text)
  const anchor = isPlainObject(l.anchor)
    ? { x: clamp01(l.anchor.x), y: clamp01(l.anchor.y) }
    : { x: clamp01(l.x), y: clamp01(l.y) }
  const box = isPlainObject(l.box)
    ? { x: clamp01(l.box.x), y: clamp01(l.box.y) }
    : { ...anchor }
  const out = { id: safeString(l.id), word: word.slice(0, 80), anchor, box }
  const conf = Number(l.confidence)
  if (Number.isFinite(conf)) out.confidence = Math.max(0, Math.min(1, conf))
  return out
}

function coerceArt(raw) {
  const a = isPlainObject(raw) ? raw : {}
  return {
    type: DIAGRAM_ART_TYPES.includes(a.type) ? a.type : 'raster',
    storagePath: safeString(a.storagePath),
    url: safeString(a.url),
    svgSource: safeString(a.svgSource),
    templateId: safeString(a.templateId),
    params: isPlainObject(a.params) ? a.params : {},
  }
}

/** Permissive read-side coercer — never throws. */
export function coerceDiagramAsset(raw) {
  if (!isPlainObject(raw)) return null
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map(coerceLabel).filter(Boolean).slice(0, MAX_DIAGRAM_LABELS)
    : []
  const followUpQuestions = Array.isArray(raw.followUpQuestions)
    ? raw.followUpQuestions
        .filter(isPlainObject)
        .map((q) => {
          const text = safeString(q.text).slice(0, 500)
          if (!text) return null
          const out = { text }
          const marks = Number(q.marks)
          if (Number.isFinite(marks) && marks >= 0) out.marks = Math.round(marks)
          return out
        })
        .filter(Boolean)
    : []
  return {
    ...raw,
    id: safeString(raw.id),
    title: safeString(raw.title) || 'Untitled diagram',
    art: coerceArt(raw.art),
    labels,
    instruction: safeString(raw.instruction),
    followUpQuestions,
    subject: safeString(raw.subject),
    grade: raw.grade == null ? '' : raw.grade,
    topic: safeString(raw.topic),
    subtopic: safeString(raw.subtopic),
    curriculum: safeString(raw.curriculum),
    style: safeString(raw.style, 'bw-line') || 'bw-line',
    purpose: safeString(raw.purpose),
    provenance: DIAGRAM_PROVENANCES.includes(raw.provenance) ? raw.provenance : 'ai-generated',
    status: DIAGRAM_STATUSES.includes(raw.status) ? raw.status : 'draft',
    scope: DIAGRAM_SCOPES.includes(raw.scope) ? raw.scope : 'private',
    version: Math.max(1, Math.round(safeNumber(raw.version, 1))),
    familyId: safeString(raw.familyId),
    variantOf: safeString(raw.variantOf),
    variantKind: DIAGRAM_VARIANT_KINDS.includes(raw.variantKind) ? raw.variantKind : '',
    history: Array.isArray(raw.history) ? raw.history.filter(isPlainObject) : [],
    migratedFrom: safeString(raw.migratedFrom),
  }
}
