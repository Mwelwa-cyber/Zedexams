/**
 * Validate the visual fixture set. Run before anything renders (§4.6).
 *
 * A fixture whose subject was deleted renders perfectly consistently, so it must
 * fail HERE rather than pass quietly for months. See fixtures.js.
 *
 *   node scripts/visual/validateFixtures.mjs
 *   node scripts/visual/validateFixtures.mjs --fixture=vr-003
 */

import { VISUAL_FIXTURES, fixtureById, validateFixture, validateAllFixtures } from './fixtures.js'

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : ''
}

const only = arg('fixture')

if (only) {
  const fixture = fixtureById(only)
  if (!fixture) {
    console.error(`✗ no fixture "${only}" — known IDs: ${VISUAL_FIXTURES.map((f) => f.id).join(', ')}`)
    process.exit(1)
  }
  const problems = validateFixture(fixture)
  if (problems.length) {
    console.error(`✗ ${fixture.id} (${fixture.title})`)
    for (const p of problems) console.error(`    ${p}`)
    process.exit(1)
  }
  console.log(`✓ ${fixture.id} (${fixture.title}) — protects: ${fixture.protects.join(', ')}`)
  process.exit(0)
}

const failures = validateAllFixtures()
const ids = Object.keys(failures)
if (ids.length) {
  console.error('✗ the fixture set is not valid:\n')
  for (const id of ids) {
    console.error(`  ${id}`)
    for (const p of failures[id]) console.error(`      ${p}`)
  }
  console.error(
    '\nA fixture that no longer contains its subject would render consistently'
    + '\nand report green while testing nothing. Fix the fixture, do not skip it.',
  )
  process.exit(1)
}
console.log(`✓ ${VISUAL_FIXTURES.length} visual fixtures valid`)
for (const f of VISUAL_FIXTURES) {
  console.log(`    ${f.id}  ${f.title} — ${f.targets.join(', ')}`)
}
