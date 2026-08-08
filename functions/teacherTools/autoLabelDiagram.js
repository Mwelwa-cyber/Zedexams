/**
 * autoLabelDiagram — server runner for AI auto-labelling of diagram art
 * (Visual Studio v2, spec 1C). Vision call over the teacher's diagram image
 * plus subject/grade/topic grounding; returns proposed labels the editor
 * treats as PRE-FILLED MANUAL LABELS (drag / rename / delete), never a
 * finished answer.
 *
 * Behaviour contract (all decisions live in autoLabelCore.js, pure):
 *   • strict JSON shape validated; ONE silent retry on a malformed reply;
 *   • then graceful fallback — { parts: [], failed: true } so the client
 *     lands in manual labelling mode, never a dead end;
 *   • vocabulary grounding via resolveCbcContext; when no context resolves
 *     the response says grounded:false so the UI shows the "not grounded —
 *     check words against the textbook" chip instead of silently guessing;
 *   • re-runnable: existingWords filters proposals to unlabelled parts only.
 *
 * Auth / App Check / role gating / daily limits live in the index.js
 * callable, same split as runNoteOcr.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const {callAnthropic} = require("../aiService");
const {resolveCbcContext} = require("./cbcKnowledge");
const {
  parseImageDataUrl,
  buildAutoLabelSystemPrompt,
  buildAutoLabelUserContent,
  parseAutoLabelParts,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./autoLabelCore");

async function runAutoLabelDiagram({
  dataUrl, subject = "", grade = "", topic = "", subtopic = "",
  framework = "", existingWords = [], apiKey, uid,
}) {
  const image = parseImageDataUrl(dataUrl);
  if (!image) {
    throw new HttpsError(
        "invalid-argument",
        "A diagram image (JPEG/PNG/WebP/GIF data URL, up to 5 MB) is required.",
    );
  }
  const words = (Array.isArray(existingWords) ? existingWords : [])
      .map((w) => String(w || "").slice(0, 60)).filter(Boolean).slice(0, 60);

  // Vocabulary grounding (spec 1C): the grade's syllabus outcomes and
  // terminology. A resolution FAILURE must not kill the labelling call —
  // it downgrades to grounded:false, which the UI surfaces honestly.
  let contextBlock = "";
  try {
    const ctx = await resolveCbcContext({grade, subject, topic, subtopic, framework, ownerUid: uid});
    contextBlock = String((ctx && ctx.contextBlock) || "");
  } catch (err) {
    console.warn("autoLabelDiagram: grounding lookup failed", {
      message: err && err.message ? err.message.slice(0, 200) : "",
    });
  }
  const grounded = Boolean(contextBlock);

  const systemPrompt = buildAutoLabelSystemPrompt();
  const content = buildAutoLabelUserContent({
    image, subject, grade, topic, subtopic, contextBlock, existingWords: words,
  });
  const attempt = () => callAnthropic(apiKey, {
    systemPrompt,
    messages: [{role: "user", content}],
    maxTokens: 2000,
    temperature: 0,
    json: true,
    track: {uid, tool: "autoLabelDiagram"},
  });

  let result = parseAutoLabelParts(await attempt(), {existingWords: words});
  if (!result.ok) {
    // One silent retry on a malformed shape (spec 1C), then fall back.
    result = parseAutoLabelParts(await attempt(), {existingWords: words});
  }
  if (!result.ok) {
    return {
      parts: [],
      grounded,
      failed: true,
      lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
    };
  }
  return {
    parts: result.parts,
    grounded,
    failed: false,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
  };
}

module.exports = {runAutoLabelDiagram};
