/**
 * functions/dailyQuiz/dailyQuizCore.js
 *
 * The Daily Quiz selection rules, pure. The `*Core.js` split (see
 * metaWhatsAppCore.js / dailyExamPickerCore.js): no firebase-admin or
 * firebase-functions import, so plain-node tests load it under root deps.
 *
 * ── Why the pick is SEEDED rather than random ─────────────────────────
 *
 * Two callers build the day's quiz — the nightly cron and the lazy
 * self-heal that fires when a learner opens the app and finds no document.
 * If they picked randomly they would pick differently, and two learners in
 * the same grade would sit different quizzes on a board that ranks them
 * against each other. Worse, the failure is invisible: nothing errors, the
 * numbers just stop meaning anything.
 *
 * So every random choice comes from a PRNG seeded with `hash(grade|date)`.
 * Generation is then IDEMPOTENT by construction: cron, self-heal, a race
 * between two simultaneous self-heals, or a re-run days later all produce
 * the identical five questions. That is what lets section 3's cron be an
 * optimisation rather than a dependency — and it is why there is no
 * "two learners triggered it and got different quizzes" bug to have.
 *
 * ── Everyone in a grade gets the SAME five ───────────────────────────
 *
 * Not a limitation — the point. A personalised daily quiz cannot be ranked:
 * you would be comparing a child who drew easy questions with one who drew
 * hard ones. Personalisation belongs in Quizzes and Practice, which are
 * already adaptive. The one personalised set this module produces is the
 * §5 practice fallback, and that one is explicitly `ranked: false`.
 */

/**
 * The grades the daily quiz serves.
 *
 * The SERVER TWIN of `LEARNER_GRADES` in src/config/curriculum.js —
 * `test:learner-grades` fails if the two drift. Both directions are bad and
 * neither raises an error anywhere: a grade here but not there gets a quiz
 * built for nobody every night and pages ops hourly about a gap no learner
 * is waiting on; a grade there but not here opens to learners with no quiz.
 *
 * It lives in the CORE rather than beside the Cloud Functions because the
 * mirror test and Vigil both read it under plain node, where
 * firebase-functions is not installed.
 *
 * Grades 4-6 are authored for but not yet open to learners — see the staged
 * rollout note on LEARNER_GRADES.
 */
const DAILY_QUIZ_GRADES = Object.freeze(["7"]);

/** Five questions. The number is a product decision, not a tunable. */
const DAILY_QUIZ_QUESTION_COUNT = 5;

/**
 * 2 easy · 2 medium · 1 hard — so every child gets something they can do
 * and nobody coasts. Order matters: the ladder below fills scarce tiers
 * first, so a thin `hard` pool cannot eat the easy slots.
 */
const DIFFICULTY_MIX = Object.freeze({easy: 2, medium: 2, hard: 1});

/** Tier fill order: rarest tier first, so scarcity is absorbed by the mix. */
const DIFFICULTY_ORDER = Object.freeze(["hard", "medium", "easy"]);

/**
 * Maths and English appear every day; the remaining three slots rotate
 * through whatever other subjects the grade's pool actually contains.
 *
 * Hard-coding only the two dailies (and deriving the rotation from the pool)
 * means a grade with no Social Studies content yet produces a quiz from the
 * subjects it does have, instead of reserving a slot for a subject that
 * cannot fill it.
 */
const DAILY_SUBJECTS = Object.freeze(["Mathematics", "English"]);

/** How far back a question is considered "recently served". */
const FRESHNESS_WINDOW_DAYS = 30;

/**
 * The relaxation ladder, applied in REVERSE order of importance when the
 * pool cannot satisfy every rule. Recorded on the doc as `rulesRelaxed` so
 * the admin console can say which rule bent, rather than the quiz quietly
 * being less good than it claims.
 *
 * Difficulty bends first (a learner cannot tell that today's "hard" slot was
 * filled by a medium question); subject rotation second; freshness LAST,
 * because repeating a question the learner saw last week is the most
 * visible failure of the three.
 */
const RELAXATION_ORDER = Object.freeze(["difficulty", "subject", "freshness"]);

const VALID_DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);

/**
 * Canonical subject labels. The bank stores whatever the capturing surface
 * put in `meta.subject` — sometimes the curriculum id (`mathematics`),
 * sometimes the label (`Mathematics`), sometimes a slug (`social-studies`).
 * Matching those as raw strings would split one subject into three pools and
 * silently defeat the spread rule, so everything is normalised here first.
 *
 * Mirrors the labels in src/config/curriculum.js#SUBJECTS.
 */
const SUBJECT_ALIASES = Object.freeze({
  english: "English",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  science: "Integrated Science",
  integrated_science: "Integrated Science",
  "integrated-science": "Integrated Science",
  integratedscience: "Integrated Science",
  social_studies: "Social Studies",
  "social-studies": "Social Studies",
  socialstudies: "Social Studies",
  social: "Social Studies",
  cts: "Creative and Technology Studies",
  creative_and_technology_studies: "Creative and Technology Studies",
  "creative-and-technology-studies": "Creative and Technology Studies",
  zambian_languages: "Zambian Languages",
  "zambian-languages": "Zambian Languages",
  home_economics: "Home Economics",
  "home-economics": "Home Economics",
});

/**
 * Normalise a stored subject to its canonical label. An unrecognised value
 * is title-cased and kept rather than dropped — an unknown subject is still
 * a real pool, and discarding it would shrink the quiz for no reason.
 */
function normalizeSubject(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  if (SUBJECT_ALIASES[key]) return SUBJECT_ALIASES[key];
  const dashed = raw.toLowerCase().replace(/[\s_]+/g, "-");
  if (SUBJECT_ALIASES[dashed]) return SUBJECT_ALIASES[dashed];
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Normalise a stored difficulty. Anything unrecognised — including the
 * empty string the bank writes when the capturing surface had no difficulty
 * — reads as `medium`, the tier that can substitute in either direction.
 * Dropping untagged questions instead would discard most of the bank.
 */
function normalizeDifficulty(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (VALID_DIFFICULTIES.includes(raw)) return raw;
  if (raw === "simple" || raw === "low") return "easy";
  if (raw === "challenging" || raw === "high" || raw === "difficult") return "hard";
  return "medium";
}

/** FNV-1a, 32-bit. Deterministic across processes and Node versions. */
function hashString(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The day's seed. Written into the document so a past quiz can be explained
 * ("why these five?") long after the pool that produced it has changed.
 */
function seedFor(grade, date) {
  return hashString(`${String(grade)}|${String(date)}`);
}

/** The seed as the short hex string the console and the doc display. */
function seedHex(seed) {
  return (seed >>> 0).toString(16).padStart(8, "0");
}

/** mulberry32 — small, fast, and stable for a fixed seed. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates against a seeded RNG. Copies rather than sorting in place, so
 * a caller's pool is never reordered under it.
 *
 * The input is sorted by id first. Firestore returns documents in whatever
 * order the query produced, and shuffling an unstable order with a stable
 * seed still gives an unstable result — the seed only fixes the permutation,
 * not what it is applied to. Sorting first is what makes the seed mean
 * anything.
 */
function seededShuffle(items, rng) {
  const out = [...items].sort((a, b) =>
    String(a?.id ?? "").localeCompare(String(b?.id ?? "")));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Days between two YYYY-MM-DD keys (a - b). Calendar days, no clock. */
function daysBetween(a, b) {
  const toInt = (k) => {
    const [y, m, d] = String(k).split("-").map(Number);
    if (!y || !m || !d) return NaN;
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  const ai = toInt(a);
  const bi = toInt(b);
  if (Number.isNaN(ai) || Number.isNaN(bi)) return Number.POSITIVE_INFINITY;
  return ai - bi;
}

/** Weekday index for a YYYY-MM-DD key (0 = Sunday). Used by the rotation. */
function weekdayIndex(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Normalise one bank row into the shape the selector works with.
 *
 * Returns null for a row that cannot be used — no id, or no subject. Both
 * are dropped rather than defaulted, because a question with no subject
 * cannot honour the spread rule and would quietly distort it.
 */
function normalizeCandidate(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const subject = normalizeSubject(row.subject);
  if (!subject) return null;
  return {
    id,
    subject,
    difficulty: normalizeDifficulty(row.difficulty),
    topic: String(row.topic ?? "").trim(),
    grade: String(row.grade ?? "").trim(),
  };
}

/**
 * The subjects filling today's five slots.
 *
 * Maths and English take a slot each every day. The other three rotate
 * through the remaining subjects present in the pool, offset by the weekday
 * so consecutive days differ, and wrapping when the grade has fewer than
 * three other subjects — a two-subject grade gets Maths, English and repeats
 * rather than a three-slot hole.
 *
 * `available` is sorted before the offset is applied, for the same reason
 * seededShuffle sorts: a rotation over an unstable list is not a rotation.
 */
function planSubjectSlots(date, availableSubjects, count = DAILY_QUIZ_QUESTION_COUNT) {
  const available = [...new Set(
    (availableSubjects || []).map(normalizeSubject).filter(Boolean),
  )].sort();
  if (!available.length) return [];

  const slots = [];
  // The two dailies, but only when the grade actually has them.
  for (const s of DAILY_SUBJECTS) {
    if (slots.length >= count) break;
    if (available.includes(s)) slots.push(s);
  }

  const others = available.filter((s) => !DAILY_SUBJECTS.includes(s));
  const rotationPool = others.length ? others : available;
  const offset = weekdayIndex(date);
  let i = 0;
  while (slots.length < count) {
    slots.push(rotationPool[(offset + i) % rotationPool.length]);
    i += 1;
    // A single-subject grade would otherwise repeat forever without this,
    // which is fine — the loop is bounded by `count` either way.
  }
  return slots;
}

/**
 * Turn the difficulty mix into a flat list of `count` tiers, rarest first.
 * `[hard, medium, medium, easy, easy]` for the default 2·2·1.
 */
function planDifficultySlots(count = DAILY_QUIZ_QUESTION_COUNT, mix = DIFFICULTY_MIX) {
  const slots = [];
  for (const tier of DIFFICULTY_ORDER) {
    for (let i = 0; i < (mix[tier] || 0); i += 1) slots.push(tier);
  }
  // A mix that does not add up to `count` is a config error, not a runtime
  // one — pad with medium rather than returning a short quiz.
  while (slots.length < count) slots.push("medium");
  return slots.slice(0, count);
}

/**
 * Which question ids this grade served in the freshness window.
 *
 * Takes the recent `dailyQuizzes` docs rather than a `lastServed` map on
 * each bank row: the docs are the record of what was actually served, they
 * are already written, and they cannot drift out of step with themselves.
 * A `lastServed` field would need maintaining on every question and would be
 * wrong the moment a doc was rebuilt.
 */
function recentlyServedIds(recentDocs, today, windowDays = FRESHNESS_WINDOW_DAYS) {
  const ids = new Set();
  for (const d of recentDocs || []) {
    const date = d?.date;
    if (!date) continue;
    const age = daysBetween(today, date);
    if (!Number.isFinite(age) || age < 0 || age > windowDays) continue;
    for (const qid of d.questionIds || []) ids.add(String(qid));
  }
  return ids;
}

/**
 * Pick the five.
 *
 * The selector walks the five slots in order, and for each one takes the
 * first candidate from a seeded shuffle that satisfies the currently-active
 * rules. When a slot cannot be filled it relaxes ONE rung of the ladder and
 * retries the whole plan — retrying the whole plan rather than just the
 * failed slot, so the result stays a pure function of (pool, grade, date)
 * and not of the order slots happened to fail in.
 *
 * @param {object}   args
 * @param {Array}    args.pool          bank rows for this grade (approved only —
 *                                      the caller is responsible for that filter,
 *                                      because it is a query, not a rule)
 * @param {string|number} args.grade
 * @param {string}   args.date          YYYY-MM-DD (Lusaka)
 * @param {Array}    [args.recentDocs]  recent dailyQuizzes docs for freshness
 * @param {number}   [args.count]
 * @returns {{questionIds: string[], picked: object[], rulesRelaxed: string[],
 *            status: 'ok'|'thin', seed: number, subjects: string[]}}
 */
function selectQuestions({pool, grade, date, recentDocs = [], count = DAILY_QUIZ_QUESTION_COUNT}) {
  const seed = seedFor(grade, date);
  const candidates = (pool || []).map(normalizeCandidate).filter(Boolean);
  const stale = recentlyServedIds(recentDocs, date);

  const subjects = [...new Set(candidates.map((c) => c.subject))];
  const subjectSlots = planSubjectSlots(date, subjects, count);
  const difficultySlots = planDifficultySlots(count);

  // Try the full ruleset, then relax one rung at a time. `relaxUpTo` is how
  // many rungs of RELAXATION_ORDER are currently switched off.
  for (let relaxUpTo = 0; relaxUpTo <= RELAXATION_ORDER.length; relaxUpTo += 1) {
    const relaxed = RELAXATION_ORDER.slice(0, relaxUpTo);
    const ignoreDifficulty = relaxed.includes("difficulty");
    const ignoreSubject = relaxed.includes("subject");
    const ignoreFreshness = relaxed.includes("freshness");

    // One shuffle per attempt, from the same seed, so the attempt that
    // succeeds is reproducible on its own.
    const shuffled = seededShuffle(candidates, makeRng(seed));
    const used = new Set();
    const picked = [];

    for (let slot = 0; slot < count; slot += 1) {
      const wantSubject = subjectSlots[slot];
      const wantDifficulty = difficultySlots[slot];
      const hit = shuffled.find((c) => {
        if (used.has(c.id)) return false;
        if (!ignoreFreshness && stale.has(c.id)) return false;
        if (!ignoreSubject && wantSubject && c.subject !== wantSubject) return false;
        if (!ignoreDifficulty && c.difficulty !== wantDifficulty) return false;
        return true;
      });
      if (!hit) break;
      used.add(hit.id);
      picked.push(hit);
    }

    if (picked.length === count) {
      return {
        seed,
        questionIds: picked.map((p) => p.id),
        picked,
        subjects: picked.map((p) => p.subject),
        rulesRelaxed: relaxed,
        status: "ok",
      };
    }
  }

  // Every rung relaxed and still short: the pool genuinely cannot yield five.
  // That is `thin`, and it is the ONLY honest reason a learner sees no ranked
  // quiz — section 5 turns it into a labelled practice set, never a dead end.
  const shuffled = seededShuffle(candidates, makeRng(seed));
  const picked = shuffled.slice(0, count);
  return {
    seed,
    questionIds: picked.map((p) => p.id),
    picked,
    subjects: picked.map((p) => p.subject),
    rulesRelaxed: [...RELAXATION_ORDER],
    status: "thin",
  };
}

/**
 * The document `buildDailyQuiz` writes. Split out from the builder so the
 * shape is testable without Firestore, and so the cron, the self-heal and an
 * admin rebuild cannot each write a slightly different one.
 */
function buildQuizDoc({grade, date, selection, createdBy, term = null, week = null}) {
  return {
    grade: String(grade),
    date: String(date),
    questionIds: selection.questionIds,
    subjects: selection.subjects,
    term,
    week,
    seed: seedHex(selection.seed),
    rulesRelaxed: selection.rulesRelaxed,
    status: selection.status,
    createdBy,
  };
}

/**
 * Points for a marked attempt. 10 a correct answer, +10 for all five.
 *
 * `voided` questions are credited to everyone (section 6): once a child has
 * answered, a wrong question cannot be edited without making the board
 * unfair, so it is removed and paid out instead. Fair beats perfect.
 */
const POINTS_PER_CORRECT = 10;
const ALL_CORRECT_BONUS = 10;

function scoreAttempt({marks, voidedCount = 0, count = DAILY_QUIZ_QUESTION_COUNT}) {
  const correct = (marks || []).filter(Boolean).length;
  const credited = correct + Math.max(0, voidedCount);
  const capped = Math.min(credited, count);
  const bonus = capped >= count ? ALL_CORRECT_BONUS : 0;
  return {
    correct,
    credited: capped,
    points: capped * POINTS_PER_CORRECT + bonus,
    allCorrect: capped >= count,
  };
}

/**
 * Whether an admin may still change tomorrow's quiz.
 *
 * Two independent locks, and both matter. The clock lock (23:00) gives the
 * content team a deadline they can plan around. The attempt lock is the real
 * guarantee: once ONE child has answered, changing a question would rank
 * learners against different quizzes, so the document is immutable whatever
 * the clock says.
 */
const SWAP_CUTOFF_HOUR = 23;

function canEditQuiz({quizDate, today, nowHour, hasAttempts}) {
  if (hasAttempts) return {allowed: false, reason: "attempts_exist"};
  if (String(quizDate) <= String(today)) return {allowed: false, reason: "not_future"};
  if (daysBetween(quizDate, today) === 1 && Number(nowHour) >= SWAP_CUTOFF_HOUR) {
    return {allowed: false, reason: "past_cutoff"};
  }
  return {allowed: true, reason: null};
}

/**
 * Days of runway for a grade: eligible questions ÷ 5.
 *
 * This is what prevents "no quiz today" rather than the self-heal — a dead
 * cron heals itself, but a starved bank cannot. Alerting at 30 days means
 * the content team hears about it weeks before a child ever sees an empty
 * card.
 */
const RUNWAY_ALERT_DAYS = 30;

function runwayFor(eligibleCount, count = DAILY_QUIZ_QUESTION_COUNT) {
  const n = Number(eligibleCount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n / count);
}

function runwayLevel(days) {
  if (days < RUNWAY_ALERT_DAYS) return "critical";
  if (days < RUNWAY_ALERT_DAYS * 2) return "warn";
  return "ok";
}

module.exports = {
  DAILY_QUIZ_GRADES,
  DAILY_QUIZ_QUESTION_COUNT,
  DIFFICULTY_MIX,
  DIFFICULTY_ORDER,
  DAILY_SUBJECTS,
  FRESHNESS_WINDOW_DAYS,
  RELAXATION_ORDER,
  POINTS_PER_CORRECT,
  ALL_CORRECT_BONUS,
  SWAP_CUTOFF_HOUR,
  RUNWAY_ALERT_DAYS,
  normalizeSubject,
  normalizeDifficulty,
  normalizeCandidate,
  hashString,
  seedFor,
  seedHex,
  makeRng,
  seededShuffle,
  daysBetween,
  weekdayIndex,
  planSubjectSlots,
  planDifficultySlots,
  recentlyServedIds,
  selectQuestions,
  buildQuizDoc,
  scoreAttempt,
  canEditQuiz,
  runwayFor,
  runwayLevel,
};
