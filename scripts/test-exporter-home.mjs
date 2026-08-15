#!/usr/bin/env node
/**
 * Does every document exporter live where it is supposed to?
 *
 * `src/engines/export-engine/` is the home §12's target map gives document
 * exporters. The two lists below are the count — read them rather than a
 * number in this sentence, which is one edit away from being wrong every time
 * a feature migrates. The rest are still in `src/utils/`, waiting for
 * their features to migrate — and the risk this guards is not that they are
 * still there, but that the count goes UP: a new exporter written next to the
 * old ones because that is where its neighbours are, and a relocated one
 * quietly copied back because a `../../utils/` import was easier to type.
 *
 * Both are invisible to every other check. Lint has no opinion on which
 * directory a module lives in, and the import-boundary test enforces the
 * LAYERING (`engines` may not reach `features`) without caring whether a file
 * that belongs in an engine is sitting in `utils` instead.
 *
 * ## The two lists
 *
 * `RELOCATED` — must be in the engine, must NOT be in utils. This is the pair
 * of assertions that catches a copy-back: a file existing in both places would
 * otherwise leave two exporters producing subtly different documents, with
 * whichever one a given caller imported deciding what the teacher got.
 *
 * `STILL_IN_UTILS` — SHRINK-ONLY, in the sense the Phase 1 debt lists
 * established. An exporter in `src/utils/` that is not on this list FAILS,
 * which is what stops a new one being born in the wrong place. A listed one
 * that has left ALSO fails, with an instruction to delete the line — so the
 * remaining work is countable, and clearing it means removing a row rather
 * than leaving a note about work already done.
 *
 * ## What counts as an exporter
 *
 * A module named `*To{Docx,Pdf,Xlsx}.js`. That is a naming convention rather
 * than a property of the code, and it is stated here so the limit is honest:
 * a document exporter named something else is not seen by this check. The
 * convention holds for all 37 today, and a new exporter that breaks it is
 * choosing to be unguarded — which is a review question, not something a
 * string match can settle.
 *
 * Plain-node, no build, auto-discovered by scripts/run-all-tests.mjs.
 *
 * Run: node scripts/test-exporter-home.mjs
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UTILS = join(ROOT, 'src', 'utils');
const ENGINE = join(ROOT, 'src', 'engines', 'export-engine');

const EXPORTER = /To(Docx|Pdf|Xlsx)\.js$/;
const isExporter = (file) => EXPORTER.test(file) && !/\.(test|spec)\.js$/.test(file);

/**
 * Every exporter under `dir`, as a path RELATIVE to it — `foo/barToDocx.js`
 * rather than `barToDocx.js`.
 *
 * The walk is recursive, and the relative path is what the lists below are
 * matched against, because both halves of "is this file where it should be"
 * were answerable with a flat `readdirSync` only while both directories
 * happened to be flat. `src/utils/` already has subdirectories (`cache/`,
 * `pagination/`), so a new exporter one level down was invisible to the check
 * that exists to stop new exporters appearing there — and a relocated one
 * pushed into an engine subfolder would have read as missing OR, matched by
 * basename, as still correctly placed. Comparing full relative paths makes
 * both cases say something.
 */
function exportersUnder(dir, prefix = '') {
  const found = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const nested of exportersUnder(join(dir, entry.name), rel)) found.add(nested);
    else if (isExporter(entry.name)) found.add(rel);
  }
  return found;
}

/** Moved into the engine by #2200 (Phase 4 enabling work). */
const RELOCATED = [
  'rubricToDocx.js', 'rubricToPdf.js',
  'homeworkToDocx.js', 'homeworkToPdf.js',
  'worksheetToDocx.js', 'worksheetToPdf.js',
  'notesToDocx.js', 'notesToPdf.js',
  'flashcardsToDocx.js', 'flashcardsToPdf.js',
  // Wave 4, with the scheme-of-work studio (#2215).
  'schemeOfWorkToDocx.js', 'schemeOfWorkToPdf.js',
  // Wave 4, with the weekly-forecast studio.
  'weeklyForecastToDocx.js',
  // Wave 4, with the SBA studios.
  'sbaTaskToDocx.js', 'sbaTaskToPdf.js', 'sbaTrackerToDocx.js', 'sbaTrackerToXlsx.js', 'sbaPlannerToDocx.js',
  // Wave 4, with the class-timetable studio.
  'classTimetableToDocx.js', 'classTimetableToPdf.js', 'classTimetableToXlsx.js',
  // Wave 4, with the mark-schedule studio.
  'markScheduleToDocx.js', 'markScheduleToXlsx.js',
  // Wave 4, with the record-of-work studio.
  'recordOfWorkToDocx.js',
  // Wave 4, with the class register. `reportCardsToDocx` is reached in the
  // engine DIRECTLY by features/teacherLibrary and features/markSchedule, on
  // #2172's rule — it is not on the register's front door.
  'reportCardsToDocx.js', 'attendanceToDocx.js',
  // Wave 4, with the lesson-plan studio. Same rule: features/teacherLibrary
  // reaches both here directly rather than through the studio's front door,
  // which keeps jsPDF out of two declared light pages.
  'lessonPlanToDocx.js', 'lessonPlanToPdf.js',
];

/**
 * Still in `src/utils/`, each with the feature that will bring it across when
 * it migrates. SHRINK-ONLY: additions fail, departures fail.
 */
const STILL_IN_UTILS = new Map([
  ['assessmentToDocx.js', 'assessment studio — frozen until the Phase 3 rollout flags reach 100%'],
  ['assessmentToPdf.js', 'assessment studio — same freeze'],
  ['activityToDocx.js', 'lesson activities — renders documents saved before the Full Lesson studio was retired'],
  ['fullLessonToDocx.js', 'retired Full Lesson studio; saved lessons still export'],
  ['fullLessonToPdf.js', 'retired Full Lesson studio; saved lessons still export'],
  ['learnerNotesToDocx.js', 'learner Notes (features/notes) — not yet migrated'],
  ['htmlToPdf.js', 'SHARED PRIMITIVE, not a document exporter — the html2canvas/jsPDF path several exporters call. Named like one by the convention above, so it is listed rather than silently skipped'],
  ['studioHtmlToDocx.js', 'SHARED PRIMITIVE — the HTML→docx converter behind the studio exporters, same reasoning'],
]);

let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL: ${message}`); };

if (!existsSync(ENGINE)) fail('src/engines/export-engine/ does not exist.');

const inUtils = exportersUnder(UTILS);
const inEngine = exportersUnder(ENGINE);

// 1. Every relocated exporter is in the engine and NOT in utils.
for (const file of RELOCATED) {
  if (!inEngine.has(file)) {
    fail(`${file} is recorded as relocated but is not in src/engines/export-engine/. If it moved again, update this list.`);
  }
  if (inUtils.has(file)) {
    fail(
      `${file} exists in BOTH src/utils/ and src/engines/export-engine/. Two exporters for one document is worse ` +
      'than either home: they drift, and which teacher gets which output depends on what a given caller imported.',
    );
  }
}

// 2. Nothing new appears in utils.
for (const file of [...inUtils].sort()) {
  if (!STILL_IN_UTILS.has(file)) {
    fail(
      `src/utils/${file} looks like a document exporter and is not recorded here.\n` +
      '       A NEW exporter belongs in src/engines/export-engine/ — see its index.js for the contract.\n' +
      '       If this is a pre-existing one this list missed, add it with the feature that will bring it across.',
    );
  }
}

// 3. A recorded one that has left must lose its line.
for (const [file, why] of STILL_IN_UTILS) {
  if (!inUtils.has(file)) {
    fail(`"${file}" is recorded as still in src/utils/ but is not there. Delete its line — the list only shrinks. (${why})`);
  }
}

// 4. Nothing unexpected in the engine either: everything there is recorded.
for (const file of [...inEngine].sort()) {
  if (!RELOCATED.includes(file)) {
    fail(`src/engines/export-engine/${file} is not recorded in RELOCATED. Add it, so the engine's contents stay a stated list.`);
  }
}

if (failures) {
  console.error(`\n${failures} exporter-home failure(s).`);
  process.exit(1);
}

console.log(
  `ok: ${RELOCATED.length} exporters in src/engines/export-engine/ and none left behind in src/utils/; ` +
  `${STILL_IN_UTILS.size} still recorded in src/utils/, and no new ones`,
);
