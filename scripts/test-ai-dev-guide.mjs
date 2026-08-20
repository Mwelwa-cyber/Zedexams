// Guards the AI development guide (AI_DEVELOPMENT_GUIDE.md):
//  1. the file exists,
//  2. it keeps the sections other tooling and humans rely on being able to cite,
//  3. CLAUDE.md still points at it (that pointer is what makes it load in every AI session).
// Plain-node test, auto-discovered by scripts/run-all-tests.mjs via the test:ai-dev-guide script.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function assert(cond, message) {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

let guide;
try {
  guide = readFileSync(join(root, 'AI_DEVELOPMENT_GUIDE.md'), 'utf8');
} catch {
  assert(false, 'AI_DEVELOPMENT_GUIDE.md is missing from the repo root');
}

const requiredSections = [
  'Definition of Ready',
  'Definition of Done',
  'Coding standards',
  'Schema rules',
  'Test rules',
  'Firebase & Cloud Functions rules',
  'Git & deploy discipline',
  'Documentation rules',
];
for (const section of requiredSections) {
  assert(guide.includes(section), `AI_DEVELOPMENT_GUIDE.md lost its "${section}" section`);
}

// Load-bearing rules that must not be silently edited away.
const loadBearing = [
  'regression test',            // every bug fix ships one
  'Never edit `test:all`',      // run-all-tests.mjs auto-discovery
  'africa-south1',              // Firestore trigger region pinning
  'firestore:indexes',          // indexes deploy before querying code
  'rather than recalled',       // §0: read the source, don't build on memory
  'reproduced before it is fixed', // §0: no fixing a failure you haven't seen
  'Assumptions are stated',     // §0: an unverified fact is never carried silently
];
for (const phrase of loadBearing) {
  assert(guide.includes(phrase), `AI_DEVELOPMENT_GUIDE.md lost the load-bearing rule mentioning "${phrase}"`);
}

const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
assert(
  claudeMd.includes('AI_DEVELOPMENT_GUIDE.md'),
  'CLAUDE.md no longer references AI_DEVELOPMENT_GUIDE.md — the guide will stop loading in AI sessions'
);

console.log('ok: AI development guide present, sections intact, referenced from CLAUDE.md');
