/**
 * Same-origin download echo — `/api/download` (Hosting rewrite → this function).
 *
 * Receives a just-generated studio file (base64 in the POST body) and echoes the
 * bytes straight back with a Content-Disposition attachment header carrying the
 * real filename. On browsers that drop the name for in-page blob: downloads
 * (DuckDuckGo, in-app WebViews, older Android), this is what makes the file land
 * as "Grade 4 Integrated Science Lesson Plan - The Eye.docx" — AND, because it
 * comes through the Hosting rewrite, the browser shows it downloading from
 * zedexams.com instead of firebasestorage.googleapis.com.
 *
 * No persistence: the bytes are held in memory for the one request and returned.
 * That's a single round-trip (vs upload → getDownloadURL → fetch for the Storage
 * fallback), so it's also a touch faster.
 *
 * Pure header/parse logic lives in downloadEchoCore.js so it unit-tests without
 * the functions/ deps installed.
 */

const {onRequest} = require("firebase-functions/v2/https");
const {applyCors, isAllowedOrigin, ALLOWED_ORIGINS} = require("./cors");
const {sanitizeType, contentDispositionFor, parseEchoData} =
  require("./downloadEchoCore");

const MAX_BYTES = 25 * 1024 * 1024; // matches the studio export ceiling

// Only our own pages may use the echo, so it can't be abused to mint a
// zedexams.com-branded download of arbitrary attacker content. Form POST
// navigations send Origin (for POST) and Referer; either matching is enough.
function refererAllowed(referer) {
  if (!referer) return false;
  return ALLOWED_ORIGINS.some((o) => referer === o || referer.startsWith(`${o}/`));
}

const apiDownloadEcho = onRequest(
  {region: "us-central1", timeoutSeconds: 60, memory: "256MiB"},
  (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Use POST.");
      return;
    }
    if (!(isAllowedOrigin(req.get("origin")) || refererAllowed(req.get("referer")))) {
      res.status(403).send("Forbidden.");
      return;
    }

    let buf;
    try {
      const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
      const base64 = parseEchoData(raw);
      if (!base64) {
        res.status(400).send("Missing file data.");
        return;
      }
      buf = Buffer.from(base64, "base64");
    } catch (err) {
      res.status(400).send("Bad file data.");
      return;
    }

    if (!buf || buf.length === 0) {
      res.status(400).send("Empty file.");
      return;
    }
    if (buf.length > MAX_BYTES) {
      res.status(413).send("File too large.");
      return;
    }

    const name = String(req.query.name || "download").slice(0, 200);
    res.set("Content-Type", sanitizeType(req.query.type));
    res.set("Content-Disposition", contentDispositionFor(name));
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "no-store");
    res.status(200).send(buf);
  },
);

module.exports = {apiDownloadEcho, refererAllowed};
