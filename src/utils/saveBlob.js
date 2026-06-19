/**
 * Trigger a real file download for a Blob, keeping `filename`.
 *
 * Shared by every studio export so the behaviour is identical everywhere.
 *
 * The important case is Android. Android Chrome and Android WebViews (the
 * Capacitor app) ignore the anchor `download` attribute for `blob:` URLs — they
 * name the saved file after the blob's random UUID, so teachers downloading
 * Notes / Worksheets / etc. got files called things like
 * "5fee66fe-1c3a-4b9d-….docx" instead of "Grade 5 English Notes.docx". The
 * legacy lesson-plan studio already worked around this; this helper brings the
 * same fix to every other studio: on Android we convert the blob to a `data:`
 * URL first, which makes the `download` filename stick. Elsewhere we keep an
 * ordinary blob download (with `file-saver` for Safari/iOS quirks).
 */

function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
}

/** Click an attached `<a download>` — attached + removed so every browser honours it. */
function anchorDownload(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

export async function saveBlob(blob, filename) {
  const name = filename || 'download'

  // Android: the data-URL route is the only one that preserves the filename.
  // It must run BEFORE file-saver, which also uses blob: URLs and so hits the
  // same UUID-naming bug on Android.
  if (isAndroid() && typeof FileReader !== 'undefined' && typeof document !== 'undefined') {
    try {
      const dataUrl = await blobToDataUrl(blob)
      anchorDownload(dataUrl, name)
      return
    } catch {
      // fall through to the blob-URL paths below
    }
  }

  // Desktop / iOS: file-saver handles Safari + older-browser quirks.
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, name)
    return
  } catch {
    // fall through to the anchor approach
  }

  const url = URL.createObjectURL(blob)
  anchorDownload(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
