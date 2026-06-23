const crypto = require("node:crypto");

function createDemoTrialsHandlers({
  onCall,
  HttpsError,
  admin,
  cleanString,
}) {
  // Admin-only callable that bulk-creates demo learner accounts with a
  // trial Premium subscription. Mirrors the layout the admin UI's
  // "Grant Premium Manually" button writes (see grantPremium in
  // useFirestore.js), so the resulting docs are indistinguishable from
  // any other manually-granted subscription. Marks each user with
  // demo: true so the cohort can be queried/cleaned up later.
  const bulkGrantDemoTrials = onCall({
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "256MiB",
  }, async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const callerRole = callerSnap.exists ? (callerSnap.data() || {}).role : null;
    if (callerRole !== "admin" && callerRole !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const data = request.data || {};
    const rawEntries = Array.isArray(data.entries) ? data.entries : [];
    if (rawEntries.length === 0) {
      throw new HttpsError("invalid-argument", "Provide at least one entry.");
    }
    if (rawEntries.length > 50) {
      throw new HttpsError(
          "invalid-argument",
          "Max 50 demo accounts per batch. Split the list and try again.",
      );
    }

    const grade = Number.isInteger(data.grade) ? data.grade : 7;
    if (grade < 1 || grade > 12) {
      throw new HttpsError("invalid-argument", "grade must be 1–12.");
    }
    const days = Number.isInteger(data.days) ? data.days : 30;
    if (days < 1 || days > 365) {
      throw new HttpsError("invalid-argument", "days must be 1–365.");
    }
    const allowedPlans = new Set(["weekly", "monthly"]);
    const plan = typeof data.plan === "string" && allowedPlans.has(data.plan) ?
      data.plan :
      "monthly";
    const school = cleanString(data.school || "Demo School", 120);
    const sharedPassword = data.password ? String(data.password) : "";
    if (sharedPassword && (sharedPassword.length < 6 || sharedPassword.length > 128)) {
      throw new HttpsError(
          "invalid-argument",
          "Shared password must be 6–128 characters.",
      );
    }

    // Normalise each entry to { name, email }. Names that fail to slugify
    // or that produce a duplicate email abort the entire batch BEFORE any
    // Auth user is created — we never want a partial run that leaves
    // half the cohort in inconsistent state.
    const passwordAlphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    function generatePassword() {
      let out = "";
      for (let i = 0; i < 12; i++) {
        out += passwordAlphabet[crypto.randomInt(0, passwordAlphabet.length)];
      }
      return out;
    }
    function slugify(name) {
      return String(name || "")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9\s.-]/g, "")
          .trim()
          .replace(/\s+/g, ".")
          .replace(/\.+/g, ".")
          .replace(/^\.+|\.+$/g, "");
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set();
    const planRows = rawEntries.map((entry, idx) => {
      const name = cleanString(entry?.name || "", 120);
      if (!name) {
        throw new HttpsError("invalid-argument", `Entry #${idx + 1} is missing a name.`);
      }
      let email = cleanString(entry?.email || "", 254).toLowerCase();
      if (!email) {
        const slug = slugify(name);
        if (!slug) {
          throw new HttpsError(
              "invalid-argument",
              `Could not derive an email from the name "${name}".`,
          );
        }
        email = `${slug}@zedexams.com`;
      }
      if (!emailRe.test(email)) {
        throw new HttpsError("invalid-argument", `Invalid email: ${email}`);
      }
      if (seen.has(email)) {
        throw new HttpsError(
            "invalid-argument",
            `Duplicate email in batch: ${email}`,
        );
      }
      seen.add(email);
      return {name, email, password: sharedPassword || generatePassword()};
    });

    // Now do the writes. Each entry is independent — one failure does
    // not abort the rest, but its row is reported back with an error
    // status so the operator can retry just the failed names.
    const adminId = `admin:bulkGrantDemoTrials:${callerUid}`;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    const expiryTs = admin.firestore.Timestamp.fromDate(expiry);
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const results = [];
    for (const row of planRows) {
      try {
        let userRecord;
        let createdAuth = false;
        try {
          userRecord = await admin.auth().createUser({
            email: row.email,
            password: row.password,
            displayName: row.name,
            emailVerified: true,
            disabled: false,
          });
          createdAuth = true;
        } catch (err) {
          if (err && err.code === "auth/email-already-exists") {
            userRecord = await admin.auth().getUserByEmail(row.email);
          } else {
            throw err;
          }
        }

        const uid = userRecord.uid;

        // Account-takeover guard. An email collision — a slugified name
        // that matches a real staff @zedexams.com mailbox, or an explicit
        // email pointing at an existing teacher/admin/paying learner —
        // used to silently overwrite that account with role:"learner",
        // demo:true and a premium grant (role downgrade + data clobber).
        // Only (re)apply the demo grant to a brand-new account or one that
        // is ALREADY a demo account. Real collisions are refused and
        // surfaced so the operator handles them explicitly.
        if (!createdAuth) {
          const existingSnap = await db.doc(`users/${uid}`).get();
          if (existingSnap.exists && existingSnap.data()?.demo !== true) {
            results.push({
              name: row.name,
              email: row.email,
              uid: "",
              password: row.password,
              status: "error",
              error:
                "Refused: an existing non-demo account already uses this " +
                "email (possible staff/teacher/paying user). Provide a " +
                "unique explicit email for this entry.",
            });
            continue;
          }
        }

        // merge: true so we never wipe out fields on a re-used uid (e.g.
        // an existing DEMO account whose trial is being extended).
        await db.doc(`users/${uid}`).set({
          displayName: row.name,
          email: row.email,
          role: "learner",
          grade,
          school,
          dailyAttempts: 0,
          lastAttemptDate: "",
          referralCode: null,
          referredBy: null,
          referralCount: 0,
          referralCredits: 0,
          demo: true,
          createdAt: ts,
          // Premium grant — same shape as grantPremium() in useFirestore.
          plan: "premium",
          premium: true,
          isPremium: true,
          paymentStatus: "active",
          subscriptionStatus: "active",
          premiumActivatedAt: ts,
          subscriptionPlan: plan,
          subscriptionExpiry: expiryTs,
          subscriptionActivatedBy: adminId,
          subscriptionActivatedAt: ts,
          subscriptionProvider: "manual_grant",
        }, {merge: true});

        results.push({
          name: row.name,
          email: row.email,
          uid,
          password: row.password,
          status: createdAuth ? "created" : "reused",
        });
      } catch (err) {
        results.push({
          name: row.name,
          email: row.email,
          uid: "",
          password: row.password,
          status: "error",
          error: err?.message || String(err),
        });
      }
    }

    return {
      ok: true,
      grade,
      days,
      plan,
      expiresAt: expiry.toISOString(),
      results,
    };
  });

  return {bulkGrantDemoTrials};
}

module.exports = {createDemoTrialsHandlers};
