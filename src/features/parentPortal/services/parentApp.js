/**
 * The one callable left from the old parent app.
 *
 * The signed-in guardian surface (approval feed, child detail, family sharing,
 * weekly report) was retired in 2026-10, and its client wrappers went with it.
 * `resolveGuardianPayLink` stays because `/guardian-unlock` needs it, and it
 * is callable without a session — the guardian holding the emailed link may
 * have no account.
 */
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

const fns = getFunctions(app, 'us-central1')
const resolveGuardianPayLinkCallable = httpsCallable(fns, 'resolveGuardianPayLink')

/**
 * Resolve the token in a guardian's pay link. Callable without being
 * signed in — the page has to say what the request is before it can ask
 * anything of the guardian.
 */
export async function resolveGuardianPayLink(token) {
  const res = await resolveGuardianPayLinkCallable({ token })
  return res.data
}
