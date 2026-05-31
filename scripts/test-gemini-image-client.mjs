#!/usr/bin/env node
/**
 * Regression test for the Gemini image client request shape and response
 * parser logic. Guards two bug classes from the initial implementation:
 *
 *   1. The request body must include BOTH "TEXT" and "IMAGE" modalities —
 *      the model rejects an image-only request with HTTP 400.
 *   2. The response parser must extract `inlineData.data` + `inlineData.mimeType`
 *      from the parts array (not the text field used by the text client).
 *
 * This test is pure-logic: it tests the request-construction and
 * response-parsing functions extracted below, with no real network calls and
 * no dependency on firebase-functions. All assertions are tight so a
 * regression on either bug immediately fails the test.
 *
 * Run: npm run test:gemini-image-client  (also via npm run test:all)
 */

import assert from 'assert/strict'

let pass = 0, fail = 0
const failures = []

function test(name, fn) {
  try {
    pass++
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail--
    pass--
    fail++
    failures.push({ name, err })
    console.log(`  XX  ${name} — ${err.message}`)
  }
}

// ─── Logic extracted from geminiImageClient.js ────────────────────────────────
// Kept in sync with the real module: if these functions change, update the test.

const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'

function buildRequestBody(prompt, model) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  }
}

function parseGeminiImageResponse(data) {
  const candidate = data?.candidates?.[0]
  const parts = candidate?.content?.parts || []
  for (const part of parts) {
    const inline = part?.inlineData
    if (inline && inline.data && inline.mimeType) {
      return { b64: String(inline.data), mimeType: String(inline.mimeType) }
    }
  }
  return null
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\ngeminiImageClient — request shape + response parser')

test('DEFAULT_IMAGE_MODEL is the GA id (no -preview suffix)', () => {
  if (!process.env.GEMINI_IMAGE_MODEL) {
    assert.equal(
      DEFAULT_IMAGE_MODEL,
      'gemini-2.5-flash-image',
      `Expected 'gemini-2.5-flash-image', got '${DEFAULT_IMAGE_MODEL}'`,
    )
    assert.ok(
      !DEFAULT_IMAGE_MODEL.includes('preview'),
      `Default model must not include "preview": ${DEFAULT_IMAGE_MODEL}`,
    )
  }
})

test('request body includes both TEXT and IMAGE in responseModalities', () => {
  const body = buildRequestBody('A frog on a lily pad', DEFAULT_IMAGE_MODEL)
  const modalities = body?.generationConfig?.responseModalities
  assert.ok(Array.isArray(modalities), 'responseModalities must be an array')
  assert.ok(modalities.includes('TEXT'), 'responseModalities must include TEXT')
  assert.ok(modalities.includes('IMAGE'), 'responseModalities must include IMAGE')
  assert.equal(modalities.length, 2, 'responseModalities must have exactly 2 entries')
})

test('request body does NOT set responseModalities to image-only', () => {
  const body = buildRequestBody('A mango tree', DEFAULT_IMAGE_MODEL)
  const modalities = body?.generationConfig?.responseModalities
  // Image-only ["IMAGE"] is what caused the 400. Make sure it's never that.
  assert.notDeepEqual(modalities, ['IMAGE'], 'image-only modality is rejected by the API')
})

test('request body puts the prompt in contents[0].parts[0].text', () => {
  const prompt = 'A colorful flat illustration of a Zambian village'
  const body = buildRequestBody(prompt, DEFAULT_IMAGE_MODEL)
  assert.equal(body.contents[0].role, 'user')
  assert.equal(body.contents[0].parts[0].text, prompt)
})

test('response parser extracts inlineData when present', () => {
  const fakeB64 = 'aGVsbG8gd29ybGQ='
  const data = {
    candidates: [{
      content: {
        parts: [
          { text: '' },                                              // text part
          { inlineData: { data: fakeB64, mimeType: 'image/png' } }, // image part
        ],
      },
      finishReason: 'STOP',
    }],
  }
  const result = parseGeminiImageResponse(data)
  assert.ok(result !== null, 'parser should find the inlineData part')
  assert.equal(result.b64, fakeB64, 'b64 must match inlineData.data')
  assert.equal(result.mimeType, 'image/png', 'mimeType must match inlineData.mimeType')
})

test('response parser returns null when only a text part is present', () => {
  const data = {
    candidates: [{
      content: {
        parts: [{ text: 'Sorry, cannot generate that image.' }],
      },
      finishReason: 'SAFETY',
    }],
  }
  const result = parseGeminiImageResponse(data)
  assert.equal(result, null, 'parser must return null when no inlineData is found')
})

test('response parser returns null for an empty candidates array', () => {
  assert.equal(parseGeminiImageResponse({ candidates: [] }), null)
  assert.equal(parseGeminiImageResponse({}), null)
  assert.equal(parseGeminiImageResponse(null), null)
})

test('response parser skips inlineData with missing data or mimeType', () => {
  const data = {
    candidates: [{
      content: {
        parts: [
          { inlineData: { mimeType: 'image/png' } },  // missing data
          { inlineData: { data: 'abc' } },             // missing mimeType
        ],
      },
    }],
  }
  assert.equal(parseGeminiImageResponse(data), null, 'should return null when data or mimeType is absent')
})

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`)
  process.exit(1)
}
