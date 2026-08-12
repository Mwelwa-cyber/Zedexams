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
  buildGitLogArgs,
  findLastDatedHeading,
  insertSection,
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

// --- the trunk really is squash-merged -------------------------------------
//
// The premise behind the whole fix. If this repo ever adopts real merge
// commits, --first-parent still works, but the bug it replaced would no longer
// have been a bug — so record the shape rather than assume it.

ok("this repo's main carries no merge commits", () => {
  let merges;
  try {
    merges = execFileSync(
      "git",
      ["log", "--merges", "--first-parent", "-n", "1", "--pretty=format:%h", "HEAD"],
      {encoding: "utf8"},
    ).trim();
  } catch {
    console.log("      (skipped: no git history available here)");
    return;
  }
  assert.strictEqual(
    merges,
    "",
    "a merge commit appeared on the trunk — re-check whether --first-parent " +
    "is still the right selector",
  );
});

console.log(`\n${passed} release-notes core checks passed.`);
