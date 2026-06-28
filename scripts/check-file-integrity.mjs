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
import { basename } from 'node:path'
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
  // Basic brace balance — matches open { count against close } count.
  // Real code constantly contains braces/parens inside string literals
  // (template literals, JSX prop strings, regex), so a small imbalance
  // is normal. We only trip on a LARGE imbalance — the scale of "file
  // cut in half" rather than "one missing brace". At 20+ you're looking
  // at real corruption, not a ternary inside a template string. Below
  // that: let esbuild do the talking.
  const opens = (text.match(/[{(]/g) || []).length
  const closes = (text.match(/[})]/g) || []).length
  const diff = Math.abs(opens - closes)
  if (diff >= 20) {
    failures.push({
      path,
      kind: 'unbalanced-braces',
      detail: `open vs close bracket counts differ by ${diff} — likely truncation.`,
    })
  }
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

main().catch((err) => {
  console.error('check-file-integrity.mjs crashed:', err)
  process.exit(2)
})
