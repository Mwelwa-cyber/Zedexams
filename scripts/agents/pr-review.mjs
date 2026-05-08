#!/usr/bin/env node
/**
 * Rex — Code Reviewer.
 *
 * Pulls the diff for a pull request, asks Claude to review it against
 * ZedExams' repo conventions, and posts the result as a single PR
 * review comment. Designed to run inside `.github/workflows/agent-pr-review.yml`.
 *
 * Required environment:
 *   ANTHROPIC_API_KEY  — repo secret
 *   GITHUB_TOKEN       — provided automatically by Actions
 *   GITHUB_REPOSITORY  — e.g. "mwelwa-cyber/Zedexams"
 *   PR_NUMBER          — set from the workflow event
 *
 * Optional:
 *   ANTHROPIC_MODEL    — override default model
 *   MAX_DIFF_BYTES     — diff size cap before truncation (default 60_000)
 */

import {Octokit} from "@octokit/rest";

const SYSTEM_PROMPT = [
  "You are Rex, ZedExams' Code Reviewer. You read like a senior engineer",
  "who has seen this codebase grow. You are direct, never verbose.",
  "",
  "What you check, in order:",
  "1. Secrets — no hard-coded API keys, tokens, or .env values in the diff.",
  "2. Firestore rules + indexes — any change to firestore.rules must keep",
  "   aiGenerations create:false for clients. New collections need rules",
  "   AND an index entry if they're queried.",
  "3. Schema changes — edits to functions/teacherTools/*Schema.js must keep",
  "   aiGenerations docs backwards-compatible.",
  "4. Anthropic cost regressions — new callAnthropic invocations must pass",
  "   through usageMeter.js with a real ownerUid (or agent:<id>).",
  "5. Repo conventions — no new top-level docs unless the PR description",
  "   says so; no emojis in code; comments explain WHY not WHAT.",
  "",
  "Report format (Markdown):",
  "## Rex review",
  "",
  "**Verdict:** approve | comment | request_changes",
  "",
  "### Findings",
  "- file:line — short description",
  "",
  "### Nits (optional)",
  "- file:line — short description",
  "",
  "Constraints:",
  "- Cite file:line for every finding.",
  "- One review per PR sync. Do not spam.",
  "- If diff is huge (>500 lines changed), say so and review the most",
  "  load-bearing files first; flag the rest as 'spot-checked'.",
  "- Output ONLY the review markdown, no preamble.",
].join("\n");

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function callAnthropic({apiKey, systemPrompt, userPrompt, model}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{role: "user", content: userPrompt}],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text;
}

async function main() {
  const anthropicKey = envOrDie("ANTHROPIC_API_KEY");
  const ghToken = envOrDie("GITHUB_TOKEN");
  const repoEnv = envOrDie("GITHUB_REPOSITORY");
  const prNumber = Number(envOrDie("PR_NUMBER"));
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const maxDiffBytes = Number(process.env.MAX_DIFF_BYTES || "60000");

  const [owner, repo] = repoEnv.split("/");
  const octokit = new Octokit({auth: ghToken});

  const {data: pr} = await octokit.pulls.get({owner, repo, pull_number: prNumber});

  // Fetch the unified diff. The Octokit `format` opt asks GitHub for the
  // text/plain diff so we don't have to walk per-file pages ourselves.
  const diffRes = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {format: "diff"},
  });
  let diff = String(diffRes.data || "");
  const originalLength = diff.length;
  let truncated = false;
  if (diff.length > maxDiffBytes) {
    diff = diff.slice(0, maxDiffBytes);
    truncated = true;
  }

  const userPrompt = [
    `# PR #${prNumber}: ${pr.title}`,
    "",
    pr.body ? `Author description:\n${pr.body}\n` : "",
    `Branch: ${pr.head.ref} -> ${pr.base.ref}`,
    `Changed files: ${pr.changed_files}, +${pr.additions} / -${pr.deletions}`,
    truncated ?
      `\n*Diff truncated to ${maxDiffBytes} bytes (full diff was ${originalLength} bytes).*\n` :
      "",
    "",
    "## Diff",
    "```diff",
    diff,
    "```",
  ].join("\n");

  let review;
  try {
    review = await callAnthropic({apiKey: anthropicKey, systemPrompt: SYSTEM_PROMPT, userPrompt, model});
  } catch (err) {
    console.error("Anthropic call failed:", err);
    process.exit(1);
  }

  const fullBody = [
    review,
    "",
    "<sub>— Rex (automated). See [docs/AGENTS.md](../blob/main/docs/AGENTS.md).</sub>",
  ].join("\n");

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body: fullBody,
    event: "COMMENT",
  });

  console.log(`Posted Rex review on PR #${prNumber}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
