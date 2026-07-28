/**
 * Pure decision logic for the agent dispatcher (Content pipeline
 * Aria → Cala → Reva → awaiting_approval → Pubo), extracted from
 * dispatcher.js so it tests under plain `node`.
 *
 * Import contract: NO firebase-admin, NO firebase-functions, no runner
 * imports — dispatcher.js keeps all Firestore/trigger/runner wiring and
 * delegates every decision here. The strings and guard order below are
 * moved verbatim from dispatcher.js; changing one changes what admins
 * and the /admin/agents UI see on live jobs.
 */

// Cached snapshot of paused agentIds. Each content job triggers 3 pause
// checks (aria, cala, reva); without a cache that's 3 sequential Firestore
// reads per job in a hot path. Refresh the cache every 60s — agentControl
// only changes when an admin pauses an agent, so a minute of staleness is
// safe and saves ~95% of reads at burst.
const PAUSED_CACHE_TTL_MS = 60_000;

/**
 * Normalise a runner error into the message string recorded against the
 * circuit breaker.
 */
function agentErrorMessage(err) {
  return String((err && err.message) || err || "");
}

/**
 * Content of the ops alert sent when the circuit breaker trips (pauses an
 * agent). Pure — the caller does the actual sendOpsAlert.
 */
function breakerAlertContent({agentId, errorMessage, failuresInWindow}) {
  return {
    title: `Agent "${agentId}" auto-paused by circuit breaker`,
    severity: "critical",
    lines: [
      `${agentId} hit ${failuresInWindow} failures within the breaker ` +
        "window and was paused automatically to stop re-billing model calls.",
      `Last error: ${errorMessage.slice(0, 300)}`,
      `Investigate, then clear agentControl/${agentId}.paused to resume.`,
    ],
  };
}

/** Whether the paused-agents cache needs a Firestore refresh. */
function isPausedCacheExpired(cache, now) {
  return now >= cache.expiresAt;
}

/** Build a fresh paused-agents cache entry from the queried agent ids. */
function buildPausedCache(pausedIds, now) {
  return {expiresAt: now + PAUSED_CACHE_TTL_MS, paused: new Set(pausedIds)};
}

/**
 * onCreate trigger guard: only the Content department's Aria-rooted
 * pipeline runs, only from the queued state, and never for seed docs
 * (they're for UI dev only).
 */
function shouldRunContentChain(jobData) {
  if (jobData.department !== "content") return false;
  if (jobData.agentId !== "aria") return false;
  if (jobData.status !== "queued") return false;
  if (jobData.seed === true) return false;
  return true;
}

/**
 * Validate the job's owner (createdBy — server-trusted, pinned by the
 * Firestore create rule). A job with no valid owner is refused so the
 * per-user daily AI cap cannot be bypassed.
 */
function resolveJobOwner(jobData) {
  const ownerUid = typeof jobData.createdBy === "string" ? jobData.createdBy : "";
  if (!ownerUid || ownerUid === "system") {
    return {
      ok: false,
      fields: {
        status: "failed",
        error: "Job has no valid owner (createdBy) — refusing to run.",
      },
    };
  }
  return {ok: true, ownerUid};
}

/**
 * Classify a metering (assertDailyLimit) failure into the job fields to
 * write. resource-exhausted is the cap itself; anything else is a
 * metering outage, which fails closed.
 */
function meteringFailureFields(err) {
  const exhausted = err && err.code === "resource-exhausted";
  return {
    status: "failed",
    error: exhausted ?
      "Daily AI limit reached for this account — agent job not run. " +
        "Please try again tomorrow." :
      `Metering check failed: ${String(err && err.message || err).slice(0, 300)}`,
  };
}

/**
 * Job fields for a runner throw. `agentLabel` is the display name the
 * admin UI shows ("Aria" / "Cala" / "Reva" / "Pubo").
 */
function runnerFailureFields(agentLabel, err) {
  return {
    status: "failed",
    error: `${agentLabel}: ${String(err && err.message || err).slice(0, 500)}`,
  };
}

// Paused-agent outcomes. Aria paused fails the job (nothing ran yet);
// Cala/Reva paused hand the job to a human instead (awaiting_approval —
// Aria's draft already exists and must not be lost); Pubo paused fails
// the approved job so an admin publishes manually.
const PAUSED_JOB_FIELDS = {
  aria: {
    status: "failed",
    error: "Aria is paused (agentControl/aria.paused = true).",
  },
  cala: {
    status: "awaiting_approval",
    error: "Cala is paused — review manually.",
  },
  reva: {
    status: "awaiting_approval",
    error: "Reva is paused — review manually.",
  },
  pubo: {
    status: "failed",
    error: "Pubo is paused — admin must publish manually.",
  },
};

/** Job fields to write when the named agent is paused. */
function pausedJobFields(agentId) {
  return {...PAUSED_JOB_FIELDS[agentId]};
}

// Aria "succeeded" but produced no usable draft — the underlying generator
// returned a falsy value under the mapped draft key (aria.js maps it to
// null). Cala and Reva have nothing to work on, so the chain stops and the
// failure is attributed to Aria. Letting it fall through to Cala would
// surface the misleading "Aria must run first" AND trip CALA's circuit
// breaker for an upstream problem — auto-pausing a healthy deterministic
// agent.
const EMPTY_DRAFT_MESSAGE =
  "Aria produced an empty draft — the generator returned no content.";

/** Whether Aria's output has no usable draft (stops the chain). */
function isEmptyAriaDraft(ariaOut) {
  return !ariaOut.draft;
}

/** Job fields recording Aria's successful output + the reserved generation ref. */
function ariaSuccessFields(ariaOut) {
  return {
    "output.aria": ariaOut,
    "publishedRefs": [
      {collection: "aiGenerations", docId: ariaOut.generationId},
    ],
  };
}

/** Terminal fields of a successful Aria → Cala → Reva chain. */
function chainCompleteFields(revaOut) {
  return {
    "output.reva": revaOut,
    status: "awaiting_approval",
    agentId: "reva",
  };
}

/**
 * Audit-log entries for an approve / reject status transition, in write
 * order. Pure — the caller does the writeAuditLog I/O.
 */
function approvalAuditEntries({jobId, before, after}) {
  const entries = [];
  if (before.status !== "approved" && after.status === "approved") {
    entries.push({
      actorUid: after.reviewedBy || "system",
      action: "agent.approve",
      targetType: "agentJob",
      targetId: jobId,
      metadata: {agentId: after.agentId || null, department: after.department || null},
    });
  }
  if (before.status !== "rejected" && after.status === "rejected") {
    entries.push({
      actorUid: after.reviewedBy || "system",
      action: "agent.reject",
      targetType: "agentJob",
      targetId: jobId,
      metadata: {agentId: after.agentId || null, reason: after.reviewNotes || null},
    });
  }
  return entries;
}

/**
 * onUpdate trigger guard: run Pubo only on the not-approved → approved
 * transition of a real content job. Rejected transitions are terminal but
 * require no work — Pubo never publishes them. Scheduled rollups
 * (input.runType) are read-only reports — Compass files them under the
 * content department, and acknowledging one must not invoke Pubo (it would
 * fail on the missing aria.generationId and count against Pubo's circuit
 * breaker).
 */
function shouldRunPubo(before, after) {
  if (before.status === "approved") return false;
  if (after.status !== "approved") return false;
  if (after.department !== "content") return false;
  if (after.input && after.input.runType) return false;
  if (after.seed === true) return false;
  return true;
}

/** Fields recording Pubo's successful publish. */
function puboSuccessFields(puboOut) {
  return {
    "output.pubo": puboOut,
    status: "done",
  };
}

module.exports = {
  PAUSED_CACHE_TTL_MS,
  EMPTY_DRAFT_MESSAGE,
  agentErrorMessage,
  breakerAlertContent,
  isPausedCacheExpired,
  buildPausedCache,
  shouldRunContentChain,
  resolveJobOwner,
  meteringFailureFields,
  runnerFailureFields,
  pausedJobFields,
  isEmptyAriaDraft,
  ariaSuccessFields,
  chainCompleteFields,
  approvalAuditEntries,
  shouldRunPubo,
  puboSuccessFields,
};
