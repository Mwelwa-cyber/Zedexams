"use strict";

/**
 * The words a guardian actually reads.
 *
 * Split from the Cloud Functions so they are testable without a runtime, and
 * because the content is a compliance artefact rather than incidental copy:
 * Play's Families policy and Zambia's Data Protection Act both expect a
 * guardian to be told WHO is asking, WHAT is collected about their child, and
 * HOW to say no — before they approve anything. A consent that was obtained
 * without saying those things is not consent.
 *
 * Two rules the templates follow:
 *
 *   • The decline route is as prominent as the approve route. A message that
 *     only offers "approve" is not asking a question, and a guardian who did
 *     not expect the email is exactly the person the flow exists to catch.
 *
 *   • The child's name is used, but nothing else about them. The email goes to
 *     an address a CHILD typed in, so it must be assumed to be capable of
 *     reaching the wrong person: it names the app, the first name, and the
 *     grade, and no more. If it went astray, nothing in it identifies a
 *     specific child to a stranger.
 *
 * Pure module — no firebase-admin, no nodemailer, no I/O.
 */

const APP_NAME = "ZedExams";
const SUPPORT_EMAIL = "support@zedexams.com";
const SUPPORT_WHATSAPP = "+260 977 740 465";
const PRIVACY_URL = "https://zedexams.com/privacy";
const DELETE_URL = "https://zedexams.com/delete-account";

// What stands in for the tokenised link on the child's confirm screen. The
// token does not exist until the message is actually sent, and inventing one
// to make the preview look complete would mint a live consent credential for
// a message nobody has agreed to send yet.
const PREVIEW_LINK = "zedexams.com/consent/\u00b7\u00b7\u00b7\u00b7\u00b7";

// What we tell a guardian we hold about their child. Kept as a list rather
// than prose so it can be asserted against, and so a new learner field has an
// obvious place to be declared — or an obvious test to fail if it isn't.
const LEARNER_DATA_SUMMARY = Object.freeze([
  "their first name and the grade they are in",
  "their school name",
  "quiz and exam results, and study progress",
]);

function safeName(value) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.slice(0, 60) || "your child";
}

/**
 * Build the guardian consent email.
 *
 * @param {object} args
 * @param {string} args.childName   First name, or a fallback.
 * @param {string} args.approveUrl  The tokenised approve link.
 * @param {string} args.declineUrl  The tokenised decline link.
 * @param {number} args.expiryDays
 * @return {{subject: string, text: string}}
 */
function buildConsentEmail({childName, approveUrl, declineUrl, expiryDays}) {
  const name = safeName(childName);
  const subject = `${APP_NAME}: please approve ${name}'s learning account`;

  const text = [
    "Hello,",
    "",
    `${name} has created a learner account on ${APP_NAME}, a Zambian learning `,
    `platform for the CBC curriculum (zedexams.com). Because they are under 18, `,
    "we need a parent or guardian to approve the account before they can use it fully.",
    "",
    "Until you approve it, they can only read lessons and past papers. They cannot",
    "appear on a leaderboard or buy anything.",
    "",
    "TO APPROVE:",
    approveUrl,
    "",
    "IF YOU DID NOT EXPECT THIS, or you do not want the account to exist:",
    declineUrl,
    "",
    `Either link works for ${expiryDays} days.`,
    "",
    `WHAT WE STORE ABOUT ${name.toUpperCase()}:`,
    ...LEARNER_DATA_SUMMARY.map((line) => `  - ${line}`),
    "",
    "We do not show advertising to learners, we never sell their data, and we do",
    "not record their screen or track their location.",
    "",
    "As a parent or guardian you can, at any time, ask us to show you, correct, or",
    `delete everything we hold about them: ${DELETE_URL}`,
    "",
    `Full privacy policy: ${PRIVACY_URL}`,
    "",
    `${APP_NAME} — ${SUPPORT_EMAIL} — WhatsApp ${SUPPORT_WHATSAPP}`,
  ].join("\n");

  return {subject, text};
}

/**
 * Build the WhatsApp message body. Shorter — a wall of text in WhatsApp does
 * not get read — but it still carries both links, because the decline route
 * cannot be the one that gets trimmed for length.
 *
 * EACH LINK ENDS A LINE. WhatsApp linkifies up to the next whitespace, so
 * joining these lines with "" — as this did until the channel became the
 * default one — glued `Not expected...` onto the end of the approve URL and
 * produced a link whose token was several words long. Every WhatsApp consent
 * link sent that way was dead on arrival, and the pre-existing test could not
 * see it: the message still CONTAINS the approve URL, as a prefix of a longer
 * broken one.
 */
function buildConsentWhatsAppText({childName, approveUrl, declineUrl}) {
  const name = safeName(childName);
  return [
    `Hello! ${name} created a learner account on ${APP_NAME} (zedexams.com), ` +
      "a Zambian CBC learning app. They are under 18, so we need a parent or " +
      "guardian to approve it.",
    "",
    `Approve: ${approveUrl}`,
    "",
    `Not expected / remove the account: ${declineUrl}`,
    "",
    `Questions: ${SUPPORT_EMAIL}`,
  ].join("\n");
}

/**
 * The message as it will actually go out, for the CHILD to check before we
 * send it.
 *
 * Built by the same two builders the send uses, with the token elided,
 * because a preview assembled by a second function is a preview that can
 * drift from the message — and the whole point of showing it is that a
 * mistyped digit is invisible to everyone otherwise: the child waits, the
 * guardian got nothing, and support cannot see why the account is stuck.
 *
 * @param {object} args
 * @param {string} args.channel   "email" | "whatsapp"
 * @param {string} args.childName
 * @return {{channel: string, subject: string, body: string, linkPlaceholder: string}}
 */
function buildConsentPreview({channel, childName}) {
  const approveUrl = `${PREVIEW_LINK}`;
  const declineUrl = `${PREVIEW_LINK}`;
  if (channel === "whatsapp") {
    return {
      channel: "whatsapp",
      subject: "",
      body: buildConsentWhatsAppText({childName, approveUrl, declineUrl}),
      linkPlaceholder: PREVIEW_LINK,
    };
  }
  const {subject, text} = buildConsentEmail({
    childName, approveUrl, declineUrl, expiryDays: 7,
  });
  return {channel: "email", subject, body: text, linkPlaceholder: PREVIEW_LINK};
}

module.exports = {
  APP_NAME,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP,
  PRIVACY_URL,
  DELETE_URL,
  LEARNER_DATA_SUMMARY,
  safeName,
  buildConsentEmail,
  buildConsentWhatsAppText,
  buildConsentPreview,
  PREVIEW_LINK,
};
