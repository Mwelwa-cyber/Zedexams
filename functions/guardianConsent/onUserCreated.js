"use strict";

/**
 * learnerAgeOnUserCreated — the server's answer to "how old is this account".
 *
 * Fires once, on the creation of users/{uid}, and re-derives `isMinor` from
 * the declared date of birth using the SAME shared consent core the client
 * used. See userAgeBootstrapCore.js for why this cannot live in
 * firestore.rules and why the client's value is never trusted.
 *
 * Pinned to africa-south1: the (default) Firestore database lives there, and a
 * trigger deployed anywhere else makes Eventarc take a cross-region hop on
 * every user that signs up.
 *
 * Failure posture: a throw here means an account whose `isMinor` is whatever
 * the client wrote. That is why the client writes the conservative value too
 * (requiresGuardianConsent treats a missing date as a child) — this trigger
 * corrects, it does not create the guarantee on its own. Errors are logged and
 * swallowed rather than retried indefinitely against a document a subsequent
 * signup will not revisit.
 */

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

const {resolveAgeBootstrap} = require("./userAgeBootstrapCore");

exports.learnerAgeOnUserCreated = onDocumentCreated(
    {document: "users/{uid}", region: "africa-south1", timeoutSeconds: 30},
    async (event) => {
      const snap = event.data;
      if (!snap) return;
      const user = snap.data();
      if (!user) return;

      try {
        // Cloud Functions is CommonJS and the shared consent package is ESM,
        // so it is reached with a dynamic import INSIDE the handler — a
        // top-level require would fail at load. Same pattern as the shared
        // assessment package.
        const {requiresGuardianConsent} = await import(
            "../shared/consent/guardianConsentCore.js"
        );

        const patch = resolveAgeBootstrap(user, {requiresGuardianConsent});
        if (!patch) return;

        if (user.isMinor !== undefined && patch.isMinor !== undefined &&
            user.isMinor !== patch.isMinor) {
          // Worth a log line: a mismatch is either a stale client or a
          // deliberate one, and the two look identical from here.
          console.warn(
              "[learnerAgeOnUserCreated] corrected isMinor",
              {uid: event.params.uid, claimed: user.isMinor, derived: patch.isMinor},
          );
        }

        await snap.ref.set(patch, {merge: true});
      } catch (err) {
        console.error("[learnerAgeOnUserCreated] failed:", err);
      }
    },
);
