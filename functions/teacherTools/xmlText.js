/**
 * Server-side (CJS) port of src/utils/xmlText.js — XML-text sanitiser for the
 * Cloud-Functions .docx generators.
 *
 * Word refuses to open a .docx whose XML contains characters XML 1.0 forbids.
 * Depending on the Word build this surfaces as "Word found unreadable content …
 * recover" (desktop) or "This version of Word can't open files that contain
 * alternate formats" (Android/mobile — a generic, misleading parse-failure
 * message; our packages contain no mc:AlternateContent). Either way a single
 * illegal character anywhere in the document corrupts the whole package, even
 * though the on-screen preview and the PDF export looked fine.
 *
 * AI-generated teacher content routinely smuggles in two kinds of illegal
 * character: C0 control bytes (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F) plus the two
 * non-characters (0xFFFE / 0xFFFF), and lone/unpaired surrogates (a high or low
 * surrogate without its mate, e.g. from a truncated emoji). Tab/newline/CR are
 * legal XML and kept; valid surrogate pairs (whole emoji) survive intact.
 *
 * The character classes are built from code points (not literal regexes) so the
 * source stays free of raw control bytes and lone surrogate units.
 */

const cc = (n) => String.fromCharCode(n);

const XML_INVALID_CHARS = new RegExp(
  `[${cc(0x00)}-${cc(0x08)}${cc(0x0b)}${cc(0x0c)}${cc(0x0e)}-${cc(0x1f)}${cc(0xfffe)}${cc(0xffff)}]`,
  "g",
);

const HI = `${cc(0xd800)}-${cc(0xdbff)}`;
const LO = `${cc(0xdc00)}-${cc(0xdfff)}`;
const LONE_HIGH_SURROGATE = new RegExp(`[${HI}](?![${LO}])`, "g");
const LONE_LOW_SURROGATE = new RegExp(`(?<![${HI}])[${LO}]`, "g");

function sanitizeXmlText(value) {
  return String(value == null ? "" : value)
    .replace(XML_INVALID_CHARS, "")
    .replace(LONE_HIGH_SURROGATE, "")
    .replace(LONE_LOW_SURROGATE, "");
}

module.exports = { sanitizeXmlText };
