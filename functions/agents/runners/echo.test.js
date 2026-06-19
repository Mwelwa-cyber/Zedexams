/**
 * Unit tests for Echo's support-triage logic.
 *
 * Plain Node assertions, no test runner (repo convention). Firestore and the
 * reply drafter are injected with fakes, so this never touches Firebase, the
 * network, or an LLM.
 *
 *   node functions/agents/runners/echo.test.js
 */

const assert = require("node:assert");
const {runEchoTriage, classifyItem, inferContactKind, templateReply} = require("./echo");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = 1_700_000_000_000;

// A Firestore-ish handle: chainable orderBy/limit/get on each collection, plus
// doc().set() that records the write AND reflects it back into the in-memory
// doc (so a second sweep sees echoProcessedAt and skips it).
function fakeDb({feedback = [], contactMessages = []}) {
  const writes = [];
  function coll(name, docs) {
    return {
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        return {forEach(cb) {
          docs.forEach((d) => cb({id: d.id, data: () => d.data}));
        }};
      },
      doc(id) {
        return {async set(obj) {
          writes.push({collection: name, id, obj});
          const target = docs.find((x) => x.id === id);
          if (target) Object.assign(target.data, obj);
        }};
      },
    };
  }
  return {
    writes,
    feedback,
    contactMessages,
    collection(name) {
      return name === "feedback" ? coll("feedback", feedback) : coll("contactMessages", contactMessages);
    },
  };
}

async function run() {
  // ── classification ─────────────────────────────────────────────────
  await test("classifyItem trusts feedback type and flags bugs high", async () => {
    assert.deepStrictEqual(
        classifyItem({collection: "feedback", data: {type: "bug", message: "x"}}),
        {kind: "bug", priority: "high"},
    );
    assert.deepStrictEqual(
        classifyItem({collection: "feedback", data: {type: "suggestion", message: "nice app"}}),
        {kind: "suggestion", priority: "normal"},
    );
  });

  await test("urgent wording escalates even a normal category", async () => {
    const r = classifyItem({collection: "feedback", data: {type: "suggestion", message: "I want a refund, this is a scam"}});
    assert.strictEqual(r.priority, "high");
  });

  await test("inferContactKind reads free-text contact messages", async () => {
    assert.strictEqual(inferContactKind("The quiz is broken and won't load"), "bug");
    assert.strictEqual(inferContactKind("How much does a subscription cost?"), "billing");
    assert.strictEqual(inferContactKind("Could you please add Grade 10 Biology?"), "feature");
    assert.strictEqual(inferContactKind("We're a school interested in a demo"), "sales");
    assert.strictEqual(inferContactKind("Hello, great work"), "general");
  });

  await test("templateReply is a usable, signed acknowledgement", async () => {
    const reply = templateReply({kind: "bug", item: {data: {name: "Mary Banda"}}});
    assert.ok(reply.includes("Hi Mary,"));
    assert.ok(reply.includes("The ZedExams Team"));
  });

  // ── the sweep ───────────────────────────────────────────────────────
  await test("triages new feedback + surfaces invisible contact messages, idempotently", async () => {
    const db = fakeDb({
      feedback: [
        {id: "f_bug", data: {type: "bug", status: "new", name: "Mary", message: "save button does nothing"}},
        {id: "f_idea", data: {type: "suggestion", status: "new", message: "add dark mode"}},
        {id: "f_done", data: {type: "bug", status: "done", message: "old, already handled"}}, // not 'new' → skip
        {id: "f_seen", data: {type: "content", status: "new", message: "already triaged", echoProcessedAt: new Date(NOW - 1000)}}, // skip
      ],
      contactMessages: [
        {id: "c_refund", data: {name: "John", email: "j@x.com", message: "I paid but got no access, I want a refund"}},
        {id: "c_seen", data: {name: "Old", message: "already triaged", echoProcessedAt: new Date(NOW - 1000)}}, // skip
      ],
    });

    const drafted = [];
    const draftReply = async ({kind, item}) => {
      drafted.push(item.id);
      return `DRAFT(${kind})`;
    };

    const s = await runEchoTriage({db, draftReply, now: NOW});

    assert.strictEqual(s.processed, 3, "f_bug, f_idea, c_refund — the rest are skipped");
    assert.strictEqual(s.surfacedContact, 1, "the contact-form message was triaged");
    assert.strictEqual(s.byPriority.high, 2, "the bug and the refund are high");
    assert.strictEqual(s.byPriority.normal, 1);
    assert.strictEqual(s.highPriority.length, 2);
    assert.ok(s.highPriority.some((h) => h.id === "c_refund" && h.who === "John"));
    assert.strictEqual(s.errors.length, 0);

    // Exactly the 3 fresh items were drafted + written; the 3 skipped were not.
    assert.deepStrictEqual(drafted.sort(), ["c_refund", "f_bug", "f_idea"]);
    assert.deepStrictEqual(db.writes.map((w) => w.id).sort(), ["c_refund", "f_bug", "f_idea"]);
    for (const w of db.writes) {
      assert.ok(w.obj.echoProcessedAt instanceof Date);
      assert.ok(typeof w.obj.echoDraftReply === "string" && w.obj.echoDraftReply.length > 0);
    }

    // Idempotency: a second sweep now finds nothing new.
    const s2 = await runEchoTriage({db, draftReply, now: NOW + 10_000});
    assert.strictEqual(s2.processed, 0, "re-running triages nothing — echoProcessedAt guards it");
  });

  // ── drafter failure degrades, never aborts ──────────────────────────
  await test("a drafter error falls back to the template and still processes the item", async () => {
    const db = fakeDb({
      feedback: [{id: "f1", data: {type: "bug", status: "new", name: "Sam", message: "broken"}}],
    });
    const draftReply = async () => {
      throw new Error("model timeout");
    };
    const s = await runEchoTriage({db, draftReply, now: NOW});
    assert.strictEqual(s.processed, 1);
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].stage, "draft");
    assert.ok(db.writes[0].obj.echoDraftReply.includes("The ZedExams Team"), "fell back to the template");
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
