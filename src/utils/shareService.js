// Public share links for teacher-generated content.
//
// Design: a shared plan lives in /shares/{token} as a frozen snapshot of
// the plan at share-time. The token IS the share URL — knowing it is
// permission to view. Later edits to the original generation do NOT
// change what the share URL shows. To update the share, the teacher
// republishes (which creates a new token).
//
// Firestore rules (see firestore.rules):
//   • public read while revokedAt is null
//   • owner creates; owner can only revoke or retitle

import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { siteOrigin } from './runtime.js'

/**
 * Publish a snapshot of a generation. Returns { token, url, shareId }.
 * The share URL is suitable for sending in WhatsApp / email.
 *
 * `generationId` (optional) is stamped on the share doc so the owner can list
 * and revoke a generation's live links later from the Library — see
 * listSharesForGeneration. (The /shares create rule requires the core keys but
 * allows extra fields, so this needs no rules change.)
 */
export async function publishShare({ tool, ownerUid, title, plan, subject, grade, topic, generationId = null }) {
  if (!ownerUid) throw new Error('Must be signed in to share.')
  if (!plan || typeof plan !== 'object') throw new Error('Nothing to share — plan is empty.')

  const ref = await addDoc(collection(db, 'shares'), {
    tool: String(tool || 'lesson_plan').slice(0, 40),
    ownerUid,
    title: String(title || 'Shared lesson plan').slice(0, 200),
    plan,
    subject: subject || null,
    grade: grade || null,
    topic: topic || null,
    generationId: generationId || null,
    createdAt: serverTimestamp(),
  })
  const token = ref.id
  // siteOrigin() (not window.location.origin) so a link created inside the
  // native app points at zedexams.com, not the WebView's https://localhost.
  const origin = siteOrigin()
  return {
    token,
    shareId: ref.id,
    url: `${origin}/share/${token}`,
  }
}

/**
 * The owner's still-live (not revoked) share links for one generation, newest
 * first. Reads the owner's shares (a single-field `ownerUid` equality query —
 * no composite index needed) and filters to this generation client-side, so
 * the Library can show + revoke existing links across sessions. Best-effort:
 * returns [] on any read error.
 */
export async function listSharesForGeneration(ownerUid, generationId) {
  if (!ownerUid || !generationId) return []
  try {
    const snap = await getDocs(query(collection(db, 'shares'), where('ownerUid', '==', ownerUid)))
    const origin = siteOrigin()
    return snap.docs
      .map((d) => ({ token: d.id, ...d.data() }))
      .filter((s) => s.generationId === generationId && !s.revokedAt)
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .map((s) => ({ token: s.token, url: `${origin}/share/${s.token}`, createdAt: s.createdAt || null }))
  } catch (err) {
    console.warn('[shareService] listSharesForGeneration failed', err)
    return []
  }
}

/**
 * Revoke a previously-published share. The public URL immediately stops
 * working — set via `revokedAt` rather than delete, so existing links
 * fail with a clear "revoked" message instead of a generic 404.
 */
export async function revokeShare(token) {
  await updateDoc(doc(db, 'shares', token), { revokedAt: serverTimestamp() })
}
