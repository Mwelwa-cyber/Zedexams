/**
 * A refused export must leave nothing behind.
 *
 * The readiness rules are tested next door. THIS is about where the refusal
 * happens: a gate that runs after the lease is taken, the document rendered or
 * the object uploaded is not a gate, it is a cleanup problem — and the one
 * artefact that outlives a bad request is a cached export the next request
 * serves without ever reaching the gate again.
 *
 * So the callables are loaded with every collaborator stubbed and every
 * side effect recorded, then driven with a paper that must be refused. The
 * assertion is the empty recording.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/* ── record every side effect the callable could have ──────────────────── */

const effects = {
  firestoreWrites: [], storageWrites: [], renders: [], signedUrls: [], leases: [],
};

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const handlers = {};

function docStub(pathParts) {
  return {
    async get() {
      return {exists: false, data: () => ({})};
    },
    async set(data) {
      effects.firestoreWrites.push({path: pathParts.join("/"), data});
    },
    async update(data) {
      effects.firestoreWrites.push({path: pathParts.join("/"), data});
    },
    collection: (name) => collectionStub([...pathParts, name]),
  };
}

function collectionStub(pathParts) {
  const api = {
    doc: (id) => docStub([...pathParts, id || "auto"]),
    orderBy: () => api,
    where: () => api,
    async get() {
      return {docs: [], exists: false, empty: true};
    },
  };
  return api;
}

/** A paper that must be refused: one question, and it is blank. */
const ASSESSMENT = {id: "a1", title: "Topic Test", subject: "Geography", grade: "7", createdBy: "t1"};
const QUESTIONS = [{_id: "q1", order: 0, type: "short_answer", text: "<p><br></p>", marks: 2}];

const STUBS = {
  "firebase-functions/v2/https": {
    onCall: (_opts, handler) => {
      handlers.push_ = handler;
      return handler;
    },
    onRequest: (_opts, handler) => handler,
    HttpsError: FakeHttpsError,
  },
  "firebase-functions/v2/firestore": {onDocumentDeleted: () => () => {}},
  "firebase-admin": {
    firestore: () => ({
      collection: (name) => {
        if (name === "assessments") {
          return {
            doc: () => ({
              async get() {
                return {exists: true, id: ASSESSMENT.id, data: () => ASSESSMENT};
              },
              collection: () => ({
                orderBy: () => ({
                  async get() {
                    return {docs: QUESTIONS.map((q) => ({id: q._id, data: () => q}))};
                  },
                }),
              }),
            }),
          };
        }
        return collectionStub([name]);
      },
    }),
    storage: () => ({
      bucket: () => ({
        file: (name) => ({
          async save(...args) {
            effects.storageWrites.push({name, args});
          },
          async exists() {
            return [false];
          },
          async getSignedUrl() {
            effects.signedUrls.push(name);
            return ["https://example.invalid/signed"];
          },
        }),
      }),
    }),
  },
};

/* ── load exportService with those stubs in place ──────────────────────── */

const HERE = __dirname;
const realResolve = Module._resolveFilename;
const realLoad = Module._load;

Module._load = function loadWithStubs(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (parent && parent.filename && parent.filename.startsWith(HERE)) {
    if (request === "../authGuard") return {assertVerifiedAuth: async () => "t1", assertDecodedVerified: async () => ({uid: "t1"})};
    if (request === "../aiService") return {getUserRole: async () => "teacher"};
    if (request === "./renderModel") {
      return {buildServerPaperModel: (...args) => {
        effects.renders.push(args);
        return {imageRefs: [], blocks: []};
      }};
    }
    if (request === "./renderDocx") {
      return {buildAssessmentDocxBuffer: async () => {
        effects.renders.push("docx");
        return Buffer.from("x");
      }};
    }
    if (request === "./renderPdf") {
      return {buildAssessmentPdfBuffer: async () => {
        effects.renders.push("pdf");
        return Buffer.from("x");
      }};
    }
  }
  return realLoad.call(this, request, parent, isMain);
};

// Capture each onCall handler by the order they are registered in the module.
const registered = [];
STUBS["firebase-functions/v2/https"].onCall = (_opts, handler) => {
  registered.push(handler);
  return handler;
};

const serviceModule = require(path.join(HERE, "exportService.js"));

Module._load = realLoad;
Module._resolveFilename = realResolve;

/* ── the tests ─────────────────────────────────────────────────────────── */

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

const reset = () => {
  for (const key of Object.keys(effects)) effects[key].length = 0;
};

const request = (exportType = "paper-docx") => ({
  auth: {uid: "t1"},
  data: {
    assessmentId: "a1",
    exportType,
    // Everything a bypass would try. None of it is read.
    ready: true,
    allowUnresolvedFigures: true,
    readiness: {blocked: false, reason: "ready"},
  },
});

test("the module registers the callables under test", () => {
  assert.ok(registered.length >= 3, `expected the three onCall handlers, got ${registered.length}`);
  assert.ok(typeof serviceModule.requestAssessmentExport === "function"
    || typeof serviceModule.requestAssessmentExport === "object");
});

async function expectRefused(handler, what) {
  reset();
  let thrown = null;
  try {
    await handler(request());
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, `${what} must refuse an unfinished paper`);
  assert.equal(thrown.code, "failed-precondition", `${what} uses failed-precondition`);
  assert.equal(thrown.details?.code, "ASSESSMENT_EXPORT_BLOCKED");
  assert.equal(thrown.details?.reason, "incomplete-questions");
  assert.deepEqual(thrown.details?.questionNumbers, [1]);
  // The teacher-facing half: the same sentence the studio shows.
  assert.match(thrown.message, /^Question 1 is not finished yet/, thrown.message);
  return thrown;
}

function expectNothingHappened(what) {
  assert.deepEqual(effects.renders, [], `${what}: nothing was rendered`);
  assert.deepEqual(effects.storageWrites, [], `${what}: no Storage object was written`);
  assert.deepEqual(effects.signedUrls, [], `${what}: no signed URL was minted`);
  assert.deepEqual(effects.firestoreWrites, [],
    `${what}: no lease, no export state, no ticket, no success record — got `
    + JSON.stringify(effects.firestoreWrites));
}

test("requestAssessmentExport refuses, and creates nothing", async () => {
  await expectRefused(registered[0], "requestAssessmentExport");
  expectNothingHappened("requestAssessmentExport");
});

test("getAssessmentExportStatus refuses, and mints no ticket for a cached file", async () => {
  // It generates nothing, so the artefact it could leak is a TICKET for an
  // export written before this gate existed.
  await expectRefused(registered[1], "getAssessmentExportStatus");
  expectNothingHappened("getAssessmentExportStatus");
});

test("prewarmAssessmentExports declines quietly, and creates nothing", async () => {
  reset();
  const result = await registered[2](request());
  assert.equal(result.ok, true, "prewarm does not throw — a half-written paper is its normal case");
  assert.equal(result.blocked, "incomplete-questions", "but it says why it warmed nothing");
  assert.deepEqual(result.warmed, []);
  expectNothingHappened("prewarmAssessmentExports");
});

(async () => {
  for (const [name, fn] of pending) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  ✗   ${name}\n      ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log(`\n✓ blocked exports leave nothing behind — ${passed} tests passed`);
})();
