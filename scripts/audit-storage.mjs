#!/usr/bin/env node
/**
 * scripts/audit-storage.mjs
 *
 * Survey Firebase Storage and report what's using the bytes. Optionally
 * delete orphaned blobs whose parent Firestore docs no longer exist.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *   node scripts/audit-storage.mjs                   # summary, no deletes
 *   node scripts/audit-storage.mjs --top-users 25    # per-user breakdown
 *   node scripts/audit-storage.mjs --orphans         # also list orphans
 *   node scripts/audit-storage.mjs --orphans --delete  # actually delete them
 *
 * Read-only by default. --delete is gated behind --orphans so you can't
 * accidentally purge anything without first seeing what would go.
 *
 * Orphan classes detected:
 *   - lesson-files / lesson-presentations / lesson-images: uid not in
 *     users/, OR uid exists but assetBatchId not on any lesson the uid
 *     created.
 *   - quiz-images / assessment-images: blob path not referenced from
 *     any question doc's imageUrl / optionMedia[].imageUrl / passage.imageUrl.
 *   - papers/{uid}/{paperId}/...: blob path not referenced from any
 *     pastPapers doc's pdfPath / markSchemePath.
 *   - invoices/{uid}/{paymentId}.pdf: invoice doc missing, or its
 *     storagePath doesn't match this blob.
 *
 * Conservative: blobs newer than --min-age-days (default 7) are never
 * considered orphans, so mid-upload drafts can't be reaped.
 *
 * `syllabi/` is admin-owned and is reported by total only; never an
 * orphan candidate.
 */

import admin from "firebase-admin";
import process from "node:process";

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function value(name, fallback) {
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx < 0) return fallback;
  return argv[idx + 1];
}

const TOP_USERS = Number.parseInt(value("top-users", "10"), 10);
const SHOW_ORPHANS = flag("orphans");
const DO_DELETE = flag("delete");
const MIN_AGE_DAYS = Number.parseInt(value("min-age-days", "7"), 10);
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "examsprepzambia";

if (DO_DELETE && !SHOW_ORPHANS) {
  console.error("--delete must be combined with --orphans so you see what " +
    "you're deleting first.");
  process.exit(2);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS is missing. Point it to your " +
    "Firebase service-account JSON before running this script.");
  process.exit(2);
}

admin.initializeApp({projectId: PROJECT_ID});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const PREFIXES = [
  "lesson-files/",
  "lesson-presentations/",
  "lesson-images/",
  "quiz-images/",
  "assessment-images/",
  "papers/",
  "invoices/",
  "syllabi/",
];

const cutoffMs = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v < 10 && u > 0 ? 2 : 1)} ${units[u]}`;
}

async function scanPrefix(prefix) {
  // Streams the listing so we don't hold the whole bucket in memory.
  // Returns: {count, bytes, perUid: Map<uid, {count, bytes}>, files: [{path, bytes, createdMs}]}
  const summary = {
    count: 0,
    bytes: 0,
    perUid: new Map(),
    files: [],
  };
  const stream = bucket.getFilesStream({prefix});
  await new Promise((resolve, reject) => {
    stream.on("data", (file) => {
      const path = file.name;
      const size = Number.parseInt(
        (file.metadata && file.metadata.size) || "0", 10,
      );
      const createdMs = Date.parse(
        (file.metadata && file.metadata.timeCreated) || "",
      );
      summary.count += 1;
      summary.bytes += size;
      const tail = path.slice(prefix.length);
      const uid = tail.split("/", 1)[0] || "(root)";
      const u = summary.perUid.get(uid) || {count: 0, bytes: 0};
      u.count += 1;
      u.bytes += size;
      summary.perUid.set(uid, u);
      summary.files.push({path, bytes: size, createdMs});
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return summary;
}

async function uidExists(uid) {
  if (!uid) return false;
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists;
}

async function liveLessonBatches(uid) {
  const snap = await db.collection("lessons")
    .where("createdBy", "==", uid)
    .select("assetBatchId")
    .get();
  const out = new Set();
  for (const d of snap.docs) {
    const batch = d.get("assetBatchId");
    if (batch) out.add(String(batch));
  }
  return out;
}

async function liveQuestionImagePaths() {
  // collectionGroup("questions") returns every question subcollection
  // across quizzes/ AND assessments/ in one walk, which is all we need.
  // Expensive on big datasets but unavoidable for bucket-wide orphan
  // detection.
  const paths = new Set();
  const qSnap = await db.collectionGroup("questions").get();
  for (const q of qSnap.docs) {
    const data = q.data() || {};
    const collect = (url) => {
      const p = parsePathFromUrl(url);
      if (p) paths.add(p);
    };
    collect(data.imageUrl);
    if (Array.isArray(data.optionMedia)) {
      for (const slot of data.optionMedia) collect(slot && slot.imageUrl);
    }
    if (data.passage && typeof data.passage === "object") {
      collect(data.passage.imageUrl);
    }
  }
  return paths;
}

function parsePathFromUrl(url) {
  if (!url) return null;
  const str = String(url);
  if (str.startsWith("gs://")) {
    const rest = str.slice("gs://".length);
    const slash = rest.indexOf("/");
    return slash > 0 ? rest.slice(slash + 1) : null;
  }
  const fb = str.match(
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/,
  );
  if (fb) {
    try { return decodeURIComponent(fb[1]); } catch { return null; }
  }
  const sg = str.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/([^?]+)/);
  if (sg) {
    try { return decodeURIComponent(sg[1]); } catch { return null; }
  }
  return null;
}

async function livePaperPaths() {
  const paths = new Set();
  const snap = await db.collection("pastPapers")
    .select("pdfPath", "markSchemePath").get();
  for (const d of snap.docs) {
    const pdf = d.get("pdfPath");
    const ms = d.get("markSchemePath");
    if (pdf) paths.add(String(pdf));
    if (ms) paths.add(String(ms));
  }
  return paths;
}

async function liveInvoicePaths() {
  const paths = new Set();
  const snap = await db.collection("invoices").select("storagePath").get();
  for (const d of snap.docs) {
    const p = d.get("storagePath");
    if (p) paths.add(String(p));
  }
  return paths;
}

async function findOrphans(summaries) {
  // summaries: Map<prefix, scan summary>
  const orphans = [];

  // --- lesson-* batches ---
  for (const prefix of ["lesson-files/", "lesson-presentations/"]) {
    const s = summaries.get(prefix);
    if (!s) continue;
    const seenUids = new Map();
    for (const uid of s.perUid.keys()) {
      seenUids.set(uid, await uidExists(uid));
    }
    const liveBatchesByUid = new Map();
    for (const [uid, exists] of seenUids) {
      if (!exists) continue;
      liveBatchesByUid.set(uid, await liveLessonBatches(uid));
    }
    for (const f of s.files) {
      if (!(f.createdMs < cutoffMs)) continue;
      const tail = f.path.slice(prefix.length);
      const [uid, batch] = tail.split("/", 2);
      if (!seenUids.get(uid)) {
        orphans.push({path: f.path, bytes: f.bytes, reason: "user-deleted"});
        continue;
      }
      const live = liveBatchesByUid.get(uid) || new Set();
      if (batch && !live.has(batch)) {
        orphans.push({
          path: f.path, bytes: f.bytes, reason: "batch-not-referenced",
        });
      }
    }
  }

  // --- lesson-images/ uses a different doc shape (slide.imageStoragePath)
  // and we don't reverse-index it here. Only flag user-deleted blobs.
  {
    const prefix = "lesson-images/";
    const s = summaries.get(prefix);
    if (s) {
      const seen = new Map();
      for (const uid of s.perUid.keys()) {
        seen.set(uid, await uidExists(uid));
      }
      for (const f of s.files) {
        if (!(f.createdMs < cutoffMs)) continue;
        const [uid] = f.path.slice(prefix.length).split("/", 1);
        if (!seen.get(uid)) {
          orphans.push({path: f.path, bytes: f.bytes, reason: "user-deleted"});
        }
      }
    }
  }

  // --- quiz-images / assessment-images: any path not referenced by a
  // question doc is an orphan.
  const livePaths = await liveQuestionImagePaths();
  for (const prefix of ["quiz-images/", "assessment-images/"]) {
    const s = summaries.get(prefix);
    if (!s) continue;
    for (const f of s.files) {
      if (!(f.createdMs < cutoffMs)) continue;
      if (!livePaths.has(f.path)) {
        orphans.push({
          path: f.path, bytes: f.bytes, reason: "no-question-ref",
        });
      }
    }
  }

  // --- papers ---
  const livePaperPathSet = await livePaperPaths();
  {
    const s = summaries.get("papers/");
    if (s) {
      for (const f of s.files) {
        if (!(f.createdMs < cutoffMs)) continue;
        if (!livePaperPathSet.has(f.path)) {
          orphans.push({
            path: f.path, bytes: f.bytes, reason: "no-paper-doc",
          });
        }
      }
    }
  }

  // --- invoices ---
  const liveInvoicePathSet = await liveInvoicePaths();
  {
    const s = summaries.get("invoices/");
    if (s) {
      for (const f of s.files) {
        if (!(f.createdMs < cutoffMs)) continue;
        if (!liveInvoicePathSet.has(f.path)) {
          orphans.push({
            path: f.path, bytes: f.bytes, reason: "no-invoice-doc",
          });
        }
      }
    }
  }

  return orphans;
}

async function main() {
  console.log(`# Storage audit — ${PROJECT_ID}`);
  console.log(`bucket: gs://${bucket.name}`);
  console.log(`min-age cutoff: ${MIN_AGE_DAYS} days ` +
    `(blobs newer than ${new Date(cutoffMs).toISOString()} are ignored)`);
  console.log("");

  const summaries = new Map();
  let totalBytes = 0;
  let totalCount = 0;
  for (const prefix of PREFIXES) {
    process.stderr.write(`scanning ${prefix} ...`);
    const s = await scanPrefix(prefix);
    summaries.set(prefix, s);
    totalBytes += s.bytes;
    totalCount += s.count;
    process.stderr.write(` ${s.count} files / ${fmtBytes(s.bytes)}\n`);
  }
  console.log("## Per-prefix totals\n");
  console.log("| Prefix | Files | Size |");
  console.log("|---|---:|---:|");
  for (const prefix of PREFIXES) {
    const s = summaries.get(prefix);
    console.log(`| ${prefix} | ${s.count.toLocaleString()} | ` +
      `${fmtBytes(s.bytes)} |`);
  }
  console.log(`| **total** | **${totalCount.toLocaleString()}** | ` +
    `**${fmtBytes(totalBytes)}** |\n`);

  console.log(`## Top ${TOP_USERS} uids by bytes per prefix\n`);
  for (const prefix of PREFIXES) {
    const s = summaries.get(prefix);
    if (s.perUid.size === 0) continue;
    console.log(`### ${prefix}`);
    const sorted = [...s.perUid.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, TOP_USERS);
    for (const [uid, info] of sorted) {
      console.log(`- ${uid}  ${fmtBytes(info.bytes)}  ` +
        `(${info.count} files)`);
    }
    console.log("");
  }

  if (!SHOW_ORPHANS) {
    console.log("Run again with --orphans to see orphaned-blob candidates, " +
      "and --orphans --delete to purge them.");
    return;
  }

  console.log("## Orphan scan\n");
  const orphans = await findOrphans(summaries);
  if (orphans.length === 0) {
    console.log("No orphans found above the age cutoff. Nothing to do.");
    return;
  }
  const byReason = new Map();
  let orphanBytes = 0;
  for (const o of orphans) {
    orphanBytes += o.bytes;
    const r = byReason.get(o.reason) || {count: 0, bytes: 0};
    r.count += 1;
    r.bytes += o.bytes;
    byReason.set(o.reason, r);
  }
  console.log(`Found **${orphans.length}** orphaned blobs ` +
    `(**${fmtBytes(orphanBytes)}**):`);
  for (const [reason, info] of byReason) {
    console.log(`- ${reason}: ${info.count} files / ${fmtBytes(info.bytes)}`);
  }
  console.log("");

  const sample = orphans.slice(0, 50);
  console.log("Sample (first 50):");
  for (const o of sample) {
    console.log(`  ${o.reason.padEnd(22)} ${fmtBytes(o.bytes).padStart(9)} ` +
      `${o.path}`);
  }
  if (orphans.length > sample.length) {
    console.log(`  ... and ${orphans.length - sample.length} more`);
  }

  if (!DO_DELETE) {
    console.log("\nRe-run with --orphans --delete to actually purge these.");
    return;
  }

  console.log("\nDeleting orphans...");
  let deleted = 0;
  let failed = 0;
  for (const o of orphans) {
    try {
      await bucket.file(o.path).delete({ignoreNotFound: true});
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  failed: ${o.path} — ${(err && err.message) || err}`);
    }
  }
  console.log(`Done. Deleted ${deleted}, freed ${fmtBytes(orphanBytes)}, ` +
    `${failed} failures.`);
}

main().catch((err) => {
  console.error("audit-storage failed:", err);
  process.exit(1);
});
