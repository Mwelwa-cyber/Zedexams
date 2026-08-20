"use strict";

/**
 * coGuardianCore — pure helpers for the family-sharing invite.
 *
 * Token minting and hashing follow guardianConsent/consentTokens.js: the
 * RAW token goes in the email and is never stored, and the doc id is its
 * SHA-256 hash. So a database row cannot be redeemed by anyone who reads
 * it — the only usable copy is in the invitee's inbox.
 *
 * No firebase-admin here, so it unit-tests under plain `node`.
 */

const crypto = require("node:crypto");

/** A week is long enough to notice an email and short enough to matter. */
const CO_GUARDIAN_INVITE_TTL_DAYS = 7;

const TOKEN_BYTES = 32;

/**
 * Canonicalise an email for comparison and storage: trimmed, lowercased.
 *
 * Returns `""` for anything that is not one address — the check is
 * deliberately shallow (there is a `@`, something before it, a dot after
 * it, no whitespace) because the authoritative test is whether the
 * invite arrives, and a stricter regex rejects real addresses more often
 * than it catches fake ones.
 */
function normalizeEmail(input) {
  const value = String(input == null ? "" : input).trim().toLowerCase();
  if (!value || /\s/.test(value)) return "";
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return "";
  const domain = value.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return "";
  return value;
}

/**
 * Mint a raw invite token. `randomBytes` is injected so tests can be
 * deterministic; production passes node:crypto's.
 */
function randomInviteToken(randomBytes) {
  return Buffer.from(randomBytes(TOKEN_BYTES)).toString("base64url");
}

/** The doc id for a raw token. Never store the raw token itself. */
function hashInviteToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

/**
 * The invite email.
 *
 * It names the child and the inviter, says exactly what accepting grants
 * (and what it does not — billing stays with the owner), and gives the
 * expiry. An invite that does not say what it hands over is one the
 * recipient has to accept to find out, which is not consent.
 */
function buildCoGuardianInviteEmail({inviterName, childName, acceptUrl, expiresInDays} = {}) {
  const inviter = String(inviterName || "").trim() || "A parent";
  const child = String(childName || "").trim() || "their child";
  const days = Number.isFinite(Number(expiresInDays)) ? Number(expiresInDays) : CO_GUARDIAN_INVITE_TTL_DAYS;

  const subject = `${inviter} has asked you to help look after ${child} on ZedExams`;
  const text = [
    `Hello,`,
    ``,
    `${inviter} has invited you to be a guardian for ${child} on ZedExams.`,
    ``,
    `Accepting means you can:`,
    `  • see ${child}'s progress and weekly reports`,
    `  • approve requests they send (unlocks, friends)`,
    `  • change what they can use — live challenges`,
    ``,
    `It does NOT give you billing or the ability to delete the account —`,
    `those stay with ${inviter}, who set the account up.`,
    ``,
    `Accept here (the link works for ${days} days):`,
    acceptUrl || "",
    ``,
    `You will need a ZedExams parent account — the link will help you make`,
    `one if you do not have it yet, using this same email address.`,
    ``,
    `If you were not expecting this, you can ignore this message. Nothing`,
    `happens until you accept, and ${inviter} can cancel the invite at any`,
    `time.`,
    ``,
    `— ZedExams`,
  ].join("\n");

  return {subject, text};
}

module.exports = {
  CO_GUARDIAN_INVITE_TTL_DAYS,
  TOKEN_BYTES,
  buildCoGuardianInviteEmail,
  hashInviteToken,
  normalizeEmail,
  randomInviteToken,
};
