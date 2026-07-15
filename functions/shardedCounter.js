"use strict";

/**
 * shardedCounter — generic distributed-counter helpers for the AI usage
 * rollups. Pure + firebase-free so it unit-tests under plain `node`.
 *
 * WHY: aiCostTracking used to increment ONE aiUsage/{date} day doc, ONE
 * aiUsageMonthly/{month} doc, and ONE aiUsage/{date}/tools/{tool} doc on
 * every AI call. Under load (or when a single tool dominates traffic)
 * those shared docs exceed Firestore's ~1 write/sec/doc soft limit and
 * writes contend. Fanning each counter across N shard docs spreads the
 * write load N-way; readers sum the shards back together.
 *
 * Shard layout (written by aiCostTracking.writeUsageRollups):
 *   aiUsage/{date}/shards/{shardId}                 — daily totals
 *   aiUsageMonthly/{month}/shards/{shardId}         — monthly totals
 *   aiUsage/{date}/toolShards/{tool}__{shardId}     — per-tool daily totals
 *                                                     (flattened so the id
 *                                                      always exists as a
 *                                                      real, listable doc)
 *   aiUsage/{date}/users/{uid}                      — per-user (UNCHANGED —
 *                                                     already spread per uid)
 */

const DEFAULT_SHARD_COUNT = 16;
const MAX_SHARD_COUNT = 256;

/**
 * Shard count for the AI usage counters. AI_USAGE_SHARDS-tunable; junk /
 * non-positive falls back to the default; clamped to a sane ceiling.
 */
function resolveShardCount(env = process.env) {
  const raw = parseInt(env.AI_USAGE_SHARDS, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHARD_COUNT;
  return Math.min(raw, MAX_SHARD_COUNT);
}

/** Uniformly pick a shard id in [0, shardCount). */
function pickShardId(shardCount, rng = Math.random) {
  const n = Number.isFinite(shardCount) && shardCount > 0 ?
    Math.floor(shardCount) : DEFAULT_SHARD_COUNT;
  return Math.floor(rng() * n);
}

/** Sanitize a tool label into a Firestore-id-safe token (no "/"). */
function safeToolToken(tool) {
  return String(tool || "unknown").slice(0, 64).replace(/[/.]/g, "_");
}

/** Flattened per-tool shard doc id: `${safeTool}__${shardId}`. */
function toolShardDocId(tool, shardId) {
  return `${safeToolToken(tool)}__${shardId}`;
}

/**
 * Sum an array of shard docs (each a plain data object) into one totals
 * object: every numeric field is summed; every listed `carry` string
 * field is taken from the first doc that has it. `updatedAt` is dropped.
 * Null/undefined docs are skipped so a failed shard read can't break the
 * aggregate.
 */
function sumShardDocs(docs, {carry = []} = {}) {
  const out = {};
  for (const doc of docs || []) {
    if (!doc) continue;
    for (const [k, v] of Object.entries(doc)) {
      if (k === "updatedAt") continue;
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = (out[k] || 0) + v;
      } else if (carry.includes(k) && out[k] === undefined && v != null) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Group flattened tool-shard docs by their `tool` field and sum each
 * group. Returns an array of per-tool totals sorted by costUsd desc.
 * Legacy per-tool docs (aiUsage/{date}/tools/{tool}) can be folded in by
 * passing them alongside the shard docs — they carry the same fields.
 */
function groupToolShards(docs) {
  const byTool = new Map();
  for (const doc of docs || []) {
    if (!doc) continue;
    const tool = doc.tool || doc.id || "unknown";
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool).push(doc);
  }
  const rows = [];
  for (const [tool, group] of byTool.entries()) {
    const totals = sumShardDocs(group, {carry: ["tool"]});
    rows.push({...totals, tool});
  }
  return rows.sort((a, b) => (Number(b.costUsd) || 0) - (Number(a.costUsd) || 0));
}

module.exports = {
  DEFAULT_SHARD_COUNT,
  MAX_SHARD_COUNT,
  resolveShardCount,
  pickShardId,
  safeToolToken,
  toolShardDocId,
  sumShardDocs,
  groupToolShards,
};
