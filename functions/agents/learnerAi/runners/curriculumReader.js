/**
 * Curriculum Reader Agent — v2 (public contract).
 *
 * The safety gate AND the structured-context publisher. Resolves the
 * strict `curriculumRef` from the KB + approvedSyllabi pair (refuses
 * on any miss — see ./curriculumResolver.js), then projects the
 * matched KB module into a richer agent output that the 7 downstream
 * agents consume:
 *
 *   { grade, subject, term, topic, subtopic, lessonNumber, assessmentType,
 *     competencies[], learningOutcomes[], keyConcepts[], suggestedContent[],
 *     curriculumDocumentPath, curriculumVersion, confidenceScore,
 *     status: 'ok' | 'needs_review',
 *     matchKind: 'subtopic_exact' | 'topic_only',
 *     citedExcerpts[], sourceChecksums[], sourceDocId, moduleId }
 *
 * Shape is pinned by `curriculumReaderOutputSchema` in
 * src/schemas/learnerAi.js. The dispatcher stashes the output on
 * `chainContext.curriculumReader`; the slim audit slice goes onto
 * `chainContext.curriculumReference` (unchanged), which the
 * _stubFactory writes into aiGeneratedContent.curriculumReference.
 *
 * Tri-state outcomes:
 *   - ok                 — strong match, generator runs as usual.
 *   - needs_review       — weak match (topic-only fallback, sparse KB
 *                          data). Generator STILL runs; the signal
 *                          propagates onto the artifact's qualityCheck
 *                          block for admin attention.
 *   - hard error         — resolver refused. Dispatcher halts; no
 *                          generator runs.
 *
 * The deterministic confidence formula is documented on
 * `computeConfidenceScore` below and unit-tested by
 * scripts/test-curriculum-reader-noguess.mjs.
 */

const {resolveStrictCurriculumRef} = require("../curriculumResolver");
const {writeAgentLog, updateLiveAgentState, writeTaskStep} = require("../logger");
const {TASK_STATUS, TASK_STEP_STATUS, SEVERITY} = require("../v2Collections");

const AGENT_ID = "Curriculum Reader Agent";

const NEEDS_REVIEW_THRESHOLD = 0.6;

/**
 * Pure helper. Picks "key concepts" out of the matched KB module
 * since cbcKnowledgeBase has no `keyConcepts` field. Priority order:
 *   1. `vocabulary[]` — closest semantic match (lesson terminology).
 *   2. First 5 `assessmentCriteria[]` entries.
 *   3. `contentSummary.split('. ')` leading clauses.
 * Returns at most 8 entries, each trimmed to 200 chars.
 *
 * @param {object|null} matchedModule
 * @returns {string[]}
 */
function deriveKeyConcepts(matchedModule) {
  if (!matchedModule) return [];
  const out = [];
  const add = (s) => {
    if (typeof s !== "string") return;
    const trimmed = s.trim();
    if (!trimmed) return;
    out.push(trimmed.slice(0, 200));
  };
  const vocab = matchedModule.vocabulary;
  if (Array.isArray(vocab) && vocab.length) {
    for (const v of vocab) {
      add(v);
      if (out.length >= 8) return out;
    }
  }
  if (!out.length) {
    const crit = matchedModule.assessmentCriteria;
    if (Array.isArray(crit) && crit.length) {
      for (const c of crit.slice(0, 5)) {
        add(c);
        if (out.length >= 8) return out;
      }
    }
  }
  if (!out.length && typeof matchedModule.contentSummary === "string") {
    const parts = matchedModule.contentSummary.split(/\.\s+/);
    for (const p of parts.slice(0, 5)) {
      add(p);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/**
 * Pure helper. Picks "suggested content" out of the matched KB module
 * (no source field by that name exists). Priority order:
 *   1. `teachingMaterials[]` — closest semantic match (materials a
 *      learner / generator could lean on).
 *   2. `learnerActivities[]` — fallback for modules with no listed
 *      materials.
 * Returns at most 8 entries, each trimmed to 400 chars.
 *
 * @param {object|null} matchedModule
 * @returns {string[]}
 */
function deriveSuggestedContent(matchedModule) {
  if (!matchedModule) return [];
  const out = [];
  const add = (s) => {
    if (typeof s !== "string") return;
    const trimmed = s.trim();
    if (!trimmed) return;
    out.push(trimmed.slice(0, 400));
  };
  const tm = matchedModule.teachingMaterials;
  if (Array.isArray(tm) && tm.length) {
    for (const v of tm) {
      add(v);
      if (out.length >= 8) return out;
    }
  }
  if (!out.length) {
    const la = matchedModule.learnerActivities;
    if (Array.isArray(la) && la.length) {
      for (const v of la) {
        add(v);
        if (out.length >= 8) return out;
      }
    }
  }
  return out;
}

/**
 * Confidence scoring formula (deterministic, unit-tested):
 *
 *   base = 0.8 if matchKind === 'subtopic_exact' else 0.5
 *   + 0.05 * min(citedExcerpts.length, 5)
 *   + 0.05 if competencies[] non-empty
 *   + 0.05 if learningOutcomes[] non-empty
 *   + 0.05 if sourceChecksums[] non-empty
 *   clamp to [0, 1]
 *
 * Threshold: < 0.6 → status='needs_review'. The pre-cap maxima are:
 *   subtopic_exact, all signals present → 0.8 + 0.25 + 0.05 + 0.05 + 0.05 = 1.20 → clamp 1.0
 *   topic_only, all signals present     → 0.5 + 0.25 + 0.05 + 0.05 + 0.05 = 0.90
 *   topic_only, no excerpts, sparse KB  → 0.5                                   = 0.50 (< 0.6 → needs_review)
 *
 * @param {object} args
 * @param {('subtopic_exact'|'topic_only')} args.matchKind
 * @param {Array} args.citedExcerpts
 * @param {Array} args.competencies
 * @param {Array} args.outcomes
 * @param {Array} args.sourceChecksums
 * @returns {number}
 */
function computeConfidenceScore({matchKind, citedExcerpts, competencies, outcomes, sourceChecksums}) {
  let score = matchKind === "subtopic_exact" ? 0.8 : 0.5;
  const excerptCount = Array.isArray(citedExcerpts) ? citedExcerpts.length : 0;
  score += 0.05 * Math.min(excerptCount, 5);
  if (Array.isArray(competencies) && competencies.length) score += 0.05;
  if (Array.isArray(outcomes) && outcomes.length) score += 0.05;
  if (Array.isArray(sourceChecksums) && sourceChecksums.length) score += 0.05;
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  // Round to 4 decimal places so equality assertions in tests are stable.
  return Math.round(score * 10000) / 10000;
}

function arrayOfStrings(value, limit) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    out.push(t.slice(0, limit || 400));
  }
  return out;
}

/**
 * Project the resolver's strict refusal-or-success into the
 * CurriculumReaderOutput shape (src/schemas/learnerAi.js).
 *
 * @param {object} task                Raw aiAgentTasks doc (incl. assessmentType).
 * @param {object} resolved            { ok:true, curriculumRef, matchedModule, matchKind }
 * @returns {object}                   CurriculumReaderOutput
 */
function projectAgentOutput({task, resolved}) {
  const ref = resolved.curriculumRef;
  const mod = resolved.matchedModule || {};
  const matchKind = resolved.matchKind || "topic_only";

  const competencies = arrayOfStrings(mod.competencies, 400);
  const learningOutcomes = arrayOfStrings(mod.outcomes, 400);
  const keyConcepts = deriveKeyConcepts(mod);
  const suggestedContent = deriveSuggestedContent(mod);

  const confidenceScore = computeConfidenceScore({
    matchKind,
    citedExcerpts: ref.citedExcerpts || [],
    competencies,
    outcomes: learningOutcomes,
    sourceChecksums: ref.sourceChecksums || [],
  });

  const status = confidenceScore < NEEDS_REVIEW_THRESHOLD ? "needs_review" : "ok";

  return {
    grade: String(ref.grade || task.grade || ""),
    subject: String(ref.subject || task.subject || ""),
    term: ref.term != null ? String(ref.term) : (task.term != null ? String(task.term) : null),
    topic: String(ref.topic || task.topic || ""),
    subtopic: ref.subtopic ? String(ref.subtopic) : (task.subtopic ? String(task.subtopic) : null),
    lessonNumber: Number.isInteger(task.lessonNumber) ? task.lessonNumber : null,
    assessmentType: task.assessmentType || null,
    competencies,
    learningOutcomes,
    keyConcepts,
    suggestedContent,
    curriculumDocumentPath: String(ref.storagePath || ""),
    curriculumVersion: String(ref.kbVersion || ""),
    confidenceScore,
    status,
    matchKind,
    citedExcerpts: Array.isArray(ref.citedExcerpts) ? ref.citedExcerpts : [],
    sourceChecksums: Array.isArray(ref.sourceChecksums) ? ref.sourceChecksums : [],
    sourceDocId: String(ref.sourceDocId || ""),
    moduleId: String(ref.moduleId || ""),
  };
}

/**
 * Slim audit slice for aiGeneratedContent.curriculumReference. Same
 * 4 fields the v2 schema persists (see curriculumReferenceSchema).
 * Keeping the runner output of `curriculumReference` byte-for-byte
 * compatible with what _stubFactory used to receive means the slim
 * audit field stays unchanged across this PR.
 */
function projectPersistSlice(output) {
  return {
    persist: {
      documentPath: output.curriculumDocumentPath || "",
      competency: (output.competencies && output.competencies[0]) || "",
      learningOutcome: (output.learningOutcomes && output.learningOutcomes[0]) || null,
      sourceVersion: output.curriculumVersion || null,
    },
    inMemory: {
      sourceDocId: output.sourceDocId,
      moduleId: output.moduleId,
      citedExcerpts: output.citedExcerpts || [],
      sourceChecksums: output.sourceChecksums || [],
    },
  };
}

async function runCurriculumReader({task, stepNumber = 1}) {
  const input = {
    grade: task.grade,
    subject: task.subject,
    topic: task.topic,
    subtopic: task.subtopic,
    term: task.term,
  };

  await updateLiveAgentState(AGENT_ID, {
    agentName: AGENT_ID,
    status: TASK_STATUS.CHECKING,
    currentTaskId: task.id,
    currentTask: `Resolve curriculum for ${input.topic || input.subject || ""}`,
    progress: 10,
    grade: input.grade, subject: input.subject, topic: input.topic,
    subtopic: input.subtopic, term: input.term,
    lastMessage: "Looking up approved syllabus reference",
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve curriculum reference",
    message: "Reading cbcKnowledgeBase + approvedSyllabi",
    status: TASK_STEP_STATUS.RUNNING, progress: 25,
  });

  const resolved = await resolveStrictCurriculumRef(input);

  if (!resolved.ok) {
    await writeAgentLog({
      taskId: task.id, agentName: AGENT_ID, action: "resolve_curriculum",
      message: `Refused: ${resolved.reason}`,
      taskType: task.taskType,
      grade: task.grade, subject: task.subject, topic: task.topic,
      severity: SEVERITY.WARNING,
    });
    await writeTaskStep({
      taskId: task.id, agentName: AGENT_ID, stepNumber,
      stepTitle: "Resolve curriculum reference",
      message: `Refused: ${resolved.reason}`,
      status: TASK_STEP_STATUS.FAILED, progress: 100,
    });
    await updateLiveAgentState(AGENT_ID, {
      status: "failed", currentTaskId: null, lastMessage: resolved.reason,
    });
    return {ok: false, reason: resolved.reason, suggestions: resolved.suggestions || []};
  }

  const output = projectAgentOutput({task, resolved});
  const slim = projectPersistSlice(output);

  const summary = `${output.status} (confidence=${output.confidenceScore.toFixed(2)}, ` +
    `match=${output.matchKind}, excerpts=${output.citedExcerpts.length}, ` +
    `competencies=${output.competencies.length}, outcomes=${output.learningOutcomes.length})`;

  await writeAgentLog({
    taskId: task.id, agentName: AGENT_ID, action: "resolve_curriculum",
    message: `Grounded in ${output.curriculumDocumentPath || output.sourceDocId} — ${summary}`,
    taskType: task.taskType,
    grade: task.grade, subject: task.subject, topic: task.topic,
    severity: output.status === "needs_review" ? SEVERITY.WARNING : SEVERITY.INFO,
  });
  await writeTaskStep({
    taskId: task.id, agentName: AGENT_ID, stepNumber,
    stepTitle: "Resolve curriculum reference",
    message: summary,
    status: TASK_STEP_STATUS.COMPLETED, progress: 100,
  });
  await updateLiveAgentState(AGENT_ID, {
    status: "completed", currentTaskId: null, progress: 100,
    lastMessage: summary,
  });

  return {ok: true, output, curriculumReference: slim};
}

module.exports = {
  runCurriculumReader,
  AGENT_ID,
  // Exported pure helpers for unit tests + downstream agents that
  // need to reproduce the same scoring locally.
  deriveKeyConcepts,
  deriveSuggestedContent,
  computeConfidenceScore,
  projectAgentOutput,
  projectPersistSlice,
  NEEDS_REVIEW_THRESHOLD,
};
