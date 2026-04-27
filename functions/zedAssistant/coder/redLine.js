/**
 * Red-line policy for the autonomous coder agent.
 *
 * Single source of truth for what Zed can and cannot do when editing the
 * repo. Every write/delete in github.js calls assertPathAllowed() before
 * any GitHub API call. Every branch/PR call uses assertBranchAllowed().
 *
 * If you tighten or loosen the policy, update SETUP.md too — the founder
 * relies on this list as the contract.
 */

// Hard-coded repo target. Octokit is pinned to this in github.js so the
// coder cannot be redirected to another repo even if the LLM is tricked.
const TARGET_OWNER = "Mwelwa-cyber";
const TARGET_REPO = "Zedexams";

// Branch naming: zed/<slug>-<ten-digit-timestamp>. Anything else is rejected
// and never created. Pre-existing branches (including main) cannot be a
// target, so the coder physically cannot push into shared work.
const BRANCH_PATTERN = /^zed\/[a-z0-9][a-z0-9-]{0,80}-\d{10}$/;

// Hard cap on writes per task. Exceeding this stops the loop with a
// "scope_cap_exceeded" finish reason. Bounds the blast radius of a
// runaway agent that decides to rewrite half the codebase.
const MAX_WRITES_PER_TASK = 50;

// Paths the coder is forbidden to write or delete. Each entry is a regex
// matched against the full path (no leading slash). Order doesn't matter
// — any match blocks the operation.
const FORBIDDEN_PATH_PATTERNS = [
  // Security rules
  /^firestore\.rules$/,
  /^storage\.rules$/,
  /^firestore\.indexes\.json$/,

  // Deploy / project config
  /^firebase\.json$/,
  /^\.firebaserc$/,

  // Secrets and credentials in any form
  /(^|\/)\.env($|\.[^/]+$)/,
  /\.(key|pem|p12|pfx)$/,
  /(^|\/)secrets\//,
  /(^|\/)credentials\//,

  // CI / GitHub config — must be edited by humans only
  /^\.github\//,

  // Dependency manifests — no auto-installs
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,

  // Anything that looks like a service account key
  /service[_-]?account.*\.json$/i,
];

class RedLineError extends Error {
  constructor(rule, detail) {
    super(`Red line: ${rule}${detail ? ` (${detail})` : ""}`);
    this.name = "RedLineError";
    this.rule = rule;
    this.detail = detail;
  }
}

function normalizePath(path) {
  if (typeof path !== "string") {
    throw new RedLineError("path_required", "must be a string");
  }
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed) {
    throw new RedLineError("path_required", "empty path");
  }
  if (trimmed.includes("..")) {
    // No path traversal — Octokit Contents API would reject anyway, but
    // belt-and-braces.
    throw new RedLineError("path_traversal", trimmed);
  }
  return trimmed;
}

function isPathForbidden(path) {
  return FORBIDDEN_PATH_PATTERNS.some((re) => re.test(path));
}

function assertPathAllowed(path) {
  const clean = normalizePath(path);
  if (isPathForbidden(clean)) {
    throw new RedLineError("path_forbidden", clean);
  }
  return clean;
}

function assertBranchAllowed(branch) {
  if (typeof branch !== "string" || !BRANCH_PATTERN.test(branch)) {
    throw new RedLineError("branch_invalid", String(branch));
  }
  return branch;
}

function makeBranchName(slug, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cleanSlug = String(slug || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
  return `zed/${cleanSlug}-${nowSeconds}`;
}

module.exports = {
  TARGET_OWNER,
  TARGET_REPO,
  BRANCH_PATTERN,
  MAX_WRITES_PER_TASK,
  FORBIDDEN_PATH_PATTERNS,
  RedLineError,
  assertPathAllowed,
  assertBranchAllowed,
  isPathForbidden,
  makeBranchName,
  normalizePath,
};
