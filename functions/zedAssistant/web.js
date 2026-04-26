/**
 * Web client for the Zed assistant.
 *
 * Same Claude tool-loop as telegram.js, but exposed over HTTPS with a
 * Firebase ID-token check (admin role required). Conversation memory is
 * partitioned per user under chatId="web:{uid}" so the web client and
 * Telegram don't accidentally share context.
 *
 * Powers /api/zed/chat — the backend for src/pages/ZedVoice.jsx.
 */

const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

const {runAgent} = require("./agent");
const {buildToolDefinitions, buildToolRunner} = require("./tools");
const {SYSTEM_PROMPT} = require("./systemPrompt");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const MAX_INCOMING_TEXT = 2000;
const RECENT_TURNS = 6;

async function loadRecentHistory(chatId) {
  try {
    const snap = await admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns")
      .orderBy("createdAt", "desc")
      .limit(RECENT_TURNS)
      .get();
    return snap.docs
      .map((d) => d.data())
      .reverse()
      .filter((turn) => turn?.role && turn?.text)
      .map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: String(turn.text).slice(0, 1500),
      }));
  } catch (err) {
    console.warn("zedAssistant.web loadRecentHistory failed", err?.message);
    return [];
  }
}

async function appendTurn(chatId, role, text) {
  try {
    await admin.firestore()
      .collection("zedAssistantChats")
      .doc(String(chatId))
      .collection("turns")
      .add({
        role,
        text: String(text || "").slice(0, 4000),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.warn("zedAssistant.web appendTurn failed", err?.message);
  }
}

function buildUserMessage(messageText) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `[date=${today}]`,
    String(messageText || "").slice(0, MAX_INCOMING_TEXT),
  ].join("\n");
}

async function verifyAdminBearer(authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(String(authHeader || "").trim());
  if (!m) {
    const err = new Error("Missing Bearer token");
    err.status = 401;
    throw err;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    const err = new Error("Invalid token");
    err.status = 401;
    throw err;
  }
  const uid = decoded.uid;
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  if (!snap.exists || snap.data()?.role !== "admin") {
    const err = new Error("Admin only");
    err.status = 403;
    throw err;
  }
  return {uid};
}

exports.apiZedAssistantChat = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: [anthropicApiKey],
    cors: true,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "POST only"});
      return;
    }

    let uid;
    try {
      ({uid} = await verifyAdminBearer(req.get("authorization")));
    } catch (err) {
      res.status(err.status || 401).json({error: err.message});
      return;
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({error: "message is required"});
      return;
    }

    const anthropicKey = anthropicApiKey.value() ||
      process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      console.error("zedAssistant.web: missing ANTHROPIC_API_KEY");
      res.status(500).json({error: "not_configured"});
      return;
    }

    const chatId = `web:${uid}`;
    const history = await loadRecentHistory(chatId);
    await appendTurn(chatId, "user", message);

    const messages = [
      ...history,
      {role: "user", content: buildUserMessage(message)},
    ];

    let result;
    try {
      result = await runAgent(anthropicKey, {
        systemPrompt: SYSTEM_PROMPT,
        messages,
        tools: buildToolDefinitions(),
        runTool: buildToolRunner({chatId}),
      });
    } catch (err) {
      console.error("zedAssistant.web agent failed", err?.message);
      res.status(502).json({error: "agent_failed", detail: err?.message});
      return;
    }

    const reply = result.text ||
      "I didn't produce a reply. Try rephrasing the question.";
    await appendTurn(chatId, "assistant", reply);

    res.status(200).json({
      reply,
      toolCalls: result.toolCalls.map((c) => c.name),
      stopReason: result.stopReason,
    });
  },
);
