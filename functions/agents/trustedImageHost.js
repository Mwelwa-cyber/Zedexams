"use strict";

/**
 * Allow-list for image URLs that get handed to Anthropic's vision API, which
 * fetches them SERVER-SIDE. Restricting to our own Firebase Storage hosts stops
 * a crafted quiz/question from turning an agent (Qix review, Vex verify) into an
 * SSRF probe against internal endpoints (e.g. the cloud metadata service at
 * 169.254.169.254) or arbitrary third-party URLs. Anything off-list is reviewed
 * text-only. Pure + dependency-free so it unit-tests under plain `node`
 * (the *Core.js convention).
 */

const TRUSTED_IMAGE_HOSTS = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
];
const TRUSTED_IMAGE_HOST_SUFFIXES = [
  ".firebasestorage.app",
  ".appspot.com",
];

/** @param {string} url @returns {boolean} true iff safe to hand to the vision fetcher */
function isTrustedImageUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (TRUSTED_IMAGE_HOSTS.includes(host)) return true;
  return TRUSTED_IMAGE_HOST_SUFFIXES.some((sfx) => host.endsWith(sfx));
}

module.exports = {isTrustedImageUrl, TRUSTED_IMAGE_HOSTS, TRUSTED_IMAGE_HOST_SUFFIXES};
