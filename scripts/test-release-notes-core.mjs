#!/usr/bin/env node
/**
 * Ledger selection rules (scripts/agents/releaseNotesCore.mjs).
 *
 * The regression that matters most is the one that made Ledger a silent no-op:
 * `--merges` on a squash-merged trunk selects nothing, and "nothing to
 * summarise" reads exactly like a quiet day. The first test below fails if the
 * flag ever goes back.
 */

import assert from "node:assert";
import {execFileSync} from "node:child_process";
import {appendFileSync} from "node:fs";
import {
  LEDGER_COMMIT_RE,
  buildChangelogSection,
  buildGitLogArgs,
  bucketOf,
  findLastDatedHeading,
  insertSection,
  parseCommit,
  selectCommits,
} from "./agents/releaseNotesCore.mjs";
import {resolveTrunkRef} from "./gitTrunkRef.mjs";
import {
  GUARD_MODE_ENV,
  formatTrunkFinding,
  reportAdvisory,
  resolveGuardMode,
} from "./trunkGuardPolicy.mjs";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// --- buildGitLogArgs -------------------------------------------------------

ok("walks first-parent, never --merges", () => {
  const args = buildGitLogArgs({sinceDate: "2026-08-01"});
  assert.ok(args.includes("--first-parent"), "must select first-parent commits");
  assert.ok(
    !args.includes("--merges"),
    "--merges selects nothing on a squash-merged trunk; that is the bug",
  );
});

ok("prefers an exact commit range over the date floor", () => {
  const args = buildGitLogArgs({sinceSha: "abc1234", sinceDate: "2026-08-01"});
  assert.ok(args.includes("abc1234..HEAD"));
  assert.ok(
    !args.some((a) => a.startsWith("--since")),
    "a range and a date floor together would widen, not narrow, the window",
  );
});

ok("falls back to the date, then to 14 days", () => {
  assert.ok(buildGitLogArgs({sinceDate: "2026-08-01"}).includes("--since=2026-08-01"));
  assert.ok(buildGitLogArgs({}).includes("--since=14.days"));
});

ok("asks for no commit body", () => {
  const fmt = buildGitLogArgs({}).find((a) => a.startsWith("--pretty="));
  assert.ok(fmt.includes("%s"), "subject carries the type and the (#123)");
  assert.ok(
    !fmt.includes("%b"),
    "a squash body is the whole PR description: multi-line, so it breaks the " +
    "one-record-per-line contract, and long enough to blow the prompt cap",
  );
});

// --- selectCommits ---------------------------------------------------------

ok("drops Ledger's own commits in both spellings", () => {
  const raw = [
    "aaa1111|feat: add a thing (#1)",
    "bbb2222|chore: changelog for 2026-08-12 (#2)",
    "ccc3333|chore(changelog): Ledger draft for 2026-08-12",
    "ddd4444|fix: fix a thing (#3)",
  ].join("\n");
  const kept = selectCommits(raw);
  assert.deepStrictEqual(kept, [
    "aaa1111|feat: add a thing (#1)",
    "ddd4444|fix: fix a thing (#3)",
  ]);
});

ok("keeps a commit that merely mentions the changelog", () => {
  const raw = "eee5555|docs: explain how the changelog is generated (#4)";
  assert.deepStrictEqual(selectCommits(raw), [raw]);
});

ok("tolerates blank lines and a missing separator", () => {
  assert.deepStrictEqual(selectCommits("\n\n  \n"), []);
  assert.deepStrictEqual(selectCommits("no-separator-line"), ["no-separator-line"]);
  assert.deepStrictEqual(selectCommits(null), []);
});

ok("LEDGER_COMMIT_RE needs a real date, not the words alone", () => {
  assert.ok(!LEDGER_COMMIT_RE.test("chore: changelog for the release"));
  assert.ok(LEDGER_COMMIT_RE.test("chore: changelog for 2026-01-02"));
});

// --- findLastDatedHeading / insertSection ----------------------------------

ok("reads the first dated heading only", () => {
  const md = "# Changelog\n\n## Unreleased\n\n## 2026-08-12\n\n## 2026-08-01\n";
  assert.strictEqual(findLastDatedHeading(md), "2026-08-12");
  assert.strictEqual(findLastDatedHeading("# Changelog\n"), null);
});

ok("inserts under Unreleased, or seeds it after the title", () => {
  const withHeading = insertSection("# C\n\n## Unreleased\n\n## 2026-01-01\n", "## 2026-08-12\n\n- a");
  assert.ok(withHeading.indexOf("## 2026-08-12") > withHeading.indexOf("## Unreleased"));
  assert.ok(withHeading.indexOf("## 2026-08-12") < withHeading.indexOf("## 2026-01-01"));

  const seeded = insertSection("# C\n\nintro\n", "## 2026-08-12\n\n- a");
  assert.ok(seeded.includes("## Unreleased"));
  assert.ok(seeded.includes("## 2026-08-12"));
});

ok("an empty section is never written", () => {
  const before = "# C\n\n## Unreleased\n";
  assert.strictEqual(insertSection(before, "   "), before);
});

// --- parsing + rendering (the deterministic changelog) ---------------------

ok("lifts the PR number out of a squash subject", () => {
  const p = parseCommit("abc1234|fix(auth): stop the redirect loop (#2211)");
  assert.strictEqual(p.sha, "abc1234");
  assert.strictEqual(p.pr, 2211);
  assert.strictEqual(p.type, "fix");
  assert.strictEqual(p.scope, "auth");
  assert.strictEqual(p.text, "stop the redirect loop", "the prefix and the PR ref both come off");
});

ok("an unprefixed subject survives WORD FOR WORD", () => {
  // The whole premise of dropping the model: these are already good sentences.
  const subject = "Move the admin shell into src/features/adminShell";
  const p = parseCommit(`abc1234|${subject} (#2286)`);
  assert.strictEqual(p.type, null);
  assert.strictEqual(p.text, subject, "an unclassified subject must not be rewritten");
});

ok("buckets by prefix, and defaults the rest to Changed", () => {
  assert.strictEqual(bucketOf(parseCommit("a|feat: add a thing")), "Added");
  assert.strictEqual(bucketOf(parseCommit("a|fix: fix a thing")), "Fixed");
  assert.strictEqual(bucketOf(parseCommit("a|docs: write a thing")), "Documentation");
  assert.strictEqual(bucketOf(parseCommit("a|ci: wire a thing")), "Internal");
  assert.strictEqual(bucketOf(parseCommit("a|Move the admin shell")), "Changed");
});

ok("surfaces breaking changes and security scopes first", () => {
  assert.strictEqual(bucketOf(parseCommit("a|feat!: drop the v1 endpoint")), "Breaking");
  assert.strictEqual(bucketOf(parseCommit("a|fix(security): close an IDOR")), "Security");
});

ok("collapses Dependabot instead of printing 15 bullets", () => {
  const {section, stats} = buildChangelogSection([
    "a1|feat: add a thing (#1)",
    "b2|Build(deps-dev): bump tar from 7.5.16 to 7.5.22 (#2)",
    "c3|build(deps): bump undici (#3)",
  ], {date: "2026-08-12"});
  assert.strictEqual(stats.dependencies, 2);
  assert.ok(/_Dependencies: 2 automated bumps \(#2, #3\)\._/.test(section));
  assert.ok(!section.includes("bump tar"), "individual bumps stay out of the body");
});

ok("skips empty groups and orders headings", () => {
  const {section} = buildChangelogSection([
    "a1|Move a thing (#1)",
    "b2|feat: add a thing (#2)",
  ], {date: "2026-08-12"});
  assert.ok(!section.includes("### Fixed"), "an empty group is not printed");
  assert.ok(
    section.indexOf("### Added") < section.indexOf("### Changed"),
    "Added precedes Changed",
  );
  assert.ok(section.startsWith("## 2026-08-12"));
});

ok("reports what it classified versus merely listed", () => {
  // The PR body tells a human where to look; that number must be real.
  const {stats} = buildChangelogSection([
    "a1|feat: add a thing (#1)",
    "b2|Move a thing (#2)",
    "c3|Move another thing (#3)",
    "d4|build(deps): bump x (#4)",
  ], {date: "2026-08-12"});
  assert.deepStrictEqual(stats, {total: 4, dependencies: 1, classified: 1, listed: 2});
});

ok("renders no model-shaped placeholder when there is nothing but deps", () => {
  const {section} = buildChangelogSection(
    ["a1|build(deps): bump x (#4)"],
    {date: "2026-08-12"},
  );
  assert.ok(section.includes("_Dependencies: 1 automated bump (#4)._"));
  assert.ok(!/### /.test(section), "no empty headings when every commit was a bump");
});

// --- resolveTrunkRef -------------------------------------------------------
//
// Where the guard below points. On a pull_request build actions/checkout
// resolves the event to refs/pull/N/merge — GitHub's ephemeral merge of the PR
// into its base — so HEAD there has two parents and IS a merge commit.
// `git log --merges HEAD` on a pull request therefore always finds one: #2303
// failed with 'f222bc31' !== '' on a PR whose only change was a workflow file.
// The guard has to name the trunk rather than trust HEAD.

ok("a push build inspects HEAD", () => {
  const {ref, source} = resolveTrunkRef({}, () => true);
  assert.strictEqual(ref, "HEAD");
  assert.strictEqual(source, "head", "off a pull_request, HEAD really is the trunk");
});

ok("a blank GITHUB_BASE_REF counts as absent", () => {
  assert.strictEqual(resolveTrunkRef({GITHUB_BASE_REF: "   "}, () => true).ref, "HEAD");
});

ok("a pull_request build inspects the base branch, never HEAD", () => {
  const probed = [];
  const {ref, source} = resolveTrunkRef({GITHUB_BASE_REF: "main"}, (candidate) => {
    probed.push(candidate);
    return candidate === "origin/main";
  });
  assert.strictEqual(ref, "origin/main", "the trunk is the base branch GitHub fetched");
  assert.strictEqual(source, "base-ref");
  assert.ok(
    !probed.includes("HEAD"),
    "HEAD is refs/pull/N/merge on a PR — a merge commit by construction, so " +
    "inspecting it can only ever fail",
  );
});

ok("a base branch with a slash still resolves", () => {
  const {ref} = resolveTrunkRef(
    {GITHUB_BASE_REF: "release/2026-08"},
    (candidate) => candidate === "origin/release/2026-08",
  );
  assert.strictEqual(ref, "origin/release/2026-08");
});

ok("falls back to a local branch with no remote-tracking ref", () => {
  const {ref, source} = resolveTrunkRef({GITHUB_BASE_REF: "main"}, (c) => c === "main");
  assert.strictEqual(ref, "main");
  assert.strictEqual(source, "base-ref");
});

ok("an unfetched base branch skips loudly rather than falling back", () => {
  const {ref, source, reason} = resolveTrunkRef({GITHUB_BASE_REF: "main"}, () => false);
  assert.strictEqual(ref, null, "falling back to HEAD would resurrect the false failure");
  assert.strictEqual(source, "unavailable");
  assert.ok(
    /shallow/.test(reason),
    "the skip must say why: a guard that never runs reads exactly like one that passes",
  );
});

// --- trunk guard severity --------------------------------------------------
//
// The guard below reports on repository history. It used to be able to stop a
// deploy, which is how one merge commit from PR 583 took five Deploy Hosting
// runs down with it. Severity is chosen now, not inherited from where the
// check happens to run.

ok("enforcing is opt-in by name", () => {
  assert.strictEqual(resolveGuardMode({[GUARD_MODE_ENV]: "enforce"}), "enforce");
});

ok("every other context advises, including a deploy push", () => {
  assert.strictEqual(resolveGuardMode({}), "advise");
  assert.strictEqual(resolveGuardMode({[GUARD_MODE_ENV]: "1"}), "advise");
  assert.strictEqual(resolveGuardMode({[GUARD_MODE_ENV]: "ENFORCE"}), "advise");
  assert.strictEqual(resolveGuardMode(undefined), "advise");
});

ok("the finding names the commit, the ref, and how the ref was resolved", () => {
  const text = formatTrunkFinding({sha: "53a65f4", ref: "origin/main", source: "base-ref"});
  assert.ok(text.includes("53a65f4"), "the offending commit is the first thing to look at");
  assert.ok(text.includes("origin/main"));
  assert.ok(text.includes("base-ref"), "HEAD and origin/main fail for different reasons");
});

ok("an advisory is written to the step summary, not just stdout", () => {
  const writes = [];
  const written = reportAdvisory(
    "a merge commit landed",
    {GITHUB_STEP_SUMMARY: "/tmp/summary"},
    (path, body) => writes.push([path, body]),
  );
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0][0], "/tmp/summary");
  assert.ok(writes[0][1].includes("a merge commit landed"));
  assert.ok(
    writes[0][1].includes("[!WARNING]"),
    "run-all-tests.mjs hides a passing script stdout, so this has to be a summary block",
  );
  assert.ok(written !== null);
});

ok("nowhere to write is not a failure", () => {
  assert.strictEqual(reportAdvisory("finding", {}, () => {}), null);
  assert.strictEqual(
    reportAdvisory("finding", {GITHUB_STEP_SUMMARY: "/tmp/summary"}, () => {
      throw new Error("read-only file system");
    }),
    null,
    "a failed write must not turn an advisory back into the failure it replaced",
  );
});

// --- the trunk really is squash-merged -------------------------------------
//
// The premise behind the whole fix. If this repo ever adopts real merge
// commits, --first-parent still works, but the bug it replaced would no longer
// have been a bug — so record the shape rather than assume it.
//
// Scoped to the 14-day floor buildGitLogArgs falls back to, not all of
// history: main still carries pre-squash-policy merges (53a65f45, the merge of
// PR 583, is the newest), so asserting over every commit fails forever.
//
// Pointed at the RESOLVED trunk, not HEAD. On a pull_request actions/checkout
// resolves refs/pull/N/merge — a two-parent commit GitHub builds for the run —
// so HEAD is a merge commit by construction and the old query found it every
// time. #2303 proved it: a PR whose only change was a workflow file failed.
//
// ADVISORY here, ENFORCED by .github/workflows/agent-release-notes.yml. Ledger
// is what walks --first-parent, so Ledger output is what a merge commit would
// corrupt; a deploy is not. scripts/trunkGuardPolicy.mjs carries the reasoning.

ok("the recent trunk carries no merge commits", () => {
  const git = (args) =>
    execFileSync("git", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  const refExists = (candidate) => {
    try {
      git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  const {ref, source, reason} = resolveTrunkRef(process.env, refExists);
  const raise = (finding) => {
    if (resolveGuardMode(process.env) === "enforce") assert.fail(finding);
    reportAdvisory(finding, process.env, appendFileSync);
    console.log(`      (advisory: ${finding})`);
  };

  // A named base branch missing from the checkout is a config regression, not
  // a clean bill of health: ci.yml fetches full history on a pull_request, so
  // origin/$GITHUB_BASE_REF is always there. Say so rather than reporting ok
  // while testing nothing at all — the hole the original bug hid in.
  if (ref === null) {
    raise(reason);
    return;
  }

  let merges;
  try {
    merges = git([
      "log",
      "--merges",
      "--first-parent",
      "--since=14.days",
      "-n",
      "1",
      "--pretty=format:%h",
      ref,
    ]);
  } catch {
    raise(`the trunk ref ${ref} (via ${source}) could not be walked here`);
    return;
  }
  if (merges !== "") raise(formatTrunkFinding({sha: merges, ref, source}));
});

console.log(`\n${passed} release-notes core checks passed.`);
