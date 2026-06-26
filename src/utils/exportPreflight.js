/**
 * Pre-export image preflight (brief item 8: "fix export reliability").
 *
 * The PDF/DOCX exporters already fall back to a red "Figure could not be
 * loaded" placeholder when an image's BYTES can't be read (html2canvas needs
 * `useCORS`, the DOCX path needs `fetch(..,{mode:'cors'})`). The hidden
 * failure is that a teacher doesn't discover the gap until they open the
 * downloaded file. This module checks every image is byte-readable BEFORE the
 * export runs, so the studio can warn first.
 *
 * The byte-read check intentionally mirrors what the exporters do (a CORS
 * fetch), because an <img> can DISPLAY a cross-origin image while a canvas /
 * fetch read of the same image fails — so "it shows in the preview" is not
 * proof it will survive export.
 *
 * Design: the decision logic (`buildExportChecklist`) is pure and the network
 * probe (`preflightImageUrls`) takes an injectable `fetchImpl`, so both are
 * unit-testable under plain `node` with no real network.
 */

const DEFAULT_TIMEOUT_MS = 8000
// 8 MB — DOCX/Word starts to struggle and uploads get slow past this.
export const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const done = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), ms)
    Promise.resolve(promise)
      .then(
        (value) => done(value),
        (err) => done({ ok: false, reason: err && err.message ? err.message : 'error' }),
      )
      .catch(() => done({ ok: false, reason: 'error' }))
  })
}

/**
 * Probe one image URL with a CORS fetch and read its bytes — exactly the
 * operation the DOCX exporter performs. Returns { url, ok, status, bytes,
 * reason }.
 */
async function probeOne(url, fetchImpl) {
  if (!url || typeof url !== 'string') {
    return { url: url || '', ok: false, status: 0, bytes: 0, reason: 'missing-url' }
  }
  try {
    const res = await fetchImpl(url, { mode: 'cors' })
    if (!res || !res.ok) {
      return { url, ok: false, status: (res && res.status) || 0, bytes: 0, reason: 'http-error' }
    }
    let bytes = 0
    try {
      const buf = await res.arrayBuffer()
      bytes = buf ? buf.byteLength : 0
    } catch {
      // Response was OK but the body couldn't be read (CORS-opaque) — that is
      // precisely the silent-failure case, so treat it as a failure.
      return { url, ok: false, status: res.status || 0, bytes: 0, reason: 'opaque-body' }
    }
    if (bytes <= 0) {
      return { url, ok: false, status: res.status || 0, bytes: 0, reason: 'empty' }
    }
    return { url, ok: true, status: res.status || 200, bytes, reason: '' }
  } catch (err) {
    return { url, ok: false, status: 0, bytes: 0, reason: err && err.message ? err.message : 'cors' }
  }
}

/**
 * Probe a list of image URLs concurrently.
 * @param {string[]} urls
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<{url,ok,status,bytes,reason}>>}
 */
export async function preflightImageUrls(urls = [], { fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const impl = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  if (!impl) {
    return urls.map((url) => ({ url, ok: false, status: 0, bytes: 0, reason: 'no-fetch' }))
  }
  return Promise.all(urls.map((url) => withTimeout(probeOne(url, impl), timeoutMs)))
}

/**
 * Turn probe results into the human pre-export checklist (item 8).
 * Pure — no I/O.
 *
 * @param {object} params
 * @param {Array<{url?:string,isBlackAndWhite?:boolean}>} params.items
 * @param {Array<{url,ok,status,bytes,reason}>} params.results
 * @param {number} [params.maxTotalBytes]
 * @returns {{ ok:boolean, checklist:Array<{id,label,status,detail}>, totalBytes:number, failures:Array }}
 */
export function buildExportChecklist({ items = [], results = [], maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES } = {}) {
  const missing = items.filter((it) => !it || !it.url)
  const failures = results.filter((r) => !r.ok)
  const totalBytes = results.reduce((sum, r) => sum + (r.bytes || 0), 0)
  const allLoaded = results.length > 0 && failures.length === 0
  const noMissing = missing.length === 0
  const sizeOk = totalBytes <= maxTotalBytes
  const claimsBw = items.some((it) => it && it.isBlackAndWhite)

  const pass = (cond) => (cond ? 'pass' : 'fail')

  const checklist = [
    {
      id: 'all-loaded',
      label: 'All images loaded',
      status: results.length === 0 ? 'info' : pass(allLoaded),
      detail: allLoaded
        ? `${results.length} image${results.length === 1 ? '' : 's'} readable`
        : `${failures.length} image${failures.length === 1 ? '' : 's'} could not be read`,
    },
    {
      id: 'no-missing-urls',
      label: 'No missing image URLs',
      status: pass(noMissing),
      detail: noMissing ? 'Every item has an image' : `${missing.length} item(s) have no image URL`,
    },
    {
      id: 'diagrams-visible',
      label: 'All diagrams visible',
      status: results.length === 0 ? 'info' : pass(allLoaded && noMissing),
      detail: allLoaded && noMissing ? 'Diagrams will render in the export' : 'Some diagrams may be blank',
    },
    {
      id: 'file-size',
      label: 'File size acceptable',
      status: pass(sizeOk),
      detail: `${(totalBytes / (1024 * 1024)).toFixed(2)} MB of ${(maxTotalBytes / (1024 * 1024)).toFixed(0)} MB`,
    },
    {
      id: 'labels-readable',
      label: 'Labels readable',
      status: 'manual',
      detail: 'Check label text is large enough to read when printed',
    },
    {
      id: 'bw-printable',
      label: 'Black-and-white printable',
      status: claimsBw ? 'pass' : 'manual',
      detail: claimsBw ? 'Marked black-and-white' : 'Confirm it prints clearly without colour',
    },
  ]

  // Only hard failures block; "manual" / "info" never block the export.
  const ok = !checklist.some((c) => c.status === 'fail')
  return { ok, checklist, totalBytes, failures }
}

/**
 * Convenience: probe + build checklist in one call.
 * @param {Array<{url?:string,isBlackAndWhite?:boolean}>} items
 * @param {{ fetchImpl?:Function, timeoutMs?:number, maxTotalBytes?:number }} [opts]
 */
export async function runExportPreflight(items = [], opts = {}) {
  const urls = items.map((it) => (it && it.url) || '').filter(Boolean)
  const results = await preflightImageUrls(urls, opts)
  return buildExportChecklist({ items, results, maxTotalBytes: opts.maxTotalBytes })
}
