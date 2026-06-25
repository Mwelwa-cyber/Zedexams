/**
 * Meta WhatsApp Business Cloud API helper (audit A3 PR 3).
 *
 * Replaces the earlier Twilio scaffold — Twilio's trial-to-paid
 * transition was a friction we don't need, and Meta's direct API has
 * a generous free tier (1000 service conversations / month) for the
 * volume the parent digest will see for years.
 *
 * Soft-fail by design: callers can invoke `sendWhatsAppDigest()`
 * whether or not the Meta secrets are populated. When unset, it
 * returns `{status: 'skipped', reason: 'meta-not-configured'}` so
 * the cron keeps running cleanly during staged rollout (email-first,
 * WhatsApp later).
 *
 * Required secrets (set via `firebase functions:secrets:set`):
 *
 *   META_WHATSAPP_TOKEN              The "permanent" or temporary Bearer
 *                                    token from your Meta WhatsApp
 *                                    Business App. Found at:
 *                                    Meta for Developers → your app →
 *                                    WhatsApp → API Setup → "Temporary
 *                                    access token" (24h, free, fine for
 *                                    initial testing) OR "System User
 *                                    access token" (permanent, needs
 *                                    business verification).
 *
 *   META_WHATSAPP_PHONE_NUMBER_ID    The numeric ID of your WhatsApp
 *                                    Business sender. NOT the actual
 *                                    phone number — Meta gives a
 *                                    `phone_number_id` like 123456789.
 *                                    Found on the same API Setup page.
 *
 * Optional env var (NOT defineSecret — Firebase enforces values for
 * declared secrets at deploy time, but this one is genuinely optional):
 *
 *   META_WHATSAPP_TEMPLATE_NAME      Name of an approved Message
 *                                    Template registered in your
 *                                    WhatsApp Business account. When
 *                                    set, outbound digests use the
 *                                    template (required for messages
 *                                    outside the 24-hour customer-
 *                                    initiated window in production).
 *                                    The template must accept exactly
 *                                    three body variables in this
 *                                    order: 1=learnerName, 2=summary
 *                                    line ("3 quizzes, avg 78%"),
 *                                    3=share URL.
 *                                    Set as a regular env var via
 *                                    functions/.env.examsprepzambia
 *                                    or the Functions Console — no
 *                                    redeploy needed when you flip it.
 *
 * Test mode (no business verification needed):
 *   - In Meta's API Setup page, the "Test phone number" mode lets
 *     you send to up to 5 verified recipient numbers (you add them
 *     in the "To" dropdown) using free-form text. That's analogous
 *     to Twilio's sandbox — fine for proving the wiring before you
 *     register your own production sender.
 *
 * Phone format:
 *   - Helper normalises Zambian-local (`0977…`) and bare country-code
 *     (`260977…`) inputs to E.164 digits without `+`. Anything
 *     malformed is rejected and the cron falls through to skipped.
 *   - Meta's Graph API expects the `to` field as digits-only E.164
 *     (no `+`, no `whatsapp:` prefix).
 */

const {defineSecret} = require("firebase-functions/params");
const {
  verifyWebhookSubscriptionMatch,
  verifyWebhookSignature,
  parseInboundMessages,
} = require("./metaWhatsAppCore");

const metaWhatsAppToken = defineSecret("META_WHATSAPP_TOKEN");
const metaWhatsAppPhoneNumberId = defineSecret("META_WHATSAPP_PHONE_NUMBER_ID");
// Inbound-webhook secrets (Bonga, the WhatsApp reply agent):
//   META_WHATSAPP_VERIFY_TOKEN  — the arbitrary string you type into Meta's
//                                 "Verify token" box when subscribing the
//                                 webhook. Meta echoes it back on the GET
//                                 verification handshake; we compare + return
//                                 hub.challenge only when it matches.
//   META_WHATSAPP_APP_SECRET    — your Meta App's secret. Used to validate the
//                                 X-Hub-Signature-256 HMAC on every inbound
//                                 POST so a stranger can't forge messages that
//                                 trigger an auto-reply.
const metaWhatsAppVerifyToken = defineSecret("META_WHATSAPP_VERIFY_TOKEN");
const metaWhatsAppAppSecret = defineSecret("META_WHATSAPP_APP_SECRET");

// Exported so the consuming function can declare them in its
// `secrets: [...]` block.
const WHATSAPP_SECRETS = [
  metaWhatsAppToken,
  metaWhatsAppPhoneNumberId,
];

// The inbound webhook uses the two outbound secrets plus the verify token +
// app secret when available. The inbound secrets are intentionally NOT bound
// here so the deploy succeeds before they are stored in Secret Manager.
// readSecret() returns "" for an unbound secret, causing the handshake and
// HMAC checks to fail-closed (403) until the secrets are configured.
const WHATSAPP_WEBHOOK_SECRETS = [
  metaWhatsAppToken,
  metaWhatsAppPhoneNumberId,
];

const META_GRAPH_VERSION = "v21.0";

function readSecret(secret) {
  try {
    return String(secret.value() || "").trim();
  } catch (_err) {
    // Secret not bound at runtime (local dev). Treat as unset.
    return "";
  }
}

function readTemplateName() {
  return String(process.env.META_WHATSAPP_TEMPLATE_NAME || "").trim();
}

function isConfigured() {
  return Boolean(
      readSecret(metaWhatsAppToken) &&
      readSecret(metaWhatsAppPhoneNumberId),
  );
}

/**
 * Normalise an arbitrary phone-number string to a Meta-compatible
 * E.164 digit string (no `+`, no `whatsapp:` prefix). Returns null
 * on anything malformed so the caller can audit a `skipped` row
 * instead of crashing.
 */
function normalizeToWhatsApp(rawPhone, {defaultCountryCode = "260"} = {}) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/[^\d]/g, "");
  if (!digits) return null;

  let national;
  if (digits.startsWith(defaultCountryCode) &&
      digits.length >= defaultCountryCode.length + 7 &&
      digits.length <= defaultCountryCode.length + 12) {
    national = digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    // Zambian local format: 0977740465 → 260977740465.
    national = `${defaultCountryCode}${digits.slice(1)}`;
  } else if (digits.length === 9) {
    // Bare 9-digit national (no leading zero): 977740465 → 260977740465.
    national = `${defaultCountryCode}${digits}`;
  } else if (digits.length >= 10 && digits.length <= 15) {
    // Already a full international number with some other country code.
    national = digits;
  } else {
    return null;
  }

  if (!/^[1-9]\d{6,14}$/.test(national)) return null;
  return national;
}

/**
 * Send a WhatsApp message via Meta's Graph API. Soft-fails if the
 * Meta secrets aren't configured.
 *
 * @param {Object} args
 * @param {string} args.to              Already normalised E.164 digits (no `+`).
 * @param {string} [args.body]          Free-form text (test phone / 24h window).
 * @param {Object} [args.contentVariables]  Map { 1: ..., 2: ..., 3: ... } of
 *                                          positional variables for the
 *                                          configured template (when
 *                                          META_WHATSAPP_TEMPLATE_NAME is set).
 *                                          Keys 1..n become `{{1}}`..`{{n}}`
 *                                          in the template body.
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', messageId?: string,
 *                    messageStatus?: string, httpStatus?: number,
 *                    error?: string, reason?: string}>}
 *
 * On success, `messageId` is the Meta-issued `wamid.…` ID and
 * `messageStatus` is whatever the API reports (typically "accepted",
 * later transitions to "delivered"/"read" via webhook — out of scope
 * here).
 */
async function sendWhatsAppDigest({to, body, contentVariables}) {
  const token = readSecret(metaWhatsAppToken);
  const phoneNumberId = readSecret(metaWhatsAppPhoneNumberId);
  const templateName = readTemplateName();

  if (!token || !phoneNumberId) {
    return {status: "skipped", reason: "meta-not-configured"};
  }
  if (!to || !/^[1-9]\d{6,14}$/.test(to)) {
    return {status: "skipped", reason: "invalid-to-address"};
  }

  let payload;
  if (templateName) {
    // Production template path. Variables become positional `{{1}}`,
    // `{{2}}`, … in the template body; the template must be registered
    // in Meta and approved before this works.
    const components = [];
    if (contentVariables && Object.keys(contentVariables).length > 0) {
      const ordered = Object.keys(contentVariables)
          .map((k) => Number(k))
          .filter((n) => Number.isFinite(n) && n >= 1)
          .sort((a, b) => a - b);
      const parameters = ordered.map((n) => ({
        type: "text",
        text: String(contentVariables[n] || "").slice(0, 1024),
      }));
      if (parameters.length > 0) {
        components.push({type: "body", parameters});
      }
    }
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: {code: "en"},
        components,
      },
    };
  } else {
    // Test-phone / 24h-window path. Free-form text body.
    if (!body) {
      return {status: "skipped", reason: "empty-body"};
    }
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      // WhatsApp body cap is 4096 chars but anything over 1600 is
      // unusable practically. Hard-cap defensively.
      text: {body: body.slice(0, 1600), preview_url: false},
    };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {status: "failed", error: String(err?.message || err).slice(0, 500)};
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Meta returns structured errors — surface the message + code if we
    // can parse them, otherwise the raw text.
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_e) { /* not JSON */ }
    const errMessage = parsed?.error?.message || text || `HTTP ${res.status}`;
    const errCode = parsed?.error?.code != null ? `code=${parsed.error.code}` : "";
    return {
      status: "failed",
      httpStatus: res.status,
      error: `${errMessage} ${errCode}`.trim().slice(0, 500),
    };
  }

  const json = await res.json().catch(() => null);
  // Meta success shape: { messages: [{ id: "wamid..." }], contacts: [...] }
  const messageId = json?.messages?.[0]?.id || null;
  const messageStatus = json?.messages?.[0]?.message_status || "accepted";
  return {
    status: "sent",
    messageId,
    messageStatus,
  };
}

/**
 * Send a free-form WhatsApp text reply. Unlike `sendWhatsAppDigest`, this
 * NEVER uses a message template — it always sends a plain `text` message, which
 * is only deliverable inside WhatsApp's 24-hour customer-service window (i.e.
 * within 24h of the user's last inbound message). Bonga only ever replies to a
 * just-received message, so the window is always open. Soft-fails the same way.
 *
 * @param {Object} args
 * @param {string} args.to    Normalised E.164 digits (no `+`).
 * @param {string} args.body  Reply text.
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', messageId?: string,
 *                    messageStatus?: string, httpStatus?: number,
 *                    error?: string, reason?: string}>}
 */
async function sendWhatsAppText({to, body}) {
  const token = readSecret(metaWhatsAppToken);
  const phoneNumberId = readSecret(metaWhatsAppPhoneNumberId);

  if (!token || !phoneNumberId) {
    return {status: "skipped", reason: "meta-not-configured"};
  }
  if (!to || !/^[1-9]\d{6,14}$/.test(to)) {
    return {status: "skipped", reason: "invalid-to-address"};
  }
  if (!body || !String(body).trim()) {
    return {status: "skipped", reason: "empty-body"};
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {body: String(body).slice(0, 1600), preview_url: false},
  };
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {status: "failed", error: String(err?.message || err).slice(0, 500)};
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_e) { /* not JSON */ }
    const errMessage = parsed?.error?.message || text || `HTTP ${res.status}`;
    const errCode = parsed?.error?.code != null ? `code=${parsed.error.code}` : "";
    return {
      status: "failed",
      httpStatus: res.status,
      error: `${errMessage} ${errCode}`.trim().slice(0, 500),
    };
  }

  const json = await res.json().catch(() => null);
  const messageId = json?.messages?.[0]?.id || null;
  const messageStatus = json?.messages?.[0]?.message_status || "accepted";
  return {status: "sent", messageId, messageStatus};
}

/**
 * GET webhook verification handshake. Reads META_WHATSAPP_VERIFY_TOKEN and
 * delegates the comparison to the pure core. Echoes `hub.challenge` only when
 * mode is `subscribe` and the token matches.
 *
 * @param {Object} query  The request query map (`req.query`).
 * @returns {{ok: boolean, challenge?: string, reason?: string}}
 */
function verifyWebhookSubscription(query) {
  return verifyWebhookSubscriptionMatch({
    query,
    expectedToken: readSecret(metaWhatsAppVerifyToken),
  });
}

/**
 * Secret-aware wrapper around `verifyWebhookSignature` that reads the app
 * secret from the bound Firebase secret. `configured` is false when the secret
 * is unset (staged rollout) so the caller can decide whether to fail closed.
 *
 * @param {Object} args
 * @param {Buffer|string} args.rawBody
 * @param {string} args.signature
 * @returns {{ok: boolean, configured: boolean}}
 */
function verifyInboundSignature({rawBody, signature}) {
  const appSecret = readSecret(metaWhatsAppAppSecret);
  if (!appSecret) return {ok: false, configured: false};
  return {ok: verifyWebhookSignature({rawBody, signature, appSecret}), configured: true};
}

/**
 * Build the WhatsApp message body for a weekly digest. Plain text
 * only — WhatsApp doesn't render HTML. Emoji are fine; UTF-8 throughout.
 */
function buildWhatsAppDigestBody({learnerName, learnerGrade, summary, subjectBreakdown, shareUrl}) {
  const lines = [];
  lines.push(`*${learnerName}'s ZedExams week*`);
  if (learnerGrade) lines.push(`Grade ${learnerGrade}`);
  lines.push("");
  if (summary.totalAttempts === 0) {
    lines.push(`${learnerName} hasn't practised this week — a friendly nudge might help. They can sign in at zedexams.com.`);
  } else {
    lines.push(`• Quizzes done: ${summary.totalAttempts}`);
    if (summary.averagePercentage != null) {
      lines.push(`• Average score: ${summary.averagePercentage}%`);
    }
    lines.push(`• Day streak: ${summary.currentStreak}${summary.currentStreak > 0 ? " 🔥" : ""}`);
    if (subjectBreakdown.length > 0) {
      lines.push("");
      lines.push("By subject:");
      for (const row of subjectBreakdown.slice(0, 4)) {
        const avg = row.averagePercentage != null ? ` (avg ${row.averagePercentage}%)` : "";
        lines.push(`  · ${row.subject || "—"}: ${row.count}× quizzes${avg}`);
      }
    }
  }
  lines.push("");
  lines.push(`Open the live progress page: ${shareUrl}`);
  lines.push("");
  lines.push("— ZedExams");
  return lines.join("\n");
}

module.exports = {
  WHATSAPP_SECRETS,
  WHATSAPP_WEBHOOK_SECRETS,
  isConfigured,
  normalizeToWhatsApp,
  sendWhatsAppDigest,
  sendWhatsAppText,
  buildWhatsAppDigestBody,
  verifyWebhookSubscription,
  verifyWebhookSignature,
  verifyInboundSignature,
  parseInboundMessages,
};
