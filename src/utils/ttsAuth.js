// src/utils/ttsAuth.js
//
// The request headers /api/tts requires, in ONE place, because two independent
// callers reach that endpoint (src/utils/tts.js for lessons/slides and
// src/hooks/useSpeech.js for the quiz/exam/chat read-aloud) and both were
// sending none.
//
// ── Why this exists ───────────────────────────────────────────────────────
// functions/tts.js refuses an unauthenticated request outright:
//
//     const decoded = await verifyIdToken(req);
//     if (!decoded) return res.status(401).json({ error: 'Sign in required.' });
//
// …and verifyIdToken() reads the Authorization header and nothing else. Both
// callers POSTed with `Content-Type` alone, so every cloud synthesis 401'd —
// and because both of them catch a failed cloud call and fall back to
// window.speechSynthesis, the endpoint failing 100% of the time was
// INDISTINGUISHABLE from it working: learners heard a voice either way, just
// never the one we were paying Google for. That is the failure mode this
// module exists to make impossible to reintroduce quietly — a caller either
// gets headers that satisfy the server, or an explicit null.
//
// ── The null contract ─────────────────────────────────────────────────────
// null means "this request CANNOT be authenticated — do not call the cloud."
// Callers go straight to the browser fallback instead of spending a round trip
// to be told 401. That is the normal path on the public paper-quiz runner
// (/papers), which is deliberately reachable signed-out, so a null here is
// routine rather than an error worth logging loudly.
//
// App Check rides along for the same reason the SSE endpoints attach it
// (see aiAssistant.js / teacherTools.js): a Firebase callable attaches its own
// token, a raw fetch() does not. apiTextToSpeech runs softVerifyAppCheckHttp,
// so today the header only feeds /admin/app-check observability — but that
// telemetry is exactly what the graduated enforcement rollout reads before
// flipping this endpoint on, and an endpoint whose clients never send a token
// reports 100% "missing" and can never be flipped. Its absence is never fatal
// on its own: getAppCheckToken() fails open with '', and we omit the header
// rather than sending an empty one.

import { auth, getAppCheckToken } from '../firebase/config'

/**
 * Build the headers for a POST to /api/tts.
 *
 * @returns {Promise<Record<string,string>|null>} headers, or null when the
 *   request cannot be authenticated (signed out, or the ID token could not be
 *   minted) and the caller should skip the cloud entirely.
 */
export async function ttsAuthHeaders() {
  const user = auth?.currentUser
  if (!user) return null

  let token = ''
  try {
    token = await user.getIdToken()
  } catch (err) {
    // A refresh failure here is not actionable by the learner — the browser
    // voice still reads the text — so this stays a warn and returns null
    // rather than throwing into a playback path.
    console.warn('[tts] could not mint an ID token:', err?.message || err)
    return null
  }
  if (!token) return null

  // Fail-open: getAppCheckToken() already swallows its own errors and returns
  // '', but it is awaited here on the same request path, so guard it too — a
  // rejected token must not cost the learner their audio.
  let appCheckToken = ''
  try {
    appCheckToken = await getAppCheckToken()
  } catch {
    appCheckToken = ''
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
  }
}

export default ttsAuthHeaders
