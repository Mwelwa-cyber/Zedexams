/**
 * Trigger a real file download for a Blob.
 *
 * Prefers `file-saver` (handles Safari/iOS quirks + the Android WebView),
 * falling back to a programmatic <a download> click if the dynamic import
 * fails. Both paths produce an actual saved file — never a print dialog or a
 * preview tab. Shared by every studio export so the behaviour is identical.
 */
export async function saveBlob(blob, filename) {
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch {
    // fall through to the anchor approach
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
