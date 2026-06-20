/**
 * Dawn — the on-demand "morning briefing" bridge.
 *
 * Dawn is a Claude Managed Agent (built with launch-your-agent) that reads the
 * ZedExams repo + researches the market and writes a briefing: likely bugs to
 * fix, polish to ship, competitive findings, and a ranked "Top 3 to do today".
 * It used to be launched from a laptop PowerShell script (run-dawn.ps1). This
 * module reproduces that exact flow server-side so an admin can launch Dawn
 * from /admin/agents with a button instead:
 *
 *   1. POST /sessions              → start a fresh run against the existing agent
 *   2. POST /sessions/{id}/events  → a user.define_outcome (task + rubric)
 *   3. poll GET /sessions/{id}      until idle/terminated (~10 min)
 *   4. GET  /files?scope_id={id}    → the email.md / briefing.md it wrote
 *   5. parse Subject:/Body: and email it
 *
 * The Anthropic key + the SMTP credentials live as Firebase secrets and never
 * reach the browser — strictly safer than the laptop. Network access is
 * injected (`fetchImpl`) so the orchestration + parsing unit-test without the
 * Managed Agents API (same pattern as till.js / echo.js).
 */

const CMA_BASE = "https://api.anthropic.com/v1";
// The Managed Agents + Files betas Dawn was built against (mirrors run-dawn.ps1).
const CMA_BETA = "managed-agents-2026-04-01,files-api-2025-04-14";
const ANTHROPIC_VERSION = "2023-06-01";

// Terminal session states from the Managed Agents API — Dawn has stopped working.
const DONE_STATES = new Set(["idle", "terminated", "completed", "failed"]);

// Bundled defaults so the function carries Dawn's brief itself and never
// depends on a laptop's first_prompt.txt / outcome.md. The admin can override
// either via the dawnConfig/default doc.
const DEFAULT_TASK = [
  "Produce today's ZedExams morning briefing.",
  "",
  "Read the current state of the zedexams codebase (clone it read-only using " +
    "the GitHub token available in your environment), survey the high-impact " +
    "surfaces and anything that looks recently changed, and research what " +
    "competitors and the Zambian/CBC edtech market are doing right now.",
  "",
  "Deliver an email-ready briefing to /mnt/session/outputs/briefing.md " +
    "covering, in priority order: likely bugs (each grounded in a real file " +
    "you read and labelled confirmed-from-code or hypothesis), polish & build " +
    "opportunities, and competitive research (each with a source link). End " +
    "with a ranked \"Top 3 to do today\". Also write " +
    "/mnt/session/outputs/email.md with a Subject line and a paste-ready body.",
  "",
  "Use relative dates only. Do not modify or push to the repo, and do not send " +
    "anything — produce the draft only.",
].join("\n");

const DEFAULT_RUBRIC = [
  "# Outcome — ZedExams Morning Briefing (your definition of done)",
  "",
  "The run is **done** when `briefing.md` is produced and meets all of:",
  "",
  "1. **Bugs grounded in real code** — lists specific suspected bugs/" +
    "regressions, each citing a real file path (and line or area) from the " +
    "zedexams repo, with a one-line reason it matters. No generic, " +
    "repo-agnostic advice.",
  "2. **Polish / build ideas** — 2–5 concrete improvements, each tied to a " +
    "real part of ZedExams, each with a rough impact/effort note.",
  "3. **Competitive research** — at least one finding about competitors or the " +
    "Zambian/CBC edtech market, each with a working cited source link and a " +
    "one-line \"so ZedExams should consider X\" takeaway.",
  "4. **Prioritized** — ends with a single ranked **\"Top 3 to do today\"**, " +
    "each with a one-line rationale.",
  "5. **Email-ready** — has a clear subject line and a scannable, grouped " +
    "body, uses relative dates (\"today\"), and stays roughly within one page.",
  "6. **Honest** — every bug is labelled \"confirmed from code\" or " +
    "\"hypothesis\"; no guess is presented as a verified bug; no invented " +
    "files, features, or sources.",
].join("\n");

function cmaHeaders(apiKey) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": CMA_BETA,
    "content-type": "application/json",
  };
}

/**
 * Thin wrapper around the Managed Agents REST API. Reads the body as text first
 * so a non-JSON error page still yields a useful message instead of throwing on
 * res.json(). Throws an Error (with .status) on any non-2xx.
 */
async function cmaFetch(fetchImpl, apiKey, method, path, body) {
  const res = await fetchImpl(`${CMA_BASE}${path}`, {
    method,
    headers: cmaHeaders(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = typeof res.text === "function" ? await res.text() : "";
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {raw: text};
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text || `HTTP ${res.status}`;
    const err = new Error(`CMA ${method} ${path} failed: ${String(msg).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Open a fresh briefing run and hand back the session id. Two calls: open the
 * session against the existing agent / environment / vault, then define the
 * outcome (task + rubric) so Dawn starts working.
 */
async function startBriefingRun({
  fetchImpl,
  apiKey,
  agentId,
  envId,
  vaultId,
  title = "morning briefing",
  task = DEFAULT_TASK,
  rubric = DEFAULT_RUBRIC,
  maxIterations = 3,
}) {
  if (!apiKey) throw new Error("Anthropic API key is not configured.");
  if (!agentId || !envId) {
    throw new Error("Dawn is not configured — missing agent or environment id.");
  }

  const session = await cmaFetch(fetchImpl, apiKey, "POST", "/sessions", {
    agent: agentId,
    environment_id: envId,
    title,
    ...(vaultId ? {vault_ids: [vaultId]} : {}),
  });
  const sessionId = session && session.id;
  if (!sessionId) throw new Error("Managed Agents API did not return a session id.");

  await cmaFetch(fetchImpl, apiKey, "POST", `/sessions/${sessionId}/events`, {
    events: [{
      type: "user.define_outcome",
      description: task,
      rubric: {type: "text", content: rubric},
      max_iterations: maxIterations,
    }],
  });

  return sessionId;
}

/** Current lowercase status of a session ("running" | "idle" | …). */
async function fetchSessionStatus({fetchImpl, apiKey, sessionId}) {
  const s = await cmaFetch(fetchImpl, apiKey, "GET", `/sessions/${sessionId}`);
  return String((s && s.status) || "").toLowerCase();
}

/** Has the session stopped working (so the briefing is ready to collect)? */
function isTerminalStatus(status) {
  return DONE_STATES.has(String(status || "").toLowerCase());
}

/**
 * Pull the briefing Dawn wrote into the session's file scope. Prefers email.md
 * (already shaped as Subject:/Body:) and falls back to briefing.md. Returns
 * { filename, text } or null if neither file is present yet.
 */
async function fetchBriefing({fetchImpl, apiKey, sessionId}) {
  const list = await cmaFetch(fetchImpl, apiKey, "GET", `/files?scope_id=${sessionId}`);
  const files = (list && list.data) || [];
  const pick =
    files.find((f) => f && f.filename === "email.md") ||
    files.find((f) => f && f.filename === "briefing.md");
  if (!pick) return null;

  const res = await fetchImpl(`${CMA_BASE}/files/${pick.id}/content`, {
    method: "GET",
    headers: cmaHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Fetching ${pick.filename} failed: HTTP ${res.status}`);
  }
  const text = typeof res.text === "function" ? await res.text() : "";
  return {filename: pick.filename, text};
}

/**
 * Split a briefing into { subject, body }. Mirrors run-dawn.ps1: an explicit
 * "Subject:" line wins, "Body:" starts the body, and absent either we fall
 * back to a default subject + the whole text (sans any subject line).
 */
function parseBriefing(text, fallbackSubject = "ZedExams Morning Briefing") {
  const raw = String(text || "");
  const sm = raw.match(/^\s*Subject:\s*(.+)$/im);
  const subject = sm ? sm[1].trim() : fallbackSubject;

  let body;
  const bm = raw.match(/Body:\s*([\s\S]+)$/i);
  if (bm) {
    body = bm[1].trim();
  } else {
    body = raw.replace(/^\s*Subject:.*$/im, "").trim();
  }
  return {subject, body: body || raw.trim()};
}

module.exports = {
  startBriefingRun,
  fetchSessionStatus,
  fetchBriefing,
  parseBriefing,
  isTerminalStatus,
  cmaFetch,
  DEFAULT_TASK,
  DEFAULT_RUBRIC,
  CMA_BASE,
  CMA_BETA,
};
