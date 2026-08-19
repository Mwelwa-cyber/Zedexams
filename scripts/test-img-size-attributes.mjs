#!/usr/bin/env node
/**
 * An <img>'s width/height ATTRIBUTES do not size it in this app.
 *
 * `src/index.css` starts with `@tailwind base`, and Tailwind's preflight
 * declares `img, video { max-width: 100%; height: auto }`. That is an
 * AUTHOR-origin rule. The `width`/`height` attributes on an element are
 * presentational hints, which sit in a LOWER cascade origin — so preflight
 * wins on every image in the product, and an attribute-only size silently
 * does nothing.
 *
 * It fails quietly, which is why it needs a test rather than a code review.
 * The parent app's header carried `<img src="/zedexams-logo.webp" height="28">`
 * with no matching CSS rule: the logo is intrinsically 312x384, so it rendered
 * 384px tall on every /family page, pushed the greeting below the fold, and —
 * next to a `white-space: nowrap` role pill in a non-wrapping flex row — made
 * the whole parent app scroll sideways on a phone. Every other logo in the
 * app happened to have a real CSS rule behind it. This is the guard that makes
 * that "happened to" into a rule.
 *
 * ── What it checks ─────────────────────────────────────────────────────
 *
 * For every `<img>` in `src/**` that carries a numeric `width=` or `height=`
 * attribute, there must be a CSS rule that actually sizes it: either a rule
 * naming one of the image's own classes, or a descendant rule
 * (`.some-ancestor img`) naming a class on an element that encloses it. The
 * attributes may stay — they are still useful as an aspect-ratio hint that
 * reserves layout space before the file loads — but they may not be the only
 * thing saying how big the image is.
 *
 * Ancestor classes are collected from the literal `className="…"` strings in
 * the lines immediately above the tag, which is deliberately generous: this
 * test is meant to catch an image nothing sizes at all, not to police which
 * ancestor does the sizing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

// How far above the tag to look for an enclosing className. A wrapper more
// than this many lines away is not what sizes the image in practice.
const ANCESTOR_LOOKBACK_LINES = 12

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(SRC)
const jsxFiles = files.filter((f) => /\.jsx$/.test(f) && !/\.spec\.jsx$/.test(f))
const cssFiles = files.filter((f) => /\.css$/.test(f))

/**
 * Classes that a CSS rule sizes an image through. Two shapes count:
 *
 *   .foo img { height: … }   → 'foo' sizes any image inside .foo
 *   .foo { height: … }       → 'foo' sizes the element carrying it
 *
 * Rules are read out of the raw text, so a rule nested inside a media query
 * or a `@layer` block counts exactly like a top-level one.
 */
function collectSizingClasses() {
  const sized = new Set()
  const RULE = /([^{}]+)\{([^{}]*)\}/g
  for (const file of cssFiles) {
    const css = readFileSync(file, 'utf8')
    let m
    while ((m = RULE.exec(css))) {
      const selector = m[1]
      const body = m[2]
      if (!/(^|[;\s])(width|height)\s*:/.test(body)) continue
      for (const part of selector.split(',')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const classes = trimmed.match(/\.[A-Za-z0-9_-]+/g) || []
        if (!classes.length) continue
        // `.foo img` sizes descendants; `.foo` sizes itself. Either way the
        // last class named in the selector is the one a call site can carry.
        for (const cls of classes) sized.add(cls.slice(1))
      }
    }
  }
  return sized
}

const sizingClasses = collectSizingClasses()

/** Every class token in a literal className/class attribute on one line. */
function classesInLine(line) {
  const out = []
  const ATTR = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
  let m
  while ((m = ATTR.exec(line))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    // Drop `${…}` interpolations — a computed class cannot be resolved here.
    for (const token of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (token) out.push(token)
    }
  }
  return out
}

const failures = []

for (const file of jsxFiles) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (!line.includes('<img')) return
    // Only tags that lean on the attributes for their size.
    if (!/\b(width|height)\s*=\s*"\d+"/.test(line)) return

    const candidates = new Set(classesInLine(line))
    for (let j = Math.max(0, i - ANCESTOR_LOOKBACK_LINES); j < i; j += 1) {
      for (const cls of classesInLine(lines[j])) candidates.add(cls)
    }

    const sizedBy = [...candidates].find((cls) => sizingClasses.has(cls))
    if (!sizedBy) {
      failures.push({
        file: relative(ROOT, file),
        line: i + 1,
        snippet: line.trim().slice(0, 120),
        candidates: [...candidates],
      })
    }
  })
}

if (failures.length) {
  console.error('\n✗ <img> sized only by its width/height ATTRIBUTES.\n')
  console.error(
    '  Tailwind preflight sets `img { height: auto }` at author level, which\n' +
    '  outranks the attribute. Add a real CSS rule (e.g. `.pax-brand { height:\n' +
    '  30px; width: auto }`) and give the image or a wrapper that class.\n',
  )
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}`)
    console.error(`    ${f.snippet}`)
    console.error(`    no sizing rule found for: ${f.candidates.join(', ') || '(no class on or above the tag)'}\n`)
  }
  process.exit(1)
}

console.log(`✓ every <img> with a width/height attribute is also sized in CSS (${jsxFiles.length} files scanned)`)
