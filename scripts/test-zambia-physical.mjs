/**
 * test:zambia-physical — the physical-features prototype's data, checked where
 * a browser cannot check it.
 *
 * The two datasets this page SHARES with Know Zambia are written and checked by
 * the pair that already owns them — `npm run sync:zambia-game` writes every
 * prototype's mirrors from the one PAGES list, and test:zambia-game compares
 * them. This file owns what is new: zambia_physical.json, and the ways it can
 * contradict the data it sits on top of.
 *
 * docs/learner/zedexams-zambia-physical.html renders entirely from three
 * datasets and runs its own acceptance rules on screen. Four classes of
 * failure survive that, and all four are silent:
 *
 *   1. THE INLINE MIRROR DRIFTS. The HTML carries a copy of all three datasets
 *      so it still renders when opened from the filesystem (the browser blocks
 *      the fetch on file://). Edit a dataset, forget `npm run sync:zambia-game`,
 *      and every reviewer who double-clicks the file reviews yesterday's
 *      answers. Nothing looks broken.
 *
 *   2. THE TWO GAMES START THE SAME RIVER IN DIFFERENT PROVINCES. Know Zambia
 *      teaches that the Kafue rises on the Copperbelt. If this game's course
 *      ever starts somewhere else, one of the two is teaching a child a wrong
 *      answer — and each looks perfectly consistent on its own.
 *
 *   3. A RIVER COURSE STOPS AGREEING WITH ITS OWN RIVER LINE. The taught route
 *      is a list of provinces; the line drawn under it is a list of
 *      coordinates. Nothing makes them agree except this check, which projects
 *      the waypoints and asks which province each one falls in.
 *
 *   4. AN ALTITUDE IS EDITED ON ITS OWN. The relief mode is an ORDERING, so one
 *      figure changed to a different source's number can silently give the
 *      question two right answers or none.
 *
 * Geometry here is deliberately re-implemented rather than imported: the point
 * is to check the shipped data with something other than the code that draws it.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'docs', 'learner')
const HTML_PATH = path.join(DIR, 'zedexams-zambia-physical.html')
const html = fs.readFileSync(HTML_PATH, 'utf8')
const provinces = JSON.parse(fs.readFileSync(path.join(DIR, 'zambia_provinces.json'), 'utf8'))
const facts = JSON.parse(fs.readFileSync(path.join(DIR, 'zambia_facts.json'), 'utf8'))
const phys = JSON.parse(fs.readFileSync(path.join(DIR, 'zambia_physical.json'), 'utf8'))

const KEYS = ['nw', 'cb', 'ce', 'lu', 'so', 'we', 'no', 'mu', 'ea', 'lp']
const TOLERANCE = 2.5 // map units ≈ 30 km, the hand trace's stated resolution

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

/* --- geometry, re-implemented --- */
function parsePath(d) {
  const pts = []
  const re = /[ML]\s*(-?[\d.]+),(-?[\d.]+)/g
  let m
  while ((m = re.exec(d))) pts.push([Number(m[1]), Number(m[2])])
  return pts
}
function inside([x, y], pts) {
  let r = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r
  }
  return r
}
function project(lon, lat) {
  const p = provinces.projection
  return [(lon - p.lon.min) * p.lon.scale + p.lon.offset, (lat - p.lat.min) * p.lat.scale + p.lat.offset]
}
const OUTLINE = Object.fromEntries(KEYS.map((k) => [k, parsePath(provinces.provinces[k].d)]))
function whichProvince(pt) {
  for (const k of KEYS) if (inside(pt, OUTLINE[k])) return k
  return null
}
function distToPoly(p, pts) {
  let d = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]
    const [bx, by] = pts[i]
    const dx = bx - ax
    const dy = by - ay
    const l = dx * dx + dy * dy
    const t = l ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l)) : 0
    d = Math.min(d, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]))
  }
  return d
}
function derivedRoute(waypoints) {
  const seq = []
  const push = (k) => {
    if (k && seq[seq.length - 1] !== k) seq.push(k)
  }
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = project(...waypoints[i])
    const b = project(...waypoints[i + 1])
    for (let t = 0; t < 20; t++) push(whichProvince([a[0] + ((b[0] - a[0]) * t) / 20, a[1] + ((b[1] - a[1]) * t) / 20]))
  }
  push(whichProvince(project(...waypoints[waypoints.length - 1])))
  const out = []
  for (const k of seq) if (!out.includes(k)) out.push(k)
  return out
}
function mirrorOf(id) {
  const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))
  assert.ok(m, `no <script id="${id}"> mirror block in the prototype`)
  return m[1]
}
function riverOf(id) {
  return facts.water.rivers.find((r) => r.id === id)
}

console.log('zambia-physical')

test('the three inline mirrors match the datasets byte for byte', () => {
  const fix = 'run `npm run sync:zambia-game` and commit the result'
  for (const [id, file] of [
    ['mirror-provinces', 'zambia_provinces.json'],
    ['mirror-facts', 'zambia_facts.json'],
    ['mirror-physical', 'zambia_physical.json'],
  ]) {
    assert.equal(mirrorOf(id), fs.readFileSync(path.join(DIR, file), 'utf8').trim(), `${file} and its inline mirror disagree — ${fix}`)
  }
})

test('five modes, reachable from one menu, with relief first', () => {
  const ids = [...html.matchAll(/m\.push\(\{id:'([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(ids, ['relief', 'falls', 'course', 'watershed', 'lakes'],
    `the menu builds ${ids.join(', ')} — the prompt asks for five, and for relief BEFORE the river modes so a learner meets the plateau before the water running off it`)
  assert.match(html, /function menuScreen\(\)/, 'the five modes must be reachable from one menu screen')
})

test('every waterfall names a real province, and says something when it is missed', () => {
  assert.ok(phys.falls.length >= 5, `only ${phys.falls.length} waterfalls`)
  for (const f of phys.falls) {
    assert.ok(KEYS.includes(f.province), `${f.name} is filed under "${f.province}", which is not a province`)
    for (const alt of f.alsoAccept || []) {
      assert.ok(KEYS.includes(alt), `${f.name} also accepts "${alt}", which is not a province`)
      assert.ok(f.alsoAcceptWhy, `${f.name} accepts a second province but never explains why — the learner is told they are right and taught nothing`)
    }
    assert.ok(f.hint, `${f.name} has no positional hint, so a wrong tap would be a bare cross`)
    assert.ok(f.fact, `${f.name} has no fact — the prompt asks each answer to say what makes that fall distinctive`)
    assert.ok(typeof f.lon === 'number' && typeof f.lat === 'number', `${f.name} has no coordinates`)
  }
})

test('every waterfall projects into the province it is filed under, within the trace’s accuracy', () => {
  const far = []
  for (const f of phys.falls) {
    const xy = project(f.lon, f.lat)
    if (whichProvince(xy) === f.province) continue
    const d = distToPoly(xy, OUTLINE[f.province])
    if (d > TOLERANCE) far.push(`${f.name} → ${f.province} (${d.toFixed(1)} units, about ${(d * 12).toFixed(0)} km out)`)
  }
  assert.deepEqual(far, [], `waterfalls landing in the wrong province by more than the hand trace can explain: ${far.join(', ')}`)
})

test('the Kafue rises in the same province here as it does in Know Zambia', () => {
  const course = phys.riverCourses.find((c) => c.id === 'kafue')
  const river = riverOf('kafue')
  assert.ok(course && river, 'the Kafue is missing from one of the two datasets')
  assert.equal(course.route[0], river.answer,
    `zambia_facts.json teaches that the Kafue rises in "${river.answer}" and zambia_physical.json starts its course in "${course.route[0]}". ` +
      'Two games in one product cannot answer the same question differently — see dataset.knownDisagreements.')
})

test('each river course is a real sequence of provinces, every step explained', () => {
  assert.ok(phys.riverCourses.length >= 2, 'the prompt asks for the Zambezi and the Kafue')
  for (const c of phys.riverCourses) {
    assert.ok(c.route.length >= 3, `${c.name}: a course of ${c.route.length} provinces is not a course`)
    assert.deepEqual([...new Set(c.route)], c.route, `${c.name}: a province appears twice in the route, so "the next one" has two answers`)
    for (const k of c.route) {
      assert.ok(KEYS.includes(k), `${c.name}: "${k}" is not a province`)
      assert.ok(c.why[k], `${c.name}: nothing to say when the learner reaches ${k}`)
    }
    assert.ok(c.end, `${c.name}: no closing fact for finishing the river`)
  }
})

test('each river step lands in a province the last one touches', () => {
  const edges = (provinces.adjacency || {}).edges
  assert.ok(edges, 'zambia_provinces.json carries no adjacency graph to check against')
  const bad = []
  for (const c of phys.riverCourses) {
    for (let i = 1; i < c.route.length; i++) {
      const [a, b] = [c.route[i - 1], c.route[i]]
      if (!(edges[a] || []).includes(b)) bad.push(`${c.name}: ${a} → ${b}`)
    }
  }
  assert.deepEqual(bad, [],
    `these provinces do not share a boundary, so no river can run straight from one to the other: ${bad.join(', ')}. ` +
      'The waypoint check cannot always catch this on its own — a schematic line can cut a corner the route never claims.')
})

test('each taught course agrees with the river line drawn under it', () => {
  const disagree = []
  for (const c of phys.riverCourses) {
    const river = riverOf(c.factsRiverId)
    assert.ok(river, `${c.name}: no river with id "${c.factsRiverId}" in zambia_facts.json`)
    const got = derivedRoute(river.waypoints)
    if (got.join() !== c.route.join()) disagree.push(`${c.name}: taught ${c.route.join(' → ')}, waypoints run ${got.join(' → ')}`)
  }
  assert.deepEqual(disagree, [],
    `a course and the line the prototype draws for it disagree: ${disagree.join('; ')}. ` +
      'One of the two is wrong, and the game shows both — the route while it is played, the line once it is finished.')
})

test('the watershed sort covers at least five rivers and both destinations', () => {
  const rivers = phys.watershed.rivers
  assert.ok(rivers.length >= 5, `only ${rivers.length} rivers — the prompt's floor is five`)
  const basins = new Set(rivers.map((r) => r.basin))
  assert.deepEqual([...basins].sort(), ['congo', 'zambezi'], 'both sides of the Congo–Zambezi divide must be represented')
  for (const r of rivers) {
    assert.ok(phys.watershed.basins[r.basin], `${r.name} drains to "${r.basin}", which is not one of the declared basins`)
    assert.ok(r.why, `${r.name} has no explanation of where its water actually goes`)
    assert.ok(r.hint, `${r.name} has nothing to say when it is sorted into the wrong ocean`)
  }
  assert.ok(/congo/i.test(phys.watershed.idea) && /zambezi/i.test(phys.watershed.idea), 'the divide itself must be stated in words')
})

test('the lakes are sortable, and each one can be shown on the map', () => {
  assert.ok(phys.lakes.length >= 5, `only ${phys.lakes.length} lakes`)
  const kinds = new Set(phys.lakes.map((l) => l.kind))
  assert.deepEqual([...kinds].sort(), ['man-made', 'natural'], 'a sort needs both answers on the table')
  for (const l of phys.lakes) {
    assert.ok(l.why, `${l.name} has no explanation`)
    assert.ok(l.hint, `${l.name} has nothing to say when it is sorted wrongly`)
    if (l.kind === 'man-made') assert.ok(typeof l.year === 'number', `${l.name} is man-made but does not say when it was built — that is the fact that surprises a child`)
    const shape = l.factsLakeId ? facts.water.lakes.find((x) => x.id === l.factsLakeId) : l.geometry
    assert.ok(shape, `${l.name} resolves to no shape in either dataset`)
    assert.ok(whichProvince(project(shape.lon, shape.lat)) || l.factsLakeId,
      `${l.name}: its own geometry projects outside Zambia altogether`)
  }
})

test('relief is four steps, strictly descending, each with a figure and a cited source', () => {
  const rel = phys.relief
  const sourceIds = new Set(phys.dataset.sources.map((s) => s.id))
  assert.equal(rel.length, 4, 'the prompt names four: the hills, the plateau, the valley, the river leaving')
  rel.forEach((r, i) => {
    assert.equal(typeof r.metres, 'number', `${r.name} has no figure to order by`)
    assert.ok(r.display, `${r.name} has no altitude to show on the completion screen`)
    assert.ok(sourceIds.has(r.source), `${r.name} cites "${r.source}", which is not in dataset.sources — the prompt says pick one source and cite it`)
    if (i) {
      assert.ok(rel[i - 1].metres > r.metres,
        `${rel[i - 1].name} (${rel[i - 1].metres} m) is not above ${r.name} (${r.metres} m) — the ordering has no single right answer any more`)
    }
  })
  assert.equal(new Set(rel.map((r) => r.source)).size, 1,
    'all four altitudes must come from ONE source. Mixing sources is how an ordering silently stops being true — and sources differ by up to 175 m on the Mafinga Hills alone.')
  assert.equal(rel[0].province, 'mu', "Zambia's highest point is in Muchinga, on the Malawi border")
  assert.match(rel[3].name, /Zambezi/, 'the lowest point in Zambia is where the Zambezi leaves it')
  assert.equal(rel[3].metres, 329, 'the lowest point is 329 m — if that changes, the source changed, and all four must change together')
})

test('all four altitudes are printed when the relief mode is finished', () => {
  const summary = html.match(/function summaryHtml\(\)[\s\S]*?\n\}/)
  assert.ok(summary, 'no completion summary in the prototype')
  assert.match(summary[0], /M\.items\.forEach[\s\S]*?r\.display/,
    'the completion screen must print every item with its altitude — the prompt asks for all four figures on completion')
})

test('nothing in the prototype is on a clock', () => {
  const banned = ['set' + 'Timeout', 'set' + 'Interval', 'Date' + '.now', 'request' + 'AnimationFrame', 'new ' + 'Date']
  const found = banned.filter((n) => html.includes(n))
  assert.deepEqual(found, [], `timing calls in the prototype: ${found.join(', ')}. No mode may be on a clock, and a wrong tap must stay on screen until the learner tries again rather than being wiped by a timer.`)
})

test('no mode needs geometry beyond the province file', () => {
  for (const gated of ['EXTRAS&&o.pin', 'EXTRAS&&o.lakes', 'EXTRAS&&o.riverLine']) {
    assert.ok(html.includes(gated),
      `${gated} is not gated in svgMap — a pin, lake or river line that renders regardless makes "Province file only" a claim the switch cannot test`)
  }
  assert.match(html, /id="rBare"/, 'the "Province file only" switch is what proves the claim; it must exist')
  const interactive = html.match(/data-hit="prov:/g) || []
  assert.ok(interactive.length > 0, 'every interaction must land on a province outline')
  assert.ok(!/data-hit="(lake|zone|point):/.test(html), 'nothing here may be answered by tapping geometry the province file does not contain')
})

test('the prototype reads the datasets rather than a copy pasted into the code', () => {
  assert.match(html, /fetch\(/, 'the page must fetch the datasets when it is served')
  assert.ok(!/const\s+P\s*=\s*\{\s*nw:/.test(html), 'province paths must not be pasted into the script — they belong in the dataset')
  for (const f of ['zambia_provinces.json', 'zambia_facts.json', 'zambia_physical.json']) {
    assert.ok(html.includes(f), `${f} is never named in the prototype`)
  }
})

test('the dataset says out loud that it has not been verified', () => {
  const v = phys.dataset.verification
  assert.ok(v, 'zambia_physical.json has no verification block')
  assert.ok('checkedBy' in v && 'checkedOn' in v && 'checkedAgainst' in v, 'it must carry the three fields a reviewer signs off in')
  if (v.status === 'UNVERIFIED') {
    assert.ok(v.requiredBeforeRelease.length > 0, 'it is unverified but does not say what would verify it')
    assert.ok(v.requiredBeforeRelease.some((s) => /teacher/i.test(s)), 'the prompt asks for a Zambian geography teacher to check the routes and the relief figures')
    assert.ok(v.requiredBeforeRelease.some((s) => /altitude/i.test(s)), 'altitudes vary between sources; the file must say which set it picked and that it needs confirming')
  } else {
    assert.ok(v.checkedBy && v.checkedOn && v.checkedAgainst, 'it claims to be verified but does not say who checked it, when, or against what')
  }
  assert.ok((phys.dataset.knownDisagreements || []).length > 0,
    'the Kafue disagreement between this dataset and the build prompt must stay on the record rather than being silently resolved')
})

if (failures > 0) {
  console.error(`\nzambia-physical — ${failures} failed`)
  process.exit(1)
}
console.log('zambia-physical — all passed')
