/**
 * The .docx assertions every studio exporter must satisfy, as one copy shared
 * by the tests that make them.
 *
 * Extracted from docxExporters.test.js when the flashcard exporter moved into
 * src/features/flashcards/ (architecture.md Phase 2), for the same reason as
 * printableHtmlChecks.js: a feature colocates its own case, but the PROPERTIES
 * are common to all fifteen exporters, and a duplicated copy is how two of them
 * end up checking different things about the same watermark.
 *
 * Lives in src/utils/ because the exporters it describes are still here; it
 * moves with them when the Export Engine is built (architecture.md §12).
 */

import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'

/**
 * A .docx is a ZIP of XML parts. Unzip one and hand back the parts the
 * assertions read: the body, every header part joined, and the footers.
 */
export async function unzipDoc(doc) {
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const names = Object.keys(files)
  const headerXml = names
    .filter((n) => /word\/header\d+\.xml/.test(n))
    .map((n) => strFromU8(files[n]))
    .join('')
  const footerNames = names.filter((n) => /word\/footer\d+\.xml/.test(n))
  const footerXml = footerNames.map((n) => strFromU8(files[n])).join('')
  return {
    docXml: strFromU8(files['word/document.xml']),
    headerXml,
    footerNames,
    footerXml,
  }
}

/**
 * Build one exporter's document twice — free-plan and paid — and assert the
 * body content plus the attribution invariant in both directions.
 *
 * @param {{build: (opts: object) => unknown, expected: string[], attribution?: boolean}} testCase
 * @param {(cond: boolean, msg: string) => void} assert the caller's assertion fn
 */
export async function assertExporterDocument({ build, expected, attribution }, assert) {
  // Free-plan export: body content + watermark header + attribution footer.
  const branded = await unzipDoc(await build({ attribution: true }))
  for (const s of expected) {
    assert(branded.docXml.includes(s), `body contains ${JSON.stringify(s)}`)
  }
  if (!attribution) return

  assert(branded.headerXml.includes('textpath'), 'attribution:true — header part carries the diagonal watermark')
  assert(branded.footerNames.length >= 1, 'attribution:true — document carries a real footer part')
  assert(branded.footerXml.includes('Made with ZedExams'), 'attribution:true — footer carries the attribution line')

  // Paid/admin export stays clean — no branding anywhere. (A footer part may
  // legitimately exist for page furniture, e.g. the Record of Work's
  // "Page X of Y"; the invariant is no ATTRIBUTION, not no footer.)
  const clean = await unzipDoc(await build({ attribution: false }))
  assert(!clean.headerXml.includes('textpath'), 'attribution:false — no watermark in any header part')
  assert(!clean.footerXml.includes('Made with ZedExams'), 'attribution:false — no attribution line in any footer part')
}
