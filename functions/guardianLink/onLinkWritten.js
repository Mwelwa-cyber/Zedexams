"use strict";

/**
 * onParentLinkWritten — keeps `users/{learnerUid}.guardian.effective` in
 * step with the links that decide it.
 *
 * ── Why a denormalised field exists at all ──────────────────────────
 *
 * Consent lives on the LINK, and "is this learner approved" is a fold
 * over every link naming them. Cloud Functions can run that fold — they
 * do, in consentGuard, from a live read, which stays the authoritative
 * answer.
 *
 * Firestore RULES cannot. A rule can `get()` one document by path; it
 * cannot run a query, so there is no expression in firestore.rules that
 * can ask "does this learner have at least one approved link". Without a
 * denormalised copy, the only rule-level gate available would be no gate
 * — and the leaderboard is written straight from the client with no
 * server function in the path, so "no rule" means "no enforcement".
 *
 * So the fold is computed here, on every link write, and mirrored onto
 * the learner where a rule can reach it by path.
 *
 * ── The mirror is a CACHE, and is treated as one ────────────────────
 *
 * Two consequences, both deliberate:
 *
 *   1. Nothing that can consult the live links reads this field instead.
 *      consentGuard reads the links. A stale mirror must be able to cost
 *      at most a leaderboard row, never an AI conversation.
 *   2. The rule is written so that a MISSING mirror denies rather than
 *      allows — but an EXISTING learner base has no mirror yet, so the
 *      rule reads it with a permissive default until the backfill has
 *      run. That is the same migration exception guardianLinkCore makes,
 *      and it is stated in firestore.rules rather than left implicit.
 *
 * ── Region ──────────────────────────────────────────────────────────
 *
 * `africa-south1`, pinned, because the `(default)` Firestore database
 * lives there and an unpinned Firestore trigger makes Eventarc hop
 * regions on every event. See CLAUDE.md.
 */

const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

let corePromise = null;
function loadCore() {
  if (!corePromise) corePromise = import("../shared/guardian/guardianLinkCore.js");
  return corePromise;
}

/**
 * Recompute and mirror one learner's effective state.
 *
 * Exported separately from the trigger so the backfill script and the
 * tests can drive the same code the trigger runs — a mirror maintained
 * by two implementations is a mirror that will disagree with itself.
 */
async function refreshLearnerEffectiveState(db, learnerUid) {
  if (!learnerUid) return null;
  const core = await loadCore();

  const [linkSnap, userSnap] = await Promise.all([
    db.collection("parentLinks").where("learnerUid", "==", learnerUid).get(),
    db.collection("users").doc(learnerUid).get(),
  ]);
  if (!userSnap.exists) return null;

  const links = linkSnap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
  const user = userSnap.data() || {};

  const consent = core.resolveLinkConsent(links, {
    accountStatus: user?.guardian?.consentStatus,
  });
  const permissions = core.resolveLinkPermissions(links);

  const effective = {
    state: consent.state,
    approved: consent.approved,
    // How the approval was reached, so an operator can tell a real
    // link-backed approval from one still resting on the pre-links
    // account field or on the migration grace. This is what tells you
    // whether the grace is yet safe to switch off.
    source: consent.source,
    guardianCount: consent.approvedBy.length,
    pending: consent.pending,
    withdrawn: consent.withdrawn,
    permissions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("users").doc(learnerUid).set({
    guardian: {effective},
  }, {merge: true});

  return effective;
}

const onParentLinkWritten = onDocumentWritten({
  document: "parentLinks/{linkId}",
  region: "africa-south1",
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (event) => {
  const before = event.data?.before?.data() || null;
  const after = event.data?.after?.data() || null;

  // A delete names the learner only in `before`. Both are read because
  // the mirror has to be refreshed on a removal too — a link deleted by
  // a child rejecting a stranger must drop that stranger's pending count
  // back, and a learner whose LAST approved link is deleted must land in
  // limited mode rather than keeping a mirror nobody will ever refresh
  // again.
  const learnerUids = new Set(
      [after?.learnerUid, before?.learnerUid].filter((v) => typeof v === "string" && v),
  );

  for (const learnerUid of learnerUids) {
    try {
      await refreshLearnerEffectiveState(admin.firestore(), learnerUid);
    } catch (err) {
      // Logged loudly rather than rethrown. A retry storm on this trigger
      // would re-run the fold for every link in a family on every attempt,
      // and the mirror is a cache whose miss is covered by the live read
      // in consentGuard — so failing quietly here is strictly better than
      // failing loudly and repeatedly.
      console.error("[onParentLinkWritten] mirror refresh failed", learnerUid, err?.message || err);
    }
  }
});

module.exports = {onParentLinkWritten, refreshLearnerEffectiveState};
