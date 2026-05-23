/**
 * Content version recorder — appends a snapshot to
 * `aiGeneratedContentVersions/{}` whenever an aiGeneratedContent doc
 * is generated, edited, regenerated, approved, published, or rejected.
 *
 * Hard rules (mirror the schema + firestore.rules):
 *   - Fire-and-forget: callers `.catch(() => {})` so a metering write
 *     failure never breaks the live generation chain.
 *   - Atomically increments the parent `aiGeneratedContent.version`
 *     counter inside a Firestore transaction so two simultaneous
 *     transitions never produce the same version number.
 *   - On the FIRST snapshot (changeType === 'ai_generated'), we reuse
 *     the parent's initial `version: 1` rather than bumping. The
 *     content row + the snapshot start at v=1 together.
 *   - On every subsequent snapshot we increment the parent's version
 *     field by 1 and write the new snapshot at the new number.
 *
 * Mirrors the schema at `src/schemas/learnerAi.js` →
 * `aiGeneratedContentVersionWriteSchema`.
 */

const admin = require('firebase-admin')

const VERSIONS_COLLECTION = 'aiGeneratedContentVersions'
const PARENT_COLLECTION = 'aiGeneratedContent'

const CHANGE_TYPES = Object.freeze({
  AI_GENERATED:  'ai_generated',
  ADMIN_EDIT:    'admin_edit',
  REGENERATED:   'regenerated',
  APPROVED:      'approved',
  PUBLISHED:     'published',
  REJECTED:      'rejected',
})

const VALID_CHANGE_TYPES = new Set(Object.values(CHANGE_TYPES))

/**
 * Append a version snapshot.
 *
 * @param {object} args
 * @param {string} args.contentId            aiGeneratedContent doc id
 * @param {object} [args.content]            optional explicit content
 *   payload — when omitted, the recorder snapshots the parent's
 *   current `content` field within the transaction.
 * @param {string} args.changedBy            `agent:<id>` | 'system' | admin uid
 * @param {string} args.changeType           one of CHANGE_TYPES
 * @param {string|null} [args.changeReason]
 * @param {boolean} [args.isInitial=false]   set true only by the
 *   generator runner on the FIRST write — keeps the version at 1.
 * @returns {Promise<string|null>} the new version doc id, or null on
 *   failure (callers should not block on the result).
 */
async function recordContentVersion({
  contentId,
  content = null,
  changedBy,
  changeType,
  changeReason = null,
  isInitial = false,
}) {
  if (typeof contentId !== 'string' || !contentId) {
    console.warn('[versionRecorder] refused: missing contentId')
    return null
  }
  if (typeof changedBy !== 'string' || !changedBy) {
    console.warn('[versionRecorder] refused: missing changedBy')
    return null
  }
  if (!VALID_CHANGE_TYPES.has(changeType)) {
    console.warn(`[versionRecorder] refused: invalid changeType '${changeType}'`)
    return null
  }

  const db = admin.firestore()
  try {
    let createdId = null
    await db.runTransaction(async (tx) => {
      const contentRef = db.collection(PARENT_COLLECTION).doc(contentId)
      const snap = await tx.get(contentRef)
      if (!snap.exists) {
        console.warn(`[versionRecorder] content/${contentId} missing — skip`)
        return
      }
      const data = snap.data() || {}
      const currentVersion = Number.isInteger(data.version) && data.version > 0 ?
        data.version : 1
      const nextVersion = isInitial ? currentVersion : currentVersion + 1
      const versionRef = db.collection(VERSIONS_COLLECTION).doc()
      tx.set(versionRef, {
        contentId,
        version: nextVersion,
        content: content != null && typeof content === 'object' ?
          content : (data.content || {}),
        changedBy,
        changeType,
        changeReason: typeof changeReason === 'string' && changeReason.length ?
          changeReason.slice(0, 800) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      if (!isInitial) {
        tx.update(contentRef, {
          version: nextVersion,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      createdId = versionRef.id
    })
    return createdId
  } catch (err) {
    console.warn('[versionRecorder] write failed',
        err && err.message ? err.message : err)
    return null
  }
}

module.exports = { recordContentVersion, CHANGE_TYPES, VALID_CHANGE_TYPES }
