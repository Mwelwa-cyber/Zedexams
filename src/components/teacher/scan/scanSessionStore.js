// scanSessionStore — temporary persistence for an in-progress scan session.
//
// Requirement: a teacher must not lose captured pages if they accidentally
// leave the camera screen (close the modal, navigate, reload). Pages are full
// photos (a few hundred KB each as compressed JPEG data URLs), so localStorage's
// ~5MB string quota is too small for a multi-page paper — we use IndexedDB.
//
// One object store, one record (key 'current'), holding the whole ordered page
// array plus a timestamp. The session is cleared on a successful convert or when
// the teacher starts a fresh scan. All functions are browser-only and degrade to
// no-ops (resolving empty) when IndexedDB is unavailable, so callers never need
// to guard.

const DB_NAME = 'zedexams-scan'
const DB_VERSION = 1
const STORE = 'session'
const RECORD_KEY = 'current'

// Drop sessions older than this so a long-abandoned scan doesn't resurface weeks
// later as a surprise "resume".
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

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
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

export async function saveScanSession(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    await clearScanSession()
    return
  }
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ pages, savedAt: Date.now() }, RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Persistence is best-effort; capturing must keep working without it.
  }
}

export async function loadScanSession() {
  try {
    const db = await openDb()
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(RECORD_KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!record || !Array.isArray(record.pages) || !record.pages.length) return []
    if (record.savedAt && Date.now() - record.savedAt > SESSION_TTL_MS) {
      await clearScanSession()
      return []
    }
    return record.pages
  } catch {
    return []
  }
}

export async function clearScanSession() {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
}
