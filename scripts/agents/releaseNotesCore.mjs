/**
 * Ledger — pure decision logic, split out so it tests under plain `node`
 * with no git, no network, and no Octokit (the `*Core` split used across
 * functions/).
 *
 * The whole reason this file exists: Ledger spent months silently doing
 * nothing. It collected work with `git log --merges`, but this repo
 * squash-merges (`gh pr merge --squash`), so `main` carries no merge commits
 * at all — the query returned empty on every run and the script exited before
 * its API call. A watcher that reports "nothing to do" is indistinguishable
 * from a working one, which is why the selection rules now live somewhere a
 * test can fail.
 */

/**
 * Ledger's OWN commits, in both spellings they reach `main` in:
 *   - `chore(changelog): Ledger draft for <date>` — the file commit it writes
 *   - `chore: changelog for <date> (#123)`        — the squashed PR subject
 *
 * Under `--merges` these could never appear. Under `--first-parent` they do,
 * and a changelog that summarises the previous changelog grows a hall of
 * mirrors, so they are dropped before the model ever sees them.
 */
export const LEDGER_COMMIT_RE =
  /^chore(\(changelog\))?:\s+(changelog|Ledger draft)\s+for\s+\d{4}-\d{2}-\d{2}/i;

/** The first `## YYYY-MM-DD` heading in the changelog, or null on a first run. */
export function findLastDatedHeading(content) {
  const m = String(content || "").match(/^## (\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

/**
 * Build the `git log` argv.
 *
 * `--first-parent` is what makes this work at all: on a squash-merged trunk
 * every landed PR is exactly one first-parent commit, which is precisely the
 * unit a changelog entry describes.
 *
 * Prefer a COMMIT RANGE over `--since` when we know the commit that last
 * touched the changelog. `--since=<date>` is a timestamp floor at midnight, so
 * running on the 13th with a `## 2026-08-12` heading re-reads everything the
 * 12th's entry already described — every run would restate the previous day.
 * `<sha>..HEAD` is exact, needs no timezone reasoning, and excludes the
 * boundary commit itself. `--since` stays as the fallback for a changelog that
 * has never been committed.
 */
export function buildGitLogArgs({sinceSha, sinceDate} = {}) {
  const args = ["log", "--first-parent", "--pretty=format:%h|%s", "--no-color"];
  if (sinceSha) return [...args, `${sinceSha}..HEAD`];
  if (sinceDate) return [...args, `--since=${sinceDate}`];
  return [...args, "--since=14.days"];
}

/**
 * Split raw `git log` output into one trimmed `sha|subject` record per line,
 * dropping Ledger's own commits.
 *
 * Deliberately NO commit body. `%b` on a squash-merged trunk is the entire PR
 * description — multi-line, so it breaks the one-record-per-line contract the
 * prompt claims, and long enough that a busy day would blow the 20k cap on
 * prose the changelog does not use. The subject carries the conventional-commit
 * type and the `(#123)` the prompt asks it to cite, which is the whole payload.
 */
export function selectCommits(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const sep = line.indexOf("|");
      const subject = sep === -1 ? line : line.slice(sep + 1);
      return !LEDGER_COMMIT_RE.test(subject.trim());
    });
}

/**
 * Insert a rendered section under `## Unreleased`, or seed that heading right
 * after the file title when it is missing.
 */
export function insertSection(existing, newSection) {
  const section = String(newSection || "").trim();
  if (!section) return existing;
  if (existing.includes("## Unreleased")) {
    return existing.replace("## Unreleased", `## Unreleased\n\n${section}`);
  }
  return existing.replace(/^# .*\n/m, (m) => `${m}\n## Unreleased\n\n${section}\n\n`);
}
