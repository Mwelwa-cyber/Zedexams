/**
 * backfillNotePictures — one-off migration to illustrate every study note.
 *
 * For every `noteFormat: 'study'` note in the `lessons` collection, generates
 * an illustration for each `picture` block that doesn't already have a `url`,
 * using the SAME logic as the generateNotePictures callable (Gemini 2.5 Flash
 * Image first, OpenAI gpt-image-1 fallback) and writes the URL back into the
 * block in Firestore.
 *
 * NOT run in CI — it costs real money (one AI image per picture block) and
 * needs production credentials. Run it manually:
 *
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   GEMINI_API_KEY=...  OPENAI_API_KEY=... \
 *   node scripts/backfillNotePictures.js [--dry] [--limit=N]
 *
 *   --dry        list the notes/blocks that WOULD be generated, then stop.
 *   --limit=N    only process the first N notes (useful for a costed trial run).
 *
 * Re-running is safe: blocks that already carry a `url` are skipped, so an
 * interrupted run can simply be restarted.
 */

const admin = require("firebase-admin");
const {runGenerateNotePictures} = require("../teacherTools/generateNotePictures");

const DRY = process.argv.includes("--dry");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : Infinity;

// Rough per-image cost for the budget estimate (Gemini 2.5 Flash Image and
// gpt-image-1 medium are both ≈ $0.04 at the sizes we request).
const COST_PER_IMAGE_USD = 0.04;

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  if (!geminiKey && !openaiKey) {
    console.error(
      "No image key found. Set GEMINI_API_KEY and/or OPENAI_API_KEY in the environment.",
    );
    process.exit(1);
  }

  // Study notes live in the shared `lessons` collection (kind: 'note').
  const snap = await db.collection("lessons").where("noteFormat", "==", "study").get();

  const pending = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const count = blocks.filter((b) => b && b.type === "picture" && !b.url).length;
    if (count > 0) {
      pending.push({id: doc.id, title: data.title || "(untitled)", count});
    }
  });

  const totalImages = pending.reduce((n, x) => n + x.count, 0);
  console.log(
    `Found ${pending.length} study note(s) with ${totalImages} un-illustrated ` +
    `picture block(s).`,
  );
  console.log(
    `Estimated cost: ~$${(totalImages * COST_PER_IMAGE_USD).toFixed(2)} ` +
    `(≈ $${COST_PER_IMAGE_USD.toFixed(2)}/image).`,
  );

  if (DRY) {
    pending.slice(0, 100).forEach((n) =>
      console.log(`  [dry] ${n.id} — ${n.count} picture(s) — ${n.title}`),
    );
    console.log("Dry run — no images generated.");
    return;
  }

  let notesDone = 0;
  let generated = 0;
  let failed = 0;
  for (const n of pending) {
    if (notesDone >= LIMIT) break;
    try {
      const res = await runGenerateNotePictures({
        uid: "backfill",
        noteId: n.id,
        geminiKey,
        openaiKey,
      });
      generated += res.succeeded;
      failed += res.failed;
      console.log(
        `✓ ${n.id} — ${res.succeeded}/${res.processed} generated` +
        `${res.failed ? `, ${res.failed} failed` : ""} — ${n.title}`,
      );
    } catch (err) {
      failed += n.count;
      console.error(`✗ ${n.id} — ${err && err.message ? err.message : err}`);
    }
    notesDone += 1;
  }

  console.log(
    `\nDone. Notes processed: ${notesDone}. Images generated: ${generated}. ` +
    `Failures: ${failed}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
