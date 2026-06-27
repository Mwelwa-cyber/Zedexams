// importReviewStore — temporary persistence for an in-progress import-review
// session.
//
// Requirement: a teacher working through the diagram-choice / page-approval
// flow must not lose their choices if they accidentally navigate away or
// reload the tab. Image blobs (objectURLs) are gone on reload anyway, so this
// store holds only the lightweight state: diagram choices and page approval
// decisions. Sessions are capped at 2 hours — after that the blob URLs are
// stale and the session is meaningless.
//
// One object store, one record (key 'current'), holding the full session
// object plus a timestamp. All functions are browser-only and degrade to
// no-ops (resolving null/undefined) when IndexedDB is unavailable, so callers
// never need to guard.

const DB_NAME = 'zedexams-import-review'
const DB_VERSION = 1
const STORE_NAME = 'session'
const RECORD_KEY = 'current'

// Image blob URLs are revoked on page reload, so a 2-hour TTL is long enough
// to survive a brief accidental navigation but short enough that an old
// session with dead blob URLs never resurfaces as a surprise.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

// saveReviewSession(session) — persists the full review session to IndexedDB.
//
// session shape:
// {
//   fileName: string,
//   savedAt: number (timestamp — callers should pass Date.now()),
//   pageApprovalState: Record<pageNumber, 'approved' | 'pending' | 'skipped'>,
//   diagramChoices: Record<diagramId, { diagramId, choice, status, previewUrl, errorMessage }>,
// }
export async function saveReviewSession(session) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(session, RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Persistence is best-effort; the review flow must keep working without it.
  }
}

// loadReviewSession() — returns the saved session or null if expired/missing.
//
// Returns null if:
//   - no session exists
//   - session.savedAt is older than SESSION_TTL_MS (2 hours)
//   - IndexedDB is unavailable
export async function loadReviewSession() {
  try {
    const db = await openDb()
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!record) return null
    if (record.savedAt && Date.now() - record.savedAt > SESSION_TTL_MS) {
      await clearReviewSession()
      return null
    }
    return record
  } catch {
    return null
  }
}

// clearReviewSession() — removes the session record from IndexedDB.
export async function clearReviewSession() {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
}
