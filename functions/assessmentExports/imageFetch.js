/**
 * Fetch question/passage diagram bytes for embedding into an export, with:
 *   - deduplication (one fetch per distinct URL, however many questions use it)
 *   - bounded concurrency (never open more than N sockets at once — a
 *     diagram-heavy paper must not exhaust memory/sockets: Phase 6)
 *   - a per-image timeout + size cap (a slow/huge asset degrades to a
 *     placeholder rather than hanging or OOM-ing the whole export)
 *   - admin-bucket reads for firebasestorage URLs (no token/CORS dependence),
 *     falling back to a plain https fetch for anything else.
 *
 * Returns { url -> { buffer } } for the assets that loaded; a URL absent from
 * the map renders as the visible "[Figure could not be loaded]" placeholder.
 */

const MAX_CONCURRENCY = 4;
const PER_IMAGE_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB hard cap per image

/** Parse a firebasestorage download URL into { bucket, path }, or null. */
function parseFirebaseStorageUrl(url) {
  try {
    const u = new URL(url);
    if (!/firebasestorage\.googleapis\.com$/.test(u.hostname) &&
        !/\.firebasestorage\.app$/.test(u.hostname)) {
      // storage.googleapis.com/{bucket}/{path} form
      if (u.hostname === "storage.googleapis.com") {
        const parts = u.pathname.replace(/^\//, "").split("/");
        const bucket = parts.shift();
        const path = decodeURIComponent(parts.join("/"));
        return bucket && path ? {bucket, path} : null;
      }
      return null;
    }
    // /v0/b/{bucket}/o/{encodedPath}
    const m = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!m) return null;
    return {bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2])};
  } catch {
    return null;
  }
}

/** Read one image → Buffer, or null on any failure (never throws). */
async function fetchOne(url, admin) {
  try {
    const gs = parseFirebaseStorageUrl(url);
    if (gs && admin) {
      const file = admin.storage().bucket(gs.bucket).file(gs.path);
      const [buf] = await file.download();
      if (buf && buf.length && buf.length <= MAX_IMAGE_BYTES) return buf;
      return null;
    }
    // Plain https fetch with a timeout guard.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_IMAGE_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {signal: controller.signal});
      if (!resp.ok) return null;
      const len = Number(resp.headers.get("content-length") || 0);
      if (len && len > MAX_IMAGE_BYTES) return null;
      const arr = Buffer.from(await resp.arrayBuffer());
      return arr.length && arr.length <= MAX_IMAGE_BYTES ? arr : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Fetch all distinct image URLs with bounded concurrency.
 * @param {string[]} urls
 * @param {object} admin firebase-admin (optional; used for bucket reads)
 * @returns {Promise<Object<string,{buffer:Buffer}>>}
 */
async function fetchImages(urls, admin) {
  const distinct = [...new Set((urls || []).filter(Boolean))];
  const out = {};
  let cursor = 0;
  async function worker() {
    while (cursor < distinct.length) {
      const idx = cursor;
      cursor += 1;
      const url = distinct[idx];
      const buf = await fetchOne(url, admin);
      if (buf) out[url] = {buffer: buf};
    }
  }
  const workers = Array.from({length: Math.min(MAX_CONCURRENCY, distinct.length)}, () => worker());
  await Promise.all(workers);
  return out;
}

module.exports = {fetchImages, parseFirebaseStorageUrl, MAX_CONCURRENCY, MAX_IMAGE_BYTES};
