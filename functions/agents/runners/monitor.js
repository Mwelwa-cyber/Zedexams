/**
 * Vigil — hourly site monitoring agent.
 *
 * Every hour a scheduled Cloud Function (functions/agents/cron.js
 * `hourlyMonitor`) calls runMonitorChecks() to sweep five surfaces:
 *
 *   - pages      : the public hosting origin + key routes respond (not 5xx)
 *   - firebase   : Firestore reads + the Storage bucket are reachable
 *   - images     : a sample of content image URLs resolve (no 404s)
 *   - quizzes    : a sample of published quizzes pass the same structural
 *                  checks Vex enforces (options, duplicates, valid answer)
 *   - dailyExams : today's (Lusaka) daily-exam picks exist once the 05:00
 *                  autoPickDailyExams cron should have run. SELF-HEALING:
 *                  when the day is empty it re-runs the idempotent picker,
 *                  then still reports a failure so the missed cron (failed
 *                  deploy, scheduler outage) gets investigated rather than
 *                  silently papered over every morning.
 *
 * On failure the cron asks Anthropic (Haiku) for likely causes + fixes
 * (suggestFixes), then notifyFailures() reports them — de-duplicated so an
 * unresolved problem is escalated at most once per 24h — via:
 *   - an agentJobs rollup the /admin/agents dashboard surfaces (the cron),
 *   - an email to ADMIN_EMAILS (reusing the daily-cost SMTP transport),
 *   - a GitHub `bug` issue, which Mendi (the bug-fixer agent) can pick up.
 *
 * The deterministic checks are pure (no secrets, no Anthropic) so they unit
 * test directly — see monitor.test.js.
 */

const admin = require("firebase-admin");
const {lusakaDayString, lusakaNowParts} = require("../../lusakaTime");

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const ORIGIN = "https://zedexams.com";

// Bound the work so an hourly run stays cheap and fast.
const QUIZ_SAMPLE = 10;        // published quizzes to structurally validate
const IMAGE_SAMPLE = 20;       // image URLs to HEAD-check per run
const QUESTIONS_PER_QUIZ = 30; // cap questions read per sampled quiz
const FETCH_TIMEOUT_MS = 8000;
// The public origin is served through a CDN/SPA shell that can be slower than
// a bare API call, so give the page probe a more forgiving budget than the
// generic fetch and retry once — a single transient stall (edge cold-hit,
// undici connect blip) must not raise a false "site is down" critical.
const PAGE_TIMEOUT_MS = 15000;
const PAGE_ATTEMPTS = 2;
const MAX_ISSUES_PER_RUN = 3;  // ceiling on bug issues filed in one run
// Only code/infra failures are plausibly fixable by a code-fixer agent;
// content/data failures (images, quizzes) are reported but not routed to Mendi.
const MENDI_CHECKS = new Set(["pages", "firebase"]);

// ── small helpers ────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}) {
  const {timeoutMs = FETCH_TIMEOUT_MS, ...fetchOpts} = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {...fetchOpts, signal: ctrl.signal});
  } catch (err) {
    // undici surfaces our own AbortController firing as the opaque
    // "This operation was aborted." — rewrite it to an honest timeout so the
    // monitor report says *why* the request failed instead of that string.
    if (err?.name === "AbortError" || ctrl.signal.aborted) {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Flatten a TipTap doc (or plain string) to its text content.
 *
 * Mirrors the canonical, DOM-free extractor in src/editor/richPlainText.js so
 * Vigil agrees with what a learner actually sees. Crucially it must resolve the
 * editor's *non-text* leaf nodes — fractions, number bases, vertical
 * arithmetic, inline maths — to their readable value. Those nodes carry their
 * content in `attrs`, not in a child `text` node, so a naive walker that only
 * reads `node.text` flattens a maths option (e.g. ½ stored as a `mathFraction`)
 * to "" and Vigil then falsely reports it as an empty/duplicate option. On a
 * maths-heavy CBC platform that mislabels most maths quizzes every run.
 */
function extractPlainText(node) {
  if (!node) return "";
  if (typeof node === "string") {
    // Options/text are sometimes persisted as a JSON-encoded TipTap doc
    // string (e.g. '{"type":"doc","content":[{"type":"paragraph"}]}'). Decode
    // it so an *empty* doc flattens to "" instead of being treated as a
    // non-empty literal — otherwise blank options all share the same JSON
    // string and get mislabelled as "duplicate" rather than "empty".
    const trimmed = node.trim();
    if (trimmed.startsWith("{") && trimmed.includes("\"type\"") && trimmed.includes("\"doc\"")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.type === "doc") return extractPlainText(parsed.content);
      } catch (err) {
        /* not valid JSON — fall through to the raw string */
      }
    }
    return node;
  }
  if (Array.isArray(node)) return node.map(extractPlainText).join(" ");
  if (typeof node === "object") {
    const type = node.type;
    const attrs = node.attrs || {};
    // Editor leaf nodes whose value lives in attrs, not in a child text node.
    // Kept in sync with src/editor/richPlainText.js#extractFromNode.
    if (type === "math" || type === "inlineMath" || type === "mathBlock" || type === "mathInline") {
      return attrs.latex || attrs["data-latex"] || "";
    }
    if (type === "mathFraction") {
      const w = attrs.whole || "";
      const n = attrs.num || "";
      const d = attrs.den || "";
      return `${w ? `${w} ` : ""}${n}/${d}`.trim();
    }
    if (type === "numberBase") {
      const n = attrs.number || "";
      const b = attrs.base || "";
      return b ? `${n}_${b}` : n;
    }
    if (type === "verticalArithmetic") {
      const op = attrs.operator || "+";
      const lines = Array.isArray(attrs.lines) ? attrs.lines : [];
      const ans = attrs.answer || "";
      return `${lines.join(` ${op} `)} = ${ans || "___"}`;
    }
    let s = typeof node.text === "string" ? node.text : "";
    if (node.content) s += " " + extractPlainText(node.content);
    return s;
  }
  return "";
}

function isHttps(u) {
  return typeof u === "string" && u.trim().startsWith("https://");
}

/**
 * Deterministic per-question structural checks. Mirrors Vex's
 * runStructuralChecks (functions/agents/runners/vex.js) so the monitor and
 * the pre-publish verifier agree on what "broken" means. Returns an array of
 * { questionIndex, field, message } problems.
 */
function runStructuralChecks(questions) {
  const problems = [];
  const list = Array.isArray(questions) ? questions : [];

  list.forEach((q, i) => {
    const type = q?.type || "mcq";
    const textPlain = extractPlainText(q?.text).trim();

    if (!textPlain) {
      problems.push({questionIndex: i, field: "text", message: `Question ${i + 1} has no question text.`});
    }
    if (type !== "mcq") return;

    const options = Array.isArray(q?.options) ? q.options : [];
    if (options.length < 2) {
      problems.push({questionIndex: i, field: "options", message: `Question ${i + 1} has fewer than two options.`});
      return;
    }
    if (options.some((o) => !extractPlainText(o).trim())) {
      problems.push({questionIndex: i, field: "options", message: `Question ${i + 1} has an empty option.`});
    }
    const seen = new Map();
    options.forEach((o, idx) => {
      // Options can be rich-text (TipTap doc objects / JSON-encoded docs), not
      // just plain strings. Compare their flattened text — a raw String(o) on a
      // doc object yields "[object Object]" for every option, which collapses
      // distinct options into false "duplicate" reports.
      const key = extractPlainText(o).trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        problems.push({questionIndex: i, field: "options", message: `Question ${i + 1} has duplicate options (${seen.get(key) + 1} and ${idx + 1}).`});
      } else {
        seen.set(key, idx);
      }
    });
    const correctIdx = Number(q?.correctAnswer);
    if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= options.length) {
      problems.push({questionIndex: i, field: "correctAnswer", message: `Question ${i + 1} has no valid correct answer selected.`});
    }
  });

  return problems;
}

/** Stable identity for a failure, so we can de-dup notifications across runs. */
function failureKey(f) {
  return `${f.check}:${f.id}`;
}

/** Whether a failure should be routed to Mendi (code/infra only, not content). */
function isMendiEligible(failure) {
  return MENDI_CHECKS.has(failure?.check);
}

// ── individual checks ────────────────────────────────────────────────

/**
 * Probe one route, retrying on a network/timeout error. A bare `fetch` with no
 * User-Agent can be slow-walked or refused by edge protections, so send
 * browser-like headers. Returns the successful Response or throws the last
 * error after PAGE_ATTEMPTS tries.
 */
async function fetchPage(url) {
  let lastErr;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      return await fetchWithTimeout(url, {
        method: "GET",
        redirect: "follow",
        timeoutMs: PAGE_TIMEOUT_MS,
        headers: {
          "User-Agent": "zedexams-vigil/1.0 (+https://zedexams.com)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function checkPages() {
  const routes = ["/", "/login"];
  const results = [];
  const failures = [];
  for (const route of routes) {
    const url = ORIGIN + route;
    try {
      const res = await fetchPage(url);
      results.push({url, status: res.status});
      if (res.status >= 500) {
        failures.push({check: "pages", id: route, severity: "critical", message: `${url} returned ${res.status}.`});
      } else if (res.status >= 400) {
        failures.push({check: "pages", id: route, severity: "warning", message: `${url} returned ${res.status}.`});
      }
    } catch (err) {
      results.push({url, status: null, error: String(err?.message || err)});
      failures.push({check: "pages", id: route, severity: "critical", message: `${url} is unreachable after ${PAGE_ATTEMPTS} attempts: ${String(err?.message || err)}.`});
    }
  }
  return {ok: failures.length === 0, results, failures};
}

async function checkFirebase(db) {
  const results = {};
  const failures = [];
  try {
    await db.collection("quizzes").limit(1).get();
    results.firestore = "ok";
  } catch (err) {
    results.firestore = "error";
    failures.push({check: "firebase", id: "firestore", severity: "critical", message: `Firestore read failed: ${String(err?.message || err)}.`});
  }
  try {
    await admin.storage().bucket().getMetadata();
    results.storage = "ok";
  } catch (err) {
    results.storage = "error";
    failures.push({check: "firebase", id: "storage", severity: "critical", message: `Storage bucket unreachable: ${String(err?.message || err)}.`});
  }
  return {ok: failures.length === 0, results, failures};
}

/** Collect a bounded sample of content image URLs, then verify they resolve. */
async function checkImages(db) {
  const urls = new Set();
  try {
    const snap = await db.collection("quizzes").orderBy("createdAt", "desc").limit(QUIZ_SAMPLE).get();
    for (const doc of snap.docs) {
      const passages = Array.isArray(doc.data()?.passages) ? doc.data().passages : [];
      passages.forEach((p) => { if (isHttps(p?.imageUrl)) urls.add(p.imageUrl); });
      if (urls.size >= IMAGE_SAMPLE) break;
      const qs = await doc.ref.collection("questions").limit(5).get().catch(() => null);
      qs?.docs.forEach((qd) => { if (isHttps(qd.data()?.imageUrl)) urls.add(qd.data().imageUrl); });
      if (urls.size >= IMAGE_SAMPLE) break;
    }
  } catch (err) {
    return {ok: false, checked: 0, failures: [{check: "images", id: "sample", severity: "warning", message: `Could not sample image URLs: ${String(err?.message || err)}.`}]};
  }

  const sample = [...urls].slice(0, IMAGE_SAMPLE);
  const failures = [];
  await Promise.all(sample.map(async (url) => {
    try {
      // Range GET (HEAD is unreliable on Firebase Storage download URLs).
      const res = await fetchWithTimeout(url, {method: "GET", headers: {Range: "bytes=0-0"}});
      if (res.status >= 400) {
        failures.push({check: "images", id: url, severity: "warning", message: `Image returned ${res.status}.`, ref: url});
      }
    } catch (err) {
      failures.push({check: "images", id: url, severity: "warning", message: `Image unreachable: ${String(err?.message || err)}.`, ref: url});
    }
  }));
  return {ok: failures.length === 0, checked: sample.length, failures};
}

async function checkQuizzes(db) {
  const failures = [];
  let checked = 0;
  try {
    // Order by createdAt only (a single field is always indexed) and filter
    // isPublished in code. A where("isPublished").orderBy("createdAt") query
    // would need an isPublished+createdAt composite index that doesn't exist,
    // making the query throw every run.
    const snap = await db.collection("quizzes")
        .orderBy("createdAt", "desc")
        .limit(QUIZ_SAMPLE * 3)
        .get();
    for (const doc of snap.docs) {
      if (checked >= QUIZ_SAMPLE) break;
      if (!doc.data()?.isPublished) continue;
      checked += 1;
      const qs = await doc.ref.collection("questions").limit(QUESTIONS_PER_QUIZ).get().catch(() => null);
      // Sort by the `order` field so "Question N" in a failure matches the
      // editor's numbering. Without this the docs arrive in document-id order,
      // so the reported question number points an admin at the wrong question.
      const questions = qs ? qs.docs.map((d) => d.data()).sort((a, b) => (Number(a?.order ?? 0)) - (Number(b?.order ?? 0))) : [];
      if (questions.length === 0) {
        failures.push({check: "quizzes", id: `${doc.id}:empty`, severity: "warning", message: `Published quiz "${doc.data()?.title || doc.id}" has no questions.`, ref: doc.id});
        continue;
      }
      const problems = runStructuralChecks(questions);
      problems.forEach((p) => {
        failures.push({check: "quizzes", id: `${doc.id}:${p.questionIndex}:${p.field}`, severity: "warning", message: `Quiz "${doc.data()?.title || doc.id}": ${p.message}`, ref: doc.id});
      });
    }
  } catch (err) {
    failures.push({check: "quizzes", id: "sample", severity: "warning", message: `Could not sample quizzes: ${String(err?.message || err)}.`});
  }
  return {ok: failures.length === 0, checked, failures};
}

// autoPickDailyExams fires at 05:00 Lusaka. Give it a grace window before
// treating an empty day as a failure, so a slow-but-successful run is never
// raced by the monitor.
const DAILY_EXAM_GRACE_MIN = 5 * 60 + 15; // 05:15 Lusaka

/**
 * Whether the daily-exam check should enforce yet (past 05:15 Lusaka), and
 * which Lusaka calendar day counts as "today". Pure — unit tested directly.
 */
function dailyExamCheckWindow(now = new Date()) {
  const p = lusakaNowParts(now);
  return {
    active: p.hour * 60 + p.minute >= DAILY_EXAM_GRACE_MIN,
    today: lusakaDayString(now),
  };
}

/**
 * Verify today's daily-exam picks exist — and self-heal when they don't.
 *
 * The learner hub (/exams) shows "No exam scheduled today" on every subject
 * card unless a quiz carries quizType=="daily_exam" + dailyExamDate==today,
 * and the ONLY thing that stamps those fields each morning is the
 * autoPickDailyExams cron. A missed firing (failed functions deploy,
 * scheduler outage) therefore blanks the whole surface for the day with no
 * error anywhere. So: if the day is empty after the grace window, re-run the
 * picker directly (runAutoPick is idempotent — an existing pick returns
 * already_pinned) and report a warning so the missed cron is investigated.
 * Only a re-run that promotes nothing (no published exam papers to pick
 * from) is critical — that needs a human to publish content.
 *
 * `runPick` is injectable for plain-node tests; the default lazy-requires
 * dailyExamPicker because that module pulls in firebase-functions, which is
 * a functions/ dep the root test runner doesn't install.
 */
async function checkDailyExams(db, {now = new Date(), runPick} = {}) {
  const {active, today} = dailyExamCheckWindow(now);
  if (!active) {
    return {ok: true, skipped: true, today, scheduled: 0, failures: []};
  }
  try {
    const snap = await db.collection("quizzes")
        .where("quizType", "==", "daily_exam")
        .where("isDailyExam", "==", true)
        .where("dailyExamDate", "==", today)
        .limit(5)
        .get();
    if (!snap.empty) {
      return {ok: true, skipped: false, today, scheduled: snap.size, failures: []};
    }

    // Pass `today` explicitly: the picker's own default is also the Lusaka
    // day, but the heal must pin the same date this check just queried.
    const pick = runPick || require("../../dailyExamPicker").runAutoPick;
    const summary = await pick({today});
    const grades = Array.isArray(summary?.grades) ? summary.grades : [];
    const healed = grades.filter((g) => g.status === "promoted" || g.status === "already_pinned");

    if (healed.length > 0) {
      return {
        ok: false, skipped: false, today, scheduled: 0, healed: healed.length,
        failures: [{
          check: "dailyExams",
          id: today,
          severity: "warning",
          message: `No daily exams were scheduled for ${today} after 05:15 — the autoPickDailyExams ` +
            `cron did not run. Vigil re-ran the picker and restored ${healed.length} grade(s) ` +
            `(${healed.map((g) => g.grade).join(", ")}). Check the autoPickDailyExams scheduler ` +
            `job and the last functions deploy.`,
        }],
      };
    }
    return {
      ok: false, skipped: false, today, scheduled: 0, healed: 0,
      failures: [{
        check: "dailyExams",
        id: today,
        severity: "critical",
        message: `No daily exams are scheduled for ${today} and the picker re-run could not promote ` +
          `any quiz (${grades.map((g) => `grade ${g.grade}: ${g.status}`).join("; ") || "no grades processed"}). ` +
          `Every /exams subject card reads "No exam scheduled today" until an admin pins one.`,
      }],
    };
  } catch (err) {
    return {
      ok: false, skipped: false, today, scheduled: 0,
      failures: [{
        check: "dailyExams",
        id: today,
        severity: "critical",
        message: `Daily-exam check failed: ${String(err?.message || err)}.`,
      }],
    };
  }
}

// ── orchestration ────────────────────────────────────────────────────

/** Run all five checks. Pure of secrets/Anthropic — safe to unit test. */
async function runMonitorChecks(db) {
  const ranAt = new Date().toISOString();
  const [pages, firebase, images, quizzes, dailyExams] = await Promise.all([
    checkPages(),
    checkFirebase(db),
    checkImages(db),
    checkQuizzes(db),
    checkDailyExams(db),
  ]);

  const failures = [...pages.failures, ...firebase.failures, ...images.failures, ...quizzes.failures, ...dailyExams.failures];
  const critical = failures.filter((f) => f.severity === "critical");

  return {
    ranAt,
    ok: failures.length === 0,
    hasCritical: critical.length > 0,
    counts: {
      total: failures.length,
      critical: critical.length,
      warning: failures.length - critical.length,
    },
    checks: {
      pages: {ok: pages.ok, results: pages.results},
      firebase: {ok: firebase.ok, results: firebase.results},
      images: {ok: images.ok, checked: images.checked},
      quizzes: {ok: quizzes.ok, checked: quizzes.checked},
      dailyExams: {ok: dailyExams.ok, skipped: dailyExams.skipped, scheduled: dailyExams.scheduled, healed: dailyExams.healed ?? 0},
    },
    failures,
  };
}

/** Ask Haiku for likely causes + concrete fixes. Returns markdown text. */
async function suggestFixes(apiKey, report) {
  const {callAnthropic} = require("../../aiService");
  const failures = report.failures.slice(0, 30);
  const systemPrompt =
    "You are Vigil, ZedExams' site reliability engineer. You are handed a JSON " +
    "list of failures from an hourly health check across five surfaces: pages, " +
    "firebase, images, quizzes, dailyExams. Group your answer by surface. For each distinct " +
    "problem give a one-line likely root cause and a concrete, minimal fix an " +
    "engineer can act on. Flag anything that looks transient (e.g. a single 5xx " +
    "or one slow image) as 'likely transient — re-check next run'. Be terse and " +
    "specific. Output GitHub-flavored markdown, no preamble.";
  return await callAnthropic(apiKey, {
    systemPrompt,
    messages: [{role: "user", content: "Failures:\n```json\n" + JSON.stringify(failures, null, 2) + "\n```"}],
    model: HAIKU_MODEL,
    maxTokens: 700,
    temperature: 0.2,
    track: {tool: "hourlyMonitor"},
  });
}

const STATE_DOC = "monitorState/vigil";
const RENOTIFY_MS = 24 * 60 * 60 * 1000;

function buildTransporter(smtpUser, smtpPass) {
  if (!smtpUser) return null;
  // Lazy require: nodemailer is a functions/ dependency, not a repo-root one,
  // and the test:all runner loads this module against root deps. Requiring it
  // here keeps the pure-logic tests (which never build a transporter)
  // dependency-free, while the deployed function resolves it at runtime.
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {user: smtpUser, pass: smtpPass},
    tls: {minVersion: "TLSv1.2", servername: "mail.privateemail.com"},
  });
}

const crypto = require("node:crypto");

/**
 * Coerce whatever a secret store handed us into a PEM OpenSSL 3 will decode.
 *
 * The GitHub App key routinely arrives mangled: literal "\n"/"\r\n" escape
 * sequences (dotenv / `firebase functions:secrets:set` from a single-line
 * value), a wrapping pair of quotes, or — the one that produces
 * `error:1E08010C:DECODER routines::unsupported` from crypto.sign — the whole
 * key collapsed onto one line so the base64 body carries interior spaces.
 * Rebuilding the PEM from its BEGIN/END markers and re-wrapping the stripped
 * body at 64 chars fixes all three; a correctly-formatted PEM round-trips
 * unchanged.
 */
function normalizePem(raw) {
  let pem = String(raw || "").trim();
  // Strip one layer of wrapping quotes a secret store may have added.
  if ((pem.startsWith("\"") && pem.endsWith("\"")) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1).trim();
  }
  // Turn literal escape sequences back into real newlines.
  pem = pem.replace(/\\r\\n|\\n|\\r/g, "\n");
  // Rebuild from the header + base64 body, dropping any interior whitespace.
  const match = pem.match(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/);
  if (match) {
    const label = match[1].trim();
    const body = match[2].replace(/\s+/g, "");
    const wrapped = body.match(/.{1,64}/g) || [];
    pem = `-----BEGIN ${label}-----\n${wrapped.join("\n")}\n-----END ${label}-----\n`;
  }
  return pem;
}

/**
 * Mint a short-lived RS256 JWT for a GitHub App (built-in crypto, no dep).
 * `iat` is backdated 60s to tolerate clock skew; `exp` stays under GitHub's
 * 10-minute ceiling.
 */
function makeAppJwt(appId, privateKey) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({alg: "RS256", typ: "JWT"});
  const payload = b64({iat: now - 60, exp: now + 9 * 60, iss: String(appId)});
  const signingInput = `${header}.${payload}`;
  const pem = normalizePem(privateKey);
  try {
    const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), pem).toString("base64url");
    return `${signingInput}.${signature}`;
  } catch (err) {
    // A malformed key surfaces as an opaque OpenSSL DECODER error — make the
    // monitor report point at the actual secret to fix.
    throw new Error(`GitHub App private key could not be parsed (${String(err?.code || err?.message || err)}); check the GITHUB_APP_PRIVATE_KEY secret format.`);
  }
}

/** Exchange the App JWT for a 1-hour installation token scoped to the repo. */
async function getInstallationToken({appId, privateKey, installationId}) {
  const jwt = makeAppJwt(appId, privateKey);
  const res = await fetchWithTimeout(
      `https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${jwt}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "zedexams-vigil",
        },
      });
  if (!res.ok) throw new Error(`installation token failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

/**
 * Resolve a usable GitHub token for issue filing. Prefers a GitHub App
 * installation token (no expiry to babysit); falls back to a PAT. Returns
 * null when neither is configured. Throws only on a genuine auth failure.
 */
async function resolveGithubToken(github = {}) {
  const {appId, privateKey, installationId, pat} = github;
  if (appId && privateKey && installationId) {
    return await getInstallationToken({appId, privateKey, installationId});
  }
  return pat || null;
}

async function fileBugIssue({token, repo, failure, suggestions}) {
  const body =
    `**Vigil** (hourly monitor) detected a failure on the \`${failure.check}\` check.\n\n` +
    `> ${failure.message}\n\n` +
    (failure.ref ? `Reference: \`${failure.ref}\`\n\n` : "") +
    (suggestions ? `### Suggested fix\n\n${suggestions}\n\n` : "") +
    `_Filed automatically. If this is a real bug, it can be picked up by Mendi._`;
  const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "zedexams-vigil",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `[Vigil] ${failure.check} failure: ${failure.message}`.slice(0, 220),
      body,
      labels: ["bug", "vigil"],
    }),
  });
  if (!res.ok) throw new Error(`GitHub issue create failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.number || null;
}

/**
 * Report failures with de-duplication: a given failure is escalated at most
 * once per 24h. Sends one summary email covering all newly escalated failures,
 * and files `bug` issues (→ Mendi) for the code/infra ones only, capped per
 * run. Persists de-dup state to Firestore. Every channel degrades gracefully
 * when its secret is missing.
 */
async function notifyFailures({db, report, smtpUser, smtpPass, adminEmails, github = {}}) {
  const now = Date.now();
  const stateRef = db.doc(STATE_DOC);
  const prev = (await stateRef.get().catch(() => null))?.data()?.failures || {};

  const next = {};
  const newlyEscalated = [];
  for (const f of report.failures) {
    const key = failureKey(f);
    const existing = prev[key];
    const due = !existing || (now - (existing.lastNotified || 0) > RENOTIFY_MS);
    next[key] = {
      firstSeen: existing?.firstSeen || now,
      lastNotified: due ? now : (existing?.lastNotified || now),
      issueNumber: existing?.issueNumber || null,
      message: f.message,
    };
    if (due) newlyEscalated.push({f, key});
  }

  const out = {emailed: false, issuesFiled: [], githubAuth: null, skipped: {}};

  // GitHub issues → Mendi. Only code/infra failures (pages, firebase) are
  // plausibly fixable by a code-fixer; content/data failures (images, quizzes)
  // are reported in the dashboard + email but not handed to Mendi. Cap the
  // number filed per run, criticals first, so a bad first run can't open a
  // flood of issues (each of which would trigger a Mendi run).
  const mendiCandidates = newlyEscalated
      .filter(({f}) => isMendiEligible(f))
      .sort((a, b) => (a.f.severity === "critical" ? 0 : 1) - (b.f.severity === "critical" ? 0 : 1))
      .slice(0, MAX_ISSUES_PER_RUN);
  if (mendiCandidates.length) {
    let githubToken = null;
    try {
      githubToken = await resolveGithubToken(github);
      out.githubAuth = github.appId && github.privateKey && github.installationId ? "app" : (githubToken ? "pat" : "none");
    } catch (err) {
      out.skipped.github = `auth failed: ${String(err?.message || err)}`;
    }
    if (githubToken && github.repo) {
      for (const {f, key} of mendiCandidates) {
        try {
          const num = await fileBugIssue({token: githubToken, repo: github.repo, failure: f, suggestions: report.suggestions});
          if (num) {
            next[key].issueNumber = num;
            out.issuesFiled.push(num);
          }
        } catch (err) {
          out.skipped.github = String(err?.message || err);
        }
      }
    } else if (!out.skipped.github) {
      out.skipped.github = "no GitHub App or PAT configured";
    }
  }

  // One summary email for this run's newly escalated failures.
  const transporter = buildTransporter(smtpUser, smtpPass);
  if (transporter && smtpUser && adminEmails.length && newlyEscalated.length) {
    const lines = newlyEscalated.map(({f, key}) =>
      `  · [${f.severity}] ${f.message}` + (next[key].issueNumber ? ` (issue #${next[key].issueNumber})` : ""));
    const text = [
      `Vigil hourly monitor — ${report.counts.critical} critical, ${report.counts.warning} warning.`,
      "",
      "Newly escalated this run:",
      ...lines,
      "",
      report.suggestions ? "Suggested fixes:\n" + report.suggestions : "",
      "",
      "Full report in /admin/agents.",
      "— ZedExams ops (Vigil)",
    ].join("\n");
    try {
      await transporter.sendMail({
        from: `ZedExams ops <${smtpUser}>`,
        sender: smtpUser,
        to: adminEmails.join(", "),
        subject: `[ZedExams] Vigil: ${report.counts.critical} critical, ${report.counts.warning} warning`,
        text,
        headers: {"X-Auto-Response-Suppress": "All"},
      });
      out.emailed = true;
    } catch (err) {
      out.skipped.email = String(err?.message || err);
    }
  } else if (newlyEscalated.length && (!transporter || !adminEmails.length)) {
    out.skipped.email = "SMTP or ADMIN_EMAILS not configured";
  }

  await stateRef.set({failures: next, updatedAt: now}, {merge: false}).catch(() => {});
  return out;
}

module.exports = {
  runMonitorChecks,
  checkDailyExams,
  dailyExamCheckWindow,
  runStructuralChecks,
  extractPlainText,
  failureKey,
  isMendiEligible,
  suggestFixes,
  notifyFailures,
  makeAppJwt,
  normalizePem,
  resolveGithubToken,
};
