/**
 * draftIdbStore — the local (on-device) layer of the Universal Draft Manager.
 *
 * Two stores, one contract:
 *   • IndexedDB (primary) — holds the full draft payload + its version ring.
 *     localStorage's ~5 MB string quota is too small for image-heavy papers and
 *     200-page plans, so IndexedDB is the real home (same rationale as the scan
 *     session store this is modelled on: scanSessionStore.js).
 *   • localStorage (synchronous mirror) — a compact copy of the latest payload
 *     ONLY. IndexedDB writes are async and cannot complete during a
 *     `beforeunload`; the synchronous localStorage mirror is what actually
 *     captures the final keystrokes before the tab dies. On load we read both
 *     and the caller merges by `savedAt`.
 *
 * Everything degrades to a no-op / empty result when IndexedDB (or storage) is
 * unavailable — private mode, quota, old WebView — so callers never guard.
 */

import { draftKey } from './draftCore.js'

const DB_NAME = 'zedexams-drafts'
const DB_VERSION = 1
const STORE = 'drafts'

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined' && indexedDB
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath 'key' = `${studioId}:${uid}:${draftId}`; index by uid so the
        // (future) Recovery Centre can list every draft a teacher owns.
        const os = db.createObjectStore(STORE, { keyPath: 'key' })
        os.createIndex('uid', 'uid', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function entryKey({ studioId, uid, draftId }) {
  return `${studioId}:${uid}:${draftId}`
}

/* ─────────────────────────── localStorage mirror ─────────────────────── */

// The synchronous last-gasp copy. Only the payload is mirrored (not the whole
// version ring) to stay well under the quota.
export function writeLocalMirror(ident, payload) {
  try {
    localStorage.setItem(draftKey(ident), JSON.stringify(payload))
  } catch {
    // Quota / private mode — IndexedDB (or nothing) is the fallback.
  }
}

export function readLocalMirror(ident) {
  try {
    const raw = localStorage.getItem(draftKey(ident))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearLocalMirror(ident) {
  try {
    localStorage.removeItem(draftKey(ident))
  } catch {
    // nothing to clean up
  }
}

/* ─────────────────────────────── IndexedDB ───────────────────────────── */

export async function idbPutDraft({ studioId, uid, draftId, payload, versions }) {
  const ident = { studioId, uid, draftId }
  // Always write the synchronous mirror first — it's the durable one for a
  // sudden unload; the richer IndexedDB record is best-effort on top.
  writeLocalMirror(ident, payload)
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        key: entryKey(ident),
        studioId,
        uid,
        draftId,
        payload,
        versions: Array.isArray(versions) ? versions : [],
        savedAt: payload?.savedAt || Date.now(),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Persistence is best-effort; the localStorage mirror still holds the payload.
  }
}

export async function idbGetDraft({ studioId, uid, draftId }) {
  const ident = { studioId, uid, draftId }
  try {
    const db = await openDb()
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(entryKey(ident))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (record?.payload) return record
  } catch {
    // fall through to the mirror
  }
  const mirror = readLocalMirror(ident)
  return mirror ? { payload: mirror, versions: [] } : null
}

export async function idbDeleteDraft({ studioId, uid, draftId }) {
  const ident = { studioId, uid, draftId }
  clearLocalMirror(ident)
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(entryKey(ident))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore — the mirror is already cleared
  }
}

/** List every draft record a teacher owns (powers the future Recovery Centre). */
export async function idbListDrafts({ uid }) {
  try {
    const db = await openDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const idx = tx.objectStore(STORE).index('uid')
      const req = idx.getAll(uid)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rows
  } catch {
    return []
  }
}

/**
 * Drop any drafts whose payload is older than `ttl`. Runs once on hook mount so
 * a long-abandoned draft doesn't resurface weeks later as a surprise "resume".
 */
export async function idbSweepExpired(ttl) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const cutoff = Date.now() - ttl
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        const savedAt = cursor.value?.savedAt || cursor.value?.payload?.savedAt || 0
        if (savedAt && savedAt < cutoff) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // best-effort
  }
}
