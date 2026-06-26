/**
 * Shared XML-text sanitiser for every .docx exporter.
 *
 * Word refuses to open a .docx whose XML contains characters that XML 1.0
 * forbids. Depending on the Word build this surfaces as either:
 *   • desktop  — "Word found unreadable content … Do you want to recover", or
 *   • Android/mobile — "This version of Word can't open files that contain
 *     alternate formats" (the mobile app's generic, misleading parse-failure
 *     message — our packages contain no mc:AlternateContent).
 * Both mean the same thing: a single illegal character anywhere in the file
 * corrupts the whole package, even though the on-screen preview and the PDF
 * export looked fine.
 *
 * AI-generated teacher content (and imported / pasted / OCR'd papers) routinely
 * smuggle in two kinds of illegal character:
 *   1. C0 control bytes (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F) and the two Unicode
 *      non-characters (0xFFFE / 0xFFFF), and
 *   2. lone/unpaired surrogates — a high or low surrogate code unit without its
 *      mate, e.g. left behind when an emoji string is truncated mid-character.
 * Both are forbidden by XML 1.0. Tab (0x09), newline (0x0A) and carriage-return
 * (0x0D) are legal and kept; valid surrogate PAIRS (whole emoji) survive intact.
 *
 * Every exporter funnels its run text (and the document title) through
 * `sanitizeXmlText` so the illegal characters are stripped at one place.
 *
 * This lives in its own tiny module (rather than in any one exporter) so the
 * dozen teacher-tool exporters can share it without pulling a heavy sibling
 * module into their lazily-loaded route chunks.
 *
 * The character classes are built from code points (rather than written as
 * literal regexes) so this source file stays free of raw control bytes and of
 * lone surrogate units — the repo's file-integrity check rejects the former and
 * the latter are not valid in a JS source literal.
 */

const cc = (n) => String.fromCharCode(n)

// XML 1.0 illegal scalar chars: C0 controls except tab/newline/CR, plus the two
// non-characters. Tab (0x09) / newline (0x0A) / CR (0x0D) are deliberately kept.
const XML_INVALID_CHARS = new RegExp(
  `[${cc(0x00)}-${cc(0x08)}${cc(0x0b)}${cc(0x0c)}${cc(0x0e)}-${cc(0x1f)}${cc(0xfffe)}${cc(0xffff)}]`,
  'g',
)

// Lone surrogates: a high surrogate (D800–DBFF) not followed by a low one, or a
// low surrogate (DC00–DFFF) not preceded by a high one. Whole pairs are skipped
// by the look-ahead / look-behind and so are preserved.
const HI = `${cc(0xd800)}-${cc(0xdbff)}`
const LO = `${cc(0xdc00)}-${cc(0xdfff)}`
const LONE_HIGH_SURROGATE = new RegExp(`[${HI}](?![${LO}])`, 'g')
const LONE_LOW_SURROGATE = new RegExp(`(?<![${HI}])[${LO}]`, 'g')

export function sanitizeXmlText(value) {
  return String(value == null ? '' : value)
    .replace(XML_INVALID_CHARS, '')
    .replace(LONE_HIGH_SURROGATE, '')
    .replace(LONE_LOW_SURROGATE, '')
}
