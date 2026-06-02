/**
 * Vigil — hourly site monitoring agent.
 *
 * Every hour a scheduled Cloud Function (functions/agents/cron.js
 * `hourlyMonitor`) calls runMonitorChecks() to sweep four surfaces:
 *
 *   - pages     : the public hosting origin + key routes respond (not 5xx)
 *   - firebase  : Firestore reads + the Storage bucket are reachable
 *   - images    : a sample of content image URLs resolve (no 404s)
 *   - quizzes   : a sample of published quizzes pass the same structural
 *                 checks Vex enforces (options, duplicates, valid answer)
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

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const ORIGIN = "https://zedexams.com";

// Bound the work so an hourly run stays cheap and fast.
const QUIZ_SAMPLE = 10;        // published quizzes to structurally validate
const IMAGE_SAMPLE = 20;       // image URLs to HEAD-check per run
const QUESTIONS_PER_QUIZ = 30; // cap questions read per sampled quiz
const FETCH_TIMEOUT_MS = 8000;

// ── small helpers ────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {...opts, signal: ctrl.signal});
  } finally {
    clearTimeout(t);
  }
}

/** Flatten a TipTap doc (or plain string) to its text content. */
function extractPlainText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractPlainText).join(" ");
  if (typeof node === "object") {
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
    if (options.some((o) => !String(o || "").trim())) {
      problems.push({questionIndex: i, field: "options", message: `Question ${i + 1} has an empty option.`});
    }
    const seen = new Map();
    options.forEach((o, idx) => {
      const key = String(o || "").trim().toLowerCase();
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

// ── individual checks ────────────────────────────────────────────────

async function checkPages() {
  const routes = ["/", "/login"];
  const results = [];
  const failures = [];
  for (const route of routes) {
    const url = ORIGIN + route;
    try {
      const res = await fetchWithTimeout(url, {method: "GET", redirect: "follow"});
      results.push({url, status: res.status});
      if (res.status >= 500) {
        failures.push({check: "pages", id: route, severity: "critical", message: `${url} returned ${res.status}.`});
      } else if (res.status >= 400) {
        failures.push({check: "pages", id: route, severity: "warning", message: `${url} returned ${res.status}.`});
      }
    } catch (err) {
      results.push({url, status: null, error: String(err?.message || err)});
      failures.push({check: "pages", id: route, severity: "critical", message: `${url} is unreachable: ${String(err?.message || err)}.`});
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
    const snap = await db.collection("quizzes")
        .where("isPublished", "==", true)
        .orderBy("createdAt", "desc")
        .limit(QUIZ_SAMPLE)
        .get();
    for (const doc of snap.docs) {
      checked += 1;
      const qs = await doc.ref.collection("questions").limit(QUESTIONS_PER_QUIZ).get().catch(() => null);
      const questions = qs ? qs.docs.map((d) => d.data()) : [];
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

// ── orchestration ────────────────────────────────────────────────────

/** Run all four checks. Pure of secrets/Anthropic — safe to unit test. */
async function runMonitorChecks(db) {
  const ranAt = new Date().toISOString();
  const [pages, firebase, images, quizzes] = await Promise.all([
    checkPages(),
    checkFirebase(db),
    checkImages(db),
    checkQuizzes(db),
  ]);

  const failures = [...pages.failures, ...firebase.failures, ...images.failures, ...quizzes.failures];
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
    "list of failures from an hourly health check across four surfaces: pages, " +
    "firebase, images, quizzes. Group your answer by surface. For each distinct " +
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
const nodemailer = require("nodemailer");

function buildTransporter(smtpUser, smtpPass) {
  if (!smtpUser) return null;
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
  // Secret Manager often stores the PEM with literal "\n" — normalise back.
  const pem = String(privateKey).replace(/\\n/g, "\n");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), pem).toString("base64url");
  return `${signingInput}.${signature}`;
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
 * once per 24h. Sends one summary email and files a `bug` issue per newly
 * escalated failure. Mutates nothing it isn't given; persists de-dup state to
 * Firestore. Every channel degrades gracefully when its secret is missing.
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

  // GitHub issues → Mendi. Resolve one token per run (App installation token,
  // else PAT), then file one issue per newly escalated failure.
  if (newlyEscalated.length) {
    let githubToken = null;
    try {
      githubToken = await resolveGithubToken(github);
      out.githubAuth = github.appId && github.privateKey && github.installationId ? "app" : (githubToken ? "pat" : "none");
    } catch (err) {
      out.skipped.github = `auth failed: ${String(err?.message || err)}`;
    }
    if (githubToken && github.repo) {
      for (const {f, key} of newlyEscalated) {
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
  runStructuralChecks,
  extractPlainText,
  failureKey,
  suggestFixes,
  notifyFailures,
  makeAppJwt,
  resolveGithubToken,
};
