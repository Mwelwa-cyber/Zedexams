/**
 * The localStorage adapter's contract: a read never throws and never returns a
 * broken shape, a write never throws.
 *
 * The failure modes exercised here are the ones that actually happen on the
 * devices this product runs on — Safari private mode throwing on setItem, a
 * full store on a cheap Android, and a value left behind by an older build of
 * the app in a shape the current reader no longer expects.
 */
import assert from 'node:assert/strict'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`) }

// A minimal in-memory Storage we can make hostile.
function installStore(impl) {
  globalThis.window = { localStorage: impl }
}
function memoryStore(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
    _data: data,
  }
}

const mod = await import('../src/shared/utils/safeStorage.js')
const { readString, writeString, readJson, writeJson, readArray, readPositiveInt, removeKey } = mod

// ── happy path ───────────────────────────────────────────────────────────────

test('round-trips a JSON value', () => {
  installStore(memoryStore())
  writeJson('k', { a: 1, b: [2, 3] })
  assert.deepEqual(readJson('k'), { a: 1, b: [2, 3] })
})

test('round-trips a raw string', () => {
  installStore(memoryStore())
  writeString('k', 'midnight')
  assert.equal(readString('k'), 'midnight')
})

test('removeKey deletes', () => {
  installStore(memoryStore({ k: '"v"' }))
  removeKey('k')
  assert.equal(readString('k'), null)
})

// ── missing / malformed values ───────────────────────────────────────────────

test('a missing key yields the fallback, not undefined', () => {
  installStore(memoryStore())
  assert.equal(readJson('nope'), null)
  assert.deepEqual(readJson('nope', { d: 1 }), { d: 1 })
  assert.equal(readString('nope', 'dflt'), 'dflt')
})

test('malformed JSON yields the fallback instead of throwing', () => {
  installStore(memoryStore({ k: '{not json' }))
  assert.deepEqual(readJson('k', []), [])
})

test('readArray refuses a stored value of the wrong shape', () => {
  installStore(memoryStore({ obj: '{"a":1}', str: '"hello"', nul: 'null', num: '7' }))
  for (const k of ['obj', 'str', 'nul', 'num', 'absent']) {
    assert.deepEqual(readArray(k), [], `${k} should read as an empty array`)
  }
  installStore(memoryStore({ ids: '["a","b"]' }))
  assert.deepEqual(readArray('ids'), ['a', 'b'])
})

test('readPositiveInt rejects zero, negatives and junk', () => {
  installStore(memoryStore({ z: '0', neg: '-3', junk: 'abc', ok: '12' }))
  assert.equal(readPositiveInt('z'), null)
  assert.equal(readPositiveInt('neg'), null)
  assert.equal(readPositiveInt('junk'), null)
  assert.equal(readPositiveInt('absent'), null)
  assert.equal(readPositiveInt('ok'), 12)
})

// ── hostile environments ─────────────────────────────────────────────────────

test('a store that throws on write does not throw at the call site', () => {
  installStore({
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: () => { throw new Error('nope') },
  })
  writeJson('k', { a: 1 })   // must not throw
  writeString('k', 'v')      // must not throw
  removeKey('k')             // must not throw
})

test('a store that throws on read yields the fallback', () => {
  installStore({
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => {},
    removeItem: () => {},
  })
  assert.deepEqual(readJson('k', []), [])
  assert.deepEqual(readArray('k'), [])
  assert.equal(readString('k', 'd'), 'd')
  assert.equal(readPositiveInt('k'), null)
})

test('no window at all (server render) is not an error', () => {
  delete globalThis.window
  assert.equal(readJson('k'), null)
  assert.deepEqual(readArray('k'), [])
  writeJson('k', 1)
  writeString('k', 'v')
  removeKey('k')
})

test('a window whose localStorage getter throws is survivable', () => {
  globalThis.window = Object.defineProperty({}, 'localStorage', {
    get() { throw new Error('blocked by policy') },
  })
  assert.deepEqual(readArray('k'), [])
  writeJson('k', 1)
})

test('a value that cannot be serialised does not throw', () => {
  installStore(memoryStore())
  const circular = {}
  circular.self = circular
  writeJson('k', circular)
  assert.equal(readJson('k'), null)
})

console.log(`\nsafe storage: ${n} checks passed`)
