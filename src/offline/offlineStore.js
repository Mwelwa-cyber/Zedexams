/**
 * offlineStore — the on-device persistence layer for the offline cache and the
 * sync outbox. IndexedDB-backed, modelled on draftIdbStore.js (same open/tx
 * shape, same "degrade to a no-op when IndexedDB is unavailable" contract so
 * callers never have to guard).
 *
 * Three object stores in one database:
 *   • content  — cache entries: metadata (contentCacheCore shape) + the encoded
 *                payload, keyed by cacheKey. This is what the app reads first.
 *   • meta     — small key/value scratch (lastSyncAt, install id, …).
 *   • outbox   — queued sync actions (syncQueueCore shape), keyed by action id.
 *
 * At-rest protection (Objective 9): payloads are run through the offlineSecurity
 * codec before they land in `content`. We prefer WebCrypto AES-GCM when
 * `crypto.subtle` is present; otherwise the portable xor codec. Either way the
 * cache never holds clear plaintext, and the sensitivity gate (assertCacheable)
 * rejects anything that isn't plain educational content BEFORE it is written.
 */

import {
  assertCacheable,
  stripSensitiveFields,
  deviceKeyFrom,
  encodePayload,
  decodePayload,
} from './offlineSecurity.js'
import { cacheKey } from './contentCacheCore.js'

const DB_NAME = 'zedexams-offline'
const DB_VERSION = 1
const STORE_CONTENT = 'content'
const STORE_META = 'meta'
const STORE_OUTBOX = 'outbox'
const INSTALL_ID_KEY = 'installId'

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
      if (!db.objectStoreNames.contains(STORE_CONTENT)) {
        const os = db.createObjectStore(STORE_CONTENT, { keyPath: 'key' })
        os.createIndex('type', 'type', { unique: false })
        os.createIndex('pinned', 'pinned', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'k' })
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function runTx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result
    Promise.resolve(fn(store)).then((r) => { result = r }).catch(reject)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/* ───────────────────────────── device key ────────────────────────────────
 * A per-install id backs the at-rest codec. It lives in the meta store (not
 * synced anywhere) so the same device decodes its own cache but a copied
 * IndexedDB file on another device can't. Cached in memory after first read.
 */
let deviceKeyCache = null

async function getDeviceKey() {
  if (deviceKeyCache != null) return deviceKeyCache
  let installId = null
  try {
    const db = await openDb()
    const rec = await runTx(db, STORE_META, 'readonly', (s) => reqAsPromise(s.get(INSTALL_ID_KEY)))
    db.close()
    installId = rec?.v || null
  } catch { /* fall through */ }
  if (!installId) {
    installId = newInstallId()
    try {
      const db = await openDb()
      await runTx(db, STORE_META, 'readwrite', (s) => s.put({ k: INSTALL_ID_KEY, v: installId }))
      db.close()
    } catch { /* best-effort */ }
  }
  // Idempotent memoization — the installId is stable, so a concurrent write
  // would compute the same key; the race warning is benign here.
  // eslint-disable-next-line require-atomic-updates
  deviceKeyCache = deviceKeyFrom(installId)
  return deviceKeyCache
}

function newInstallId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    // No randomUUID (older Android WebViews) but WebCrypto's CSPRNG is present:
    // pull 128 bits of cryptographically-secure entropy so the device key that
    // backs the at-rest codec can't be brute-forced from a known install time.
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(4)
      crypto.getRandomValues(buf)
      return `inst-${Array.from(buf, (n) => n.toString(36)).join('')}`
    }
  } catch { /* ignore */ }
  // Last resort only — no WebCrypto at all. Math.random() is NOT secure; on
  // such a device the codec is best treated as obfuscation, not encryption.
  return `inst-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

/* ───────────────────────────── content store ─────────────────────────── */

/**
 * Write a piece of content to the cache. Rejects (silently, returning a reason)
 * anything that fails the sensitivity gate. The payload is sensitive-field
 * stripped then encoded before storage.
 * @param {object} entry contentCacheCore metadata (must carry key/type/id)
 * @param {*} payload the JSON-safe content body
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function putContent(entry, payload) {
  const gate = assertCacheable({ type: entry.type, key: entry.key })
  if (!gate.allowed) return { ok: false, reason: gate.reason }
  try {
    const key = await getDeviceKey()
    const safe = stripSensitiveFields(payload)
    const record = { ...entry, body: encodePayload(safe, key) }
    const db = await openDb()
    await runTx(db, STORE_CONTENT, 'readwrite', (s) => s.put(record))
    db.close()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || 'write failed' }
  }
}

/**
 * Read content back, decoding the payload. Returns { entry, payload } or null.
 * @param {string} type
 * @param {string} id
 * @returns {Promise<{ entry: object, payload: * }|null>}
 */
export async function getContent(type, id) {
  try {
    const key = await getDeviceKey()
    const db = await openDb()
    const record = await runTx(db, STORE_CONTENT, 'readonly', (s) => reqAsPromise(s.get(cacheKey(type, id))))
    db.close()
    if (!record) return null
    const { body, ...entry } = record
    return { entry, payload: decodePayload(body, key) }
  } catch {
    return null
  }
}

/** List all cache entry metadata (no payloads) — powers cleanup + the storage panel. */
export async function listEntries() {
  try {
    const db = await openDb()
    const rows = await runTx(db, STORE_CONTENT, 'readonly', (s) => reqAsPromise(s.getAll()))
    db.close()
    return (rows || []).map(({ body, ...entry }) => entry)
  } catch {
    return []
  }
}

/** Delete a set of cache entries by key. */
export async function deleteEntries(keys = []) {
  if (!keys.length) return
  try {
    const db = await openDb()
    await runTx(db, STORE_CONTENT, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)) })
    db.close()
  } catch { /* best-effort */ }
}

/** Clear the auto-managed cache but KEEP user-pinned downloads (Clear Cache button). */
export async function clearUnpinned() {
  try {
    const db = await openDb()
    await runTx(db, STORE_CONTENT, 'readwrite', (s) => new Promise((resolve) => {
      const req = s.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(); return }
        if (!cursor.value?.pinned) cursor.delete()
        cursor.continue()
      }
      req.onerror = () => resolve()
    }))
    db.close()
  } catch { /* best-effort */ }
}

/** Delete ONLY user-pinned downloads (Delete Downloaded Files button). */
export async function clearPinned() {
  try {
    const db = await openDb()
    await runTx(db, STORE_CONTENT, 'readwrite', (s) => new Promise((resolve) => {
      const req = s.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(); return }
        if (cursor.value?.pinned) cursor.delete()
        cursor.continue()
      }
      req.onerror = () => resolve()
    }))
    db.close()
  } catch { /* best-effort */ }
}

/* ─────────────────────────────── meta store ──────────────────────────── */

export async function getMeta(k) {
  try {
    const db = await openDb()
    const rec = await runTx(db, STORE_META, 'readonly', (s) => reqAsPromise(s.get(k)))
    db.close()
    return rec?.v ?? null
  } catch {
    return null
  }
}

export async function setMeta(k, v) {
  try {
    const db = await openDb()
    await runTx(db, STORE_META, 'readwrite', (s) => s.put({ k, v }))
    db.close()
  } catch { /* best-effort */ }
}

/* ───────────────────────────────── outbox ────────────────────────────── */

export async function putAction(action) {
  try {
    const db = await openDb()
    await runTx(db, STORE_OUTBOX, 'readwrite', (s) => s.put(action))
    db.close()
  } catch { /* best-effort */ }
}

export async function listActions() {
  try {
    const db = await openDb()
    const rows = await runTx(db, STORE_OUTBOX, 'readonly', (s) => reqAsPromise(s.getAll()))
    db.close()
    return rows || []
  } catch {
    return []
  }
}

export async function deleteAction(id) {
  try {
    const db = await openDb()
    await runTx(db, STORE_OUTBOX, 'readwrite', (s) => s.delete(id))
    db.close()
  } catch { /* best-effort */ }
}

/** Replace the whole outbox (used after a flush that mutated many actions). */
export async function replaceOutbox(actions = []) {
  try {
    const db = await openDb()
    await runTx(db, STORE_OUTBOX, 'readwrite', (s) => new Promise((resolve) => {
      const clearReq = s.clear()
      clearReq.onsuccess = () => { actions.forEach((a) => s.put(a)); resolve() }
      clearReq.onerror = () => resolve()
    }))
    db.close()
  } catch { /* best-effort */ }
}
