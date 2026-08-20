/**
 * functions/gamesLeaderboard/index.js
 *
 * `gameScoreOnCreate` — the ONE writer of the games weekly board.
 *
 *   scores/{scoreId}  ──(trigger)──▶  gamesLeaderboards/{grade}
 *                                       /weeks/{weekId}
 *                                         /entries/{uid}
 *
 * ── Why a trigger and not a callable ─────────────────────────────────────
 *
 * `saveScore` is a direct client `addDoc` and has been since games shipped;
 * every engine funnels its finished round through it. Routing the board
 * write through a new callable would mean touching all eight engines and
 * would put a cold start between a learner finishing a round and their
 * score being saved at all. A trigger keeps the write path exactly as it
 * is and adds the aggregation behind it: the round still saves at client
 * speed, and the board catches up a moment later.
 *
 * The cost is that the board is EVENTUALLY consistent with `scores` — a
 * learner who taps straight from the done screen to the board can beat the
 * trigger there by a second. The page is built for that: it subscribes to
 * its own entry document, so the number corrects itself in place rather
 * than needing a refresh.
 *
 * ── Region ───────────────────────────────────────────────────────────────
 *
 * africa-south1, like every other Firestore trigger in this repo — the
 * (default) database lives there, and a trigger anywhere else makes
 * Eventarc take a cross-region hop on every completed game.
 *
 * ── Deletion ─────────────────────────────────────────────────────────────
 *
 * The subcollection is named `entries` and every document carries a `uid`
 * field, which is exactly what `accountDeletion.js`'s
 * COLLECTION_GROUP_COLLECTIONS purge queries. A learner deleting their
 * account takes their games board rows with them without a second list to
 * keep in step.
 */

"use strict";

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {getFirestore} = require("firebase-admin/firestore");
// Every decision and every write lives in rollup.js, which deliberately does
// NOT import firebase-functions — see the header there. This file is the
// registration and nothing else.
const {COLLECTION, handleScoreCreated, weekIdForRound} = require("./rollup");

function createGameScoreOnCreate() {
  return onDocumentCreated(
      {document: "scores/{scoreId}", region: "africa-south1"},
      async (event) => {
        const snap = event.data;
        if (!snap) return;
        await handleScoreCreated({db: getFirestore(), row: snap.data() || {}});
      },
  );
}

// Exported as a FACTORY, like `functions/duel/index.js` — the function is
// built at registration in `functions/index.js` rather than at module load,
// so requiring this file from a test does not construct a Cloud Function.
module.exports = {COLLECTION, createGameScoreOnCreate, handleScoreCreated, weekIdForRound};
