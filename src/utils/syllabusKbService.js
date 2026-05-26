/**
 * Client-side service for the editable Syllabi Studio used by the CBC KB
 * admin page and the read-only teacher Syllabi Library.
 *
 * Loads the canonical curriculum-data.json from /syllabi (served by
 * Hosting) and overlays admin overrides stored under
 *   cbcKnowledgeBase/{activeVersion}/syllabusOverrides/*
 *
 * Edits go through the admin-only callables (upsertSyllabusRow,
 * deleteSyllabusRow, restoreSyllabusRow) so write access stays gated at
 * the Cloud Functions layer — the rules deny direct client writes on
 * the overrides subcollection.
 */

import { collection, getDocs } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { getActiveKbVersion } from './adminCbcKbService'

const functions = getFunctions(app, 'us-central1')
const upsertSyllabusRowCallable = httpsCallable(functions, 'upsertSyllabusRow', {
  timeout: 30_000,
})
const deleteSyllabusRowCallable = httpsCallable(functions, 'deleteSyllabusRow', {
  timeout: 30_000,
})
const restoreSyllabusRowCallable = httpsCallable(functions, 'restoreSyllabusRow', {
  timeout: 30_000,
})

let _rawCache = null
let _rawCachePromise = null

/**
 * Fetch the canonical Syllabi Studio JSON, cached in memory. ~1.3MB so we
 * deliberately avoid bundling it — first call kicks off a single fetch
 * and every subsequent caller awaits the same Promise.
 */
async function loadRawCurriculum() {
  if (_rawCache) return _rawCache
  if (_rawCachePromise) return _rawCachePromise
  _rawCachePromise = (async () => {
    try {
      const response = await fetch('/syllabi/curriculum-data.json')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      _rawCache = await response.json()
      return _rawCache
    } catch (err) {
      console.error('loadRawCurriculum failed', err)
      _rawCache = {}
      return _rawCache
    } finally {
      _rawCachePromise = null
    }
  })()
  return _rawCachePromise
}

let _overridesCache = null
let _overridesCacheAt = 0
const OVERRIDES_TTL_MS = 15_000

async function loadOverrides({ force = false } = {}) {
  const now = Date.now()
  if (!force && _overridesCache && (now - _overridesCacheAt) < OVERRIDES_TTL_MS) {
    return _overridesCache
  }
  try {
    const version = await getActiveKbVersion()
    const snap = await getDocs(
      collection(db, 'cbcKnowledgeBase', version, 'syllabusOverrides'),
    )
    // Last-write-wins is intentional — overlapping refreshes converge on
    // the most recent fetch; nothing reads _overridesCacheAt between the
    // two assignments below.
    // eslint-disable-next-line require-atomic-updates
    _overridesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line require-atomic-updates
    _overridesCacheAt = now
    return _overridesCache
  } catch (err) {
    console.warn('loadOverrides failed (likely unauthenticated)', err)
    _overridesCache = []
    _overridesCacheAt = now
    return _overridesCache
  }
}

function applyOverrides(raw, overrides) {
  if (!overrides?.length) return raw
  // JSON.parse(JSON.stringify(...)) is the simplest deep clone here —
  // the JSON has no Dates, Maps, or other irregulars.
  const clone = JSON.parse(JSON.stringify(raw))
  for (const ov of overrides) {
    if (!ov || !ov.studioSubject || !ov.sheet) continue
    if (!clone[ov.studioSubject]) clone[ov.studioSubject] = {}
    if (!clone[ov.studioSubject][ov.sheet]) {
      clone[ov.studioSubject][ov.sheet] = {
        title: ov.sheet,
        columns: [
          'TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES',
          'LEARNING ACTIVITIES', 'EXPECTED STANDARD',
        ],
        rows: [],
      }
    }
    const sheetData = clone[ov.studioSubject][ov.sheet]
    if (!Array.isArray(sheetData.rows)) sheetData.rows = []

    if (ov.inserted) {
      sheetData.rows.push({
        type: 'data',
        cells: ov.cells || {},
        __override: { kind: 'inserted', id: ov.id },
      })
      continue
    }

    // Match by (topic, subtopic). Same forward-propagation as the renderer.
    let lastTopic = ''
    let matched = false
    for (const row of sheetData.rows) {
      if (row.type !== 'data') continue
      const cells = row.cells || {}
      const raw = String(cells.TOPIC || '').trim()
      if (raw) lastTopic = raw
      const effectiveTopic = raw || lastTopic
      const sub = String(cells['SUB-TOPIC'] || cells.SUBTOPIC || '').trim()
      if (
        effectiveTopic.toLowerCase() === String(ov.topic || '').toLowerCase() &&
        sub.toLowerCase() === String(ov.subtopic || '').toLowerCase()
      ) {
        if (ov.deleted) {
          row.__deleted = true
          row.__override = { kind: 'deleted', id: ov.id }
        } else if (ov.cells) {
          row.cells = { ...row.cells, ...ov.cells }
          row.__override = { kind: 'edited', id: ov.id }
        }
        matched = true
        break
      }
    }
    if (!matched && ov.cells && !ov.deleted) {
      sheetData.rows.push({
        type: 'data',
        cells: ov.cells,
        __override: { kind: 'inserted', id: ov.id },
      })
    }
  }
  // Drop tombstoned rows on the way out.
  for (const subjData of Object.values(clone)) {
    for (const sheetData of Object.values(subjData || {})) {
      if (Array.isArray(sheetData?.rows)) {
        sheetData.rows = sheetData.rows.filter((r) => !r.__deleted)
      }
    }
  }
  return clone
}

/**
 * Returns the merged syllabi shape: subject → sheet → { columns, rows[] }.
 * Each `data` row carries an optional `__override` marker the UI can use
 * to badge edited / inserted entries.
 */
export async function getMergedSyllabi({ forceOverrides = false } = {}) {
  const [raw, overrides] = await Promise.all([
    loadRawCurriculum(),
    loadOverrides({ force: forceOverrides }),
  ])
  return applyOverrides(raw, overrides)
}

export async function saveSyllabusRow({ studioSubject, sheet, topic, subtopic, cells, mode = 'update' }) {
  try {
    const res = await upsertSyllabusRowCallable({
      studioSubject, sheet, topic, subtopic, cells, mode,
    })
    _overridesCache = null
    _overridesCacheAt = 0
    return { ok: true, ...(res?.data || {}) }
  } catch (err) {
    console.error('saveSyllabusRow failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Save failed.'),
    }
  }
}

export async function removeSyllabusRow({ studioSubject, sheet, topic, subtopic }) {
  try {
    const res = await deleteSyllabusRowCallable({
      studioSubject, sheet, topic, subtopic,
    })
    _overridesCache = null
    _overridesCacheAt = 0
    return { ok: true, ...(res?.data || {}) }
  } catch (err) {
    console.error('removeSyllabusRow failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Delete failed.'),
    }
  }
}

export async function restoreSyllabusRow({ studioSubject, sheet, topic, subtopic }) {
  try {
    const res = await restoreSyllabusRowCallable({
      studioSubject, sheet, topic, subtopic,
    })
    _overridesCache = null
    _overridesCacheAt = 0
    return { ok: true, ...(res?.data || {}) }
  } catch (err) {
    console.error('restoreSyllabusRow failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Restore failed.'),
    }
  }
}

export function invalidateSyllabiCache() {
  _overridesCache = null
  _overridesCacheAt = 0
  _rawCache = null
  _rawCachePromise = null
}
