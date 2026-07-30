/**
 * Documents are never themed.
 *
 * Invariant: the workspace theme colours the APP. A lesson plan, assessment
 * paper or timetable exported to Word, PDF or the print window must come out
 * identical whichever theme the teacher happens to be on — and above all,
 * Night must never produce a dark-background document. A school prints these
 * on a shared laser printer and photocopies the master; a dark page is a
 * ruined ream of paper and a teacher who cannot use the product.
 *
 * The failure mode this guards is quiet and one-directional: exporters build
 * HTML strings, and reaching for `var(--zt-accent)` to colour a heading is
 * the natural thing to write. It looks perfect in the studio preview (which
 * IS themed) and only goes wrong on the printed page, in a theme the author
 * was not using, on someone else's machine.
 *
 * So the rule is mechanical: no exporter may reference a teacher theme
 * token, in any form. Print styling stays literal and self-contained.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { TOKEN_PREFIX } from '../contexts/teacherThemeCore.js'

const here = dirname(fileURLToPath(import.meta.url))

// Everything that renders a document the user downloads or prints.
const EXPORT_FILE = /(toDocx|toPdf|printable|Export|htmlToPdf|paperPagination)/i

const files = readdirSync(here)
  .filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))
  .filter((f) => !f.includes('.test.') && !f.includes('.spec.'))
  .filter((f) => EXPORT_FILE.test(f))

assert.ok(
  files.length >= 10,
  `expected to find the exporter modules in src/utils; found ${files.length}. ` +
  'If they moved, update this guard rather than deleting it.',
)

const offenders = []
for (const file of files) {
  const src = readFileSync(join(here, file), 'utf8')
  // Both the custom property and the Tailwind classes bound to it. A class
  // like `bg-surface` in an exporter's HTML string is the same leak.
  const hits = [
    ...src.matchAll(new RegExp(`${TOKEN_PREFIX}[\\w-]+`, 'g')),
    ...src.matchAll(/\b(?:bg|text|border)-(?:sidebar|surface|card-border|accent-deep|accent-text|on-accent|ink-muted)\b/g),
  ]
  for (const hit of hits) {
    const line = src.slice(0, hit.index).split('\n').length
    offenders.push(`${file}:${line} — ${hit[0]}`)
  }
}

assert.equal(
  offenders.length,
  0,
  'Exporters must not reference teacher theme tokens — documents are not themed:\n  ' +
  offenders.join('\n  '),
)

/*
 * The paths the print/PDF window actually renders through must also carry
 * their own colours. `buildPrintableHtml` is handed to a fresh window with no
 * app stylesheet attached, so a token there would resolve to nothing and
 * print as transparent-on-white — invisible text rather than an obvious
 * break. Assert it inlines a literal white page background.
 */
const printable = readFileSync(resolve(here, 'printableModel.js'), 'utf8')
assert.ok(
  !printable.includes(TOKEN_PREFIX),
  'printableModel.js must not reference teacher theme tokens',
)

/*
 * The PDF path rasterises into a detached iframe carrying its own document,
 * which is WHY the app's theme cannot reach it — an iframe document does not
 * inherit the parent's stylesheet or its `data-theme` attribute. That
 * isolation is structural, but the white page behind the raster is not: it
 * is an explicit argument, and dropping it would let the canvas default to
 * transparent and composite against whatever is behind it. On Night that is
 * a dark page, and the failure would appear only in the downloaded file.
 */
const pdf = readFileSync(resolve(here, 'htmlToPdf.js'), 'utf8')
assert.match(
  pdf,
  /backgroundColor:\s*'#ffffff'/,
  'htmlToPdf must force an explicit white page background for the raster',
)
assert.match(
  pdf,
  /background:#fff/,
  'htmlToPdf must give the render iframe an explicit white background',
)

/*
 * The fourth path to paper is the plainest one: a teacher pressing Ctrl-P on
 * a studio page. That prints the LIVE document through index.css's
 * `@media print` block, which resets the palette tokens back to black-on-white
 * — but only on the elements it names.
 *
 * That distinction is the whole bug. A custom property declared on an element
 * beats one inherited from an ancestor, and `!important` does not change that:
 * it decides which declaration wins ON THAT ELEMENT, not whether an ancestor's
 * declaration outranks a descendant's. `.studio-theme` re-declares --bg /
 * --card / --text on the studio shell, so it sailed through a reset aimed at
 * `:root, body` and printed Night's #232D3B card with pale ink.
 *
 * So the rule is: every scope that re-declares the palette on an inner element
 * must also appear in the print reset. Enumerating them in CSS is unavoidable
 * — there is no selector for "any element that declares --bg" — which makes
 * the list exactly the kind of thing that goes stale the next time a surface
 * gets its own palette. This reads both out of the stylesheet and compares
 * them.
 */
// Comments are stripped first: the rule splitter below treats everything
// between `}` and the next `{` as a selector list, and these palette blocks
// are heavily commented — without this, every word of the prose above a rule
// is read as a selector.
const css = readFileSync(resolve(here, '../index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Split a selector list on TOP-LEVEL commas only.
 *
 * `a, b` is two selectors; `:is(a, b) c` is one. A naive `.split(',')` turns
 * the second into `:is(a` and `b) c`, and the subject it then reads off the
 * first fragment — `:is(a` — matches nothing in the print reset, so the guard
 * reports a scope that does not exist and stays silent about the real one.
 * That is not hypothetical: it is what happened the day the pinned-palette
 * remap grew a second dark hook and became `:is(body.theme-midnight,
 * html[data-theme='night'] body) .force-light-theme`.
 */
function splitSelectorList(list) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1 }
  }
  out.push(list.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

const printBlockStart = css.indexOf('@media print {')
assert.ok(printBlockStart > 0, 'index.css no longer has an @media print block')
const screenCss = css.slice(0, printBlockStart)
const printCss = css.slice(printBlockStart)

const printReset = printCss.match(/([^{}]+)\{[^{}]*--bg:\s*#ffffff\s*!important/)
assert.ok(printReset, 'the @media print palette reset no longer sets --bg to white')
const printScopes = splitSelectorList(printReset[1])

/**
 * A scope "re-declares the palette" if it sets --bg or --card. Scopes that
 * only tune one token (a component's --text-muted, say) inherit the rest and
 * so are already reset through their ancestor.
 *
 * Two deliberate exclusions:
 *  - `body` / `:root` / `.reading-swatch[…]` — the first two ARE the reset's
 *    own targets; the swatch is a picker preview whose entire job is to show
 *    a palette, and printing it as four white squares would be the bug.
 *  - selectors already scoped to <body> by a body class are still listed when
 *    their subject is an inner element (`body.theme-x .marketing-page`), which
 *    is why the check compares the SUBJECT — the last compound — rather than
 *    the whole selector.
 */
const subjectOf = (sel) => sel.trim().split(/\s+/).pop()
const EXEMPT = /^(:root|body|html|\.reading-swatch)/

const declaringScopes = new Set()
for (const m of screenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/--bg\s*:|--card\s*:/.test(m[2])) continue
  for (const sel of splitSelectorList(m[1])) {
    const subject = subjectOf(sel)
    if (!subject || subject.startsWith('/*') || EXEMPT.test(subject)) continue
    declaringScopes.add(subject)
  }
}

assert.ok(
  declaringScopes.size >= 5,
  `expected to find the palette scopes in index.css; found ${declaringScopes.size}. ` +
  'If the parser has drifted, fix it rather than deleting this guard.',
)

// A scope is covered when the print reset names it, or names a pattern that
// matches it (`[class*="quiz-theme-"]` covers all seven mascot palettes).
const covered = (subject) =>
  printScopes.some((p) => {
    if (p === subject) return true
    const attr = p.match(/^\[class\*=["']([^"']+)["']\]$/)
    return attr ? subject.includes(attr[1]) : false
  })

const uncovered = [...declaringScopes].filter((s) => !covered(s))
assert.deepEqual(
  uncovered,
  [],
  'These scopes re-declare the palette on an inner element but are not reset by ' +
  '@media print, so a themed page prints in its screen colours:\n  ' +
  uncovered.join('\n  '),
)

console.log(
  `✓ export theme isolation — ${files.length} exporter modules carry no theme tokens; ` +
  `${declaringScopes.size} palette scopes reset for print`,
)
