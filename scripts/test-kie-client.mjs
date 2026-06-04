#!/usr/bin/env node
/**
 * Regression test for the Kie.ai client's pure request/response logic.
 * Guards the bug classes that matter for the async Jobs API:
 *
 *   1. createTask body shape — model + input{prompt, aspect_ratio}, with a
 *      full `input` object overriding the convenience builder.
 *   2. createTask envelope parsing — taskId comes from data.taskId only when
 *      code === 200; anything else must throw, not silently return undefined.
 *   3. recordInfo parsing — `resultJson` is a JSON *string* holding
 *      { resultUrls: [...] }; a malformed string must NOT throw, and state
 *      must be lower-cased so the poll loop's comparisons hold.
 *
 * Pure-logic: imports the real module (it has no firebase-functions dep) and
 * makes no network calls. Run: npm run test:kie-client  (also via test:all).
 */

import assert from 'assert/strict'

import kieClient from '../functions/kieClient.js'

const {
  DEFAULT_KIE_MODEL,
  KieError,
  buildCreateTaskBody,
  parseCreateTaskResponse,
  parseTaskRecord,
  isTerminalState,
} = kieClient

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({name, err})
    console.log(`  XX  ${name} — ${err.message}`)
  }
}

console.log('\nkieClient — createTask body + envelope parsers')

// ─── buildCreateTaskBody ───────────────────────────────────────────────

test('default model is used when none is supplied', () => {
  if (!process.env.KIE_MODEL) {
    const body = buildCreateTaskBody({prompt: 'a cat'})
    assert.equal(body.model, DEFAULT_KIE_MODEL)
    assert.equal(DEFAULT_KIE_MODEL, 'nano-banana-pro')
  }
})

test('prompt + aspectRatio map into input.prompt / input.aspect_ratio', () => {
  const body = buildCreateTaskBody({prompt: '  a baobab tree  ', aspectRatio: '16:9', model: 'm'})
  assert.equal(body.model, 'm')
  assert.equal(body.input.prompt, 'a baobab tree') // trimmed
  assert.equal(body.input.aspect_ratio, '16:9')
})

test('aspect_ratio is omitted when no aspectRatio is given', () => {
  const body = buildCreateTaskBody({prompt: 'x'})
  assert.ok(!('aspect_ratio' in body.input), 'aspect_ratio should not be present')
})

test('extraInput is merged into the convenience input', () => {
  const body = buildCreateTaskBody({prompt: 'x', extraInput: {resolution: '2K', output_format: 'png'}})
  assert.equal(body.input.resolution, '2K')
  assert.equal(body.input.output_format, 'png')
})

test('a full input object overrides prompt/aspect convenience fields', () => {
  const body = buildCreateTaskBody({
    prompt: 'ignored',
    aspectRatio: '1:1',
    input: {prompt: 'real prompt', size: '1024x1024'},
  })
  assert.equal(body.input.prompt, 'real prompt')
  assert.equal(body.input.size, '1024x1024')
  assert.ok(!('aspect_ratio' in body.input), 'convenience fields must not leak in')
})

test('callBackUrl is included only when provided', () => {
  assert.ok(!('callBackUrl' in buildCreateTaskBody({prompt: 'x'})))
  const withCb = buildCreateTaskBody({prompt: 'x', callBackUrl: 'https://example.com/cb'})
  assert.equal(withCb.callBackUrl, 'https://example.com/cb')
})

// ─── parseCreateTaskResponse ────────────────────────────────────────────

test('createTask response yields taskId when code === 200', () => {
  const id = parseCreateTaskResponse({code: 200, msg: 'success', data: {taskId: 'task_abc'}})
  assert.equal(id, 'task_abc')
})

test('createTask response throws KieError on non-200 code', () => {
  assert.throws(
    () => parseCreateTaskResponse({code: 402, msg: 'insufficient credits', data: {}}),
    (err) => err instanceof KieError && /insufficient credits/.test(err.message),
  )
})

test('createTask response throws when taskId is missing', () => {
  assert.throws(() => parseCreateTaskResponse({code: 200, data: {}}), KieError)
})

// ─── parseTaskRecord ────────────────────────────────────────────────────

test('recordInfo parses resultUrls from the resultJson STRING', () => {
  const rec = parseTaskRecord({
    code: 200,
    data: {
      state: 'success',
      resultJson: '{"resultUrls":["https://cdn.kie.ai/out.png"]}',
      failCode: '',
      failMsg: '',
      progress: 100,
      taskId: 'task_abc',
      model: 'nano-banana-pro',
    },
  })
  assert.deepEqual(rec.urls, ['https://cdn.kie.ai/out.png'])
  assert.equal(rec.state, 'success')
  assert.equal(rec.progress, 100)
  assert.equal(rec.taskId, 'task_abc')
})

test('recordInfo also accepts an already-parsed resultJson object', () => {
  const rec = parseTaskRecord({
    data: {state: 'SUCCESS', resultJson: {resultUrls: ['https://cdn.kie.ai/a.jpg']}},
  })
  assert.deepEqual(rec.urls, ['https://cdn.kie.ai/a.jpg'])
  assert.equal(rec.state, 'success') // state is lower-cased
})

test('recordInfo returns empty urls (no throw) on malformed resultJson', () => {
  const rec = parseTaskRecord({data: {state: 'generating', resultJson: '{not valid json'}})
  assert.deepEqual(rec.urls, [])
  assert.equal(rec.state, 'generating')
})

test('recordInfo surfaces failCode / failMsg on failure', () => {
  const rec = parseTaskRecord({
    data: {state: 'fail', failCode: '500', failMsg: 'model error', resultJson: ''},
  })
  assert.equal(rec.state, 'fail')
  assert.equal(rec.failCode, '500')
  assert.equal(rec.failMsg, 'model error')
  assert.deepEqual(rec.urls, [])
})

test('recordInfo tolerates a missing data object', () => {
  const rec = parseTaskRecord({})
  assert.equal(rec.state, '')
  assert.deepEqual(rec.urls, [])
})

// ─── isTerminalState ────────────────────────────────────────────────────

test('isTerminalState is true only for success/fail', () => {
  assert.equal(isTerminalState('success'), true)
  assert.equal(isTerminalState('fail'), true)
  assert.equal(isTerminalState('SUCCESS'), true) // case-insensitive
  assert.equal(isTerminalState('waiting'), false)
  assert.equal(isTerminalState('queuing'), false)
  assert.equal(isTerminalState('generating'), false)
  assert.equal(isTerminalState(''), false)
})

// ─── summary ────────────────────────────────────────────────────────────

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`)
  process.exit(1)
}
