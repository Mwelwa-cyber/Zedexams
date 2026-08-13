#!/usr/bin/env node
/**
 * Ledger — Release Notes & Changelog.
 *
 * Lists the PRs that landed on `main` since the changelog was last written,
 * groups them, and opens a draft PR with the result.
 *
 * NO MODEL CALL. This used to ask Claude to bucket the commits into
 * Added/Changed/Fixed and rewrite each into a sentence. It was measured and
 * dropped: only 39% of this repo's commits carry a conventional prefix, and 15
 * of those 21 are Dependabot, so ~15% of human commits are machine-classifiable
 * — but the unprefixed 61% are ALREADY well-formed sentences ("Move the admin
 * shell into src/features/adminShell"), so the model was mostly paraphrasing
 * good prose into different good prose. Printing the subjects verbatim under
 * light grouping loses almost nothing and costs nothing. Rules + rendering live
 * in ./releaseNotesCore.mjs so they are testable; see the note there about the
 * `--merges` bug that made this agent a no-op on a squash-merged trunk.
 *
 * When a release genuinely needs polished prose, invoke the `release-notes`
 * subagent on the drafted entry — that runs on a session, not on an API key.
 *
 * Required environment:
 *   GITHUB_TOKEN      — provided by Actions
 *   GITHUB_REPOSITORY — e.g. "mwelwa-cyber/Zedexams"
 *
 * Optional:
 *   DRY_RUN           — when "true", print the patch instead of opening a PR
 */

import {execSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Octokit} from "@octokit/rest";
import {
  CHANGELOG_PATH,
  buildChangelogSection,
  buildGitLogArgs,
  changelogBoundaryGitArgs,
  insertSection,
  resolveChangelogBoundary,
  selectCommits,
} from "./releaseNotesCore.mjs";


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
 *
 * The query itself is declared in the core, because the trunk guard has to ask
 * for the same boundary and a second spelling of it here is the drift.
 */
function lastChangelogCommit() {
  try {
    return git(changelogBoundaryGitArgs()).trim();
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


async function main() {
  const ghToken = envOrDie("GITHUB_TOKEN");
  const repoEnv = envOrDie("GITHUB_REPOSITORY");
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";

  const [owner, repo] = repoEnv.split("/");
  const octokit = new Octokit({auth: ghToken});

  const existing = readFileSync(CHANGELOG_PATH, "utf8");
  const {sinceSha, sinceDate} = resolveChangelogBoundary({
    changelogSha: lastChangelogCommit(),
    changelogContent: existing,
  });
  const commits = selectCommits(gitLog({sinceSha, sinceDate}));

  if (commits.length === 0) {
    console.log("Nothing landed on main since the last changelog entry. Exiting.");
    return;
  }
  console.log(
    `Summarising ${commits.length} commit(s) since ` +
    `${sinceSha ? sinceSha.slice(0, 8) : sinceDate || "the last 14 days"}.`,
  );

  const today = new Date().toISOString().slice(0, 10);
  const {section: newSection, stats} = buildChangelogSection(commits, {date: today});
  console.log(
    `${stats.classified} classified by conventional prefix, ${stats.listed} listed ` +
    `verbatim, ${stats.dependencies} dependency bump(s) collapsed.`,
  );

  // Insert the new section right after the "## Unreleased" line.
  // If "## Unreleased" isn't there, prepend after the file title.
  const updated = insertSection(existing, newSection);

  if (dryRun) {
    console.log("--- proposed changelog patch ---");
    console.log(newSection);
    return;
  }

  // Open a branch + PR with the changelog update.
  const branch = `agent/ledger/changelog-${today}`;

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
    message: `chore(changelog): Ledger draft for ${today}`,
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
      title: `chore: changelog for ${today}`,
      body: [
        "Drafted by Ledger. **No model was called** — this is assembled",
        "deterministically from the commit subjects, so it costs nothing.",
        "",
        `- **${stats.classified}** entries were bucketed from a conventional-commit prefix.`,
        `- **${stats.listed}** had no prefix and are listed VERBATIM under \`Changed\`.`,
        `- **${stats.dependencies}** automated dependency bump(s) collapsed to one line.`,
        "",
        "The verbatim entries are the ones to read: nothing classified them, so",
        "some may belong under a different heading. Edit this PR before merging",
        "— or, for a release that wants polished prose, invoke the",
        "`release-notes` subagent on the section (it runs on a session, not on",
        "an API key).",
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

  // Save the patch locally too in case the action wants to upload it. Written
  // inside a private mkdtemp directory, never at a fixed world-guessable /tmp
  // path another local user could pre-create or symlink.
  const patchDir = mkdtempSync(join(tmpdir(), "ledger-"));
  const patchPath = join(patchDir, "ledger-patch.md");
  writeFileSync(patchPath, newSection);
  console.log(`Saved the changelog patch to ${patchPath}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
