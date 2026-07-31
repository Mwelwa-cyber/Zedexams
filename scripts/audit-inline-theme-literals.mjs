#!/usr/bin/env node
/* global console, process */
/**
 * Inline colour literals on themed surfaces.
 *
 * THE GAP THIS CLOSES
 * `audit:dark` measures themed CONTAINERS — it renders `.studio-theme`,
 * `.studio-v2`, `.notes-studio` and the rest and checks what they paint. That
 * catches anything a stylesheet decides. It cannot catch a component that
 * writes `style={{ color: '#0e2a32' }}` on its own elements, because an inline
 * style beats every stylesheet rule: the container is correct, the CSS is
 * correct, and the text is still near-black on a near-black card.
 *
 * That is not hypothetical. AssessmentList.jsx set the paper-card title inline
 * and every title on /teacher/assessment-papers was unreadable on Night while
 * the container audit reported that surface correct — because it was correct,
 * about everything it could see.
 *
 * WHAT IS FLAGGED
 * An inline `color` / `background` / `borderColor` literal, in a file that
 * renders inside a themed container, whose LUMINANCE puts it on the wrong side
 * for one of the themes: dark ink or a light fill.
 *
 * WHAT IS NOT
 *  - Brand and semantic hues (the terracotta accent, the status colours). They
 *    are the same colour in every theme by design, and they sit on fills that
 *    do not change.
 *  - Colours inside a gradient. `linear-gradient(135deg, #0e2a32 …)` with white
 *    text on it is a dark hero band, dark in every theme, and correct.
 *  - The export and print paths, and the deliberately-light canvases — same
 *    exemptions as audit:colors, for the same reasons.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', 'android'])

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue
    const f = join(dir, n)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (extname(f) === '.jsx') out.push(f)
  }
  return out
}

const lum = (hex) => {
  let h = hex
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('')
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Files whose literals are the right answer — the same set audit:colors
// exempts, plus the canvases that stay light on purpose.
const EXEMPT = [
  /\/(views|diagrams)\//,
  /(ToDocx|ToPdf|safeRender|paperGolden|monochrome)/i,
  /PaperBlocks|PaperPreview|printable/i,
  /\/ui\/(icons|Icon|ProfessorPako)/,
  /visualStudio/,
  /marketing/,
]

// Hues that mean something regardless of theme. A warning is the same amber on
// both, and it sits on a wash that moves with the theme.
const BRAND = new Set([
  '#d97757', '#c5613f', '#b95c3a', '#a94f2e', '#aa5435', '#a5523a',
  '#d97706', '#b45309', '#92400e', '#8a3d12', '#7a5a1e',
  '#b91c1c', '#dc2626', '#991b1b',
  '#15803d', '#166534', '#10864e', '#0a5a35', '#047857',
  '#2563eb', '#1e40af', '#6b21a8', '#f59e0b',
])

const DARK_INK = 0.30   // below: ink meant for a light surface
const LIGHT_BG = 0.55   // above: a fill meant for a light theme

const findings = []
for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file)
  if (/\.(test|spec)\./.test(rel) || EXEMPT.some((re) => re.test(rel))) continue
  const src = readFileSync(file, 'utf8')
  src.split('\n').forEach((line, i) => {
    // Only inline style objects — a className is a stylesheet's business.
    if (!/style=\{\{|style=\{/.test(line) && !/(?:color|background|borderColor)\s*:\s*'#/.test(line)) return
    // A STICKER: the same declaration carries both a light fill and a dark ink.
    // The pair is self-consistent on any background — it is a coloured tile with
    // its own label, like the pathway cards and the folder tiles — so it stays
    // readable in every theme and is not a finding. Counting these would bury
    // the real ones, which is what matters when the number is the signal.
    const fills = [...line.matchAll(/(?:bg|background|backgroundColor)\s*:\s*'(#[0-9a-fA-F]{3,6})'/g)]
      .map((x) => x[1].toLowerCase())
    const paired = fills.some((h) => lum(h) > LIGHT_BG)

    for (const m of line.matchAll(/(color|background|backgroundColor|borderColor)\s*:\s*'(#[0-9a-fA-F]{3,6})'/g)) {
      const [, prop, hex] = m
      const h = hex.toLowerCase()
      if (BRAND.has(h)) continue
      // Inside a gradient it is a band, not a surface.
      if (/gradient\([^)]*\)/.test(line) && line.indexOf('gradient') < m.index) continue
      const L = lum(h)
      const isInk = prop === 'color'
      if (isInk && L < DARK_INK && !paired) findings.push({ rel, line: i + 1, prop, hex, kind: 'dark ink' })
      else if (!isInk && prop !== 'borderColor' && L > LIGHT_BG && !/color\s*:\s*'#/.test(line)) {
        findings.push({ rel, line: i + 1, prop, hex, kind: 'light fill' })
      }
    }
  })
}

if (!findings.length) {
  console.log('inline theme literals: none. ok')
  process.exit(0)
}
const byFile = {}
for (const f of findings) (byFile[f.rel] ||= []).push(f)
console.log(`${findings.length} inline colour literals on themed surfaces, in ${Object.keys(byFile).length} files\n`)
for (const [rel, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rel}  (${list.length})`)
  for (const f of list.slice(0, 6)) console.log(`      :${f.line}  ${f.prop}: ${f.hex}   ${f.kind}`)
  if (list.length > 6) console.log(`      …and ${list.length - 6} more`)
}
process.exit(1)
