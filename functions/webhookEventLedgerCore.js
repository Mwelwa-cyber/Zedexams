"use strict";

/**
 * Pure decisions for the processed-webhook-event ledger
 * (SECURITY_ENDPOINT_AUDIT.md §4.1). No Firebase, no I/O — testable under
 * plain `node`, per the *Core.js convention.
 *
 * ## What "the same event" means, and why it is not "the same payment"
 *
 * The obvious key — Lenco's collection id — is WRONG, and wrong in the
 * expensive direction. Lenco sends several webhooks across one payment's life
 * (pending, then successful or failed) and they all carry the SAME collection
 * id and the same reference. Keyed on that alone, the ledger would treat the
 * `successful` event as a replay of the `pending` one, drop it, and the buyer
 * would never be granted access. A dedupe that silently loses real payments is
 * far worse than the replay it prevents.
 *
 * So an event's identity is what the event SAYS, not which payment it concerns:
 * reference + type + status. A redelivery repeats all three; a lifecycle
 * transition changes status and is correctly seen as new.
 *
 * WhatsApp is the opposite case: Meta message ids are already unique per
 * message and a redelivery reuses the id, so the id alone IS the identity.
 *
 * ## Ids are hashed, and the readable fields are stored in the document
 *
 * A reference is provider-controlled text. Firestore document ids cannot
 * contain "/", cannot be "." or "..", cannot match /^__.*__$/ and are capped at
 * 1500 bytes — so using one raw is a latent 500 on a payload we do not control.
 * The key is therefore a digest, and provider/reference/type/status are written
 * as FIELDS so the collection stays greppable in the console.
 */

const crypto = require("node:crypto");

const PROVIDERS = Object.freeze({LENCO: "lenco", WHATSAPP: "whatsapp"});

// 30 days. Long enough that no plausible provider retry window outlives it
// (Lenco retries for hours, Meta for days), short enough that the collection
// does not grow without bound. Enforced by a Firestore TTL policy on
// `expiresAt`, which is configured out-of-band like webauthnChallenges.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Stable id for one webhook delivery.
 * @param {{provider: string, parts: Array<string|null|undefined>}} args
 * @returns {string} `<provider>_<32 hex chars>`
 */
function buildEventKey({provider, parts}) {
  const p = String(provider || "").trim();
  if (!p) throw new Error("buildEventKey: provider is required");
  const list = Array.isArray(parts) ? parts : [];
  // Join with a separator that cannot appear inside a component after
  // stringification, so ["a","b"] and ["a|b"] cannot collide.
  const material = list
      .map((x) => (x === null || x === undefined ? "" : String(x)))
      .map((s) => s.replace(/\|/g, "%7C"))
      .join("|");
  const digest = crypto.createHash("sha256").update(p + "|" + material).digest("hex");
  return `${p}_${digest.slice(0, 32)}`;
}

/**
 * Identity of a Lenco webhook delivery. Returns null when the payload carries
 * nothing that identifies it — an unidentifiable event is NOT claimable, and
 * the caller must process it rather than invent a key that could collide.
 */
function lencoEventParts(event) {
  const ev = event || {};
  const data = ev.data || {};
  const reference = data.reference || data.id || null;
  if (!reference) return null;
  const type = String(ev.event || ev.type || "");
  const status = String(data.status || "");
  return [reference, type, status];
}

/** Identity of one inbound WhatsApp message. Null when Meta sent no id. */
function whatsappEventParts(message) {
  const id = message && message.messageId;
  return id ? [String(id)] : null;
}

/**
 * Decide what a claim attempt means.
 *
 * The ledger is belt-and-braces over paths that are ALREADY replay-safe
 * (idempotent status-guarded activation for Lenco; per-message dedupe for
 * WhatsApp). So a ledger that cannot be reached must never block a real event:
 * a Firestore blip that dropped a payment webhook would cause exactly the
 * failure this collection exists to make less likely. Unavailable → process,
 * loudly.
 *
 * @param {{createError: (Error|null)}} args
 * @returns {{outcome: 'claimed'|'replay'|'degraded', shouldProcess: boolean}}
 */
function classifyClaim({createError}) {
  if (!createError) return {outcome: "claimed", shouldProcess: true};
  const code = createError.code;
  const msg = String(createError.message || "");
  // Firestore surfaces an existing-document create as ALREADY_EXISTS (gRPC 6).
  const alreadyExists =
    code === 6 ||
    code === "already-exists" ||
    /already exists/i.test(msg);
  if (alreadyExists) return {outcome: "replay", shouldProcess: false};
  return {outcome: "degraded", shouldProcess: true};
}

module.exports = {
  PROVIDERS,
  DEFAULT_TTL_MS,
  buildEventKey,
  lencoEventParts,
  whatsappEventParts,
  classifyClaim,
};
