/**
 * Twilio WhatsApp delivery helper (audit A3 PR 3).
 *
 * Soft-fail by design: callers can invoke `sendWhatsAppDigest()` whether
 * or not the Twilio secrets are populated. When the secrets are unset
 * the helper returns `{status: 'skipped', reason: 'twilio-not-configured'}`
 * instead of throwing — so the cron keeps running cleanly during the
 * staged rollout (email-first, WhatsApp later).
 *
 * Required secrets (set them via `firebase-tools functions:secrets:set`
 * once you've signed up for Twilio):
 *
 *   TWILIO_ACCOUNT_SID          AC… string from console.twilio.com
 *   TWILIO_AUTH_TOKEN           paired auth token
 *   TWILIO_WHATSAPP_FROM        e.g. `whatsapp:+14155238886` (sandbox)
 *                               or your approved WhatsApp Business
 *                               sender (`whatsapp:+260…`).
 *
 * Optional:
 *
 *   TWILIO_CONTENT_SID          HX… ID of an approved Content Template
 *                               in Twilio. When set, the helper sends
 *                               via the template + variables instead of
 *                               a free-form Body. Required for outbound
 *                               messages outside the 24-hour customer-
 *                               initiated window in production
 *                               WhatsApp Business API.
 *
 * Sandbox vs production:
 *   - In Twilio's WhatsApp sandbox you can send free-form text to any
 *     number that has joined the sandbox via `join <code>`. Use this
 *     for staging without registering a Business sender.
 *   - In production, Meta requires every outbound message outside of
 *     a 24-hour reply window to be a pre-approved Content Template. In
 *     that case set TWILIO_CONTENT_SID and skip the free-form body.
 *
 * Phone format:
 *   - Helper normalizes Zambian-local (`0977…`) and bare country-code
 *     (`260977…`) inputs to E.164. Anything malformed is rejected and
 *     the cron falls through to status: 'skipped'.
 *   - Output prefix is always `whatsapp:+…` per the Twilio API.
 */

const {defineSecret} = require("firebase-functions/params");

const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsAppFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const twilioContentSid = defineSecret("TWILIO_CONTENT_SID");

// Exported so the consuming function can declare them in its
// `secrets: [...]` block. Keeping them ordered matches the cron's
// existing email secret pattern.
const TWILIO_SECRETS = [
  twilioAccountSid,
  twilioAuthToken,
  twilioWhatsAppFrom,
  twilioContentSid,
];

function readSecret(secret) {
  try {
    return String(secret.value() || "").trim();
  } catch (_err) {
    // Secret not bound at runtime (e.g. local dev without
    // .env.examsprepzambia entries). Treat as unset.
    return "";
  }
}

function isConfigured() {
  return Boolean(
      readSecret(twilioAccountSid) &&
      readSecret(twilioAuthToken) &&
      readSecret(twilioWhatsAppFrom),
  );
}

/**
 * Normalise an arbitrary phone-number string to a Twilio WhatsApp
 * address (`whatsapp:+E164`). Returns null on anything malformed so
 * the caller can audit a `skipped` row instead of crashing.
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
  return `whatsapp:+${national}`;
}

/**
 * Send a WhatsApp message via Twilio's REST API. Soft-fails if the
 * Twilio secrets aren't configured.
 *
 * @param {Object} args
 * @param {string} args.to            Already normalised `whatsapp:+…` address.
 * @param {string} [args.body]        Free-form text (sandbox / 24h window).
 * @param {Object} [args.contentVariables]  Map of positional vars for the
 *                                          Content Template if TWILIO_CONTENT_SID
 *                                          is set.
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', sid?: string,
 *                    twilioStatus?: string, httpStatus?: number,
 *                    error?: string, reason?: string}>}
 */
async function sendWhatsAppDigest({to, body, contentVariables}) {
  const sid = readSecret(twilioAccountSid);
  const token = readSecret(twilioAuthToken);
  const fromRaw = readSecret(twilioWhatsAppFrom);
  const contentSid = readSecret(twilioContentSid);

  if (!sid || !token || !fromRaw) {
    return {status: "skipped", reason: "twilio-not-configured"};
  }
  if (!to || !to.startsWith("whatsapp:")) {
    return {status: "skipped", reason: "invalid-to-address"};
  }

  const fromAddr = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${fromRaw}`;

  const params = new URLSearchParams();
  params.set("From", fromAddr);
  params.set("To", to);
  if (contentSid) {
    params.set("ContentSid", contentSid);
    if (contentVariables && Object.keys(contentVariables).length > 0) {
      params.set("ContentVariables", JSON.stringify(contentVariables));
    }
  } else {
    if (!body) {
      return {status: "skipped", reason: "empty-body"};
    }
    // Twilio caps WhatsApp message body at 1600 chars.
    params.set("Body", body.slice(0, 1600));
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: params.toString(),
    });
  } catch (err) {
    return {status: "failed", error: String(err?.message || err).slice(0, 500)};
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      status: "failed",
      httpStatus: res.status,
      error: text.slice(0, 500),
    };
  }

  const json = await res.json().catch(() => null);
  return {
    status: "sent",
    sid: json?.sid || null,
    twilioStatus: json?.status || null,
  };
}

/**
 * Build the WhatsApp message body for a weekly digest. Kept here (vs
 * weeklyParentDigest.js) so the helper module is self-contained for
 * testing.
 *
 * Plain text only — WhatsApp doesn't render HTML. Emoji are fine; the
 * Twilio API is UTF-8 throughout.
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
  TWILIO_SECRETS,
  isConfigured,
  normalizeToWhatsApp,
  sendWhatsAppDigest,
  buildWhatsAppDigestBody,
};
