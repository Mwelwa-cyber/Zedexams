"use strict";

/**
 * Consent-link tokens.
 *
 * The link in a guardian's email is a bearer credential: whoever holds it can
 * approve or delete a child's account. Two consequences drive everything here.
 *
 * ── The token is stored HASHED ───────────────────────────────────────────
 *
 * The uploaded reference implementation used the raw token as the Firestore
 * document id (`consentRequests/{token}`). That means anyone who can read that
 * collection — a mis-scoped rule, a support export, a backup, a screenshot of
 * the console — holds every live consent link, and can approve or DELETE any
 * pending child's account without ever seeing the email. We store
 * `sha256(token)` as the id instead: a lookup still costs one direct read
 * (no scan), but the database never contains anything that can be replayed.
 * The raw token exists only in the email and in the guardian's URL bar.
 *
 * This is the same reasoning the repo already applies to passkey challenges
 * (`webauthnChallenges` stores hashes) and to password-reset links.
 *
 * ── Comparison is constant-time where it can be ──────────────────────────
 *
 * Lookup by hashed id is inherently safe — the comparison happens inside
 * Firestore's key lookup, and a wrong guess is a missing document. What we
 * must not do is fetch a record and then compare a stored raw token with `===`,
 * so there is deliberately no function here that does that.
 *
 * Pure module apart from `crypto` — no firebase-admin, no I/O.
 */

const crypto = require("crypto");

// 32 bytes of CSPRNG output, hex-encoded. 64 hex characters: long enough that
// guessing is not a threat model, short enough to survive an email client
// wrapping the URL.
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

// How long a guardian has to decide. Long enough for a parent who checks email
// weekly; short enough that a link forwarded, printed, or left in an inbox
// does not stay dangerous forever.
const TOKEN_TTL_DAYS = 7;

function mintToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * The Firestore document id for a token. Never store the raw value.
 */
function tokenDocId(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

/**
 * Shape check before any I/O. A token that cannot possibly be one of ours is
 * rejected without a database read, so a scripted probe costs us nothing.
 */
function isWellFormedToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function expiryFrom(now = new Date(), days = TOKEN_TTL_DAYS) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Build the two links a guardian is offered.
 *
 * Approve and decline are SEPARATE URLS rather than one URL plus a form,
 * because the guardian's mail client may strip anything interactive, and
 * because a decline that requires an extra step is a decline that does not
 * happen.
 *
 * Neither is a GET that acts on its own: both land on a confirmation page
 * that requires a click. An email scanner or link prefetcher following every
 * URL in the message must not silently approve — or silently delete — a
 * child's account, and plenty of corporate mail gateways do exactly that.
 */
function buildConsentLinks(baseUrl, rawToken) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const t = encodeURIComponent(rawToken);
  return {
    approveUrl: `${base}?token=${t}`,
    declineUrl: `${base}?token=${t}&decline=1`,
  };
}

module.exports = {
  TOKEN_BYTES,
  TOKEN_TTL_DAYS,
  TOKEN_PATTERN,
  mintToken,
  tokenDocId,
  isWellFormedToken,
  expiryFrom,
  buildConsentLinks,
};
