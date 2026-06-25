/**
 * Bonga — the WhatsApp reply agent (read → classify → draft → auto-send).
 *
 * Bonga is the first agent that talks to people directly. It answers inbound
 * WhatsApp messages on the ZedExams business number, covering three lanes:
 *   • study   — CBC study questions from learners (Zed-chat-over-WhatsApp)
 *   • support — login/account/technical "it's not working" messages
 *   • sales   — pricing, plans, and subscription questions
 *
 * It only ever replies inside WhatsApp's 24-hour customer-service window (the
 * inbound message that triggers it opens that window), so replies are always
 * free-form text — no message template needed. The actual Meta send + Firestore
 * logging live in the webhook (functions/index.js → apiWhatsAppWebhook); this
 * module is the pure brain: classify the message, build the model prompt, and
 * fall back to a free templated reply when no model key is configured.
 *
 * Pure-ish like echo.js / till.js / monitor.js: the reply drafter is injected,
 * so classification + orchestration unit-test without Firebase, the network, or
 * an LLM. No firebase-admin / anthropic require here.
 */

// WhatsApp replies should be short — long walls of text read badly on a phone.
const MAX_REPLY_CHARS = 900;

// Keep a little conversation context so follow-ups make sense, without paying
// for a long history on every turn.
const MAX_HISTORY_TURNS = 8;

const SALES_RE = new RegExp(
    "\\b(price|pricing|cost|how much|fees?|subscri\\w*|\\bplan\\b|plans|premium|" +
    "upgrade|payment|\\bpay\\b|mtn|airtel|zamtel|mobile money|free trial|" +
    "discount|refund|invoice|billing)\\b",
    "i",
);

const SUPPORT_RE = new RegExp(
    "\\b(can'?t|cannot|won'?t|not working|does ?n'?t work|broken|error|bug|" +
    "crash\\w*|stuck|fail\\w*|reset|forgot|password|log ?in|sign ?in|sign ?up|" +
    "register|account|otp|verify|verification|app|loading|blank|white screen)\\b",
    "i",
);

// A short message that opens with one of these and asks nothing is a bare
// greeting/acknowledgement — handled by its own lane so we don't fire the
// model at "hi" or "thanks 🙏".
const GREETING_RE = new RegExp(
    "^(hi|hie|hey|hello|hallo|yo|good (morning|afternoon|evening)|" +
    "muli (bwanji|shani)|mwauka|how are you|thanks|thank you|thank u|thx|" +
    "ok|okay|cool|great|noted|cheers)\\b",
    "i",
);

/**
 * Is `text` a bare greeting/acknowledgement (no real question)? Trailing emoji
 * and punctuation are stripped first; a real question ("?") or anything longer
 * than a few words is NOT a greeting so "Hi, how much is premium?" still routes
 * to its real lane.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isGreeting(text) {
  const t = String(text || "").trim();
  if (!t || t.includes("?")) return false;
  // Strip trailing punctuation/whitespace/common emoji so "thank you 🙏" counts.
  const stripped = t.replace(/[\s!.,;:)\u{1F300}-\u{1FAFF}☀-➿️]+$/u, "").trim();
  if (!stripped) return true; // pure emoji/punctuation
  if (stripped.split(/\s+/).length > 4) return false;
  return GREETING_RE.test(stripped);
}

/**
 * Best-effort lane for an inbound message. Sales + support cues win over the
 * generic study lane because they have a clearer "do X" answer; a bare
 * greeting/acknowledgement gets its own short lane.
 *
 * @param {string} text
 * @returns {'sales'|'support'|'greeting'|'study'}
 */
function classifyInbound(text) {
  const t = String(text || "");
  if (isGreeting(t)) return "greeting";
  if (SALES_RE.test(t)) return "sales";
  if (SUPPORT_RE.test(t)) return "support";
  return "study";
}

function firstName(name) {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0] : "";
}

/**
 * System prompt for the model. Bonga is a concise, warm ZedExams concierge on
 * WhatsApp. It can teach CBC topics, help with account problems at a high
 * level, and explain pricing — but it must NEVER invent account state, promise
 * refunds, or claim to have changed a subscription, because it has no tools to
 * do any of that. Anything action-shaped routes to a human / the website.
 */
const BONGA_SYSTEM_PROMPT = [
  "You are Bonga, the friendly WhatsApp assistant for ZedExams (zedexams.com),",
  "a CBC-aligned learning platform for Zambian learners, teachers and parents.",
  "You reply to people who message the ZedExams WhatsApp number.",
  "",
  "Voice: warm, encouraging, plain English a Zambian Grade 1–12 learner or",
  "parent understands. Keep replies SHORT — a few sentences, this is WhatsApp,",
  "not an essay. Use at most one emoji. Never use markdown headings or tables.",
  "",
  "You handle three kinds of message:",
  "1. STUDY — answer the CBC question directly and teach the idea simply, the",
  "   way a patient tutor would. If it helps, give one short worked example.",
  "2. SUPPORT — account/login/technical problems. Give the practical first",
  "   step (e.g. reset password at zedexams.com, check internet, reinstall).",
  "   You CANNOT see their account, reset anything, or read their data — say a",
  "   teammate will help if the basic step does not fix it.",
  "3. SALES — pricing/plans/subscriptions. Explain plans at a high level and",
  "   point them to zedexams.com/pricing to subscribe (mobile money: MTN,",
  "   Airtel, Zamtel, or card, in ZMW). Do NOT quote an exact price you are",
  "   unsure of, and NEVER claim a payment went through or promise a refund.",
  "",
  "Hard rules: never invent account details, balances, scores or payment",
  "status. Never say you have changed, cancelled, refunded or upgraded",
  "anything — you have no such ability. If you are unsure or the request needs",
  "a real human (billing dispute, account access, a bug), say so plainly and",
  "tell them a teammate will follow up. Stay on ZedExams topics.",
].join("\n");

/**
 * Build the Anthropic `messages` array from the current inbound message plus a
 * little prior history. History items are {role: 'user'|'assistant', text}.
 * The model gets the persona via the separate system prompt.
 *
 * @param {Object} args
 * @param {{text: string, name?: string}} args.inbound
 * @param {Array<{role: string, text: string}>} [args.history]
 * @returns {Array<{role: 'user'|'assistant', content: string}>}
 */
function buildAnthropicMessages({inbound, history = []}) {
  const messages = [];
  const recent = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
  for (const turn of recent) {
    const role = turn?.role === "assistant" ? "assistant" : "user";
    const text = String(turn?.text || "").trim();
    if (text) messages.push({role, content: text});
  }
  messages.push({role: "user", content: String(inbound?.text || "").trim()});
  // Anthropic requires the first message to be a user turn. If history started
  // with an assistant turn (shouldn't happen, but be safe), drop the leaders.
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}

/**
 * Free, on-brand fallback reply used when no model key is configured or the
 * model call fails. Keeps Bonga from going silent.
 *
 * @param {Object} args
 * @param {'sales'|'support'|'greeting'|'study'} args.kind
 * @param {{name?: string}} [args.inbound]
 * @returns {string}
 */
function templateReply({kind, inbound}) {
  const hi = firstName(inbound?.name) || "there";
  const body = {
    greeting: "thanks for reaching out to ZedExams! Ask me a study question, or" +
      " tell me what you need help with and I'll do my best. 📚",
    study: "thanks for your question! I'm having a small hiccup answering right" +
      " now — please try again in a moment, or sign in at zedexams.com to study.",
    support: "sorry you're stuck. First try resetting your password at" +
      " zedexams.com and check your internet — if that doesn't fix it, a" +
      " teammate will follow up to help.",
    sales: "thanks for your interest in ZedExams! You can see all plans and" +
      " subscribe with mobile money or card at zedexams.com/pricing. A teammate" +
      " can help if you have any questions.",
  };
  return `Hi ${hi}, ${body[kind] || body.greeting}\n\n— ZedExams`;
}

/**
 * Draft a reply to one inbound WhatsApp message. Classifies the lane, asks the
 * injected `draftReply` for model text, and falls back to a templated reply on
 * empty/error. Never throws — a thrown drafter degrades to the template.
 *
 * @param {Object} args
 * @param {{text: string, name?: string, from?: string}} args.inbound
 * @param {Array<{role: string, text: string}>} [args.history]
 * @param {Function} args.draftReply  ({kind, inbound, history, messages,
 *                                      systemPrompt}) -> Promise<string>|string
 * @returns {Promise<{kind: string, reply: string, usedFallback: boolean}>}
 */
async function runBongaReply({inbound, history = [], draftReply}) {
  const kind = classifyInbound(inbound?.text);
  const messages = buildAnthropicMessages({inbound, history});

  let reply = "";
  let usedFallback = false;
  if (typeof draftReply === "function") {
    try {
      reply = String(await draftReply({
        kind,
        inbound,
        history,
        messages,
        systemPrompt: BONGA_SYSTEM_PROMPT,
      }) || "").trim();
    } catch (_err) {
      reply = "";
    }
  }
  if (!reply) {
    reply = templateReply({kind, inbound});
    usedFallback = true;
  }
  if (reply.length > MAX_REPLY_CHARS) reply = `${reply.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…`;
  return {kind, reply, usedFallback};
}

module.exports = {
  runBongaReply,
  classifyInbound,
  buildAnthropicMessages,
  templateReply,
  BONGA_SYSTEM_PROMPT,
  MAX_REPLY_CHARS,
  MAX_HISTORY_TURNS,
};
