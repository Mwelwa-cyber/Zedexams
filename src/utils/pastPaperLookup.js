/**
 * The past-paper READ the public quiz route uses — and nothing else.
 *
 * Split out of `pastPapers.js` (Codex P2 on #2151, r3733319248): that module
 * legitimately carries admin write helpers, so the canary's zero-write guard
 * had to skip it as a declared boundary — which meant a write added inside
 * `getPaperById` itself would have passed the guard without touching the
 * allowlist. With the route importing THIS module instead, the guard walks it
 * fully, and a write API appearing here fails the build.
 *
 * Keep it read-only. A helper that needs to write does not belong in the
 * public quiz route's graph at all — that is a plan change (§7.3 calls one
 * Firestore write from the route a P1), not a diff.
 */
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const COLLECTION = 'pastPapers'

export async function getPaperById(paperId) {
  const snap = await getDoc(doc(db, COLLECTION, paperId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}
