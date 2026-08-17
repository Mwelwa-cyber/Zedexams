"use strict";

/**
 * parentAppCore — the pure decisions behind the parent app (PROMPT 8g).
 *
 * Firestore, email and auth live in index.js. Everything here is a
 * function of its arguments, so the parts a parent would actually
 * dispute — which day an activity happened on, whether their child is
 * "on track", what the weekly report claims went well — are testable as
 * arithmetic rather than as a sequence of emulator writes. The `*Core.js`
 * split is the repo's usual one.
 *
 * ── One rule runs through all of it: never invent a number ──────────
 *
 * The prototype shows "3h 20m this week" and "68% exam ready". ZedExams
 * measures neither: there is no time-on-task instrumentation, and there
 * is no validated model that turns progress into a readiness percentage.
 * The Guardian Zone already faced this and left the tile out (see
 * GuardianZonePage.jsx), and this module follows that ruling — a missing
 * figure is omitted, never substituted. A parent who checks one number
 * against the app and finds it invented will not believe the next one,
 * and the next one is the one telling them their child needs help.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Zambia is UTC+2 year round — no DST, so a fixed offset is exact. */
const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * How quiet is too quiet. A child who has practised in the last two days
 * is on track; beyond a week they are quiet enough that the parent's
 * dashboard should say so rather than showing a stale streak.
 */
const NUDGE_AFTER_DAYS = 3;
const QUIET_AFTER_DAYS = 7;

/* ── Time ──────────────────────────────────────────────────────────── */

/** Millisecond value of a Timestamp, Date, ISO string or number; null if unreadable. */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The local calendar day a moment falls on, as `YYYY-MM-DD`.
 *
 * Shifting by the offset and then reading the UTC parts is deliberate:
 * `toLocaleDateString` would read the SERVER's zone, and a Cloud Function
 * runs in UTC. Without this, everything a child did after 22:00 Lusaka
 * would be filed under tomorrow — so the parent's "Today" would list
 * work done the previous evening, on exactly the evenings a parent is
 * most likely to be looking.
 */
function dayKey(ms, offsetMs = LUSAKA_OFFSET_MS) {
  const d = new Date(ms + offsetMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The heading one day of the timeline gets: "Today", "Yesterday", or
 * "Mon 14 Oct". Relative labels are computed from the same day keys the
 * items were bucketed with, so the heading and the contents can never
 * disagree about which day it is.
 */
function dayLabel(key, nowMs, offsetMs = LUSAKA_OFFSET_MS) {
  const today = dayKey(nowMs, offsetMs);
  if (key === today) return "Today";
  if (key === dayKey(nowMs - ONE_DAY_MS, offsetMs)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[at.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** Local clock time of a moment, `HH:MM`, for a timeline row. */
function clockTime(ms, offsetMs = LUSAKA_OFFSET_MS) {
  const d = new Date(ms + offsetMs);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/* ── The activity timeline ─────────────────────────────────────────── */

/**
 * Group a child's activity into the day-grouped feed the prototype's
 * "See all" screen renders.
 *
 * @param {Array<object>} items  `{ type, title, at, icon?, score?, subjectLabel?, highlight? }`
 * @param {object} opts
 * @param {number} opts.now      reference moment (ms)
 * @param {number} [opts.days]   how far back to include (default 7)
 * @param {number} [opts.limit]  hard cap on rows, newest first
 * @param {number} [opts.offsetMs]
 * @returns {Array<{key:string,label:string,items:Array<object>}>} newest day first
 *
 * Items with no readable time are DROPPED rather than bucketed under
 * today: a row whose time we do not know is a row we cannot place, and
 * placing it anyway is how "your child studied on Sunday" becomes a
 * claim nobody can check.
 */
function groupActivityByDay(items, {now, days = 7, limit = 200, offsetMs = LUSAKA_OFFSET_MS} = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const floor = nowMs - days * ONE_DAY_MS;

  const rows = (Array.isArray(items) ? items : [])
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const at = toMillis(item.at);
        if (at == null || at < floor || at > nowMs + ONE_DAY_MS) return null;
        return {...item, at};
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);

  const byDay = new Map();
  for (const row of rows) {
    const key = dayKey(row.at, offsetMs);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({...row, time: clockTime(row.at, offsetMs)});
  }

  return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, dayItems]) => ({key, label: dayLabel(key, nowMs, offsetMs), items: dayItems}));
}

/* ── Is this child on track? ───────────────────────────────────────── */

/**
 * The status pill on a child card: `on_track` | `needs_nudge` | `quiet` |
 * `not_started`.
 *
 * It keys off WHEN the child last did something, not off how well they
 * did it. A parent glancing at the list wants to know who has stopped —
 * a child scoring 40% every day is not the one who needs chasing, and
 * marking them "needs a nudge" for it would be the app editorialising
 * about ability rather than reporting activity.
 */
function childStatus({lastActiveAt, now} = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const last = toMillis(lastActiveAt);
  if (last == null) return "not_started";
  const days = (nowMs - last) / ONE_DAY_MS;
  if (days < NUDGE_AFTER_DAYS) return "on_track";
  if (days < QUIET_AFTER_DAYS) return "needs_nudge";
  return "quiet";
}

/** The words that go on the pill. */
function describeStatus(status) {
  switch (status) {
    case "on_track": return "On track";
    case "needs_nudge": return "Needs a nudge";
    case "quiet": return "Not been on lately";
    default: return "Not started yet";
  }
}

/* ── The approval feed ─────────────────────────────────────────────── */

/**
 * Shape the "Needs your approval" feed from stored guardian requests.
 *
 * @param {Array<object>} requests  guardianRequests docs, each with `{id, uid,
 *   feature, status, createdAt, expiresAt, planId, priceZMW}`
 * @param {Map<string,object>|object} children  childUid → `{displayName, ...}`
 * @param {number} now
 *
 * Only `sent` requests for a child the caller is actually linked to
 * survive, and expired ones are dropped: an approval button for a
 * request whose pay link has died is a button that fails after the
 * parent has already decided to say yes.
 */
function shapeApprovalFeed(requests, children, now = Date.now()) {
  const lookup = children instanceof Map ? children : new Map(Object.entries(children || {}));
  return (Array.isArray(requests) ? requests : [])
      .map((req) => {
        if (!req || typeof req !== "object") return null;
        const child = lookup.get(req.uid);
        if (!child) return null;
        if (req.status !== "sent") return null;
        const expiresAt = toMillis(req.expiresAt);
        if (expiresAt != null && expiresAt <= now) return null;
        const createdAt = toMillis(req.createdAt);
        return {
          id: req.id,
          kind: "premium_unlock",
          childUid: req.uid,
          childName: child.displayName || "your child",
          feature: typeof req.feature === "string" ? req.feature : null,
          planId: typeof req.planId === "string" ? req.planId : null,
          priceZMW: Number.isFinite(Number(req.priceZMW)) ? Number(req.priceZMW) : null,
          createdAt,
          expiresAt,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ── The weekly report ─────────────────────────────────────────────── */

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free English list. */
function joinWords(parts) {
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Build the weekly progress report — the three paragraphs the Reports
 * screen and the Sunday email both render.
 *
 * @param {object} input
 * @param {string} input.childName
 * @param {number} input.quizzes            completed in the window
 * @param {number} input.notes              notes/lessons finished in the window
 * @param {number} [input.streak]           current streak in days
 * @param {number} [input.averageScore]     0–100 across the window, or null
 * @param {Array<object>} [input.strongest]  `[{label, percent}]`
 * @param {Array<object>} [input.weakTopics] `[{topic, subjectLabel}]`
 * @param {number|null} [input.daysToExam]
 * @returns {{headline, wentWell, focusOn, suggestion, quiet}}
 *
 * `quiet` is true when there is nothing to report. The caller uses it to
 * SUPPRESS the Sunday email rather than to send a cheerful message about
 * a week in which nothing happened — the existing weeklyParentDigest
 * makes the same choice for the same reason.
 */
function buildWeeklyReport({
  childName,
  quizzes = 0,
  notes = 0,
  streak = 0,
  averageScore = null,
  strongest = [],
  weakTopics = [],
  daysToExam = null,
} = {}) {
  const name = String(childName || "").trim() || "Your child";
  const quiet = quizzes === 0 && notes === 0;

  const headline = quiet ?
    "A quiet week" :
    quizzes >= 5 || notes >= 3 ? "A strong week! 🎉" : "Steady progress";

  // Built as a list and joined with a real "and", because these
  // paragraphs are read by a parent, not parsed by anything.
  const did = [];
  if (quizzes > 0) did.push(plural(quizzes, "quiz", "quizzes"));
  if (notes > 0) did.push(plural(notes, "topic", "topics"));
  const sentences = [];
  if (did.length > 0) sentences.push(`${name} finished ${joinWords(did)}.`);
  if (streak > 0) sentences.push(`They kept a ${plural(streak, "day", "days")} streak going.`);
  const best = strongest.find((s) => s && Number.isFinite(Number(s.percent)) && s.label);
  if (best) sentences.push(`${best.label} is their strongest subject at ${Math.round(best.percent)}%.`);

  const wentWell = quiet ?
    `${name} did not practise this week. One short session is usually enough to start it moving again.` :
    sentences.join(" ");

  // Only real weak topics — a fabricated "focus area" sends a parent to
  // sit their child down over something the app never actually measured.
  const named = weakTopics
      .filter((w) => w && typeof w.topic === "string" && w.topic.trim())
      .slice(0, 3)
      .map((w) => (w.subjectLabel ? `${w.topic} (${w.subjectLabel})` : w.topic));

  const focusOn = named.length > 0 ?
    `${named.join(", ")} came up as the weakest ${named.length === 1 ? "spot" : "spots"} in recent quizzes and papers.` :
    averageScore != null ?
      `Nothing stands out as a weak spot yet — ${name} is averaging ${Math.round(averageScore)}% across this week's questions.` :
      `Not enough questions answered yet to say where ${name} needs help. A few more quizzes and this section fills in.`;

  const suggestionParts = [];
  if (Number.isFinite(daysToExam) && daysToExam > 0) {
    suggestionParts.push(`Exams are ${plural(Math.round(daysToExam), "day", "days")} away.`);
  }
  if (named.length > 0) {
    suggestionParts.push(`A few minutes a day on ${named[0]} would make the most difference.`);
  } else if (quiet) {
    suggestionParts.push(`Ask ${name} to try one daily quiz — it takes about five minutes.`);
  } else {
    suggestionParts.push(`Keeping the daily quiz going is the single most useful habit.`);
  }

  return {headline, wentWell, focusOn, suggestion: suggestionParts.join(" "), quiet};
}

/**
 * The Sunday email's body.
 *
 * It lives here, beside `buildWeeklyReport`, so the email and the
 * Reports screen are provably the same words about the same week — and
 * so it can be tested under plain node, which the cron module (which
 * loads firebase-functions at import) cannot be.
 *
 * It names what the report is built from. A parent who wants to check a
 * claim should be able to see where it came from rather than being
 * asked to trust a summary.
 */
function buildReportEmail({childName, report, quizzes = 0, notes = 0} = {}) {
  const name = String(childName || "").trim() || "your child";
  const subject = `${name}'s week on ZedExams`;
  const activity = [
    quizzes ? plural(quizzes, "quiz", "quizzes") : null,
    notes ? `${plural(notes, "topic", "topics")} read` : null,
  ].filter(Boolean).join(" · ");

  const text = [
    report.headline,
    activity ? `${name} · the last 7 days · ${activity}` : `${name} · the last 7 days`,
    ``,
    `WHAT WENT WELL`,
    report.wentWell,
    ``,
    `WHERE TO FOCUS`,
    report.focusOn,
    ``,
    `WHAT TO TRY NEXT`,
    report.suggestion,
    ``,
    `See the full picture, and change what ${name} can use:`,
    `https://zedexams.com/family`,
    ``,
    `This report is built from ${name}'s own quizzes, topics and past`,
    `papers. We do not measure time spent in the app, so it never claims`,
    `a figure for that.`,
    ``,
    `To stop these emails: zedexams.com/settings → Notifications.`,
    ``,
    `— ZedExams`,
  ].join("\n");

  return {subject, text};
}

module.exports = {
  LUSAKA_OFFSET_MS,
  buildReportEmail,
  NUDGE_AFTER_DAYS,
  ONE_DAY_MS,
  QUIET_AFTER_DAYS,
  buildWeeklyReport,
  childStatus,
  clockTime,
  dayKey,
  dayLabel,
  describeStatus,
  groupActivityByDay,
  shapeApprovalFeed,
  toMillis,
};
