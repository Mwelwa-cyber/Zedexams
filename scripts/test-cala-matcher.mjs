#!/usr/bin/env node
/**
 * Cala — CBC Alignment Officer: matcher unit tests.
 *
 * Exercises the deterministic substring/token-overlap matcher without
 * Firebase. Stubs `firebase-admin` and points the runner at a known
 * seed topic, then asserts that:
 *
 *   - A draft that quotes the outcome wording yields non-empty
 *     citations and aligned=true.
 *   - A paraphrased draft still yields citations (token-overlap
 *     fallback).
 *   - A draft that says nothing about the outcomes yields gaps and
 *     aligned=false.
 *   - A draft citing a dotted code not present in the KB shows up in
 *     drift.
 *   - When the KB has no matching topic, gaps name that explicitly and
 *     citations stays empty.
 *
 * This is the regression net that catches anyone re-introducing the
 * "regex over JSON.stringify(kbMatch)" bug.
 *
 * Run: npm run test:cala-matcher  (also via npm run test:all)
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CALA = join(ROOT, "functions/agents/runners/cala.js");

// Stub firebase-admin so cbcKnowledge.js + privateCurriculum.js load in
// plain Node and fall back to the in-code seed. Every query / doc method
// resolves to "empty" so resolveCbcContext goes straight to step 3
// (editable topic KB → seed) without hitting Firestore.
function fakeQuery() {
  const empty = { docs: [], size: 0, empty: true };
  const q = {
    where: () => q,
    orderBy: () => q,
    limit: () => q,
    startAfter: () => q,
    get: async () => empty,
  };
  return q;
}
function fakeDoc() {
  return {
    get: async () => ({ exists: false, data: () => ({}) }),
    collection: () => fakeCollection(),
  };
}
function fakeCollection() {
  const q = fakeQuery();
  return Object.assign(q, {
    doc: () => fakeDoc(),
  });
}
const fakeAdmin = {
  firestore: () => ({
    doc: () => fakeDoc(),
    collection: () => fakeCollection(),
  }),
};
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "__ts__" };
// Silence the diagnostic "fetchCandidateChunks failed" logs the private-RAG
// path emits when Firestore is stubbed — they're expected and not the
// behaviour under test here.
const origError = console.error;
console.error = (...args) => {
  const first = args[0];
  if (typeof first === "string" && /fetchCandidateChunks failed/.test(first)) {
    return;
  }
  origError(...args);
};

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "firebase-admin") return fakeAdmin;
  return origLoad.call(this, request, parent, ...rest);
};

const { runCala, _internals } = require(CALA);
Module._load = origLoad;

let pass = 0;
let fail = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      fail++;
      failures.push({ name, message: err.message });
      console.log(`  FAIL ${name}\n       ${err.message}`);
    });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// G1 mathematics — "Numbers to 20" — picked because outcomes are short and
// distinctive (low risk of accidental token-overlap matches).
const KNOWN_INPUT = {
  grade: "G1",
  subject: "mathematics",
  topic: "Numbers to 20",
  term: 1,
};
const KNOWN_OUTCOMES = [
  "Count forwards and backwards from 1 to 20",
  "Write numerals 1-20 correctly",
  "Compare two numbers using 'more than' and 'less than'",
];

console.log("\nCala matcher — production runner");

await test("verbatim outcome wording produces a citation", async () => {
  const draft = {
    title: "Lesson plan",
    activities: [
      "Pupils count forwards and backwards from 1 to 20 in unison.",
      "Pupils write numerals 1-20 correctly in their books.",
    ],
  };
  const out = await runCala({ job: { input: KNOWN_INPUT, output: { aria: { draft } } } });
  assert(Array.isArray(out.citations), "citations must be an array");
  assert(out.citations.length >= 2,
    `expected >=2 citations, got ${out.citations.length}: ${JSON.stringify(out.citations)}`);
  for (const c of out.citations) {
    assert(typeof c.outcome === "string" && c.outcome.includes(":o"),
      `citation outcome id should be <topic>:o<n>, got ${c.outcome}`);
    assert(typeof c.text === "string" && c.text.length > 0,
      "citation text must be a non-empty string");
  }
});

await test("paraphrased outcome still matches via token overlap", async () => {
  const draft = {
    activities: [
      "The teacher asks pupils to count backwards from 20 to 1 in groups, and then forwards again.",
    ],
  };
  const out = await runCala({ job: { input: KNOWN_INPUT, output: { aria: { draft } } } });
  const matched = out.citations.find((c) => /count/i.test(c.text));
  assert(matched, `expected a citation for the counting outcome, got ${JSON.stringify(out.citations)}`);
});

await test("draft with no outcome coverage yields gaps + aligned=false", async () => {
  const draft = {
    activities: ["Today we will sing a song about the weather."],
  };
  const out = await runCala({ job: { input: KNOWN_INPUT, output: { aria: { draft } } } });
  assert(out.aligned === false, `expected aligned=false, got ${out.aligned}`);
  assert(out.citations.length === 0,
    `expected 0 citations, got ${out.citations.length}`);
  assert(out.gaps.length === KNOWN_OUTCOMES.length,
    `expected ${KNOWN_OUTCOMES.length} gaps, got ${out.gaps.length}`);
  for (const g of out.gaps) {
    assert(typeof g.outcome === "string" && g.outcome.includes(":o"),
      `gap should carry an outcome id, got ${JSON.stringify(g)}`);
  }
});

await test("dotted code not in KB shows up in drift", async () => {
  const draft = {
    activities: [
      "Pupils count forwards and backwards from 1 to 20.",
      "Aligned to MAT.99.9.9 (a fabricated code).",
    ],
  };
  const out = await runCala({ job: { input: KNOWN_INPUT, output: { aria: { draft } } } });
  assert(out.drift.some((d) => d.outcome === "MAT.99.9.9"),
    `expected MAT.99.9.9 in drift, got ${JSON.stringify(out.drift)}`);
});

await test("unknown topic yields a 'topic not found' gap", async () => {
  const draft = {
    activities: ["Anything goes."],
  };
  const out = await runCala({
    job: {
      input: {
        grade: "G1",
        subject: "mathematics",
        topic: "A topic that definitely is not in the seed KB",
      },
      output: { aria: { draft } },
    },
  });
  assert(out.aligned === false, `expected aligned=false on unknown topic`);
  assert(
    out.gaps.some((g) => /not found/i.test(String(g.note || ""))),
    `expected a 'topic not found' gap, got ${JSON.stringify(out.gaps)}`
  );
  assert(out.citations.length === 0, "no citations for unknown topic");
});

console.log("\nCala matcher — internals");

await test("normalise lowercases and strips punctuation", () => {
  const n = _internals.normalise("Count, forwards & backwards! (1-20).");
  assert(n === "count forwards backwards 1 20",
    `unexpected normalisation: ${JSON.stringify(n)}`);
});

await test("buildOutcomeId uses kbMatch.id + 1-indexed n", () => {
  const id = _internals.buildOutcomeId({ id: "g1-math-numbers-20" }, 2);
  assert(id === "g1-math-numbers-20:o3", `got ${id}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.error("Failures:");
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
