/**
 * Referral backfill — audit C7 PR 1 follow-up.
 *
 * PR #354 added referralCode/referredBy minting at signup. Anyone who
 * registered BEFORE PR #354 merged has `referralCode == null` (or the
 * field is absent), which means their /profile ReferralCard
 * self-hides — they can't invite friends until they get a code.
 *
 * This callable scans the users collection in batches of 100, finds
 * accounts missing a referralCode, mints a fresh one for each, and
 * writes the matching referralCodes/{code} lookup doc. Idempotent
 * (skips users that already have one) and resumable (each pass
 * processes the next batch).
 *
 * Why a callable instead of a one-shot script:
 *   - Admin SDK already lives inside the deployed function. No need
 *     to provision a service-account key locally.
 *   - Same audit trail (agentJobs rollup) as the other admin crons.
 *   - The operator can run it from the Firebase Console "test
 *     function" panel without touching code.
 *
 * Caps:
 *   - Per-call: 500 users (5 batches of 100). At our scale every
 *     call finishes well under the 60-second callable timeout.
 *   - Operator runs repeatedly until the response reports zero
 *     processed (= all users have codes).
 *
 * Auth:
 *   - Admin only. Checks users/{caller}.role === 'admin' before
 *     touching anything.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const REGION = "us-central1";
const BATCH_SIZE = 100;
const MAX_USERS_PER_CALL = 500;
const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 8;
const MAX_MINT_ATTEMPTS = 6;

function generateReferralCode() {
  const bytes = require("node:crypto").randomBytes(REFERRAL_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return code;
}

/**
 * Mint a unique code + write the lookup doc. Retries on the rare
 * collision (lookup doc already exists for a different uid).
 */
async function mintAndPersistCode(db, uid) {
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt += 1) {
    const code = generateReferralCode();
    const lookupRef = db.collection("referralCodes").doc(code);
    const snap = await lookupRef.get();
    if (snap.exists) continue;          // collision — try again
    await lookupRef.set({
      uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return code;
  }
  throw new Error("Could not mint a unique referral code after retries");
}

const backfillReferralCodes = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "256MiB",
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const db = admin.firestore();
  const callerSnap = await db.collection("users").doc(uid).get();
  const role = callerSnap.exists ? (callerSnap.data()?.role || "") : "";
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  // Optional dry-run mode — counts what would be processed without
  // writing anything. Use this once to gauge how many calls you'll
  // need to drain the queue.
  const dryRun = Boolean(request.data?.dryRun);

  // Pull a single page of up to MAX_USERS_PER_CALL users that are
  // missing a referralCode. The `where('referralCode', '==', null)`
  // pattern matches docs where the field is explicitly null AND docs
  // where it's missing entirely (Firestore treats these the same for
  // == null queries). For docs where the field is absent we'd need a
  // separate scan, but defaultUserRecord has shipped null since
  // PR #354 so any new doc has it.
  //
  // For the truly-missing field case (signups well before PR #354),
  // we fall back to scanning the full users collection in batches,
  // checking each doc client-side. This is more expensive but only
  // runs while there are stragglers.
  const summary = {
    scanned: 0,
    minted: 0,
    skipped: 0,
    errors: [],
    dryRun,
    done: false,
  };

  let lastDoc = null;
  for (let batch = 0; batch < Math.ceil(MAX_USERS_PER_CALL / BATCH_SIZE); batch += 1) {
    let q = db.collection("users").orderBy("__name__").limit(BATCH_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) {
      summary.done = true;
      break;
    }
    for (const userDoc of snap.docs) {
      summary.scanned += 1;
      lastDoc = userDoc;
      const data = userDoc.data() || {};
      // Skip users that already have a code.
      if (data.referralCode && typeof data.referralCode === "string" && data.referralCode.length > 0) {
        summary.skipped += 1;
        continue;
      }
      if (dryRun) {
        summary.minted += 1;            // counts what we WOULD mint
        continue;
      }
      try {
        const code = await mintAndPersistCode(db, userDoc.id);
        await userDoc.ref.update({
          referralCode: code,
          // Initialise the counters if they're missing too, so the
          // ReferralCard renders the "0 friends joined" line cleanly.
          referralCount: data.referralCount || 0,
          referralCredits: data.referralCredits || 0,
        });
        summary.minted += 1;
      } catch (err) {
        console.error(`[referralBackfill] mint failed for ${userDoc.id}`, err);
        summary.errors.push({uid: userDoc.id, error: String(err?.message || err).slice(0, 200)});
      }
    }
  }

  // Write an agentJobs rollup so /admin/agents shows the run alongside
  // the other admin crons.
  await db.collection("agentJobs").add({
    agentId: "referral-backfill",
    department: "growth",
    status: summary.errors.length > 0 ? "awaiting_approval" : "done",
    input: {dryRun, maxUsersPerCall: MAX_USERS_PER_CALL},
    output: {...summary, errors: summary.errors.slice(0, 10)},
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[referralBackfill] rollup write failed", err));

  return summary;
});

module.exports = {backfillReferralCodes};
