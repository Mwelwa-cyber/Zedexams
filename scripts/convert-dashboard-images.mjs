#!/usr/bin/env node
/**
 * One-off script: convert the dashboard PNG art to WebP.
 *
 * Inputs  → public/images/characters/*.png + public/zedexams-logo.png
 * Outputs → sibling .webp file at ~q80 (near-visually-lossless for UI art)
 *
 * Usage:
 *   node scripts/convert-dashboard-images.mjs
 *
 * Why:
 *   The learner dashboard (GradeHub) loads ~5 MB of PNGs on first paint.
 *   WebP cuts that by 70–85% for illustration-style art with alpha.
 *   We keep the original PNGs as a <picture> fallback for legacy browsers.
 */
import sharp from 'sharp'
import { readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const TARGETS = [
  'public/images/characters/zed-zara-reading.png',
  'public/images/characters/lina-study.png',
  'public/images/characters/max-gaming.png',
  'public/images/characters/zedbot-help.png',
  'public/zedexams-logo.png',
]

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function convert(rel) {
  const src = path.join(ROOT, rel)
  const out = src.replace(/\.png$/i, '.webp')

  const pngBuf = await readFile(src)
  const webpBuf = await sharp(pngBuf)
    .webp({ quality: 82, effort: 6, alphaQuality: 90 })
    .toBuffer()

  await writeFile(out, webpBuf)

  const { size: pngSize } = await stat(src)
  const { size: webpSize } = await stat(out)
  const savedPct = (100 * (pngSize - webpSize) / pngSize).toFixed(1)
  console.log(
    `${path.relative(ROOT, src).padEnd(46)}  ${fmt(pngSize).padStart(9)} → ${fmt(webpSize).padStart(9)}  (-${savedPct}%)`,
  )
}

console.log('Converting dashboard PNGs → WebP …\n')
for (const rel of TARGETS) {
  try {
    await convert(rel)
  } catch (err) {
    console.error(`FAIL ${rel}: ${err.message}`)
    process.exitCode = 1
  }
}
console.log('\nDone.')
