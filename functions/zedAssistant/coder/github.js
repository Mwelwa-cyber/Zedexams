/**
 * GitHub REST wrapper used by the autonomous coder.
 *
 * Why a wrapper instead of calling Octokit directly:
 *   - Owner/repo are pinned to the values in redLine.js. The coder cannot
 *     redirect to a different repo even if the LLM gets confused.
 *   - Every write/delete passes through assertPathAllowed first.
 *   - Branch creation goes through assertBranchAllowed, so we can't push
 *     to main, an arbitrary branch, or anything that doesn't match our
 *     fresh-branch naming scheme.
 *   - PRs are always opened as draft.
 *
 * All file operations use the Contents API (no git CLI, no /tmp, no
 * Docker tweaks). Slower than local git for big diffs, but safe for the
 * Cloud Functions Node 22 runtime and good enough for typical small PRs.
 */

const {Octokit} = require("@octokit/rest");
const {
  TARGET_OWNER,
  TARGET_REPO,
  assertPathAllowed,
  assertBranchAllowed,
  RedLineError,
} = require("./redLine");

const BASE_BRANCH = "main";

function makeOctokit(token) {
  if (!token) {
    throw new Error("GitHub token missing — set ZED_GITHUB_TOKEN secret");
  }
  return new Octokit({auth: token, userAgent: "zed-assistant-coder"});
}

function repoArgs(extra = {}) {
  return {owner: TARGET_OWNER, repo: TARGET_REPO, ...extra};
}

function decodeBase64(str) {
  return Buffer.from(str, "base64").toString("utf8");
}

function encodeBase64(str) {
  return Buffer.from(String(str), "utf8").toString("base64");
}

async function getBaseSha(octokit, branch = BASE_BRANCH) {
  const {data} = await octokit.git.getRef(repoArgs({ref: `heads/${branch}`}));
  return data.object.sha;
}

async function createBranch(octokit, branch) {
  assertBranchAllowed(branch);
  const sha = await getBaseSha(octokit, BASE_BRANCH);
  await octokit.git.createRef(repoArgs({
    ref: `refs/heads/${branch}`,
    sha,
  }));
  return {branch, fromBranch: BASE_BRANCH, fromSha: sha};
}

async function listFiles(octokit, {path, branch}) {
  // Listing is read-only — no red-line check needed. Just don't let
  // someone use this to enumerate paths outside the repo.
  const cleanPath = path ? String(path).replace(/^\/+/, "") : "";
  try {
    const {data} = await octokit.repos.getContent(repoArgs({
      path: cleanPath,
      ref: branch || BASE_BRANCH,
    }));
    if (Array.isArray(data)) {
      return data.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type, // "file" | "dir" | "symlink" | "submodule"
        size: entry.size,
      }));
    }
    // Single-file response when path points at a file rather than a dir.
    return [{
      name: data.name,
      path: data.path,
      type: data.type,
      size: data.size,
    }];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

async function getFile(octokit, {path, branch}) {
  // Reads are unrestricted (the agent needs to be able to read anything to
  // understand the codebase). Only writes go through the red line.
  const cleanPath = String(path || "").replace(/^\/+/, "");
  if (!cleanPath) {
    throw new Error("getFile: path required");
  }
  try {
    const {data} = await octokit.repos.getContent(repoArgs({
      path: cleanPath,
      ref: branch || BASE_BRANCH,
    }));
    if (Array.isArray(data)) {
      throw new Error(`Path is a directory, not a file: ${cleanPath}`);
    }
    if (data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error(`Unexpected encoding for ${cleanPath}: ${data.encoding}`);
    }
    return {
      path: data.path,
      sha: data.sha,
      content: decodeBase64(data.content),
      size: data.size,
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function putFile(octokit, {path, content, branch, message}) {
  assertPathAllowed(path);
  assertBranchAllowed(branch);
  const cleanPath = String(path).replace(/^\/+/, "");

  // Need the existing sha to update; absent → create.
  let existingSha;
  try {
    const existing = await getFile(octokit, {path: cleanPath, branch});
    existingSha = existing?.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const {data} = await octokit.repos.createOrUpdateFileContents(repoArgs({
    path: cleanPath,
    message: String(message || `zed: update ${cleanPath}`).slice(0, 200),
    content: encodeBase64(content),
    branch,
    ...(existingSha ? {sha: existingSha} : {}),
  }));
  return {
    path: data.content?.path || cleanPath,
    sha: data.content?.sha,
    commitSha: data.commit?.sha,
    created: !existingSha,
  };
}

async function deleteFile(octokit, {path, branch, message}) {
  assertPathAllowed(path);
  assertBranchAllowed(branch);
  const cleanPath = String(path).replace(/^\/+/, "");
  const existing = await getFile(octokit, {path: cleanPath, branch});
  if (!existing) {
    throw new Error(`Cannot delete ${cleanPath} — file does not exist`);
  }
  const {data} = await octokit.repos.deleteFile(repoArgs({
    path: cleanPath,
    message: String(message || `zed: delete ${cleanPath}`).slice(0, 200),
    sha: existing.sha,
    branch,
  }));
  return {
    path: cleanPath,
    commitSha: data.commit?.sha,
  };
}

async function searchCode(octokit, {query}) {
  // Read-only; no red-line check. Limited to this repo via the q syntax.
  const q = `${String(query || "").trim()} repo:${TARGET_OWNER}/${TARGET_REPO}`;
  const {data} = await octokit.search.code({q, per_page: 20});
  return data.items.map((item) => ({
    path: item.path,
    name: item.name,
    score: item.score,
    url: item.html_url,
  }));
}

async function openPullRequest(octokit, {branch, title, body}) {
  assertBranchAllowed(branch);
  const {data} = await octokit.pulls.create(repoArgs({
    title: String(title || `zed: changes on ${branch}`).slice(0, 200),
    head: branch,
    base: BASE_BRANCH,
    body: String(body || "").slice(0, 60_000),
    draft: true, // hard-coded; never expose this as an arg
    maintainer_can_modify: true,
  }));
  return {
    number: data.number,
    url: data.html_url,
    state: data.state,
    draft: data.draft,
  };
}

module.exports = {
  makeOctokit,
  createBranch,
  listFiles,
  getFile,
  putFile,
  deleteFile,
  searchCode,
  openPullRequest,
  RedLineError,
  TARGET_OWNER,
  TARGET_REPO,
  BASE_BRANCH,
};
