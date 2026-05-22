/**
 * AI Supervisor — final gatekeeper agent.
 *
 * Runs LAST in every learner-AI chain (after Quality Check). Reviews
 * each upstream agent's verdict (Curriculum Reader, Standards Check,
 * Quality Check), computes a composite confidence, applies the
 * publishing rules from CLAUDE.md + settings/global.learnerAi.*, and
 * writes a final decision onto aiGeneratedContent.supervisorDecision.
 *
 * Distinct from the orchestrator Supervisor in `./supervisor.js`,
 * which runs FIRST and only plans the step graph. Both share the
 * "AI Supervisor Agent" identity in aiSupervisorLogs (the user-facing
 * agent name from CLAUDE.md/ORG.md), but live as separate runners
 * with separate aiLiveAgentStates entries so admins can see which
 * leg of the Supervisor flow is doing what.
 *
 * Decision rules (mirrored in supervisorDecisionSchema):
 *   90-100% composite confidence + all checks pass
 *     → 'approved'      (if task type + admin settings allow)
 *     → 'sent_for_review' otherwise
 *   70-89% confidence
 *     → 'sent_for_review'
 *   50-69% confidence
 *     → 'regenerate_required'
 *   < 50% confidence
 *     → 'rejected'
 *
 * Hard overrides (apply BEFORE the confidence band logic):
 *   - qualityCheck.status === 'failed'   → regenerate_required or
 *                                          rejected (split at 0.5)
 *   - standardsCheck.status === 'failed' → regenerate_required
 *   - qualityCheck.requiresHumanReview   → never approved
 *   - taskType === 'exam_quiz'           → never approved
 *   - taskType === 'curriculum_update_check' → never approved
 *
 * Auto-publish allow-list (per settings/global.learnerAi.*):
 *   practice_quiz   ← autoPublishPracticeQuizzes  (existing)
 *   notes           ← autoPublishNotes            (new)
 *   study_tips      ← autoPublishStudyTips        (new) + task.parameters.weakLearnerId
 *   exam_quiz       ← never (hard-coded)
 *   *               ← always sent_for_review
 */

const admin = require("firebase-admin");
const {
  writeAgentLog, writeSupervisorLog, updateLiveAgentState, writeTaskStep,
} = require("../logger");
const {COLLECTIONS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "supervisorReview";
const SUPERVISOR_AGENT_NAME = "AI Supervisor Agent";

// Task types that the auto-publish allow-list ever opens for. Anything
// not listed lands at 'sent_for_review' by default.
const AUTO_PUBLISH_ALLOWLIST = Object.freeze({
  practice_quiz:    {settingKey: "autoPublishPracticeQuizzes", requiresExtra: null},
  notes:            {settingKey: "autoPublishNotes",           requiresExtra: null},
  // study_tips: only auto-publish when the tips were derived from a
  // real weakness profile (task.parameters.weakLearnerId set).
  study_tips:       {settingKey: "autoPublishStudyTips",
    requiresExtra: (task) => !!(task &&
      task.parameters && task.parameters.weakLearnerId)},
});

// Task types that MUST NEVER auto-publish, regardless of confidence
// or settings. This is the hard rule from CLAUDE.md + the user spec.
const NEVER_AUTO_PUBLISH = new Set([
  "exam_quiz", "curriculum_update_check", "weakness_analysis", "learner_feedback",
]);

// ── Composite confidence ────────────────────────────────────────────

/**
 * Weighted average of the three upstream confidence scores. Quality
 * Check is weighted highest (it's the safety gate); Standards Check
 * next (alignment); Curriculum Reader lowest (it's a deterministic
 * lookup, already binary pass/fail-ish). Missing verdicts skew the
 * average downward via a 0.5 fallback so a chain with a missing
 * agent gets routed to sent_for_review.
 *
 * @param {object} args
 * @param {object|null} args.reader
 * @param {object|null} args.standardsCheck
 * @param {object|null} args.qualityCheck
 * @returns {number}                          0..1
 */
function compositeConfidence({reader, standardsCheck, qualityCheck}) {
  const r = reader && Number.isFinite(reader.confidenceScore) ?
    reader.confidenceScore : 0.5;
  const s = standardsCheck && Number.isFinite(standardsCheck.confidenceScore) ?
    standardsCheck.confidenceScore : 0.5;
  const q = qualityCheck && Number.isFinite(qualityCheck.confidenceScore) ?
    qualityCheck.confidenceScore : 0.5;
  // weights sum to 1.0: 0.2 / 0.3 / 0.5
  const score = (r * 0.2) + (s * 0.3) + (q * 0.5);
  if (score < 0) return 0;
  if (score > 1) return 1;
  return Math.round(score * 10000) / 10000;
}

// ── Hard-override checks ────────────────────────────────────────────

function hardOverride({task, qualityCheck, standardsCheck, composite}) {
  if (qualityCheck && qualityCheck.status === "failed") {
    return composite < 0.5 ? "rejected" : "regenerate_required";
  }
  if (standardsCheck && standardsCheck.status === "failed") {
    // Standards alignment is fixable on retry — Curriculum Reader
    // gave us a strong ref, so the generator just needs to stamp it
    // correctly.
    return "regenerate_required";
  }
  if (!qualityCheck || !standardsCheck) {
    // Missing upstream verdict → human must intervene.
    return "sent_for_review";
  }
  return null;
}

// ── Auto-publish gate ───────────────────────────────────────────────

function canAutoPublish({task, qualityCheck, settings}) {
  if (!task) return false;
  if (NEVER_AUTO_PUBLISH.has(task.taskType)) return false;
  if (qualityCheck && qualityCheck.requiresHumanReview === true) return false;
  const entry = AUTO_PUBLISH_ALLOWLIST[task.taskType];
  if (!entry) return false;
  const flag = settings && settings[entry.settingKey];
  if (flag !== true) return false;
  if (entry.requiresExtra && !entry.requiresExtra(task)) return false;
  return true;
}

// ── Action mapper ──────────────────────────────────────────────────

function actionFor(decision) {
  switch (decision) {
    case "approved": return "none";
    case "sent_for_review": return "approve_or_reject";
    case "rejected": return "review_rejection";
    case "regenerate_required": return "review_regeneration";
    default: return "approve_or_reject";
  }
}

// ── Decision logic (pure, unit-tested) ──────────────────────────────

/**
 * Compute a decision given upstream verdicts + task + settings.
 * Returns {decision, reason, confidence, requiredAdminAction}.
 */
function decide({task, reader, standardsCheck, qualityCheck, settings}) {
  const composite = compositeConfidence({reader, standardsCheck, qualityCheck});

  const override = hardOverride({task, qualityCheck, standardsCheck, composite});
  if (override) {
    let reason;
    if (override === "rejected") {
      reason = `Quality Check failed at low composite confidence (${composite.toFixed(2)}). ` +
        `Content not safe for learners — rejected.`;
    } else if (override === "regenerate_required" && qualityCheck && qualityCheck.status === "failed") {
      reason = `Quality Check failed (composite ${composite.toFixed(2)} ≥ 0.5). ` +
        `Re-running may produce a clean artifact.`;
    } else if (override === "regenerate_required") {
      reason = `Zambian Standards Check failed. Re-running with the same ` +
        `Curriculum Reader output may fix the alignment issues.`;
    } else {
      reason = `Missing upstream verdict (reader/standards/quality). Admin review required.`;
    }
    return {
      decision: override, reason, confidence: composite,
      requiredAdminAction: actionFor(override),
    };
  }

  // Confidence-band decisions for the happy path.
  let decision;
  let reason;
  if (composite >= 0.9) {
    if (canAutoPublish({task, qualityCheck, settings})) {
      decision = "approved";
      reason = `Composite confidence ${(composite * 100).toFixed(0)}% with all checks ` +
        `passed. Auto-publishing per admin settings.`;
    } else {
      decision = "sent_for_review";
      const why = NEVER_AUTO_PUBLISH.has(task && task.taskType) ?
        `task type "${task && task.taskType}" never auto-publishes by policy` :
        (qualityCheck && qualityCheck.requiresHumanReview === true ?
          "Quality Check flagged requiresHumanReview" :
          "auto-publish not enabled for this task type");
      reason = `Composite confidence ${(composite * 100).toFixed(0)}% — high — but ${why}. ` +
        `Admin approval required.`;
    }
  } else if (composite >= 0.7) {
    decision = "sent_for_review";
    reason = `Composite confidence ${(composite * 100).toFixed(0)}% (70-89%). ` +
      `Admin review required.`;
  } else if (composite >= 0.5) {
    decision = "regenerate_required";
    reason = `Composite confidence ${(composite * 100).toFixed(0)}% (50-69%). ` +
      `Regenerating may improve quality.`;
  } else {
    decision = "rejected";
    reason = `Composite confidence ${(composite * 100).toFixed(0)}% (<50%). ` +
      `Content quality too low to publish or retry.`;
  }

  return {
    decision, reason, confidence: composite,
    requiredAdminAction: actionFor(decision),
  };
}

// ── Firestore helpers ───────────────────────────────────────────────

async function loadSettings() {
  try {
    const snap = await admin.firestore().doc("settings/global").get();
    if (!snap.exists) return {};
    return (snap.data() || {}).learnerAi || {};
  } catch (err) {
    console.warn("[supervisorReview] settings load failed", err && err.message);
    return {};
  }
}

async function findLatestContent({task}) {
  const db = admin.firestore();
  if (task && task.resultContentId) {
    try {
      const snap = await db.collection(COLLECTIONS.CONTENT).doc(task.resultContentId).get();
      if (snap.exists) return {ref: snap.ref, data: snap.data() || {}};
    } catch (err) {
      console.warn("[supervisorReview] doc-by-id lookup failed", err && err.message);
    }
  }
  try {
    const snap = await db.collection(COLLECTIONS.CONTENT)
        .where("grade", "==", String(task.grade || ""))
        .where("subject", "==", String(task.subject || ""))
        .where("topic", "==", String(task.topic || ""))
        .get();
    if (snap.empty) return null;
    const docs = [...snap.docs];
    docs.sort((a, b) => {
      const at = a.data().createdAt && a.data().createdAt.toMillis ?
        a.data().createdAt.toMillis() : 0;
      const bt = b.data().createdAt && b.data().createdAt.toMillis ?
        b.data().createdAt.toMillis() : 0;
      return bt - at;
    });
    return {ref: docs[0].ref, data: docs[0].data() || {}};
  } catch (err) {
    console.warn("[supervisorReview] broad lookup failed", err && err.message);
    return null;
  }
}

// ── Runner ──────────────────────────────────────────────────────────

async function runSupervisorReview({task, chainContext = {}, stepNumber = 6}) {
  await updateLiveAgentState(AGENT_ID, {
    agentName: SUPERVISOR_AGENT_NAME,
    status: "checking", currentTaskId: task.id,
    currentTask: "Final Supervisor review", progress: 25,
    grade: task.grade || null, subject: task.subject || null,
    term: task.term || null, topic: task.topic || null,
    subtopic: task.subtopic || null,
    lastMessage: "Reviewing upstream verdicts",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Supervisor review",
    message: "Composite verdict + publishing decision",
    status: TASK_STEP_STATUS.RUNNING, progress: 50,
  });

  const target = await findLatestContent({task});
  if (!target) {
    await writeAgentLog({
      taskId: task.id, agentName: SUPERVISOR_AGENT_NAME, action: "supervisor_review",
      message: "No aiGeneratedContent found for this task",
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.ERROR,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "failed", currentTaskId: null, lastMessage: "no_artifact_found",
    });
    return {ok: false, reason: "no_artifact_found"};
  }

  const reader = chainContext.curriculumReader || null;
  const standardsCheck = chainContext.standardsCheck || target.data.zambianStandardsCheck || null;
  const qualityCheck = chainContext.qualityCheck || target.data.qualityCheck || null;
  const settings = await loadSettings();

  const {decision, reason, confidence, requiredAdminAction} = decide({
    task, reader, standardsCheck, qualityCheck, settings,
  });

  const decisionRecord = {
    decision, reason, confidenceScore: confidence,
    requiredAdminAction,
    upstreamVerdicts: {
      curriculumReader: {
        status: reader && reader.status ? String(reader.status) : "missing",
        confidenceScore: reader && Number.isFinite(reader.confidenceScore) ?
          reader.confidenceScore : null,
        matchKind: reader && reader.matchKind ? String(reader.matchKind) : null,
      },
      standardsCheck: {
        status: standardsCheck && standardsCheck.status ?
          String(standardsCheck.status) : "missing",
        confidenceScore: standardsCheck && Number.isFinite(standardsCheck.confidenceScore) ?
          standardsCheck.confidenceScore : null,
        zambianCurriculumFit: !!(standardsCheck && standardsCheck.zambianCurriculumFit),
        zambianAssessmentFit: !!(standardsCheck && standardsCheck.zambianAssessmentFit),
      },
      qualityCheck: {
        status: qualityCheck && qualityCheck.status ?
          String(qualityCheck.status) : "missing",
        confidenceScore: qualityCheck && Number.isFinite(qualityCheck.confidenceScore) ?
          qualityCheck.confidenceScore : null,
        requiresHumanReview: !!(qualityCheck && qualityCheck.requiresHumanReview),
        deterministicGroundingPass: !!(qualityCheck && qualityCheck.deterministicGroundingPass),
      },
    },
    modelUsed: "deterministic",
    artifactType: target.data.type || task.taskType,
    contentId: target.ref.id,
    autoPublishSettings: settings && Object.keys(settings).length ?
      settings : null,
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Write the supervisor decision onto the artifact.
  await target.ref.set({
    supervisorDecision: decisionRecord,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Write a row to aiSupervisorLogs — the "send to Supervisor" leg
  // that every upstream agent also writes a row to. This one is the
  // FINAL row in the chain.
  await writeSupervisorLog({
    taskId: task.id, agentName: SUPERVISOR_AGENT_NAME,
    contentType: decisionRecord.artifactType,
    grade: task.grade || "", subject: task.subject || "", term: task.term || "",
    topic: task.topic || "", subtopic: task.subtopic || "",
    actionTaken: decision === "approved" ? "approved" :
      decision === "rejected" ? "rejected" :
      decision === "regenerate_required" ? "regenerate_required" :
      "sent_for_review",
    reason,
    confidenceScore: confidence,
  });

  await writeAgentLog({
    taskId: task.id, agentName: SUPERVISOR_AGENT_NAME, action: "supervisor_review",
    message: `${decision} (composite=${(confidence * 100).toFixed(0)}%, ` +
      `action=${requiredAdminAction})`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: decision === "rejected" || decision === "regenerate_required" ?
      SEVERITY.WARNING : SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Supervisor review",
    message: `${decision} (composite=${(confidence * 100).toFixed(0)}%)`,
    status: decision === "rejected" || decision === "regenerate_required" ?
      TASK_STEP_STATUS.FAILED : TASK_STEP_STATUS.COMPLETED,
    progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    agentName: SUPERVISOR_AGENT_NAME,
    status: decision === "rejected" || decision === "regenerate_required" ?
      "failed" : "completed",
    currentTaskId: null, progress: 100,
    lastMessage: `${decision} (${(confidence * 100).toFixed(0)}%)`,
  });

  return {
    ok: true,
    supervisorDecision: decisionRecord,
    decision,
    contentId: target.ref.id,
  };
}

module.exports = {
  runSupervisorReview,
  decide,
  compositeConfidence,
  hardOverride,
  canAutoPublish,
  actionFor,
  AGENT_ID,
  SUPERVISOR_AGENT_NAME,
  AUTO_PUBLISH_ALLOWLIST,
  NEVER_AUTO_PUBLISH,
};
