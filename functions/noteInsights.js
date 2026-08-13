// functions/noteInsights.js
//
// Learner-facing "AI Summary + Key Points" for a published note. Generated once
// per note (cached in `noteInsights/{noteId}`, keyed by a content hash) and
// reused by every learner — so cost is bounded by the number of notes, not the
// number of readers. Uses Haiku 4.5 (cheap, fast) since this is a short,
// extractive task.
//
// The note text is rebuilt server-side from whichever format the note uses
// (rich_text HTML / study blocks / visual-slide deck). PDF ("file") notes have
// no machine-readable text, so they're rejected with a clear message.

const admin = require("firebase-admin");
const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {callAnthropic} = require("./aiService");

const NOTES_COLLECTION = "lessons";
const INSIGHTS_COLLECTION = "noteInsights";
const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const MIN_TEXT_LEN = 40;
const MAX_TEXT_LEN = 16000; // plenty for a single note; keeps token cost down

// ─── text extraction ─────────────────────────────────────────────────

function stripHtml(html) {
  // End tags may carry trailing junk ("</style foo>") — allow attributes in
  // the close tag so a malformed end tag can't smuggle the element through.
  let out = String(html || "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ");
  // Strip remaining tags to a fixpoint so removals can't reassemble a tag
  // (e.g. "<scr<x>ipt>").
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]+>/g, " ");
  } while (out !== prev);
  // Decode entities in one pass ("&amp;" handled together with the rest) so a
  // double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = {"nbsp": " ", "amp": "&", "lt": "<", "gt": ">"};
  return out
      .replace(/&(nbsp|amp|lt|gt);/g, (m, name) => entities[name])
      .replace(/\s+/g, " ")
      .trim();
}

// Flatten a study note's block array into readable prose. Mirrors the shapes in
// src/features/notes/lib/studyBlocks.js (paragraph/heading/lists/keyterms/…).
function flattenStudyBlocks(blocks) {
  const parts = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;
    if (b.text) parts.push(String(b.text));
    if (Array.isArray(b.items)) parts.push(b.items.join(". "));
    if (Array.isArray(b.lines)) parts.push(b.lines.join(" "));
    if (Array.isArray(b.rows)) {
      for (const r of b.rows) {
        if (Array.isArray(r)) parts.push(r.join(": "));
        else if (r && typeof r === "object") {
          if (r.term != null || r.def != null) parts.push(`${r.term || ""}: ${r.def || ""}`);
          if (Array.isArray(r.cells)) parts.push(r.cells.join(", "));
        }
      }
    }
    if (b.q) parts.push(String(b.q));
    if (b.a) parts.push(String(b.a));
    if (b.caption) parts.push(String(b.caption));
  }
  return parts.join("\n").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").trim();
}

// Flatten a visual-slide deck ({ header, slides: [{ title, body, bullets, … }] }).
function flattenDeck(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const parts = [];
  if (deck?.header?.title) parts.push(String(deck.header.title));
  for (const s of slides) {
    if (!s || typeof s !== "object") continue;
    if (s.title) parts.push(String(s.title));
    if (s.heading) parts.push(String(s.heading));
    if (s.body) parts.push(String(s.body));
    if (s.text) parts.push(String(s.text));
    if (s.caption) parts.push(String(s.caption));
    if (Array.isArray(s.bullets)) parts.push(s.bullets.join(". "));
    if (Array.isArray(s.points)) parts.push(s.points.join(". "));
  }
  return parts.join("\n").replace(/\s+\n/g, "\n").trim();
}

function noteSourceText(note) {
  switch (note?.noteFormat) {
    case "study":         return flattenStudyBlocks(note.blocks);
    case "visual_slides": return flattenDeck(note.deck);
    case "file":          return ""; // PDFs carry no extractable text
    case "rich_text":
    default:              return stripHtml(note?.content);
  }
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// ─── prompt ──────────────────────────────────────────────────────────

function systemPrompt() {
  return [
    "You are a study assistant for Zambian primary and junior-secondary",
    "learners following the Competence-Based Curriculum (CBC).",
    "Given the text of one lesson note, produce a short summary and the key",
    "points a learner should remember.",
    "",
    "Rules:",
    "- Write for the learner's grade level: simple, clear, encouraging.",
    "- Use British/Zambian English spelling.",
    "- Be faithful to the note — never invent facts that aren't in the text.",
    "- The summary is 2–4 sentences (max ~80 words).",
    "- Provide 3–6 key points, each one short sentence (max ~18 words).",
    "",
    "Respond with ONLY a JSON object, no prose, no markdown fences:",
    "{ \"summary\": \"...\", \"keyPoints\": [\"...\", \"...\"] }",
  ].join("\n");
}

function userMessage(note, text) {
  const header = [
    note.subject ? `Subject: ${note.subject}` : null,
    note.grade ? `Grade: ${note.grade}` : null,
    note.title ? `Title: ${note.title}` : null,
  ].filter(Boolean).join("\n");
  return `${header}\n\nNote text:\n"""\n${text.slice(0, MAX_TEXT_LEN)}\n"""`;
}

function parseInsights(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new HttpsError("internal", "Could not read the AI response. Please try again.");
  }
  const summary = typeof obj?.summary === "string" ? obj.summary.trim() : "";
  const keyPoints = Array.isArray(obj?.keyPoints) ?
    obj.keyPoints.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 8) :
    [];
  if (!summary || keyPoints.length === 0) {
    throw new HttpsError("internal", "The AI response was incomplete. Please try again.");
  }
  return {summary, keyPoints};
}

// ─── runner ──────────────────────────────────────────────────────────

/**
 * Resolve a note's AI summary + key points, generating + caching on first use.
 * @param {{ noteId: string, uid: string, apiKey: string }} args
 * @returns {Promise<{ summary: string, keyPoints: string[], cached: boolean }>}
 */
async function runNoteInsights({noteId, uid, apiKey}) {
  const db = admin.firestore();
  const snap = await db.collection(NOTES_COLLECTION).doc(noteId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "That note could not be found.");
  }
  const note = snap.data() || {};
  // Only published notes are learner-readable; don't leak drafts.
  if (note.isPublished !== true) {
    throw new HttpsError("permission-denied", "This note is not available.");
  }

  const text = noteSourceText(note);
  if (!text || text.length < MIN_TEXT_LEN) {
    throw new HttpsError(
      "failed-precondition",
      "This note doesn't have enough text to summarise yet.",
    );
  }
  const sourceHash = sha1(text);

  const insightsRef = db.collection(INSIGHTS_COLLECTION).doc(noteId);
  const cachedSnap = await insightsRef.get();
  const cachedData = cachedSnap.exists ? (cachedSnap.data() || {}) : null;
  if (cachedData && cachedData.sourceHash === sourceHash && cachedData.summary) {
    return {
      summary: cachedData.summary,
      keyPoints: Array.isArray(cachedData.keyPoints) ? cachedData.keyPoints : [],
      cached: true,
    };
  }

  const raw = await callAnthropic(apiKey, {
    systemPrompt: systemPrompt(),
    messages: [{role: "user", content: userMessage(note, text)}],
    model: MODEL_HAIKU,
    maxTokens: 700,
    temperature: 0.2,
    json: true,
    track: {uid, tool: "noteInsights"},
  });
  const {summary, keyPoints} = parseInsights(raw);

  await insightsRef.set({
    noteId,
    grade: note.grade != null ? String(note.grade) : null,
    subject: note.subject || null,
    title: note.title || null,
    summary,
    keyPoints,
    sourceHash,
    model: MODEL_HAIKU,
    generatedBy: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: cachedData?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {summary, keyPoints, cached: false};
}

module.exports = {runNoteInsights};
