// Guards the firebase-admin namespace → modular migration in functions/ AND
// the root scripts/ tree (the operations and migration scripts).
//
// firebase-admin 14 DELETES the namespace API: `admin.firestore()`,
// `admin.auth()`, `admin.storage()`, `admin.messaging()`, `admin.appCheck()`
// and the statics hung off them (`admin.firestore.FieldValue`, `.Timestamp`,
// `.FieldPath`). On 14, `require("firebase-admin")` exports only the app
// functions (initializeApp, getApp, cert, …), so every one of those calls
// becomes `undefined is not a function` AT RUNTIME. Nothing in lint catches it
// — `no-undef` cannot see a missing property — and most callers have no test.
//
// The replacement is the modular import, which 13.x already supports:
//   const {getFirestore, FieldValue} = require("firebase-admin/firestore");
//   const {getAuth} = require("firebase-admin/auth");
//
// LEGACY below was the shrink-only list of files still on the namespace API
// while the migration ran; it is now EMPTY, so this is a plain ban. A file
// that uses the namespace fails; a file listed that no longer does also fails
// (so the list cannot rot into something that only looks like a record).
//
// scripts/ is scanned too (2026-09, with the root firebase-admin moving to 14).
// Those files are run by hand against production, so a namespace call there
// fails at the worst moment and no CI job would ever have executed it. They
// load the SDK through scripts/lib/adminSdk.mjs (sdk.getFirestore(),
// sdk.FieldValue, sdk.getApps()). Their pattern is wider than functions/':
// they reached the SDK as `admin.default.firestore()` through a dynamic
// import, and used `admin.apps` / `admin.credential`, both also gone in 14.
//
// Run: npm run test:firebase-admin-modular  (auto-discovered by test:all)

import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "functions");
const SCRIPTS = HERE;
const SELF = fileURLToPath(import.meta.url);

// Namespace service calls and the statics that live on them. Deliberately NOT
// `admin.initializeApp` / `admin.apps` / `admin.credential`: initializeApp
// survives in 14, and the other two are handled where they are used.
export const NAMESPACE_USE =
  /\badmin\.(?:firestore|auth|storage|messaging|appCheck|database|remoteConfig|securityRules|machineLearning|projectManagement|installations|instanceId)\b/;

// Empty since 2026-09-24: every file in functions/ is on the modular API.
// It stays a Set so the guard keeps its shape if a genuine exception is ever
// needed — but adding one re-opens a runtime break on firebase-admin 14.
const LEGACY = new Set([]);

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(name)) out.push(full);
  }
  return out;
}
const isSource = (name) => name.endsWith(".js") && !name.endsWith(".test.js");
const isTest = (name) => name.endsWith(".test.js");

// Strip comments before matching: a JSDoc line reading "(defaults to
// admin.firestore())" is history, not a call.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function usesNamespace(src) {
  return NAMESPACE_USE.test(stripComments(src));
}

// Root scripts: the same services, reached directly or through `.default`,
// plus the two app-level members 14 also removed.
export const SCRIPT_NAMESPACE_USE =
  /\badmin(?:\.default)?\.(?:firestore|auth|storage|messaging|appCheck|database|remoteConfig|securityRules|machineLearning|projectManagement|installations|instanceId|apps|credential)\b/;

export function scriptUsesNamespace(src) {
  return SCRIPT_NAMESPACE_USE.test(stripComments(src));
}

// A TEST file is only a problem when it drives the REAL SDK. Most tests fake
// firebase-admin — through a Module._load hook, or by patching properties onto
// the admin object — and calling `admin.firestore()` on their own fake is fine
// on v14. One that requires the real package with neither, and calls the
// namespace, breaks the moment it runs: paymentLifecycleEmulator.test.js did
// exactly that on the v14 bump, and nothing but the (non-required) emulator
// job saw it, because this guard skipped every *.test.js.
export function testDrivesRealNamespace(src) {
  const code = stripComments(src);
  const requiresReal = /require\(\s*["']firebase-admin["']\s*\)/.test(code);
  const fakesIt = /Module\._load\s*=|Object\.defineProperty\(\s*admin\b|\badmin\.(?:firestore|auth|storage|messaging)\s*=[^=]/.test(code);
  return requiresReal && !fakesIt && NAMESPACE_USE.test(code);
}

// The detector must be able to fail, or an empty report proves nothing.
assert.ok(usesNamespace("const db = admin.firestore();"), "detector misses admin.firestore()");
assert.ok(usesNamespace("x = admin.firestore.FieldValue.serverTimestamp()"), "detector misses FieldValue static");
assert.ok(usesNamespace("await admin.auth().getUser(uid)"), "detector misses admin.auth()");
assert.ok(!usesNamespace("// defaults to admin.firestore()\nconst db = getFirestore();"), "detector reads comments");
assert.ok(!usesNamespace("admin.initializeApp();"), "initializeApp survives v14 and must not be flagged");
assert.ok(testDrivesRealNamespace('const admin = require("firebase-admin");\nconst db = admin.firestore();'),
    "test detector misses a real-SDK namespace call");
assert.ok(!testDrivesRealNamespace('const admin = require("firebase-admin");\nModule._load = () => {};\nadmin.firestore();'),
    "test detector flags a test that fakes the SDK through Module._load");
assert.ok(!testDrivesRealNamespace('const admin = require("firebase-admin");\nObject.defineProperty(admin, "firestore", {value: () => db});\nadmin.firestore();'),
    "test detector flags a test that patches the admin object");

assert.ok(scriptUsesNamespace("const db = admin.default.firestore()"), "script detector misses admin.default.firestore()");
assert.ok(scriptUsesNamespace("if (!admin.apps.length) admin.initializeApp()"), "script detector misses admin.apps");
assert.ok(scriptUsesNamespace("admin.initializeApp({credential: admin.credential.cert(sa)})"), "script detector misses admin.credential");
assert.ok(!scriptUsesNamespace("const db = admin.getFirestore(); if (!admin.getApps().length) admin.initializeApp()"),
    "script detector flags the modular calls adminSdk.mjs returns");

const offenders = [];
const stale = [];
const seen = new Set();
for (const file of walk(ROOT, isTest)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (testDrivesRealNamespace(readFileSync(file, "utf8"))) offenders.push(rel + "  (test file driving the REAL SDK)");
}
for (const file of walk(ROOT, isSource)) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const hit = usesNamespace(readFileSync(file, "utf8"));
  if (hit) seen.add(rel);
  if (hit && !LEGACY.has(rel)) offenders.push(rel);
  if (!hit && LEGACY.has(rel)) stale.push(rel);
}
for (const rel of LEGACY) if (!seen.has(rel) && !stale.includes(rel)) stale.push(rel);

const scriptOffenders = [];
let scriptsScanned = 0;
const isScript = (name) => /\.(?:m?js|cjs)$/.test(name);
for (const file of walk(SCRIPTS, isScript)) {
  if (file === SELF) continue;
  scriptsScanned++;
  if (scriptUsesNamespace(readFileSync(file, "utf8"))) {
    scriptOffenders.push("scripts/" + relative(SCRIPTS, file).split("\\").join("/"));
  }
}
assert.ok(scriptsScanned > 100, `expected to scan the scripts/ tree, scanned ${scriptsScanned} files`);

if (offenders.length) {
  console.error("New firebase-admin namespace usage (removed in v14) — use the modular import instead:");
  for (const f of offenders) console.error("  functions/" + f);
}
if (stale.length) {
  console.error("Migrated (or deleted) but still listed in LEGACY — delete these lines from scripts/test-firebase-admin-modular.mjs:");
  for (const f of stale) console.error("  functions/" + f);
}
if (scriptOffenders.length) {
  console.error("firebase-admin namespace usage in scripts/ (removed in v14) — load the SDK with scripts/lib/adminSdk.mjs:");
  for (const f of scriptOffenders) console.error("  " + f);
}
if (offenders.length || stale.length || scriptOffenders.length) process.exit(1);

console.log(`test:firebase-admin-modular OK — ${LEGACY.size} file(s) on the namespace API (must be 0 on firebase-admin 14); ${scriptsScanned} scripts/ files clean.`);
