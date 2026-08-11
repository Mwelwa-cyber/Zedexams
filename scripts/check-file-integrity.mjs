#!/usr/bin/env node
/**
 * File-integrity guard.
 *
 * Motivation: during development we've hit at least three files where
 * something on the Windows host (an editor plugin, a cloud-sync client,
 * or the Cowork mount layer) truncated or null-padded the file mid-write.
 * The symptoms were identical each time: Vite would fail to build with a
 * parse error pointing at a file no one had touched, followed by 30 minutes
 * of detective work.
 *
 * This script runs two passes on every file it's asked to check:
 *
 *   1. Byte-level corruption:
 *        - File ends with one or more NUL bytes (saw this on
 *          FloatingZedButton.jsx — ~1.3 kB of trailing NULs).
 *        - File contains ANY NUL byte (0x00) anywhere — a text/source
 *          file should never have one (saw a lone NUL hide inside a regex
 *          in studioLessonPlan.js, turning the whole .js binary).
 *
 *   2. Parse / structural check for source files:
 *        - .js / .jsx / .mjs / .cjs / .ts / .tsx → parsed via esbuild
 *          (handles JSX, modern syntax, everything Vite would accept).
 *        - .json → JSON.parse.
 *
 * ⚠️ THE ESBUILD PARSE PATH IS CURRENTLY DEAD, ON EVERY MACHINE. `esbuild` was
 * never a declared dependency here — it arrived transitively through Vite, and
 * Vite 8 dropped it (rolldown/oxc instead). `loadEsbuild()` therefore resolves
 * to null and EVERY source file falls through to `heuristicSourceCheck`, which
 * this file's own comments describe as a fallback. Nothing announced the
 * change; the guard just quietly became the weaker half of itself.
 *
 * The fix is to declare `esbuild` as a devDependency so the check owns its
 * parser instead of borrowing one — that is a dependency decision and is left
 * to the repo owner, not made here. Until then the fallback is the whole
 * guard, which is why it now does the job properly (see below) rather than
 * counting brackets in raw text.
 *
 * Exit codes:
 *   0 — every file passed.
 *   1 — at least one file failed. Each failure is printed to stderr with
 *       file path, failure kind, and enough context to fix.
 *
 * Invocation:
 *   node scripts/check-file-integrity.mjs <path> [<path> …]
 *
 * Wired into lint-staged in package.json so it runs automatically on
 * pre-commit for any staged js/jsx/mjs/cjs/ts/tsx/json/css/md/html file.
 * You can also run it manually across the whole repo:
 *
 *   node scripts/check-file-integrity.mjs $(git ls-files)
 */

import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const SRC_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])

const failures = []

function extOf(path) {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i).toLowerCase()
}

async function checkBytes(path, bytes) {
  // Trailing NULs — the FloatingZedButton failure mode.
  if (bytes.length > 0 && bytes[bytes.length - 1] === 0) {
    failures.push({
      path,
      kind: 'trailing-null-bytes',
      detail: 'File ends with one or more NUL bytes (0x00). The writing tool truncated partway through. Recreate the file from version control.',
    })
    return
  }
  // Any NUL byte anywhere in the file. checkBytes only ever runs on
  // text-format files (shouldCheckPath gates on TEXT_EXT), and a single
  // 0x00 in a source file is always corruption — never legitimate. This is
  // tighter than the old "run of 3+" rule, which let a lone NUL through:
  // studioLessonPlan.js carried a single NUL inside a regex (the `^@` of
  // `/^@/g` collapsed to 0x00), which turned the whole .js into a binary
  // file yet sailed past the 3+-run check.
  const nul = bytes.indexOf(0)
  if (nul !== -1) {
    failures.push({
      path,
      kind: 'embedded-null-byte',
      detail: `Found a NUL byte (0x00) at offset ${nul}. A text/source file should never contain one — likely silent corruption. Recreate the file from version control.`,
    })
    return
  }
}

// Loaded once, at first use. Calling esbuild.transform() from many
// concurrent async callers all spawning their own service handle runs into
// EPIPE around ~50 workers. One shared handle is fine.
let _esbuildPromise = null
async function loadEsbuild() {
  if (!_esbuildPromise) {
    _esbuildPromise = import('esbuild').catch(() => null)
  }
  return _esbuildPromise
}

async function checkParse(path, text) {
  const ext = extOf(path)

  if (ext === '.json') {
    try {
      JSON.parse(text)
    } catch (err) {
      failures.push({
        path,
        kind: 'invalid-json',
        detail: err.message,
      })
    }
    return
  }

  if (SRC_EXT.has(ext)) {
    const esbuild = await loadEsbuild()
    if (!esbuild || _esbuildBroken) {
      // Esbuild unavailable (fresh clone before install) OR its native
      // binary doesn't match the current platform (happens when a
      // Windows-installed node_modules is read from a Linux sandbox).
      // Heuristic fallback still catches obvious truncation modes.
      heuristicSourceCheck(path, text)
      return
    }
    try {
      const loader = ext === '.tsx' || ext === '.jsx'
        ? ext.slice(1)
        : (ext === '.ts' ? 'ts' : 'js')
      await esbuild.transform(text, {
        loader,
        sourcefile: basename(path),
        // We only care about whether the file parses. No minify / no output.
        minify: false,
      })
    } catch (err) {
      const msg = err.errors?.[0]?.text || err.message || ''
      // If esbuild's service dies (ENOENT / EPIPE / stopped), mark it as
      // broken globally and retry this file via the heuristic path. Every
      // subsequent file will skip esbuild too. Without this flag, one
      // spawn failure turns into N false "parse error" reports.
      if (/spawn .* ENOENT|service (is no longer running|was stopped)|EPIPE/i.test(msg)) {
        _esbuildBroken = true
        heuristicSourceCheck(path, text)
        return
      }
      failures.push({path, kind: 'parse-error', detail: msg})
    }
  }
}

let _esbuildBroken = false

// Fallback check used only when esbuild isn't available (e.g. fresh clone
// before install). Catches the obvious truncation modes: file ends mid-tag,
// mid-string, or the overall structure doesn't balance.
function heuristicSourceCheck(path, text) {
  if (text.length === 0) return
  // Ends mid-JSX-tag: "</foo" truncation we saw in TeacherLandingPage.
  if (/<\/[A-Za-z][\w-]*$/.test(text.trimEnd())) {
    failures.push({
      path,
      kind: 'truncated-jsx-tag',
      detail: 'File ends mid-JSX-closing-tag. Likely a truncated write.',
    })
    return
  }
  // Brace balance, counted over CODE ONLY — string literals, template
  // literals, regexes and comments are skipped.
  //
  // Counting raw text made this fire on the files least able to avoid it:
  // parsers. A module whose job is matching brackets is full of `'{[('`,
  // `/^\(/`, and prose like `const NAME = (…) => {`, none of which is
  // structure. Three files in this repo sit above the old threshold and all
  // three parse; two of them were already over it and passed only because
  // nobody had staged them since. A guard that a valid file cannot satisfy
  // gets bypassed with --no-verify, which is worse than not having it.
  //
  // The threshold stays generous — this looks for "file cut in half", not
  // "one missing brace"; a real parser is the tool for the latter.
  // JSX is past what a character scanner can lex. `</div>` puts a `/` right
  // after a `<`, JSX text carries apostrophes and `/*` sequences that are not
  // comments, and attributes mix quoting rules — every one of which walks the
  // scanner into the wrong state. Measured across all 969 .jsx/.tsx files in
  // this repo, the RAW count's worst case is 9, less than half the threshold,
  // so the crude rule is both safe and sufficient there. Non-JSX sources —
  // where the parsers live, and where the raw count reaches 30 — get the
  // code-only scan. The real answer for JSX is a parser; see the note on the
  // dead esbuild path above.
  const ext = extOf(path)
  if (ext === '.jsx' || ext === '.tsx') {
    const rawDiff = Math.abs(
      (text.match(/[{(]/g) || []).length - (text.match(/[})]/g) || []).length)
    if (rawDiff >= 20) {
      failures.push({
        path,
        kind: 'unbalanced-braces',
        detail: `open vs close bracket counts differ by ${rawDiff} — likely truncation.`,
      })
    }
    return
  }

  const scan = scanCode(text)
  if (scan.unterminated) {
    // Falling out of the file inside a literal is a truncation signature in
    // its own right, and a stronger one than any count: it means the file
    // ends mid-string, mid-template or mid-comment. It must be reported
    // rather than swallowed — skipping to end-of-file would otherwise hide
    // every bracket after the cut and report a tidy balance.
    failures.push({
      path,
      kind: 'unterminated-literal',
      detail: `File ends inside an unterminated ${scan.unterminated} that opens at offset ${scan.unterminatedAt}. Likely a truncated write.`,
    })
    return
  }
  const diff = Math.abs(scan.opens - scan.closes)
  if (diff >= 20) {
    failures.push({
      path,
      kind: 'unbalanced-braces',
      detail: `open vs close bracket counts differ by ${diff} in code (strings and comments excluded) — likely truncation.`,
    })
  }
}

/**
 * Walk source text and count `{`/`(` against `}`/`)` outside strings,
 * template literals, regex literals and comments.
 *
 * Deliberately a scanner, not a parser: it has no dependency and cannot
 * fail on syntax it does not understand. The one judgement call is telling
 * a regex `/` from a division `/`, decided the usual way — by what the last
 * meaningful character was. Getting that wrong costs a miscount in a file
 * that divides a lot, not a crash, and the threshold absorbs it.
 *
 * @returns {{opens: number, closes: number, unterminated: string|null,
 *            unterminatedAt: number}}
 */
export function scanCode(text) {
  let opens = 0
  let closes = 0
  let i = 0
  let prev = ''

  // Stack of nested template contexts. A `tmpl` frame means we are reading
  // template TEXT; an `interp` frame means we are back in ordinary code
  // inside a `${…}`, and its `depth` tracks braces so the closing `}` of the
  // interpolation is told apart from an object literal's.
  //
  // The stack is the whole reason this is not a regex. Without it, the first
  // NESTED backtick — `` `a ${x ? `y` : `z`} b` `` — closes the outer
  // template early and every quote after it is misread. That is not a corner
  // case: consentPages.js writes `${name}'s account`, and a scanner that had
  // fallen out of the template reads that apostrophe as the start of an
  // unterminated string and reports the file as truncated.
  const stack = []
  const top = () => stack[stack.length - 1]

  // Telling a regex `/` from a division `/` is the one genuinely ambiguous
  // decision here, and punctuation alone gets it wrong: `return /[",\n]/…`
  // has an identifier character before the slash, so a punctuation-only rule
  // reads a division, then reads the `"` inside the regex as a string, and
  // reports 96 healthy files as truncated. The preceding WORD decides it.
  const REGEX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await',
  ])
  const isRegexPosition = (at) => {
    if (prev === '') return true
    if ('=([{,;:!&|?+-*%~^<>'.includes(prev)) return true
    if (!/[A-Za-z0-9_$]/.test(prev)) return false
    let j = at - 1
    while (j >= 0 && /\s/.test(text[j])) j -= 1
    let end = j + 1
    while (j >= 0 && /[A-Za-z0-9_$]/.test(text[j])) j -= 1
    return REGEX_KEYWORDS.has(text.slice(j + 1, end))
  }

  while (i < text.length) {
    const frame = top()

    // --- Inside template TEXT ------------------------------------------
    if (frame?.type === 'tmpl') {
      const ch = text[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { stack.pop(); prev = '`'; i += 1; continue }
      if (ch === '$' && text[i + 1] === '{') { stack.push({ type: 'interp', depth: 0 }); i += 2; continue }
      i += 1
      continue
    }

    // --- Ordinary code (top level, or inside a ${…}) --------------------
    const ch = text[i]

    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? text.length : nl
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1) return { opens, closes, unterminated: 'block comment', unterminatedAt: i }
      i = close + 2
      continue
    }
    if (ch === '`') { stack.push({ type: 'tmpl' }); i += 1; continue }
    if (ch === '"' || ch === "'") {
      const openedAt = i
      const quote = ch
      i += 1
      let closed = false
      let hitNewline = false
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === quote) { closed = true; i += 1; break }
        if (text[i] === '\n') { hitNewline = true; break }
        i += 1
      }
      // A quote that runs to a NEWLINE is not reported as truncation. In real
      // source it almost always means this scanner misread something upstream
      // — an apostrophe in prose, a quote inside a regex it took for
      // division — and a heuristic should degrade into miscounting, not into
      // accusing a healthy file. Running to END OF FILE is different: that is
      // the truncation signature, and it is still reported.
      if (!closed && hitNewline) { i = openedAt + 1; prev = quote; continue }
      if (!closed) return { opens, closes, unterminated: 'string', unterminatedAt: openedAt }
      prev = quote
      continue
    }
    if (ch === '/' && isRegexPosition(i)) {
      const openedAt = i
      i += 1
      let closed = false
      let inClass = false
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === '[') inClass = true
        else if (text[i] === ']') inClass = false
        else if (text[i] === '/' && !inClass) { closed = true; i += 1; break }
        else if (text[i] === '\n') break
        i += 1
      }
      // An unclosed `/` is far likelier a division this scanner misread than
      // a truncated regex, so it is NOT reported as corruption — resume from
      // just after it and count what follows as ordinary code.
      if (!closed) i = openedAt + 1
      prev = '/'
      continue
    }

    if (ch === '{') {
      if (frame?.type === 'interp') frame.depth += 1
      opens += 1
    } else if (ch === '}') {
      if (frame?.type === 'interp') {
        if (frame.depth === 0) { stack.pop(); i += 1; prev = '}'; continue }
        frame.depth -= 1
      }
      closes += 1
    } else if (ch === '(') opens += 1
    else if (ch === ')') closes += 1

    if (!/\s/.test(ch)) prev = ch
    i += 1
  }

  if (stack.length) {
    const kind = stack.some((f) => f.type === 'tmpl') ? 'template literal' : 'interpolation'
    return { opens, closes, unterminated: kind, unterminatedAt: -1 }
  }
  return { opens, closes, unterminated: null, unterminatedAt: -1 }
}

// Only text formats: binary files legitimately contain NULs, so applying
// byte-level checks to them produces noise. If a new text extension is
// added to the project later, add it here.
const TEXT_EXT = new Set([
  ...SRC_EXT,
  '.json', '.md', '.mdx', '.html', '.htm', '.css', '.scss',
  '.yml', '.yaml', '.xml', '.svg', '.txt', '.sh', '.rules',
])

// Paths under these prefixes are skipped even if they have a text
// extension — committed build artefacts or dev-tool caches.
const SKIP_PREFIXES = [
  'node_modules/', 'dist/', 'build/', 'coverage/', '.playwright/',
  '.vite/', '.next/', '.cache/', 'functions/node_modules/',
  'functions/lib/',
]

// Per-file patterns for transient build-tool noise that Vite / ESLint /
// TypeScript sometimes accidentally commit. Not a long list — each entry
// must point at a real problem we've seen committed in this repo.
const SKIP_NAME_PATTERNS = [
  /\.timestamp-\d+-[a-f0-9]+\.mjs$/, // Vite config HMR timestamps
  /\.tsbuildinfo$/,                  // TypeScript incremental cache
]

function shouldCheckPath(path) {
  const normalised = path.replace(/\\/g, '/')
  if (SKIP_PREFIXES.some((p) => normalised.startsWith(p))) return false
  // Dev-time build-test folders that get committed by accident. Matches
  // dist_test, dist_test13, dist-test, etc.
  if (/^(dist[-_])/.test(normalised)) return false
  if (SKIP_NAME_PATTERNS.some((re) => re.test(normalised))) return false
  return TEXT_EXT.has(extOf(path))
}

async function checkFile(path) {
  if (!shouldCheckPath(path)) return

  let buf
  try {
    buf = await readFile(path)
  } catch (err) {
    // Non-fatal — lint-staged sometimes passes deleted paths. Skip silently.
    if (err.code === 'ENOENT') return
    throw err
  }
  await checkBytes(path, buf)
  // If the byte-level check already flagged the file, skip parse — the
  // error is already loud enough and parse noise adds no information.
  if (failures.some((f) => f.path === path)) return

  const text = buf.toString('utf8')
  await checkParse(path, text)
}

async function main() {
  let args = process.argv.slice(2)

  // No args → audit the whole tracked tree (via git ls-files). Works
  // cross-platform because we invoke git ourselves rather than relying on
  // a shell $() expansion — the latter breaks on Windows cmd.exe.
  if (args.length === 0) {
    try {
      const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      args = out.split(/\r?\n/).filter(Boolean)
    } catch {
      console.error('usage: check-file-integrity.mjs <path> [<path> ...]')
      console.error('  (or run with no args inside a git checkout to audit everything)')
      process.exit(2)
    }
    if (args.length === 0) {
      console.error('check:integrity: git ls-files returned no paths.')
      process.exit(2)
    }
  }

  // Bounded concurrency — Promise.all on 2000+ files blows the OS
  // file-descriptor limit (EMFILE). 32 is a safe ceiling even on Windows.
  const CONCURRENCY = 32
  let cursor = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const idx = cursor++
        if (idx >= args.length) return
        await checkFile(args[idx])
      }
    }),
  )

  if (failures.length === 0) {
    // Silent on success — lint-staged prefers quiet tools.
    return
  }

  console.error('\n❌ File-integrity check failed:\n')
  for (const f of failures) {
    console.error(`  • ${f.path}`)
    console.error(`      [${f.kind}] ${f.detail}`)
  }
  console.error(`\n${failures.length} file(s) failed. Fix before committing.\n`)
  process.exit(1)
}

// Only run when INVOKED, not when imported. `scanCode` has its own test
// (scripts/test-file-integrity-scan.mjs), and importing this module used to
// audit the entire tree as a side effect of asking it a question.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('check-file-integrity.mjs crashed:', err)
    process.exit(2)
  })
}
