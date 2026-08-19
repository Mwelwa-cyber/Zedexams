/**
 * test:zambia-game — the Know Zambia prototype's data, checked where a browser
 * cannot check it.
 *
 * docs/learner/zedexams-zambia-game.html renders entirely from two datasets and
 * runs its own acceptance rules on screen. Three classes of failure survive
 * that, and all three are silent:
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
 * Geometry here is deliberately re-implemented rather than imported: the point
 * is to check the shipped data with something other than the code that draws it.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'docs', 'learner')
const HTML_PATH = path.join(DIR, 'zedexams-zambia-game.html')
const html = fs.readFileSync(HTML_PATH, 'utf8')
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
function mirrorOf(id) {
  const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))
  assert.ok(m, `no <script id="${id}"> mirror block in the prototype`)
  return m[1]
}

console.log('zambia-game')

test('the inline mirrors match the datasets byte for byte', () => {
  const fix = 'run `npm run sync:zambia-game` and commit the result'
  assert.equal(
    mirrorOf('mirror-provinces'),
    fs.readFileSync(path.join(DIR, 'zambia_provinces.json'), 'utf8').trim(),
    `zambia_provinces.json and the inline mirror disagree — ${fix}`,
  )
  assert.equal(
    mirrorOf('mirror-facts'),
    fs.readFileSync(path.join(DIR, 'zambia_facts.json'), 'utf8').trim(),
    `zambia_facts.json and the inline mirror disagree — ${fix}`,
  )
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

test('the prototype reads the datasets rather than a copy pasted into the code', () => {
  assert.match(html, /fetch\(/, 'the page must fetch the datasets when it is served')
  assert.ok(!/const\s+P\s*=\s*\{\s*nw:/.test(html), 'province paths must not be pasted into the script — they belong in the dataset')
  assert.match(html, /zambia_provinces\.json/)
  assert.match(html, /zambia_facts\.json/)
})

if (failures > 0) {
  console.error(`\nzambia-game — ${failures} failed`)
  process.exit(1)
}
console.log('zambia-game — all passed')
