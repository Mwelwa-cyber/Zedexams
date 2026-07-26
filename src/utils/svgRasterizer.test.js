/**
 * Tests for the rasteriser seam (§4.6).
 *
 * The seam exists because the DOCX exporter could not be tested end to end: it
 * rasterises library diagrams through a canvas, jsdom has none, so the raster
 * threw, the exporter caught it, and every library figure was left out of the
 * Word file. The only test that could reach the real export path was therefore a
 * test of a paper with no figures in it.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *   - the APPLICATION must never take an injected path — otherwise a passing
 *     harness proves a stub works rather than the exporter;
 *   - an injected rasteriser must be checked, because embedding whatever it
 *     returns would put a corrupt image in Word, and a corrupt image in Word is
 *     a blank frame: the silent failure this whole change exists to end.
 *
 * Run: node src/utils/svgRasterizer.test.js
 */

import assert from 'node:assert/strict'
import {
  setSvgRasterizer, resetSvgRasterizer, hasInjectedRasterizer, svgToPngBytes,
  setImageDecoder, resetImageDecoder, hasInjectedDecoder, decodeImageBytes,
} from './svgRasterizer.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}
async function asyncTest(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

console.log('\n— nothing injected by default —')

test('the seam starts empty, so the application takes the browser path', () => {
  resetSvgRasterizer()
  assert.equal(hasInjectedRasterizer(), false)
})

await asyncTest('and with nothing injected, a DOM-less context fails rather than inventing bytes', async () => {
  resetSvgRasterizer()
  await assert.rejects(() => svgToPngBytes(SVG, 10, 10), /browser environment/)
})

console.log('\n— an injected rasteriser is used, and checked —')

await asyncTest('injected bytes are returned unchanged', async () => {
  setSvgRasterizer(async () => PNG)
  try {
    const bytes = await svgToPngBytes(SVG, 10, 10)
    assert.ok(bytes instanceof Uint8Array)
    assert.deepEqual([...bytes], [...PNG])
  } finally {
    resetSvgRasterizer()
  }
})

await asyncTest('the rasteriser receives the svg and the size the exporter asked for', async () => {
  let seen = null
  setSvgRasterizer(async (svg, width, height) => {
    seen = { svg, width, height }
    return PNG
  })
  try {
    await svgToPngBytes(SVG, 320, 240)
    assert.equal(seen.svg, SVG)
    assert.equal(seen.width, 320)
    assert.equal(seen.height, 240)
  } finally {
    resetSvgRasterizer()
  }
})

for (const [what, value] of [
  ['a string', 'not bytes'],
  ['an empty array', new Uint8Array()],
  ['null', null],
  ['a plain array', [1, 2, 3]],
]) {
  await asyncTest(`${what} is refused rather than embedded`, async () => {
    setSvgRasterizer(async () => value)
    try {
      await assert.rejects(() => svgToPngBytes(SVG, 10, 10), /did not return PNG bytes/)
    } finally {
      resetSvgRasterizer()
    }
  })
}

await asyncTest('a rasteriser that throws propagates, so the caller can report the stage', async () => {
  setSvgRasterizer(async () => { throw new Error('chromium went away') })
  try {
    await assert.rejects(() => svgToPngBytes(SVG, 10, 10), /chromium went away/)
  } finally {
    resetSvgRasterizer()
  }
})

console.log('\n— the seam cannot be filled with nonsense —')

test('a non-function is refused at injection time, not at use time', () => {
  assert.throws(() => setSvgRasterizer('a function, honestly'), TypeError)
  assert.equal(hasInjectedRasterizer(), false, 'and nothing is left installed')
})

test('resetting restores the browser path', () => {
  setSvgRasterizer(async () => PNG)
  assert.equal(hasInjectedRasterizer(), true)
  resetSvgRasterizer()
  assert.equal(hasInjectedRasterizer(), false)
})

/* ── the decoder seam ────────────────────────────────────────────────────── */

console.log('\n— the decoder seam —')

await asyncTest('nothing injected means "take the browser path", not "failed"', async () => {
  // undefined and null are different answers on purpose. undefined = no decoder
  // installed; null = a decoder saying these bytes are not a readable image.
  // Collapsing them would make the exporter retry a browser that is not there.
  assert.equal(hasInjectedDecoder(), false)
  assert.equal(await decodeImageBytes(PNG, 'image/png'), undefined)
})

await asyncTest('an injected decoder answers instead of the browser', async () => {
  setImageDecoder(async () => ({ bytes: PNG, width: 96, height: 48 }))
  try {
    assert.deepEqual(await decodeImageBytes(PNG, 'image/png'), { bytes: PNG, width: 96, height: 48 })
  } finally {
    resetImageDecoder()
  }
})

await asyncTest('a decoder may say "not an image" and that is a real verdict', async () => {
  setImageDecoder(async () => null)
  try {
    assert.equal(await decodeImageBytes(PNG, 'image/png'), null, 'null, not undefined')
  } finally {
    resetImageDecoder()
  }
})

await asyncTest('a decoder returning no usable size is rejected, not embedded', async () => {
  // A zero-sized composite is a blank box in Word. Checked rather than trusted,
  // for the same reason the rasteriser's output is.
  for (const bad of [{ bytes: PNG, width: 0, height: 10 }, { bytes: PNG, width: 10, height: NaN }]) {
    setImageDecoder(async () => bad)
    try {
      await assert.rejects(() => decodeImageBytes(PNG, 'image/png'), /no usable size/)
    } finally {
      resetImageDecoder()
    }
  }
})

await asyncTest('a decoder returning something that is not bytes is rejected', async () => {
  setImageDecoder(async () => ({ bytes: 'a png, honestly', width: 10, height: 10 }))
  try {
    await assert.rejects(() => decodeImageBytes(PNG, 'image/png'), /did not return image bytes/)
  } finally {
    resetImageDecoder()
  }
})

test('the decoder seam cannot be filled with nonsense either', () => {
  assert.throws(() => setImageDecoder('a decoder, honestly'), TypeError)
  assert.equal(hasInjectedDecoder(), false, 'and nothing is left installed')
})

test('the two seams are independent', () => {
  // They failed together in the harness and were fixed one at a time; a shared
  // flag would have made installing one silently satisfy the other's assertion.
  setSvgRasterizer(async () => PNG)
  try {
    assert.equal(hasInjectedRasterizer(), true)
    assert.equal(hasInjectedDecoder(), false)
  } finally {
    resetSvgRasterizer()
  }
})

console.log(`\n✓ svg rasteriser seam — ${passed} tests passed`)
