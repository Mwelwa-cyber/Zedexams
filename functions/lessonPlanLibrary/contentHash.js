/**
 * The canonical content identity of a library item.
 *
 * ## Why the server computes this and the client never sends it
 *
 * Firestore rules can prove a *relationship* — that content changed exactly
 * when the hash changed, and that the revision advanced by exactly one. They
 * cannot prove the supplied hash actually represents the supplied content. A
 * modified client could post edited content with any hash it liked and the
 * rules would accept it, because from their side the arithmetic is consistent.
 *
 * So the hash is computed here, from the content the server is about to write.
 * The rules stay as defence in depth; they are no longer the only thing
 * standing between a document and a false description of itself.
 *
 * ## What is in it, and what is deliberately not
 *
 * IN: data, html, meta, inputs, studioFormat — everything that makes the
 * artefact what it is.
 *
 * OUT: `library` (which folder it is filed under), `visibility`, timestamps,
 * `revision`, and every origin field. Refiling a plan is not editing it, so it
 * must not advance the revision; and hashing the revision into its own identity
 * would make every save look like a change.
 *
 * Pure — no Firestore, no firebase-functions — so it tests under plain node.
 */

const {createHash} = require("crypto");

/** The fields the hash is computed from, in the order they are serialised. */
const CONTENT_FIELDS = Object.freeze([
  "data", "html", "meta", "inputs", "studioFormat",
]);

/**
 * Deterministic JSON: object keys sorted at every depth, `undefined` dropped.
 *
 * Without this, two saves of an identical plan hash differently whenever the
 * client happens to build an object in a different key order — and the item
 * would gain a revision for an edit nobody made.
 */
function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return value === undefined ? null : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalize(value[key]);
  }
  return out;
}

/**
 * @param {Object} artifact  An object carrying some or all of CONTENT_FIELDS.
 * @returns {string} A stable 64-character hex digest.
 */
function computeContentHash(artifact = {}) {
  const subject = {};
  for (const field of CONTENT_FIELDS) {
    subject[field] = canonicalize(artifact[field] === undefined ? null : artifact[field]);
  }
  return createHash("sha256").update(JSON.stringify(subject), "utf8").digest("hex");
}

module.exports = {CONTENT_FIELDS, canonicalize, computeContentHash};
