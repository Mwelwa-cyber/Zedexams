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
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {
  CHANGELOG_PATH,
  LEDGER_COMMIT_RE,
  buildChangelogSection,
  buildGitLogArgs,
  bucketOf,
  changelogBoundaryGitArgs,
  findLastDatedHeading,
  insertSection,
  parseCommit,
  resolveChangelogBoundary,
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

// --- the changelog boundary ------------------------------------------------
//
// One declaration, two callers: release-notes.mjs walks this window, and the
// trunk guard below reports merge commits that would corrupt it. They were
// allowed to disagree — the guard called buildGitLogArgs() with nothing.

ok("the boundary prefers the changelog commit, then its dated heading", () => {
  assert.deepStrictEqual(
    resolveChangelogBoundary({changelogSha: "abc1234\n", changelogContent: "## 2026-08-01\n"}),
    {sinceSha: "abc1234", sinceDate: "2026-08-01"},
    "both are reported; buildGitLogArgs is what prefers the range",
  );
  assert.strictEqual(
    buildGitLogArgs(
      resolveChangelogBoundary({changelogSha: "abc1234", changelogContent: "## 2026-08-01"}),
    ).at(-1),
    "abc1234..HEAD",
  );
});

ok("an unresolvable boundary degrades, never narrows to nothing", () => {
  assert.deepStrictEqual(
    resolveChangelogBoundary({changelogSha: "  \n", changelogContent: ""}),
    {sinceSha: undefined, sinceDate: undefined},
    "an empty lookup must not become an empty commit range",
  );
  assert.strictEqual(buildGitLogArgs(resolveChangelogBoundary()).at(-1), "--since=14.days");
  assert.strictEqual(
    buildGitLogArgs(resolveChangelogBoundary({changelogContent: "## 2026-08-01"})).at(-1),
    "--since=2026-08-01",
    "no commit for the file yet still leaves the date heading",
  );
});

ok("both callers ask git the same question about the changelog", () => {
  assert.deepStrictEqual(
    changelogBoundaryGitArgs(),
    ["log", "-1", "--format=%H", "--", CHANGELOG_PATH],
  );
  assert.deepStrictEqual(
    changelogBoundaryGitArgs("/tmp/fixture/docs/CHANGELOG.md").at(-1),
    "/tmp/fixture/docs/CHANGELOG.md",
    "the path is a parameter so the guard can ask it of a checkout it owns",
  );
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
//
// …and it is derived by VALUE, not only by shape. #2301 took the selector from
// buildGitLogArgs and then called it with no arguments, which is the one input
// that always yields the fallback — so the guard was pinned to the very floor
// that reasoning rejected, in the only context where it can fail a job. The
// inputs come from the changelog now, through the same resolveChangelogBoundary
// that release-notes.mjs uses, so the two windows are one window.
//
// Pointed at the RESOLVED trunk, not HEAD. On a pull_request actions/checkout
// resolves refs/pull/N/merge — a two-parent commit GitHub builds for the run —
// so HEAD is a merge commit by construction and the query found it every time.
// #2303 failed on exactly that: a PR whose only change was a workflow file.
//
// ADVISORY here, ENFORCED by .github/workflows/agent-release-notes.yml. Ledger
// is what walks --first-parent, so Ledger output is what a merge commit would
// corrupt; a deploy is not, and treating it as one cost five of them.
// scripts/trunkGuardPolicy.mjs carries that reasoning.

/**
 * The revision selector buildGitLogArgs chose — the last element, either a
 * `<sha>..HEAD` range or a `--since=…` floor. Everything before it is
 * formatting flags.
 */
function walkedRevisionSelector(args) {
  return args[args.length - 1];
}

/** This checkout, addressed from this file rather than from the caller's cwd. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The window release notes will ACTUALLY walk in the repository at `root`.
 *
 * Deriving the selector's shape from buildGitLogArgs and then calling it with
 * no arguments (#2301) pinned the guard to `--since=14.days` — the branch that
 * is reached only when neither input is available, and so never the branch
 * Ledger takes on a repository whose changelog has any history at all. Since
 * Ledger runs daily the real window is usually a day or two wide, which makes
 * the fallback far too WIDE: the guard reports merge commits Ledger will never
 * read, and does it in the one context that fails a job. After a quiet
 * fortnight the same mismatch runs the other way and it reports nothing.
 *
 * Neither lookup may throw. A missing file or an unreadable log is not a
 * boundary of zero — it degrades to the next branch of buildGitLogArgs, which
 * is the fallback, i.e. exactly the behaviour this replaces.
 *
 * `root` is a parameter so the fixtures below can put the guard's own window
 * resolution under test on a repository they own, rather than restating it.
 */
function walkedWindow(root) {
  const changelog = join(root, CHANGELOG_PATH);
  let changelogSha = "";
  try {
    changelogSha = git(["-C", root, ...changelogBoundaryGitArgs(changelog)]);
  } catch {
    changelogSha = "";
  }
  let changelogContent = "";
  try {
    changelogContent = readFileSync(changelog, "utf8");
  } catch {
    changelogContent = "";
  }
  return walkedRevisionSelector(
    buildGitLogArgs(resolveChangelogBoundary({changelogSha, changelogContent})),
  );
}

/**
 * Re-point the walked range at the trunk. buildGitLogArgs() ends in either a
 * `<sha>..HEAD` range or a `--since=<date>` floor, and HEAD is the wrong end
 * of that range on a pull_request. The range form carries the ref inside it;
 * the --since form does not, so the ref has to be appended or git walks HEAD.
 */
function trunkWalkArgs(selector, ref) {
  if (selector.startsWith("--since=")) return [selector, ref];
  return [selector.replace(/HEAD$/, ref)];
}

const git = (args) =>
  execFileSync("git", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();

const trunkRefExists = (candidate) => {
  try {
    git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/** Enforced only where Ledger runs; everywhere else this reports and passes. */
const raiseTrunkFinding = (finding) => {
  if (resolveGuardMode(process.env) === "enforce") assert.fail(finding);
  reportAdvisory(finding, process.env, appendFileSync);
  console.log(`      (advisory: ${finding})`);
};

ok("the walked range is re-pointed at the trunk, not HEAD", () => {
  assert.deepStrictEqual(
    trunkWalkArgs("abc1234..HEAD", "origin/main"),
    ["abc1234..origin/main"],
    "the range form carries the ref inside it",
  );
  assert.deepStrictEqual(
    trunkWalkArgs("--since=2026-08-01", "origin/main"),
    ["--since=2026-08-01", "origin/main"],
    "the --since form names no ref, so one has to be appended",
  );
  assert.deepStrictEqual(
    trunkWalkArgs("abc1234..HEAD", "HEAD"),
    ["abc1234..HEAD"],
    "off a pull request the trunk resolves to HEAD and nothing moves",
  );
});

ok("the recent trunk carries no merge commits", () => {
  const {ref, source, reason} = resolveTrunkRef(process.env, trunkRefExists);

  // A named base branch missing from the checkout is a config regression, not a
  // clean bill of health: ci.yml fetches full history on a pull_request, so
  // origin/$GITHUB_BASE_REF is always there. Say so rather than reporting ok
  // while testing nothing at all — the hole the original bug hid in.
  if (ref === null) {
    raiseTrunkFinding(reason);
    return;
  }

  const selector = walkedWindow(REPO_ROOT);
  let merges;
  try {
    merges = git([
      "log",
      "--merges",
      "--first-parent",
      "-n",
      "1",
      "--pretty=format:%h",
      ...trunkWalkArgs(selector, ref),
    ]);
  } catch {
    raiseTrunkFinding(
      `the window release notes walk (${selector}) could not be read against ` +
      `the trunk (${ref}, via ${source})`,
    );
    return;
  }
  if (merges !== "") {
    raiseTrunkFinding(
      formatTrunkFinding({sha: merges, ref: `${selector} on ${ref}`, source}),
    );
  }
});

// --- the regression: the bound must not be able to disappear ---------------
//
// Proven on a repository this test BUILDS, never on ours.
//
// The previous version asserted against live history, and that put it straight
// back in the blocking path #2303 had just cleared. The live guard above is
// advisory (raiseTrunkFinding), but this assertion was a bare
// assert.strictEqual against `main` — and run-all-tests.mjs discovers every
// `test:*`, while test:all gates deploy-hosting.yml. So the next genuine merge
// commit inside the bounded window would have failed it and frozen deploys
// again: Deploy Hosting 2000-2004, a second time, from the test written to
// prevent it.
//
// It also depended on main's pre-squash-merge history staying reachable
// FOREVER (`assert.notStrictEqual(unbounded, "")`). That is a standing bet on
// 2026-04/05 commits nobody controls — a history rewrite, a graft, a filtered
// clone or any full-but-truncated checkout flips it, and the message would
// have blamed the guard rather than the clone.
//
// A fixture removes both problems at once: the property under test is about
// how `--since` interacts with `--first-parent`, which is a property of git,
// not of our history. Owning the data is the only way to assert it without
// betting a deploy on what somebody merges next.
//
// Deliberately NOT routed through trunkGuardPolicy. Making this advisory too
// would prove nothing — what it guards is precisely that the bound still
// works, and an advisory that nobody must act on is not a guard.

/** Run git in `cwd` with an identity, so the fixture needs no global config. */
function fixtureGit(cwd, args, extraEnv = {}) {
  return execFileSync(
    "git",
    ["-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture",
      "-c", "commit.gpgsign=false", ...args],
    {cwd, encoding: "utf8", env: {...process.env, ...extraEnv}},
  ).trim();
}

/** A commit at a fixed age, so the 14-day window is a controlled variable. */
function commitAt(cwd, message, daysAgo) {
  const when = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return fixtureGit(cwd, ["commit", "--allow-empty", "-q", "-m", message],
    {GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when});
}

ok("a merge OUTSIDE the window is found unbounded and missed bounded", () => {
  const dir = mkdtempSync(join(tmpdir(), "trunk-guard-"));
  try {
    fixtureGit(dir, ["init", "-q", "-b", "main"]);

    // Old linear history, then a REAL merge commit, all well outside 14 days.
    commitAt(dir, "chore: root", 90);
    fixtureGit(dir, ["checkout", "-q", "-b", "side"]);
    commitAt(dir, "feat: side work", 75);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    commitAt(dir, "fix: trunk work", 70);
    fixtureGit(dir, ["merge", "--no-ff", "-q", "-m", "Merge pull request #1 from side", "side"],
      {GIT_AUTHOR_DATE: new Date(Date.now() - 60 * 86400000).toISOString(),
        GIT_COMMITTER_DATE: new Date(Date.now() - 60 * 86400000).toISOString()});

    // Recent history is squash-style: linear, no merges, inside the window.
    commitAt(dir, "feat: recent one (#2)", 5);
    commitAt(dir, "fix: recent two (#3)", 1);

    const findMerge = (args) => fixtureGit(dir, [
      "log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h", ...args,
    ]);

    // The fixture is only meaningful if it really contains a merge commit.
    const unbounded = findMerge(["HEAD"]);
    assert.notStrictEqual(
      unbounded,
      "",
      "the fixture built no merge commit — the rest of this test would be vacuous",
    );

    // …and the bound, taken from the same function the guard uses, excludes it.
    const bounded = findMerge(
      trunkWalkArgs(walkedWindow(dir), "HEAD"),
    );
    assert.strictEqual(
      bounded,
      "",
      "the bounded window found the merge commit the fixture placed 60 days " +
      "back — the bound is not excluding what it is supposed to exclude",
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

ok("a merge INSIDE the window is found by the bounded form too", () => {
  // The other direction, and the one that proves the guard still has teeth:
  // bounding it must not mean it can never fire. Without this, replacing the
  // selector with something that matches nothing would pass the test above.
  const dir = mkdtempSync(join(tmpdir(), "trunk-guard-"));
  try {
    fixtureGit(dir, ["init", "-q", "-b", "main"]);
    commitAt(dir, "chore: root", 30);
    fixtureGit(dir, ["checkout", "-q", "-b", "side"]);
    commitAt(dir, "feat: side work", 4);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    commitAt(dir, "fix: trunk work", 3);
    fixtureGit(dir, ["merge", "--no-ff", "-q", "-m", "Merge pull request #9 from side", "side"],
      {GIT_AUTHOR_DATE: new Date(Date.now() - 2 * 86400000).toISOString(),
        GIT_COMMITTER_DATE: new Date(Date.now() - 2 * 86400000).toISOString()});

    const bounded = fixtureGit(dir, [
      "log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h",
      ...trunkWalkArgs(walkedWindow(dir), "HEAD"),
    ]);
    assert.notStrictEqual(
      bounded,
      "",
      "a merge commit two days old was not found inside a fourteen-day " +
      "window — the guard has stopped being able to fire at all",
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// --- the window is the CHANGELOG's, not a fortnight ------------------------
//
// Both fixtures above have no changelog, so walkedWindow degrades to
// `--since=14.days` and they measure the fallback. These two give the fixture
// a changelog and measure the branch Ledger actually takes, in both of the
// directions the fallback got wrong.
//
// The changelogs written here carry NO dated heading on purpose. If the commit
// lookup ever stops resolving, resolveChangelogBoundary would quietly hand back
// the date instead and these tests could still pass on the wrong branch; with
// no heading, a broken lookup falls all the way to `--since=14.days` and both
// assertions fail loudly.

/** Commit a changelog at a fixed age — the boundary these tests turn on. */
function commitChangelogAt(cwd, daysAgo) {
  const file = join(cwd, CHANGELOG_PATH);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, "# Changelog\n\n## Unreleased\n");
  fixtureGit(cwd, ["add", CHANGELOG_PATH]);
  return commitAt(cwd, "chore(changelog): Ledger draft", daysAgo);
}

const findMergeIn = (dir, args) => fixtureGit(dir, [
  "log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h", ...args,
]);

ok("a merge before the changelog boundary is not the guard's business", () => {
  // The ENFORCED direction, and a false positive: Ledger runs daily, so its
  // window is a day or two wide. A merge commit older than the boundary is
  // outside the walk and cannot truncate the entry — but it is inside a
  // fortnight, so the fallback reported it and failed the digest over history
  // that digest will never read.
  const dir = mkdtempSync(join(tmpdir(), "trunk-guard-boundary-"));
  try {
    fixtureGit(dir, ["init", "-q", "-b", "main"]);
    commitAt(dir, "chore: root", 40);
    fixtureGit(dir, ["checkout", "-q", "-b", "side"]);
    commitAt(dir, "feat: side work", 7);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    fixtureGit(dir, ["merge", "--no-ff", "-q", "-m", "Merge pull request #4 from side", "side"],
      {GIT_AUTHOR_DATE: new Date(Date.now() - 5 * 86400000).toISOString(),
        GIT_COMMITTER_DATE: new Date(Date.now() - 5 * 86400000).toISOString()});

    // …then Ledger writes a changelog, and one PR squashes in after it.
    commitChangelogAt(dir, 1);
    commitAt(dir, "feat: landed today (#5)", 0);

    const selector = walkedWindow(dir);
    assert.ok(
      selector.endsWith("..HEAD") && !selector.startsWith("--since="),
      `the window should be the changelog commit range, got "${selector}" — ` +
      "a --since floor here means the boundary lookup silently failed",
    );
    assert.strictEqual(
      findMergeIn(dir, trunkWalkArgs(selector, "HEAD")),
      "",
      "a merge commit older than the changelog boundary is outside the walk " +
      "and must not be reported",
    );
    assert.notStrictEqual(
      findMergeIn(dir, trunkWalkArgs("--since=14.days", "HEAD")),
      "",
      "the fixture is only meaningful if the old fallback DID report it",
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

ok("a merge after a stale changelog is reported even past a fortnight", () => {
  // The inverse, and the one a narrower window could have hidden: after a
  // quiet stretch the boundary is older than 14 days, so a merge commit that
  // WILL truncate the next entry sat outside the fallback and went unreported.
  const dir = mkdtempSync(join(tmpdir(), "trunk-guard-boundary-"));
  try {
    fixtureGit(dir, ["init", "-q", "-b", "main"]);
    commitAt(dir, "chore: root", 60);
    commitChangelogAt(dir, 30);
    fixtureGit(dir, ["checkout", "-q", "-b", "side"]);
    commitAt(dir, "feat: side work", 25);
    fixtureGit(dir, ["checkout", "-q", "main"]);
    fixtureGit(dir, ["merge", "--no-ff", "-q", "-m", "Merge pull request #6 from side", "side"],
      {GIT_AUTHOR_DATE: new Date(Date.now() - 20 * 86400000).toISOString(),
        GIT_COMMITTER_DATE: new Date(Date.now() - 20 * 86400000).toISOString()});
    commitAt(dir, "fix: recent (#7)", 2);

    assert.notStrictEqual(
      findMergeIn(dir, trunkWalkArgs(walkedWindow(dir), "HEAD")),
      "",
      "a merge commit inside the changelog's range was missed — the guard is " +
      "still measuring a fortnight instead of the walk",
    );
    assert.strictEqual(
      findMergeIn(dir, trunkWalkArgs("--since=14.days", "HEAD")),
      "",
      "the fixture is only meaningful if the old fallback DID miss it",
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

console.log(`\n${passed} release-notes core checks passed.`);
