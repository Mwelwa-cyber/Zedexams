/**
 * Coder agent loop.
 *
 * A separate Claude tool-loop from the Q&A agent in functions/zedAssistant/
 * agent.js. This one has a longer iteration budget and a coder-specific
 * system prompt that bakes in the red line so the model knows up front
 * what it can't touch.
 *
 * The system prompt is intentionally explicit about the red line. We rely
 * on github.js as the hard wall, but telling the model up front avoids
 * wasted tool calls that would just bounce off the wall.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = process.env.ZED_CODER_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-5";

// Coder needs more iterations than the Q&A bot because each file edit is
// at minimum read → write → confirm. Cap is high enough for moderate PRs,
// low enough that a runaway loop self-terminates.
const MAX_ITERATIONS = 25;
const MAX_OUTPUT_TOKENS = 4000;

const {
  TARGET_OWNER,
  TARGET_REPO,
  MAX_WRITES_PER_TASK,
  FORBIDDEN_PATH_PATTERNS,
} = require("./redLine");
const {anthropicFetch} = require("../../anthropicFetch");

function describeForbidden() {
  // Convert the regex array into a human-readable bullet list for the
  // system prompt. Keeps the prompt and the policy in lockstep — no
  // duplicate truth source.
  return [
    "- security rules: firestore.rules, storage.rules, firestore.indexes.json",
    "- deploy config: firebase.json, .firebaserc",
    "- secrets: any .env, .env.* file; *.key, *.pem, service-account JSON",
    "- CI: anything under .github/",
    "- dependency manifests: package.json, package-lock.json, yarn.lock",
    "- secrets/ and credentials/ directories anywhere in the tree",
  ].join("\n");
}

const CODER_SYSTEM_PROMPT = [
  "You are Zed's autonomous coder. You receive a task description and edit",
  `the ${TARGET_OWNER}/${TARGET_REPO} repository to complete it. The founder`,
  "will review the resulting draft PR before it's merged.",
  "",
  "Tools available:",
  "  list_files(path)              read-only directory listing",
  "  read_file(path)               read-only file fetch",
  "  search_code(query)            GitHub code search across the repo",
  "  write_file(path, content, message)  create or overwrite (FULL contents)",
  "  delete_file(path, message)    delete (use sparingly)",
  "  finish(ok, summary)           call exactly once when done or stuck",
  "",
  "RED LINE — these paths are physically blocked. write_file or delete_file",
  "on any of them will throw and the change will not be made. Don't try:",
  describeForbidden(),
  "",
  `Write at most ${MAX_WRITES_PER_TASK} files per task. The branch is fresh,`,
  "and the PR opens as draft for human review — never merged automatically.",
  "",
  "Workflow:",
  "  1. Use list_files / read_file / search_code to understand the code",
  "     before editing. Don't guess at file contents.",
  "  2. Make focused edits. Don't refactor unrelated code, don't touch",
  "     things not asked for, don't add features the task didn't request.",
  "  3. write_file replaces the entire file contents. Always pass the FULL",
  "     new file, not a patch. Read first, then write the merged result.",
  "  4. Match the existing style of the file you're editing. Don't",
  "     introduce new abstractions for a small change.",
  "  5. Don't add comments unless they explain a non-obvious WHY. Don't",
  "     write 'this function does X' comments.",
  "  6. When the task is complete, call finish(ok=true, summary='...').",
  "     If the task is impossible (e.g. requires a red-line file change,",
  "     or you can't figure out the codebase), call finish(ok=false, ...)",
  "     with a short reason. Never silently stop.",
  "",
  "Commit messages should be one short line, imperative mood, lowercase",
  "first letter (matches this repo's style).",
].join("\n");

async function postAnthropic(apiKey, body) {
  const res = await anthropicFetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, {label: "coder"});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Anthropic API error: ${message}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractToolUseBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b?.type === "tool_use");
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b?.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Run the coder agent on a single task.
 *
 * @param {string} apiKey
 * @param {object} opts
 * @param {string} opts.task               One-line task description.
 * @param {string} opts.branch             The fresh branch already created.
 * @param {Function} opts.runTool          From buildToolRunner().
 * @param {Array}  opts.tools              From buildToolDefinitions().
 * @returns {Promise<{toolCalls, stopReason, lastText, iterations}>}
 */
async function runCoderAgent(apiKey, {task, branch, runTool, tools}) {
  const initialUserMessage = [
    `Task: ${task}`,
    "",
    `Working branch: ${branch} (fresh from main).`,
    "",
    "Make the change, then call finish().",
  ].join("\n");

  const conversation = [
    {role: "user", content: initialUserMessage},
  ];
  const toolCalls = [];
  let lastResponse;
  let iterations = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;
    const body = {
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      system: [{
        type: "text",
        text: CODER_SYSTEM_PROMPT,
        cache_control: {type: "ephemeral"},
      }],
      tools,
      messages: conversation,
    };

    lastResponse = await postAnthropic(apiKey, body);
    const assistantContent = lastResponse?.content || [];
    conversation.push({role: "assistant", content: assistantContent});

    const toolUseBlocks = extractToolUseBlocks(assistantContent);
    if (
      lastResponse.stop_reason !== "tool_use" ||
      toolUseBlocks.length === 0
    ) {
      // Model stopped without calling finish(). Treat as max-iterations
      // bail-out so handleCodeTask can decide what to do.
      return {
        toolCalls,
        stopReason: lastResponse.stop_reason,
        lastText: extractTextBlocks(assistantContent),
        iterations,
      };
    }

    const toolResults = [];
    let finishSeen = false;
    for (const block of toolUseBlocks) {
      const name = block.name;
      const input = block.input || {};
      let resultText;
      let isError = false;
      try {
        const raw = await runTool(name, input);
        resultText = typeof raw === "string" ?
          raw :
          JSON.stringify(raw, null, 2);
      } catch (err) {
        isError = true;
        const ruleMsg = err?.rule ? ` [${err.rule}]` : "";
        resultText = `Tool ${name} failed${ruleMsg}: ${err?.message ||
          "unknown error"}`;
        console.warn("zedAssistant.coder tool error", {
          name,
          rule: err?.rule,
          message: err?.message,
        });
      }
      toolCalls.push({name, input, ok: !isError, output: resultText});
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: String(resultText).slice(0, 12_000),
        ...(isError ? {is_error: true} : {}),
      });
      if (name === "finish") finishSeen = true;
    }
    conversation.push({role: "user", content: toolResults});

    if (finishSeen) {
      return {
        toolCalls,
        stopReason: "finish",
        lastText: extractTextBlocks(assistantContent),
        iterations,
      };
    }
  }

  return {
    toolCalls,
    stopReason: "max_iterations",
    lastText: lastResponse ? extractTextBlocks(lastResponse.content || []) : "",
    iterations,
  };
}

module.exports = {
  runCoderAgent,
  CODER_SYSTEM_PROMPT,
  MAX_ITERATIONS,
};
