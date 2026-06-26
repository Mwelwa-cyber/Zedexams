/**
 * Same-origin image proxy — server-side byte read for studio exporters.
 *
 * Why this exists
 *   The Word/PDF exporters read an image's BYTES (DOCX: fetch(url,{mode:'cors'});
 *   PDF: html2canvas useCORS). That cross-origin read fails whenever the Storage
 *   bucket's CORS config is missing or was applied to the wrong bucket name
 *   (`examsprepzambia.firebasestorage.app` vs the older `.appspot.com`). The
 *   image still DISPLAYS in the studio (a plain <img> needs no CORS) but vanishes
 *   from the download, leaving the dashed-red "Figure could not be embedded"
 *   placeholder — even after the cache-poisoning retry, because the bucket
 *   itself returns no Access-Control-Allow-Origin header.
 *
 *   The browser hits same-origin `/api/image-proxy?url=<storage url>` (Hosting
 *   rewrites it to this function), we fetch the bytes here — where CORS does not
 *   apply — and stream them back with permissive CORS headers. The download then
 *   embeds the figure regardless of the bucket's CORS state.
 *
 * Security
 *   This is a public GET, so it must not become an open proxy / SSRF vector.
 *   Two gates: the target host must be a Google Storage host, AND the bucket
 *   must belong to THIS Firebase project. Anything else is rejected before any
 *   outbound fetch. Only GET is allowed; only image/* responses are streamed.
 */

const {onRequest} = require("firebase-functions/v2/https");
const {resolveStorageTarget} = require("./imageProxyCore");

// The bucket embedded in the URL must belong to this project (see
// imageProxyCore). GCLOUD_PROJECT is set in the Functions runtime.
const PROJECT_ID = process.env.GCLOUD_PROJECT || "examsprepzambia";

// Max bytes we'll stream — diagrams/uploads are well under this; the cap stops
// the proxy being abused to shuttle large files.
const MAX_BYTES = 15 * 1024 * 1024;

const apiImageProxy = onRequest(
  {region: "us-central1", timeoutSeconds: 60, memory: "256MiB", cors: true},
  async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      res.status(405).send("Use GET.");
      return;
    }

    const target = resolveStorageTarget(
      String((req.query && req.query.url) || ""),
      PROJECT_ID,
    );
    if (!target) {
      res.status(400).send("Invalid or unsupported image URL.");
      return;
    }

    try {
      const upstream = await fetch(target);
      if (!upstream.ok) {
        res.status(upstream.status === 404 ? 404 : 502)
          .send("Could not fetch the image.");
        return;
      }
      const contentType = upstream.headers.get("content-type") || "image/png";
      if (!/^image\//i.test(contentType)) {
        res.status(415).send("Target is not an image.");
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        res.status(413).send("Image too large to proxy.");
        return;
      }

      res.set("Content-Type", contentType);
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.set("X-Content-Type-Options", "nosniff");
      // Safe to cache: the bytes are immutable for a given Storage URL+token.
      res.set("Cache-Control", "public, max-age=86400");
      res.status(200).send(req.method === "HEAD" ? undefined : buf);
    } catch (err) {
      console.error("[apiImageProxy] failed", err);
      res.status(502).send("Could not fetch the image.");
    }
  },
);

module.exports = {apiImageProxy};
