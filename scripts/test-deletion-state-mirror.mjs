#!/usr/bin/env node
// scripts/test-deletion-state-mirror.mjs
//
// The deletion states exist in two places — the server's state machine
// (`functions/deletionFlow/deletionRequestCore.js`) and the client's copy
// (`src/services/accountDeletion/deletionRequestService.js`) — and the client's
// exists because a React component has to switch on a state to know what to
// draw.
//
// Two copies of a vocabulary drift, and this one drifts silently in the worst
// direction: a state the server sends and the client does not know renders
// NOTHING. Not an error, not a fallback — a blank screen, shown to a child who
// has just asked to delete their account and wants to know what happened.
//
// Text-parsed rather than imported: the server file is CommonJS inside
// `functions/` (its own package.json, its own dependency tree) and the client
// file imports `firebase/functions` at module load. Importing either from a
// plain-node script would pull half an SDK in to compare six strings.
//
// Run: npm run test:deletion-state-mirror

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SERVER = 'functions/deletionFlow/deletionRequestCore.js'
const CLIENT = 'src/services/accountDeletion/deletionRequestService.js'

/** The body of a frozen object literal, by the line that opens it. */
function blockAfter(src, marker, path) {
  const start = src.indexOf(marker)
  assert.notEqual(start, -1, `${path}: could not find ${marker} — has it been renamed?`)
  const open = src.indexOf('{', start)
  const close = src.indexOf('})', open)
  assert.ok(close > open, `${path}: could not read the ${marker} block`)
  return src.slice(open, close)
}

/** The KEY names and the string values of a frozen `KEY: "value"` literal. */
function entriesFrom(path, marker) {
  const body = blockAfter(readFileSync(path, 'utf8'), marker, path)
  const pairs = [...body.matchAll(/([A-Z_]+):\s*["']([a-z_]+)["']/g)]
  assert.ok(pairs.length > 0, `${path}: ${marker} looks empty`)
  return { keys: pairs.map((m) => m[1]), values: pairs.map((m) => m[2]).sort() }
}

const server = entriesFrom(SERVER, 'const STATE = Object.freeze(')
const client = entriesFrom(CLIENT, 'export const DELETION_STATE = Object.freeze(')
const serverStates = server.values
const clientStates = client.values

assert.deepEqual(
  clientStates,
  serverStates,
  'The client and server disagree about the deletion states.\n' +
  `  server (${SERVER}): ${serverStates.join(', ')}\n` +
  `  client (${CLIENT}): ${clientStates.join(', ')}\n` +
  'A state the server sends and the client does not know renders a BLANK SCREEN.',
)

// The terminal set matters just as much: the client uses OPEN_STATES to decide
// whether to show a banner at all, so a state that is open on the server and
// absent from that list leaves a child with a pending deletion and no sign of
// it anywhere in the app.
const serverSrc = readFileSync(SERVER, 'utf8')
const terminalBlock = serverSrc.slice(
  serverSrc.indexOf('const TERMINAL_STATES'),
  serverSrc.indexOf(']);', serverSrc.indexOf('const TERMINAL_STATES')),
)
const terminalKeys = [...terminalBlock.matchAll(/STATE\.([A-Z_]+)/g)].map((m) => m[1])
// Derived from the STATE block's own keys, NOT from a scan of the whole file —
// `REQUESTED_BY` next door uses the same shape, and picking its keys up here
// would make this check fail on a vocabulary that has nothing to do with it.
const serverOpen = server.keys.filter((key) => !terminalKeys.includes(key))

const clientSrc = readFileSync(CLIENT, 'utf8')
const openBlock = clientSrc.slice(
  clientSrc.indexOf('export const OPEN_STATES'),
  clientSrc.indexOf('])', clientSrc.indexOf('export const OPEN_STATES')),
)
const clientOpen = [...openBlock.matchAll(/DELETION_STATE\.([A-Z_]+)/g)].map((m) => m[1])

assert.deepEqual(
  [...clientOpen].sort(),
  [...serverOpen].sort(),
  'The client and server disagree about which deletion states are still OPEN.\n' +
  `  server non-terminal: ${serverOpen.sort().join(', ')}\n` +
  `  client OPEN_STATES:  ${clientOpen.sort().join(', ')}\n` +
  'An open state missing from the client leaves a pending deletion invisible in the app.',
)

console.log(`  ok  deletion states mirrored (${serverStates.length}): ${serverStates.join(', ')}`)
console.log(`  ok  open states mirrored (${serverOpen.length}): ${serverOpen.sort().join(', ')}`)
console.log('\n─── deletion state mirror · 2 checks · 2 passed ───')
