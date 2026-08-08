/**
 * autoLabelCore — pure decisions for AI auto-labelling of diagram art
 * (Visual Studio v2, spec 1C). No Firebase, no model calls — the runner
 * (autoLabelDiagram.js) owns I/O; this file owns the prompt text and the
 * strict validation of what comes back, so it tests under plain `node`.
 *
 * Contract with the client: the model proposes
 *   { parts: [ { word, anchor: { x, y }, confidence } ] }
 * with anchors normalized 0–1 (the point ON the part, top-left origin).
 * Proposals are just pre-filled manual labels — the teacher can drag,
 * rename or delete every one, and anything under LOW_CONFIDENCE_THRESHOLD
 * is flagged amber in the editor, never silently trusted.
 */

// Below this confidence the editor flags the proposal amber (spec 1C).
const LOW_CONFIDENCE_THRESHOLD = 0.7;
// A real curriculum diagram tops out around a dozen parts (the 11-organ
// digestive system is the stress case); anything past this is model noise.
const MAX_AUTO_LABELS = 24;
// Two proposals closer than this (normalized distance) with the same word
// are one part detected twice.
const DUPLICATE_ANCHOR_DISTANCE = 0.04;
// Anchors may overshoot the edge by a rounding hair and be clamped; further
// out than this the detection is wrong and the part is dropped.
const ANCHOR_EPSILON = 0.02;

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Parse and guard a client-supplied data URL (same guards as the OCR
 * pipelines: only Anthropic-accepted image types, bounded size).
 * @returns {{ mediaType: string, data: string } | null}
 */
function parseImageDataUrl(dataUrl) {
  const m = String(dataUrl || "")
      .match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mediaType)) return null;
  const data = m[2].replace(/\s+/g, "");
  if (data.length * 0.75 > MAX_IMAGE_BYTES) return null;
  return {mediaType, data};
}

function buildAutoLabelSystemPrompt() {
  return [
    "You label educational diagrams for Zambian classroom materials.",
    "You are shown ONE diagram image plus its curriculum context. Identify the",
    "labelled-able parts a teacher would expect learners at that grade to name,",
    "and return STRICT JSON only (no markdown fences, no preamble):",
    "{\"parts\":[{\"word\":\"...\",\"anchor\":{\"x\":0.0,\"y\":0.0},\"confidence\":0.0}]}",
    "Rules:",
    "• anchor is the point ON the part itself, normalized 0-1 (x right, y down,",
    "  origin top-left of the image). Never place an anchor in empty background.",
    "• word is the curriculum term for the part, in normal textbook casing,",
    "  1-3 words, no punctuation, no letters like P/Q/R, no numbering.",
    "• Use ONLY vocabulary appropriate for the stated grade — when a syllabus",
    "  context block is provided, prefer its exact terminology and never use a",
    "  term above that grade's depth.",
    "• confidence is your honest 0-1 estimate that the word AND position are",
    "  right. Use low values when unsure — never guess confidently.",
    "• Label each distinct part once. Skip parts that are not clearly visible,",
    "  and skip any part named in the already-labelled list.",
    "• If the image is not a labellable diagram, return {\"parts\":[]}.",
  ].join("\n");
}

/**
 * Build the Anthropic user-turn content blocks (context text + image).
 * `contextBlock` is the resolved syllabus/KB grounding; when it is empty the
 * runner reports grounded:false so the UI can show the "check words against
 * the textbook" chip instead of silently guessing.
 */
function buildAutoLabelUserContent({
  image, subject = "", grade = "", topic = "", subtopic = "",
  contextBlock = "", existingWords = [],
} = {}) {
  const lines = [
    "Diagram context:",
    subject ? `Subject: ${String(subject).slice(0, 100)}` : "",
    grade !== "" && grade != null ? `Grade: ${String(grade).slice(0, 20)}` : "",
    topic ? `Topic: ${String(topic).slice(0, 200)}` : "",
    subtopic ? `Sub-topic: ${String(subtopic).slice(0, 200)}` : "",
  ].filter(Boolean);
  if (existingWords.length) {
    lines.push(
        "Already labelled (do NOT propose these parts again): " +
        existingWords.map((w) => String(w).slice(0, 60)).join(", "),
    );
  }
  if (contextBlock) {
    lines.push("", "Syllabus vocabulary grounding:", String(contextBlock).slice(0, 8000));
  }
  lines.push("", "Label the parts of this diagram:");
  return [
    {type: "text", text: lines.join("\n")},
    {
      type: "image",
      source: {type: "base64", media_type: image.mediaType, data: image.data},
    },
  ];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Strictly validate the model's reply. Returns { ok, parts, reason }:
 * ok:false means the SHAPE was wrong (the runner retries once, silently);
 * ok:true with parts:[] is a valid "nothing to label" answer.
 *
 * Per-part sanitation: word trimmed/bounded, anchors clamped (dropped when
 * further than ANCHOR_EPSILON outside the image), confidence clamped with a
 * conservative 0.5 default, duplicates (same word ~same spot, or same word
 * again) collapsed to the highest-confidence instance, capped at
 * MAX_AUTO_LABELS, and anything in `existingWords` filtered out.
 */
function parseAutoLabelParts(raw, {existingWords = []} = {}) {
  let parsed;
  try {
    const text = String(raw || "")
        .replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(text);
  } catch {
    return {ok: false, parts: [], reason: "not-json"};
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.parts)) {
    return {ok: false, parts: [], reason: "no-parts-array"};
  }
  const existing = new Set(
      existingWords.map((w) => String(w || "").trim().toLowerCase()).filter(Boolean),
  );
  const kept = [];
  for (const p of parsed.parts) {
    if (!p || typeof p !== "object") continue;
    const word = String(p.word || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!word) continue;
    if (existing.has(word.toLowerCase())) continue;
    const ax = Number(p.anchor && p.anchor.x);
    const ay = Number(p.anchor && p.anchor.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
    if (ax < -ANCHOR_EPSILON || ax > 1 + ANCHOR_EPSILON ||
        ay < -ANCHOR_EPSILON || ay > 1 + ANCHOR_EPSILON) continue;
    const conf = Number(p.confidence);
    const part = {
      word,
      anchor: {x: clamp01(ax), y: clamp01(ay)},
      confidence: Number.isFinite(conf) ? clamp01(conf) : 0.5,
    };
    // Same word at ~the same spot is one part detected twice — keep the
    // highest-confidence instance. The same word FAR apart is legitimate
    // (left wing / right wing) and is left for the Smart Suggestions panel
    // to question, not silently dropped here.
    const dup = kept.find((k) =>
      k.word.toLowerCase() === part.word.toLowerCase() &&
      Math.hypot(k.anchor.x - part.anchor.x, k.anchor.y - part.anchor.y) <=
        DUPLICATE_ANCHOR_DISTANCE);
    if (dup) {
      if (part.confidence > dup.confidence) {
        dup.anchor = part.anchor;
        dup.confidence = part.confidence;
      }
      continue;
    }
    kept.push(part);
    if (kept.length >= MAX_AUTO_LABELS) break;
  }
  return {ok: true, parts: kept, reason: ""};
}

module.exports = {
  LOW_CONFIDENCE_THRESHOLD,
  MAX_AUTO_LABELS,
  DUPLICATE_ANCHOR_DISTANCE,
  parseImageDataUrl,
  buildAutoLabelSystemPrompt,
  buildAutoLabelUserContent,
  parseAutoLabelParts,
};
