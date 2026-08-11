/**
 * The pre-commit integrity guard's bracket scanner.
 *
 * `scanCode` counts `{`/`(` against `}`/`)` over CODE ONLY — strings,
 * template literals, regexes and comments are skipped — and reports a literal
 * that runs off the end of the file as its own truncation signature.
 *
 * Why this file exists: the guard's primary check is an esbuild parse, and the
 * bracket count is only its fallback. That fallback is currently the ONLY
 * check running (esbuild left the dependency tree with Vite 8), and counting
 * raw text made it fire on the files least able to avoid it — parsers, whose
 * strings and regexes are full of bracket characters that are not structure.
 * Three files in this repo sat above the old threshold and all three parse.
 * A guard a valid file cannot satisfy gets bypassed with --no-verify, which
 * is worse than not having it.
 *
 * Every case below is a real shape from this repo, and the truncation cases
 * are the controls: a scanner that reported everything clean would pass the
 * false-positive half of this file and fail here.
 *
 * Run: node scripts/test-file-integrity-scan.mjs  (test:integrity-scan)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanCode } from './check-file-integrity.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`)
    process.exitCode = 1
  }
}

const balance = (src) => {
  const s = scanCode(src)
  return { diff: s.opens - s.closes, unterminated: s.unterminated }
}

console.log('file-integrity scanner')

test('balanced code balances', () => {
  assert.deepEqual(balance('function a(b) { return {c: 1} }\n'), { diff: 0, unterminated: null })
})

test('brackets inside strings are not structure', () => {
  // functionsManifest.mjs:  if ('{[('.includes(ch)) depth += 1
  const src = `const open = '{[('\nconst close = '}])'\nfunction f() { return open + close }\n`
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('brackets inside comments are not structure', () => {
  const src = `// const NAME = (…) => {\n/* function NAME(…) { */\nfunction f() {}\n`
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('a regex is not structure, and `return /…/` is a regex not a division', () => {
  // adminGenerationsService.js: return /[",\n]/.test(s) ? … : s
  // Reading that slash as division makes the `"` inside open a bogus string.
  const src = 'function f(s) {\n  return /[",\\n]/.test(s) ? 1 : 0\n}\n'
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('division is still division', () => {
  const src = 'function f(a, b) { return (a + b) / 2 }\n'
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('a NESTED template literal does not close its parent early', () => {
  // The failure this stack exists for. consentPages.js writes `${name}'s
  // account`; with the outer template closed early by a nested backtick, that
  // apostrophe reads as the start of an unterminated string and the file is
  // reported as truncated.
  const src = 'const h = `a ${x ? `y` : `z`} b`\nconst g = `${name}\'s account`\nfunction f() {}\n'
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('code inside a ${…} interpolation still counts', () => {
  const src = 'const s = `${ f({a: 1}) }`\n'
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

test('an apostrophe in template text is text', () => {
  assert.deepEqual(balance('const s = `it\'s fine`\n'), { diff: 0, unterminated: null })
})

test('a URL in a string is not a comment', () => {
  const src = 'const u = "https://zedexams.com/x" // real comment {\nfunction f() {}\n'
  assert.deepEqual(balance(src), { diff: 0, unterminated: null })
})

// --- Truncation: the controls -----------------------------------------

test('CONTROL — a file ending inside a string is reported', () => {
  assert.equal(scanCode('const a = "oh no').unterminated, 'string')
})

test('CONTROL — a file ending inside a template literal is reported', () => {
  assert.equal(scanCode('const a = `oh\nno').unterminated, 'template literal')
})

test('CONTROL — a file ending inside a block comment is reported', () => {
  assert.equal(scanCode('/* oh no\nand on').unterminated, 'block comment')
})

test('CONTROL — real files, really truncated: the literal check is what catches them', () => {
  // Measured rather than asserted from intuition, because the intuition was
  // wrong. 120 real modules cut at six points each (672 truncations):
  //
  //     bracket count (>= 20 unclosed) ....   0  (0.0%)
  //     unterminated literal .............. 220 (32.7%)
  //
  // The bracket count caught NOTHING. It needs twenty levels of unclosed
  // nesting, which a cut essentially never produces — a cut lands one or two
  // levels deep. So the rule that was blocking a valid file had never caught
  // a truncation, while the check it lacked catches a third of them. The
  // byte-level NUL checks and the JSX-tag check (both above, both untouched)
  // are what caught the three real incidents in this repo's history.
  //
  // This asserts the working detector still works. It deliberately does NOT
  // pin the bracket count's zero — that is a finding for the reader, not a
  // property worth freezing.
  const files = execFileSync('git', ['ls-files', 'scripts/*.mjs', 'src/utils/*.js', 'functions/*.js'],
    { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean).slice(0, 120)
  let cuts = 0
  let caught = 0
  for (const rel of files) {
    let text
    try { text = readFileSync(path.join(ROOT, rel), 'utf8') } catch { continue }
    if (text.length < 2000) continue
    for (const frac of [0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      cuts += 1
      if (scanCode(text.slice(0, Math.floor(text.length * frac))).unterminated) caught += 1
    }
  }
  assert.ok(cuts > 300, `corpus too small to mean anything (${cuts} cuts)`)
  assert.ok(caught / cuts > 0.2,
    `the unterminated-literal check caught ${caught}/${cuts} truncations — it was 32.7% when written`)
})

test('a quote that merely runs to a newline is NOT called truncation', () => {
  // Degrade into miscounting, never into accusing a healthy file. An
  // unclosed quote within one line is almost always this scanner misreading
  // something upstream; only running off the END of the file is the signature.
  assert.equal(scanCode("const a = 'unclosed\nfunction f() {}\n").unterminated, null)
})

test('the repo\'s own parsers now balance in code', () => {
  // The three files the raw count fired on. They parse; the guard must agree.
  for (const rel of [
    'scripts/lib/functionsManifest.mjs',
    'src/components/quiz/documentQuizParserCore.js',
    'scripts/test-paste-question-parser.mjs',
  ]) {
    const s = scanCode(readFileSync(path.join(ROOT, rel), 'utf8'))
    assert.equal(s.unterminated, null, `${rel}: reported ${s.unterminated}`)
    assert.ok(Math.abs(s.opens - s.closes) < 20,
      `${rel}: code-only diff ${s.opens - s.closes} still trips the threshold`)
  }
})

test('importing the checker does not audit the tree', () => {
  // It used to run `main()` on import, so asking this module a question
  // walked every file in the repo as a side effect — and made this test file
  // impossible to write.
  assert.equal(typeof scanCode, 'function')
})

console.log(`\nfile-integrity scanner: ${passed} passed`)
