/**
 * Bonga (WhatsApp reply agent) tests — plain `node` assertions.
 *
 * Covers the pure brain (functions/agents/runners/bonga.js) and the inbound
 * webhook helpers in functions/metaWhatsApp.js: message parsing, the GET
 * verification handshake, and the X-Hub-Signature-256 HMAC check.
 *
 * Run: node functions/agents/bonga.test.js  (or: npm run test:whatsapp-agent)
 */

const assert = require("assert");
const crypto = require("crypto");

const {
  runBongaReply,
  classifyInbound,
  buildAnthropicMessages,
  templateReply,
  MAX_REPLY_CHARS,
} = require("./runners/bonga");

// Import from the dependency-free core so this test runs under plain `node`
// (no firebase-functions). metaWhatsApp.js wraps these with the secret reads.
const {
  parseInboundMessages,
  verifyWebhookSubscriptionMatch,
  verifyWebhookSignature,
} = require("../metaWhatsAppCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// ---------------------------------------------------------------------------
// classifyInbound
// ---------------------------------------------------------------------------
ok("greeting → greeting", classifyInbound("Hi there!") === "greeting");
ok("thanks → greeting", classifyInbound("thank you 🙏") === "greeting");
ok("pricing → sales", classifyInbound("How much is the premium plan?") === "sales");
ok("payment → sales", classifyInbound("I want to pay with MTN mobile money") === "sales");
ok("login problem → support", classifyInbound("I can't log in to my account") === "support");
ok("broken → support", classifyInbound("the app is not working, blank screen") === "support");
ok("CBC question → study", classifyInbound("Explain photosynthesis for grade 7") === "study");
ok("sales beats study", classifyInbound("what is the price to learn science?") === "sales");

// ---------------------------------------------------------------------------
// buildAnthropicMessages — history + current turn, user-first invariant
// ---------------------------------------------------------------------------
{
  const messages = buildAnthropicMessages({
    inbound: {text: "and grade 8?"},
    history: [
      {role: "user", text: "explain fractions"},
      {role: "assistant", text: "A fraction is part of a whole..."},
    ],
  });
  ok("messages include history + current", messages.length === 3);
  ok("first message is a user turn", messages[0].role === "user");
  ok("last message is the new inbound", messages[2].content === "and grade 8?");
}
{
  // Leading assistant turn must be dropped so Anthropic gets a user-first list.
  const messages = buildAnthropicMessages({
    inbound: {text: "hello"},
    history: [{role: "assistant", text: "stray opener"}],
  });
  ok("leading assistant turn dropped", messages[0].role === "user");
}

// ---------------------------------------------------------------------------
// runBongaReply — model path, fallback path, error degradation, length cap
// ---------------------------------------------------------------------------
(async () => {
  // Model returns text → used verbatim, no fallback.
  const r1 = await runBongaReply({
    inbound: {text: "How much is premium?", name: "Mwila Banda"},
    draftReply: async ({kind, systemPrompt}) => {
      assert.ok(kind === "sales", "kind passed to drafter");
      assert.ok(/Bonga/.test(systemPrompt), "system prompt passed to drafter");
      return "Premium is affordable — see zedexams.com/pricing.";
    },
  });
  ok("model reply used", r1.reply === "Premium is affordable — see zedexams.com/pricing.");
  ok("model reply not flagged fallback", r1.usedFallback === false);
  ok("kind surfaced", r1.kind === "sales");

  // No drafter → templated fallback, personalised by first name.
  const r2 = await runBongaReply({inbound: {text: "I can't log in", name: "Mwila Banda"}});
  ok("fallback used when no drafter", r2.usedFallback === true);
  ok("fallback greets by first name", r2.reply.startsWith("Hi Mwila,"));
  ok("support fallback mentions reset", /reset\w*\s+your password/i.test(r2.reply));

  // Drafter throws → degrade to fallback, never throw.
  const r3 = await runBongaReply({
    inbound: {text: "explain osmosis"},
    draftReply: async () => { throw new Error("model down"); },
  });
  ok("throwing drafter degrades to fallback", r3.usedFallback === true && r3.reply.length > 0);

  // Empty model reply → fallback.
  const r4 = await runBongaReply({
    inbound: {text: "hi"},
    draftReply: async () => "   ",
  });
  ok("empty model reply → fallback", r4.usedFallback === true);

  // Over-long model reply is capped.
  const long = "x".repeat(MAX_REPLY_CHARS + 200);
  const r5 = await runBongaReply({inbound: {text: "hi"}, draftReply: async () => long});
  ok("over-long reply capped", r5.reply.length <= MAX_REPLY_CHARS);
  ok("capped reply ends with ellipsis", r5.reply.endsWith("…"));

  runWebhookHelperTests();
  console.log(`bonga.test.js: ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// templateReply — every lane produces non-empty, signed text
// ---------------------------------------------------------------------------
for (const kind of ["greeting", "study", "support", "sales"]) {
  const t = templateReply({kind, inbound: {name: "Sara"}});
  ok(`templateReply(${kind}) non-empty`, typeof t === "string" && t.length > 0);
  ok(`templateReply(${kind}) signed`, /ZedExams/.test(t));
}

// ---------------------------------------------------------------------------
// Webhook helpers — run after the async block so output ordering is stable.
// ---------------------------------------------------------------------------
function runWebhookHelperTests() {
  // parseInboundMessages — pulls text messages + sender name, ignores status
  // callbacks and non-text types.
  const body = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          contacts: [{wa_id: "260977123456", profile: {name: "Chanda"}}],
          messages: [
            {from: "260977123456", id: "wamid.A1", type: "text",
              timestamp: "1700000000", text: {body: "  Hello Bonga  "}},
            {from: "260977123456", id: "wamid.A2", type: "image", image: {id: "x"}},
          ],
        },
      }],
    }],
  };
  const parsed = parseInboundMessages(body);
  ok("parse keeps one text message", parsed.length === 1);
  ok("parse trims body", parsed[0].text === "Hello Bonga");
  ok("parse resolves sender name", parsed[0].name === "Chanda");
  ok("parse maps message id", parsed[0].messageId === "wamid.A1");
  ok("parse converts timestamp to ms", parsed[0].timestamp === 1700000000 * 1000);

  // Status-only callback (no messages) → empty.
  ok("parse ignores status callbacks",
    parseInboundMessages({entry: [{changes: [{value: {statuses: [{id: "x"}]}}]}]}).length === 0);
  ok("parse tolerates junk", parseInboundMessages(null).length === 0);

  // verifyWebhookSubscriptionMatch — GET handshake.
  const token = "test-verify-token";
  const good = verifyWebhookSubscriptionMatch({
    expectedToken: token,
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": "nonce-42",
    },
  });
  ok("handshake ok on match", good.ok === true && good.challenge === "nonce-42");
  ok("handshake rejects bad token", verifyWebhookSubscriptionMatch({
    expectedToken: token,
    query: {"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "n"},
  }).ok === false);
  ok("handshake rejects bad mode", verifyWebhookSubscriptionMatch({
    expectedToken: token,
    query: {"hub.mode": "unsubscribe", "hub.verify_token": token},
  }).ok === false);
  ok("handshake rejects when token unset", verifyWebhookSubscriptionMatch({
    expectedToken: "",
    query: {"hub.mode": "subscribe", "hub.verify_token": token},
  }).ok === false);

  // verifyWebhookSignature — HMAC-SHA256 over the raw body.
  const appSecret = "app-secret-xyz";
  const raw = Buffer.from(JSON.stringify({hello: "world"}), "utf8");
  const digest = crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  ok("signature valid on correct digest",
    verifyWebhookSignature({rawBody: raw, signature: `sha256=${digest}`, appSecret}) === true);
  ok("signature invalid on tampered body",
    verifyWebhookSignature({rawBody: Buffer.from("tampered"), signature: `sha256=${digest}`, appSecret}) === false);
  ok("signature invalid without prefix",
    verifyWebhookSignature({rawBody: raw, signature: digest, appSecret}) === false);
  ok("signature invalid when app secret missing",
    verifyWebhookSignature({rawBody: raw, signature: `sha256=${digest}`, appSecret: ""}) === false);
  ok("signature invalid on malformed hex",
    verifyWebhookSignature({rawBody: raw, signature: "sha256=zzzz", appSecret}) === false);
}
