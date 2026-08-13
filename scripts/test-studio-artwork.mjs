/**
 * Studio artwork guard — the icons on the glass tiles must be CUT-OUTS.
 *
 * The tiles are glass. Artwork with its own rounded-square background baked
 * into the file reads as a second, harder-edged tile sitting on the glass
 * one, which is exactly what the glass treatment set out to remove. Every
 * studio icon is therefore a transparent cut-out, and the one file that is
 * not yet declares itself with `boxedArtwork: true` so the mount clips it to
 * its box's radius instead of floating it.
 *
 * WHAT THIS CHECKS, precisely: the WebP CONTAINER — an extended (VP8X) file
 * whose header sets the alpha bit and which carries an ALPH chunk. That is
 * enough to catch the failure that actually shipped (an opaque file dropped
 * in over a transparent one: four icons were plain lossy VP8 with no alpha
 * channel at all), and it is enough to force the `boxedArtwork` flag to be
 * removed when its file is finally replaced.
 *
 * WHAT IT DOES NOT CHECK: how MUCH of the image is transparent. Decoding the
 * alpha plane needs a real WebP decoder, and the repo carries none. So a file
 * that has an alpha channel but is opaque across it would pass here — that is
 * a known limit of this guard, not an oversight. Measure with Pillow or
 * `dwebp` when replacing artwork; a genuine cut-out in this set runs roughly
 * 35–55% fully-clear pixels, a boxed one 0–8% (corner rounding only).
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const iconDir = resolve(root, 'src/assets/teacher/studio-icons')
const registryPath = resolve(
  root,
  'src/shared/constants/teacherStudios.js',
)

/**
 * Reads the WebP container. RIFF header is 12 bytes; bytes 12–15 name the
 * first chunk. 'VP8X' is the extended format, whose 1-byte flags field at
 * offset 20 has the alpha bit at 0x10. A plain 'VP8 ' (lossy) file has no
 * alpha channel at all.
 */
function readWebpAlpha(bytes) {
  assert.equal(bytes.slice(0, 4).toString('latin1'), 'RIFF', 'not a RIFF file')
  assert.equal(bytes.slice(8, 12).toString('latin1'), 'WEBP', 'not a WebP file')
  const firstChunk = bytes.slice(12, 16).toString('latin1')
  const alphaFlag = firstChunk === 'VP8X' && (bytes[20] & 0x10) !== 0
  return { firstChunk, alphaFlag, hasAlphChunk: bytes.includes(Buffer.from('ALPH')) }
}

const hasAlphaChannel = (file) => {
  const { alphaFlag, hasAlphChunk } = readWebpAlpha(readFileSync(resolve(iconDir, file)))
  return alphaFlag && hasAlphChunk
}

/* ── Which studios declare boxed artwork ──────────────────────────────────
   Read out of the registry source rather than imported: teacherStudios.js
   imports .webp files, which plain `node` cannot resolve. The registry pairs
   an `image: imgFoo` line with the import that binds imgFoo to a filename. */
const registry = readFileSync(registryPath, 'utf8')

const importedFile = new Map() // local binding -> icon filename
for (const [, binding, file] of registry.matchAll(
  /import\s+(\w+)\s+from\s+'[^']*\/studio-icons\/([\w-]+\.webp)'/g,
)) {
  importedFile.set(binding, file)
}
assert.ok(importedFile.size > 0, 'no studio-icon imports found in teacherStudios.js')

// Each studio object, so `image:` and `boxedArtwork:` can be read together.
const boxedFiles = new Set()
const usedFiles = new Set()
for (const [, body] of registry.matchAll(/\{\s*\n\s*id: '[\w-]+',([\s\S]*?)\n\s{2}\},/g)) {
  const image = body.match(/image:\s*(\w+)/)
  if (!image) continue
  const file = importedFile.get(image[1])
  if (!file) continue
  usedFiles.add(file)
  if (/boxedArtwork:\s*true/.test(body)) boxedFiles.add(file)
}
assert.ok(usedFiles.size > 0, 'no studio entries with artwork found in teacherStudios.js')

/* ── 1. every referenced file exists ─────────────────────────────────── */
const onDisk = new Set(readdirSync(iconDir).filter((f) => f.endsWith('.webp')))
for (const file of usedFiles) {
  assert.ok(onDisk.has(file), `teacherStudios.js references a missing icon: ${file}`)
}

/* ── 2. un-flagged artwork must be a cut-out ─────────────────────────── */
const opaque = [...usedFiles]
  .filter((f) => !boxedFiles.has(f))
  .filter((f) => !hasAlphaChannel(f))
  .sort()
assert.deepEqual(
  opaque,
  [],
  `these studio icons have no alpha channel, so they carry their background ` +
    `into the glass tile. Replace them with cut-outs, or mark the studio ` +
    `boxedArtwork: true if that is deliberate: ${opaque.join(', ')}`,
)

/* ── 3. the flag has to be EARNED ────────────────────────────────────────
   A boxedArtwork studio whose file gained an alpha channel means the
   replacement landed and the flag is now lying to the mount — the artwork
   would be clipped and denied its glow for no reason. */
const staleFlags = [...boxedFiles].filter((f) => hasAlphaChannel(f)).sort()
assert.deepEqual(
  staleFlags,
  [],
  `these icons now have an alpha channel, so their studio's ` +
    `boxedArtwork: true flag (and the CSS exception it triggers) should be ` +
    `removed: ${staleFlags.join(', ')}`,
)

/* ── 4. the exception stays visible ──────────────────────────────────────
   Not a correctness rule — a note in the output, so a boxed icon cannot sit
   in the set unnoticed for another release. */
console.log(
  `studio artwork: ${usedFiles.size - boxedFiles.size}/${usedFiles.size} cut-out` +
    (boxedFiles.size
      ? `, still boxed (pending a transparent source): ${[...boxedFiles].sort().join(', ')}`
      : ''),
)
