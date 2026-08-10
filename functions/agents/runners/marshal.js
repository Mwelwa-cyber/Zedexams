/**
 * Marshal — operations supervisor (deterministic; drafts nothing; writes only
 * its own watch bookkeeping).
 *
 * The fleet has watchdogs for slices of the platform — Quill checks job health
 * nightly, Vigil checks the site hourly — but nobody checks the WATCHDOGS. If a
 * scheduled agent silently stops firing (a broken deploy, a tripped breaker, a
 * Cloud Scheduler hiccup), today only a human eyeballing /admin/agents would
 * ever notice. Marshal closes that gap.
 *
 * Every hour Marshal answers one question: "is everyone actually working?" For
 * each scheduled agent that writes a predictable rollup, it confirms the agent
 * ran within its expected window; it also surfaces stuck jobs (running/queued
 * far too long), tripped/!paused breakers, and recent failures. It rolls the
 * lot into a single company-health verdict that the /admin/company HQ shows and
 * that lands in agentJobs (status=awaiting_approval when something is wrong, so
 * it joins the existing approvals badge).
 *
 * Bounded + cheap: a handful of indexed reads (agentId+createdAt and
 * status+createdAt indexes already exist), no LLM, no secrets, db injected so
 * the assessment logic unit-tests without Firebase.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Scheduled agents that write a predictable agentJobs rollup EVERY run, with
// the interval Marshal expects between runs and a grace allowance before it
// calls one "late". Deliberately excluded: event-driven agents (the content
// gate / Pubo, which write only when they publish) and on-demand / pipeline /
// sync agents (Aria-Reva, Vex, Dawn) — they have no fixed cadence to check.
const WATCHED = [
  {id: "vigil", label: "Site monitor", everyMs: HOUR, graceMs: 0.75 * HOUR},
  // Sift writes a rollup EVERY run (quiet runs land as 'done'), so its absence
  // is a real signal — and an error watcher that has silently stopped is worth
  // catching, since its whole value is that silence means "checked and clean".
  {id: "sift", label: "Server error watch", everyMs: HOUR, graceMs: 0.75 * HOUR},
  {id: "till", label: "Revenue reconciler", everyMs: HOUR, graceMs: 0.75 * HOUR},
  {id: "echo", label: "Support triage", everyMs: 2 * HOUR, graceMs: HOUR},
  {id: "quill", label: "QA smoke", everyMs: DAY, graceMs: 12 * HOUR},
  {id: "cala", label: "CBC alignment audit", everyMs: 7 * DAY, graceMs: 2 * DAY},
  {id: "compass", label: "Product signal", everyMs: 7 * DAY, graceMs: 2 * DAY},
  {id: "anchor", label: "Retention scan", everyMs: 7 * DAY, graceMs: 2 * DAY},
];

const STUCK_MS = 15 * 60_000; // a job running/queued longer than this is stuck
const FAILURE_WINDOW_MS = 24 * HOUR;
const MAX_LIST = 25;

// Marshal's own bookkeeping doc — the first time it saw each watched agent.
// Server-only (admin SDK); never read by clients, so it needs no security rule.
const WATCH_STATE_DOC = "agentState/marshal";

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

/**
 * Pure fleet assessment — no I/O, unit-tested directly.
 *
 *   assessFleet({ now, watched, lastRunByAgent, pausedAgents, stuckJobs,
 *                 recentFailures })
 *     now             — ms epoch
 *     watched         — [{id,label,everyMs,graceMs}]
 *     lastRunByAgent  — { agentId: lastRunMs | null }   (null = never seen)
 *     pausedAgents    — [agentId]                        (agentControl.paused)
 *     stuckJobs       — [{id, agentId, status, ageMs}]
 *     recentFailures  — [{id, agentId, error, agoMs}]
 *
 * State per watched agent: 'paused' | 'never' | 'pending' | 'late' | 'ok'.
 * 'pending' = never ran but only just deployed (within its first run window) —
 * surfaced but NOT counted against health, so a fresh agent isn't an outage.
 * healthy === no late, no never, no paused, no stuck, no recent failures.
 */
function assessFleet({
  now,
  watched = WATCHED,
  lastRunByAgent = {},
  firstWatchedAt = {},
  pausedAgents = [],
  stuckJobs = [],
  recentFailures = [],
} = {}) {
  const pausedSet = new Set(pausedAgents);
  const agents = watched.map((w) => {
    const last = lastRunByAgent[w.id];
    let state;
    let lastRunAgoMs = null;
    if (pausedSet.has(w.id)) {
      state = "paused";
    } else if (last == null) {
      // Never produced a rollup. Tell a genuinely dead agent apart from one
      // that was only just deployed: a brand-new agent hasn't had a full run
      // window yet, so it's 'pending' (informational) rather than 'never' (a
      // real miss). With no firstWatchedAt reference we assume it has been
      // watched forever (→ 'never'), keeping the pure-function default strict.
      const firstSeen = firstWatchedAt[w.id];
      const watchedForMs = firstSeen == null ?
        Infinity : Math.max(0, now - firstSeen);
      state = watchedForMs > (w.everyMs + w.graceMs) ? "never" : "pending";
    } else {
      lastRunAgoMs = Math.max(0, now - last);
      state = lastRunAgoMs > (w.everyMs + w.graceMs) ? "late" : "ok";
    }
    return {id: w.id, label: w.label, everyMs: w.everyMs, lastRunAgoMs, state};
  });

  const lateAgents = agents.filter((a) => a.state === "late").map((a) => a.id);
  const neverRan = agents.filter((a) => a.state === "never").map((a) => a.id);
  // 'pending' = never ran, but only just deployed (not yet due). Surfaced for
  // visibility but deliberately NOT a health failure — that's the whole point
  // of this state: a fresh agent shouldn't read as an outage.
  const pendingAgents = agents.filter((a) => a.state === "pending").map((a) => a.id);
  // Every paused agent — including content agents a breaker may have tripped,
  // not just the scheduled ones Marshal watches for freshness.
  const pausedList = [...pausedSet];

  const healthy =
    lateAgents.length === 0 &&
    neverRan.length === 0 &&
    pausedList.length === 0 &&
    stuckJobs.length === 0 &&
    recentFailures.length === 0;

  const parts = [];
  if (healthy) {
    parts.push(`All ${agents.length} scheduled agents on time`);
  } else {
    if (lateAgents.length) parts.push(`late: ${lateAgents.join(", ")}`);
    if (neverRan.length) parts.push(`never ran: ${neverRan.join(", ")}`);
    if (pausedList.length) parts.push(`paused: ${pausedList.join(", ")}`);
    if (stuckJobs.length) parts.push(`${stuckJobs.length} stuck job(s)`);
    if (recentFailures.length) parts.push(`${recentFailures.length} failure(s)/24h`);
  }
  // Informational either way — pending agents are awaiting their first run.
  if (pendingAgents.length) parts.push(`awaiting first run: ${pendingAgents.join(", ")}`);

  return {
    healthy,
    checkedAt: now,
    watchedCount: agents.length,
    agents,
    lateAgents,
    neverRan,
    pendingAgents,
    pausedAgents: pausedList,
    stuckCount: stuckJobs.length,
    stuckJobs: stuckJobs.slice(0, MAX_LIST),
    recentFailureCount: recentFailures.length,
    recentFailures: recentFailures.slice(0, MAX_LIST),
    summary: parts.join(" · "),
  };
}

/** Most recent createdAt (ms) for one agentId, or null. Never throws. */
async function lastRunMs(db, agentId) {
  try {
    const snap = await db.collection("agentJobs")
        .where("agentId", "==", agentId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    if (snap.empty) return null;
    const d = snap.docs[0].data() || {};
    return d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null;
  } catch (err) {
    // An unreadable agent is reported as unknown (→ 'never'), never fatal.
    return null;
  }
}

/** Load Marshal's stored first-seen stamps ({agentId: ms}). Never throws. */
async function loadFirstWatchedAt(db) {
  try {
    const snap = await db.doc(WATCH_STATE_DOC).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const fw = data.firstWatchedAt;
    return (fw && typeof fw === "object") ? {...fw} : {};
  } catch (err) {
    return {};
  }
}

/**
 * Stamp `now` for any watched agent not seen before and persist the small map.
 * This is the only write Marshal makes — its own watch bookkeeping, never the
 * fleet's work — and it lets a freshly-deployed agent read as 'pending'
 * (awaiting first run) instead of a dead 'never' for its whole first window.
 */
async function ensureFirstWatchedAt(db, firstWatchedAt, watched, now) {
  let dirty = false;
  for (const w of watched) {
    if (firstWatchedAt[w.id] == null) {
      firstWatchedAt[w.id] = now;
      dirty = true;
    }
  }
  if (dirty) {
    try {
      await db.doc(WATCH_STATE_DOC).set({firstWatchedAt}, {merge: true});
    } catch (err) {
      // Best effort: assess with the in-memory stamps; next run retries.
    }
  }
  return firstWatchedAt;
}

/**
 * Read the fleet's live state from Firestore and assess it. db injected.
 * Indexed, bounded reads + one tiny bookkeeping doc — no LLM, no secrets.
 */
async function runMarshal({db, now = Date.now()} = {}) {
  // 0. Marshal's own first-seen bookkeeping, so a just-deployed agent reads
  //    as 'pending' rather than a dead 'never' until its first window elapses.
  const firstWatchedAt = await ensureFirstWatchedAt(
      db, await loadFirstWatchedAt(db), WATCHED, now);

  // 1. Last run per watched agent (agentId+createdAt index exists).
  const lastRunByAgent = {};
  await Promise.all(WATCHED.map(async (w) => {
    lastRunByAgent[w.id] = await lastRunMs(db, w.id);
  }));

  // 2. Paused agents — mirrors the dispatcher's circuit-breaker query.
  let pausedAgents = [];
  try {
    const snap = await db.collection("agentControl").where("paused", "==", true).get();
    pausedAgents = snap.docs.map((d) => d.id);
  } catch (err) {
    // ignore — a paused-read miss shouldn't sink the whole assessment
  }

  // 3. Stuck jobs — running/queued older than STUCK_MS (status+createdAt index).
  const stuckJobs = [];
  for (const st of ["running", "queued"]) {
    try {
      const snap = await db.collection("agentJobs")
          .where("status", "==", st)
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();
      snap.docs.forEach((doc) => {
        const d = doc.data() || {};
        if (d.seed === true) return;
        const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null;
        const ageMs = ms == null ? null : now - ms;
        if (ageMs != null && ageMs > STUCK_MS) {
          stuckJobs.push({id: doc.id, agentId: d.agentId || null, status: st, ageMs});
        }
      });
    } catch (err) {
      // ignore this status bucket
    }
  }

  // 4. Failures in the last 24h.
  const recentFailures = [];
  try {
    const snap = await db.collection("agentJobs")
        .where("status", "==", "failed")
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      if (d.seed === true) return;
      const ms = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null;
      const agoMs = ms == null ? null : now - ms;
      if (agoMs != null && agoMs <= FAILURE_WINDOW_MS) {
        recentFailures.push({
          id: doc.id, agentId: d.agentId || null,
          error: clampMessage(d.error), agoMs,
        });
      }
    });
  } catch (err) {
    // ignore
  }

  return assessFleet({
    now, watched: WATCHED, lastRunByAgent, firstWatchedAt,
    pausedAgents, stuckJobs, recentFailures,
  });
}

module.exports = {runMarshal, assessFleet, WATCHED, STUCK_MS, FAILURE_WINDOW_MS};
