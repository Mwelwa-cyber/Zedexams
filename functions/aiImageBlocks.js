/**
 * functions/aiImageBlocks.js
 *
 * Pure (no firebase-functions / firebase-admin) helpers for attaching a
 * question's pictures to an Anthropic vision request, so the AI answer tools
 * (editQuizQuestion's "Suggest answer" / "Explain", and the bulk
 * suggestQuizAnswers) can actually SEE the diagram instead of replying that
 * they cannot. Kept dependency-free — like editQuestionPrompt.js — so the
 * unit tests run under CI's root-only `npm ci`.
 *
 * Question pictures are stored as Firebase Storage download URLs
 * (https://firebasestorage.googleapis.com/...?alt=media&token=...), which are
 * publicly fetchable, so we hand them to Claude as `{type:"image",
 * source:{type:"url", url}}` blocks rather than re-uploading base64. Only
 * https URLs are allowed through — blob:/data:/http: and anything with
 * whitespace are dropped so junk can never reach the image fetcher.
 */

const MAX_IMAGE_URL = 2000;
const MAX_OPTION_IMAGES = 6;

function sanitizeImageUrl(value) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url || url.length > MAX_IMAGE_URL) return "";
  // https only (Firebase Storage download URLs, public image hosts). Reject
  // blob:/data:/http: and any URL carrying whitespace or angle/quote chars.
  if (!/^https:\/\//i.test(url)) return "";
  if (/[\s<>"'`]/.test(url)) return "";
  return url;
}

function imageSourceBlock(url) {
  return {type: "image", source: {type: "url", url}};
}

// Sanitize a parallel option-image array (slot i → option letter i). Returns a
// same-shaped array of url-or-"" so callers can pair each picture with its
// option letter; out-of-range / junk slots become "".
function sanitizeOptionImages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_OPTION_IMAGES).map(sanitizeImageUrl);
}

/**
 * Build labeled vision blocks for ONE question from its picture fields.
 * Returns an array that alternates a tiny text label with the image block, so
 * the model knows which picture is the question diagram vs. an option picture
 * vs. a shared passage diagram. Returns [] when the question has no pictures.
 *
 * payload: { imageUrl, optionImages, passageImageUrl }
 * idLabel: optional short string (e.g. "id: q3") woven into each label so the
 *          picture is unambiguous when many questions share one message.
 */
function buildQuestionImageBlocks(payload = {}, idLabel = "") {
  const blocks = [];
  const tag = idLabel ? ` (${idLabel})` : "";
  const add = (rawUrl, label) => {
    const url = sanitizeImageUrl(rawUrl);
    if (!url) return;
    blocks.push({type: "text", text: `${label}${tag}`});
    blocks.push(imageSourceBlock(url));
  };
  add(payload.passageImageUrl, "Shared picture/diagram for this set of questions");
  add(payload.imageUrl, "Picture/diagram for this question — read it carefully");
  const optionImages = sanitizeOptionImages(payload.optionImages);
  optionImages.forEach((url, i) => {
    if (url) {
      blocks.push({type: "text", text: `Picture shown as option ${String.fromCharCode(65 + i)}${tag}`});
      blocks.push(imageSourceBlock(url));
    }
  });
  return blocks;
}

// True when the payload carries at least one usable picture.
function hasQuestionImages(payload = {}) {
  if (sanitizeImageUrl(payload.imageUrl)) return true;
  if (sanitizeImageUrl(payload.passageImageUrl)) return true;
  return sanitizeOptionImages(payload.optionImages).some(Boolean);
}

module.exports = {
  sanitizeImageUrl,
  imageSourceBlock,
  sanitizeOptionImages,
  buildQuestionImageBlocks,
  hasQuestionImages,
  MAX_OPTION_IMAGES,
};
