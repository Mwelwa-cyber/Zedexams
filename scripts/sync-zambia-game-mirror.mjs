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
