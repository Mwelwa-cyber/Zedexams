/**
 * Native (Capacitor Android app) file save.
 *
 * DOWNLOAD MEANS DOWNLOAD
 * ───────────────────────
 * This module used to write the bytes to app-private cache and open the system
 * share sheet. Teachers reported the result exactly as it looked: tapping
 * "Download" offered them a list of WhatsApp contacts instead of saving a file,
 * and the only copy that existed sat in a cache directory they could not reach
 * and the OS could delete at will. Sharing and downloading are two different
 * intentions, and the button says download.
 *
 * So the primary route is now the app-local `ZedDownloads` Capacitor plugin
 * (android/app/src/main/java/com/zedexams/android/DownloadsPlugin.java), which
 * writes the full bytes into the phone's PUBLIC Downloads folder through
 * MediaStore — the same place a browser download lands, visible to Files, Word
 * and every other app, under its real name.
 *
 * WHY NOT @capacitor/filesystem
 * ─────────────────────────────
 * Its own definitions say `Directory.Documents` / `Directory.ExternalStorage`
 * are unreachable on Android 10 without legacy storage, and on Android 11+ an
 * app sees only files it created. Under scoped storage MediaStore is the only
 * supported way into the shared Downloads collection, and that plugin does not
 * expose it. It is still used for the fallback below, where app-private cache
 * is exactly what we want.
 *
 * THE FALLBACK IS THE OLD BEHAVIOUR, AND THAT IS DELIBERATE
 * ─────────────────────────────────────────────────────────
 * `Capacitor.Plugins.ZedDownloads` is absent in an APK built before this landed
 * (adding the Java file is not enough — it needs `npx cap sync android` and a
 * fresh build), and the plugin rejects when a pre-Android-10 user denies the
 * storage permission. In both cases we fall back to cache + share: worse, but
 * it is what shipped yesterday, so the worst case of this change is the status
 * quo rather than a teacher who cannot get their document out of the app at all.
 */

import { nativePlugin } from './runtime.js'

/** Read a Blob as raw base64 (no `data:...;base64,` prefix). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Write `blob` into the phone's public Downloads folder.
 *
 * @returns {Promise<string>} the saved file's content URI.
 * @throws when the plugin is missing from this APK, or the save was refused —
 *   the caller then falls back to {@link shareBlobNative}.
 */
async function saveToPublicDownloads(blob, filename) {
  const downloads = nativePlugin('ZedDownloads')
  if (!downloads || typeof downloads.saveToDownloads !== 'function') {
    throw new Error('ZedDownloads plugin unavailable — APK predates the Downloads save')
  }

  const result = await downloads.saveToDownloads({
    filename,
    data: await blobToBase64(blob),
    // The plugin guesses from the extension when this is blank; a Blob built by
    // an exporter always carries the right type, so prefer it when present.
    mimeType: blob.type || '',
  })
  return (result && result.uri) || ''
}

/**
 * Legacy route: write to app-private cache and open the share sheet so the user
 * can push the file into Word / Drive / Files by hand.
 *
 * Kept ONLY as the fallback for the two cases named at the top of this file.
 * Resolves `true` on success; throws so `saveBlob` can fall back again.
 */
export async function shareBlobNative(blob, filename) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  const base64 = await blobToBase64(blob)

  // Cache dir: app-private, needs no storage permission and is cleaned by the
  // OS. We share the file straight away, so durability here doesn't matter.
  // If THIS throws, the plugin genuinely isn't available (or the disk is full)
  // — we let it propagate so saveBlob can fall back to the data: URL route.
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  })

  // `files` is the documented way to share a local file — the plugin exposes it
  // through a FileProvider content URI so Word / Files can read it.
  try {
    await Share.share({
      title: filename,
      files: [written.uri],
      dialogTitle: 'Save or open',
    })
  } catch (err) {
    // The user dismissing the share sheet is a deliberate "no", not a failure.
    // Resolve so saveBlob does NOT fall through to the data: URL route, which
    // would dump a misnamed (and, for large .docx, truncated) copy the user
    // never asked for. A genuine share error still propagates: the written file
    // lives in app-private cache the user can't reach, so the data: URL is then
    // their only way to get the document.
    if (isShareCancellation(err)) return true
    throw err
  }

  return true
}

/**
 * Save `blob` to the device. Resolves `true` when the file reached the user;
 * throws only when BOTH routes failed, so `saveBlob` can fall back to its
 * data:-URL last resort.
 *
 * @param {Blob} blob
 * @param {string} filename  Human-readable name, e.g. "Grade 4 Integrated Science Lesson Plan.docx".
 */
export async function saveBlobNative(blob, filename) {
  try {
    await saveToPublicDownloads(blob, filename)
    return true
  } catch (err) {
    // Reported rather than swallowed: a plugin that has stopped resolving would
    // otherwise look exactly like an old APK, and every user would silently slide
    // back onto the share sheet this change exists to remove.
    const { reportClientError } = await import('./clientErrorReporting.js')
    reportClientError(err, 'native_downloads_plugin')
  }

  return shareBlobNative(blob, filename)
}

/**
 * Did the share sheet reject because the user dismissed it (vs. a real error)?
 * @capacitor/share reports cancellation inconsistently across versions/OEMs —
 * sometimes an explicit "canceled" message, sometimes a bare rejection — so we
 * match defensively on the message text.
 */
function isShareCancellation(err) {
  const msg = String((err && (err.message || err)) || '').toLowerCase()
  return /cancel|dismiss|abort/.test(msg)
}
