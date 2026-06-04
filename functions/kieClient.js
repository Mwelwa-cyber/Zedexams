/**
 * kieClient — dependency-free REST client for the Kie.ai unified Jobs API
 * (https://api.kie.ai). A single API key fronts many image/video models
 * (Nano Banana, GPT Image, Flux, Ideogram, Qwen, …).
 *
 * All Kie generation is ASYNCHRONOUS: you POST a task to
 * `/api/v1/jobs/createTask`, get back a `taskId`, then poll
 * `/api/v1/jobs/recordInfo?taskId=…` until `state` becomes "success" or
 * "fail". `generateKieImage()` wraps both steps and the polling loop.
 *
 * Intentionally has NO firebase-functions dependency so the exact same
 * module is shared between:
 *   - the dev-time CLI  (scripts/kie-generate-image.mjs), and
 *   - a future Cloud Function — wrap the thrown KieError into an HttpsError
 *     and pipe the returned URL through generateDiagram.js's
 *     downloadToStorage() to get a stable Firebase Storage URL.
 *
 * Mirrors the no-SDK approach of openaiClient.js / geminiClient.js.
 *
 * Public API:
 *   generateKieImage(apiKey, opts)   -> { url, urls, taskId, model, raw }
 *   createKieImageTask(apiKey, opts)  -> taskId
 *   getKieTask(apiKey, taskId, opts)  -> parsed record
 *   downloadKieImage(url)             -> { bytes: Buffer, contentType }
 * Pure helpers (unit-tested in scripts/test-kie-client.mjs):
 *   buildCreateTaskBody, parseCreateTaskResponse, parseTaskRecord, isTerminalState
 *
 * Some example text-to-image model ids (see https://docs.kie.ai/market):
 *   "nano-banana-pro"  — Google Nano Banana Pro (default; likes aspect_ratio + resolution)
 *   "gpt-image-1.5"    — OpenAI GPT Image
 *   "flux-kontext"     — Flux Kontext
 * Per-model `input` fields differ — pass a full `input` object to override.
 */

const KIE_BASE = process.env.KIE_BASE || "https://api.kie.ai";
const CREATE_TASK_PATH = "/api/v1/jobs/createTask";
const RECORD_INFO_PATH = "/api/v1/jobs/recordInfo";
const DEFAULT_KIE_MODEL = process.env.KIE_MODEL || "nano-banana-pro";

// recordInfo `state` values. waiting / queuing / generating are non-terminal.
const TERMINAL_STATES = new Set(["success", "fail"]);

class KieError extends Error {
  constructor(message, {code = "kie_error", status = 0, taskId = ""} = {}) {
    super(message);
    this.name = "KieError";
    this.code = code;
    this.status = status;
    if (taskId) this.taskId = taskId;
  }
}

// ─── Pure helpers (no network) ──────────────────────────────────────────

// Build the createTask request body. A caller-supplied `input` object (the
// per-model schema) always wins; otherwise we assemble the common
// text-to-image shape — prompt + aspect_ratio — and merge any `extraInput`
// (resolution, output_format, …) the caller adds.
function buildCreateTaskBody(opts = {}) {
  const model = opts.model || DEFAULT_KIE_MODEL;
  let input;
  if (opts.input && typeof opts.input === "object") {
    input = {...opts.input};
  } else {
    input = {prompt: String(opts.prompt || "").trim()};
    if (opts.aspectRatio) input.aspect_ratio = String(opts.aspectRatio);
    if (opts.extraInput && typeof opts.extraInput === "object") {
      Object.assign(input, opts.extraInput);
    }
  }
  const body = {model, input};
  if (opts.callBackUrl) body.callBackUrl = String(opts.callBackUrl);
  return body;
}

// Kie envelope for createTask: { code, msg, data: { taskId } }. code 200 ==
// task accepted (not finished). Throws if no taskId came back.
function parseCreateTaskResponse(json) {
  const code = json && json.code;
  const taskId = json && json.data && json.data.taskId;
  if (code !== 200 || !taskId) {
    const msg = (json && json.msg) || "createTask returned no taskId";
    throw new KieError(`Kie createTask rejected: ${msg}`, {code: "create_failed"});
  }
  return String(taskId);
}

// Kie envelope for recordInfo: { code, msg, data: { state, resultJson,
// failCode, failMsg, progress, … } }. `resultJson` is a JSON *string*
// holding { resultUrls: [...] }; we parse it defensively (a malformed
// string yields an empty url list rather than throwing).
function parseTaskRecord(json) {
  const data = (json && json.data) || {};
  const state = String(data.state || "").toLowerCase();
  let urls = [];
  if (data.resultJson) {
    let parsed = data.resultJson;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (err) {
        parsed = null;
      }
    }
    if (parsed && Array.isArray(parsed.resultUrls)) {
      urls = parsed.resultUrls.filter((u) => typeof u === "string" && u);
    }
  }
  return {
    state,
    urls,
    failCode: data.failCode ? String(data.failCode) : "",
    failMsg: data.failMsg ? String(data.failMsg) : "",
    progress: typeof data.progress === "number" ? data.progress : null,
    taskId: data.taskId ? String(data.taskId) : "",
    model: data.model ? String(data.model) : "",
    raw: data,
  };
}

function isTerminalState(state) {
  return TERMINAL_STATES.has(String(state || "").toLowerCase());
}

// ─── Small networking utilities ─────────────────────────────────────────

function authHeaders(apiKey, withJsonBody) {
  const headers = {Authorization: `Bearer ${apiKey}`};
  if (withJsonBody) headers["Content-Type"] = "application/json";
  return headers;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (err) {
    return null;
  }
}

function shortMsg(json) {
  if (!json) return "no response body";
  const m = json.msg || json.message || json.error;
  return String(m || JSON.stringify(json)).slice(0, 200);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new KieError("Aborted.", {code: "aborted"}));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new KieError("Aborted.", {code: "aborted"}));
        },
        {once: true},
      );
    }
  });
}

// ─── Network calls ──────────────────────────────────────────────────────

async function createKieImageTask(apiKey, opts = {}) {
  if (!apiKey) throw new KieError("Kie API key is not configured.", {code: "no_key"});
  const body = buildCreateTaskBody(opts);
  if (!opts.input && !body.input.prompt) {
    throw new KieError("A prompt is required to generate an image.", {code: "no_prompt"});
  }
  const res = await fetch(`${KIE_BASE}${CREATE_TASK_PATH}`, {
    method: "POST",
    headers: authHeaders(apiKey, true),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new KieError(`Kie createTask HTTP ${res.status}: ${shortMsg(json)}`, {
      code: "http_error",
      status: res.status,
    });
  }
  return parseCreateTaskResponse(json);
}

async function getKieTask(apiKey, taskId, opts = {}) {
  if (!apiKey) throw new KieError("Kie API key is not configured.", {code: "no_key"});
  if (!taskId) throw new KieError("taskId is required.", {code: "no_task"});
  const url = `${KIE_BASE}${RECORD_INFO_PATH}?taskId=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(apiKey, false),
    signal: opts.signal,
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new KieError(`Kie recordInfo HTTP ${res.status}: ${shortMsg(json)}`, {
      code: "http_error",
      status: res.status,
      taskId,
    });
  }
  return parseTaskRecord(json);
}

/**
 * Create an image task and poll until it finishes.
 * opts: { prompt | input, model, aspectRatio, extraInput, callBackUrl,
 *         pollIntervalMs=2000, timeoutMs=180000, onProgress, signal }
 * onProgress is called with { state, progress, taskId } on each poll.
 */
async function generateKieImage(apiKey, opts = {}) {
  const pollIntervalMs = clampInt(opts.pollIntervalMs, 2000, 500, 15000);
  const timeoutMs = clampInt(opts.timeoutMs, 180000, 5000, 600000);

  const taskId = await createKieImageTask(apiKey, opts);
  if (typeof opts.onProgress === "function") {
    opts.onProgress({state: "created", progress: 0, taskId});
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = await getKieTask(apiKey, taskId, {signal: opts.signal});
    if (typeof opts.onProgress === "function") {
      opts.onProgress({state: record.state, progress: record.progress, taskId});
    }
    if (record.state === "success") {
      if (!record.urls.length) {
        throw new KieError("Kie task succeeded but returned no image URLs.", {
          code: "no_result",
          taskId,
        });
      }
      return {
        url: record.urls[0],
        urls: record.urls,
        taskId,
        model: record.model || opts.model || DEFAULT_KIE_MODEL,
        raw: record.raw,
      };
    }
    if (record.state === "fail") {
      throw new KieError(
        `Kie task failed: ${record.failMsg || record.failCode || "unknown error"}`,
        {code: "task_failed", taskId},
      );
    }
    if (Date.now() >= deadline) {
      throw new KieError(
        `Kie task timed out after ${Math.round(timeoutMs / 1000)}s ` +
          `(last state: ${record.state || "unknown"}).`,
        {code: "timeout", taskId},
      );
    }
    await sleep(pollIntervalMs, opts.signal);
  }
}

// Fetch a generated image's bytes. The dev CLI writes these to disk; a
// Cloud Function would stream them into Firebase Storage instead.
async function downloadKieImage(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new KieError(`Failed to download Kie image (HTTP ${res.status}).`, {
      code: "download_failed",
      status: res.status,
    });
  }
  const contentType = res.headers.get("content-type") || "image/png";
  const arrayBuffer = await res.arrayBuffer();
  return {bytes: Buffer.from(arrayBuffer), contentType};
}

module.exports = {
  KIE_BASE,
  DEFAULT_KIE_MODEL,
  KieError,
  buildCreateTaskBody,
  parseCreateTaskResponse,
  parseTaskRecord,
  isTerminalState,
  createKieImageTask,
  getKieTask,
  generateKieImage,
  downloadKieImage,
};
