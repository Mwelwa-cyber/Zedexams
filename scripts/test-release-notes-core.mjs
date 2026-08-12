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

// --- the trunk really is squash-merged, within the window we walk ---------
//
// The premise behind the whole fix. If this repo ever adopts real merge
// commits, --first-parent still works, but the bug it replaced would no longer
// have been a bug — so record the shape rather than assume it.
//
// Scoped to the window buildGitLogArgs actually walks, not all of history.
// main still carries pre-squash-policy merges: 53a65f45, the merge of PR 583,
// is the newest, so asserting over every commit fails forever. It also only
// failed in one place: ci.yml checks out shallow, so the query saw nothing,
// while deploy-hosting.yml sets fetch-depth 0 and the assertion tripped on
// every push to main.
//
// The window is DERIVED from buildGitLogArgs() rather than restated, because
// 14 days is only that function's last-resort fallback: given a changelog
// commit it walks `<sha>..HEAD`, and given a dated heading it walks
// `--since=<that date>`. A hardcoded floor and the tool's real walk therefore
// agree only in the fallback case — on any other run the guard was inspecting
// a different range than the one a merge commit could actually corrupt, too
// wide after a same-day release and too narrow after a quiet fortnight.

/**
 * The revision selector buildGitLogArgs chose — the last element, either a
 * `<sha>..HEAD` range or a `--since=…` floor. Everything before it is
 * formatting flags.
 */
function walkedRevisionSelector(args) {
  return args[args.length - 1];
}

ok("the recent trunk carries no merge commits", () => {
  const selector = walkedRevisionSelector(buildGitLogArgs());
  let merges;
  try {
    merges = execFileSync(
      "git",
      ["log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h", selector],
      {encoding: "utf8"},
    ).trim();
  } catch {
    console.log("      (skipped: no git history available here)");
    return;
  }
  assert.strictEqual(
    merges,
    "",
    `a merge commit landed on the trunk within the window release notes walk ` +
    `(${selector}) — re-check whether --first-parent is still the right selector`,
  );
});

// --- the regression: the bound must not be able to disappear ---------------
//
// The bug was never the merge commits; it was an UNBOUNDED assertion that a
// shallow clone silently satisfied. This reproduces that exact shape and
// requires it to fail, so the bound above cannot be widened back to `HEAD`
// without something going red.
//
// It asserts BOTH directions on purpose. "Unbounded fails" alone would still
// pass if the bounded form were also failing; pinning that the bounded form is
// clean is what proves the bound is the thing making the guard pass.
//
// On a shallow clone it SKIPS rather than passes: the counterexample is not in
// the clone, so nothing has been demonstrated, and recording that as a pass is
// the original bug in miniature. It runs for real in deploy-hosting, which
// checks out full history.

ok("the unbounded form fails on full history — a shallow clone must not hide it", () => {
  let shallow;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
    }).trim();
  } catch {
    console.log("      (skipped: no git history available here)");
    return;
  }
  if (shallow !== "false") {
    console.log(
      "      (skipped: shallow clone — the counterexample is not present; " +
      "run `git fetch --unshallow` to exercise this)",
    );
    return;
  }

  const unbounded = execFileSync(
    "git",
    ["log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h", "HEAD"],
    {encoding: "utf8"},
  ).trim();
  assert.notStrictEqual(
    unbounded,
    "",
    "the unbounded assertion now passes, which means main's pre-squash-merge " +
    "history is no longer reachable. If history was rewritten this test is " +
    "obsolete; if the clone is not actually full, this check was vacuous.",
  );

  const bounded = execFileSync(
    "git",
    [
      "log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h",
      walkedRevisionSelector(buildGitLogArgs()),
    ],
    {encoding: "utf8"},
  ).trim();
  assert.strictEqual(
    bounded,
    "",
    "the bounded window also contains a merge commit, so bounding it is not " +
    "what makes the guard pass — re-diagnose before trusting it.",
  );
});

console.log(`\n${passed} release-notes core checks passed.`);
