// Plain-node tests for attendance day-document logic (validation gates,
// mark-all-present, audit diffs, concurrent-edit merge).
// Run: npm run test:attendance-day-core  (auto-discovered by run-all-tests.mjs)
import assert from 'node:assert/strict';
import {
  sanitizeNote,
  normalizeRecord,
  canMarkDay,
  canMarkLearner,
  markableLearnersOn,
  buildMarkAllPresent,
  diffRecords,
  mergeDayRecords,
  plainRecords,
  ATTENDANCE_NOTE_MAX,
} from '../src/features/register/lib/attendanceDayCore.js';

const TERM = { startDate: '2026-05-11', endDate: '2026-08-07' };
const day = (date, extra = {}) => ({ date, markable: true, isFuture: false, classification: 'teaching_day', ...extra });

// ── validation gates ────────────────────────────────────────────────────────
// Marking allowed on a plain teaching day in a draft term
assert.deepEqual(canMarkDay({ day: day('2026-05-12'), termInfo: TERM, termState: 'draft' }), { allowed: true, reason: 'ok' });
// Outside the term
assert.equal(canMarkDay({ day: day('2026-09-01'), termInfo: TERM, termState: 'draft' }).reason, 'outside_term');
// Future dates
assert.equal(canMarkDay({ day: day('2026-05-20', { isFuture: true, markable: false }), termInfo: TERM, termState: 'draft' }).reason, 'future');
// Non-teaching days
assert.equal(canMarkDay({ day: day('2026-05-16', { markable: false, classification: 'non_teaching_day' }), termInfo: TERM, termState: 'draft' }).reason, 'non_teaching');
// 7. Locked term rejects edits; reopened allows them again
assert.equal(canMarkDay({ day: day('2026-05-12'), termInfo: TERM, termState: 'locked' }).reason, 'locked');
assert.ok(canMarkDay({ day: day('2026-05-12'), termInfo: TERM, termState: 'reopened' }).allowed);
assert.ok(canMarkDay({ day: day('2026-05-12'), termInfo: TERM, termState: 'submitted' }).allowed);
// Unknown state fails closed
assert.equal(canMarkDay({ day: day('2026-05-12'), termInfo: TERM, termState: 'bogus' }).reason, 'locked');

// Learner enrolment window: not enrolled before joining / after leaving
assert.ok(canMarkLearner({ learner: { id: 'a' }, date: '2026-05-12', termInfo: TERM }));
assert.ok(!canMarkLearner({ learner: { id: 'b', joinedClassOn: '2026-06-01' }, date: '2026-05-12', termInfo: TERM }));
assert.ok(!canMarkLearner({ learner: { id: 'c', leftClassOn: '2026-05-11' }, date: '2026-05-12', termInfo: TERM }));
{
  const roster = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'active', joinedClassOn: '2026-06-01' },
    { id: 'c', status: 'inactive', leftClassOn: '2026-05-20' },
  ];
  // c was still enrolled on 12 May — history remains visible/markable
  assert.deepEqual(markableLearnersOn(roster, '2026-05-12', TERM).map((l) => l.id), ['a', 'c']);
  assert.deepEqual(markableLearnersOn(roster, '2026-06-02', TERM).map((l) => l.id), ['a', 'b']);
}

// ── mark-all-present (9. followed by exceptions) ────────────────────────────
{
  const roster = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'active' },
    { id: 'c', status: 'active' },
    { id: 'joinsLater', status: 'active', joinedClassOn: '2026-07-01' },
    { id: 'withdrawnEarly', status: 'inactive', leftClassOn: '2026-05-01' },
  ];
  const records = { b: { status: 'absent', note: '' } };
  const changes = buildMarkAllPresent({ roster, records, date: '2026-05-12', termInfo: TERM });
  // a + c marked present; b's existing absent NOT overwritten; ineligible learners skipped
  assert.deepEqual(Object.keys(changes).sort(), ['a', 'c']);
  assert.equal(changes.a.status, 'present');
}

// ── audit diffs ─────────────────────────────────────────────────────────────
{
  const prev = { a: { status: 'present', note: '' }, b: { status: 'absent', note: 'sick note pending' } };
  const next = { a: { status: 'present', note: '' }, b: { status: 'sick', note: 'sick note received' }, c: { status: 'late', note: '' } };
  const entries = diffRecords(prev, next);
  assert.equal(entries.length, 2);
  const byId = Object.fromEntries(entries.map((e) => [e.learnerId, e]));
  assert.deepEqual(byId.b, { learnerId: 'b', prevStatus: 'absent', newStatus: 'sick', prevNote: 'sick note pending', newNote: 'sick note received' });
  assert.deepEqual(byId.c, { learnerId: 'c', prevStatus: null, newStatus: 'late', prevNote: '', newNote: '' });
  assert.deepEqual(diffRecords(prev, prev), []);
}

// ── concurrent-edit merge (12) ──────────────────────────────────────────────
{
  const base = { a: { status: 'present', note: '' }, b: { status: 'present', note: '' } };
  // Another teacher marked c present and flipped b to absent since we loaded
  const server = { ...base, b: { status: 'absent', note: '' }, c: { status: 'present', note: '' } };
  // We changed a → late and b → sick locally
  const local = { a: { status: 'late', note: '' }, b: { status: 'sick', note: '' } };
  const { merged, conflicts } = mergeDayRecords({ base, server, local });
  assert.equal(merged.a.status, 'late');   // our uncontested change
  assert.equal(merged.b.status, 'sick');   // our explicit tap wins…
  assert.deepEqual(conflicts, ['b']);      // …but the conflict is reported
  assert.equal(merged.c.status, 'present'); // their addition preserved
}
{
  // Both sides made the SAME change → no conflict
  const base = { a: { status: 'present', note: '' } };
  const server = { a: { status: 'absent', note: '' } };
  const local = { a: { status: 'absent', note: '' } };
  const { conflicts } = mergeDayRecords({ base, server, local });
  assert.deepEqual(conflicts, []);
}
{
  // Invalid statuses never make it into a merge
  const { merged } = mergeDayRecords({ base: {}, server: {}, local: { a: { status: 'party' }, b: { status: 'present' } } });
  assert.deepEqual(Object.keys(merged), ['b']);
}

// ── record hygiene ──────────────────────────────────────────────────────────
assert.equal(sanitizeNote(null), '');
assert.equal(sanitizeNote('x'.repeat(500)).length, ATTENDANCE_NOTE_MAX);
assert.equal(normalizeRecord({ status: 'nonsense' }), null);
assert.deepEqual(normalizeRecord({ status: 'sick', note: 'flu', updatedBy: 'u1' }), { status: 'sick', note: 'flu' });
assert.deepEqual(plainRecords({ a: { status: 'present', note: '', updatedBy: 'u1', updatedAt: 123 }, junk: { status: 'no' } }),
  { a: { status: 'present', note: '' } });

console.log('test-attendance-day-core: all assertions passed');
