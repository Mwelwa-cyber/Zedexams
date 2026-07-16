/**
 * Verifies reservation-gate migration for non-Anthropic providers.
 * Run: node functions/aiBudgetEnforcementMigration.test.js
 */

const assert = require("node:assert");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

function mockAiCostTracking(overrides = {}) {
  const calls = {
    begin: [], settle: [], settleImage: [], release: [], imageCost: [],
  };
  const mock = {
    BUDGET_PAUSED_MESSAGE: "paused",
    beginAiCall: async (args) => {
      calls.begin.push(args);
      return {allowed: true, reservation: {id: "r1", month: "2026-07"}};
    },
    settleAiCall: async (args) => {
      calls.settle.push(args);
      return {ok: true};
    },
    settleAiImageCall: async (args) => {
      calls.settleImage.push(args);
      return {ok: true};
    },
    releaseAiCall: async (args) => {
      calls.release.push(args);
      return {released: true};
    },
    imageCostUsd: (model, cfg) => {
      calls.imageCost.push({model, cfg});
      return 0.123;
    },
    ...overrides,
  };
  const modPath = require.resolve("./aiCostTracking");
  const prior = require.cache[modPath];
  require.cache[modPath] = {
    id: modPath,
    filename: modPath,
    loaded: true,
    exports: mock,
  };
  return {
    calls,
    restore() {
      if (prior) require.cache[modPath] = prior;
      else delete require.cache[modPath];
    },
  };
}

function resetModule(mod) {
  delete require.cache[require.resolve(mod)];
}

async function run() {
  console.log("aiBudgetEnforcementMigration");

  // ── Gemini text client ───────────────────────────────────────────────────
  {
    const m = mockAiCostTracking();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        usageMetadata: {promptTokenCount: 21, candidatesTokenCount: 7},
        candidates: [{content: {parts: [{text: "hello"}]}}],
      }),
    });
    try {
      resetModule("./geminiClient");
      const {callGemini} = require("./geminiClient");
      const out = await callGemini("k", {
        userPrompt: "hi",
        maxTokens: 900,
        model: "gemini-2.5-flash",
        track: {uid: "u1", tool: "import", generationId: "g-gem"},
      });
      ok("gemini returns model text", out === "hello");
      ok("gemini reserves with provider tag", m.calls.begin[0].provider === "gemini");
      ok("gemini reserve carries maxTokens", m.calls.begin[0].maxTokens === 900);
      ok("gemini settles usage", m.calls.settle.length === 1 && m.calls.settle[0].usage.input_tokens === 21);
    } finally {
      global.fetch = originalFetch;
      m.restore();
    }
  }

  // ── OpenAI embeddings client ─────────────────────────────────────────────
  {
    const m = mockAiCostTracking();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        model: "text-embedding-3-small",
        usage: {prompt_tokens: 15},
        data: [{embedding: [0.1, 0.2]}],
      }),
    });
    try {
      resetModule("./openaiEmbeddings");
      const {embedText} = require("./openaiEmbeddings");
      const vec = await embedText("k", "hello world", {track: {generationId: "g-emb"}});
      ok("embeddings returns vector", Array.isArray(vec) && vec.length === 2);
      ok("embeddings reserves with provider tag", m.calls.begin[0].provider === "embeddings");
      ok("embeddings settles usage", m.calls.settle.length === 1 && m.calls.settle[0].usage.input_tokens === 15);
    } finally {
      global.fetch = originalFetch;
      m.restore();
    }
  }

  // ── OpenAI image client ──────────────────────────────────────────────────
  {
    const m = mockAiCostTracking();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({data: [{b64_json: "abc"}]}),
    });
    try {
      resetModule("./openaiClient");
      const {callOpenAIImage} = require("./openaiClient");
      const out = await callOpenAIImage("k", {
        prompt: "draw",
        quality: "high",
        size: "1024x1536",
        track: {generationId: "g-img-openai"},
      });
      ok("openai image returns payload", out && out.b64 === "abc");
      ok("openai image reserves with provider tag", m.calls.begin[0].provider === "openai");
      ok("openai image reservation uses flat estimate", m.calls.begin[0].estCostUsd === 0.123);
      ok("openai image settles through image path", m.calls.settleImage.length === 1);
    } finally {
      global.fetch = originalFetch;
      m.restore();
    }
  }

  // ── Gemini image client ──────────────────────────────────────────────────
  {
    const m = mockAiCostTracking();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{content: {parts: [{inlineData: {data: "xyz", mimeType: "image/png"}}]}}],
      }),
    });
    try {
      resetModule("./geminiImageClient");
      const {callGeminiImage} = require("./geminiImageClient");
      const out = await callGeminiImage("k", {
        prompt: "draw",
        track: {generationId: "g-img-gem"},
      });
      ok("gemini image returns payload", out && out.b64 === "xyz");
      ok("gemini image reserves with provider tag", m.calls.begin[0].provider === "gemini");
      ok("gemini image reservation uses flat estimate", m.calls.begin[0].estCostUsd === 0.123);
      ok("gemini image settles through image path", m.calls.settleImage.length === 1);
    } finally {
      global.fetch = originalFetch;
      m.restore();
    }
  }

  // ── aiService OpenAI path (zed chat / marking helpers) ───────────────────
  {
    const m = mockAiCostTracking();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        model: "gpt-4o-mini",
        usage: {prompt_tokens: 11, completion_tokens: 4},
        choices: [{message: {content: "done"}}],
      }),
    });
    try {
      resetModule("./aiService");
      const {callOpenAI} = require("./aiService");
      const out = await callOpenAI("k", {
        messages: [{role: "user", content: "hi"}],
        track: {generationId: "g-openai", uid: "u5", tool: "zedChat"},
      });
      ok("aiService callOpenAI returns content", out === "done");
      ok("aiService reserves OpenAI provider", m.calls.begin[0].provider === "openai");
      ok("aiService settles OpenAI usage", m.calls.settle.length === 1 && m.calls.settle[0].usage.output_tokens === 4);
    } finally {
      global.fetch = originalFetch;
      m.restore();
    }
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
