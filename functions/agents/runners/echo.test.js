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

// A small in-memory Firestore-ish handle that honours the query shape Echo now
// relies on: orderBy("createdAt", asc|desc) + where("createdAt", ">", cursor) +
// limit, plus doc().get()/.set(merge). Writes reflect back into the in-memory
// docs (so a second sweep sees echoProcessedAt / the advanced cursor). The
// agentControl collection is backed the same way, so the cursor round-trips.
function fakeDb({feedback = [], contactMessages = [], agentControl = []}) {
  const store = {feedback, contactMessages, agentControl};
  const writes = [];

  function coll(name) {
    const docs = store[name] || (store[name] = []);

    function query(filters, order, lim) {
      return {
        orderBy(field, dir = "asc") {
          return query(filters, {field, dir}, lim);
        },
        where(field, op, value) {
          return query([...filters, {field, op, value}], order, lim);
        },
        limit(n) {
          return query(filters, order, n);
        },
        async get() {
          let rows = docs.slice();
          for (const f of filters) {
            rows = rows.filter((d) => {
              const v = d.data[f.field];
              if (f.op === ">") return v !== undefined && v !== null && v > f.value;
              return true;
            });
          }
          if (order) {
            rows.sort((a, b) => {
              const av = a.data[order.field] ?? 0;
              const bv = b.data[order.field] ?? 0;
              return order.dir === "desc" ? bv - av : av - bv;
            });
          }
          if (typeof lim === "number") rows = rows.slice(0, lim);
          return {forEach(cb) {
            rows.forEach((d) => cb({id: d.id, data: () => d.data}));
          }};
        },
      };
    }

    const q = query([], null, undefined);
    q.doc = (id) => ({
      async get() {
        const target = docs.find((x) => x.id === id);
        return {exists: !!target, data: () => (target ? target.data : undefined)};
      },
      async set(obj, opts) {
        writes.push({collection: name, id, obj});
        let target = docs.find((x) => x.id === id);
        if (!target) {
          target = {id, data: {}};
          docs.push(target);
        }
        if (opts && opts.merge) {
          for (const [k, v] of Object.entries(obj)) {
            // Deep-merge nested maps (mirrors Firestore {merge:true}).
            if (v && typeof v === "object" && !(v instanceof Date) &&
                target.data[k] && typeof target.data[k] === "object") {
              target.data[k] = {...target.data[k], ...v};
            } else {
              target.data[k] = v;
            }
          }
        } else {
          target.data = {...obj};
        }
      },
    });
    return q;
  }

  return {
    writes,
    get feedback() {
      return store.feedback;
    },
    get contactMessages() {
      return store.contactMessages;
    },
    collection: coll,
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
        {id: "f_bug", data: {type: "bug", status: "new", name: "Mary", message: "save button does nothing", createdAt: NOW - 5000}},
        {id: "f_idea", data: {type: "suggestion", status: "new", message: "add dark mode", createdAt: NOW - 4000}},
        {id: "f_done", data: {type: "bug", status: "done", message: "old, already handled", createdAt: NOW - 3000}}, // not 'new' → skip
        {id: "f_seen", data: {type: "content", status: "new", message: "already triaged", createdAt: NOW - 2000, echoProcessedAt: new Date(NOW - 1000)}}, // skip
      ],
      contactMessages: [
        {id: "c_refund", data: {name: "John", email: "j@x.com", message: "I paid but got no access, I want a refund", createdAt: NOW - 5000}},
        {id: "c_seen", data: {name: "Old", message: "already triaged", createdAt: NOW - 2000, echoProcessedAt: new Date(NOW - 1000)}}, // skip
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
    // (Ignore the agentControl/echo cursor write — it isn't a triage write.)
    const triageWrites = db.writes.filter((w) => w.collection !== "agentControl");
    assert.deepStrictEqual(drafted.sort(), ["c_refund", "f_bug", "f_idea"]);
    assert.deepStrictEqual(triageWrites.map((w) => w.id).sort(), ["c_refund", "f_bug", "f_idea"]);
    for (const w of triageWrites) {
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
      feedback: [{id: "f1", data: {type: "bug", status: "new", name: "Sam", message: "broken", createdAt: NOW - 1000}}],
    });
    const draftReply = async () => {
      throw new Error("model timeout");
    };
    const s = await runEchoTriage({db, draftReply, now: NOW});
    assert.strictEqual(s.processed, 1);
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].stage, "draft");
    const triageWrites = db.writes.filter((w) => w.collection !== "agentControl");
    assert.ok(triageWrites[0].obj.echoDraftReply.includes("The ZedExams Team"), "fell back to the template");
  });

  // ── regression: a backlog larger than maxItems must drain (issue #1156) ──
  await test("drains a backlog bigger than maxItems oldest-first, no starvation", async () => {
    // 25 unprocessed contact messages, createdAt 1..25 (oldest = 1). With the
    // old limit-then-filter (orderBy desc .limit(maxItems)), a maxItems of 10
    // would only ever fetch the newest 10 and the oldest 15 would starve.
    const TOTAL = 25;
    const MAXI = 10;
    const contactMessages = [];
    for (let i = 1; i <= TOTAL; i++) {
      contactMessages.push({id: `c${String(i).padStart(2, "0")}`, data: {name: `U${i}`, message: `message ${i}`, createdAt: i}});
    }
    const db = fakeDb({contactMessages});
    const draftReply = async ({kind}) => `DRAFT(${kind})`;

    // First sweep: bounded to maxItems.
    const s1 = await runEchoTriage({db, draftReply, now: NOW, maxItems: MAXI});
    assert.strictEqual(s1.processed, MAXI, "first run honours the per-run bound");

    // Keep sweeping until the backlog is drained. Forward progress must be
    // guaranteed, so this terminates well within a small bound.
    let runs = 1;
    let total = s1.processed;
    while (total < TOTAL && runs < 20) {
      const s = await runEchoTriage({db, draftReply, now: NOW + runs * 1000, maxItems: MAXI});
      total += s.processed;
      runs += 1;
    }

    // Every item — including the OLDEST (c01..) — eventually got triaged.
    const processedIds = db.writes
        .filter((w) => w.collection === "contactMessages")
        .map((w) => w.id);
    const unique = new Set(processedIds);
    assert.strictEqual(unique.size, TOTAL, "every backlog item was processed exactly once");
    assert.ok(unique.has("c01"), "the OLDEST item was processed (would starve under limit-then-filter)");
    assert.ok(unique.has("c25"), "the newest item was processed too");

    // A final sweep with nothing new left does no work.
    const sEnd = await runEchoTriage({db, draftReply, now: NOW + 99_000, maxItems: MAXI});
    assert.strictEqual(sEnd.processed, 0, "fully drained → a further sweep triages nothing");
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
