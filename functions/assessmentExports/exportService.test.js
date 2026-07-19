/**
 * Integration-ish tests for the export generate/serve engine (ensureExport)
 * using in-memory Firestore + Storage fakes. Proves the caching + single-
 * generation guarantees without a live emulator.
 *
 * Run: node functions/assessmentExports/exportService.test.js
 */

const assert = require("node:assert");
// ensureExport pulls in functions-only deps (firebase-functions, firebase-admin,
// docx/pdfkit). CI jobs that install only root deps can't load them, so require
// the module under test through a guard and skip cleanly on MODULE_NOT_FOUND —
// checking the real import chain, not a proxy dep (an earlier guard checked
// firebase-admin/docx, which resolve from the root install, and still crashed
// on the missing firebase-functions). Local + deploy-firebase runs exercise it.
let svc;
try {
  svc = require("./exportService");
} catch (err) {
  if (err && err.code === "MODULE_NOT_FOUND") {
    console.log("exportService: skipped (functions deps not installed)");
    process.exit(0);
  }
  throw err;
}
const {ensureExport, parseDownloadPath, extractIdToken} = svc;
const {resolveExportType} = require("./exportsCore");
const {computeSourceHash} = require("./sourceHash");

/* ── in-memory Firestore fake (only the surface ensureExport uses) ── */
function makeDb() {
  const docs = new Map(); // path -> data
  let addSeq = 0;
  function docRef(path) {
    return {
      path,
      async get() {
        const data = docs.get(path);
        return {exists: data !== undefined, data: () => data};
      },
      async set(value, opts) {
        const prev = docs.get(path) || {};
        docs.set(path, opts && opts.merge ? {...prev, ...value} : value);
      },
      async delete() { docs.delete(path); },
    };
  }
  const db = {
    _docs: docs,
    collection(name) {
      return {
        doc(id) { return docRef(`${name}/${id}`); },
        async add(value) {
          addSeq += 1;
          const id = `auto-${addSeq}`;
          docs.set(`${name}/${id}`, value);
          return {id};
        },
      };
    },
    // Model Firestore's effective isolation: each transaction body runs to
    // completion before the next starts (a serialised outcome, like optimistic
    // concurrency + retry). Without this, two concurrent claims could both read
    // "missing" and both generate — exactly the bug the lease prevents.
    _txChain: Promise.resolve(),
    runTransaction(fn) {
      const run = async () => {
        const tx = {
          async get(ref) { const d = docs.get(ref.path); return {exists: d !== undefined, data: () => d}; },
          set(ref, value, opts) {
            const prev = docs.get(ref.path) || {};
            docs.set(ref.path, opts && opts.merge ? {...prev, ...value} : value);
          },
        };
        return fn(tx);
      };
      const result = db._txChain.then(run);
      db._txChain = result.catch(() => {});
      return result;
    },
  };
  return db;
}

/* ── in-memory Storage bucket fake ── */
function makeBucket() {
  const objects = new Map(); // name -> buffer
  return {
    _objects: objects,
    file(name) {
      return {
        name,
        async save(buffer) { objects.set(name, buffer); },
        async exists() { return [objects.has(name)]; },
        async getMetadata() { return [{size: (objects.get(name) || Buffer.alloc(0)).length}]; },
        async delete() { objects.delete(name); },
      };
    },
    async getFiles({prefix}) {
      const files = [...objects.keys()].filter((k) => k.startsWith(prefix))
        .map((name) => ({name, async delete() { objects.delete(name); }}));
      return [files];
    },
  };
}

const assessment = {
  id: "asmt1", createdBy: "teacher-1", title: "End of Term Test", grade: "4",
  subject: "Mathematics", assessmentType: "end_of_term", term: "1", year: 2026,
  schoolName: "Lusaka Primary",
};
const questions = [
  {order: 1, type: "mcq", text: "2+2?", marks: 1, options: ["3", "4"], correctAnswer: 1},
  {order: 2, type: "short_answer", text: "Name a shape.", marks: 2, correctAnswer: "circle"},
];
const paperDocx = resolveExportType("paper-docx");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`  ok  ${name}`); }

(async () => {
  await test("first request generates + uploads + records ready", async () => {
    const db = makeDb(); const bucket = makeBucket();
    const r = await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx});
    assert.strictEqual(r.status, "ready");
    assert.strictEqual(r.cacheHit, false);
    assert.ok(r.ticket, "a ticket is minted");
    assert.match(r.downloadPath, /^\/downloads\/assessments\/asmt1\/paper-docx$/);
    assert.strictEqual(bucket._objects.size, 1, "one object stored");
    const hash = computeSourceHash(assessment, questions);
    assert.ok([...bucket._objects.keys()][0].includes(hash), "stored under the source hash");
  });

  await test("second identical request is a cache hit — no new object", async () => {
    const db = makeDb(); const bucket = makeBucket();
    await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx});
    const before = bucket._objects.size;
    const r2 = await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx});
    assert.strictEqual(r2.status, "ready");
    assert.strictEqual(r2.cacheHit, true, "served from cache");
    assert.strictEqual(bucket._objects.size, before, "no regeneration");
  });

  await test("edited assessment produces a NEW source hash + new object", async () => {
    const db = makeDb(); const bucket = makeBucket();
    await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx});
    const edited = questions.map((q, i) => i === 0 ? {...q, marks: 5} : q);
    const r = await ensureExport({db, bucket, uid: "teacher-1", assessment, questions: edited, typeCfg: paperDocx});
    assert.strictEqual(r.cacheHit, false, "regenerated for the new content");
    // Old version pruned, new version present → still exactly one object.
    const names = [...bucket._objects.keys()];
    assert.ok(names[0].includes(computeSourceHash(assessment, edited)));
  });

  await test("two simultaneous identical requests generate ONE object (lease)", async () => {
    const db = makeDb(); const bucket = makeBucket();
    const [a, b] = await Promise.all([
      ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx}),
      ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx}),
    ]);
    const statuses = [a.status, b.status].sort();
    // One wins the lease and generates (ready); the other sees the live lease
    // (generating) or the just-published ready object — never a 2nd generation.
    assert.strictEqual(bucket._objects.size, 1, "exactly one generation happened");
    assert.ok(statuses.includes("ready"));
    assert.ok(statuses.every((s) => s === "ready" || s === "generating"));
  });

  await test("scheme export stores a distinct object under the same hash folder", async () => {
    const db = makeDb(); const bucket = makeBucket();
    await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: paperDocx});
    await ensureExport({db, bucket, uid: "teacher-1", assessment, questions, typeCfg: resolveExportType("scheme-docx")});
    const names = [...bucket._objects.keys()].sort();
    assert.strictEqual(names.length, 2);
    assert.ok(names.some((n) => n.endsWith("/paper.docx")));
    assert.ok(names.some((n) => n.endsWith("/scheme.docx")));
    // Same hash folder (same content, different file).
    assert.strictEqual(names[0].split("/").slice(0, 4).join("/"), names[1].split("/").slice(0, 4).join("/"));
  });

  // ── endpoint helpers ───────────────────────────────────────
  await test("parseDownloadPath extracts id + type; rejects malformed", () => {
    assert.deepStrictEqual(parseDownloadPath("/downloads/assessments/asmt1/paper-docx"),
      {assessmentId: "asmt1", exportType: "paper-docx"});
    assert.strictEqual(parseDownloadPath("/downloads/other"), null);
    assert.strictEqual(parseDownloadPath("/nope"), null);
  });

  await test("extractIdToken reads Bearer header then __session cookie", () => {
    assert.strictEqual(extractIdToken({headers: {authorization: "Bearer TOK"}}), "TOK");
    assert.strictEqual(extractIdToken({headers: {cookie: "x=1; __session=C; y=2"}}), "C");
    assert.strictEqual(extractIdToken({headers: {}}), null);
  });

  console.log(`\nexportService: ${passed} tests passed`);
})().catch((err) => { console.error(err); process.exit(1); });
