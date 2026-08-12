#!/usr/bin/env node
/**
 * Ledger — Release Notes & Changelog.
 *
 * Lists the PRs that landed on `main` since the changelog was last written,
 * asks Claude to bucket them into Added / Changed / Fixed / Security /
 * Removed, and opens a draft PR with the result.
 *
 * Selection rules (which commits, over what range, minus Ledger's own) live in
 * ./releaseNotesCore.mjs so they are testable — see the note there about the
 * `--merges` bug that made this agent a no-op on a squash-merged trunk.
 *
 * Required environment:
 *   ANTHROPIC_API_KEY — repo secret
 *   GITHUB_TOKEN      — provided by Actions
 *   GITHUB_REPOSITORY — e.g. "mwelwa-cyber/Zedexams"
 *
 * Optional:
 *   ANTHROPIC_MODEL   — override default model
 *   DRY_RUN           — when "true", print the patch instead of opening a PR
 */

import {execSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {Octokit} from "@octokit/rest";
import {
  buildGitLogArgs,
  findLastDatedHeading,
  insertSection,
  selectCommits,
} from "./releaseNotesCore.mjs";

const CHANGELOG_PATH = "docs/CHANGELOG.md";

const SYSTEM_PROMPT = [
  "You are Ledger, ZedExams' Release Notes agent. You write short,",
  "scannable, user-visible release notes. No commit hashes. PR numbers",
  "(#123) are fine. Group changes under: Added, Changed, Fixed, Security,",
  "Removed. Drop pure chore/refactor unless they affect users.",
  "",
  "Output exactly the new section to insert under '## Unreleased' in",
  "docs/CHANGELOG.md. Use this shape:",
  "",
  "## YYYY-MM-DD",
  "",
  "### Added",
  "- Sentence about a user-visible thing. (#123)",
  "",
  "### Fixed",
  "- Sentence about a fix. (#456)",
  "",
  "Constraints:",
  "- Each line is one sentence.",
  "- Skip empty groups.",
  "- No invented features. If a commit is unclear, omit it.",
  "- No prose outside the changelog block.",
].join("\n");

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function git(args) {
  // execFileSync-style argv via execSync would need quoting; keep execSync but
  // pass argv already shaped by the core so there is nothing to interpolate.
  return execSync(`git ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
    encoding: "utf8",
  });
}

/**
 * The commit that last touched the changelog — the exact boundary for
 * "what has landed since we last wrote one". Empty when the file has no
 * history yet, in which case the caller falls back to the date heading.
 */
function lastChangelogCommit() {
  try {
    return git(["log", "-1", "--format=%H", "--", CHANGELOG_PATH]).trim();
  } catch (err) {
    console.warn(`Could not resolve the changelog's last commit: ${err.message}`);
    return "";
  }
}

function gitLog({sinceSha, sinceDate}) {
  try {
    return git(buildGitLogArgs({sinceSha, sinceDate}));
  } catch (err) {
    // A failed range read is NOT "nothing landed" — say so rather than
    // letting an empty string exit quietly as if the trunk were idle.
    console.error("git log failed:", err.message);
    process.exit(1);
  }
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
      max_tokens: 1500,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{role: "user", content: userPrompt}],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function main() {
  const anthropicKey = envOrDie("ANTHROPIC_API_KEY");
  const ghToken = envOrDie("GITHUB_TOKEN");
  const repoEnv = envOrDie("GITHUB_REPOSITORY");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";

  const [owner, repo] = repoEnv.split("/");
  const octokit = new Octokit({auth: ghToken});

  const existing = readFileSync(CHANGELOG_PATH, "utf8");
  const lastDate = findLastDatedHeading(existing);
  const sinceSha = lastChangelogCommit();
  const commits = selectCommits(gitLog({sinceSha, sinceDate: lastDate}));

  if (commits.length === 0) {
    console.log("Nothing landed on main since the last changelog entry. Exiting.");
    return;
  }
  console.log(
    `Summarising ${commits.length} commit(s) since ` +
    `${sinceSha ? sinceSha.slice(0, 8) : lastDate || "the last 14 days"}.`,
  );

  const userPrompt = [
    `Last dated changelog entry: ${lastDate || "(none — first run)"}.`,
    "",
    "Pull requests that landed, one per line as short-sha|subject:",
    "```",
    commits.join("\n").slice(0, 20000),
    "```",
    "",
    `Today's date is ${new Date().toISOString().slice(0, 10)}. Use it as`,
    "the section heading.",
  ].join("\n");

  const newSection = await callAnthropic({
    apiKey: anthropicKey,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    model,
  });

  // Insert the new section right after the "## Unreleased" line.
  // If "## Unreleased" isn't there, prepend after the file title.
  const updated = insertSection(existing, newSection);

  if (dryRun) {
    console.log("--- proposed changelog patch ---");
    console.log(newSection);
    return;
  }

  // Open a branch + PR with the changelog update.
  const branch = `agent/ledger/changelog-${new Date().toISOString().slice(0, 10)}`;

  // Use the GitHub REST API to create a branch and commit the file.
  const {data: mainRef} = await octokit.git.getRef({
    owner,
    repo,
    ref: "heads/main",
  });

  // Create the branch if it doesn't exist; otherwise update it.
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: mainRef.object.sha,
    });
  } catch (err) {
    if (err.status !== 422) throw err;
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: mainRef.object.sha,
      force: true,
    });
  }

  // Get the file SHA on the branch (just-created from main).
  const {data: fileSnap} = await octokit.repos.getContent({
    owner,
    repo,
    path: CHANGELOG_PATH,
    ref: branch,
  });

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: CHANGELOG_PATH,
    branch,
    message: `chore(changelog): Ledger draft for ${new Date().toISOString().slice(0, 10)}`,
    content: Buffer.from(updated, "utf8").toString("base64"),
    sha: fileSnap.sha,
  });

  // Open the PR, or reuse an existing one for the same head branch.
  // The branch is named per-day, so a second run on the same day re-uses
  // it (the createOrUpdateFileContents call above already pushed the
  // latest changelog onto the existing branch). pulls.create returns
  // 422 "A pull request already exists for <branch>" in that case —
  // catch it and look up the existing PR rather than failing the job.
  let pr;
  try {
    const created = await octokit.pulls.create({
      owner,
      repo,
      head: branch,
      base: "main",
      title: `chore: changelog for ${new Date().toISOString().slice(0, 10)}`,
      body: [
        "Drafted by Ledger (release-notes agent).",
        "",
        "Review the bucketed changes below; merge when happy.",
        "",
        "<sub>See [docs/AGENTS.md](../blob/main/docs/AGENTS.md).</sub>",
      ].join("\n"),
      draft: false,
    });
    pr = created.data;
    console.log(`Opened changelog PR: ${pr.html_url}`);
  } catch (err) {
    const alreadyExists =
      err && err.status === 422 &&
      /already exists/i.test(JSON.stringify(err.response && err.response.data || ""));
    if (!alreadyExists) throw err;
    const {data: open} = await octokit.pulls.list({
      owner, repo, head: `${owner}:${branch}`, state: "open",
    });
    if (open.length === 0) {
      throw new Error(
        `pulls.create returned 422 'already exists' for ${branch}, ` +
        `but pulls.list found no open PR for that head. Branch may be stale; ` +
        `delete it and re-run.`,
      );
    }
    pr = open[0];
    console.log(`Updated existing changelog PR in place: ${pr.html_url}`);
  }

  // Self-cleaning: close any *older* open changelog PRs from Ledger so at most
  // one is ever open at a time. Each day's run opens a fresh per-day branch and
  // nothing merges the previous ones, so without this they pile up indefinitely.
  try {
    const {data: openPRs} = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 100,
    });
    const stale = openPRs.filter(
      (p) =>
        p.number !== pr.number &&
        typeof (p.head && p.head.ref) === "string" &&
        p.head.ref.startsWith("agent/ledger/changelog-"),
    );
    for (const old of stale) {
      await octokit.pulls.update({
        owner, repo, pull_number: old.number, state: "closed",
      });
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: old.number,
        body: `Superseded by #${pr.number} (newer changelog draft). ` +
          "Closed automatically by Ledger.",
      });
      // Delete the stale branch so it doesn't linger.
      await octokit.git.deleteRef({
        owner, repo, ref: `heads/${old.head.ref}`,
      }).catch((err) => {
        console.warn(`Could not delete branch ${old.head.ref}: ${err.message}`);
      });
      console.log(`Superseded older changelog PR #${old.number} (${old.head.ref}).`);
    }
  } catch (err) {
    console.warn(`Failed to supersede older changelog PRs: ${err.message}`);
  }

  // Force ci.yml to run on the new branch. PRs opened by GITHUB_TOKEN don't
  // fire downstream workflows, so the required `Lint` + `Tests` checks would
  // never report and the PR would stay BLOCKED. workflow_dispatch is the one
  // event GitHub allows GITHUB_TOKEN to trigger.
  try {
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "ci.yml",
      ref: branch,
    });
    console.log(`Dispatched ci.yml against ${branch}.`);
  } catch (err) {
    console.warn(
      `Failed to dispatch ci.yml against ${branch}: ${err.message}. ` +
      `PR may stay BLOCKED until a human kicks CI.`,
    );
  }

  // Save the patch locally too in case the action wants to upload it.
  writeFileSync("/tmp/ledger-patch.md", newSection);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
