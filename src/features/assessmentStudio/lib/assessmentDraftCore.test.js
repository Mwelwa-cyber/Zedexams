/**
 * Tests for the firebase-free Assessment Studio draft core: runtime-field
 * stripping, staleness/empty validation, and the last-write-wins merge used
 * by the cross-device (localStorage + Firestore) draft sync.
 *
 * Run: node src/hooks/assessmentDraftCore.test.js
 */

import {
  DRAFT_TTL,
  buildDraftPayload,
  isLiveDraft,
  pickFreshestDraft,
  stripSectionsRuntime,
} from './assessmentDraftCore.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('stripSectionsRuntime — drops runtime-only fields')
{
  const sections = [{
    kind: 'standalone',
    question: {
      text: 'Q', imageUrl: 'blob:abc', imageUploading: true, imageUploadStep: 'x',
      imageAssetId: 'asset1',
      optionMedia: [{ imageUrl: 'blob:opt', imageAssetId: 'a', alt: 'A' }, null],
    },
  }]
  const [s] = stripSectionsRuntime(sections)
  assert(s.question.imageUrl === '', 'blob: stem URL is cleared')
  assert(!('imageUploading' in s.question), 'imageUploading dropped')
  assert(!('imageAssetId' in s.question), 'imageAssetId dropped')
  assert(!('imageUrl' in s.question.optionMedia[0]), 'blob: option image URL dropped')
  assert(s.question.optionMedia[0].alt === 'A', 'option alt preserved')
}

console.log('\nbuildDraftPayload — stamps savedAt + keeps view')
{
  const p = buildDraftPayload({ form: { title: 'T' }, sections: [{ question: {} }], parts: [], view: 'builder' })
  assert(typeof p.savedAt === 'number', 'savedAt stamped')
  assert(p.view === 'builder', 'view carried so it can be restored')
}

console.log('\nisLiveDraft — staleness + non-empty checks')
{
  assert(isLiveDraft({ savedAt: Date.now(), sections: [{}] }) === true, 'fresh non-empty draft is live')
  assert(isLiveDraft({ savedAt: Date.now() - DRAFT_TTL - 1000, sections: [{}] }) === false, 'expired draft rejected')
  assert(isLiveDraft({ savedAt: Date.now(), sections: [] }) === false, 'empty draft rejected')
  assert(isLiveDraft(null) === false, 'null rejected')
}

console.log('\npickFreshestDraft — last-write-wins')
{
  const local = { savedAt: 100, sections: [{}] }
  const remote = { savedAt: 200, sections: [{}] }
  assert(pickFreshestDraft(local, remote).source === 'remote', 'newer remote wins (edited on another device)')
  assert(pickFreshestDraft(remote, local).source === 'local', 'newer local wins')
  assert(pickFreshestDraft(local, null).source === 'local', 'local-only returns local')
  assert(pickFreshestDraft(null, remote).source === 'remote', 'remote-only returns remote')
  assert(pickFreshestDraft(null, null).draft === null, 'nothing returns null draft')
  // Tie favours local (no needless cross-device toast when timestamps match).
  assert(pickFreshestDraft({ savedAt: 100, sections: [{}] }, { savedAt: 100, sections: [{}] }).source === 'local',
    'equal timestamps keep the local copy')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentDraftCore tests passed.')
