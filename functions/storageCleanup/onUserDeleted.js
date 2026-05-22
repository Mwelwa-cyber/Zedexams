/**
 * Auth onDelete cascade — sweeps every user-keyed Storage prefix when
 * a Firebase Auth user is deleted.
 *
 * Scope is intentionally Storage-only. Firestore cascade (users/{uid},
 * teacher subcollections, etc.) is its own concern and lives elsewhere;
 * this trigger exists to plug the user-level Storage leak called out
 * in the storageCleanup module header.
 *
 * Uses v1 auth triggers because v2 has no equivalent for user.onDelete
 * (the v2 "blocking" auth triggers run BEFORE create/sign-in and don't
 * cover deletion). functions/index.js already uses functions.auth.user()
 * for onCreate so we match that pattern.
 */

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

const {collectUserPrefixes, deleteByPrefix} = require("./helpers");

const onUserDeleted = functions
  .region("us-central1")
  .runWith({timeoutSeconds: 300, memory: "256MB"})
  .auth.user()
  .onDelete(async (user) => {
    const uid = user && user.uid;
    if (!uid) return null;

    const bucket = admin.storage().bucket();
    for (const prefix of collectUserPrefixes(uid)) {
      try {
        await deleteByPrefix(bucket, prefix);
      } catch (err) {
        console.warn(`[storageCleanup] onUserDeleted prefix failed: ${prefix}`,
          (err && err.message) || err);
      }
    }
    return null;
  });

module.exports = {onUserDeleted};
