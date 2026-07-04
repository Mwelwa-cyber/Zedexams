/**
 * Unit tests for schemeFormat — the CBC-vs-OBC column source of truth.
 * Run: node src/utils/schemeFormat.test.js
 */

import {
  SCHEME_CURRICULA,
  normalizeCurriculum,
  schemeCurriculum,
  curriculumLabel,
  templateLabel,
  schemeColumns,
  isOutcomeBased,
  forecastColumns,
  forecastCurriculum,
  cleanCellText,
  cleanCellList,
} from './schemeFormat.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('normalizeCurriculum')
{
  assert(normalizeCurriculum('previous') === 'obc', "'previous' → obc")
  assert(normalizeCurriculum('2013') === 'obc', "'2013' → obc")
  assert(normalizeCurriculum('OBC') === 'obc', "'OBC' → obc (case-insensitive)")
  assert(normalizeCurriculum('outcome-based') === 'obc', "'outcome-based' → obc")
  assert(normalizeCurriculum('cbc') === 'cbc', "'cbc' → cbc")
  assert(normalizeCurriculum(undefined) === 'cbc', 'undefined → cbc (legacy default)')
  assert(normalizeCurriculum('') === 'cbc', "'' → cbc")
  assert(SCHEME_CURRICULA.length === 2, 'two curricula')
}

console.log('schemeCurriculum — resolves from a scheme')
{
  assert(schemeCurriculum({ header: { curriculum: 'obc' } }) === 'obc', 'reads header.curriculum')
  assert(schemeCurriculum({ header: { framework: '2013' } }) === 'obc', 'falls back to header.framework')
  assert(schemeCurriculum({ header: {} }) === 'cbc', 'defaults to cbc when absent')
  assert(schemeCurriculum(null) === 'cbc', 'null → cbc')
}

console.log('schemeColumns — CBC is 9 columns')
{
  const cols = schemeColumns('cbc')
  assert(cols.length === 9, 'CBC has 9 columns')
  const labels = cols.map((c) => c.label)
  assert(labels.includes('SPECIFIC COMPETENCES'), 'CBC labels Specific Competences')
  assert(labels.includes('LEARNING ACTIVITIES'), 'CBC keeps Learning Activities')
  assert(labels.includes('EXPECTED STANDARD'), 'CBC keeps Expected Standard')
  const total = cols.reduce((s, c) => s + c.width, 0)
  assert(total >= 95 && total <= 105, `CBC widths sum ~100 (${total})`)
}

console.log('schemeColumns — OBC is 7 columns, no activities/standard')
{
  const cols = schemeColumns('obc')
  assert(cols.length === 7, 'OBC has 7 columns')
  const labels = cols.map((c) => c.label)
  assert(labels.includes('SPECIFIC OUTCOMES'), 'OBC labels Specific Outcomes')
  assert(!labels.includes('SPECIFIC COMPETENCES'), 'OBC drops the Competences label')
  assert(!labels.includes('LEARNING ACTIVITIES'), 'OBC drops Learning Activities')
  assert(!labels.includes('EXPECTED STANDARD'), 'OBC drops Expected Standard')
  // Storage key stays specificCompetences even though labelled Outcomes.
  const outcomes = cols.find((c) => c.label === 'SPECIFIC OUTCOMES')
  assert(outcomes.key === 'specificCompetences', 'OBC outcomes reuse the specificCompetences key')
  const total = cols.reduce((s, c) => s + c.width, 0)
  assert(total >= 95 && total <= 105, `OBC widths sum ~100 (${total})`)
}

console.log('schemeColumns returns fresh copies (no shared mutation)')
{
  const a = schemeColumns('cbc')
  a[0].width = 999
  const b = schemeColumns('cbc')
  assert(b[0].width !== 999, 'mutating one call does not leak into the next')
}

console.log('labels + isOutcomeBased')
{
  assert(curriculumLabel('obc') === 'OBC', 'curriculumLabel obc')
  assert(curriculumLabel('cbc') === 'CBC', 'curriculumLabel cbc')
  assert(templateLabel('obc') === 'OBC Scheme', 'templateLabel obc')
  assert(templateLabel('cbc') === 'CBC Scheme', 'templateLabel cbc')
  assert(isOutcomeBased('previous') === true, 'isOutcomeBased previous')
  assert(isOutcomeBased('cbc') === false, 'isOutcomeBased cbc')
}

console.log('forecastColumns — CBC vs OBC')
{
  const cbc = forecastColumns('cbc')
  const obc = forecastColumns('obc')
  assert(cbc.some((c) => c.label === 'LEARNING ACTIVITY'), 'CBC forecast keeps Learning Activity')
  assert(cbc.some((c) => c.label === 'EXPECTED STANDARD'), 'CBC forecast keeps Expected Standard')
  assert(cbc.some((c) => c.label === 'SPECIFIC COMPETENCE'), 'CBC forecast labels Specific Competence')
  assert(!obc.some((c) => c.label === 'LEARNING ACTIVITY'), 'OBC forecast drops Learning Activity')
  assert(!obc.some((c) => c.label === 'EXPECTED STANDARD'), 'OBC forecast drops Expected Standard')
  assert(obc.some((c) => c.label === 'SPECIFIC OUTCOME'), 'OBC forecast labels Specific Outcome')
  assert(forecastCurriculum({ header: { curriculum: 'obc' } }) === 'obc', 'forecastCurriculum reads header')
}

console.log('cleanCellText — strips filler, keeps real values')
{
  assert(cleanCellText("I don't know") === '', "\"I don't know\" → ''")
  assert(cleanCellText('I do not know') === '', "'I do not know' → ''")
  assert(cleanCellText('  I DON’T KNOW ') === '', 'uppercase + curly apostrophe filler → \'\'')
  assert(cleanCellText('N/A') === '', "'N/A' → ''")
  assert(cleanCellText('n / a') === '', "'n / a' → ''")
  assert(cleanCellText('unknown') === '', "'unknown' → ''")
  assert(cleanCellText('TBD') === '', "'TBD' → ''")
  assert(cleanCellText('to be decided') === '', "'to be decided' → ''")
  assert(cleanCellText(null) === '', 'null → \'\'')
  assert(cleanCellText(undefined) === '', 'undefined → \'\'')
  assert(cleanCellText('  4.1 THE HUMAN BODY  ') === '4.1 THE HUMAN BODY', 'real value trimmed + kept')
  assert(cleanCellText('Describe the structure of the heart.') === 'Describe the structure of the heart.', 'real sentence kept')
  // Must not over-match: real content that merely contains the words stays.
  assert(cleanCellText('State what pupils know about the heart') === 'State what pupils know about the heart', 'does not strip content containing "know"')
}

console.log('cleanCellList — drops filler + empties, keeps order')
{
  const out = cleanCellList(['Exposition', "I don't know", '', 'Q & A', 'N/A', 'Discussion'])
  assert(out.length === 3, 'three real items remain')
  assert(out[0] === 'Exposition' && out[1] === 'Q & A' && out[2] === 'Discussion', 'order preserved')
  assert(cleanCellList(null).length === 0, 'null → []')
  assert(cleanCellList('single real').length === 1, 'string coerced to one-item list')
  assert(cleanCellList("I don't know").length === 0, 'filler string → []')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll schemeFormat tests passed')
