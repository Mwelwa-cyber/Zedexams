"use strict";

/**
 * The processed-webhook-event ledger (SECURITY_ENDPOINT_AUDIT.md §4.1).
 *
 * `processedWebhookEvents/{eventKey}` is claimed with a transactional create,
 * so the FIRST delivery of an event wins and every redelivery loses — atomically,
 * even when two of Lenco's retries land on two instances at the same moment.
 *
 * This is defence-in-depth, not the primary protection. Lenco replay safety
 * already rests on idempotent, status-guarded activation and WhatsApp on
 * per-message dedupe; both hold today. What the ledger adds is (a) a bound on
 * the COST of a replayed WhatsApp message — an Anthropic call plus an outbound
 * send, neither of which is idempotent — and (b) a floor under any future
 * handler that forgets to be idempotent.
 *
 * Because it is a second layer over a working first one, it FAILS OPEN: if the
 * ledger cannot be reached, the event is processed anyway and the degradation is
 * logged. A ledger that blocked a real payment webhook during a Firestore blip
 * would cause precisely the outcome it exists to prevent.
 *
 * Server-only: no rule in firestore.rules matches this collection, so every
 * client read and write is denied by absence (`test:rules-text` pins that).
 */

const admin = require("firebase-admin");
const {
  DEFAULT_TTL_MS,
  buildEventKey,
  classifyClaim,
} = require("./webhookEventLedgerCore");

const COLLECTION = "processedWebhookEvents";

/**
 * Claim one webhook delivery.
 *
 * @param {object} args
 * @param {object} [args.db] Firestore instance; defaults to admin.firestore().
 * @param {string} args.provider 'lenco' | 'whatsapp'
 * @param {Array<string>|null} args.parts Identity components, from
 *   lencoEventParts()/whatsappEventParts(). Null means the payload carried
 *   nothing identifying — the event is processed and nothing is written.
 * @param {object} [args.meta] Readable fields stored alongside, for ops.
 * @param {number} [args.ttlMs]
 * @param {number} [args.now] Injectable clock for tests.
 * @returns {Promise<{shouldProcess: boolean, outcome: string, key: (string|null)}>}
 */
async function claimWebhookEvent({db, provider, parts, meta = {}, ttlMs = DEFAULT_TTL_MS, now = Date.now()}) {
  if (!parts) {
    // Not identifiable → cannot dedupe it. Process it; the primary protections
    // still apply. Inventing a key here would risk colliding two real events.
    return {shouldProcess: true, outcome: "unidentified", key: null};
  }

  const key = buildEventKey({provider, parts});
  const firestore = db || admin.firestore();
  const ref = firestore.collection(COLLECTION).doc(key);

  let createError = null;
  try {
    await firestore.runTransaction(async (tx) => {
      // create() throws if the document exists — that IS the dedupe, and it is
      // atomic against a concurrent retry on another instance. A read-then-write
      // would leave a window two simultaneous deliveries could both pass.
      tx.create(ref, {
        provider,
        ...meta,
        receivedAt: admin.firestore.Timestamp.fromMillis(now),
        // TTL policy field — configured out-of-band, like webauthnChallenges.
        expiresAt: admin.firestore.Timestamp.fromMillis(now + ttlMs),
      });
    });
  } catch (err) {
    createError = err;
  }

  const {outcome, shouldProcess} = classifyClaim({createError});
  if (outcome === "replay") {
    console.warn(`[webhookLedger:${provider}] duplicate delivery ignored`, {key});
  } else if (outcome === "degraded") {
    // Loud: the ledger is down, so replay protection is back to the primary
    // layer alone. Not an error for the request, which proceeds normally.
    console.error(
        `[webhookLedger:${provider}] ledger unavailable — processing without dedupe`,
        createError?.message || createError,
    );
  }
  return {shouldProcess, outcome, key};
}

module.exports = {COLLECTION, claimWebhookEvent};
