/**
 * Curriculum coverage report — every curriculum × level × subject, and whether
 * ZedExams can actually generate a paper for it.
 *
 * The point is to turn missing content into a VISIBLE backlog. Grades 5–7 have
 * no CBC syllabus loaded, which without this report shows up only as a level a
 * teacher cannot pick, with nothing anywhere saying why or who should fix it.
 *
 * Three independent things must line up before a combination is usable:
 *
 *   syllabus     the catalogue carries topics for this curriculum+grade+subject
 *   generation   a paper can be grounded on it (syllabus present AND the subject
 *                is one the generator's allowlist accepts)
 *   band         the level's stage has an assessmentBands document
 *
 * A combination missing any one of them is reported with which one, so the gap
 * is attributable — a curriculum-data task, a subject-mapping task, or a config
 * task — rather than an unexplained empty picker.
 *
 *   node scripts/curriculum-coverage-report.mjs                # summary
 *   node scripts/curriculum-coverage-report.mjs --gaps         # only the gaps
 *   node scripts/curriculum-coverage-report.mjs --json         # machine-readable
 *   node scripts/curriculum-coverage-report.mjs --curriculum cbc
 *
 * Report only — reads the catalogues, writes nothing.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syllabiToKbTopics } from '../src/utils/syllabusMapping.js'
import { extract2013TopicLookup } from '../src/utils/syllabus2013Topics.js'
import { normalizeTopicLookup } from '../src/utils/syllabusTopicTree.js'
import { EDUCATION_LEVELS, levelsForFramework } from '../src/config/educationLevels.js'
import { ASSESSMENT_BAND_SEED, BAND_IDS } from '../src/config/assessmentBands.js'
import { subjectLabel } from '../src/shared/utils/paperTaxonomy.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const GAPS_ONLY = args.includes('--gaps')
const AS_JSON = args.includes('--json')
const ONLY_CURRICULUM = (() => {
  const i = args.indexOf('--curriculum')
  return i >= 0 ? String(args[i + 1] || '').toLowerCase() : ''
})()

// The generator's own subject allowlist — a subject the catalogue has but the
// generator refuses is a real gap, and a different one from missing content.
const ALLOWED_SUBJECTS = (() => {
  const src = readFileSync(path.join(ROOT, 'functions/teacherTools/assessmentAllowlists.js'), 'utf8')
  const block = src.match(/ALLOWED_SUBJECTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
  if (!block) return null
  return new Set([...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
})()

/** "GRADE|subject" → topic count, for one framework. */
function loadCoverage(framework) {
  if (framework === '2013') {
    const raw = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data-2013.json'), 'utf8'))
    const lookup = extract2013TopicLookup(raw)
    return new Map([...lookup].map(([key, inner]) => [key, inner.size]))
  }
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))
  const byKey = new Map()
  for (const t of syllabiToKbTopics(raw)) {
    const grade = String(t.grade || '').toUpperCase()
    const subject = String(t.subject || '').toLowerCase()
    const topic = String(t.topic || '').trim()
    if (!grade || !subject || !topic) continue
    const key = `${grade}|${subject}`
    if (!byKey.has(key)) byKey.set(key, new Map())
    const inner = byKey.get(key)
    if (!inner.has(topic)) inner.set(topic, new Set())
  }
  const normalized = normalizeTopicLookup(byKey)
  return new Map([...normalized].map(([key, inner]) => [key, inner.size]))
}

const CURRICULA = [
  { id: 'cbc', framework: '2023', label: 'CBC (2023)' },
  { id: 'previous', framework: '2013', label: 'Previous syllabus (2013)' },
].filter((c) => !ONLY_CURRICULUM || c.id === ONLY_CURRICULUM)

const rows = []
for (const curriculum of CURRICULA) {
  const coverage = loadCoverage(curriculum.framework)
  // Every subject the catalogue mentions ANYWHERE in this curriculum — so a
  // subject taught at other grades but missing here is reported as a gap rather
  // than silently omitted from the grid.
  const subjects = [...new Set([...coverage.keys()].map((k) => k.split('|')[1]))].sort()
  const levels = levelsForFramework(curriculum.framework)

  for (const level of levels) {
    const band = ASSESSMENT_BAND_SEED[level.band]
    for (const subject of subjects) {
      const topics = coverage.get(`${level.kbGrade}|${subject}`) || 0
      const subjectAllowed = !ALLOWED_SUBJECTS || ALLOWED_SUBJECTS.has(subject)
      const gaps = []
      if (topics === 0) gaps.push('syllabus')
      if (!subjectAllowed) gaps.push('subject-not-allowlisted')
      if (!band) gaps.push('band')
      rows.push({
        curriculum: curriculum.id,
        curriculumLabel: curriculum.label,
        level: level.label,
        levelValue: level.value,
        kbGrade: level.kbGrade,
        subject,
        subjectLabel: subjectLabel(subject),
        topics,
        syllabus: topics > 0,
        generation: topics > 0 && subjectAllowed,
        band: Boolean(band),
        bandId: level.band,
        gaps,
      })
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ rows, generatedFrom: 'public/syllabi + src/config' }, null, 2))
} else {
  console.log('Curriculum coverage — report only, nothing is modified.\n')
  for (const curriculum of CURRICULA) {
    const mine = rows.filter((r) => r.curriculum === curriculum.id)
    const ready = mine.filter((r) => r.generation && r.band)
    console.log(`══ ${curriculum.label} ══`)
    console.log(`   ${ready.length} of ${mine.length} level+subject combinations can generate a paper\n`)

    // Per level, so a wholly-missing level reads as one line rather than as one
    // line per subject.
    const byLevel = new Map()
    for (const r of mine) {
      if (!byLevel.has(r.level)) byLevel.set(r.level, [])
      byLevel.get(r.level).push(r)
    }
    for (const [level, levelRows] of byLevel) {
      const ok = levelRows.filter((r) => r.generation && r.band)
      const bandOk = levelRows.every((r) => r.band)
      if (ok.length === 0) {
        console.log(`   ✗ ${level.padEnd(12)} no syllabus content loaded${bandOk ? '' : ' AND no band configured'} — curriculum-data gap`)
        continue
      }
      if (GAPS_ONLY && ok.length === levelRows.length) continue
      console.log(`   ${ok.length === levelRows.length ? '✓' : '·'} ${level.padEnd(12)} ${ok.length}/${levelRows.length} subjects ready`)
      if (!GAPS_ONLY) continue
      for (const r of levelRows.filter((x) => !(x.generation && x.band))) {
        console.log(`       – ${r.subjectLabel.padEnd(34)} missing: ${r.gaps.join(', ')}`)
      }
    }
    console.log('')
  }

  const missingBand = EDUCATION_LEVELS.filter((l) => !ASSESSMENT_BAND_SEED[l.band])
  console.log(`Bands configured: ${BAND_IDS.length}` +
    (missingBand.length ? ` — MISSING for ${missingBand.map((l) => l.label).join(', ')}` : ' — all levels covered'))
  console.log(
    '\nA level with no syllabus content is a curriculum-data task: load the ' +
    'verified syllabus in the Syllabi Studio. Nothing here is generated from ' +
    'general knowledge.\n',
  )
}
