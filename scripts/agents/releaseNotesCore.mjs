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

/** The file whose last commit is the boundary of "what has landed since". */
export const CHANGELOG_PATH = "docs/CHANGELOG.md";

/**
 * argv resolving the commit that last touched the changelog.
 *
 * Returned as data rather than run here so this module stays free of git: the
 * two callers have different runners (execSync in Ledger, execFileSync in the
 * guard) and different notions of cwd, but must ask the identical question.
 */
export function changelogBoundaryGitArgs(path = CHANGELOG_PATH) {
  return ["log", "-1", "--format=%H", "--", path];
}

/**
 * The window release notes will walk, from the two facts that decide it.
 *
 * Split out because it had exactly one caller and therefore looked like part
 * of Ledger, while the trunk guard in scripts/test-release-notes-core.mjs
 * needs the SAME answer: it exists to report merge commits that would corrupt
 * the changelog, and a merge commit outside the walked range cannot. That
 * guard derived the bound's SHAPE from buildGitLogArgs (#2301) and then called
 * it with no arguments, so it always took the `--since=14.days` fallback — the
 * one branch that is reached only when neither input is available. Passing the
 * inputs is what makes the two windows the same window.
 *
 * Both fields are optional and buildGitLogArgs prefers the range, so an
 * unreadable changelog degrades to the date heading and then to the fallback
 * rather than throwing: a boundary we cannot resolve must not become a
 * boundary of zero.
 */
export function resolveChangelogBoundary({changelogSha, changelogContent} = {}) {
  return {
    sinceSha: String(changelogSha || "").trim() || undefined,
    sinceDate: findLastDatedHeading(changelogContent) || undefined,
  };
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

/** Automated dependency bumps — collapsed to one line rather than 15 bullets. */
export const DEPENDABOT_RE = /^build\(deps(-dev)?\)/i;

const CONVENTIONAL_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i;

/** `sha|subject` → the parts a changelog line is built from. */
export function parseCommit(record) {
  const sep = String(record).indexOf("|");
  const sha = sep === -1 ? "" : record.slice(0, sep).trim();
  const subject = (sep === -1 ? record : record.slice(sep + 1)).trim();

  // The squash-merge subject ends with the PR number; lift it out so it can be
  // rendered as its own reference instead of sitting mid-sentence.
  const prMatch = subject.match(/\s*\(#(\d+)\)\s*$/);
  const pr = prMatch ? Number(prMatch[1]) : null;
  const withoutPr = prMatch ? subject.slice(0, prMatch.index).trim() : subject;

  const conv = withoutPr.match(CONVENTIONAL_RE);
  return {
    sha,
    subject,
    pr,
    type: conv ? conv[1].toLowerCase() : null,
    scope: conv && conv[2] ? conv[2].toLowerCase() : null,
    breaking: Boolean(conv && conv[3]),
    text: conv ? conv[4].trim() : withoutPr,
  };
}

/**
 * Which heading a commit lands under.
 *
 * Only 39% of this repo's commits carry a conventional prefix, and 15 of those
 * 21 are Dependabot — about 15% of human commits are machine-classifiable. So
 * the unprefixed majority goes to `Changed`, VERBATIM, rather than being sorted
 * into buckets nothing measured. Keep-a-Changelog defines Changed as "changes
 * in existing functionality", which is the honest claim to make about a commit
 * we have not classified; inventing Added/Fixed for it would not be.
 *
 * That is also why the subjects are printed as written: they are already
 * well-formed sentences ("Move the admin shell into src/features/adminShell"),
 * so there is nothing a rewrite would add that is worth an API call.
 */
export function bucketOf(parsed) {
  if (parsed.breaking) return "Breaking";
  if (parsed.scope === "security" || parsed.type === "revert") {
    return parsed.type === "revert" ? "Changed" : "Security";
  }
  switch (parsed.type) {
    case "feat": return "Added";
    case "fix": return "Fixed";
    case "perf": return "Changed";
    case "docs": return "Documentation";
    case "ci": case "build": case "chore": case "style": case "test": case "refactor":
      return "Internal";
    default: return "Changed";
  }
}

/** Heading order. Anything a reader must not miss comes first. */
export const BUCKET_ORDER = [
  "Breaking",
  "Security",
  "Added",
  "Fixed",
  "Changed",
  "Documentation",
  "Internal",
];

function line(parsed) {
  // GitHub auto-links a bare #123 inside a repository markdown file.
  const sentence = parsed.text.replace(/\s+$/, "");
  const capped = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return parsed.pr ? `- ${capped} (#${parsed.pr})` : `- ${capped}`;
}

/**
 * Render the changelog section from commit records — no model, no network.
 *
 * Returns the markdown plus the counts the PR body needs to say honestly how
 * much of it was classified rather than merely listed.
 */
export function buildChangelogSection(records, {date} = {}) {
  const parsed = records.map(parseCommit);
  const deps = parsed.filter((p) => DEPENDABOT_RE.test(p.subject));
  const rest = parsed.filter((p) => !DEPENDABOT_RE.test(p.subject));

  const groups = new Map();
  for (const p of rest) {
    const bucket = bucketOf(p);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(p);
  }

  const out = [`## ${date}`, ""];
  for (const bucket of BUCKET_ORDER) {
    const items = groups.get(bucket);
    if (!items || items.length === 0) continue;   // skip empty groups
    out.push(`### ${bucket}`, "");
    for (const p of items) out.push(line(p));
    out.push("");
  }

  if (deps.length > 0) {
    const refs = deps.filter((d) => d.pr).map((d) => `#${d.pr}`).join(", ");
    out.push(
      `_Dependencies: ${deps.length} automated ${deps.length === 1 ? "bump" : "bumps"}` +
      `${refs ? ` (${refs})` : ""}._`,
      "",
    );
  }

  return {
    section: out.join("\n").trimEnd(),
    stats: {
      total: parsed.length,
      dependencies: deps.length,
      classified: rest.filter((p) => p.type).length,
      listed: rest.filter((p) => !p.type).length,
    },
  };
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
