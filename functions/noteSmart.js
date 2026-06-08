// functions/noteSmart.js
//
// Generates + caches AI auto-highlights for a study note. Mirrors the
// noteInsights writer: read lessons/{noteId}, ask Claude for important excerpts
// per block, write noteSmart/{noteId}. Server-only (admin SDK).
//
// Pattern: uses admin.firestore() per-call and admin.firestore.FieldValue —
// identical to noteInsights.js — so no db/FieldValue params needed.

const admin = require("firebase-admin");
const {callAnthropic} = require("./aiService");
const {buildHighlightMessages, parseHighlights, buildSummaryMessages, parseSummaries} = require("./noteSmartPrompt");

const SMART_MODEL = process.env.NOTE_SMART_MODEL || undefined;

// Stable fingerprint of the note's textual content (so we can tell when the
// highlights are stale vs. what they were generated against).
function contentHash(blocks) {
  const text = (blocks || []).map((b) =>
    (b?.id || "") + ":" + (b?.text || (b?.items || []).join("|") || (b?.lines || []).join("|") || ""),
  ).join("\n");
  let h = 0;
  for (let i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0; }
  return String(h);
}

/**
 * Read a study note, extract highlights via Claude, and write noteSmart/{noteId}.
 * Mirrors runNoteInsights — obtains Firestore internally via admin.firestore().
 * @param {{ noteId: string, uid: string, apiKey: string }} args
 * @returns {Promise<{ highlights: Record<string,string[]>, warnings: string[] }>}
 */
async function runGenerateNoteSmart({noteId, uid, apiKey}) {
  const db = admin.firestore();

  const snap = await db.collection("lessons").doc(noteId).get();
  if (!snap.exists) {
    const e = new Error("Note not found.");
    e.code = "not-found";
    throw e;
  }
  const note = snap.data() || {};
  const blocks = Array.isArray(note.blocks) ? note.blocks : [];
  if (!blocks.length) {
    const e = new Error("This note has no study blocks to highlight.");
    e.code = "failed-precondition";
    throw e;
  }

  const messages = buildHighlightMessages({blocks});
  const raw = await callAnthropic(apiKey, {
    systemPrompt: messages[0].content,
    messages: [{role: "user", content: messages[1].content}],
    maxTokens: 4000,
    temperature: 0.2,
    json: true,
    model: SMART_MODEL,
    track: {uid, tool: "generateNoteSmart"},
  });
  const {highlights, warnings} = parseHighlights(raw);

  // Second pass: a 1-2 sentence summary per section (level-2 heading).
  let sections = [];
  try {
    const sumMsgs = buildSummaryMessages({blocks});
    const rawSum = await callAnthropic(apiKey, {
      systemPrompt: sumMsgs[0].content,
      messages: [{role: "user", content: sumMsgs[1].content}],
      maxTokens: 2000,
      temperature: 0.3,
      json: true,
      model: SMART_MODEL,
      track: {uid, tool: "generateNoteSmart"},
    });
    const {summaries} = parseSummaries(rawSum);
    sections = blocks
      .filter((b) => b?.type === "heading" && b.level === 2 && b.id)
      .map((b) => ({key: String(b.id), title: String(b.text || ""), summary: summaries[b.id] || ""}))
      .filter((s) => s.summary);
  } catch (e) {
    warnings.push("Section summaries could not be generated.");
  }

  await db.collection("noteSmart").doc(noteId).set({
    highlights,
    sections,
    warnings,
    contentHash: contentHash(blocks),
    model: SMART_MODEL || "default",
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {highlights, sections, warnings};
}

module.exports = {runGenerateNoteSmart, contentHash};
