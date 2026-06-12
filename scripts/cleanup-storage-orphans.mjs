import admin from "firebase-admin";
import fs from "node:fs";

const DEFAULT_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "examsprepzambia";

const DEFAULT_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ||
  "examsprepzambia.firebasestorage.app";

const TRACKED_PREFIXES = [
  "quiz-images/",
  "lesson-images/",
  "lesson-presentations/",
];

function parseArgs(argv) {
  const args = {
    apply: false,
    help: false,
    projectId: DEFAULT_PROJECT_ID,
    bucket: DEFAULT_BUCKET,
    prefixes: [...TRACKED_PREFIXES],
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--project" && argv[index + 1]) {
      args.projectId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--bucket" && argv[index + 1]) {
      args.bucket = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--prefix" && argv[index + 1]) {
      args.prefixes = argv[index + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (value.endsWith("/") ? value : `${value}/`));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/cleanup-storage-orphans.mjs [--apply] [--project <id>] [--bucket <bucket>] [--prefix <csv>]

What it does:
  - reads Firestore lesson + quiz documents
  - extracts referenced Firebase Storage paths
  - lists files in Storage under tracked prefixes
  - reports orphaned files not referenced by Firestore
  - deletes them only when --apply is passed

Defaults:
  project: ${DEFAULT_PROJECT_ID}
  bucket:  ${DEFAULT_BUCKET}
  prefixes: ${TRACKED_PREFIXES.join(", ")}

Credentials:
  This script uses firebase-admin, so local runs need Application Default Credentials
  or a service account, for example via GOOGLE_APPLICATION_CREDENTIALS.
`);
}

function ensureFirebaseConfigFileExists() {
  if (!fs.existsSync(".firebaserc")) {
    console.warn("Warning: .firebaserc was not found in the current working directory.");
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeStoragePath(value, bucket) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const prefix of TRACKED_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed;
  }

  if (trimmed.startsWith(`gs://${bucket}/`)) {
    return trimmed.slice(`gs://${bucket}/`.length);
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname === "firebasestorage.googleapis.com") {
      const match = url.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (match && match[1] === bucket) return safeDecodeURIComponent(match[2]);
    }
    if (url.hostname === "storage.googleapis.com") {
      const pathname = url.pathname.replace(/^\/+/, "");
      if (pathname.startsWith(`${bucket}/`)) {
        return pathname.slice(bucket.length + 1);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function collectPathsFromValue(value, bucket, found) {
  if (value == null) return;

  if (typeof value === "string") {
    const normalized = normalizeStoragePath(value, bucket);
    if (normalized) found.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPathsFromValue(item, bucket, found));
    return;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectPathsFromValue(item, bucket, found));
  }
}

async function loadReferencedPaths(bucket) {
  const db = admin.firestore();
  const referencedPaths = new Set();

  const [lessonSnap, quizSnap, questionSnap] = await Promise.all([
    db.collection("lessons").get(),
    db.collection("quizzes").get(),
    db.collectionGroup("questions").get(),
  ]);

  lessonSnap.forEach((docSnap) => collectPathsFromValue(docSnap.data(), bucket, referencedPaths));
  quizSnap.forEach((docSnap) => collectPathsFromValue(docSnap.data(), bucket, referencedPaths));
  questionSnap.forEach((docSnap) => collectPathsFromValue(docSnap.data(), bucket, referencedPaths));

  return {
    referencedPaths,
    counts: {
      lessons: lessonSnap.size,
      quizzes: quizSnap.size,
      questions: questionSnap.size,
    },
  };
}

async function listFilesForPrefix(bucket, prefix) {
  const files = [];
  let pageToken;

  do {
    const [pageFiles, , response] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      pageToken,
    });
    files.push(...pageFiles);
    pageToken = response?.nextPageToken;
  } while (pageToken);

  return files;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function buildFileRecord(file) {
  const size = Number(file.metadata?.size || 0);
  return {
    path: file.name,
    size,
    created: file.metadata?.timeCreated || "",
    updated: file.metadata?.updated || "",
    file,
  };
}

async function deleteFiles(orphanedFiles) {
  let deletedCount = 0;
  let deletedBytes = 0;

  for (const orphan of orphanedFiles) {
    await orphan.file.delete();
    deletedCount += 1;
    deletedBytes += orphan.size;
    console.log(`Deleted ${orphan.path}`);
  }

  return {deletedCount, deletedBytes};
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  ensureFirebaseConfigFileExists();

  admin.initializeApp({
    projectId: args.projectId,
    storageBucket: args.bucket,
  });

  const storageBucket = admin.storage().bucket(args.bucket);

  console.log(`Project: ${args.projectId}`);
  console.log(`Bucket: ${args.bucket}`);
  console.log(`Mode: ${args.apply ? "LIVE DELETE" : "DRY RUN"}`);
  console.log(`Prefixes: ${args.prefixes.join(", ")}`);
  console.log("");

  const {referencedPaths, counts} = await loadReferencedPaths(args.bucket);
  console.log(
    `Scanned Firestore docs: ${counts.lessons} lessons, ${counts.quizzes} quizzes, ${counts.questions} questions`,
  );
  console.log(`Referenced storage paths found: ${referencedPaths.size}`);
  console.log("");

  const allFiles = [];
  for (const prefix of args.prefixes) {
    const files = await listFilesForPrefix(storageBucket, prefix);
    console.log(`Listed ${files.length} files under ${prefix}`);
    allFiles.push(...files.map(buildFileRecord));
  }

  const orphanedFiles = allFiles
    .filter((item) => !referencedPaths.has(item.path))
    .sort((a, b) => b.size - a.size);

  const totalBytes = allFiles.reduce((sum, item) => sum + item.size, 0);
  const orphanedBytes = orphanedFiles.reduce((sum, item) => sum + item.size, 0);

  console.log("");
  console.log(`Tracked files in bucket: ${allFiles.length} (${formatBytes(totalBytes)})`);
  console.log(`Orphaned files: ${orphanedFiles.length} (${formatBytes(orphanedBytes)})`);

  if (!orphanedFiles.length) {
    console.log("");
    console.log("No orphaned files found.");
    return;
  }

  console.log("");
  console.log("Largest orphaned files:");
  orphanedFiles.slice(0, 20).forEach((item) => {
    console.log(
      `  ${formatBytes(item.size).padStart(8)}  ${item.updated || item.created || "unknown-date"}  ${item.path}`,
    );
  });

  if (!args.apply) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to delete these orphaned files.");
    return;
  }

  console.log("");
  const {deletedCount, deletedBytes} = await deleteFiles(orphanedFiles);
  console.log("");
  console.log(`Deleted ${deletedCount} files and freed ${formatBytes(deletedBytes)}.`);
}

main().catch((error) => {
  console.error("");
  console.error("Storage cleanup failed.");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
