import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchImageBytes,
  clearImageBytesCache,
  DEFAULT_IMAGE_FETCH_TIMEOUT_MS,
} from './fetchImageBytes.js'

// A minimal Response double for the byte path.
function okImageResponse(bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])) {
  return {
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => bytes.buffer,
  }
}

describe('fetchImageBytes', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
    clearImageBytesCache()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    clearImageBytesCache()
  })

  it('keeps the per-attempt timeout modest so a stuck request cannot stall the export for long', () => {
    // Guards against a future bump back to the old 12s budget (×3 strategies).
    expect(DEFAULT_IMAGE_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(8000)
    expect(DEFAULT_IMAGE_FETCH_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('returns the fetched bytes on the happy path', async () => {
    globalThis.fetch = vi.fn(async () => okImageResponse())
    const bytes = await fetchImageBytes('https://example.com/a.png')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(4)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('caches a success so a repeat fetch of the same URL does not hit the network again', async () => {
    globalThis.fetch = vi.fn(async () => okImageResponse())
    const first = await fetchImageBytes('https://example.com/diagram.png')
    const second = await fetchImageBytes('https://example.com/diagram.png')
    expect(second).toBe(first) // same cached reference
    expect(globalThis.fetch).toHaveBeenCalledTimes(1) // second served from cache
  })

  it('does NOT cache a failure — a later retry can still succeed (e.g. after CORS is applied)', async () => {
    // First call: every strategy fails.
    globalThis.fetch = vi.fn(async () => { throw new Error('CORS blocked') })
    const failed = await fetchImageBytes('https://example.com/later.png')
    expect(failed).toBeNull()

    // Second call after the "fix": now succeeds and is fetched fresh.
    globalThis.fetch = vi.fn(async () => okImageResponse())
    const ok = await fetchImageBytes('https://example.com/later.png')
    expect(ok).toBeInstanceOf(Uint8Array)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('clearImageBytesCache forces a re-fetch', async () => {
    globalThis.fetch = vi.fn(async () => okImageResponse())
    await fetchImageBytes('https://example.com/x.png')
    clearImageBytesCache()
    await fetchImageBytes('https://example.com/x.png')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})
