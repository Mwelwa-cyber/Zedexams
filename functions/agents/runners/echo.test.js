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

// Millis from any Firestore-ish timestamp (Date / millis-number / Timestamp).
function ms(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v.getTime === "function") return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  return null;
}

// A query-realistic Firestore fake: honours where('createdAt','>=',cursor),
// orderBy('createdAt', dir) and limit(n) so the cursor-drain behaviour is
// actually exercised (docs missing the orderBy field are excluded, matching
// Firestore). doc().get()/set() read/reflect the in-memory store, and set()
// merges so a later sweep sees echoProcessedAt / advanced cursors.
function fakeDb({feedback = [], contactMessages = [], echoState = []} = {}) {
  const writes = [];
  const store = {feedback, contactMessages, echoState};

  function query(docs) {
    const filters = [];
    let order = null;
    let lim = Infinity;
    return {
      where(field, op, value) {
        filters.push({field, op, value});
        return this;
      },
      orderBy(field, dir = "asc") {
        order = {field, dir};
        return this;
      },
      limit(n) {
        lim = n;
        return this;
      },
      async get() {
        let rows = docs.filter((d) => filters.every((f) => {
          const a = ms(d.data[f.field]);
          const b = ms(f.value);
          if (a == null) return false; // missing field never matches a range
          if (f.op === ">=") return a >= b;
          if (f.op === ">") return a > b;
          return d.data[f.field] === f.value;
        }));
        if (order) {
          rows = rows
              .filter((d) => d.data[order.field] != null) // Firestore drops docs missing the orderBy field
              .sort((x, y) => ms(x.data[order.field]) - ms(y.data[order.field]));
          if (order.dir === "desc") rows.reverse();
        }
        rows = rows.slice(0, lim);
        return {forEach(cb) {
          rows.forEach((d) => cb({id: d.id, data: () => d.data}));
        }};
      },
    };
  }

  function coll(name) {
    const docs = store[name] || (store[name] = []);
    const api = query(docs);
    api.doc = (id) => ({
      async get() {
        const t = docs.find((x) => x.id === id);
        return {exists: !!t, data: () => (t ? t.data : undefined)};
      },
      async set(obj, opts) {
        writes.push({collection: name, id, obj});
        let t = docs.find((x) => x.id === id);
        if (!t) {
          t = {id, data: {}};
          docs.push(t);
        }
        if (opts && opts.merge) Object.assign(t.data, obj);
        else t.data = {...obj};
      },
    });
    return api;
  }

  return {
    writes,
    store,
    get feedback() {
      return store.feedback;
    },
    get contactMessages() {
      return store.contactMessages;
    },
    collection(name) {
      return coll(name);
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
        {id: "f_bug", data: {type: "bug", status: "new", name: "Mary", message: "save button does nothing", createdAt: new Date(NOW - 5000)}},
        {id: "f_idea", data: {type: "suggestion", status: "new", message: "add dark mode", createdAt: new Date(NOW - 4000)}},
        {id: "f_done", data: {type: "bug", status: "done", message: "old, already handled", createdAt: new Date(NOW - 3000)}}, // not 'new' → skip
        {id: "f_seen", data: {type: "content", status: "new", message: "already triaged", echoProcessedAt: new Date(NOW - 1000), createdAt: new Date(NOW - 2000)}}, // skip
      ],
      contactMessages: [
        {id: "c_refund", data: {name: "John", email: "j@x.com", message: "I paid but got no access, I want a refund", createdAt: new Date(NOW - 5000)}},
        {id: "c_seen", data: {name: "Old", message: "already triaged", echoProcessedAt: new Date(NOW - 1000), createdAt: new Date(NOW - 2000)}}, // skip
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
    // (Writes to echoState are the drain cursor, not item triage — filter them.)
    const itemWrites = db.writes.filter((w) => w.collection !== "echoState");
    assert.deepStrictEqual(drafted.sort(), ["c_refund", "f_bug", "f_idea"]);
    assert.deepStrictEqual(itemWrites.map((w) => w.id).sort(), ["c_refund", "f_bug", "f_idea"]);
    for (const w of itemWrites) {
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
      feedback: [{id: "f1", data: {type: "bug", status: "new", name: "Sam", message: "broken", createdAt: new Date(NOW - 1000)}}],
    });
    const draftReply = async () => {
      throw new Error("model timeout");
    };
    const s = await runEchoTriage({db, draftReply, now: NOW});
    assert.strictEqual(s.processed, 1);
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].stage, "draft");
    const f1Write = db.writes.find((w) => w.collection === "feedback" && w.id === "f1");
    assert.ok(f1Write.obj.echoDraftReply.includes("The ZedExams Team"), "fell back to the template");
  });

  // ── starvation regression (the bug in #1156) ────────────────────────
  // A backlog LARGER than maxItems must be fully drained over repeated runs.
  // The old limit-then-filter took the NEWEST maxItems then filtered to the
  // unprocessed ones, so once those were handled the oldest items below the
  // window were never fetched again — starved forever. Oldest-first draining
  // guarantees forward progress.
  await test("drains a backlog larger than maxItems — oldest items are eventually processed", async () => {
    const BACKLOG = 12;
    const MAX = 4; // small window so the backlog spans several runs
    // c0 is the OLDEST (createdAt NOW-12000), c11 the newest. Pre-existing,
    // none processed — exactly the contactMessages-with-no-UI scenario.
    const contactMessages = [];
    for (let i = 0; i < BACKLOG; i++) {
      contactMessages.push({
        id: `c${i}`,
        data: {name: `User${i}`, message: `message ${i}`, createdAt: new Date(NOW - (BACKLOG - i) * 1000)},
      });
    }
    const db = fakeDb({contactMessages});
    const draftReply = async ({kind}) => `DRAFT(${kind})`;

    // Drive the scheduled sweep repeatedly (as the every-2-hours cron would).
    let totalProcessed = 0;
    for (let run = 0; run < 10; run++) {
      const s = await runEchoTriage({db, draftReply, now: NOW + run * 60_000, maxItems: MAX});
      totalProcessed += s.processed;
      if (totalProcessed >= BACKLOG) break;
    }

    // Every item — crucially the OLDEST (c0), which the old code starved — has
    // an idempotent triage written exactly once.
    for (let i = 0; i < BACKLOG; i++) {
      const doc = db.store.contactMessages.find((d) => d.id === `c${i}`);
      assert.ok(doc.data.echoProcessedAt instanceof Date, `c${i} (the oldest is c0) must be triaged`);
    }
    assert.strictEqual(totalProcessed, BACKLOG, "each backlog item processed exactly once across the runs");

    // And it's stable: another sweep finds nothing new.
    const sFinal = await runEchoTriage({db, draftReply, now: NOW + 999_000, maxItems: MAX});
    assert.strictEqual(sFinal.processed, 0, "fully drained — re-running is a no-op");
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
