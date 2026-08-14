/**
 * quizImageUpload — the size budget and the failure vocabulary for question /
 * passage image uploads (quiz editor, including the Past Paper Studio's quiz
 * step and its "Crop from page").
 *
 * Pure: no DOM, no Firebase. The canvas work stays in the component; what
 * lives here is the part that was getting the diagnosis wrong. (The one
 * import, appCheckWriteGate, is itself a pure firebase-free decision core —
 * the App Check STATE is passed in by the caller, never read from the SDK.)
 *
 * ── Why this module exists ───────────────────────────────────────────────
 * Storage answers a refused write with `storage/unauthorized` for EVERY arm
 * of the rule alike — unverified email, a suspended account, a role that
 * isn't teacher/admin, a uid that doesn't own the folder, a content type
 * outside the allowlist, and the size cap. It never says which.
 *
 * The editor used to translate that one code into a single confident
 * sentence: "the image may be too large (10 MB max after compression). Try a
 * smaller crop or a JPEG." That advice was almost always a dead end. The
 * compressor already downscales to 1600px, and a 1600px-wide JPEG does not
 * reach 10 MB — so when an admin cropping a figure out of a scanned past
 * paper hit this, the one thing the message told them to do was the one
 * thing that could not help, and the real cause (role, verification, device
 * attestation) went unnamed.
 *
 * Two halves to the fix, and they depend on each other:
 *   1. `planNextEncode` makes the compressor GUARANTEE its output fits, by
 *      re-encoding down a ladder instead of encoding once and hoping. Size
 *      stops being a thing that can silently fail at the server.
 *   2. Because (1) holds, `uploadErrorMessage` can state plainly that a
 *      refusal is NOT about size, and list what is actually worth checking.
 * Weakening either one puts the misdiagnosis back.
 *
 * Third half, added when App Check enforcement reached Storage: the same
 * `storage/unauthorized` is ALSO what an enforced bucket returns for a
 * request that carried no attestation token, so `uploadErrorMessage` now
 * takes the App Check client state and names that cause when it is the one
 * that applies. See src/firebase/appCheckWriteGate.js.
 */
// Extension is explicit: this module is exercised by a plain-node test
// (npm run test:quiz-image-upload), and node's ESM loader does not resolve
// extension-less relative specifiers. Vite is happy either way.
import { storageWriteRejectionMessage } from '../firebase/appCheckWriteGate.js'

/**
 * The server cap, mirroring `validQuizImageUpload()` in storage.rules:
 *   request.resource.size < 10 * 1024 * 1024
 * Strictly less than, so a blob of exactly this many bytes is REFUSED.
 */
export const QUIZ_IMAGE_RULE_MAX_BYTES = 10 * 1024 * 1024

/**
 * What the client aims for. Deliberately under the rule so the boundary is
 * never decided by a byte: the compressor keeps going while it is over this,
 * and anything it accepts is comfortably inside what Storage will take.
 */
export const QUIZ_IMAGE_TARGET_BYTES = 9 * 1024 * 1024

/** `error.code` for a picture the compressor could not get under the cap. */
export const IMAGE_TOO_LARGE = 'image/too-large'

/**
 * JPEG quality steps, tried in order before any downscale.
 *
 * Quality first, width second, because these are photographed and scanned
 * EXAM PAGES: shrinking the raster is what makes small print and figure
 * labels unreadable, while JPEG quality degrades them far more gently.
 */
export const QUALITY_LADDER = [0.92, 0.82, 0.7, 0.58]

/** Width multiplier applied once the quality ladder is exhausted. */
export const WIDTH_SHRINK = 0.75

/** Never downscale below this — past it the page text stops being legible. */
export const MIN_ENCODE_WIDTH = 640

/** Backstop against a pathological input looping forever. */
export const MAX_ENCODE_ATTEMPTS = 8

/**
 * Decide what to do with a freshly encoded blob.
 *
 * @param {object} attempt
 * @param {number} attempt.bytes    Size of the blob just produced.
 * @param {string} attempt.format   Its mime type ('image/png' | 'image/jpeg').
 * @param {number} attempt.quality  The quality it was encoded at.
 * @param {number} attempt.width    The width it was drawn at.
 * @param {number} [attempt.maxBytes]
 * @returns {{action:'accept'}
 *          |{action:'retry', format:'image/jpeg', quality:number, maxWidth:number}
 *          |{action:'fail'}}
 */
export function planNextEncode({
  bytes,
  format,
  quality,
  width,
  maxBytes = QUIZ_IMAGE_TARGET_BYTES,
} = {}) {
  if (!(bytes > maxBytes)) return { action: 'accept' }

  // A lossless PNG that doesn't fit is a one-way door: re-encoding it as a
  // high-quality JPEG typically sheds most of the weight in a single step,
  // so start the ladder at the TOP rather than stepping down from it. (This
  // is the branch a "Crop from page" takes — the crop modal hands back PNG.)
  if (format === 'image/png') {
    return { action: 'retry', format: 'image/jpeg', quality: QUALITY_LADDER[0], maxWidth: width }
  }

  const nextQuality = QUALITY_LADDER.find(step => step < quality)
  if (nextQuality != null) {
    return { action: 'retry', format: 'image/jpeg', quality: nextQuality, maxWidth: width }
  }

  // Quality is spent — start taking pixels off, keeping the lowest quality
  // (we already know this width doesn't fit even at the top of the ladder).
  const shrunk = Math.round(width * WIDTH_SHRINK)
  if (shrunk < MIN_ENCODE_WIDTH) return { action: 'fail' }
  return {
    action: 'retry',
    format: 'image/jpeg',
    quality: QUALITY_LADDER[QUALITY_LADDER.length - 1],
    maxWidth: shrunk,
  }
}

/** Human-readable megabytes, for a message an admin has to act on. */
export function formatMb(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** The error `compressImage` throws when the ladder bottoms out. */
export function oversizeImageError(bytes) {
  const error = new Error(`Image is still ${formatMb(bytes)} after compression`)
  error.code = IMAGE_TOO_LARGE
  error.bytes = bytes
  return error
}

/**
 * Turn a raw upload failure into copy a teacher or admin can act on.
 *
 * The `storage/unauthorized` arm is the one that matters. It used to blame
 * the file size; it can't be the size, because the only blob that reaches
 * Storage is one the compressor already brought under
 * QUIZ_IMAGE_RULE_MAX_BYTES. So the message names the checks that remain —
 * and says the size is not among them, to stop the retry-a-smaller-crop
 * loop the old wording sent people into.
 *
 * The stale-token line is not filler: role and email-verification reach
 * Storage through the ID token, so an account promoted (or an address
 * verified) during the current session keeps being refused until it
 * refreshes.
 */
export function uploadErrorMessage(error, appCheck = null) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')

  if (code === IMAGE_TOO_LARGE) {
    return `Upload failed — this picture is still ${formatMb(error?.bytes)} after compression, `
      + `over the ${formatMb(QUIZ_IMAGE_RULE_MAX_BYTES)} limit. Crop a smaller part of the page.`
  }

  // App Check couldn't attest the device. Already a complete sentence that
  // says what to do, so pass it through rather than prefixing "Upload failed".
  if (code === 'appcheck/unattested') {
    return msg || 'We could not verify this device just now. Please try that upload again in a moment.'
  }

  if (code === 'storage/unauthorized'
    || (/storage/i.test(code) && /unauthorized|permission/i.test(msg))) {
    // An enforced bucket returns this same code when the request carried no
    // App Check token at all — which is what a build with no reCAPTCHA key
    // does on every write, because the write gate fails open when App Check
    // was never configured. When the state says that happened we KNOW it
    // wasn't the rules, so say so instead of sending an admin who already
    // has the role round the sign-out-and-back-in loop.
    const attestation = storageWriteRejectionMessage({ code: 'storage/unauthorized', appCheck })
    if (attestation) return attestation
    return 'Upload failed — Storage refused it. This is not the file size (the picture was '
      + 'already compressed to fit). Your account needs the teacher or admin role and a '
      + 'verified email address. If you have just been given that role, or just verified your '
      + 'email, sign out and back in once — Storage only sees the change after the token refreshes.'
  }

  if (code === 'storage/unauthenticated') {
    return 'Upload failed — your session has expired. Sign in again and retry.'
  }
  if (code === 'storage/quota-exceeded') {
    return 'Upload failed — the storage bucket is out of space. Nothing was uploaded.'
  }
  if (code === 'storage/canceled') return 'Upload canceled.'
  if (code === 'storage/retry-limit-exceeded' || /network|timeout|offline/i.test(msg)) {
    return 'Upload failed — check your connection and try again.'
  }
  return `Upload failed: ${msg || 'please try again.'}`
}
