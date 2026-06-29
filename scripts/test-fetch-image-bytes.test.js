/**
 * Regression test for the document-download hang fix.
 *
 * The Word exporters (assessment / exam paper / SBA / lesson plan) embed
 * images by fetching their bytes. Those fetches used to have NO timeout, so a
 * single slow or hung Firebase Storage request stalled the entire .docx build
 * indefinitely — the "downloads take forever / sometimes fail" report. The
 * shared fetchImageBytes helper now bounds every attempt with an AbortController
 * timeout and degrades to null (→ visible placeholder) instead of hanging.
 *
 * This executes the real helper (unlike the static download wiring checks),
 * stubbing globalThis.fetch so it makes no network calls.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert'
import { fetchImageBytes, DEFAULT_IMAGE_FETCH_TIMEOUT_MS } from '../src/utils/fetchImageBytes.js'

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function okResponse(bytes, contentType = 'image/png') {
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

const realFetch = globalThis.fetch
function withFetch(stub, fn) {
  globalThis.fetch = stub
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = realFetch })
}

await (async () => {
  // 1. Happy path: the first (warm-cache) fetch returns image bytes.
  await withFetch(async () => okResponse(PNG_MAGIC), async () => {
    const bytes = await fetchImageBytes('https://storage.example/diagram.png')
    check(bytes instanceof Uint8Array && bytes.length === 8, 'returns bytes on a successful fetch')
  })

  // 2. A request that NEVER settles must abort on the timeout and return null
  //    rather than hanging the export forever. The stub honours the abort
  //    signal the helper passes in, exactly as a real fetch does.
  let aborted = 0
  const hangingFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const sig = init && init.signal
      if (sig) {
        sig.addEventListener('abort', () => {
          aborted += 1
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }
    })
  const start = Date.now()
  await withFetch(hangingFetch, async () => {
    const bytes = await fetchImageBytes('https://storage.example/stuck.png', { timeoutMs: 80 })
    check(bytes === null, 'returns null (not a hang) when every fetch attempt stalls')
  })
  const elapsed = Date.now() - start
  check(aborted >= 1, 'aborts the stuck request via the timeout signal')
  // Two cors attempts + one proxy attempt, each ~80ms → comfortably under 2s.
  check(elapsed < 2000, `bounded by the timeout instead of hanging (took ${elapsed}ms)`)

  // 3. Proxy fallback: cross-origin reads fail, but the same-origin proxy
  //    returns real image bytes → embed them.
  await withFetch(async (url) => {
    if (String(url).startsWith('/api/image-proxy')) return okResponse(PNG_MAGIC, 'image/png')
    throw new Error('CORS blocked')
  }, async () => {
    const bytes = await fetchImageBytes('https://storage.example/needs-proxy.png')
    check(bytes instanceof Uint8Array && bytes.length === 8, 'falls back to the same-origin image proxy')
  })

  // 4. Proxy that resolves to the SPA index.html (rewrite not live) must fail
  //    closed — never embed HTML bytes as an image.
  await withFetch(async (url) => {
    if (String(url).startsWith('/api/image-proxy')) {
      return okResponse(new Uint8Array([0x3c, 0x21, 0x44, 0x4f]), 'text/html') // "<!DO"
    }
    throw new Error('CORS blocked')
  }, async () => {
    const bytes = await fetchImageBytes('https://storage.example/missing.png')
    check(bytes === null, 'fails closed when the proxy returns non-image (HTML) bytes')
  })

  // 5. Guards: junk input and a missing fetch return null without throwing.
  check((await fetchImageBytes('')) === null, 'returns null for an empty url')
  check((await fetchImageBytes(null)) === null, 'returns null for a null url')
  await withFetch(undefined, async () => {
    check((await fetchImageBytes('https://x/y.png')) === null, 'returns null when fetch is unavailable')
  })

  // 6. Sanity on the exported default budget.
  check(DEFAULT_IMAGE_FETCH_TIMEOUT_MS > 0, 'exports a positive default timeout budget')

  assert.strictEqual(failures, 0, `${failures} check(s) failed`)
  console.log('\nAll fetchImageBytes checks passed.')
})()
