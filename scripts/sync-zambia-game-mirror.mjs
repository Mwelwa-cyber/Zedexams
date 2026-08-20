/**
 * Write the Know Zambia datasets into the inline mirror blocks of every
 * prototype that carries them — docs/learner/zedexams-zambia-game.html,
 * docs/learner/zedexams-zambia-map-modes.html and
 * docs/learner/zedexams-zambia-physical.html.
 *
 * WHY A MIRROR EXISTS AT ALL
 * --------------------------
 * The prototype is opened two ways. Served over http:// it FETCHES
 * zambia_provinces.json and zambia_facts.json — the real files, the ones a
 * reviewer edits and a Zambian teacher signs off in. Double-clicked from the
 * filesystem, the browser blocks that fetch, and a geography game that renders
 * no map is not a prototype. So the HTML carries a copy of both inline, and its
 * control strip says which of the two it is reading.
 *
 * A second copy is a fork waiting to happen, which is what test:zambia-game is
 * for: it fails when a mirror and its file disagree, and names this script as
 * the fix. A THIRD copy is worse, so PAGES below is the one list — add a
 * prototype here and both the sync and the test pick it up, rather than the
 * new page quietly keeping a mirror nobody rewrites.
 *
 * Pages carry different SETS of mirrors: the two Know Zambia prototypes carry
 * the outlines and the facts, and the physical-features one carries those two
 * plus its own dataset. So each page names its blocks rather than every page
 * getting every block — but there is still ONE command, because the failure
 * this file exists to prevent is somebody editing zambia_facts.json, running a
 * sync, and leaving a prototype nobody remembered behind on the old copy.
 *
 *   npm run sync:zambia-game
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'docs', 'learner')
export const BLOCKS = [
  { id: 'mirror-provinces', file: 'zambia_provinces.json' },
  { id: 'mirror-facts', file: 'zambia_facts.json' },
  { id: 'mirror-physical', file: 'zambia_physical.json' },
]
const SHARED = ['mirror-provinces', 'mirror-facts']
export const PAGES = [
  { page: 'zedexams-zambia-game.html', blocks: SHARED },
  { page: 'zedexams-zambia-map-modes.html', blocks: SHARED },
  { page: 'zedexams-zambia-physical.html', blocks: [...SHARED, 'mirror-physical'] },
]

let changed = 0
const touched = []

for (const { page, blocks } of PAGES) {
  const htmlPath = path.join(DIR, page)
  let html = readFileSync(htmlPath, 'utf8')
  let pageChanged = 0

  for (const block of BLOCKS.filter((b) => blocks.includes(b.id))) {
    const raw = readFileSync(path.join(DIR, block.file), 'utf8').trim()
    JSON.parse(raw) // refuse to embed something that is not JSON
    if (raw.includes('</script')) {
      throw new Error(`${block.file} contains </script and cannot be inlined`)
    }
    const re = new RegExp(`(<script type="application/json" id="${block.id}">)([\\s\\S]*?)(</script>)`)
    if (!re.test(html)) throw new Error(`no mirror block for ${block.id} in ${htmlPath}`)
    html = html.replace(re, (_match, open, body, close) => {
      if (body !== raw) pageChanged += 1
      return `${open}${raw}${close}`
    })
  }

  if (pageChanged) {
    writeFileSync(htmlPath, html)
    changed += pageChanged
    touched.push(`${page} (${pageChanged})`)
  }
}

if (changed) {
  console.log(`sync-zambia-game-mirror: updated ${changed} mirror block(s) — ${touched.join(', ')}`)
} else {
  console.log('sync-zambia-game-mirror: mirrors already match the datasets')
}

/* ── the app's copy ──────────────────────────────────────────────────────
 *
 * The Know Zambia game engine (src/features/games/) needs the same datasets,
 * and `src/` may not read from `docs/` — the import boundaries forbid it and
 * Vite would not bundle it anyway. So the app's copy is GENERATED rather than
 * copied by hand: docs/learner stays the one place a reviewer or a Zambian
 * teacher edits, and this module is output.
 *
 * Written as a .js module rather than .json so the provenance header travels
 * with it. A bare JSON copy sitting in src/ is indistinguishable from a second
 * source of truth, which is the thing this script exists to prevent.
 */
const APP_FILE = path.join(process.cwd(), 'src', 'data', 'zambiaGeography.js')
const dataset = (file) => JSON.parse(readFileSync(path.join(DIR, file), 'utf8'))

const generated = `/**
 * GENERATED — do not edit. Run \`npm run sync:zambia-game\` instead.
 *
 * Source of truth: docs/learner/zambia_provinces.json, zambia_facts.json and
 * zambia_physical.json — what a reviewer reads and what a Zambian teacher
 * signs off in. \`npm run test:zambia-game\` fails when this file and those
 * three disagree, and names the sync as the fix.
 *
 * Every dataset carries a \`verification\` block, and at the time of writing
 * each says UNVERIFIED. Read it before putting anything from here in front of
 * a learner as fact.
 */

export const ZAMBIA_PROVINCES_GEO = Object.freeze(${JSON.stringify(dataset('zambia_provinces.json'), null, 2)})

export const ZAMBIA_FACTS = Object.freeze(${JSON.stringify(dataset('zambia_facts.json'), null, 2)})

export const ZAMBIA_PHYSICAL = Object.freeze(${JSON.stringify(dataset('zambia_physical.json'), null, 2)})
`

let previous = null
try { previous = readFileSync(APP_FILE, 'utf8') } catch { /* first run */ }
if (previous !== generated) {
  writeFileSync(APP_FILE, generated)
  console.log('sync-zambia-game-mirror: regenerated src/data/zambiaGeography.js')
}
