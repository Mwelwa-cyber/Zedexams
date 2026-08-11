// Plain-node tests for the attendance export model + print builders:
// printed totals must come from the same calculation engine as the screen,
// and a realistic large class must stay far below Firestore's 1 MiB doc cap.
// Run: npm run test:attendance-export  (auto-discovered by run-all-tests.mjs)
import assert from 'node:assert/strict';
import {
  buildRegisterExportModel,
  buildOfficialRegisterHtml,
  buildTermSummaryHtml,
  buildLearnerReportHtml,
  buildPaperPreview,
  paperGeometry,
  registerMatrixRows,
  termSummaryRows,
} from '../src/features/register/lib/attendanceExportService.js';
import { computeLearnerTotals, formatPercent } from '../src/utils/attendanceCalculator.js';
import { resolveTermInfo, buildTermDays, markableDays } from '../src/utils/attendanceCalendarResolver.js';
import { computeDailyCounts } from '../src/utils/attendanceCalculator.js';

const TODAY = '2026-06-15';
const termInfo = resolveTermInfo({ term: 'Term 2', year: 2026 });
const register = { id: 'class1', className: 'Grade 4 Blue', grade: '4', school: 'Chilenje Basic School', teacherUid: 't1', term: 'Term 2', year: 2026 };
const school = { schoolName: 'Chilenje Basic School', address: 'Plot 12, Chilenje, Lusaka' };

// 60 learners; learner 2 is always absent on Fridays, learner 3 joined mid-term.
const roster = Array.from({ length: 60 }, (_, i) => ({
  id: `L${i + 1}`,
  learnerNumber: `ADM-${String(i + 1).padStart(4, '0')}`,
  fullName: `Learner ${i + 1}`,
  gender: i % 2 === 0 ? 'M' : 'F',
  order: i + 1,
  status: 'active',
  ...(i === 2 ? { joinedClassOn: '2026-06-01' } : {}),
}));

const allDays = buildTermDays({ termInfo, todayIso: TODAY });
const daysWithRecords = allDays.map((day) => {
  if (!day.markable) return { ...day, records: {} };
  const records = {};
  for (const l of roster) {
    if (l.joinedClassOn && day.date < l.joinedClassOn) continue;
    let status = 'present';
    if (l.id === 'L2' && day.weekday === 5) status = 'absent';
    if (l.id === 'L5' && day.date === '2026-05-20') status = 'sick';
    if (l.id === 'L6' && day.date === '2026-05-21') status = 'late';
    records[l.id] = { status, note: '' };
  }
  return { ...day, records };
});

const model = buildRegisterExportModel({
  register, school, teacherName: 'Mr. M. Chisenga', termInfo,
  daysWithRecords, roster, policy: undefined, range: null, printedOn: TODAY,
});

// ── model totals ARE the engine's totals (13: print == screen) ──────────────
const termWindow = { startDate: termInfo.startDate, endDate: termInfo.endDate };
const engineDays = model.days;
for (const id of ['L1', 'L2', 'L3', 'L5', 'L6']) {
  const learner = roster.find((l) => l.id === id);
  const expected = computeLearnerTotals({ learner, days: engineDays, term: termWindow });
  const inModel = model.learners.find((l) => l.learner.id === id).totals;
  assert.deepEqual(inModel, expected, `model totals must equal engine totals for ${id}`);
}

// Only markable, non-future days export
assert.ok(model.days.every((d) => !d.isFuture && d.date <= TODAY));
assert.deepEqual(model.days.map((d) => d.date), markableDays(allDays).map((d) => d.date));

// ── official register HTML ──────────────────────────────────────────────────
const registerHtml = buildOfficialRegisterHtml(model);
const l2 = model.learners.find((l) => l.learner.id === 'L2').totals;
assert.ok(registerHtml.includes('CHILENJE BASIC SCHOOL'));
assert.ok(registerHtml.includes('Grade 4 Blue'));
assert.ok(registerHtml.includes('Mr. M. Chisenga'));
assert.ok(registerHtml.includes(formatPercent(l2.attendancePercentage)), 'register must print the engine percentage');
assert.ok(registerHtml.includes('size: A4 landscape'));
assert.ok(registerHtml.includes('Headteacher signature'));
assert.ok(registerHtml.includes('= Present'), 'legend present');
// one page per month, headers repeated on each page
const pageCount = (registerHtml.match(/class="page"/g) || []).length;
assert.equal(pageCount, model.months.length);
assert.equal((registerHtml.match(/Learner name/g) || []).length, model.months.length);
assert.ok(registerHtml.includes(`Page 1 of ${model.months.length}`));
assert.ok(registerHtml.includes(`Page ${model.months.length} of ${model.months.length}`));

// ── term summary HTML ───────────────────────────────────────────────────────
const summaryHtml = buildTermSummaryHtml(model);
assert.ok(summaryHtml.includes('TERM ATTENDANCE SUMMARY'));
assert.ok(summaryHtml.includes(formatPercent(model.summary.averageAttendancePercentage)));
assert.ok(summaryHtml.includes('CLASS TOTALS'));

// ── learner report HTML ─────────────────────────────────────────────────────
const reportHtml = buildLearnerReportHtml(model, 'L2', { comment: 'Improving <steadily>' });
assert.ok(reportHtml.includes('LEARNER ATTENDANCE REPORT'));
assert.ok(reportHtml.includes('ADM-0002'));
assert.ok(reportHtml.includes(formatPercent(l2.attendancePercentage)));
assert.ok(reportHtml.includes('Improving &lt;steadily&gt;'), 'comment must be HTML-escaped');
assert.equal(buildLearnerReportHtml(model, 'nope'), null);

// HTML injection stays escaped everywhere
const evilModel = buildRegisterExportModel({
  register: { ...register, className: '<script>alert(1)</script>' },
  school, teacherName: 'T', termInfo, daysWithRecords, roster, printedOn: TODAY,
});
assert.ok(!buildOfficialRegisterHtml(evilModel).includes('<script>alert(1)</script>'));

// ── tabular rows ────────────────────────────────────────────────────────────
const matrix = registerMatrixRows(model);
assert.equal(matrix.length, 60);
assert.equal(matrix[0]['Learner Name'], 'Learner 1');
assert.equal(matrix[1]['2026-05-15'], 'A'); // L2's Friday absence
// L3 joined 1 June — earlier dates show the not-enrolled dash
assert.equal(matrix[2]['2026-05-15'], '–');
assert.equal(matrix[2]['2026-06-15'], 'P');
const summaryRows = termSummaryRows(model);
assert.equal(summaryRows.length, 60);
assert.equal(summaryRows[1].Absent, l2.absentDays);
assert.equal(summaryRows[1]['Attendance %'], Math.round(l2.attendancePercentage * 10) / 10);

// ── month-range export ──────────────────────────────────────────────────────
const mayModel = buildRegisterExportModel({
  register, school, teacherName: 'T', termInfo, daysWithRecords, roster,
  range: { from: '2026-05-01', to: '2026-05-31' }, printedOn: TODAY,
});
assert.ok(mayModel.days.every((d) => d.date.startsWith('2026-05')));
assert.equal(mayModel.months.length, 1);

// ── empty roster (14) ───────────────────────────────────────────────────────
const emptyModel = buildRegisterExportModel({
  register, school, teacherName: 'T', termInfo, daysWithRecords, roster: [], printedOn: TODAY,
});
assert.equal(emptyModel.learners.length, 0);
assert.ok(buildOfficialRegisterHtml(emptyModel).includes('CLASS REGISTER'));
assert.equal(registerMatrixRows(emptyModel).length, 0);

// ── Firestore day-doc size with a realistic large class (17) ────────────────
// One doc per class per date: 60 learners with notes must sit FAR below the
// 1 MiB document limit (we assert < 64 KiB to leave room for metadata growth).
{
  const records = {};
  for (const l of roster) {
    records[l.id] = {
      status: 'present',
      note: 'Arrived with a sick note from the clinic', // worst-case-ish note
      updatedBy: 'teacher-uid-1234567890',
      updatedAt: { seconds: 1780000000, nanoseconds: 0 },
    };
  }
  const dayDoc = {
    classId: 'class1', teacherUid: 't1', date: '2026-06-15',
    term: 'Term 2', year: 2026, termId: '2026-T2', classification: 'teaching_day',
    records, counts: computeDailyCounts(records),
    markedBy: 't1', updatedBy: 't1', version: 42,
  };
  const bytes = Buffer.byteLength(JSON.stringify(dayDoc), 'utf8');
  assert.ok(bytes < 64 * 1024, `day doc for 60 learners is ${bytes} bytes — must stay well under Firestore's limit`);
}

// ── print documents never inherit the grid's sticky positioning ─────────────
for (const html of [registerHtml, summaryHtml, reportHtml]) {
  assert.ok(!/position:\s*sticky|\bsticky\b/i.test(html), 'print HTML must not contain sticky positioning');
}

// ── paper preview IS the printed page (18) ─────────────────────────────────
// The preview's claim is that it shows what will print. That only holds if the
// sheet carries the printed page's own markup — so every month's preview page
// must appear VERBATIM inside the printed document, and the print stylesheet
// must be the same one.
{
  const geo = paperGeometry('landscape');
  assert.equal(geo.widthMm, 297);
  assert.equal(geo.heightMm, 210);
  assert.ok(geo.widthPx > geo.heightPx, 'landscape sheet is wider than it is tall');
  assert.equal(paperGeometry('portrait').widthMm, 210);

  assert.ok(model.months.length >= 2, 'fixture term should span several months');
  for (const [i, month] of model.months.entries()) {
    const preview = buildPaperPreview(model, { monthKey: month.key });
    assert.equal(preview.page, i + 1);
    assert.equal(preview.pages, model.months.length);
    assert.equal(preview.monthKey, month.key);
    assert.equal(preview.label, month.label);
    const section = preview.html.slice(
      preview.html.indexOf('<section class="page">'),
      preview.html.indexOf('</section>') + '</section>'.length,
    );
    assert.ok(section.includes(`CLASS REGISTER — ${month.label}`));
    assert.ok(
      registerHtml.includes(section),
      `preview page for ${month.label} must be the same markup the printer gets`,
    );
  }

  // Signatures belong on the last page only — in the preview exactly as in print.
  const first = buildPaperPreview(model, { monthKey: model.months[0].key });
  const last = buildPaperPreview(model, { monthKey: model.months[model.months.length - 1].key });
  assert.ok(!first.html.includes('Headteacher signature'));
  assert.ok(last.html.includes('Headteacher signature'));

  // An unknown / missing month key falls back to page 1 rather than a blank sheet.
  for (const key of [null, undefined, '1999-01']) {
    const fallback = buildPaperPreview(model, { monthKey: key });
    assert.equal(fallback.page, 1);
    assert.equal(fallback.monthKey, model.months[0].key);
  }

  // The summary preview is the summary document's page.
  const summaryPreview = buildPaperPreview(model, { doc: 'summary' });
  assert.equal(summaryPreview.pages, 1);
  assert.equal(summaryPreview.doc, 'summary');
  const summarySection = summaryPreview.html.slice(
    summaryPreview.html.indexOf('<section class="page">'),
    summaryPreview.html.indexOf('</section>') + '</section>'.length,
  );
  assert.ok(summaryHtml.includes(summarySection), 'summary preview must be the printed summary page');

  // Screen sheet, not a print box: A4 geometry replaces @page, and the printed
  // margin is folded into the sheet so the content box matches the paper.
  for (const p of [first, summaryPreview]) {
    assert.ok(!p.html.includes('@page'), 'a screen sheet has no @page rule');
    assert.ok(p.html.includes('width: 297mm'));
    assert.ok(p.html.includes('min-height: 210mm'));
    assert.ok(!/position:\s*sticky/i.test(p.html));
  }
  assert.ok(first.html.includes('calc(8mm + 24px)'), 'register preview folds in the 8mm print margin');
  assert.ok(summaryPreview.html.includes('calc(10mm + 24px)'), 'summary preview folds in the 10mm print margin');

  // A class with no register days still renders a sheet.
  const emptyPreview = buildPaperPreview(emptyModel);
  assert.equal(emptyPreview.pages, emptyModel.months.length || 1);
  assert.ok(emptyPreview.html.includes('CLASS REGISTER'));

  // Preview and print read the SAME marks, including a learner's absences.
  const fridayAbsent = buildPaperPreview(model, { monthKey: model.months[0].key });
  assert.ok(fridayAbsent.html.includes('Learner 2'));
}

console.log('test-attendance-export: all assertions passed');
