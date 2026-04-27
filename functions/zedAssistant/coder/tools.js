/**
 * Anthropic tool definitions + runner for the coder agent.
 *
 * Tool surface (deliberately small):
 *
 *   list_files   read-only directory listing
 *   read_file    read-only file fetch
 *   search_code  GitHub code search across the repo
 *   write_file   write through the red-line gate
 *   delete_file  delete through the red-line gate
 *   finish       agent declares the task complete (or impossible)
 *
 * No run_command, no install, no rename — every change goes through one of
 * the gated wrapper functions in github.js.
 */

const github = require("./github");
const {RedLineError, MAX_WRITES_PER_TASK} = require("./redLine");

function buildToolDefinitions() {
  return [
    {
      name: "list_files",
      description:
        "List files and directories at a given path in the repo. Use this " +
        "to explore the codebase before reading or editing. Pass an empty " +
        "string to list the repo root.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo path to list (e.g. 'src/components' or '').",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "read_file",
      description:
        "Read the full contents of a file at the given path on the working " +
        "branch. Returns the file's text and its current sha.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative path of the file to read.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "search_code",
      description:
        "Search the repo for a code substring or symbol via GitHub code " +
        "search. Returns up to 20 matching files with paths.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'function generateQuiz').",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "write_file",
      description:
        "Create or overwrite a file on the working branch. Refuses paths " +
        "on the red line (firestore rules, package.json, .env, .github/, " +
        "secrets, etc.). Always provide the FULL new file contents — this " +
        "is not a patch tool.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative path of the file to create or update.",
          },
          content: {
            type: "string",
            description:
              "Full new contents of the file. Existing content is replaced.",
          },
          message: {
            type: "string",
            description: "One-line commit message for this write.",
          },
        },
        required: ["path", "content", "message"],
      },
    },
    {
      name: "delete_file",
      description:
        "Delete a file on the working branch. Subject to the same red-line " +
        "rules as write_file. Use sparingly.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative path of the file to delete.",
          },
          message: {
            type: "string",
            description: "One-line commit message for the deletion.",
          },
        },
        required: ["path", "message"],
      },
    },
    {
      name: "finish",
      description:
        "Call this exactly once when the task is complete OR when you've " +
        "decided the task is impossible. Pass a short summary that will " +
        "become the PR body and the chat reply. Set ok=false if you bailed.",
      input_schema: {
        type: "object",
        properties: {
          ok: {
            type: "boolean",
            description: "true if task completed; false if you gave up.",
          },
          summary: {
            type: "string",
            description:
              "1–6 sentences of what changed and why. Used as the PR body.",
          },
        },
        required: ["ok", "summary"],
      },
    },
  ];
}

/**
 * Build a tool runner closed over the Octokit client and working branch.
 * Each task gets its own runner (and its own write counter).
 *
 * @param {object} ctx
 * @param {import("@octokit/rest").Octokit} ctx.octokit
 * @param {string} ctx.branch
 * @returns {{runTool: Function, getState: Function}}
 */
function buildToolRunner({octokit, branch}) {
  const writes = []; // [{path, sha, message, op}]
  let finishCall = null;

  async function runTool(name, input) {
    if (finishCall) {
      // Once finish has been called, any further tool calls are ignored.
      return "Task already finished. No further tools will run.";
    }
    switch (name) {
      case "list_files": {
        const items = await github.listFiles(octokit, {
          path: input?.path || "",
          branch,
        });
        if (!items.length) return "(empty or path not found)";
        return items
          .map((it) => `${it.type === "dir" ? "DIR  " : "FILE "}${it.path}`)
          .join("\n");
      }
      case "read_file": {
        const file = await github.getFile(octokit, {
          path: input?.path,
          branch,
        });
        if (!file) return `File not found: ${input?.path}`;
        // Cap returned content; the agent.js loop also caps tool output to
        // 12k chars but we cap here too so we don't waste tokens reading
        // huge files in full.
        const max = 12_000;
        if (file.content.length <= max) return file.content;
        return (
          file.content.slice(0, max) +
          `\n\n... [truncated; file is ${file.size} bytes]`
        );
      }
      case "search_code": {
        const results = await github.searchCode(octokit, {
          query: input?.query,
        });
        if (!results.length) return "No matches.";
        return results.map((r) => `${r.path}`).join("\n");
      }
      case "write_file": {
        if (writes.length >= MAX_WRITES_PER_TASK) {
          throw new RedLineError(
            "scope_cap_exceeded",
            `> ${MAX_WRITES_PER_TASK} writes`,
          );
        }
        const result = await github.putFile(octokit, {
          path: input?.path,
          content: String(input?.content ?? ""),
          branch,
          message: input?.message,
        });
        writes.push({
          op: result.created ? "create" : "update",
          path: result.path,
          sha: result.sha,
          message: input?.message,
        });
        return `Wrote ${result.path} (${result.created ? "created" : "updated"})`;
      }
      case "delete_file": {
        if (writes.length >= MAX_WRITES_PER_TASK) {
          throw new RedLineError(
            "scope_cap_exceeded",
            `> ${MAX_WRITES_PER_TASK} writes`,
          );
        }
        const result = await github.deleteFile(octokit, {
          path: input?.path,
          branch,
          message: input?.message,
        });
        writes.push({
          op: "delete",
          path: result.path,
          sha: null,
          message: input?.message,
        });
        return `Deleted ${result.path}`;
      }
      case "finish": {
        finishCall = {
          ok: Boolean(input?.ok),
          summary: String(input?.summary || "").trim(),
        };
        return "Acknowledged. Stopping the loop.";
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  function getState() {
    return {
      writes: [...writes],
      finishCall: finishCall ? {...finishCall} : null,
      writeCount: writes.length,
    };
  }

  return {runTool, getState};
}

module.exports = {
  buildToolDefinitions,
  buildToolRunner,
};
