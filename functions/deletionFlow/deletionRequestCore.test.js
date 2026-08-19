"use strict";

/**
 * The deletion state machine, transition by transition.
 *
 * Three of these tests are the reason the file is long, and none of them is
 * about a happy path:
 *
 *   • **The 7-day escalation.** A guardian who ignores a request cannot trap a
 *     child. This is the test that says silence is not a veto.
 *   • **A minor with no guardian.** There must be no path that ends in "you
 *     cannot leave because nobody is listening".
 *   • **Nothing is deleted before `completed`.** Every other state leaves the
 *     account working, and `scheduled` most of all — the 30 days are the
 *     product, not a formality.
 *
 * Run: npm run test:deletion-request-core
 */

const assert = require("node:assert/strict");

const {
  STATE,
  GUARDIAN_RESPONSE_DAYS,
  GRACE_DAYS,
  REMINDER_DAYS_BEFORE,
  DELETED_SUMMARY,
  MS_PER_DAY,
  openRequest,
  chooseGuardian,
  resolveIsMinor,
  guardianDecision,
  cancelRequest,
  escalateIfStale,
  dueForDeletion,
  reminderDue,
  pendingBanner,
  canOpenRequest,
  auditEntry,
} = require("./deletionRequestCore");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const NOW = Date.parse("2026-08-19T12:00:00Z");
const days = (n) => n * MS_PER_DAY;

const activeLink = (over = {}) => ({
  parentUid: "g1", learnerUid: "l1", status: "active", createdAt: NOW - days(90), ...over,
});

const pending = (over = {}) => ({
  id: "req1",
  learnerId: "l1",
  guardianUid: "g1",
  state: STATE.PENDING_GUARDIAN,
  requestedAt: NOW,
  ...over,
});

const scheduled = (over = {}) => ({
  id: "req1",
  learnerId: "l1",
  guardianUid: "g1",
  state: STATE.SCHEDULED,
  requestedAt: NOW - days(1),
  scheduledDeleteAt: NOW + days(GRACE_DAYS),
  ...over,
});

/* ── Who is a minor ──────────────────────────────────────────────────── */

test("a learner is a minor unless isMinor === false says otherwise", () => {
  assert.equal(resolveIsMinor({role: "learner"}), true, "no field → minor");
  assert.equal(resolveIsMinor({role: "learner", isMinor: true}), true);
  assert.equal(resolveIsMinor({role: "learner", isMinor: null}), true);
  assert.equal(resolveIsMinor({role: "learner", isMinor: "false"}), true, "a STRING is not false");
  assert.equal(resolveIsMinor(null), true, "no profile at all → minor");
  assert.equal(resolveIsMinor({role: "learner", isMinor: false}), false);
});

test("teachers, parents and admins are adults — they have no guardian to ask", () => {
  for (const role of ["teacher", "parent", "admin", "superAdmin"]) {
    assert.equal(resolveIsMinor({role}), false, role);
  }
});

/* ── Opening a request ───────────────────────────────────────────────── */

test("an adult goes straight to scheduled, 30 days out", () => {
  const out = openRequest({isMinor: false, links: [], now: NOW});
  assert.equal(out.state, STATE.SCHEDULED);
  assert.equal(out.guardianUid, null);
  assert.equal(out.scheduledDeleteAt, NOW + days(GRACE_DAYS));
});

test("a minor with an approved guardian waits on that guardian, and nothing is scheduled", () => {
  const out = openRequest({isMinor: true, links: [activeLink()], now: NOW});
  assert.equal(out.state, STATE.PENDING_GUARDIAN);
  assert.equal(out.guardianUid, "g1");
  assert.equal(out.scheduledDeleteAt, null, "nothing may be scheduled before an answer");
});

test("A MINOR WITH NO GUARDIAN IS NEVER STUCK — support takes it", () => {
  for (const links of [[], null, undefined]) {
    const out = openRequest({isMinor: true, links, now: NOW});
    assert.equal(out.state, STATE.ESCALATED_SUPPORT, "a child with no guardian must reach a resolution");
    assert.equal(out.escalatedAt, NOW);
  }
});

test("a PENDING link is not a guardian — an unconfirmed adult gets no veto", () => {
  const out = openRequest({isMinor: true, links: [activeLink({status: "pending"})], now: NOW});
  assert.equal(out.state, STATE.ESCALATED_SUPPORT,
    "an adult the child has not confirmed cannot hold their account");
});

test("a DECLINED link is not a guardian either", () => {
  const out = openRequest({isMinor: true, links: [activeLink({status: "declined"})], now: NOW});
  assert.equal(out.state, STATE.ESCALATED_SUPPORT);
});

test("a legacy link with no status still authorises its guardian", () => {
  // Links written before `status` existed. Reading them as inactive would strip
  // real guardians of children they have managed for months.
  const link = activeLink();
  delete link.status;
  const out = openRequest({isMinor: true, links: [link], now: NOW});
  assert.equal(out.state, STATE.PENDING_GUARDIAN);
  assert.equal(out.guardianUid, "g1");
});

/* ── Which guardian is asked ─────────────────────────────────────────── */

test("the owner is asked when there is one", () => {
  const chosen = chooseGuardian([
    activeLink({parentUid: "co", role: "co-guardian", createdAt: NOW - days(200)}),
    activeLink({parentUid: "own", role: "owner", createdAt: NOW - days(10)}),
  ]);
  assert.equal(chosen.parentUid, "own", "the owner is asked even though they linked later");
});

test("with no owner, the earliest link is asked — deterministically", () => {
  const links = [
    activeLink({parentUid: "b", createdAt: NOW - days(10)}),
    activeLink({parentUid: "a", createdAt: NOW - days(50)}),
  ];
  assert.equal(chooseGuardian(links).parentUid, "a");
  assert.equal(chooseGuardian([...links].reverse()).parentUid, "a",
    "query order must not change who is asked");
});

test("identical timestamps still resolve to one guardian, stably", () => {
  const links = [
    activeLink({parentUid: "zed", createdAt: NOW}),
    activeLink({parentUid: "abe", createdAt: NOW}),
  ];
  assert.equal(chooseGuardian(links).parentUid, "abe");
  assert.equal(chooseGuardian([...links].reverse()).parentUid, "abe");
});

test("only ONE guardian is ever named — this is not a family announcement", () => {
  const out = openRequest({
    isMinor: true,
    links: [activeLink({parentUid: "g1"}), activeLink({parentUid: "g2"})],
    now: NOW,
  });
  assert.equal(typeof out.guardianUid, "string");
  assert.equal(out.guardianUid, "g1");
});

/* ── The guardian answers ────────────────────────────────────────────── */

test("approve schedules the deletion 30 days out and tells the child", () => {
  const out = guardianDecision({request: pending(), actorUid: "g1", decision: "approve", now: NOW});
  assert.equal(out.ok, true);
  assert.equal(out.patch.state, STATE.SCHEDULED);
  assert.equal(out.patch.scheduledDeleteAt, NOW + days(GRACE_DAYS));
  assert.equal(out.patch.guardianRespondedAt, NOW);
  assert.equal(out.notify.learner, "approved", "silence would be the cruel part");
});

test("decline closes the request and tells the child", () => {
  const out = guardianDecision({request: pending(), actorUid: "g1", decision: "decline", now: NOW});
  assert.equal(out.patch.state, STATE.DECLINED);
  assert.equal(out.notify.learner, "declined");
  assert.equal(out.patch.scheduledDeleteAt, undefined, "a decline schedules nothing");
});

test("PARK does not stop the seven-day clock", () => {
  const out = guardianDecision({request: pending(), actorUid: "g1", decision: "park", now: NOW});
  assert.equal(out.ok, true);
  assert.equal(out.patch.state, undefined,
    "parking must not write a state — that would remove the child's escalation");
  assert.equal(out.patch.parkedAt, NOW);

  // And the proof: a parked request still escalates on day seven.
  const parked = pending({parkedAt: NOW});
  const esc = escalateIfStale({request: parked, now: NOW + days(GUARDIAN_RESPONSE_DAYS)});
  assert.ok(esc, "a guardian who parks and forgets is, to the child, one who ignored it");
  assert.equal(esc.patch.state, STATE.ESCALATED_SUPPORT);
});

test("a guardian who was not asked cannot answer", () => {
  const out = guardianDecision({request: pending(), actorUid: "someone-else", decision: "approve", now: NOW});
  assert.equal(out.ok, false);
  assert.equal(out.code, "not_your_request");
});

test("an unauthenticated actor cannot answer", () => {
  for (const actorUid of [null, undefined, ""]) {
    const out = guardianDecision({request: pending(), actorUid, decision: "approve", now: NOW});
    assert.equal(out.ok, false, String(actorUid));
  }
});

test("a request that is not pending cannot be answered twice", () => {
  for (const state of [STATE.SCHEDULED, STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED, STATE.ESCALATED_SUPPORT]) {
    const out = guardianDecision({request: pending({state}), actorUid: "g1", decision: "approve", now: NOW});
    assert.equal(out.ok, false, state);
    assert.equal(out.code, "wrong_state");
    assert.ok(out.message.length > 10, "the refusal must say something a person can read");
  }
});

test("an unknown decision is refused rather than guessed at", () => {
  const out = guardianDecision({request: pending(), actorUid: "g1", decision: "maybe", now: NOW});
  assert.equal(out.ok, false);
  assert.equal(out.code, "bad_decision");
});

/* ── Cancelling and restoring ────────────────────────────────────────── */

test("the child can withdraw from every state in which the account still exists", () => {
  for (const state of [STATE.PENDING_GUARDIAN, STATE.SCHEDULED, STATE.ESCALATED_SUPPORT]) {
    const out = cancelRequest({request: pending({state}), actorUid: "l1", now: NOW});
    assert.equal(out.ok, true, state);
    assert.equal(out.patch.state, STATE.CANCELLED);
    assert.equal(out.patch.cancelledBy, "learner");
  }
});

test("the guardian's Restore is the same transition, and tells the child", () => {
  const out = cancelRequest({request: scheduled(), actorUid: "g1", now: NOW});
  assert.equal(out.patch.state, STATE.CANCELLED);
  assert.equal(out.patch.cancelledBy, "guardian");
  assert.equal(out.notify.learner, "restored");
});

test("a learner signing in cancels, and the reason records why", () => {
  const out = cancelRequest({request: scheduled(), actorUid: "l1", now: NOW, actor: "sign_in"});
  assert.equal(out.patch.state, STATE.CANCELLED);
  assert.equal(out.patch.cancelReason, "learner_signed_in");
});

test("a stranger cannot cancel somebody else's request", () => {
  const out = cancelRequest({request: scheduled(), actorUid: "nobody", now: NOW});
  assert.equal(out.ok, false);
  assert.equal(out.code, "not_yours");
});

test("a finished request cannot be cancelled", () => {
  for (const state of [STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED]) {
    const out = cancelRequest({request: pending({state}), actorUid: "l1", now: NOW});
    assert.equal(out.ok, false, state);
  }
});

/* ── The 7-day escalation ────────────────────────────────────────────── */

test("SILENCE IS NOT A VETO — seven days unanswered goes to support", () => {
  const req = pending({requestedAt: NOW});
  assert.equal(escalateIfStale({request: req, now: NOW + days(7) - 1}), null, "not yet");
  const out = escalateIfStale({request: req, now: NOW + days(GUARDIAN_RESPONSE_DAYS)});
  assert.ok(out);
  assert.equal(out.patch.state, STATE.ESCALATED_SUPPORT);
  assert.equal(out.patch.escalationReason, "guardian_did_not_respond");
  assert.equal(out.notify.learner, "escalated", "the child is told a person is now handling it");
});

test("escalation touches nothing that is not pending", () => {
  for (const state of [STATE.SCHEDULED, STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED, STATE.ESCALATED_SUPPORT]) {
    assert.equal(escalateIfStale({request: pending({state}), now: NOW + days(30)}), null, state);
  }
});

test("escalation reads Firestore timestamps as well as numbers", () => {
  const req = pending({requestedAt: {toMillis: () => NOW}});
  assert.ok(escalateIfStale({request: req, now: NOW + days(7)}));
  const req2 = pending({requestedAt: {seconds: Math.floor(NOW / 1000)}});
  assert.ok(escalateIfStale({request: req2, now: NOW + days(7)}));
});

/* ── The 30-day window ───────────────────────────────────────────────── */

test("NOTHING IS DELETED before the window closes", () => {
  const req = scheduled();
  assert.equal(dueForDeletion({request: req, now: NOW}), null);
  assert.equal(dueForDeletion({request: req, now: NOW + days(GRACE_DAYS) - 1}), null,
    "not one millisecond early");
  const due = dueForDeletion({request: req, now: NOW + days(GRACE_DAYS)});
  assert.ok(due);
  assert.equal(due.learnerId, "l1");
});

test("no state other than scheduled is ever due for deletion", () => {
  for (const state of [STATE.PENDING_GUARDIAN, STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED, STATE.ESCALATED_SUPPORT]) {
    assert.equal(
      dueForDeletion({request: scheduled({state}), now: NOW + days(365)}),
      null,
      `${state} must never be purged by the sweep`,
    );
  }
});

test("a scheduled request with NO date is never due — 'unknown' is not 'now'", () => {
  for (const at of [null, undefined, 0, "", "not-a-date"]) {
    assert.equal(
      dueForDeletion({request: scheduled({scheduledDeleteAt: at}), now: NOW + days(365)}),
      null,
      String(at),
    );
  }
});

/* ── The day-25 reminder ─────────────────────────────────────────────── */

test("both sides are reminded before the window closes, with a real number", () => {
  const req = scheduled({scheduledDeleteAt: NOW + days(GRACE_DAYS)});
  assert.equal(reminderDue({request: req, now: NOW}), null, "not 30 days out");
  const out = reminderDue({request: req, now: NOW + days(GRACE_DAYS - REMINDER_DAYS_BEFORE)});
  assert.ok(out);
  assert.equal(out.daysLeft, REMINDER_DAYS_BEFORE);
});

test("a reminder is sent once, not five times", () => {
  const req = scheduled({
    scheduledDeleteAt: NOW + days(2),
    graceReminderSentAt: NOW - days(1),
  });
  assert.equal(reminderDue({request: req, now: NOW}), null);
});

test("no reminder once the window has already closed", () => {
  const req = scheduled({scheduledDeleteAt: NOW - days(1)});
  assert.equal(reminderDue({request: req, now: NOW}), null);
});

/* ── What the account itself shows ───────────────────────────────────── */

test("a scheduled account counts down and offers restore", () => {
  const b = pendingBanner({request: scheduled({scheduledDeleteAt: NOW + days(30)}), now: NOW});
  assert.equal(b.kind, "scheduled");
  assert.equal(b.daysLeft, 30);
  assert.equal(b.canRestore, true);
});

test("a waiting account says it is waiting, and cannot be restored — there is nothing to restore", () => {
  const b = pendingBanner({request: pending({requestedAt: NOW}), now: NOW + days(2)});
  assert.equal(b.kind, "pending_guardian");
  assert.equal(b.daysLeft, 5, "five of the seven days left");
  assert.equal(b.canRestore, false);
});

test("an escalated account says a person is handling it", () => {
  const b = pendingBanner({request: pending({state: STATE.ESCALATED_SUPPORT}), now: NOW});
  assert.equal(b.kind, "escalated_support");
});

test("a finished or absent request shows no banner", () => {
  for (const state of [STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED]) {
    assert.equal(pendingBanner({request: pending({state}), now: NOW}), null, state);
  }
  assert.equal(pendingBanner({request: null, now: NOW}), null);
});

test("the countdown never goes negative", () => {
  const b = pendingBanner({request: scheduled({scheduledDeleteAt: NOW - days(5)}), now: NOW});
  assert.equal(b.daysLeft, 0);
});

/* ── One request at a time ───────────────────────────────────────────── */

test("a second ask returns the first request rather than opening another", () => {
  for (const state of [STATE.PENDING_GUARDIAN, STATE.SCHEDULED, STATE.ESCALATED_SUPPORT]) {
    const out = canOpenRequest({existing: {id: "req1", state}});
    assert.equal(out.ok, false, state);
    assert.equal(out.existingId, "req1");
  }
});

test("once a request is finished, a new one may be opened", () => {
  for (const state of [STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED]) {
    assert.equal(canOpenRequest({existing: {id: "req1", state}}).ok, true, state);
  }
  assert.equal(canOpenRequest({existing: null}).ok, true);
});

/* ── The shared copy ─────────────────────────────────────────────────── */

test("the Deleted list is shared, non-empty, and never mentions payments", () => {
  assert.ok(DELETED_SUMMARY.length >= 5);
  assert.ok(Object.isFrozen(DELETED_SUMMARY), "one array, two screens — it must not be mutable");
  for (const line of DELETED_SUMMARY) {
    assert.doesNotMatch(line, /payment|invoice|receipt/i,
      "what happens to financial records is a separate, unsettled decision");
  }
});

/* ── Audit ───────────────────────────────────────────────────────────── */

test("an audit entry records who acted and as what", () => {
  const e = auditEntry({
    requestId: "req1", learnerId: "l1",
    from: STATE.PENDING_GUARDIAN, to: STATE.SCHEDULED,
    actor: "guardian", actorUid: "g1", reason: "approved", now: NOW,
  });
  assert.equal(e.requestId, "req1");
  assert.equal(e.from, STATE.PENDING_GUARDIAN);
  assert.equal(e.to, STATE.SCHEDULED);
  assert.equal(e.actor, "guardian");
  assert.equal(e.actorUid, "g1");
  assert.equal(e.at, NOW);
});

test("a system transition is attributable too", () => {
  const e = auditEntry({requestId: "r", learnerId: "l", to: STATE.ESCALATED_SUPPORT, now: NOW});
  assert.equal(e.actor, "system");
  assert.equal(e.actorUid, null);
});

/* ── The clock is never implicit ─────────────────────────────────────── */

test("every time-dependent function refuses to run without a clock", () => {
  const calls = [
    () => openRequest({isMinor: true, links: []}),
    () => guardianDecision({request: pending(), actorUid: "g1", decision: "approve"}),
    () => cancelRequest({request: pending(), actorUid: "l1"}),
    () => escalateIfStale({request: pending()}),
    () => dueForDeletion({request: scheduled()}),
    () => reminderDue({request: scheduled()}),
    () => pendingBanner({request: scheduled()}),
    () => auditEntry({requestId: "r", learnerId: "l"}),
  ];
  for (const [i, call] of calls.entries()) {
    assert.throws(call, /now/, `call ${i} accepted a missing clock`);
  }
});

/* ── Runner ──────────────────────────────────────────────────────────── */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(`\ndeletion request core: ${tests.length - failed}/${tests.length} passed`);
if (failed) {
  throw new Error(`${failed} deletion-request-core test(s) failed`);
}
