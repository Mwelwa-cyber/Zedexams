/* Plain-node tests for safeImageSrc (npm run test:safe-image-src). */
import assert from 'node:assert/strict'

import { safeImageSrc } from './safeImageSrc.js'

/* ── The URLs this app actually stores must survive untouched ──────────── */

const UNCHANGED = [
  // What an uploaded question image looks like after Storage hands it back.
  'https://firebasestorage.googleapis.com/v0/b/examsprepzambia.appspot.com/o/quiz%2Fu1%2Fq3.png?alt=media&token=7c1f9a2e-4b31-4d8e-9f60-2a5c8d1e0b74',
  // The .firebasestorage.app bucket spelling.
  'https://firebasestorage.googleapis.com/v0/b/examsprepzambia.firebasestorage.app/o/a%2Fb.jpg?alt=media',
  // A local import that has not been uploaded yet.
  'blob:https://zedexams.com/6b2e4f1a-9c3d-4a77-8f10-2b6e5d3c9a11',
  'blob:null/6b2e4f1a-9c3d',
  // An inlined diagram.
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
  // The Storage emulator, which is plain http on localhost.
  'http://127.0.0.1:9199/v0/b/examsprepzambia.appspot.com/o/q.png?alt=media',
  // Bundled assets.
  '/diagrams/triangle.svg',
  './figure-2.png',
  '../shared/figure-2.png',
  // The same-origin image proxy, query string and all.
  '/api/image-proxy?url=https%3A%2F%2Ffirebasestorage.googleapis.com%2Fv0%2Fb%2Fx%2Fo%2Fd.png%3Falt%3Dmedia',
]

for (const url of UNCHANGED) {
  assert.equal(safeImageSrc(url), url, `must render unchanged: ${url.slice(0, 60)}`)
}

/* ── What must never reach the attribute ───────────────────────────────── */

const REJECTED = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'data:text/html,<script>alert(1)</script>',
  'data:application/javascript,alert(1)',
  // Protocol-relative: inherits the page scheme and the host is not ours.
  '//attacker.example/beacon.gif',
  // A scheme we have no use for and would rather not hand to the browser.
  'file:///etc/passwd',
  'ftp://host/x.png',
  // Attribute-escaping characters, even on an otherwise fine scheme.
  'https://host/a".png',
  "https://host/a'.png",
  'https://host/<img>.png',
  'https://host/a\\b.png',
  'https://host/a\nb.png',
  // Not a string, or nothing at all.
  '',
  '   ',
]

for (const url of REJECTED) {
  assert.equal(safeImageSrc(url), undefined, `must be refused: ${JSON.stringify(url)}`)
}

for (const value of [null, undefined, 42, {}, [], true, { toString: () => 'javascript:alert(1)' }]) {
  assert.equal(safeImageSrc(value), undefined, `non-string must be refused: ${String(value)}`)
}

/* ── The value is returned as written ──────────────────────────────────── */

assert.equal(
  safeImageSrc('https://host/o/a%2Fb.png?alt=media'),
  'https://host/o/a%2Fb.png?alt=media',
  'an already-encoded path is left alone — encodeURI here would make %2F into %252F and break every Storage URL',
)

assert.equal(
  safeImageSrc('/diagrams/figure one.png'),
  undefined,
  'a literal space is refused rather than silently repaired: the guard decides, it does not rewrite',
)

assert.equal(
  safeImageSrc('  /diagrams/triangle.svg  '),
  '/diagrams/triangle.svg',
  'surrounding whitespace is trimmed, not treated as a rejection',
)

console.log('safeImageSrc: all assertions passed')
