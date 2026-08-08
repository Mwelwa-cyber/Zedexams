/**
 * Past-papers published-list index (perf).
 *
 * `/papers` is the top public SEO landing page. It renders the whole
 * published archive as a flat, client-filtered list — but each
 * `pastPapers/{id}` doc drags its full `assets[]` array (one entry per
 * scanned page on image papers, capped at 50) that the list never
 * shows. Reading ~200 such docs on every visit is the dominant
 * load-time cost, and the web SDK can't project the heavy field away.
 *
 * This module maintains a single denormalised doc — `pastPapersIndex/published`
 * — holding only the lightweight fields the hub needs:
 *
 *   pastPapersIndex/published: {
 *     papers:    [{ id, title, grade, subject, year, quizId,
 *                   specimen, examBoard, paperNumber }],
 *     count:     <number>,
 *     updatedAt: serverTimestamp,
 *   }
 *
 * The hub reads this ONE small doc instead of 200 heavy ones (public
 * read, no client writes — mirrors publicStats/global). It's kept fresh
 * two ways:
 *   - pastPapersIndexOnWrite: a Firestore trigger that rebuilds whenever
 *     a write actually changes the published list (status flip or a
 *     lightweight field edit on a published paper). View/download
 *     counter bumps and draft asset churn are filtered out so the
 *     rebuild doesn't fire on every paper view.
 *   - rebuildPastPapersIndexCron: a 6-hourly safety net that also serves
 *     as the initial backfill on first deploy and corrects any drift.
 */

const admin = require("firebase-admin");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {lightEntry, lightSignature} = require("./pastPapersIndexHelpers");

const COLLECTION = "pastPapers";
const INDEX_DOC = "pastPapersIndex/published";
// Matches the admin-list cap. ~500 papers of lightweight metadata is a
// few tens of KB — well under the 1MB document ceiling.
const MAX_PAPERS = 500;

/**
 * Rebuild the whole index doc from the live published papers. Cheap
 * enough to do wholesale — papers change rarely and there are only a
 * few hundred of them. Ordered year desc to match the hub's default.
 */
async function rebuildPastPapersIndex(db) {
  const snap = await db
    .collection(COLLECTION)
    .where("status", "==", "published")
    .orderBy("year", "desc")
    .limit(MAX_PAPERS)
    .get();

  // Every published paper goes into the index.
  //
  // #2191 filtered this on established provenance, matching a rules gate that
  // has since been reverted — together they emptied the public archive because
  // no paper carried the field yet. An unlabelled paper belongs in the index
  // and renders with an "Unlabelled" badge; it is not withheld.
  const papers = snap.docs.map((d) => lightEntry(d.id, d.data()));
  await db.doc(INDEX_DOC).set({
    papers,
    count: papers.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return papers.length;
}

// Co-located with the (default) Firestore database in africa-south1 so
// the Eventarc trigger and the function compute share a region (matches
// the storageCleanup handlers).
const TRIGGER_OPTS = {
  document: `${COLLECTION}/{paperId}`,
  region: "africa-south1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

const pastPapersIndexOnWrite = onDocumentWritten(TRIGGER_OPTS, async (event) => {
  try {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    // Nothing index-relevant changed (covers view/download counter bumps
    // and assets[] churn on a published paper).
    if (lightSignature(before) === lightSignature(after)) return;

    // Draft/archived churn that never touches the published list.
    const wasPublished = before?.status === "published";
    const isPublished = after?.status === "published";
    if (!wasPublished && !isPublished) return;

    await rebuildPastPapersIndex(admin.firestore());
  } catch (err) {
    console.warn("[pastPapersIndex] onWrite rebuild failed",
      (err && err.message) || err);
  }
});

// 6-hourly safety net: initial backfill on first deploy + drift
// correction if a trigger ever drops an event. us-central1 to match the
// other scheduled crons (a scheduled job reads Firestore cross-region
// fine via the admin SDK).
const CRON_OPTS = {
  schedule: "every 6 hours",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

const rebuildPastPapersIndexCron = onSchedule(CRON_OPTS, async () => {
  try {
    const n = await rebuildPastPapersIndex(admin.firestore());
    console.log(`[pastPapersIndex] cron rebuilt index with ${n} papers`);
  } catch (err) {
    console.error("[pastPapersIndex] cron rebuild failed",
      (err && err.message) || err);
  }
});

module.exports = {
  rebuildPastPapersIndex,
  pastPapersIndexOnWrite,
  rebuildPastPapersIndexCron,
};
