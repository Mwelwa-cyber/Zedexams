/**
 * src/utils/textJunk.js
 *
 * Single source of truth for stripping "junk" characters that DOCX-to-text
 * conversion leaves in imported question content. ECZ past papers -- and
 * Expressive Arts papers in particular (compound words that Word
 * auto-hyphenates, scanned/OCR pages, heavy formatting runs) -- frequently
 * carry these artefacts, which then render as stray boxes, "?" glyphs, or
 * phantom hyphens in the Past Paper Studio and quiz surfaces.
 *
 * Applied in TWO places by design:
 *   1. At import time  -- cleanImportedText (documentQuizParserCore.js), so
 *      newly imported / re-imported papers are stored clean.
 *   2. At render time  -- extractPlainText (richPlainText.js), sanitizeHTML
 *      (editor/utils/sanitize.js), and richTextToPlainText (quizRichText.js),
 *      so content ALREADY stored in Firestore renders clean without a data
 *      migration.
 *
 * What is stripped (and why each is safe):
 *   - U+FFFD                replacement char; only ever appears on an encoding
 *                           error, never in legitimate text.
 *   - U+FEFF                BOM / zero-width no-break space from Word headers
 *                           and merged-cell artefacts.
 *   - U+200B..U+200D,
 *     U+2060..U+2064        zero-width / invisible joiners and math operators.
 *   - U+00AD                soft hyphen; invisible in most renderers but shows
 *                           as a literal '-' in some (seen in Expressive Arts).
 *   - U+0000..U+001F except
 *     TAB / LF / CR         C0 control chars (NUL, BEL, ...) from binary artefacts.
 *   - U+007F                DEL control char.
 *   - U+0080..U+009F        C1 control chars (Windows-1252 control range) emitted
 *                           when the document encoding is mis-identified.
 *
 * Deliberately NOT touched: every other non-ASCII character. Legitimate accented
 * letters, Cinyanja orthography, em-dashes, real musical/art glyphs, and U+00A0
 * (non-breaking space -- callers normalise that to a space themselves) all pass
 * through untouched.
 *
 * Implemented as a code-point scan (rather than a regex literal) on purpose: it
 * keeps this module pure ASCII, so the very control/invisible characters it
 * targets can never end up embedded in the source itself.
 */

// [lo, hi] inclusive code-point ranges to remove. TAB (0x09), LF (0x0A) and
// CR (0x0D) are intentionally left out of the C0 range so newlines and
// table-cell tabs survive.
const JUNK_RANGES = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x007f],
  [0x0080, 0x009f],
  [0x00ad, 0x00ad],
  [0x200b, 0x200d],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
]

function isJunkCode(code) {
  for (let i = 0; i < JUNK_RANGES.length; i++) {
    if (code >= JUNK_RANGES[i][0] && code <= JUNK_RANGES[i][1]) return true
  }
  return false
}

export function stripImportJunkChars(value) {
  const str = String(value ?? '')
  // Fast path: most strings are clean, so avoid building a new string.
  let hasJunk = false
  for (let i = 0; i < str.length; i++) {
    if (isJunkCode(str.charCodeAt(i))) { hasJunk = true; break }
  }
  if (!hasJunk) return str

  let out = ''
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (!isJunkCode(str.charCodeAt(i))) out += ch
  }
  return out
}
