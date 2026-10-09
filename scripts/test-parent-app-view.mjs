// scripts/test-parent-app-view.mjs
//
// Pure-logic test for the one parent-app presentation helper still in use
// (src/features/parentPortal/lib/parentAppView.js). Run with
// `npm run test:parent-app-view`.
//
// A gate id this build does not know must not reach a sentence as
// "PAPER_CONTINUE" or a raw id: the server's allow-list can grow ahead of the
// client.

import assert from 'node:assert/strict'
import { describeFeature } from '../src/features/parentPortal/lib/parentAppView.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; void name }

t('a gate id this build does not know never reaches the sentence', () => {
  // The server's allow-list can grow ahead of the client. A parent must
  // not be shown "Wants NEW_GATE_ID".
  assert.equal(describeFeature('PAPER_CONTINUE'), 'to finish a past paper')
  assert.equal(describeFeature('SOMETHING_NEW'), 'more of ZedExams')
  assert.equal(describeFeature(undefined), 'more of ZedExams')
  assert.doesNotMatch(describeFeature('SOMETHING_NEW'), /SOMETHING_NEW/)
})

console.log(`parent app view helpers — ${passed} total assertions passed`)
