/**
 * Tests for the pre-export image preflight (CORS byte-read probe + checklist).
 * Uses an injected fake fetch so no network is touched.
 */
import assert from 'node:assert'
import {
  preflightImageUrls, buildExportChecklist, runExportPreflight,
} from '../src/utils/exportPreflight.js'

function fakeFetch(map) {
  return async (url) => {
    const bytes = map[url]
    if (bytes == null) return { ok: false, status: 404 }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(bytes) }
  }
}

const okFetch = fakeFetch({ a: 1000, b: 2000 })

// Healthy images all probe ok with their byte counts.
const res = await preflightImageUrls(['a', 'b'], { fetchImpl: okFetch, timeoutMs: 1000 })
assert.equal(res.length, 2)
assert.ok(res.every((r) => r.ok))
assert.equal(res[0].bytes, 1000)

const cl = buildExportChecklist({
  items: [{ url: 'a', isBlackAndWhite: true }, { url: 'b', isBlackAndWhite: true }],
  results: res,
})
assert.equal(cl.ok, true)
assert.equal(cl.checklist.find((c) => c.id === 'all-loaded').status, 'pass')
assert.equal(cl.checklist.find((c) => c.id === 'bw-printable').status, 'pass')
assert.equal(cl.totalBytes, 3000)

// A broken image fails the checklist and blocks (ok=false).
const res2 = await preflightImageUrls(['a', 'bad'], { fetchImpl: fakeFetch({ a: 1000 }), timeoutMs: 1000 })
assert.equal(res2[1].ok, false)
const cl2 = buildExportChecklist({ items: [{ url: 'a' }, { url: 'bad' }], results: res2 })
assert.equal(cl2.ok, false)
assert.equal(cl2.checklist.find((c) => c.id === 'all-loaded').status, 'fail')

// Missing URL on an item is flagged.
const cl3 = buildExportChecklist({ items: [{ url: '' }], results: [] })
assert.equal(cl3.checklist.find((c) => c.id === 'no-missing-urls').status, 'fail')
assert.equal(cl3.ok, false)

// Oversize total fails the size check.
const big = await preflightImageUrls(['x'], { fetchImpl: fakeFetch({ x: 9 * 1024 * 1024 }), timeoutMs: 1000 })
const cl4 = buildExportChecklist({ items: [{ url: 'x' }], results: big, maxTotalBytes: 8 * 1024 * 1024 })
assert.equal(cl4.checklist.find((c) => c.id === 'file-size').status, 'fail')
assert.equal(cl4.ok, false)

// Opaque (unreadable) body counts as a failure even when ok:true.
const opaque = await preflightImageUrls(['o'], {
  fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error('opaque') } }),
  timeoutMs: 1000,
})
assert.equal(opaque[0].ok, false)
assert.equal(opaque[0].reason, 'opaque-body')

// runExportPreflight end-to-end.
const full = await runExportPreflight([{ url: 'a', isBlackAndWhite: true }], { fetchImpl: okFetch })
assert.equal(full.ok, true)

console.log('✓ export-preflight tests passed')
