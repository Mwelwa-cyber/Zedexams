/**
 * Draft a safe, focused prompt for Claude Code / Codex.
 *
 * The assistant doesn't execute code changes — it produces a prompt the user
 * can paste into Claude Code or another coding agent. This tool ensures the
 * prompt has the safety scaffolding the user wants by default:
 *   - read-only investigation first
 *   - explicit "do not change without confirmation" language
 *   - scoped file-paths if provided
 *   - acceptance criteria + verification step
 *
 * The model fills in the body. This tool just shapes the wrapper.
 */

const definition = {
  name: "draft_codex_prompt",
  description:
    "Draft a safe Claude Code / Codex prompt for a specific ZedExams fix " +
    "or feature. Use when the user says 'write a prompt to fix X' or " +
    "'give me a Claude prompt for Y'. The output is a copy-pasteable prompt " +
    "with built-in safety rails: read-first, confirm-before-changing, " +
    "explicit acceptance criteria. Always returns text — never executes code.",
  input_schema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        minLength: 5,
        maxLength: 400,
        description:
          "What the user wants Claude Code to accomplish, in one sentence.",
      },
      area: {
        type: "string",
        description:
          "Which part of the codebase is affected (e.g. 'quiz editor', " +
          "'games hub', 'firestore rules', 'leaderboard'). Used to scope " +
          "the prompt's investigation list.",
      },
      filePaths: {
        type: "array",
        items: {type: "string"},
        description:
          "Optional list of suspected file paths to scope the work to.",
        maxItems: 8,
      },
      riskLevel: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "How risky the change is. 'high' (touching auth, payments, " +
          "rules, deploy) gets the strictest confirmation language.",
      },
      acceptanceCriteria: {
        type: "string",
        maxLength: 600,
        description:
          "Optional 'done means' description. If omitted, the prompt asks " +
          "the user to define this before any code is changed.",
      },
    },
    required: ["goal"],
  },
};

function safetyHeader(riskLevel) {
  const base = [
    "Do not change any code or configuration until you have read the " +
    "relevant files and told me your plan in plain English.",
    "Wait for my explicit YES before editing files, running migrations, " +
    "deleting data, or pushing.",
  ];
  if (riskLevel === "high") {
    base.push(
      "This is HIGH RISK (auth / rules / payments / deploy). Treat every " +
      "change as destructive until proven otherwise. Prefer dry-runs and " +
      "feature flags over in-place edits.",
    );
  }
  return base.map((line) => `- ${line}`).join("\n");
}

function investigationStep(area, filePaths) {
  const targets = (filePaths || []).filter(Boolean).slice(0, 8);
  const filesBlock = targets.length ?
    `Start by reading:\n${targets.map((p) => `  - ${p}`).join("\n")}` :
    `Start by locating the files for this area${area ? ` ("${area}")` : ""}` +
      ` with grep/glob, then read them in full before forming a hypothesis.`;
  return filesBlock;
}

function run(input = {}) {
  const goal = String(input.goal || "").trim();
  const area = String(input.area || "").trim();
  const riskLevel = ["low", "medium", "high"]
    .includes(input.riskLevel) ? input.riskLevel : "medium";
  const acceptance = String(input.acceptanceCriteria || "").trim();

  if (!goal) {
    throw new Error("draft_codex_prompt requires a goal.");
  }

  const sections = [];
  sections.push(`# Task\n${goal}`);
  if (area) sections.push(`# Area\n${area}`);
  sections.push(`# Safety rules\n${safetyHeader(riskLevel)}`);
  sections.push(
    "# Step 1 — Investigate (read-only)\n" +
      investigationStep(area, input.filePaths) + "\n\n" +
      "After reading, summarize for me: (a) the current behavior, " +
      "(b) the suspected root cause, (c) the smallest change that fixes it, " +
      "(d) anything you're unsure about. Do not edit yet.",
  );
  sections.push(
    "# Step 2 — Plan + confirm\n" +
      "Reply with the plan. Wait for my YES.",
  );
  sections.push(
    "# Step 3 — Implement\n" +
      "Make the smallest possible change. Don't refactor unrelated code. " +
      "Don't add backwards-compat shims. Don't add comments explaining " +
      "what the code does — only why, when non-obvious.",
  );
  sections.push(
    "# Step 4 — Verify\n" +
      "Run the type checker / build / tests that cover the change. " +
      "If a UI change, start the dev server and exercise the feature in " +
      "the browser. Report what you ran and what passed.",
  );
  sections.push(
    "# Step 5 — Open a PR\n" +
      "Open a single PR with a tight title and a body that explains the " +
      "fix and how to test it. Do not deploy directly.",
  );
  sections.push(
    "# Acceptance criteria\n" + (
      acceptance ||
      "I will tell you. Ask me before you start coding if it is not " +
      "obvious from the goal above."
    ),
  );

  const prompt = sections.join("\n\n");
  return {
    prompt,
    instructions:
      "Copy the text above into Claude Code or Codex. The agent will " +
      "investigate first and ask before changing anything.",
  };
}

module.exports = {definition, run};
