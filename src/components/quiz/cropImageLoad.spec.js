import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadCorsImage } from './cropImageLoad'

// Fake <img> whose load outcome we control per-instance. The constructor pushes
// itself onto `created` so a test can assert on the URL/crossOrigin it received
// and then fire onload/onerror.
let created = []
let nextOutcome = 'load' // 'load' | 'error'

class FakeImage {
  constructor() {
    this.crossOrigin = null
    this._src = ''
    created.push(this)
  }
  set src(value) {
    this._src = value
    // Resolve asynchronously like a real image decode.
    queueMicrotask(() => {
      if (nextOutcome === 'error') this.onerror?.(new Error('load failed'))
      else this.onload?.()
    })
  }
  get src() {
    return this._src
  }
}

describe('loadCorsImage', () => {
  beforeEach(() => {
    created = []
    nextOutcome = 'load'
    vi.stubGlobal('Image', FakeImage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads blob: URLs directly without requesting CORS', async () => {
    await loadCorsImage('blob:https://app/abc')
    expect(created).toHaveLength(1)
    expect(created[0].crossOrigin).toBe(null)
    expect(created[0].src).toBe('blob:https://app/abc')
  })

  it('loads data: URLs directly without requesting CORS', async () => {
    await loadCorsImage('data:image/png;base64,AAAA')
    expect(created[0].crossOrigin).toBe(null)
  })

  it('requests remote URLs CORS-clean with a cache-busting param', async () => {
    await loadCorsImage('https://storage.example/img.png?alt=media&token=xyz')
    expect(created).toHaveLength(1)
    expect(created[0].crossOrigin).toBe('anonymous')
    // appends with & because the URL already has a query string
    expect(created[0].src).toMatch(/\?alt=media&token=xyz&_cors=\d+$/)
  })

  it('appends the cache-buster with ? when the URL has no query string', async () => {
    await loadCorsImage('https://storage.example/img.png')
    expect(created[0].src).toMatch(/img\.png\?_cors=\d+$/)
  })

  it('falls back to fetching an object URL when the CORS load fails', async () => {
    nextOutcome = 'error'
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:fallback')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    // First img attempt errors; the fallback object-URL img must succeed.
    let calls = 0
    class MixedImage extends FakeImage {
      set src(value) {
        this._src = value
        calls += 1
        const willError = calls === 1
        queueMicrotask(() => {
          if (willError) this.onerror?.(new Error('load failed'))
          else this.onload?.()
        })
      }
      get src() {
        return this._src
      }
    }
    vi.stubGlobal('Image', MixedImage)

    const img = await loadCorsImage('https://storage.example/img.png')
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/img.png', {
      mode: 'cors',
      cache: 'reload',
    })
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fallback')
    expect(img.src).toBe('blob:fallback')
  })

  it('throws when the fetch fallback responds non-ok', async () => {
    nextOutcome = 'error'
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403 })))
    await expect(loadCorsImage('https://storage.example/img.png')).rejects.toThrow('fetch 403')
  })
})
