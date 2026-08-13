// Node test for the diagram-brief → picture-bank matcher.
// Run: node src/utils/diagramMatch.test.js

import assert from 'node:assert'
import { briefTokens, rankPicturesForBrief } from './diagramMatch.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('diagramMatch')

// ── briefTokens ──────────────────────────────────────────────────────────
{
  const tokens = briefTokens('A labelled diagram of the human ear showing the eardrum marked X.')
  assert.ok(tokens.includes('human') && tokens.includes('ear') && tokens.includes('eardrum'))
  assert.ok(!tokens.includes('labelled') && !tokens.includes('diagram') && !tokens.includes('the'))
  assert.ok(!tokens.includes('x'), 'label letters are noise')
  ok('briefTokens keeps content words and drops boilerplate', true)
}

// ── rankPicturesForBrief ─────────────────────────────────────────────────
const BANK = [
  { id: 'ear', name: 'Human ear, labelled', nameLower: 'human ear, labelled', keywords: ['ear', 'hearing', 'senses'] },
  { id: 'coa', name: 'Zambian Coat of Arms', nameLower: 'zambian coat of arms', keywords: ['coat of arms', 'national symbols'] },
  { id: 'venn', name: 'Venn diagram template', nameLower: 'venn diagram template', keywords: ['sets', 'venn'] },
  { id: 'skin', name: 'Skin cross-section', nameLower: 'skin cross-section', keywords: ['skin', 'epidermis', 'dermis'] },
]

{
  const hits = rankPicturesForBrief(BANK, 'A labelled human ear with the eardrum marked X')
  assert.ok(hits.length >= 1)
  assert.strictEqual(hits[0].id, 'ear')
  ok('ear brief ranks the ear picture first', true)

  const coa = rankPicturesForBrief(BANK, 'The Coat of Arms with parts marked a to e')
  assert.strictEqual(coa[0]?.id, 'coa')
  ok('coat-of-arms brief finds the coat of arms', true)

  const none = rankPicturesForBrief(BANK, 'A bar chart of rainfall in Lusaka')
  assert.strictEqual(none.length, 0)
  ok('unrelated brief returns no matches (generate instead)', true)

  assert.deepStrictEqual(rankPicturesForBrief(BANK, ''), [])
  assert.deepStrictEqual(rankPicturesForBrief(null, 'ear'), [])
  ok('empty/garbage inputs degrade to no matches', true)

  const limited = rankPicturesForBrief(BANK, 'venn sets ear skin epidermis hearing', { limit: 2 })
  assert.ok(limited.length <= 2)
  ok('limit caps the result count', true)
}

console.log(`diagramMatch: ${passed} checks passed`)
