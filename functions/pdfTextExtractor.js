/**
 * Shared PDF → plain-text extraction, built on pdf-parse v2's `PDFParse`
 * class API.
 *
 * Why this module exists (see issue #1884): pdf-parse 2.x is a full ESM
 * rewrite with a breaking API change. The v1 callable default —
 * `const pdfParse = require("pdf-parse"); const {text} = await pdfParse(buf,
 * {max})` — no longer exists. v2 is `"type": "module"` and exposes a
 * `PDFParse` class instead; it ships a CommonJS build via `exports.require`,
 * so `require("pdf-parse")` returns `{PDFParse, …}` (a namespace object, not
 * a callable). Every former call site therefore threw `pdfParse is not a
 * function`. Centralising the v2 shape here means the three former call
 * sites (extractTopicsFromPdf, curriculumIngester.parsePdf, and
 * uploadCurriculumModule via parseDocument) share one migration and one
 * test surface.
 *
 * Contract: this function NEVER throws. It returns a discriminated result so
 * every caller can degrade gracefully (matching the pre-existing
 * curriculumIngester behaviour):
 *
 *   { text, totalPages, parsedPages }        — success (text may be "")
 *   { text: "", unsupported: true, reason }  — pdf-parse not loadable at all
 *   { text: "", error }                      — parse failed (malformed, empty,
 *                                              password-protected, corrupt)
 *
 * The `PDFParse` handle is ALWAYS released via `destroy()` — including on the
 * error path — so a burst of failed extractions can't leak parser/document
 * handles or grow memory.
 */

/**
 * Extract plain text from a PDF buffer.
 *
 * @param {Buffer} buffer Raw PDF bytes.
 * @param {{maxPages?: number}} [options]
 *   maxPages caps how many leading pages are parsed (the v1 `{max}`
 *   equivalent). 0 / omitted / non-positive means "all pages".
 * @returns {Promise<{text:string,totalPages:number,parsedPages:number,
 *   unsupported?:boolean,reason?:string,error?:string}>}
 */
async function extractPdfText(buffer, options = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return {text: "", totalPages: 0, parsedPages: 0};
  }

  const maxPages =
    Number.isInteger(options.maxPages) && options.maxPages > 0 ?
      options.maxPages :
      0;

  // Lazy require so unit tests that mock out the runtime — and the graceful
  // curriculum-ingester degradation path — don't need pdf-parse on disk.
  let PDFParse;
  try {
    ({PDFParse} = require("pdf-parse"));
    if (typeof PDFParse !== "function") {
      throw new Error("PDFParse export is not a constructor");
    }
  } catch (err) {
    return {
      text: "",
      totalPages: 0,
      parsedPages: 0,
      unsupported: true,
      reason: `pdf-parse_missing:${String(err && err.message || err)
          .slice(0, 80)}`,
    };
  }

  let parser;
  try {
    // v2 auto-converts a Node Buffer to a Uint8Array.
    parser = new PDFParse({data: buffer});

    // v2 getText params:
    //   • `first: N`      → parse only the first N pages (the v1 `{max}`
    //                       page-cap equivalent). Omitted = every page.
    //   • `pageJoiner: ""`→ suppress v2's default `-- n of m --` per-page
    //                       marker so the extracted text isn't polluted with
    //                       page-boundary noise (v1 emitted none).
    const params = {pageJoiner: ""};
    if (maxPages > 0) params.first = maxPages;

    const result = await parser.getText(params);
    return {
      text: String(result && result.text || ""),
      totalPages: Number(result && result.total) || 0,
      parsedPages:
        Array.isArray(result && result.pages) ? result.pages.length : 0,
    };
  } catch (err) {
    return {
      text: "",
      totalPages: 0,
      parsedPages: 0,
      error: `pdf_parse_failed:${String(err && err.message || err)
          .slice(0, 120)}`,
    };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (_) {
        // Handle already torn down / document never fully loaded — there is
        // nothing left to release. Never let cleanup mask the real result.
      }
    }
  }
}

module.exports = {extractPdfText};
