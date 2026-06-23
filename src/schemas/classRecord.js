/**
 * src/schemas/classRecord.js
 *
 * Shape of a Class Register marking record
 * (classRegisters/{classId}/records/{recordId}).
 *
 * A record captures a roster SNAPSHOT at creation so later roster edits never
 * corrupt historical marks. Write-strict / read-permissive per quiz.js.
 */

import { z } from 'zod'

const RECORD_TYPES = ['assessment', 'sba', 'sba_final', 'mark_schedule']

const columnSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  max: z.number().min(0).max(1000),
}).passthrough()

const snapshotEntrySchema = z.object({
  rosterId: z.string().min(1).max(200),
  learnerNumber: z.string().max(20).default(''),
  fullName: z.string().max(120).default(''),
  gender: z.enum(['M', 'F', 'other']).nullable().default(null),
}).passthrough()

export const classRecordWriteSchema = z
  .object({
    classId: z.string().min(1).max(200),
    teacherUid: z.string().min(1).max(200),
    type: z.enum(RECORD_TYPES),
    title: z.string().min(1).max(160),
    subject: z.string().max(100).nullable().default(null),
    term: z.string().max(40).default(''),
    year: z.number().int().min(2000).max(2100),
    assessmentType: z.string().max(40).default(''),
    sourceAssessmentId: z.string().max(200).nullable().default(null),
    columns: z.array(columnSchema).max(30).default([]),
    rosterSnapshot: z.array(snapshotEntrySchema).max(2000).default([]),
    // marks + stats are recomputed on every save; kept permissive.
    marks: z.record(z.string(), z.any()).default({}),
    stats: z.record(z.string(), z.any()).default({}),
  })
  .passthrough()

export const classRecordUpdateSchema = classRecordWriteSchema.partial()

// ── Read-side coercion ───────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
function safeString(v, fallback = '') {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}
function safeNumber(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return fallback
}

export function coerceClassRecord(raw) {
  if (!isPlainObject(raw)) return null
  const type = RECORD_TYPES.includes(raw.type) ? raw.type : 'mark_schedule'
  return {
    ...raw,
    type,
    title: safeString(raw.title),
    subject: raw.subject == null ? null : safeString(raw.subject),
    term: safeString(raw.term),
    year: safeNumber(raw.year, new Date().getFullYear()),
    assessmentType: safeString(raw.assessmentType),
    sourceAssessmentId: raw.sourceAssessmentId == null ? null : safeString(raw.sourceAssessmentId),
    columns: Array.isArray(raw.columns) ? raw.columns : [],
    rosterSnapshot: Array.isArray(raw.rosterSnapshot) ? raw.rosterSnapshot : [],
    marks: isPlainObject(raw.marks) ? raw.marks : {},
    stats: isPlainObject(raw.stats) ? raw.stats : {},
  }
}

export const CLASS_RECORD_TYPES = RECORD_TYPES
