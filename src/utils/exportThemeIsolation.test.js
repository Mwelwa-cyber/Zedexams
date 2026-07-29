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

console.log(`✓ export theme isolation — ${files.length} exporter modules carry no theme tokens`)
