/**
 * Pure decision core for the LIVE learner-vs-learner challenge (PROMPT 9).
 *
 * No Firebase imports — tests under plain `node` (the *Core.js pattern,
 * same as metaWhatsAppCore.js). The Firestore trigger and callable in
 * duel/index.js call into these; every ranked/awarded value is decided
 * here and written server-side, never accepted from a client.
 *
 * Compliance constraints baked into the shapes (Play Families):
 * - A match carries first name / nickname + avatar ONLY — no email, no
 *   uid-derived handle, nothing a child could be contacted through.
 * - There is no message field anywhere in the model, and settle() never
 *   copies client text into the match doc.
 */

"use strict";

/** How long a queue entry may wait before it is considered stale. */
const QUEUE_TTL_MS = 2 * 60 * 1000;

/** Answers must arrive within this window of the match starting. */
const MATCH_TTL_MS = 10 * 60 * 1000;

/**
 * Pick an opponent from the waiting queue for a new entry.
 *
 * Rules: same grade, not yourself, oldest first, and never an entry stale
 * enough that its player has probably left (TTL) — pairing a live child
 * with a ghost gives them a race the opponent never runs.
 *
 * @param {Array<{uid:string, grade:number, createdAtMs:number}>} waiting
 * @param {{uid:string, grade:number}} incoming
 * @param {number} nowMs
 * @return {{uid:string}|null} the chosen opponent, or null to keep waiting
 */
function pickOpponent(waiting, incoming, nowMs) {
  const grade = Number(incoming.grade);
  if (!Number.isFinite(grade)) return null;
  const live = (waiting || [])
    .filter((w) => w && w.uid && w.uid !== incoming.uid)
    .filter((w) => Number(w.grade) === grade)
    .filter((w) => nowMs - (Number(w.createdAtMs) || 0) <= QUEUE_TTL_MS)
    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  return live.length ? { uid: live[0].uid } : null;
}

/**
 * Deterministically draw the shared question set from a game's bank.
 *
 * Both players MUST get the same questions in the same order — that is
 * the fairness the VS screen promises — so the draw is seeded by the
 * match id, not Math.random().
 *
 * @param {Array<object>} bank   the game's question objects
 * @param {string} seed          the match id
 * @param {number} count
 * @return {Array<object>} the drawn questions (references, not copies)
 */
function drawQuestions(bank, seed, count = 5) {
  const list = Array.isArray(bank) ? bank.filter(Boolean) : [];
  if (list.length <= count) return list.slice();
  // Small deterministic PRNG (mulberry32) seeded from the match id.
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = (h ^= h >>> 16) >>> 0;
    return h / 4294967296;
  };
  const pool = list.slice();
  const drawn = [];
  while (drawn.length < count && pool.length) {
    drawn.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return drawn;
}

/**
 * Index of the correct option for a bank question. The games bank stores
 * `answer` as the answer STRING ('42'), compared loosely against options
 * — this mirrors the client's canonical `correctIndexFor`
 * (src/features/games/lib/timedQuizCore.js) exactly, because grading
 * against a different comparison than the one the runner renders with
 * would mark honest answers wrong. An integer `answer` is accepted as an
 * index for banks that store it that way. -1 when nothing matches.
 */
function correctIndexOf(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const answer = question?.answer;
  if (Number.isInteger(answer)) return answer >= 0 && answer < options.length ? answer : -1;
  return options.findIndex((o) => String(o) === String(answer));
}

/**
 * Grade a submitted answer sheet against the bank — the server's copy,
 * never the client's. A submission is an array of option indexes (or
 * null for unanswered), positional against the match's question order.
 *
 * @param {Array<object>} questions  the match's drawn questions
 * @param {Array<number|null>} submitted
 * @return {{correct:number, total:number, score:number}}
 */
function gradeSubmission(questions, submitted) {
  const qs = Array.isArray(questions) ? questions : [];
  const subs = Array.isArray(submitted) ? submitted : [];
  let correct = 0;
  qs.forEach((q, i) => {
    const want = correctIndexOf(q);
    if (want >= 0 && subs[i] === want) correct += 1;
  });
  // 10 points per correct answer — mirrors the timed-quiz scale the
  // leaderboard already speaks.
  return { correct, total: qs.length, score: correct * 10 };
}

/**
 * Decide the match outcome once a player's graded score lands.
 *
 * Returns the patch to apply to the match doc. The match settles when
 * both players have a score; equal scores draw. A finished or expired
 * match refuses further submissions.
 *
 * @param {{state:string, players:string[], scores:object, startedAtMs:number}} match
 * @param {string} uid
 * @param {number} score  the SERVER-graded score for uid
 * @param {number} nowMs
 * @return {{ok:true, patch:object}|{ok:false, reason:string}}
 */
function settleMatch(match, uid, score, nowMs) {
  if (!match || match.state === "done") return { ok: false, reason: "match_done" };
  if (!Array.isArray(match.players) || !match.players.includes(uid)) {
    return { ok: false, reason: "not_a_player" };
  }
  if (nowMs - (Number(match.startedAtMs) || 0) > MATCH_TTL_MS) {
    return { ok: false, reason: "match_expired" };
  }
  const scores = { ...(match.scores || {}) };
  if (Number.isFinite(scores[uid])) return { ok: false, reason: "already_submitted" };
  scores[uid] = score;

  const [a, b] = match.players;
  const bothIn = Number.isFinite(scores[a]) && Number.isFinite(scores[b]);
  const patch = { scores };
  if (bothIn) {
    patch.state = "done";
    patch.winner = scores[a] === scores[b] ? null : (scores[a] > scores[b] ? a : b);
    patch.draw = scores[a] === scores[b];
  }
  return { ok: true, patch };
}

module.exports = {
  QUEUE_TTL_MS,
  correctIndexOf,
  MATCH_TTL_MS,
  pickOpponent,
  drawQuestions,
  gradeSubmission,
  settleMatch,
};
