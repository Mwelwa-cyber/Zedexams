"use strict";

/**
 * learnerSafetyCore — deterministic child-safety handling, ahead of the model.
 *
 * The app already screens learner messages through OpenAI's moderation
 * endpoint (contentModeration.js) and refuses unsafe ones with a friendly
 * "let's keep our chat about schoolwork". That is the right answer for a rude
 * question. It is the WRONG answer for a child who has just typed that
 * someone is hurting them, or that they want to hurt themselves — a cheerful
 * redirect to schoolwork is, in that moment, the platform turning away.
 *
 * So this module sits in front of the model and handles two classes of
 * message deterministically, before any provider call:
 *
 *   1. DISTRESS — self-harm, abuse, being hurt. Never sent to the model at
 *      all. Answered with a fixed, careful message that names trusted adults
 *      and a real helpline. Deterministic because this is the one case where
 *      a generated response varying by temperature is unacceptable, and
 *      because it must still work when the provider is down.
 *
 *   2. SECRECY — "don't tell my parents", "keep this a secret". Grooming
 *      language, and a pattern a child may repeat innocently. Answered with a
 *      fixed message that declines the premise warmly.
 *
 * Everything else passes through to the existing moderation + model path.
 *
 * ── On redaction ─────────────────────────────────────────────────────────
 *
 * Learner messages are logged for debugging and abuse review. A child pasting
 * their phone number or address into a study chat should not create a durable
 * record of it, so `redactForLogs` strips contact details before anything is
 * written down. It is applied to the LOG copy only — the model still sees the
 * original message, because redacting the prompt would make "help me write my
 * address in a letter" fail in a confusing way.
 *
 * ── On matching ──────────────────────────────────────────────────────────
 *
 * These are word-boundary patterns over a normalised string, not a bag of
 * substrings. "assessment" contains "ass"; "Scunthorpe" is a real place; a
 * grade-5 comprehension passage about a character who "wanted to kill time"
 * must not trip a crisis response. Precision matters in both directions here:
 * a false positive interrupts a child's homework with a helpline, and a false
 * negative is the case this module exists for.
 *
 * Pure module — no I/O, no provider calls.
 */

// Zambia. Childline Zambia is free from all networks and is the number a
// Zambian teacher would give; 116 is the national child helpline short code.
const HELPLINE = "Childline Zambia on 116 (free, any network)";

const DISTRESS_REPLY = [
  "That sounds really hard, and I'm glad you told someone.",
  "",
  "I'm just a computer program that helps with schoolwork, so I'm not the right",
  "one to help with this — but a person can. Please talk to a grown-up you trust",
  "today: a parent, a guardian, a teacher, or your head teacher.",
  "",
  `You can also call ${HELPLINE}. They talk to young people about exactly this,`,
  "and it's free and private.",
  "",
  "If you're in danger right now, tell an adult near you straight away.",
].join("\n");

const SECRECY_REPLY = [
  "I can't keep secrets from your parents, guardian, or teachers — and honestly,",
  "you shouldn't have to keep one either.",
  "",
  "If something is worrying you, please tell a grown-up you trust. If it's hard",
  `to say out loud, you can call ${HELPLINE} and talk to someone.`,
  "",
  "I'm here for schoolwork whenever you want help with that.",
].join("\n");

/**
 * Distress patterns. Deliberately narrow and phrase-based: each one is
 * something a child says when they need a person, and none is a plausible
 * fragment of a homework question.
 */
const DISTRESS_PATTERNS = [
  /\bkill (?:myself|my self)\b/,
  /\bkilling myself\b/,
  /\b(?:want|wanna|going) to die\b/,
  /\bi (?:want|wish) to be dead\b/,
  /\bend my life\b/,
  /\bhurt(?:ing)? myself\b/,
  /\bharm(?:ing)? myself\b/,
  /\bcut(?:ting)? myself\b/,
  /\bsuicid(?:e|al)\b/,
  /\bno (?:reason|point) (?:to|in) liv(?:e|ing)\b/,
  // Disclosure of harm by someone else.
  /\b(?:someone|somebody|a man|a boy|my (?:uncle|teacher|father|dad|stepfather|brother|cousin|neighbour|neighbor))\s+(?:is\s+)?(?:touch(?:ing|ed)|hurt(?:ing|s)?|beat(?:ing|s)?|hit(?:ting|s)?)\s+me\b/,
  /\bbeing (?:abused|touched|hurt|beaten)\b/,
  /\b(?:i am|i'm) (?:being )?(?:abused|scared of my)\b/,
  /\bafraid to go home\b/,
]

;
/**
 * Secrecy / grooming patterns.
 */
const SECRECY_PATTERNS = [
  /\b(?:don'?t|do not|never) tell (?:my |anyone|my mum|my mom|my dad|my parents|my teacher)/,
  /\bkeep (?:this|it) (?:a )?secret\b/,
  /\bour secret\b/,
  /\bpromise not to tell\b/,
  /\bwithout (?:my )?(?:parents?|mum|mom|dad|teacher)s? knowing\b/,
];

// Contact details, for the LOG copy only.
const REDACTIONS = [
  // Email first — otherwise the digit rule chews the local part of some.
  [/\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/gi, "[email removed]"],
  // Phone: Zambian mobiles are 09xxxxxxxx or +26097xxxxxxx. Broad enough to
  // catch spaced and dashed forms without eating a maths answer — requires
  // 9+ digits, which no arithmetic result in this app reaches.
  [/(?:\+?\d[\d\s-]{8,}\d)/g, "[number removed]"],
  [/\bhttps?:\/\/\S+/gi, "[link removed]"],
  [/\bwww\.\S+/gi, "[link removed]"],
];

function normalise(text) {
  return String(text || "")
    .toLowerCase()
    // Collapse the character substitutions a child might use without meaning
    // to evade anything (and that an evader would).
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(patterns, normalised) {
  return patterns.some((re) => re.test(normalised));
}

/**
 * Classify a learner message before it reaches the model.
 *
 * @param {string} text
 * @return {{action: 'allow'|'respond', category?: string, reply?: string}}
 *   `respond` means: do not call the model, return `reply` verbatim.
 */
function screenLearnerMessage(text) {
  const normalised = normalise(text);
  if (!normalised) return {action: "allow"};

  // Distress is checked FIRST. A message can be both ("don't tell my mum, he
  // hurts me") and the distress response is the one that must win — it is the
  // one that names help.
  if (matchesAny(DISTRESS_PATTERNS, normalised)) {
    return {action: "respond", category: "distress", reply: DISTRESS_REPLY};
  }
  if (matchesAny(SECRECY_PATTERNS, normalised)) {
    return {action: "respond", category: "secrecy", reply: SECRECY_REPLY};
  }
  return {action: "allow"};
}

/**
 * Strip contact details from a copy of the text destined for logs.
 * The model still receives the original — see the header.
 */
function redactForLogs(text) {
  let out = String(text || "");
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

module.exports = {
  HELPLINE,
  DISTRESS_REPLY,
  SECRECY_REPLY,
  DISTRESS_PATTERNS,
  SECRECY_PATTERNS,
  normalise,
  screenLearnerMessage,
  redactForLogs,
};
