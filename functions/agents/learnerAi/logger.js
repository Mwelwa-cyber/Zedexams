/**
 * Append-only logger for the learner-AI pipeline.
 *
 * Every runner calls writeAgentLog at the start and end of its work.
 * `curriculumGrounded` is the audit-query target — admins can search
 * `where('curriculumGrounded','==',false)` to find ungrounded outputs.
 *
 * `agentVersion` is a stable SHA over the prompt file content (or any
 * string the runner chooses) so a regression after a prompt edit can
 * be bisected by version.
 */

const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const versionCache = new Map();

function agentVersionFromFile(promptFilePath) {
  if (!promptFilePath) return "v0";
  const cached = versionCache.get(promptFilePath);
  if (cached) return cached;
  let v = "v0";
  try {
    const abs = path.resolve(__dirname, "prompts", promptFilePath);
    const buf = fs.readFileSync(abs);
    v = "v-" + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  } catch (err) {
    // Falling back to v0 is acceptable — the log just loses bisect
    // resolution for that one row. Don't throw.
    console.warn("agentVersionFromFile failed", promptFilePath, err && err.message);
  }
  versionCache.set(promptFilePath, v);
  return v;
}

function trimSummary(value, limit = 800) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, limit);
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (err) {
    return String(value).slice(0, limit);
  }
}

/**
 * @param {object} entry
 * @param {string} entry.agentId
 * @param {string} [entry.agentVersion]
 * @param {string} [entry.taskId]
 * @param {string} [entry.stepId]
 * @param {string} [entry.correlationId]
 * @param {string} entry.action
 * @param {any}    [entry.inputSummary]
 * @param {any}    [entry.outputSummary]
 * @param {("info"|"warning"|"error"|"blocked")} [entry.level]
 * @param {boolean} [entry.curriculumGrounded]
 * @param {object} [entry.curriculumRef]
 * @param {string} [entry.model]
 * @param {number} [entry.tokensIn]
 * @param {number} [entry.tokensOut]
 * @param {number} [entry.costUsdCents]
 * @param {number} [entry.durationMs]
 */
async function writeAgentLog(entry) {
  const doc = {
    schemaVersion: 1,
    agentId: String(entry.agentId || "unknown"),
    agentVersion: entry.agentVersion || "v0",
    taskId: entry.taskId || null,
    stepId: entry.stepId || null,
    correlationId: entry.correlationId || null,
    action: String(entry.action || "noop"),
    inputSummary: trimSummary(entry.inputSummary),
    outputSummary: trimSummary(entry.outputSummary),
    level: entry.level || "info",
    curriculumGrounded: typeof entry.curriculumGrounded === "boolean" ?
      entry.curriculumGrounded : false,
    curriculumRef: entry.curriculumRef || null,
    model: entry.model || null,
    tokensIn: Number.isFinite(entry.tokensIn) ? entry.tokensIn : null,
    tokensOut: Number.isFinite(entry.tokensOut) ? entry.tokensOut : null,
    costUsdCents: Number.isFinite(entry.costUsdCents) ? entry.costUsdCents : null,
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await admin.firestore().collection("aiAgentLogs").add(doc);
  } catch (err) {
    // Logging failures must NEVER fail the pipeline. Log to console.
    console.warn("writeAgentLog failed", err && err.message);
  }
}

async function updateLiveAgentState(agentId, patch) {
  if (!agentId) return;
  try {
    await admin.firestore()
        .collection("liveAgentStates")
        .doc(agentId)
        .set({
          agentId,
          ...patch,
          lastHeartbeat: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
  } catch (err) {
    console.warn("updateLiveAgentState failed", agentId, err && err.message);
  }
}

module.exports = {
  writeAgentLog,
  updateLiveAgentState,
  agentVersionFromFile,
};
