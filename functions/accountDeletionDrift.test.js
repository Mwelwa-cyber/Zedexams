"use strict";

// Account-deletion purge-completeness DRIFT GUARD (LEGAL-004).
//
// The purge lists in accountDeletion.js are hand-maintained. This test makes a
// forgotten collection a CI failure instead of a silent compliance gap: every
// TOP-LEVEL collection declared in firestore.rules must be consciously
// classified as either
//   • PURGED   — covered by one of the three lists in accountDeletion.js, or
//   • RETAINED — listed below WITH a reason (public/shared/server-only/audit/
//     compliance data, or PII a uid-keyed purge structurally cannot reach).
// A brand-new collection added to firestore.rules that is in neither list
// fails this test until someone decides which bucket it belongs in — which is
// exactly the human decision the audit wants to force. It also fails on a
// STALE entry (a purge/retain target that no longer exists in the rules), so a
// renamed/removed collection can't leave a dead no-op query behind.
//
// Plain `node` script (repo convention). Run: node functions/accountDeletionDrift.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  UID_DOC_COLLECTIONS,
  FIELD_QUERY_COLLECTIONS,
  ARRAY_MEMBERSHIP_COLLECTIONS,
} = require("./accountDeletion");

// ── Parse the TOP-LEVEL collections out of firestore.rules ────────────────
// Top-level = a `match /<name>/{...}` that sits directly inside the
// `match /databases/{database}/documents { ... }` root (i.e. real
// collections, not nested subcollections like members/items/questions).
function parseTopLevelCollections(src) {
  const lines = src.split("\n");
  const top = new Set();
  let depth = 0;
  let docDepth = null;
  for (const line of lines) {
    const isDocsRoot = /match\s+\/databases\/\{database\}\/documents\s*\{/.test(line);
    const nameMatch =
      line.match(/match\s+\/([A-Za-z_][A-Za-z0-9_]*)\/\{[^}]*\}\s*\{/) ||
      line.match(/match\s+\/([A-Za-z_][A-Za-z0-9_]*)\/\{/);
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (isDocsRoot) docDepth = depth + 1;
    if (nameMatch && docDepth !== null && depth === docDepth) {
      top.add(nameMatch[1]);
    }
    depth += opens - closes;
  }
  return top;
}

// ── RETAINED allowlist — every non-purged top-level collection, with why ──
// Prefix a reason with "REVIEW:" when the collection DOES hold end-user data
// but is deliberately left in place for now (see docs runbook) — it is still
// consciously classified, so it does not fail the guard, but it is flagged for
// an owner decision.
const RETAINED = new Map([
  // Server-only ops / agent / audit / telemetry / rate-limit / dedup — no
  // end-user PII home (or only an incidental actor/uid reference).
  // Deliberately NOT purged, and this is the one entry where purging would be
  // actively harmful: the tombstone is what stops bootstrapUserProfile from
  // rebuilding users/{uid} while the purge is still running. Delete it as part
  // of the purge and the race it closes re-opens — and a client waking later
  // with a still-valid cached token could resurrect the account for good.
  // Holds no PII: a uid, a status and two timestamps. Permanent by design;
  // safe to keep because re-registration mints a NEW uid even for the same
  // email, so a returning user is never blocked by their own tombstone.
  ["accountDeletions", "account-deletion tombstones; must OUTLIVE the purge or the resurrection race re-opens"],
  ["adminAuditLogs", "append-only admin-action ledger; compliance record"],
  ["agentControl", "per-agent circuit-breaker flags; ops config"],
  ["aiAgentControls", "learner-AI agent toggles; ops config"],
  ["aiAgentLogs", "append-only agent audit log"],
  ["aiAutomationSettings", "global learner-AI policy doc"],
  ["assessmentBands", "global pedagogical rules per stage of the education ladder; admin-authored config, no learner or teacher data"],
  ["topicMisconceptions", "aggregate learner misconceptions per curriculum topic, harvested from generated distractor rationales; no per-user data and no attribution to the teacher whose paper contributed a row"],
  ["aiDailyLimits", "per-day AI-call rate-limit counters; no PII"],
  ["aiGeneratedContent", "grade-scoped published agent content; not user-owned"],
  ["aiGeneratedContentVersions", "append-only agent-content version history"],
  ["aiGenerationLog", "AI-image cost audit log"],
  ["aiLiveAgentStates", "per-agent heartbeat telemetry"],
  ["aiSupervisorLogs", "agent-supervisor decision audit"],
  ["aiTaskSteps", "per-step agent telemetry"],
  ["aiUsage", "per-day AI spend rollups; financial/operational"],
  ["aiUsageDaily", "per-day generation counter"],
  ["appCheckHealth", "App Check attestation telemetry"],
  ["dawnConfig", "Dawn briefing config; admin-only"],
  ["dawnRuns", "Dawn briefing run records; ops"],
  ["downloadTickets", "short-lived bearer download tickets; TTL-reaped"],
  ["curriculumUpdateReports", "Curriculum Watcher agent output"],
  ["curriculumUploads", "admin curriculum-upload summaries"],
  ["newsletterSignupRateLimit", "per-IP signup rate-limit counter"],
  ["playBindingHealth", "Play account-binding telemetry"],
  ["processedEvents", "trigger-dedup claim docs; no client access"],
  ["rateLimits", "burst-throttle counters; no client access"],
  ["ageGateAttempts",
    "neutral-age-screen cooldown: sha256(deviceId) → timestamp, written before " +
    "any account exists. Carries NO uid — a uid-keyed purge structurally " +
    "cannot reach it, and there is nothing in a row that identifies a person. " +
    "Rows self-expire via the `expiresAt` TTL field after 24h"],
  ["deletionRequests",
    "public deletion-request queue (zedexams.com/delete-account). NOT purged " +
    "by uid — a request is keyed by a self-asserted email and may exist for " +
    "someone with no account at all, so a uid-keyed purge structurally cannot " +
    "reach it. The row is instead closed and REDACTED by " +
    "accountDeletionRequests.closeDeletionRequests() on the deleteMyAccount " +
    "path: status/timestamps survive as the audit trail that the request was " +
    "honoured, while email, name, notes, IP and user-agent are cleared"],
  ["securityAuditLogs", "MFA/admin-security ledger; compliance record"],
  ["visitorStats", "per-day visitor rollups; anonymous telemetry"],
  ["visits", "raw visit tracker; anonymous telemetry"],
  ["webauthnChallenges", "single-use WebAuthn challenges; TTL-reaped, no client access"],
  // Public / shared / aggregate content — not owned by any single end user.
  ["announcements", "platform banners; admin-authored, public-read"],
  ["approvedSyllabi", "approved-syllabus index; admin-authored"],
  ["assessmentStandards", "grade×subject exam standards; shared"],
  ["cbcKnowledgeBase", "curriculum knowledge base; admin-authored"],
  ["curriculum", "private curriculum RAG corpus; server-only"],
  ["daily_challenges", "featured game per day; admin-authored"],
  ["examTimetables", "published ECZ exam timetables; admin-authored"],
  ["games", "admin-curated games; public-read"],
  ["leaderboards", "aggregated top-N per game; not keyed by uid"],
  ["lessonPlanTemplates", "anonymised shared templates; server-maintained"],
  ["noteInsights", "AI summary cache keyed by noteId; about a note, not a user"],
  ["noteSmart", "AI highlight layer keyed by noteId; about a note, not a user"],
  ["pastPapers", "published ECZ past-paper archive; admin-authored"],
  ["pastPapersIndex", "denormalised published-papers index; server-only"],
  ["promptTemplates", "prompt templates; admin-only"],
  ["publicStats", "marketing social-proof aggregate; public-read"],
  ["publicStatus", "/status page health doc; public-read"],
  ["rag_chunks", "private curriculum chunks; server-only"],
  ["settings", "platform config; admin-authored, public-read"],
  // Holds end-user data but a uid-keyed purge cannot reach it, or deletion has
  // wider side-effects — deferred to an owner decision (see
  // docs/production-readiness/runbooks/ci-supply-chain.md is CI; the deletion
  // follow-ups are tracked in the LEGAL-004 section of the PR/roadmap).
  ["contactMessages", "REVIEW: support-form PII keyed by email, no uid — needs email-match deletion"],
  ["newsletterSubscribers", "REVIEW: subscriber list keyed by email — needs unsubscribe-by-email on deletion"],
  ["scores", "REVIEW: game-play history (userId) feeding public leaderboards — deletion affects leaderboard integrity"],
  ["visualAssets", "REVIEW: teacher diagrams (createdBy); some are approved into the shared bank / referenced by published content"],
  ["diagramAssets", "REVIEW: Diagram Library assets (createdBy) — same situation as visualAssets: approved public assets are consumed by ID from papers/notes, so a blind uid purge breaks published content"],
  ["pictureBank", "REVIEW: shared diagram bank; teacher `staged` submissions carry createdBy but the bank persists"],
  ["aiOperations", "REVIEW: idempotency/request-lock metadata (userId); operational, no content body"],
  ["quizSummaries", "REVIEW: server mirror of quizzes (createdBy) — parent quizzes are purged; confirm the onQuizWritten trigger cascades the summary"],
  ["schools", "REVIEW: school profile is org data; the schools/{id}/members/{uid} membership record needs a collectionGroup delete"],
]);

const purged = new Set([
  ...UID_DOC_COLLECTIONS,
  ...FIELD_QUERY_COLLECTIONS.map((e) => e.collection),
  ...ARRAY_MEMBERSHIP_COLLECTIONS.map((e) => e.collection),
]);

const rulesPath = path.join(__dirname, "..", "firestore.rules");
const topLevel = parseTopLevelCollections(fs.readFileSync(rulesPath, "utf8"));

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("  ✗ " + msg);
  }
}

// Sanity: the parser must find a substantial set (guards against a parser that
// silently matched nothing after a rules-format change).
check(topLevel.size >= 90,
    `parser found only ${topLevel.size} top-level collections — expected ~109; the firestore.rules format may have changed and this parser needs updating`);

// 1. A collection must not be in BOTH buckets.
for (const c of purged) {
  check(!RETAINED.has(c), `"${c}" is both PURGED and RETAINED — remove it from RETAINED`);
}

// 2. EVERY top-level collection must be consciously classified. This is the
//    drift guard: a new collection in firestore.rules fails here until a human
//    decides purge-vs-retain.
for (const c of topLevel) {
  check(
      purged.has(c) || RETAINED.has(c),
      `UNCLASSIFIED collection "${c}" in firestore.rules — add it to a purge ` +
      `list in functions/accountDeletion.js (if it holds the user's data) OR ` +
      `to the RETAINED map in this test WITH a reason (if it must be kept).`,
  );
}

// 3. No STALE entries — a purge/retain target that no longer exists in rules
//    (renamed/removed) would be a dead no-op query or a lie in the allowlist.
for (const c of purged) {
  check(topLevel.has(c),
      `stale PURGE target "${c}" — not a top-level collection in firestore.rules (renamed/removed?)`);
}
for (const c of RETAINED.keys()) {
  check(topLevel.has(c),
      `stale RETAINED entry "${c}" — not a top-level collection in firestore.rules (renamed/removed?)`);
}

if (failures > 0) {
  console.error(`\naccountDeletion drift guard FAILED with ${failures} issue(s).`);
  process.exit(1);
}

console.log(
    `✓ account-deletion purge classification complete: ` +
    `${purged.size} purged + ${RETAINED.size} retained = ${purged.size + RETAINED.size} ` +
    `covering all ${topLevel.size} top-level firestore.rules collections.`,
);
console.log("All accountDeletionDrift tests passed.");
