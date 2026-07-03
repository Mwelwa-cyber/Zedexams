/**
 * Firebase-free core for the Universal Draft Manager.
 *
 * Everything here is pure (no Firestore, no React, no browser APIs) so it can
 * be unit tested under plain `node` — see draftCore.test.js. The localStorage /
 * IndexedDB / Firestore I/O lives in draftIdbStore.js and draftCloudSync.js,
 * which import these helpers.
 *
 * This generalises the Assessment-Studio-specific core (assessmentDraftCore.js)
 * into a descriptor-driven engine every studio can share. A studio supplies a
 * small "descriptor" that knows how to serialise / hydrate / validate ITS state;
 * the core stays studio-agnostic.
 *
 *   descriptor = {
 *     studioId,                    // 'worksheet' | 'assessment' | …
 *     schemaVersion,               // bump when the persisted shape changes
 *     serialize(state) -> object,  // plain, JSON-safe snapshot of the studio state
 *     hydrate(payload) -> partial, // inverse: what the studio should restore
 *     isNonEmpty(payload) -> bool, // is there actually work worth recovering?
 *     ttl?,                        // override DRAFT_TTL for this studio
 *     sanitize?(payload) -> payload, // drop runtime-only fields (blob URLs, …)
 *   }
 */

export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
export const KEY_PREFIX = 'examprep:draft:'
// Primary (client-side) cap on the mirrored draft: ~900 KiB (921,600 chars).
// Comfortably under Firestore's 1 MiB (1,048,576-byte) document limit, leaving
// headroom for the JSON wrapper + metadata; the rules enforce their own
// server-side cap. A draft bigger than this (200-page plan, image-heavy paper)
// simply isn't mirrored remotely — the local store still holds it on this
// device, and the status indicator says so.
export const REMOTE_MAX_CHARS = 900 * 1024 // 921,600 chars
export const MAX_VERSIONS = 10

/** Namespaced, collision-free key for a specific draft on a specific device. */
export function draftKey({ studioId, uid, draftId }) {
  return `${KEY_PREFIX}${studioId}:${uid}:${draftId}`
}

/* ─────────────────────── runtime-field stripping ─────────────────────── */

// A blob: URL is bound to the document that created it. The moment the page
// reloads it becomes a dead reference — every <img> rendered against it shows a
// broken-image icon. Drop these (and transient upload flags) so a rehydrated
// draft never surfaces a stale blob URL. Deep, structure-preserving, and used
// by descriptors that hold image-bearing content.
const RUNTIME_KEYS = new Set(['imageUploading', 'imageUploadStep', 'imageAssetId'])

export function sanitizeRuntime(value) {
  if (Array.isArray(value)) return value.map(sanitizeRuntime)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (RUNTIME_KEYS.has(k)) continue
      out[k] = sanitizeRuntime(v)
    }
    return out
  }
  if (typeof value === 'string' && value.startsWith('blob:')) return ''
  return value
}

/* ───────────────────────── payload build / validate ──────────────────── */

// Build the persisted shape once so every layer (local + remote) stays
// identical. Runtime-only fields are stripped here (via the descriptor's own
// sanitize, else the generic sanitizeRuntime). `savedAt` / `studioId` /
// `schemaVersion` are always stamped so freshness + compatibility can be judged
// on load without the studio.
export function buildDraftPayload(state, descriptor) {
  const serialized = descriptor.serialize ? descriptor.serialize(state) : state
  const sanitized = descriptor.sanitize
    ? descriptor.sanitize(serialized)
    : sanitizeRuntime(serialized)
  return {
    ...sanitized,
    studioId: descriptor.studioId,
    schemaVersion: descriptor.schemaVersion ?? 1,
    savedAt: Date.now(),
  }
}

// A parsed draft is only usable if it isn't stale, matches the studio's current
// schema, and actually carries work.
export function isLiveDraft(parsed, descriptor) {
  if (!parsed?.savedAt) return false
  const ttl = descriptor?.ttl ?? DRAFT_TTL
  if (Date.now() - parsed.savedAt > ttl) return false
  // A draft from an older/newer persisted shape can't be safely restored into
  // today's studio state — treat it as absent rather than risk a crash.
  if (descriptor && (parsed.schemaVersion ?? 1) !== (descriptor.schemaVersion ?? 1)) return false
  if (descriptor?.isNonEmpty && !descriptor.isNonEmpty(parsed)) return false
  return true
}

/**
 * Pure last-write-wins picker between a local and a remote draft. Returns
 * `{ draft, source }` where source is 'remote' when the cloud copy is newer
 * (i.e. the work was last edited on another device). An exact-millisecond tie
 * keeps the local copy so we don't raise a needless cross-device restore toast.
 */
export function pickFreshestDraft(local, remote) {
  if (local && remote) {
    return (remote.savedAt || 0) > (local.savedAt || 0)
      ? { draft: remote, source: 'remote' }
      : { draft: local, source: 'local' }
  }
  if (remote) return { draft: remote, source: 'remote' }
  if (local) return { draft: local, source: 'local' }
  return { draft: null, source: null }
}

/* ───────────────────────── version ring buffer ───────────────────────── */

// Cheap, stable 32-bit fingerprint of a payload's *content* (savedAt excluded,
// since that changes on every save). Used to (a) skip no-op saves when nothing
// actually changed and (b) avoid pushing a duplicate version snapshot.
export function computeDirtyFingerprint(payload) {
  if (payload == null) return '0'
  const { savedAt: _savedAt, ...content } = payload
  const str = JSON.stringify(content)
  let hash = 5381
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return `${str.length}:${(hash >>> 0).toString(36)}`
}

/**
 * Append a snapshot to a bounded version ring buffer (newest last). A snapshot
 * whose fingerprint matches the current head is ignored (no version for a
 * no-op), and the buffer is capped at `max` — the oldest entries drop off.
 * Pure; returns a new array.
 */
export function pushVersion(ring, snapshot, max = MAX_VERSIONS) {
  const list = Array.isArray(ring) ? ring : []
  const head = list[list.length - 1]
  if (head && computeDirtyFingerprint(head) === computeDirtyFingerprint(snapshot)) {
    return list
  }
  const next = [...list, snapshot]
  return next.length > max ? next.slice(next.length - max) : next
}
