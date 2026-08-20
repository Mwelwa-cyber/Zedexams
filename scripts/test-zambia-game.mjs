/**
 * test:zambia-game — the Know Zambia prototype's data, checked where a browser
 * cannot check it.
 *
 * Two prototypes render entirely from the same two datasets and run their own
 * acceptance rules on screen — zedexams-zambia-game.html (the levels) and
 * zedexams-zambia-map-modes.html (the five map modes). Four classes of failure
 * survive that, and all four are silent:
 *
 *   1. THE INLINE MIRROR DRIFTS. The HTML carries a copy of both datasets so it
 *      still renders when opened from the filesystem (the browser blocks the
 *      fetch on file://). Edit a dataset, forget `npm run sync:zambia-game`,
 *      and every reviewer who double-clicks the file reviews the old map while
 *      everyone serving it over http:// reviews the new one. Nothing looks
 *      broken in either.
 *
 *   2. THE TWO FACTS THE PROMPT NAMES GET "CORRECTED" BACK. Southern Province's
 *      capital is Choma, not Livingstone, and Muchinga exists and dates from
 *      2011. Almost every generated list gets both wrong, so anything
 *      regenerating this content will drift towards the wrong answer.
 *
 *   3. THE OUTLINE STOPS AGREEING WITH THE PROJECTION. Towns, sites and rivers
 *      are drawn from real longitude and latitude through the projection block
 *      in the dataset. If either the trace or the projection is replaced
 *      without the other, pins keep rendering — in the wrong province.
 *
 *   4. A LESSON GOES WRONG WHILE THE GAME KEEPS WORKING. Journey mode marks a
 *      province sequence right or wrong, and odd-one-out asks which of four
 *      does not share a property. Both play perfectly against bad data: a route
 *      through two provinces that do not touch is still tappable in order, and
 *      a set whose "odd" province is not actually odd still lights four
 *      provinces and accepts a tap. Nothing on screen can tell, so the routes
 *      are checked against the adjacency graph and the odd-one-out rules are
 *      evaluated against the border data here.
 *
 * Geometry here is deliberately re-implemented rather than imported: the point
 * is to check the shipped data with something other than the code that draws it.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'docs', 'learner')
/* The one list of prototypes carrying inline mirrors. It must stay in step with
   PAGES in scripts/sync-zambia-game-mirror.mjs — a page in the sync and not
   here is a mirror nothing checks; a page here and not in the sync is a mirror
   nothing writes. The first test below compares the two lists.

   The physical-features prototype is here for the mirrors it shares, not for
   its own content: it carries copies of these same two datasets, so an edit to
   either has to reach it too. What it teaches on top of them is checked by
   test:zambia-physical. */
const PAGES = [
  'zedexams-zambia-game.html',
  'zedexams-zambia-map-modes.html',
  'zedexams-zambia-physical.html',
]
const HTML_PATH = path.join(DIR, PAGES[0])
const html = fs.readFileSync(HTML_PATH, 'utf8')
const modesHtml = fs.readFileSync(path.join(DIR, 'zedexams-zambia-map-modes.html'), 'utf8')
const pageSource = Object.fromEntries(PAGES.map((p) => [p, fs.readFileSync(path.join(DIR, p), 'utf8')]))
const syncScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'sync-zambia-game-mirror.mjs'), 'utf8')
const provinces = JSON.parse(fs.readFileSync(path.join(DIR, 'zambia_provinces.json'), 'utf8'))
const facts = JSON.parse(fs.readFileSync(path.join(DIR, 'zambia_facts.json'), 'utf8'))

const KEYS = ['nw', 'cb', 'ce', 'lu', 'so', 'we', 'no', 'mu', 'ea', 'lp']

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
function whichProvince(pt) {
  for (const k of KEYS) if (inside(pt, parsePath(provinces.provinces[k].d))) return k
  return null
}
function mirrorOf(id, source = html) {
  const m = source.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))
  assert.ok(m, `no <script id="${id}"> mirror block in the prototype`)
  return m[1]
}
function borders(k) {
  const b = facts.provinces[k].borders
  assert.ok(Array.isArray(b), `${k} has no borders list`)
  return b
}
function touches(a, b) {
  return (provinces.adjacency.edges[a] || []).includes(b)
}
/* How much boundary two provinces really share, counted as outline points of
   one lying on the other. Re-implemented rather than imported, for the same
   reason the rest of the geometry here is. */
function sharedBoundary(a, b) {
  const eps = 0.6
  const A = parsePath(provinces.provinces[a].d)
  const B = parsePath(provinces.provinces[b].d)
  const near = (p, pts) => {
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
    return d < eps
  }
  return A.filter((p) => near(p, B)).length + B.filter((p) => near(p, A)).length
}
/* The rule vocabulary the odd-one-out sets are written in. Evaluating it here
   is the whole point: the sets declare a question, never an answer. */
function ruleHolds(k, rule) {
  if (rule === 'borders:any') return borders(k).length > 0
  if (rule.startsWith('borders:')) return rule.slice(8).split('|').some((c) => borders(k).includes(c))
  if (rule.startsWith('touches:')) return touches(k, rule.slice(8))
  throw new Error(`unknown rule "${rule}" — the vocabulary is borders:X, borders:any, borders:a|b, touches:X`)
}

console.log('zambia-game')

test('every prototype that carries a mirror is one the sync script writes', () => {
  for (const page of PAGES) {
    assert.ok(
      syncScript.includes(`'${page}'`),
      `${page} carries inline mirrors but is not in PAGES in scripts/sync-zambia-game-mirror.mjs, so nothing ever rewrites them`,
    )
  }
  const inSync = [...syncScript.matchAll(/'(zedexams-[a-z0-9-]+\.html)'/g)].map((m) => m[1])
  for (const page of new Set(inSync)) {
    assert.ok(page in pageSource, `${page} is synced but not checked here`)
  }
})

test('the inline mirrors match the datasets byte for byte, in every prototype', () => {
  const fix = 'run `npm run sync:zambia-game` and commit the result'
  for (const page of PAGES) {
    assert.equal(
      mirrorOf('mirror-provinces', pageSource[page]),
      fs.readFileSync(path.join(DIR, 'zambia_provinces.json'), 'utf8').trim(),
      `zambia_provinces.json and the inline mirror in ${page} disagree — ${fix}`,
    )
    assert.equal(
      mirrorOf('mirror-facts', pageSource[page]),
      fs.readFileSync(path.join(DIR, 'zambia_facts.json'), 'utf8').trim(),
      `zambia_facts.json and the inline mirror in ${page} disagree — ${fix}`,
    )
  }
})

test('ten provinces, each parsing to a closed shape holding its own label anchor', () => {
  assert.deepEqual(Object.keys(provinces.provinces).sort(), [...KEYS].sort())
  assert.equal(provinces.dataset.provinceCount, 10)
  for (const k of KEYS) {
    const pts = parsePath(provinces.provinces[k].d)
    assert.ok(pts.length > 8, `${k}: only ${pts.length} points parsed out of its path`)
    assert.ok(
      inside(provinces.provinces[k].c, pts),
      `${k}: its label anchor ${provinces.provinces[k].c} falls outside its own outline, so its name would print on a neighbour`,
    )
  }
})

test('Muchinga is present and dated 2011', () => {
  const mu = provinces.provinces.mu
  assert.ok(mu, 'Muchinga is missing — that is the nine-province map, out of date since 11 October 2011')
  assert.match(mu.createdNote || '', /2011/, 'Muchinga must state when it was created; older textbooks show nine provinces')
  assert.match(provinces.dataset.currentSince, /^2011-/)
})

test("Southern Province's capital is Choma, and Livingstone is only ever the wrong answer", () => {
  const southern = facts.capitals.find((c) => c.province === 'so')
  assert.ok(southern, 'no capital recorded for Southern Province')
  assert.equal(southern.town, 'Choma', 'Southern Province’s capital moved to Choma in 2011')
  assert.match(southern.fact, /2011/)
  assert.equal(
    facts.capitals.filter((c) => c.town === 'Livingstone').length, 0,
    'Livingstone is not a provincial capital — it was the national capital until 1935',
  )
  assert.equal(facts.capitalsQuestion.answer, 'Choma')
  assert.ok(facts.capitalsQuestion.options.includes('Livingstone'), 'the common wrong answer must be offered, and corrected')
})

test('every province has a capital, a fact and a positional hint', () => {
  for (const k of KEYS) {
    assert.ok(facts.capitals.some((c) => c.province === k), `no capital for ${k}`)
    assert.ok((facts.provinces[k] || {}).fact, `no fact for ${k}`)
    assert.ok((facts.provinces[k] || {}).hint, `no positional hint for ${k} — a wrong placement would have nothing to say`)
  }
  assert.equal(facts.capitals.length, 10)
})

test('level 1 starts with three provinces and grows to five, then ten', () => {
  const waves = [...html.matchAll(/\{t:'place',kick:'[^']*',items:\[([^\]]*)\]/g)]
    .map((m) => m[1].split(',').map((s) => s.replace(/'/g, '').trim()))
  assert.equal(waves.length, 3, 'level 1 must be three rounds')
  const sizes = waves.map((w) => w.length)
  const cumulative = sizes.map(((sum) => (n) => (sum += n))(0))
  assert.deepEqual(cumulative, [3, 5, 10], `rounds place ${sizes.join('+')} — the rule is 3 on the map, then 5, then all 10`)
  assert.deepEqual([...waves.flat()].sort(), [...KEYS].sort(), 'the three rounds must cover all ten provinces exactly once')
})

test('every hint after round 1 names a province already on the map', () => {
  const waves = [...html.matchAll(/\{t:'place',kick:'[^']*',items:\[([^\]]*)\]/g)]
    .map((m) => m[1].split(',').map((s) => s.replace(/'/g, '').trim()))
  let placed = []
  waves.forEach((wave, i) => {
    for (const k of wave) {
      const hint = facts.provinces[k].hint
      if (i === 0) {
        assert.match(hint, /north|south|east|west|top|bottom|middle|centre|corner/i,
          `${k}: round 1 has nothing on the map yet, so its hint must give a direction`)
      } else {
        assert.ok(
          placed.some((p) => hint.includes(provinces.provinces[p].n)),
          `${k}: "${hint}" names none of the provinces already placed (${placed.join(', ')}) — a hint that points at nothing is a red cross with more words`,
        )
      }
    }
    placed = placed.concat(wave)
  })
})

test('every district resolves to one of the ten provinces, and the list is dated', () => {
  assert.ok(facts.districts.length >= 10)
  for (const d of facts.districts) {
    assert.ok(KEYS.includes(d.province), `${d.district} is filed under "${d.province}", which is not a province`)
    assert.ok(typeof d.lon === 'number' && typeof d.lat === 'number', `${d.district} has no coordinates`)
  }
  assert.ok(facts.dataset.districtCount.asOf, 'the district count must carry the date it was true')
  assert.match(facts.dataset.districtCount.note, /change/i, 'district counts change; the dataset must say so')
})

test('every tappable thing carries a hint', () => {
  const missing = []
  for (const r of facts.water.rivers) if (!r.hint || !KEYS.includes(r.answer)) missing.push(r.name)
  for (const l of facts.water.lakes) if (!l.hint) missing.push(l.name)
  for (const h of facts.heritage) if (!h.hint || !KEYS.includes(h.province)) missing.push(h.name)
  for (const p of facts.parks) if (!p.hint || !p.provinces.every((k) => KEYS.includes(k))) missing.push(p.name)
  for (const n of facts.neighbours) if (!n.hint) missing.push(n.name)
  for (const c of facts.ceremonies) if (!c.hint || !KEYS.includes(c.province)) missing.push(c.name)
  assert.deepEqual(missing, [], `no positional hint (or a bad province code) for: ${missing.join(', ')}`)
})

test('the eight neighbours are all eight, and each has a zone to be placed in', () => {
  assert.equal(facts.neighbours.length, 8, 'Zambia borders eight countries')
  const names = facts.neighbours.map((n) => n.name).sort()
  assert.deepEqual(names, ['Angola', 'Botswana', 'DR Congo', 'Malawi', 'Mozambique', 'Namibia', 'Tanzania', 'Zimbabwe'])
  for (const n of facts.neighbours) {
    assert.equal(n.zone.length, 4, `${n.name} has no drop zone`)
    assert.ok(n.zone[2] > 12 && n.zone[3] > 12, `${n.name}'s drop zone is too small to tap`)
  }
})

test('the projection lands its own calibration points inside the right province', () => {
  for (const c of provinces.projection.checkPoints) {
    const got = whichProvince(project(c.lon, c.lat))
    assert.equal(got, c.expect, `${c.name} (${c.why}) projects into ${got || 'nothing'}, not ${c.expect}`)
  }
})

test('every pin is within the trace’s stated accuracy of the province it belongs to', () => {
  const tolerance = 2.5 // map units ≈ 30 km, the hand trace's stated resolution
  const pins = [
    ...facts.capitals.map((c) => ({ label: c.town, lon: c.lon, lat: c.lat, p: c.province })),
    ...facts.districts.map((d) => ({ label: d.district, lon: d.lon, lat: d.lat, p: d.province })),
    ...facts.heritage.map((h) => ({ label: h.name, lon: h.lon, lat: h.lat, p: h.province })),
  ]
  const far = []
  for (const pin of pins) {
    const xy = project(pin.lon, pin.lat)
    if (whichProvince(xy) === pin.p) continue
    const pts = parsePath(provinces.provinces[pin.p].d)
    let d = Infinity
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j]
      const [bx, by] = pts[i]
      const dx = bx - ax
      const dy = by - ay
      const l = dx * dx + dy * dy
      const t = l ? Math.max(0, Math.min(1, ((xy[0] - ax) * dx + (xy[1] - ay) * dy) / l)) : 0
      d = Math.min(d, Math.hypot(ax + t * dx - xy[0], ay + t * dy - xy[1]))
    }
    if (d > tolerance) far.push(`${pin.label} → ${pin.p} (${d.toFixed(1)} units out)`)
  }
  assert.deepEqual(far, [], `pins that land in the wrong province by more than the trace can explain: ${far.join(', ')}`)
})

test('both datasets say out loud that they have not been verified', () => {
  for (const [name, d] of [['zambia_provinces.json', provinces.dataset], ['zambia_facts.json', facts.dataset]]) {
    assert.ok(d.verification, `${name} has no verification block`)
    assert.ok('checkedBy' in d.verification && 'checkedOn' in d.verification,
      `${name} must carry the fields a reviewer signs off in`)
    if (d.verification.status === 'UNVERIFIED') {
      assert.ok(d.verification.requiredBeforeRelease.length > 0,
        `${name} is unverified but does not say what would verify it`)
    } else {
      assert.ok(d.verification.checkedBy && d.verification.checkedOn && d.verification.checkedAgainst,
        `${name} claims to be verified but does not say who checked it, when, or against what`)
    }
  }
})

test('every prototype reads the datasets rather than a copy pasted into the code', () => {
  for (const page of PAGES) {
    const src = pageSource[page]
    assert.match(src, /fetch\(/, `${page} must fetch the datasets when it is served`)
    assert.match(src, /zambia_provinces\.json/)
    assert.match(src, /zambia_facts\.json/)
    /* The failure this catches is a real one: the first draft of the map-modes
       page pasted all ten province paths into a `const P = {nw: {d: "M…"}}`
       literal. It renders identically and drifts the moment the trace changes. */
    const scriptOnly = src.split('<script type="application/json"')[0] + src.split('</script>').pop()
    assert.ok(
      !/(?:const|var|let)\s+\w+\s*=\s*\{\s*nw\s*:\s*\{[^}]*\bd\s*:\s*["']M/.test(scriptOnly),
      `${page}: province paths are pasted into the script — they belong in the dataset`,
    )
  }
})

/* ---------------------------------------------------------------------------
   The map modes (docs/learner/zedexams-zambia-map-modes.html). Everything below
   guards a lesson rather than a pixel: each of these can be wrong while the
   game still plays perfectly.
   ------------------------------------------------------------------------- */

test('the adjacency graph is symmetric and complete', () => {
  const edges = provinces.adjacency.edges
  assert.deepEqual(Object.keys(edges).sort(), [...KEYS].sort(), 'every province needs an entry, even a short one')
  for (const [a, list] of Object.entries(edges)) {
    assert.ok(list.length > 0, `${a} borders nothing, which is true of no province in Zambia`)
    for (const b of list) {
      assert.ok(KEYS.includes(b), `${a} claims to border "${b}", which is not a province`)
      assert.notEqual(a, b, `${a} borders itself`)
      assert.ok(edges[b].includes(a), `${a} borders ${b} but ${b} does not border ${a} — adjacency is symmetric`)
    }
    assert.equal(new Set(list).size, list.length, `${a} lists a neighbour twice`)
  }
})

test('every declared border is one the traced outlines actually share', () => {
  const edges = provinces.adjacency.edges
  const thin = []
  for (const [a, list] of Object.entries(edges)) {
    for (const b of list) {
      if (a >= b) continue
      const shared = sharedBoundary(a, b)
      if (shared === 0) {
        thin.push(`${a}–${b} share NO boundary in the trace`)
      } else if (shared < 3) {
        thin.push(`${a}–${b} share only ${shared} outline points`)
      }
    }
  }
  assert.deepEqual(thin, [], `declared neighbours the trace cannot support: ${thin.join(', ')}`)
})

test('Copperbelt and Luapula are not neighbours — the Congo Pedicle is between them', () => {
  /* This is the adjacency fact most likely to be "fixed" by someone who knows
     the two provinces are both in the north and assumes they must touch. They
     do not: the DRC's Pedicle reaches down between them, which is why the road
     from the Copperbelt to Mansa either crosses another country or goes the
     long way round through Central. */
  assert.ok(!touches('cb', 'lp'), 'Copperbelt and Luapula do not share a border')
  assert.ok(!touches('lp', 'cb'))
  assert.ok(sharedBoundary('cb', 'lp') < 3, 'and the trace agrees — they share no meaningful boundary')
  assert.match(provinces.adjacency.note, /Pedicle/i, 'the dataset must say why, or someone will add the edge back')
})

test('Central borders eight of the nine, and Northern is the one it misses', () => {
  /* Two odd-one-out sets and three of the four journeys route through Central.
     If this changes, those questions change meaning without changing text. */
  const ce = provinces.adjacency.edges.ce
  assert.equal(ce.length, 8, `Central borders ${ce.length} provinces, not 8`)
  assert.ok(!ce.includes('no'), 'Northern is the one province Central does not reach')
  assert.ok(!touches('ce', 'ce'))
})

test('every province records which countries it borders, using real country codes', () => {
  const codes = facts.neighbours.map((n) => n.code)
  for (const k of KEYS) {
    const list = borders(k)
    for (const c of list) {
      assert.ok(codes.includes(c), `${k} claims to border "${c}", which is not one of the eight neighbours`)
    }
    assert.equal(new Set(list).size, list.length, `${k} lists a country twice`)
  }
  assert.deepEqual(borders('ce'), [], 'Central is the only province touching no other country — and it must say so with an empty list, not a missing field')
  const landlocked = KEYS.filter((k) => borders(k).length === 0)
  assert.deepEqual(landlocked, ['ce'], `provinces recorded as touching no country: ${landlocked.join(', ')}`)
  const drc = KEYS.filter((k) => borders(k).includes('cd')).sort()
  assert.deepEqual(drc, ['cb', 'lp', 'no', 'nw'], 'four provinces meet the DRC — an odd-one-out set about it has to leave one of the four out')
  /* Every neighbour must be reachable from some province, or the two datasets
     disagree about whether a country touches Zambia at all. */
  for (const n of facts.neighbours) {
    assert.ok(KEYS.some((k) => borders(k).includes(n.code)), `${n.name} borders Zambia but no province records it`)
  }
})

test('every journey is a road that exists on the map', () => {
  assert.ok(facts.journeys.length >= 4, 'the brief asks for more routes than the one')
  const ids = new Set()
  for (const r of facts.journeys) {
    assert.ok(!ids.has(r.id), `duplicate journey id ${r.id}`)
    ids.add(r.id)
    assert.ok(r.from && r.to && r.road, `${r.id} must name where it starts, ends and the road it takes`)
    assert.ok(r.provinces.length >= 3, `${r.id} crosses ${r.provinces.length} provinces — too short to teach adjacency`)
    assert.equal(new Set(r.provinces).size, r.provinces.length, `${r.id} passes through the same province twice`)
    for (const k of r.provinces) {
      assert.ok(KEYS.includes(k), `${r.id} routes through "${k}", which is not a province`)
      assert.ok(r.legs[k], `${r.id} has nothing to say when the learner reaches ${k} — a correct tap must teach too`)
    }
    /* The check that matters. A route through two provinces that do not touch
       plays exactly like a correct one. */
    for (let i = 0; i < r.provinces.length - 1; i += 1) {
      const [a, b] = [r.provinces[i], r.provinces[i + 1]]
      assert.ok(touches(a, b), `${r.id}: ${a} → ${b} is not a border you can cross — the route is not a road`)
    }
    assert.ok(typeof r.approxKm === 'number' && r.approxKm > 0, `${r.id} prints a distance to learners, so it must have one`)
    assert.ok(r.endNote, `${r.id} must say something about the whole journey when it is finished`)
  }
})

test("the Livingstone → Kasama route is the one the brief names, in order", () => {
  const r = facts.journeys.find((j) => j.from === 'Livingstone' && j.to === 'Kasama')
  assert.ok(r, 'the Great North Road journey is the strongest of the modes and must be present')
  assert.deepEqual(r.provinces, ['so', 'lu', 'ce', 'mu', 'no'])
  assert.ok(r.approxKm >= 1200 && r.approxKm <= 1400, `about 1,300 km, not ${r.approxKm}`)
})

test('every odd-one-out set is right by the rule it declares, not by its answer', () => {
  assert.ok(facts.oddOneOut.length >= 2)
  const ids = new Set()
  for (const o of facts.oddOneOut) {
    assert.ok(!ids.has(o.id), `duplicate odd-one-out id ${o.id}`)
    ids.add(o.id)
    assert.equal(o.set.length, 4, `${o.id} lights ${o.set.length} provinces — the question is one of four`)
    assert.equal(new Set(o.set).size, 4, `${o.id} lights the same province twice`)
    for (const k of o.set) assert.ok(KEYS.includes(k), `${o.id} lights "${k}", which is not a province`)
    assert.ok(o.set.includes(o.odd), `${o.id}: the odd one out is not one of the four lit`)
    assert.ok(o.q && o.why, `${o.id} must ask a question and explain the answer`)

    const hold = o.set.filter((k) => ruleHolds(k, o.rule))
    const dont = o.set.filter((k) => !ruleHolds(k, o.rule))
    assert.equal(hold.length, 3, `${o.id} (${o.rule}): ${hold.length} of the four satisfy the rule, not 3 — "three of these" is a claim about the data`)
    assert.deepEqual(dont, [o.odd], `${o.id} (${o.rule}): the province that does not satisfy the rule is ${dont.join(', ') || 'none'}, but ${o.odd} is declared odd`)
  }
})

test('the map modes page ignores taps on the provinces it dimmed', () => {
  /* The acceptance criterion is that a dimmed province cannot be tapped. It is
     kept by leaving them out of the markup — no data-hit, no tabindex, no touch
     halo — rather than by filtering in the handler, so a Tab key and a screen
     reader agree with the picture. Both halves are asserted because the second
     is the one a refactor drops. */
  assert.match(modesHtml, /o\.tappable\.indexOf\(k\)\s*>=\s*0/, 'the province renderer must take a tappable whitelist')
  assert.match(modesHtml, /tappable:\s*it\.set/, 'odd-one-out must pass its four lit provinces as that whitelist')
  assert.match(
    modesHtml,
    /PKEYS\.filter\(function\(k\)\{return !o\.tappable\|\|o\.tappable\.indexOf\(k\)>=0;\}\)/,
    'the touch halos must honour the same whitelist, or a dimmed province stays tappable through its halo',
  )
  assert.match(modesHtml, /if\(it\.set\.indexOf\(k\)<0\)return;/, 'and the handler refuses one anyway')
})

test('the map modes page has no clock in it', () => {
  /* "No timer" is a rule for every mode in both prototypes. setTimeout is the
     easy way to reintroduce one, and a flash that hides feedback after 600ms is
     a timer whatever it is called. */
  const script = modesHtml.split('<script>').pop()
  for (const banned of ['setInterval(', 'setTimeout(', 'requestAnimationFrame(', 'Date.now(']) {
    assert.ok(!script.includes(banned), `${banned} appears in the map modes page — no mode may be timed, and nothing may take feedback away on its own`)
  }
})

test('the map modes page reaches the modes through one menu', () => {
  for (const id of ['capital', 'journey', 'odd', 'neighbours', 'ceremony']) {
    assert.ok(modesHtml.includes(`id:'${id}'`), `mode ${id} is missing`)
  }
  assert.match(modesHtml, /function renderMenu\(\)/, 'the five modes must be reachable from one menu')
})

test('the app\'s generated copy matches the datasets', () => {
  // src/data/zambiaGeography.js is what the Know Zambia GAME ENGINE reads —
  // src/ may not import from docs/, so the datasets are generated into the
  // app rather than copied by hand. A stale copy is the quiet failure: the
  // prototype and the shipped game would teach different geography, and both
  // would look fine.
  const generated = fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'zambiaGeography.js'), 'utf8')
  const fix = 'run `npm run sync:zambia-game` and commit the result'
  assert.match(generated, /GENERATED — do not edit/, 'the generated module lost its provenance header')
  for (const [name, exported] of [
    ['zambia_provinces.json', 'ZAMBIA_PROVINCES_GEO'],
    ['zambia_facts.json', 'ZAMBIA_FACTS'],
    ['zambia_physical.json', 'ZAMBIA_PHYSICAL'],
  ]) {
    const source = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
    const block = generated.match(new RegExp(`export const ${exported} = Object\\.freeze\\(([\\s\\S]*?)\\)\\n`))
    assert.ok(block, `${exported} is missing from the generated module — ${fix}`)
    assert.deepEqual(JSON.parse(block[1]), source, `${name} and its generated copy disagree — ${fix}`)
  }
})

if (failures > 0) {
  console.error(`\nzambia-game — ${failures} failed`)
  process.exit(1)
}
console.log('zambia-game — all passed')
