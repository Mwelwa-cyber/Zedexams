/**
 * Echo — support-triage agent (read → classify → draft, Tier-B drafts-only).
 *
 * Two inbound channels reach ZedExams today and neither gets a timely human
 * eye on it:
 *   • feedback/{id}       — in-app suggestion box (tagged type: suggestion |
 *                           content | feature | bug | other). An admin only
 *                           sees it if they open /admin/feedback; no alert.
 *   • contactMessages/{id} — the PUBLIC marketing/pricing contact form. It
 *                           has NO admin UI at all — messages from prospective
 *                           customers pile up in Firestore completely unseen.
 *
 * Echo sweeps both, classifies each item, scores a priority (bugs, billing
 * and anything that reads urgent/upset get flagged), and drafts a reply — so
 * the human job collapses from "remember to check, read, and write" to "skim
 * and send". It writes its triage back onto each doc (echo* fields, idempotent
 * via echoProcessedAt) and never sends anything: drafting is the deliverable,
 * the send button stays human until a reply surface + an approval gate ship.
 *
 * Pure-ish: the Firestore handle and the reply drafter are injected, so the
 * classification + orchestration unit-test without Firebase, the network, or
 * an LLM (same pattern as till.js / monitor.js). The reply draft falls back to
 * a free templated acknowledgement when no model key is configured.
 */

const MAX_ITEMS = 40;

// Words that push an item to "high" regardless of its category — money,
// access loss, or an upset tone all warrant a fast, careful human reply.
const URGENCY_RE = new RegExp(
    "\\b(refund|reimburse|money\\s*back|scam|fraud|charged|double[- ]?charg|" +
    "can'?t\\s+(log\\s?in|access|pay)|not\\s+working|does\\s?n'?t\\s+work|" +
    "won'?t\\s+work|broken|crash(ing)?|urgent|asap|angry|disappointed|terrible|" +
    "useless|stuck|failed\\s+payment|paid\\s+but)\\b",
    "i",
);

// Categories that are high-priority by their nature.
const HIGH_KINDS = new Set(["bug", "billing"]);

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

function firstName(name) {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0] : "";
}

function whoFrom(data) {
  return data.name || data.email || data.uid || null;
}

/** Best-effort category for a free-text contact-form message (no `type` field). */
function inferContactKind(message) {
  const m = String(message || "").toLowerCase();
  if (/\b(bug|error|not working|does ?n'?t work|broken|crash|can'?t|stuck|fail)\b/.test(m)) return "bug";
  if (/\b(price|pricing|cost|subscri|\bpay\b|payment|plan|refund|billing|money|charge)\b/.test(m)) return "billing";
  if (/\b(school|partner|bulk|enterprise|demo|teacher account|institution)\b/.test(m)) return "sales";
  if (/\b(feature|add|could you|please add|wish|would like|suggest|request)\b/.test(m)) return "feature";
  return "general";
}

/**
 * Classify one inbound item into a {kind, priority}. Feedback already carries
 * a `type`; contact-form messages are inferred from their text.
 */
function classifyItem(item) {
  const data = (item && item.data) || {};
  const kind = item && item.collection === "feedback" ?
    String(data.type || "other").toLowerCase() :
    inferContactKind(data.message);
  const high = HIGH_KINDS.has(kind) || URGENCY_RE.test(String(data.message || ""));
  return {kind, priority: high ? "high" : "normal"};
}

/** Free, on-brand acknowledgement used when no model key is configured. */
function templateReply({kind, item}) {
  const data = (item && item.data) || {};
  const hi = firstName(data.name) || "there";
  const ack = {
    bug: "thanks for flagging this — sorry it tripped you up. Our team is looking into it and we'll get it sorted.",
    billing: "thanks for reaching out about your payment. We'll check your account and make this right.",
    content: "thanks for the content request — we've noted it and will work on adding it.",
    feature: "thanks for the suggestion — we've added it to our list for an upcoming update.",
    sales: "thanks for your interest in ZedExams! We'd love to help and will be in touch shortly.",
    suggestion: "thanks for the idea — we really appreciate it and have noted it down.",
    general: "thanks for getting in touch — we've received your message and will get back to you shortly.",
    other: "thanks for getting in touch — we've received your message and will get back to you shortly.",
  };
  return `Hi ${hi},\n\n${ack[kind] || ack.general}\n\n— The ZedExams Team`;
}

/**
 * Sweep new feedback + unprocessed contact messages, triage each, draft a
 * reply, and write the triage back. Idempotent: an item with echoProcessedAt
 * set is skipped, so re-runs only touch genuinely new items.
 *
 * @param {Object}   args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {Function} args.draftReply   ({kind, priority, item}) -> string. May
 *                                      throw / return empty; falls back to a
 *                                      templated reply.
 * @param {number}   [args.now]
 * @param {number}   [args.maxItems]
 * @returns {Promise<Object>} summary
 */
async function runEchoTriage({db, draftReply, now = Date.now(), maxItems = MAX_ITEMS}) {
  const summary = {
    processed: 0,
    surfacedContact: 0, // contact-form messages triaged (were invisible before)
    byKind: {},
    byPriority: {high: 0, normal: 0},
    highPriority: [],
    errors: [],
  };

  const items = [];
  async function gather(collection, keep) {
    try {
      const snap = await db.collection(collection)
          .orderBy("createdAt", "desc")
          .limit(maxItems)
          .get();
      snap.forEach((doc) => {
        const data = doc.data() || {};
        if (keep(data)) items.push({collection, id: doc.id, data});
      });
    } catch (err) {
      summary.errors.push({stage: `${collection}-query`, message: clampMessage(err)});
    }
  }

  // New, not-yet-triaged feedback; and any contact message we haven't seen.
  await gather("feedback", (d) => d.status === "new" && !d.echoProcessedAt);
  await gather("contactMessages", (d) => !d.echoProcessedAt);

  for (const item of items.slice(0, maxItems)) {
    const {kind, priority} = classifyItem(item);

    let draft = "";
    try {
      draft = await draftReply({kind, priority, item});
    } catch (err) {
      summary.errors.push({collection: item.collection, id: item.id, stage: "draft", message: clampMessage(err)});
    }
    if (!draft) draft = templateReply({kind, item});

    try {
      await db.collection(item.collection).doc(item.id).set({
        echoClassification: kind,
        echoPriority: priority,
        echoDraftReply: draft,
        // A native Date stores as a Timestamp via the Admin SDK — keeps this
        // module free of a firebase-admin dependency so it stays unit-testable.
        echoProcessedAt: new Date(now),
      }, {merge: true});
    } catch (err) {
      summary.errors.push({collection: item.collection, id: item.id, stage: "write", message: clampMessage(err)});
      continue;
    }

    summary.processed += 1;
    if (item.collection === "contactMessages") summary.surfacedContact += 1;
    summary.byKind[kind] = (summary.byKind[kind] || 0) + 1;
    summary.byPriority[priority] += 1;
    if (priority === "high") {
      summary.highPriority.push({
        collection: item.collection,
        id: item.id,
        kind,
        who: whoFrom(item.data),
        snippet: String(item.data.message || "").slice(0, 140),
      });
    }
  }

  return summary;
}

module.exports = {
  runEchoTriage,
  classifyItem,
  inferContactKind,
  templateReply,
  MAX_ITEMS,
};
