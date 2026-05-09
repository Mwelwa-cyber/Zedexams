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

const metaWhatsAppToken = defineSecret("META_WHATSAPP_TOKEN");
const metaWhatsAppPhoneNumberId = defineSecret("META_WHATSAPP_PHONE_NUMBER_ID");

// Exported so the consuming function can declare them in its
// `secrets: [...]` block.
const WHATSAPP_SECRETS = [
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
  isConfigured,
  normalizeToWhatsApp,
  sendWhatsAppDigest,
  buildWhatsAppDigestBody,
};
