/**
 * src/firebase/attestedStorage.js
 *
 * Drop-in replacements for the Firebase Storage WRITE primitives that gate on
 * genuine App Check attestation first.
 *
 * App Check enforcement is ON for Cloud Storage (2026-08). Every SDK
 * operation is rejected unless it carries a real token:
 *   401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
 * and `appCheckResilient.js` deliberately mints an unrecognised PLACEHOLDER
 * token whenever reCAPTCHA hangs or crashes, to keep Auth and Firestore from
 * stalling. The SDK then caches that placeholder for its full 60s TTL — so
 * without this gate a single 5s reCAPTCHA stall refuses every upload for a
 * minute, and reports it as `storage/unauthorized`: a permissions error the
 * teacher can neither understand nor act on.
 *
 * WHY A WRAPPER MODULE rather than a line at each call site: there are 16
 * upload paths across services and components, several with many uploads
 * apiece, and a gate that has to be remembered is a gate that gets forgotten
 * by the seventeenth. Swapping the import makes attestation a property of the
 * primitive instead of a convention.
 *
 * READS ARE DELIBERATELY NOT WRAPPED. A download URL carries its own download
 * token and App Check is not consulted when the bytes are served — which is
 * why images render normally under enforcement. `getDownloadURL` itself is an
 * SDK call and does need a token, but it is issued on render paths where
 * blocking would trade a broken image for a broken page; it already fails
 * soft at its call sites. Only writes, which are user-initiated and
 * retryable, are worth holding.
 */

import {
  uploadBytes as rawUploadBytes,
  uploadBytesResumable as rawUploadBytesResumable,
  uploadString as rawUploadString,
  deleteObject as rawDeleteObject,
} from 'firebase/storage'
import { assertStorageWriteAttested } from './config'

/** @see uploadBytes in firebase/storage — attested first. */
export async function uploadBytes(ref, data, metadata) {
  await assertStorageWriteAttested()
  return rawUploadBytes(ref, data, metadata)
}

/**
 * @see uploadBytesResumable in firebase/storage — attested first.
 *
 * NOTE this returns a Promise OF the UploadTask rather than the task itself,
 * because attestation has to settle before the upload starts. Callers that
 * attach `.on('state_changed', …)` must `await` it first.
 */
export async function uploadBytesResumable(ref, data, metadata) {
  await assertStorageWriteAttested()
  return rawUploadBytesResumable(ref, data, metadata)
}

/** @see uploadString in firebase/storage — attested first. */
export async function uploadString(ref, value, format, metadata) {
  await assertStorageWriteAttested()
  return rawUploadString(ref, value, format, metadata)
}

/** @see deleteObject in firebase/storage — attested first. */
export async function deleteObject(ref) {
  await assertStorageWriteAttested()
  return rawDeleteObject(ref)
}
