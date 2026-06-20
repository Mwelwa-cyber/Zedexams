/**
 * Native (Capacitor Android app) file save.
 *
 * The app's WebView has no browser download manager, so the web `data:`-URL
 * anchor trick is the only thing that triggers a save there — but Android
 * truncates large `data:` downloads, corrupting big .docx files ("Word found
 * unreadable content"). Instead we write the FULL bytes to the device with
 * @capacitor/filesystem (never truncated) and hand the saved file to the user
 * through the share sheet (@capacitor/share), so they can open it in Word or
 * save it to Files under its real name.
 *
 * The Capacitor plugins are dynamically imported so the web bundle never loads
 * them. `saveBlobNative` resolves on success and throws on any failure, which
 * lets the caller (saveBlob) fall back to the legacy data:-URL route.
 *
 * NOTE: requires `npx cap sync android` + a fresh APK build to take effect —
 * adding the npm packages alone does not register the native plugins.
 */

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
 * Write `blob` to the device and open the share sheet so the user can save/open
 * it. Resolves `true` on success; throws on failure so saveBlob can fall back.
 *
 * @param {Blob} blob
 * @param {string} filename  Human-readable name, e.g. "Grade 4 Integrated Science Lesson Plan.docx".
 */
export async function saveBlobNative(blob, filename) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  const base64 = await blobToBase64(blob)

  // Cache dir: app-private, needs no storage permission and is cleaned by the
  // OS. We share the file straight away, so durability here doesn't matter.
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  })

  // `files` is the documented way to share a local file — the plugin exposes it
  // through a FileProvider content URI so Word / Files can read it.
  await Share.share({
    title: filename,
    files: [written.uri],
    dialogTitle: 'Save or open',
  })

  return true
}
