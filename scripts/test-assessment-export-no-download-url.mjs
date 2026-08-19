/**
 * Regression guard: the assessment EXPORT download path must never navigate the
 * browser to a Firebase Storage getDownloadURL() URL — that is exactly what put
 * "From: firebasestorage.googleapis.com" in the Android download dialog and
 * leaked the permanent download token. Exports now go through the branded
 * same-origin /downloads/assessments/... endpoint.
 *
 * This fails if `getDownloadURL` reappears in the export-client modules, or if
 * the Studio's export handler stops preferring the branded path.
 *
 * Run: node scripts/test-assessment-export-no-download-url.mjs
 */

import { readFileSync } from 'node:fs'
import assert from 'node:assert'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ok  ${name}`) }

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Strip comments so the guard checks executable CODE, not the docstrings that
// explain what the code deliberately avoids (which name the old bad host).
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const client = stripComments(read('src/utils/assessmentExportClient.js'))
const hook = stripComments(read('src/hooks/useAssessmentExport.js'))

test('export client never calls getDownloadURL', () => {
  assert.ok(!/getDownloadURL/.test(client),
    'assessmentExportClient.js must not use getDownloadURL — downloads go through /downloads/...')
})

test('export hook never calls getDownloadURL', () => {
  assert.ok(!/getDownloadURL/.test(hook))
})

test('export client never references a raw firebasestorage URL', () => {
  // Broader than the full hostname on purpose: ANY mention of the bucket host,
  // in any spelling, is the regression -- every download goes through the
  // server-issued /downloads/<path>?t=<ticket> instead.
  //
  // Deliberately not written as `includes('<host>.googleapis.com')`: CodeQL
  // reads an includes()/startsWith() of a host-shaped literal as a URL
  // allowlist test that an attacker could bypass (#64,
  // js/incomplete-url-substring-sanitization). This asserts a host is ABSENT
  // from a source file, which is the opposite question, and now says so in a
  // shape that cannot be misread.
  assert.ok(!/firebasestorage/i.test(client), 'export client names the raw storage host')
})

test('export client downloads via the server-provided branded path + ticket', () => {
  assert.ok(/downloadPath/.test(client), 'navigates using the server downloadPath')
  assert.ok(/requestAssessmentExport/.test(client), 'requests the export via the callable')
  assert.ok(/\?t=/.test(client), 'passes the short-lived ticket as the bearer credential')
})

test('Studio export handler prefers the branded download for the 3 export types', () => {
  const studio = read('src/features/assessmentStudio/pages/AssessmentStudio.jsx')
  assert.ok(/startBrandedDownload/.test(studio), 'Studio calls startBrandedDownload')
  assert.ok(/paper-docx/.test(studio) && /scheme-docx/.test(studio) && /paper-pdf/.test(studio),
    'all three server export types are wired')
})

console.log(`\nassessment-export-no-download-url: ${passed} tests passed`)
