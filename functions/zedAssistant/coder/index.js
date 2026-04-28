/**
 * Coder entrypoint — handleCodeTask().
 *
 * Glue layer that:
 *   1. Generates a fresh branch name (zed/<slug>-<ts>) and creates it.
 *   2. Spins up a per-task tool runner.
 *   3. Calls runCoderAgent.
 *   4. If anything was written, opens a draft PR. If not, no PR.
 *   5. Persists an audit record at zedAssistantCoderTasks/{taskId}.
 *   6. Returns a one-line reply for the chat.
 *
 * Triggered indirectly: the webhook drops a doc into
 * zedAssistantCoderTasks with status: "queued"; runner.js (an
 * onDocumentCreated Firestore trigger with a 540-second timeout) picks
 * it up and calls this function. The webhook itself returns immediately.
 */

const admin = require("firebase-admin");

const github = require("./github");
const {makeBranchName, RedLineError} = require("./redLine");
const {runCoderAgent} = require("./agent");
const {buildToolDefinitions, buildToolRunner} = require("./tools");
const {isRateLimitError} = require("../../anthropicFetch");

const SLUG_FROM_TASK_LIMIT = 60;

function slugFromTask(task) {
  return String(task || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_FROM_TASK_LIMIT) || "task";
}

function buildPrBody({task, summary, writes, toolCalls, stopReason}) {
  const fileList = writes.length ?
    writes.map((w) => `- \`${w.path}\` (${w.op})`).join("\n") :
    "_No file changes._";
  const failedRedLines = toolCalls
    .filter((c) => !c.ok && /Red line:/i.test(c.output || ""))
    .map((c) => `- \`${c.name}\` ${c.input?.path || ""} → ${c.output}`)
    .slice(0, 10);
  return [
    "## Task",
    "",
    "> " + String(task).split("\n").join("\n> "),
    "",
    "## Summary",
    "",
    summary || "_(no summary provided)_",
    "",
    "## Files",
    "",
    fileList,
    "",
    failedRedLines.length ? "## Red-line bounces" : "",
    failedRedLines.length ? "" : "",
    failedRedLines.length ? failedRedLines.join("\n") : "",
    "",
    "---",
    `_stop_reason: \`${stopReason}\`, tool_calls: ${toolCalls.length}, ` +
    `writes: ${writes.length}_`,
    "",
    "_Opened by Zed. Draft — review and merge manually._",
  ].filter((line) => line !== undefined).join("\n");
}

async function persistAudit(taskRef, record) {
  if (!taskRef) return;
  try {
    await taskRef.set({
      ...record,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn("zedAssistant.coder persistAudit failed", err?.message);
  }
}

/**
 * Entry point.
 *
 * @param {object} args
 * @param {string} args.task               Task description from /code.
 * @param {string} args.requestedBy        Free-text identifier (chat id,
 *                                         phone, etc.) for the audit log.
 * @param {string} args.anthropicKey
 * @param {string} args.githubToken
 * @param {FirebaseFirestore.DocumentReference} [args.taskRef]
 *        If provided, audit updates write to this existing doc. Otherwise
 *        a new zedAssistantCoderTasks doc is created.
 * @returns {Promise<{ok, prUrl?, message, taskId, writes, stopReason}>}
 */
async function handleCodeTask({
  task,
  requestedBy,
  anthropicKey,
  githubToken,
  taskRef,
}) {
  const trimmedTask = String(task || "").trim();
  if (!trimmedTask) {
    return {
      ok: false,
      message: "Empty task. Try: /code <what you want changed>",
      taskId: null,
      writes: [],
      stopReason: "empty_task",
    };
  }
  if (!githubToken) {
    return {
      ok: false,
      message:
        "I'm not configured to open PRs yet — the GitHub token isn't set. " +
        "Set ZED_GITHUB_TOKEN and redeploy.",
      taskId: null,
      writes: [],
      stopReason: "no_github_token",
    };
  }

  const auditRef = taskRef || admin.firestore()
    .collection("zedAssistantCoderTasks").doc();
  const taskId = auditRef.id;
  const branch = makeBranchName(slugFromTask(trimmedTask));

  await persistAudit(auditRef, {
    task: trimmedTask,
    requestedBy: requestedBy || null,
    branch,
    status: "running",
    ...(taskRef ? {} : {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  });

  let octokit;
  try {
    octokit = github.makeOctokit(githubToken);
  } catch (err) {
    await persistAudit(auditRef, {
      status: "failed",
      finishReason: "octokit_init",
      error: err?.message,
    });
    return {
      ok: false,
      taskId,
      writes: [],
      stopReason: "octokit_init",
      message: `Couldn't init GitHub client: ${err?.message}`,
    };
  }

  try {
    await github.createBranch(octokit, branch);
  } catch (err) {
    await persistAudit(auditRef, {
      status: "failed",
      finishReason: "create_branch",
      error: err?.message,
    });
    return {
      ok: false,
      taskId,
      writes: [],
      stopReason: "create_branch",
      message:
        `Couldn't create branch ${branch}: ${err?.message}. ` +
        "Check the GitHub token has Contents: Read & Write.",
    };
  }

  const tools = buildToolDefinitions();
  const {runTool, getState} = buildToolRunner({octokit, branch});

  let agentResult;
  try {
    agentResult = await runCoderAgent(anthropicKey, {
      task: trimmedTask,
      branch,
      runTool,
      tools,
    });
  } catch (err) {
    const state = getState();
    const rateLimited = isRateLimitError(err);
    await persistAudit(auditRef, {
      status: "failed",
      finishReason: rateLimited ? "rate_limited" : "agent_error",
      error: err?.message,
      branch,
      writes: state.writes,
    });
    const message = rateLimited ?
      "Hit the AI rate limit while working on that — the org-level " +
      "tokens-per-minute quota was exhausted and retries didn't recover. " +
      "Try a smaller task, or wait a minute and run /code again." :
      `Agent crashed: ${err?.message}`;
    return {
      ok: false,
      taskId,
      writes: state.writes,
      stopReason: rateLimited ? "rate_limited" : "agent_error",
      message,
    };
  }

  const state = getState();
  const finishCall = state.finishCall;
  const writes = state.writes;
  const summary = finishCall?.summary || agentResult.lastText ||
    "(no summary from agent)";
  const finishOk = finishCall ? finishCall.ok : false;

  // Open a draft PR if the agent committed anything. Otherwise — even on
  // a happy finish — there's nothing to review.
  let prUrl = null;
  let prNumber = null;
  if (writes.length > 0) {
    try {
      const pr = await github.openPullRequest(octokit, {
        branch,
        title: `zed: ${trimmedTask.slice(0, 80)}`,
        body: buildPrBody({
          task: trimmedTask,
          summary,
          writes,
          toolCalls: agentResult.toolCalls,
          stopReason: agentResult.stopReason,
        }),
      });
      prUrl = pr.url;
      prNumber = pr.number;
    } catch (err) {
      await persistAudit(auditRef, {
        status: "failed",
        finishReason: "open_pr",
        error: err?.message,
        branch,
        writes,
      });
      return {
        ok: false,
        taskId,
        writes,
        stopReason: "open_pr",
        message:
          `Made ${writes.length} commit(s) on \`${branch}\` but couldn't ` +
          `open the PR: ${err?.message}. The branch is on GitHub — open ` +
          "the PR manually.",
      };
    }
  }

  const finalStatus = (finishOk && writes.length > 0 && prUrl) ?
    "completed" :
    (writes.length === 0 ? "no_changes" : "completed_with_warnings");

  await persistAudit(taskId, {
    status: finalStatus,
    finishReason: agentResult.stopReason,
    branch,
    writes,
    summary,
    prUrl,
    prNumber,
    iterations: agentResult.iterations,
    toolCalls: agentResult.toolCalls.map((c) => ({
      name: c.name,
      ok: c.ok,
      path: c.input?.path,
    })),
  });

  if (writes.length === 0) {
    const reason = finishOk ?
      "agent finished without writing any files" :
      `agent gave up (${agentResult.stopReason})`;
    return {
      ok: false,
      taskId,
      writes,
      stopReason: agentResult.stopReason,
      message:
        `No PR opened — ${reason}.\n\n` +
        `Summary: ${summary || "(none)"}`,
    };
  }

  return {
    ok: true,
    taskId,
    writes,
    prUrl,
    prNumber,
    branch,
    stopReason: agentResult.stopReason,
    message:
      `Draft PR opened: ${prUrl}\n` +
      `Branch: \`${branch}\`\n` +
      `Files: ${writes.length}\n\n` +
      summary,
  };
}

module.exports = {
  handleCodeTask,
  RedLineError,
};
