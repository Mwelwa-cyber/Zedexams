/**
 * Node test for functions/weeklyParentDigestCore.js — the pure decision
 * logic behind the weekly parent digest. No firebase-admin /
 * firebase-functions / nodemailer dependency, so this runs under plain
 * `node` with no stubbing required (repo convention, same as
 * aiOperationsCore.test.js).
 *
 * Run: node functions/weeklyParentDigestCore.test.js
 */

const assert = require("node:assert");
const {
  ONE_DAY_MS,
  WINDOW_DAYS,
  MAX_SHARES_PER_RUN,
  RESEND_GUARD_MS,
  subjectLabel,
  buildEmailText,
  buildEmailHtml,
  lastSentMillis,
  shouldSkipResend,
  shareGateReason,
  shouldSkipEmptyWeek,
  deriveLearnerInfo,
  buildShareUrl,
  resolveSenderDomain,
  normalizeRunnerTargetTokens,
  normalizeRequestTargetTokens,
  createRunSummary,
  rollupStatus,
  buildEmailPayload,
  buildWhatsAppSummaryLine,
  buildWhatsAppContentVariables,
} = require("./weeklyParentDigestCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
function eq(name, actual, expected) {
  assert.strictEqual(actual, expected, `${name} — got ${JSON.stringify(actual)}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Fixed epoch instant so the tests never depend on the wall clock.
const NOW = 1750000000000;
const ts = (ms) => ({toMillis: () => ms});

// ── constants ───────────────────────────────────────────────────────────────
eq("ONE_DAY_MS is 24h", ONE_DAY_MS, 24 * 60 * 60 * 1000);
eq("WINDOW_DAYS is a 7-day week", WINDOW_DAYS, 7);
eq("MAX_SHARES_PER_RUN cap", MAX_SHARES_PER_RUN, 200);
eq("RESEND_GUARD_MS is 5 days", RESEND_GUARD_MS, 5 * ONE_DAY_MS);

// ── subjectLabel ────────────────────────────────────────────────────────────
eq("known slug maps to label", subjectLabel("mathematics"), "Maths");
eq("hyphenated slug maps", subjectLabel("home-economics"), "Home Ec.");
eq("unknown slug passes through", subjectLabel("civic-education"), "civic-education");
eq("empty slug → empty string", subjectLabel(""), "");
eq("null slug → empty string", subjectLabel(null), "");

// ── buildEmailText ──────────────────────────────────────────────────────────
const FULL_STATS = {
  summary: {totalAttempts: 4, averagePercentage: 78, currentStreak: 3},
  subjectBreakdown: [
    {subject: "mathematics", count: 3, averagePercentage: 80},
    {subject: "english", count: 1, averagePercentage: null},
  ],
  recentResults: [
    {quizTitle: "Fractions", subject: "mathematics", percentage: 75},
    {quizTitle: null, subject: "english", percentage: null},
    {quizTitle: null, subject: null, percentage: 90},
  ],
};
const SHARE_URL = "https://zedexams.com/parent/ABC123";

{
  const text = buildEmailText({
    learnerName: "Chanda",
    learnerGrade: "7",
    summary: FULL_STATS.summary,
    subjectBreakdown: FULL_STATS.subjectBreakdown,
    recentResults: FULL_STATS.recentResults,
    shareUrl: SHARE_URL,
  });
  ok("text names the learner and grade", text.includes("Here is Chanda's ZedExams week (Grade 7):"));
  ok("text counts quizzes", text.includes("• Quizzes done: 4"));
  ok("text shows average", text.includes("• Average score: 78%"));
  ok("text shows streak with flame", text.includes("• Day streak: 3 🔥"));
  ok("subject row shows count + avg", text.includes("· Maths: 3× quizzes — avg 80%"));
  ok("subject row omits missing avg", text.includes("· English: 1× quizzes") && !text.includes("English: 1× quizzes — avg"));
  ok("recent row uses quiz title", text.includes("· Fractions: 75%"));
  ok("recent row falls back to subject label", text.includes("· English: —"));
  ok("recent row falls back to 'Quiz'", text.includes("· Quiz: 90%"));
  // Compare the whole share line exactly (not a URL substring check): the
  // digest must carry this URL verbatim, nothing merely resembling it.
  ok("text carries the share URL",
      text.split("\n").some((line) => line === `Open the live progress page any time: ${SHARE_URL}`));
}

{
  const text = buildEmailText({
    learnerName: "Chanda",
    learnerGrade: null,
    summary: {totalAttempts: 0, averagePercentage: null, currentStreak: 0},
    subjectBreakdown: [],
    recentResults: [],
    shareUrl: SHARE_URL,
  });
  ok("empty week says so", text.includes("hasn't practised this week"));
  ok("empty week omits quiz count line", !text.includes("Quizzes done"));
  ok("no grade → no parenthetical", text.includes("Here is Chanda's ZedExams week:"));
}

{
  const text = buildEmailText({
    learnerName: "B",
    learnerGrade: null,
    summary: {totalAttempts: 2, averagePercentage: null, currentStreak: 0},
    subjectBreakdown: [],
    recentResults: [],
    shareUrl: SHARE_URL,
  });
  ok("null average omits the average line", !text.includes("Average score"));
  ok("zero streak has no flame", text.includes("• Day streak: 0\n"));
  ok("no subjects → no By subject header", !text.includes("By subject:"));
  ok("no results → no Recent quizzes header", !text.includes("Recent quizzes:"));
}

{
  const many = Array.from({length: 8}, (_, i) => ({quizTitle: `Q${i}`, percentage: 50}));
  const text = buildEmailText({
    learnerName: "B", learnerGrade: null,
    summary: {totalAttempts: 8, averagePercentage: 50, currentStreak: 1},
    subjectBreakdown: [], recentResults: many, shareUrl: SHARE_URL,
  });
  ok("recent quizzes capped at 5", text.includes("· Q4: 50%") && !text.includes("· Q5: 50%"));
}

// ── buildEmailHtml ──────────────────────────────────────────────────────────
{
  const html = buildEmailHtml({
    learnerName: "A & <B>",
    learnerGrade: "8 & \"9\"",
    summary: FULL_STATS.summary,
    subjectBreakdown: FULL_STATS.subjectBreakdown,
    recentResults: FULL_STATS.recentResults,
    shareUrl: "https://zedexams.com/parent/T'1",
  });
  ok("learner name is HTML-escaped", html.includes("A &amp; &lt;B&gt;'s week"));
  ok("grade is escaped", html.includes("Grade 8 &amp; &quot;9&quot;"));
  ok("share URL apostrophe escaped in href", html.includes("href=\"https://zedexams.com/parent/T&#39;1\""));
  ok("activity table shows attempt count", html.includes(">4</td>"));
  ok("average row present when set", html.includes("Average score"));
  ok("subject section rendered", html.includes("By subject"));
  ok("recent section rendered", html.includes("Recent quizzes"));
  ok("no-activity copy absent on a full week", !html.includes("hasn't practised this week"));
}

{
  const html = buildEmailHtml({
    learnerName: "Chanda",
    learnerGrade: null,
    summary: {totalAttempts: 0, averagePercentage: null, currentStreak: 0},
    subjectBreakdown: [],
    recentResults: [],
    shareUrl: SHARE_URL,
  });
  ok("no-activity block renders", html.includes("hasn't practised this week"));
  ok("no grade → no Grade prefix", !html.includes("Grade "));
  ok("empty week has no subject section", !html.includes("By subject"));
}

{
  const html = buildEmailHtml({
    learnerName: "B",
    learnerGrade: null,
    summary: {totalAttempts: 1, averagePercentage: null, currentStreak: 0},
    subjectBreakdown: [],
    recentResults: [],
    shareUrl: SHARE_URL,
  });
  ok("null average omits the average row", !html.includes("Average score"));
}

// ── lastSentMillis ──────────────────────────────────────────────────────────
eq("timestamp field → millis", lastSentMillis(ts(123456)), 123456);
eq("missing field → 0", lastSentMillis(undefined), 0);
eq("null field → 0", lastSentMillis(null), 0);
eq("plain object without toMillis → 0", lastSentMillis({seconds: 1}), 0);

// ── shouldSkipResend ────────────────────────────────────────────────────────
ok("recent send inside guard skips", shouldSkipResend({lastSentMs: NOW - ONE_DAY_MS, now: NOW}));
ok("send just inside 5 days skips", shouldSkipResend({lastSentMs: NOW - RESEND_GUARD_MS + 1, now: NOW}));
ok("send exactly 5 days ago does not skip", !shouldSkipResend({lastSentMs: NOW - RESEND_GUARD_MS, now: NOW}));
ok("never sent (0) does not skip", !shouldSkipResend({lastSentMs: 0, now: NOW}));
ok("force bypasses the guard", !shouldSkipResend({lastSentMs: NOW - ONE_DAY_MS, now: NOW, force: true}));

// ── shareGateReason ─────────────────────────────────────────────────────────
eq("revoked share is gated", shareGateReason({revokedAt: ts(NOW - 1), parentEmail: "x"}, NOW), "revoked");
eq("expired share is gated", shareGateReason({expiresAt: ts(NOW - 1), parentEmail: "x"}, NOW), "expired");
eq("expiry exactly now is NOT expired", shareGateReason({expiresAt: ts(NOW), parentEmail: "x"}, NOW), null);
eq("future expiry passes", shareGateReason({expiresAt: ts(NOW + ONE_DAY_MS), parentEmail: "x"}, NOW), null);
eq("no contact at all is gated", shareGateReason({}, NOW), "no-contact");
eq("phone-only share passes", shareGateReason({parentPhone: "+260971234567"}, NOW), null);
eq("email-only share passes", shareGateReason({parentEmail: "x"}, NOW), null);
eq("revoked wins over expired", shareGateReason({revokedAt: ts(1), expiresAt: ts(NOW - 1)}, NOW), "revoked");

// ── shouldSkipEmptyWeek ─────────────────────────────────────────────────────
ok("no attempts → skip", shouldSkipEmptyWeek({summary: {totalAttempts: 0}}));
ok("no attempts + force → send anyway", !shouldSkipEmptyWeek({summary: {totalAttempts: 0}}, true));
ok("one attempt → send", !shouldSkipEmptyWeek({summary: {totalAttempts: 1}}));

// ── deriveLearnerInfo ───────────────────────────────────────────────────────
{
  const info = deriveLearnerInfo({displayName: "Mutale", grade: 9});
  eq("display name kept", info.learnerName, "Mutale");
  eq("numeric grade stringified", info.learnerGrade, "9");
}
{
  const info = deriveLearnerInfo({});
  eq("missing name → generic", info.learnerName, "your learner");
  eq("missing grade → null", info.learnerGrade, null);
}

// ── buildShareUrl / resolveSenderDomain ─────────────────────────────────────
eq("share URL from token", buildShareUrl("ABC123"), "https://zedexams.com/parent/ABC123");
eq("sender domain from address", resolveSenderDomain("noreply@example.org"), "example.org");
eq("domainless sender falls back", resolveSenderDomain("noreply"), "zedexams.com");
eq("empty sender falls back", resolveSenderDomain(""), "zedexams.com");

// ── token normalization ─────────────────────────────────────────────────────
{
  const tokens = normalizeRunnerTargetTokens([" abc ", "DEF", 42, "", null, "ghi"]);
  eq("runner tokens trimmed + uppercased", tokens.join(","), "ABC,DEF,GHI");
}
{
  const tokens = normalizeRunnerTargetTokens(Array.from({length: 15}, (_, i) => `t${i}`));
  eq("runner tokens capped at 10", tokens.length, 10);
}
eq("request tokens: non-array → null", normalizeRequestTargetTokens("abc"), null);
eq("request tokens: undefined → null", normalizeRequestTargetTokens(undefined), null);
{
  const tokens = normalizeRequestTargetTokens(["a", 1, "b", null]);
  eq("request tokens keep only strings", tokens.join(","), "a,b");
  eq("request tokens are NOT uppercased here", normalizeRequestTargetTokens(["ab"])[0], "ab");
  eq("request tokens capped at 10", normalizeRequestTargetTokens(Array(20).fill("x")).length, 10);
}

// ── createRunSummary / rollupStatus ─────────────────────────────────────────
{
  const s = createRunSummary({whatsAppReady: true, smtpReady: false, force: true, runType: "manual-admin-trigger"});
  eq("summary starts unscanned", s.sharesScanned, 0);
  eq("summary carries whatsAppReady", s.whatsAppReady, true);
  eq("summary carries smtpReady", s.smtpReady, false);
  eq("summary carries force", s.force, true);
  eq("summary carries runType", s.runType, "manual-admin-trigger");
  ok("skipped tracks a share bucket too", s.skipped.share === 0 && s.skipped.email === 0 && s.skipped.whatsapp === 0);
  eq("no failures → done", rollupStatus(s), "done");
  s.failed.email = 1;
  eq("an email failure → awaiting_approval", rollupStatus(s), "awaiting_approval");
  s.failed.email = 0;
  s.failed.whatsapp = 2;
  eq("a whatsapp failure → awaiting_approval", rollupStatus(s), "awaiting_approval");
}

// ── buildEmailPayload ───────────────────────────────────────────────────────
{
  const payload = buildEmailPayload({
    senderEmail: "noreply@example.org",
    senderDomain: "example.org",
    parentEmail: "parent@example.net",
    token: "ABC123",
    learnerName: "Chanda",
    learnerGrade: "7",
    stats: FULL_STATS,
    shareUrl: SHARE_URL,
    randomUUID: () => "fixed-uuid",
  });
  eq("from is branded", payload.from, "ZedExams <noreply@example.org>");
  eq("to is the parent", payload.to, "parent@example.net");
  eq("replyTo mirrors sender", payload.replyTo, "noreply@example.org");
  eq("subject names the learner", payload.subject, "Chanda's ZedExams week");
  eq("envelope pins from", payload.envelope.from, "noreply@example.org");
  eq("envelope pins to list", payload.envelope.to.join(","), "parent@example.net");
  eq("messageId embeds token + uuid + domain", payload.messageId, "<weekly-digest-ABC123-fixed-uuid@example.org>");
  eq("auto-response suppressed", payload.headers["X-Auto-Response-Suppress"], "All");
  ok("text body built from stats", payload.text.includes("• Quizzes done: 4"));
  ok("html body built from stats", payload.html.includes("Chanda's week"));
}
{
  const a = buildEmailPayload({
    senderEmail: "s@d.org", senderDomain: "d.org", parentEmail: "p@x.net",
    token: "T", learnerName: "L", learnerGrade: null, stats: FULL_STATS, shareUrl: SHARE_URL,
  });
  const b = buildEmailPayload({
    senderEmail: "s@d.org", senderDomain: "d.org", parentEmail: "p@x.net",
    token: "T", learnerName: "L", learnerGrade: null, stats: FULL_STATS, shareUrl: SHARE_URL,
  });
  ok("default messageId is unique per payload", a.messageId !== b.messageId);
}

// ── WhatsApp template variables ─────────────────────────────────────────────
eq("empty week summary line", buildWhatsAppSummaryLine({totalAttempts: 0, averagePercentage: null}), "no quizzes this week");
eq("summary line with average", buildWhatsAppSummaryLine({totalAttempts: 4, averagePercentage: 78}), "4 quizzes, avg 78%");
eq("summary line without average", buildWhatsAppSummaryLine({totalAttempts: 2, averagePercentage: null}), "2 quizzes");
eq("zero average is still printed", buildWhatsAppSummaryLine({totalAttempts: 1, averagePercentage: 0}), "1 quizzes, avg 0%");
{
  const vars = buildWhatsAppContentVariables({
    learnerName: "N".repeat(80),
    summaryLine: "S".repeat(200),
    shareUrl: SHARE_URL,
  });
  eq("template var 1 (name) capped at 60", vars[1].length, 60);
  eq("template var 2 (summary) capped at 120", vars[2].length, 120);
  eq("template var 3 is the share URL", vars[3], SHARE_URL);
}

console.log(`\nweeklyParentDigestCore.test.js: all ${passed} assertions passed`);
