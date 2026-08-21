#!/usr/bin/env node
/* global console, process, document, window, requestAnimationFrame */
/**
 * Does Spelling Ride actually DRAW? — the road, the rider and the tiles.
 *
 * ── The failure this exists to catch ──────────────────────────────────
 *
 * Shipped, the game rendered a perfect HUD over an empty box: hearts, town
 * chip, score, the word bar with its clue and blanks — and no road, no
 * rider, no letter tiles. Everything that could be asserted in jsdom was
 * right, because every one of those things is a DOM node. The canvas is not.
 * `test:spelling-ride` measures pacing and geometry as NUMBERS and passed
 * throughout; `SpellingRideGame.spec.jsx` renders the surface in jsdom, where
 * a canvas has no 2D context at all.
 *
 * So this asks the only question those two cannot: after a real Chromium has
 * painted a real frame, are there pixels on the canvas, and are they the
 * road's pixels? It reads the backing store back with `getImageData` and
 * requires many colours and no single dominant one — a canvas filled with one
 * flat colour fails, which is exactly what shipped.
 *
 * ── It rides TWICE, and the second ride is the point ──────────────────
 *
 * The shipped bug was not in the first ride, which is why every check that
 * existed passed and why it survived a Chromium pass during the build: the
 * FIRST ride drew perfectly. The stage unmounts when a ride ends, so "Ride
 * again" mounts a NEW canvas element — and the renderer, created once and
 * cached, went on sizing and painting the old detached one. Every ride after
 * the first was a blank road under a live HUD.
 *
 * A harness that mounts once can never see that. This one plays a ride, ends
 * it, takes "Ride again", and asserts the road is still there. The
 * give-away it also pins is the canvas's own size: an untouched element
 * reports the browser default 300×150, because `resize` reached a different
 * node.
 *
 * Needs a real Chromium, so — like test-games-hub-layout.mjs — it is NOT a
 * `test:*` script. Locally:
 *     npm run smoke:spelling-ride
 * (set PUPPETEER_EXECUTABLE_PATH to reuse a system/Playwright Chromium.)
 */
import { build } from 'esbuild'
import puppeteer from 'puppeteer'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STUBS } from './spellingRide/stubs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, 'node_modules/.cache/spelling-ride')

/** The shapes a learner actually holds a phone or a laptop in. */
const VIEWPORTS = [
  { id: 'phone',   width: 390,  height: 844 },
  { id: 'small',   width: 320,  height: 568 },
  { id: 'tablet',  width: 768,  height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
]

const stubPlugin = {
  name: 'spelling-ride-stubs',
  setup(b) {
    const keys = Object.keys(STUBS)
    b.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer) return null
      const full = resolve(dirname(args.importer), args.path)
      const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/').replace(/\.(jsx?|mjs)$/, '')
      const hit = keys.find((k) => k === rel)
      return hit ? { path: hit, namespace: 'spelling-ride-stub' } : null
    })
    b.onLoad({ filter: /.*/, namespace: 'spelling-ride-stub' }, (args) => ({
      contents: STUBS[args.path], loader: 'js', resolveDir: ROOT,
    }))
  },
}

async function buildBundle() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const outfile = join(OUT, 'entry.js')
  await build({
    entryPoints: [join(__dirname, 'spellingRide/rideEntry.jsx')],
    bundle: true, jsx: 'automatic', format: 'iife', outfile,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
    plugins: [stubPlugin],
    logLevel: 'silent',
  })
  const js = readFileSync(outfile, 'utf8')
  const css = readFileSync(outfile.replace(/\.js$/, '.css'), 'utf8')
  // A bundle with no ride stylesheet would give the stage no height, and a
  // zero-height canvas draws nothing — which this harness would then report
  // as the very bug it is looking for, from the wrong cause.
  if (!css.includes('.lhx-sr-stage') || !css.includes('.lhx-sr-canvas')) {
    throw new Error('the ride stylesheet did not reach the bundle')
  }
  return { js, css }
}

function page({ js, css }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>spelling ride canvas</title>
<style>${css}</style><style>html,body{margin:0}</style>
</head><body><div id="root"></div><script>${js}</script></body></html>`
}


/* ── Reading the page ─────────────────────────────────────────────────── */

/** Click the first button whose label matches. Returns whether one was found. */
function clickButton(p, pattern) {
  return p.evaluate((src) => {
    const re = new RegExp(src, 'i')
    const button = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''))
    if (!button) return false
    button.click()
    return true
  }, pattern)
}

/**
 * Let the road actually roll before measuring.
 *
 * Real frames, not a sleep: a tile is measured after it has travelled down
 * the track rather than at the instant it spawned above the horizon.
 */
function rollTheRoad(p, frames = 150) {
  return p.evaluate((n) => new Promise((done) => {
    let seen = 0
    const tick = () => (++seen < n ? requestAnimationFrame(tick) : done())
    requestAnimationFrame(tick)
  }), frames)
}

/**
 * What is on the canvas.
 *
 * A coarse grid rather than every pixel: enough to tell a drawn scene from a
 * flat fill, cheap enough to run at every viewport. Colours are quantised
 * because anti-aliasing would otherwise make every pixel unique and a flat
 * fill would look like a rich scene.
 */
function readCanvas(p) {
  return p.evaluate(() => {
    const canvas = document.querySelector('.lhx-sr-canvas')
    const stage = document.querySelector('.lhx-sr-stage')
    const out = {
      errors: window.__rideErrors || [],
      stage: { w: 0, h: 0 }, cssBox: { w: 0, h: 0 }, backing: { w: 0, h: 0 },
      hasContext: false, colours: 0, topColour: null, share: 1, samples: 0,
    }
    if (!canvas || !stage) return out
    const cRect = canvas.getBoundingClientRect()
    const sRect = stage.getBoundingClientRect()
    out.stage = { w: Math.round(sRect.width), h: Math.round(sRect.height) }
    out.cssBox = { w: Math.round(cRect.width), h: Math.round(cRect.height) }
    out.backing = { w: canvas.width, h: canvas.height }
    const ctx = canvas.getContext('2d')
    out.hasContext = !!ctx
    if (!ctx || !canvas.width || !canvas.height) return out
    const step = 8
    const counts = new Map()
    let samples = 0
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
        const key = `${r >> 4},${g >> 4},${b >> 4}`
        counts.set(key, (counts.get(key) || 0) + 1)
        samples += 1
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    out.colours = ranked.length
    out.topColour = ranked[0]?.[0] ?? null
    out.share = samples ? ranked[0][1] / samples : 1
    out.samples = samples
    return out
  })
}

/* ── Driver ──────────────────────────────────────────────────────────── */

const failures = []
const notes = []
function check(ok, message) { if (!ok) failures.push(message) }

/**
 * The road is on the canvas.
 *
 * A road, a sky, grass, tiles and a rider is many colours with no single one
 * dominant. A blank stage is one colour at 100% — which is what a learner saw.
 */
function assertRoad(label, shot) {
  check(shot.errors.length === 0, `${label}: the page raised ${JSON.stringify(shot.errors)}`)
  check(shot.hasContext, `${label}: the canvas has no 2D context`)
  check(shot.cssBox.h > 200, `${label}: the canvas is ${shot.cssBox.h}px tall — the road has nowhere to go`)
  check(
    shot.backing.w > 0 && shot.backing.h > 0,
    `${label}: the canvas backing store is ${shot.backing.w}×${shot.backing.h} — nothing can be drawn into it`,
  )
  check(
    shot.colours >= 8,
    `${label}: the canvas holds only ${shot.colours} distinct colours — it is blank, not a road`,
  )
  check(
    shot.share < 0.85,
    `${label}: ${(shot.share * 100).toFixed(1)}% of the canvas is one colour (${shot.topColour}) — nothing was drawn`,
  )
}

const { js, css } = await buildBundle()
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  const html = page({ js, css })
  writeFileSync(join(OUT, 'ride.html'), html)

  for (const vp of VIEWPORTS) {
    const p = await browser.newPage()
    await p.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 })
    await p.setRequestInterception(true)
    p.on('request', (req) => (req.url().startsWith('data:') || req.url() === 'about:blank'
      ? req.continue() : req.abort()))
    await p.setContent(html, { waitUntil: 'load' })
    await p.waitForFunction('window.__rideReady === true', { timeout: 20000 })

    // Start a ride: the menu is the first screen, exactly as a learner meets it.
    await p.waitForFunction(
      () => [...document.querySelectorAll('button')].some((b) => /start riding/i.test(b.textContent)),
      { timeout: 20000 },
    )
    await p.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /start riding/i.test(b.textContent)).click()
    })
    await p.waitForSelector('.lhx-sr-canvas', { timeout: 20000 })
    await rollTheRoad(p)

    const shot = await readCanvas(p)

    await p.screenshot({ path: join(OUT, `ride-${vp.id}.png`) })
    notes.push(
      `${vp.id.padEnd(8)} stage ${shot.stage.w}×${shot.stage.h}  css ${shot.cssBox.w}×${shot.cssBox.h}`
      + `  backing ${shot.backing.w}×${shot.backing.h}  colours ${shot.colours}`
      + `  top ${shot.topColour} ${(shot.share * 100).toFixed(1)}%`,
    )

    assertRoad(`${vp.id} · ride 1`, shot)

    // ── RIDE TWICE. The second one is the regression that shipped ──────
    //
    // Ending a ride unmounts the stage; "Ride again" mounts a new canvas.
    // A renderer cached from the first ride keeps painting the old detached
    // node, so the road vanishes from every ride after the first.
    const ended = await clickButton(p, 'End the ride|✕')
    check(ended, `${vp.id}: no control to end the ride`)
    await p.evaluate(() => new Promise((d) => setTimeout(d, 400)))
    const again = await clickButton(p, 'ride again')
    check(again, `${vp.id}: no "Ride again" after ending — the loop cannot be re-tested`)
    await p.waitForSelector('.lhx-sr-canvas', { timeout: 20000 })
    await rollTheRoad(p)
    const second = await readCanvas(p)
    await p.screenshot({ path: join(OUT, `ride-${vp.id}-second.png`) })
    notes.push(
      `${''.padEnd(8)} ride 2  backing ${second.backing.w}×${second.backing.h}`
      + `  colours ${second.colours}  top ${second.topColour} ${(second.share * 100).toFixed(1)}%`,
    )
    // 300×150 is the browser's default for a canvas nothing ever sized — the
    // fingerprint of `resize` having reached a different element.
    check(
      !(second.backing.w === 300 && second.backing.h === 150),
      `${vp.id} · ride 2: the canvas is still 300×150 — it was never sized, so the renderer is bound to a stale node`,
    )
    assertRoad(`${vp.id} · ride 2`, second)

    await p.close()
  }
} finally {
  await browser.close()
}

console.log('spelling-ride canvas')
for (const n of notes) console.log('  ' + n)
if (failures.length) {
  console.error('\n✗ ' + failures.length + ' failure(s):')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`\n✓ the road draws at all ${VIEWPORTS.length} viewports`)
console.log(`  screenshots: ${OUT}`)
