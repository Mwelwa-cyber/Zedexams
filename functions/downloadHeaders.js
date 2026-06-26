/**
 * Pure helpers for download responses — no firebase requires, so a plain `node`
 * test can exercise them without the functions/ deps installed.
 */

/** Strip characters illegal in a filename; keep it readable. Caps length. */
function sanitizeFilename(name, fallback = "download") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
    .trim();
  return cleaned || fallback;
}

/**
 * RFC 6266 Content-Disposition with an ASCII fallback plus the UTF-8 form, so
 * the filename survives non-ASCII names on every browser's download manager.
 */
function contentDispositionFor(name) {
  const n = sanitizeFilename(name);
  const ascii = n.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

module.exports = {sanitizeFilename, contentDispositionFor};
