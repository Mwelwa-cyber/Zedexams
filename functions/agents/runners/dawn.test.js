/**
 * Unit tests for Dawn's Managed-Agents bridge.
 *
 * Plain Node assertions, no test runner (repo convention). The network is
 * injected as a fake `fetchImpl`, so this never touches the Managed Agents API.
 *
 *   node functions/agents/runners/dawn.test.js
 */

const assert = require("node:assert");
const {
  startBriefingRun,
  fetchSessionStatus,
  fetchBriefing,
  parseBriefing,
  isTerminalStatus,
  DEFAULT_TASK,
  DEFAULT_RUBRIC,
} = require("./dawn");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

// A tiny fake Response with the bits cmaFetch / fetchBriefing use.
function res(status, bodyText) {
  return {ok: status >= 200 && status < 300, status, text: async () => bodyText};
}

// Records every call and replies from a routing function.
function fakeFetch(routes) {
  const calls = [];
  return {
    calls,
    impl: async (url, opts = {}) => {
      const method = opts.method || "GET";
      calls.push({url, method, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers});
      const r = routes(url, method, opts);
      if (!r) throw new Error(`unexpected ${method} ${url}`);
      return r;
    },
  };
}

async function run() {
  // ── parseBriefing (pure) ────────────────────────────────────────────
  await test("parseBriefing pulls an explicit Subject + Body", () => {
    const {subject, body} = parseBriefing("Subject: Daily brief\n\nBody:\nLine one\nLine two");
    assert.strictEqual(subject, "Daily brief");
    assert.strictEqual(body, "Line one\nLine two");
  });

  await test("parseBriefing falls back to a default subject and strips the subject line", () => {
    const {subject, body} = parseBriefing("Some heading\nmore text");
    assert.strictEqual(subject, "ZedExams Morning Briefing");
    assert.ok(body.includes("Some heading"));
  });

  await test("parseBriefing without Body: keeps the whole text minus the subject line", () => {
    const {subject, body} = parseBriefing("Subject: Hi\nthe actual content here");
    assert.strictEqual(subject, "Hi");
    assert.strictEqual(body, "the actual content here");
    assert.ok(!body.includes("Subject:"));
  });

  // ── isTerminalStatus ────────────────────────────────────────────────
  await test("isTerminalStatus recognises stopped states only", () => {
    assert.strictEqual(isTerminalStatus("idle"), true);
    assert.strictEqual(isTerminalStatus("TERMINATED"), true);
    assert.strictEqual(isTerminalStatus("running"), false);
    assert.strictEqual(isTerminalStatus(""), false);
    assert.strictEqual(isTerminalStatus(undefined), false);
  });

  // ── startBriefingRun ────────────────────────────────────────────────
  await test("startBriefingRun opens a session then defines the outcome", async () => {
    const f = fakeFetch((url, method) => {
      if (method === "POST" && url.endsWith("/sessions")) return res(200, JSON.stringify({id: "sess_123"}));
      if (method === "POST" && url.endsWith("/sessions/sess_123/events")) return res(200, "{}");
      return null;
    });
    const sid = await startBriefingRun({
      fetchImpl: f.impl, apiKey: "sk-test", agentId: "agent_1", envId: "env_1", vaultId: "vault_1",
    });
    assert.strictEqual(sid, "sess_123");
    assert.strictEqual(f.calls.length, 2);

    const open = f.calls[0];
    assert.strictEqual(open.body.agent, "agent_1");
    assert.strictEqual(open.body.environment_id, "env_1");
    assert.deepStrictEqual(open.body.vault_ids, ["vault_1"]);

    const outcome = f.calls[1];
    assert.strictEqual(outcome.body.events[0].type, "user.define_outcome");
    assert.strictEqual(outcome.body.events[0].description, DEFAULT_TASK);
    assert.strictEqual(outcome.body.events[0].rubric.content, DEFAULT_RUBRIC);
    assert.strictEqual(outcome.body.events[0].max_iterations, 3);
  });

  await test("startBriefingRun omits vault_ids when no vault is set", async () => {
    const f = fakeFetch((url, method) =>
      method === "POST" && url.endsWith("/sessions") ? res(200, JSON.stringify({id: "s"})) : res(200, "{}"));
    await startBriefingRun({fetchImpl: f.impl, apiKey: "k", agentId: "a", envId: "e"});
    assert.strictEqual("vault_ids" in f.calls[0].body, false);
  });

  await test("startBriefingRun fails fast without config", async () => {
    await assert.rejects(
        () => startBriefingRun({fetchImpl: async () => res(200, "{}"), apiKey: "k", agentId: "", envId: "e"}),
        /not configured/,
    );
    await assert.rejects(
        () => startBriefingRun({fetchImpl: async () => res(200, "{}"), apiKey: "", agentId: "a", envId: "e"}),
        /API key/,
    );
  });

  await test("startBriefingRun surfaces an API error body", async () => {
    const f = fakeFetch(() => res(401, JSON.stringify({error: {message: "invalid x-api-key"}})));
    await assert.rejects(
        () => startBriefingRun({fetchImpl: f.impl, apiKey: "bad", agentId: "a", envId: "e"}),
        /invalid x-api-key/,
    );
  });

  // ── fetchSessionStatus ──────────────────────────────────────────────
  await test("fetchSessionStatus lowercases the status", async () => {
    const f = fakeFetch(() => res(200, JSON.stringify({status: "Running"})));
    const s = await fetchSessionStatus({fetchImpl: f.impl, apiKey: "k", sessionId: "s"});
    assert.strictEqual(s, "running");
  });

  // ── fetchBriefing ───────────────────────────────────────────────────
  await test("fetchBriefing prefers email.md over briefing.md and returns its content", async () => {
    const f = fakeFetch((url, method) => {
      if (method === "GET" && url.includes("/files?scope_id=sess_9")) {
        return res(200, JSON.stringify({data: [
          {id: "file_brief", filename: "briefing.md"},
          {id: "file_email", filename: "email.md"},
        ]}));
      }
      if (method === "GET" && url.endsWith("/files/file_email/content")) {
        return res(200, "Subject: Done\n\nBody:\nthe brief");
      }
      return null;
    });
    const out = await fetchBriefing({fetchImpl: f.impl, apiKey: "k", sessionId: "sess_9"});
    assert.strictEqual(out.filename, "email.md");
    assert.ok(out.text.includes("the brief"));
  });

  await test("fetchBriefing returns null when neither file exists yet", async () => {
    const f = fakeFetch(() => res(200, JSON.stringify({data: [{id: "x", filename: "notes.txt"}]})));
    const out = await fetchBriefing({fetchImpl: f.impl, apiKey: "k", sessionId: "s"});
    assert.strictEqual(out, null);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
