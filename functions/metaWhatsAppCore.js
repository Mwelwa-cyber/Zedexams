/**
 * Pure, dependency-free core for the Meta WhatsApp inbound webhook.
 *
 * Split out from metaWhatsApp.js (which pulls firebase-functions/params for the
 * secrets) so this logic unit-tests under plain `node` with NO Firebase deps —
 * the same pattern as visualSafetyCore.js. Only Node built-ins (crypto) here.
 *
 * metaWhatsApp.js re-exports these and adds the secret-reading wrappers.
 */

const crypto = require("crypto");

/**
 * GET webhook verification handshake (pure). Meta calls the webhook with
 * `?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<nonce>` when you
 * subscribe; echo `hub.challenge` ONLY when mode is `subscribe` and the token
 * matches the expected verify token.
 *
 * @param {Object} args
 * @param {Object} args.query          The request query map.
 * @param {string} args.expectedToken  META_WHATSAPP_VERIFY_TOKEN value.
 * @returns {{ok: boolean, challenge?: string, reason?: string}}
 */
function verifyWebhookSubscriptionMatch({query, expectedToken}) {
  if (!expectedToken) return {ok: false, reason: "verify-token-not-configured"};
  const mode = query?.["hub.mode"];
  const token = query?.["hub.verify_token"];
  const challenge = query?.["hub.challenge"];
  if (mode !== "subscribe") return {ok: false, reason: "bad-mode"};
  if (String(token == null ? "" : token) !== String(expectedToken)) {
    return {ok: false, reason: "bad-verify-token"};
  }
  return {ok: true, challenge: String(challenge == null ? "" : challenge)};
}

/**
 * Validate Meta's `X-Hub-Signature-256` header against the raw request body
 * using HMAC-SHA256 keyed with the app secret. Constant-time compare; returns
 * false (fail-closed) on any malformed input.
 *
 * @param {Object} args
 * @param {Buffer|string} args.rawBody
 * @param {string} args.signature   The `sha256=...` header value.
 * @param {string} args.appSecret   META_WHATSAPP_APP_SECRET.
 * @returns {boolean}
 */
function verifyWebhookSignature({rawBody, signature, appSecret}) {
  if (!appSecret || !signature || rawBody == null) return false;
  const sig = String(signature).trim();
  const prefix = "sha256=";
  if (!sig.startsWith(prefix)) return false;
  const provided = sig.slice(prefix.length);
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = crypto.createHmac("sha256", appSecret).update(body).digest("hex");

  const a = Buffer.from(provided.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (_e) {
    return false;
  }
}

/**
 * Flatten a Meta webhook POST body into the inbound text messages we act on.
 * Meta nests events as entry[].changes[].value.messages[]; the sender's display
 * name lives in the sibling `contacts[]` array. Keeps only `text` messages and
 * ignores status callbacks (delivered/read) + unsupported media.
 *
 * @param {Object} body  Parsed JSON webhook body.
 * @returns {Array<{from: string, messageId: string, text: string,
 *                  timestamp: number|null, name: string|null, type: string}>}
 */
function parseInboundMessages(body) {
  const out = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (!messages.length) continue;
      const names = {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const c of contacts) {
        if (c?.wa_id) names[c.wa_id] = c?.profile?.name || null;
      }
      for (const msg of messages) {
        if (!msg || msg.type !== "text") continue;
        const text = String(msg?.text?.body || "").trim();
        if (!text) continue;
        const from = String(msg.from || "").replace(/[^\d]/g, "");
        if (!from) continue;
        const tsSec = Number(msg.timestamp);
        out.push({
          from,
          messageId: String(msg.id || ""),
          text,
          timestamp: Number.isFinite(tsSec) ? tsSec * 1000 : null,
          name: names[from] || null,
          type: "text",
        });
      }
    }
  }
  return out;
}

module.exports = {
  verifyWebhookSubscriptionMatch,
  verifyWebhookSignature,
  parseInboundMessages,
};
