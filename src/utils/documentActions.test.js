/**
 * Unit tests for documentActions.js — plain-node assertion script, run via
 * `npm run test:document-actions`.
 */

import { getDocumentActions, validateDocumentTitle } from './documentActions.js'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`  ✓ ${name}`)
}

const CLIENT_TOOLS = ['mark_schedule', 'weekly_forecast', 'record_of_work']

{
  const a = getDocumentActions({ kind: 'assessment', tool: 'assessment' }, { clientCreatedTools: CLIENT_TOOLS })
  check('papers: open + rename, no duplicate', a.canOpen && a.canRename && !a.canDuplicate)
  check('papers: no dashboard download or trash', !a.canDownload && !a.canTrash)
}
{
  const g = getDocumentActions({ kind: 'generation', tool: 'weekly_forecast' }, { clientCreatedTools: CLIENT_TOOLS })
  check('client-created generation: duplicate allowed, rename not', g.canDuplicate && !g.canRename)
}
{
  const ai = getDocumentActions({ kind: 'generation', tool: 'lesson_plan' }, { clientCreatedTools: CLIENT_TOOLS })
  check('AI-generated doc: open only', ai.canOpen && !ai.canRename && !ai.canDuplicate && !ai.canDownload && !ai.canTrash)
}
{
  const none = getDocumentActions({}, {})
  check('unknown doc: open only, nothing destructive', none.canOpen && !none.canRename && !none.canDuplicate && !none.canTrash)
}
{
  check('empty title rejected', validateDocumentTitle('   ') !== null)
  check('sane title accepted', validateDocumentTitle('End of Term 2 Test') === null)
  check('over-long title rejected', validateDocumentTitle('x'.repeat(141)) !== null)
}

console.log(`\ndocumentActions: ${passed} checks passed`)
