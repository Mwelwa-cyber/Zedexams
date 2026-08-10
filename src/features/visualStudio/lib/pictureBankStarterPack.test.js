// Node test for the picture-bank starter pack data.
// Run: node src/utils/pictureBankStarterPack.test.js

import assert from 'node:assert'
import { STARTER_PACK, STARTER_SUBJECTS } from './pictureBankStarterPack.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('pictureBankStarterPack')

{
  ok(`pack has a useful size (${STARTER_PACK.length} ≥ 35)`, STARTER_PACK.length >= 35)

  const names = new Set()
  const subjects = new Set(STARTER_SUBJECTS)
  const providers = new Set(['recraft', 'kie', 'openai'])
  for (const item of STARTER_PACK) {
    assert.ok(item.name && item.name.length <= 120, `bad name: ${item.name}`)
    const lower = item.name.toLowerCase()
    assert.ok(!names.has(lower), `duplicate name: ${item.name}`)
    names.add(lower)
    assert.ok(item.prompt && item.prompt.length >= 30, `prompt too thin: ${item.name}`)
    assert.ok(Array.isArray(item.keywords) && item.keywords.length >= 2,
      `needs ≥2 keywords: ${item.name}`)
    assert.ok(subjects.has(item.subject), `unknown subject ${item.subject}: ${item.name}`)
    assert.ok(providers.has(item.provider), `unknown provider ${item.provider}: ${item.name}`)
  }
  ok('every item has a unique name, rich prompt, keywords, valid subject + provider', true)

  ok('the asked-for example exists ("domestic animals" search will hit)',
    STARTER_PACK.some((i) => i.keywords.includes('domestic animals')))
  ok('science figures cover the real papers (ear, skin, seedling)',
    ['Human ear, labelled', 'Skin cross-section', 'Bean seedling stages']
      .every((n) => names.has(n.toLowerCase())))
}

console.log(`pictureBankStarterPack: ${passed} checks passed`)
