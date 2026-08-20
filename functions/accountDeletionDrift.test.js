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
  ["spellingWords",
    "Reviewed spelling CONTENT for a grade — the word, its context sentence, " +
    "where to cut it and why people get it wrong. Curriculum material an " +
    "admin authored and approved, shared by every learner in the grade; the " +
    "only uid it can hold is the ADMIN who wrote or reviewed it, which is an " +
    "operator action. The learner's side of spelling is `spellingProgress`, " +
    "which IS purged"],
  ["spellingSentences",
    "Spelling Ride's Word Choice sentences — a gap-fill sentence and the two " +
    "lookalikes a learner chooses between. The same kind of record as " +
    "`spellingWords` and retained for the same reason: reviewed curriculum " +
    "material shared by every learner in the grade, whose only uid is the " +
    "ADMIN who wrote or approved it. A learner's answers to these live in " +
    "`spellingProgress`, which IS purged"],
  ["dailyQuizzes",
    "The day's five question IDs for a GRADE — grade, date, question ids, " +
    "seed and which selection rules bent. No uid, no name, nothing about any " +
    "individual: one document is shared by every learner in the grade, which " +
    "is the whole design. The learner's side of it is `dailyAttempts`, which " +
    "IS purged"],
  ["dailyQuizEvents",
    "Operational log of every write to dailyQuizzes and why — cron, " +
    "self-heal, Vigil or a named admin. A learner's uid is deliberately NEVER " +
    "written here (a self-heal records `trigger: 'learner_visit'` and nothing " +
    "more), so the only uid a row can hold is the ADMIN who ran or voided " +
    "something — an operator action, the same line opsMonitorState draws"],
  ["dailyQuizAlerts",
    "One row per grade per month recording that the bank-runway alert was " +
    "already sent, so the content team is emailed once rather than nightly. " +
    "Grade, period and a day count — about CONTENT SUPPLY, not about people"],
  // Server-only ops / agent / audit / telemetry / rate-limit / dedup — no
  // end-user PII home (or only an incidental actor/uid reference).
  ["opsMonitorState",
    "Cloud Functions error-watch state: per-function error streaks, alert " +
    "cooldowns and the drill throttle. Ops telemetry about FUNCTIONS, not " +
    "about people — the only uid it holds is the admin who last pressed the " +
    "alarm-drill button, an operator action rather than user data. Purging it " +
    "on a deletion would reset every alert cooldown to zero"],
  ["processedWebhookEvents",
    "Replay ledger for inbound webhook deliveries (Lenco, Meta WhatsApp). A " +
    "row is a hashed delivery id plus the provider's own event fields — a " +
    "Lenco reference (OUR payment doc id, not personal data) or a Meta wamid " +
    "(an opaque message id; the phone number is deliberately not stored). " +
    "RETAINED rather than purged because the rows are what stops a redelivery " +
    "being processed twice: deleting a departing user's rows would REOPEN the " +
    "replay window on their own payment webhooks, which is the failure the " +
    "collection exists to prevent. Self-limiting anyway — every row carries a " +
    "30-day expiresAt for a Firestore TTL policy"],
  ["accountDeletionAudit",
    "Append-only trail of every deletion-request transition: who asked, "  +
    "who answered, when it escalated, when the window closed. RETAINED "  +
    "because it is the evidence /child-safety promises a guardian — that " +
    "they can view, change and delete their child's data, and that it "    +
    "actually happened. A trail purged along with the account proves "     +
    "nothing about the one deletion anybody would ever ask about. It "     +
    "holds uids, state names and timestamps and NO personal data: no "     +
    "name, no email, no content. Once the auth record and the users doc "  +
    "are gone those uids identify nobody. The request document itself, "   +
    "which DOES carry the child's display name, is purged"],
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
  ["accountPurgeJobs",
    "the deletion's own tombstone (functions/account/accountPurgeJobs.js). It " +
    "must OUTLIVE the purge it tracks — it is the sweeper's work queue when a " +
    "purge dies after the Auth user is gone, and the record " +
    "bootstrapUserProfile checks before rebuilding a profile, so purging it " +
    "would re-open the resurrection window it exists to close. It holds no " +
    "PII: uid, status, attempts, and the address as a SHA-256 so support can " +
    "answer 'did this finish?' from an address they already have"],
  ["deletionRequests",
    "public deletion-request queue (zedexams.com/delete-account). NOT purged " +
    "by uid — a request is keyed by a self-asserted email and may exist for " +
    "someone with no account at all, so a uid-keyed purge structurally cannot " +
    "reach it. The row is instead closed and REDACTED by " +
    "accountDeletionRequests.closeDeletionRequests() on the deleteMyAccount " +
    "path: status/timestamps survive as the audit trail that the request was " +
    "honoured, while email, name, notes, IP and user-agent are cleared"],
  ["platformStats",
    "REVIEW: DAU/WAU/retention rollup written by rollUpPlatformMetrics. The " +
    "platformStats/{day} summary documents are pure aggregate counts — no " +
    "uid, no name, no email — and purging them would corrupt historical " +
    "business metrics for everyone else, since one departing user would " +
    "retroactively change a past day's DAU. The subcollection " +
    "platformStats/{day}/active/{uid} is the part that carries an end-user " +
    "identifier: a uid, a role string and a TTL stamp, and nothing else. It " +
    "is flagged REVIEW rather than clean-RETAINED because that uid IS user " +
    "data under a strict reading, even though it is pseudonymous residue once " +
    "the auth record and users doc are gone. It self-limits at 400 days via " +
    "ACTIVE_MARKER_TTL_DAYS. Purging it per-uid is not free — the markers are " +
    "spread one doc per active day, so erasure means walking up to 400 daily " +
    "subcollections — and it would shrink historical retention cohorts after " +
    "the fact. Owner decision, deliberately not made unilaterally here"],
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
  ["gameTombstones",
    "One doc per game an admin permanently deleted, written by the Games " +
    "Seed Importer. Catalogue state, not user data: it names the GAME " +
    "(id, title, type, grade, subject) and the only uid on it is the " +
    "admin who performed the deletion — an operator action, in the same " +
    "class as `deletedBy` on any moderation record. RETAINED because it " +
    "is load-bearing for every learner: the bundled seed catalogue ships " +
    "in the client, so this list is what stops a deleted game reappearing " +
    "on the games hub and staying playable through a direct link. Purging " +
    "it when that admin closes their account would silently restore every " +
    "game they had ever deleted"],
  ["leaderboards",
    "The TOP-LEVEL doc is the games board's aggregated top-N per game and " +
    "holds no uid. Its `weeks/{weekId}/entries/{uid}` SUBCOLLECTION — the " +
    "Daily Quiz's weekly board — does carry a uid and a display name, and is " +
    "purged: see COLLECTION_GROUP_COLLECTIONS in accountDeletion.js, which " +
    "exists because a top-level classification says nothing about a " +
    "subcollection"],
  ["gamesLeaderboards",
    "The TOP-LEVEL doc holds nothing at all — the games weekly board's data " +
    "IS the path, `{grade}/weeks/{weekId}/entries/{uid}`. That `entries` " +
    "subcollection carries a uid and a public display name and IS purged, " +
    "by the same COLLECTION_GROUP_COLLECTIONS entry that reaches the Daily " +
    "Quiz's board: both use the collection-group name `entries` on field " +
    "`uid`, which is why the subcollection was named that deliberately " +
    "rather than `rows` or `learners`. A learner deleting their account " +
    "takes their games board rows with them and needs no second list to " +
    "keep in step"],
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
